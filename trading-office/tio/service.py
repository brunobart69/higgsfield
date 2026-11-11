"""Serviço do escritório: dados, reuniões ao vivo, operações simuladas, chat e aprendizado."""
from __future__ import annotations

import json
import re
import threading
import time
from typing import Optional

from . import backtest, binary, learning
from .agents import SPECIALISTS, HeadTrader, RiskManager
from .context import MarketData
from .data.news import NewsStore
from .data.providers import Provider, get_provider
from .meeting import STRATEGIES, Office
from .memory import Memory
from .models import ASSETS, DIR_LABEL, TF_SECONDS, TIMEFRAMES, asset_label, fmt_ts, normalize_asset

ALIASES = {"EURO DOLAR": "EURUSD", "EURO DÓLAR": "EURUSD", "EURODOLAR": "EURUSD", "FIBER": "EURUSD",
           "CABLE": None, "IENE": "USDJPY", "LOONIE": "USDCAD", "GOPHER": "GBPJPY", "GUPPY": "GBPJPY"}


DEFAULT_EXPIRY = {"M1": 3, "M5": 3, "M15": 4, "M30": 2, "H1": 2}
CACHE_TTL = {"M1": 10, "M5": 20, "M15": 30, "M30": 60, "H1": 60, "H4": 180, "D1": 600, "W1": 1800, "MN": 3600}


class OfficeService:
    def __init__(self, provider: Optional[Provider] = None, memory: Optional[Memory] = None, base_tf: str = "M15",
                 tfs: Optional[list[str]] = None, expiry: Optional[dict] = None):
        self.provider = provider or get_provider()
        self.memory = memory or Memory()
        self.news = NewsStore()
        self.base_tf = base_tf
        self.tfs = tfs or [base_tf]
        if base_tf not in self.tfs:
            self.tfs.insert(0, base_tf)
        self.expiry = {**DEFAULT_EXPIRY, **(expiry or {})}
        self._series: dict[tuple, tuple[float, object]] = {}
        self._data: dict[tuple, tuple[tuple, MarketData]] = {}
        self._analysis: dict[tuple, dict] = {}
        self.lock = threading.RLock()
        self.office = Office()
        self.jobs: dict[str, dict] = {}
        self.autopilot = {"running": False, "cycles": 0, "last": None, "errors": []}

    # ------------------------------------------------------------------ dados
    def _series_cached(self, asset: str, tf: str):
        k = (asset, tf)
        hit = self._series.get(k)
        if hit and time.time() - hit[0] < CACHE_TTL.get(tf, 60):
            return hit[1]
        try:
            srs = self.provider.load(asset, tf)
        except Exception:  # fonte indisponível para esta TF
            srs = None
        self._series[k] = (time.time(), srs)
        return srs

    def data(self, asset: str, tf: Optional[str] = None) -> Optional[MarketData]:
        tf = tf or self.base_tf
        with self.lock:
            base = self._series_cached(asset, tf)
            if base is None or not len(base):
                return None
            extra = {}
            if getattr(self.provider, "native_multi_tf", False):
                for t in TIMEFRAMES:
                    if t != tf:
                        srs = self._series_cached(asset, t)
                        if srs is not None and len(srs):
                            extra[t] = srs
            stamp = (id(base),) + tuple(sorted((t, id(v)) for t, v in extra.items()))
            hit = self._data.get((asset, tf))
            if hit and hit[0] == stamp:
                return hit[1]
            from .data.providers import closed_only
            from .models import Series
            b = Series(base.asset, base.timeframe, closed_only(base.candles), base.source, base.synthetic, base.volume_kind)
            if not b.candles:
                return None
            md = MarketData(asset, b, extra)
            md.indicators = self.load_user_indicators(asset)
            self._data[(asset, tf)] = (stamp, md)
            return md

    def load_user_indicators(self, asset: str) -> dict:
        if not hasattr(self.provider, "indicator_store"):
            return {}
        from .data.mt5_indicators import load_overrides
        try:
            store, sym = self.provider.indicator_store(asset)
            return store.load(sym, asset, load_overrides()) if sym else {}
        except Exception:
            return {}

    def status(self) -> dict:
        md = self.data(ASSETS[0])
        version, params = self.memory.active_version()
        cov = self.news.coverage()
        return {"provider": self.provider.name, "source": md.source if md else None,
                "synthetic": bool(md and md.synthetic), "volume_kind": md.volume_kind if md else None,
                "base_tf": self.base_tf, "tfs": self.tfs, "expiry": {t: self.expiry.get(t, 3) for t in self.tfs},
                "assets": ASSETS, "model_version": version,
                "news_loaded": self.news.loaded, "news_events": len(self.news.events),
                "news_coverage": [fmt_ts(cov[0]), fmt_ts(cov[1])] if cov else None,
                "last_candle": fmt_ts(md.base[-1].close_ts) if md else None, "payout": params.payout,
                "real_money": binary.REAL_MONEY_ENABLED, "autopilot": self.autopilot,
                "mt5": self.provider.name == "mt5", "strategies": list(STRATEGIES)}

    def agents_catalog(self) -> list[dict]:
        out = [cls().card() for cls in SPECIALISTS] + [RiskManager().card(), HeadTrader().card()]
        stats = self.memory.agent_stats(mode="live")
        bts = self.memory.backtests(1)
        bt_agents = bts[0]["metrics"].get("agents", {}) if bts else {}
        for a in out:
            s = stats.get(a["code"])
            a["live"] = {"n": s["n"], "hits": s["hits"], "hit_rate": s["hit_rate"], "ci": s["ci"]} if s else None
            a["backtest"] = bt_agents.get(a["code"])
        return out

    # ------------------------------------------------------------------ análise
    def analyze(self, asset: str, tf: Optional[str] = None, record: bool = True) -> dict:
        tf = tf or self.base_tf
        md = self.data(asset, tf)
        if md is None:
            return {"error": f"Sem dados de {asset} em {tf} na fonte '{self.provider.name}'."}
        version, params = self.memory.active_version()
        key = (asset, tf, md.base[-1].close_ts, version)
        with self.lock:
            if key in self._analysis:
                return self._analysis[key]
            self.resolve_pending(asset, tf, md)
            ctx = md.context(None, self.news, self.memory, params)
            res = self.office.meet(ctx, version)
            res["as_of_label"] = fmt_ts(res["as_of"])
            res["chart"] = self.chart(md, res)
            res["expiry_bars"] = self.expiry.get(tf, 3)
            if record:
                self._record(asset, tf, md, res, params, version)
            self._analysis[key] = res
            if len(self._analysis) > 400:
                for k in list(self._analysis)[:200]:
                    self._analysis.pop(k, None)
            return res

    def _record(self, asset, tf, md, res, params, version) -> None:
        exists = self.memory.q("SELECT id FROM decisions WHERE mode='live' AND asset=? AND tf=? AND as_of=? AND model_version=?",
                               (asset, tf, res["as_of"], version))
        if exists:
            return
        did = self.memory.record_decision(res, self.office.strategy)
        res["decision_id"] = did
        sec = TF_SECONDS[tf]
        exp = self.expiry.get(tf, 3)
        late = (not md.synthetic) and (time.time() - res["as_of"] > 0.35 * sec)
        plan = binary.plan_trade(res, md.base, tf, exp, params.payout, self.office.strategy)
        busy = self.memory.q("SELECT 1 FROM trades WHERE status='open' AND mode='live' AND asset=? AND tf=?", (asset, tf))
        if plan and not busy and not late:
            self.memory.open_trade(did, plan)
            res["paper_trade"] = "aberta"
        else:
            if plan and late:
                res["paper_trade"] = "não aberta: decisão tomada tarde demais em relação ao fechamento do candle"
            # decisão sem operação também é avaliada (qualidade de "não operar")
            self.memory.x("INSERT INTO trades(decision_id,run_id,mode,asset,tf,strategy,direction,entry_ts,expiry_ts,"
                          "payout,stake,hour,confluence,confluence_class,process_quality,synthetic,status)"
                          " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                          (did, self.memory.run_id, "live-shadow", asset, tf, self.office.strategy,
                           res["lean"], res["as_of"], res["as_of"] + exp * sec, params.payout, 0,
                           0, res["confluence"]["score"], res["confluence"]["classification"],
                           res["process"]["score"], int(res["synthetic"]), "open"))

    def chart(self, md: MarketData, res: dict, bars: int = 160) -> dict:
        cs = md.base[-bars:]
        rep = {r["agent"]: r for r in res["reports"]}
        ov = {"candles": [c.to_list() for c in cs]}
        vp = rep.get("VP", {}).get("data", {})
        ov["poc"], ov["vah"], ov["val"] = vp.get("poc"), vp.get("vah"), vp.get("val")
        ov["zones"] = rep.get("SR", {}).get("data", {}).get("zones", [])
        ov["pools"] = rep.get("LIQ", {}).get("data", {}).get("pools", [])
        ov["fvg"] = rep.get("PA", {}).get("data", {}).get("fvg", [])
        ov["order_blocks"] = rep.get("PA", {}).get("data", {}).get("order_blocks", [])
        fib = rep.get("FIB", {}).get("data", {}).get("categories", {}) or {}
        ov["fib"] = {k: v for k, v in fib.items() if v}
        return ov

    def overview(self, tf: Optional[str] = None) -> list[dict]:
        tf = tf or self.base_tf
        out = []
        for a in ASSETS:
            r = self.analyze(a, tf)
            if "error" in r:
                out.append({"asset": a, "label": asset_label(a), "error": r["error"]})
                continue
            mtf = next((x for x in r["reports"] if x["agent"] == "MTF"), {})
            tmap = mtf.get("data", {}).get("map", {})
            cs = r["chart"]["candles"]
            day = 86400 // TF_SECONDS[tf] + 1
            chg = (cs[-1][4] / cs[-day][4] - 1) * 100 if len(cs) > day else None
            out.append({"asset": a, "label": asset_label(a), "price": r["price"], "change_24h": chg,
                        "decision": r["decision"], "confluence": r["confluence"]["score"],
                        "class": r["confluence"]["classification"], "lean": r["lean"],
                        "trend": {t: (tmap.get(t) or {}).get("label") for t in ("D1", "H4", "H1", "M15", "M5", "M1")},
                        "as_of": r["as_of_label"], "synthetic": r["synthetic"]})
        return out

    def scan(self, tf: Optional[str] = None) -> dict:
        """Visão simultânea dos 8 pares (mini-gráfico, decisão, viés de cada agente, operação simulada)."""
        tf = tf or self.base_tf
        cards = []
        open_trades = {(t["asset"], t["tf"]): dict(t) for t in
                       self.memory.q("SELECT * FROM trades WHERE status='open' AND mode='live'")}
        for a in ASSETS:
            r = self.analyze(a, tf)
            if "error" in r:
                cards.append({"asset": a, "label": asset_label(a), "error": r["error"]})
                continue
            last = self.memory.q("SELECT result FROM trades WHERE mode='live' AND asset=? AND tf=? AND status='closed' "
                                 "ORDER BY id DESC LIMIT 5", (a, tf))
            ot = open_trades.get((a, tf))
            cards.append({
                "asset": a, "label": asset_label(a), "price": r["price"], "as_of": r["as_of_label"],
                "decision": r["decision"], "reason": r["reason"], "lean": r["lean"],
                "confluence": r["confluence"]["score"], "class": r["confluence"]["classification"],
                "agreeing": r["confluence"]["agreeing_groups"], "news_avoid": r["news_avoid"],
                "candles": r["chart"]["candles"][-70:],
                "votes": [{"code": x["agent"], "bias": x["bias"], "conf": x["confidence"], "abstain": x["abstain"]}
                          for x in r["reports"]],
                "open_trade": {"direction": ot["direction"], "entry_ts": ot["entry_ts"], "expiry_ts": ot["expiry_ts"]} if ot else None,
                "recent": [x["result"] for x in last],
            })
        return {"tf": tf, "expiry_bars": self.expiry.get(tf, 3), "cards": cards}

    # ------------------------------------------------------------------ treino automático
    def start_autopilot(self, interval: float = 5.0) -> None:
        """Analisa todos os pares em todas as TFs ativas continuamente (operações apenas simuladas)."""
        if self.autopilot["running"]:
            return

        def loop():
            self.autopilot["running"] = True
            while self.autopilot["running"]:
                for tf in list(self.tfs):
                    for a in ASSETS:
                        try:
                            self.analyze(a, tf)
                        except Exception as e:  # pragma: no cover
                            self.autopilot["errors"] = (self.autopilot["errors"] + [f"{a} {tf}: {e!r}"])[-10:]
                self.autopilot["cycles"] += 1
                self.autopilot["last"] = fmt_ts(int(time.time()))
                time.sleep(interval)

        threading.Thread(target=loop, daemon=True).start()

    def settings(self, body: dict) -> dict:
        for tf, n in (body.get("expiry") or {}).items():
            if tf in TF_SECONDS and 1 <= int(n) <= 60:
                self.expiry[tf] = int(n)
        if body.get("tfs"):
            self.tfs = [t for t in body["tfs"] if t in TF_SECONDS] or self.tfs
        return {"tfs": self.tfs, "expiry": self.expiry}

    # ------------------------------------------------------------------ MT5
    def mt5_info(self) -> dict:
        from .data.mt5_indicators import load_overrides, load_selection
        p = self.provider
        if p.name != "mt5":
            return {"connected": False, "note": "O escritório não está conectado ao MetaTrader 5 (use INICIAR-MT5.bat)."}
        store, _ = p.indicator_store(ASSETS[0])
        stats = self.memory.agent_stats(mode="live")
        per_ind = {k.split(":", 1)[1]: {"n": v["n"], "hit_rate": v["hit_rate"], "ci": v["ci"]}
                   for k, v in stats.items() if k.startswith("MT5I:")}
        return {"connected": True, "broker": p.broker, "available": p.list_indicators(), "selected": load_selection(),
                "roles": load_overrides(), "exporter": store.status(), "exporter_install": p.exporter_note,
                "symbols": {a: p.symbol(a) for a in ASSETS}, "stats": per_ind}

    def mt5_select(self, names: list[str]) -> dict:
        from .data.mt5_indicators import save_config, write_exporter_config
        p = self.provider
        if p.name != "mt5":
            return {"error": "Não conectado ao MetaTrader 5."}
        names = [n for n in names if n in set(p.list_indicators())]
        save_config(names)
        syms = [p.symbol(a) for a in ASSETS if p.symbol(a)]
        write_exporter_config(p.export_dir, names, syms, sorted(set(self.tfs) | {"M1", "M5", "M15"},
                                                                    key=lambda t: TF_SECONDS[t]))
        return {"selected": names}

    # ------------------------------------------------------------------ simuladas
    def resolve_pending(self, asset: str, tf: str, md: MarketData) -> None:
        base = md.base
        open_ts = [c.ts for c in base]
        close_ts = [c.close_ts for c in base]
        rows = self.memory.q("SELECT * FROM trades WHERE status='open' AND asset=? AND tf=? AND mode IN ('live','live-shadow')",
                             (asset, tf))
        for t in rows:
            if t["expiry_ts"] > base[-1].close_ts:
                continue
            out = binary.settle(base, open_ts, close_ts, t["direction"] or 1, t["entry_ts"], t["expiry_ts"], t["payout"])
            decision = self.memory.decision_payload(t["decision_id"])
            if out is None or decision is None:
                if base[-1].close_ts - t["expiry_ts"] > 50 * TF_SECONDS[tf]:  # sem dados para resolver: descarta
                    self.memory.x("UPDATE trades SET status='void' WHERE id=?", (t["id"],))
                continue
            is_trade = t["mode"] == "live"
            rv = learning.review(self.memory, decision, t["decision_id"], t["id"] if is_trade else None, out, t["expiry_ts"])
            if is_trade:
                self.memory.close_trade(t["id"], out["entry_price"], out["exit_price"], out["result"], out["pnl"], rv)
            else:
                self.memory.x("UPDATE trades SET status='closed', entry_price=?, exit_price=?, review=? WHERE id=?",
                              (out["entry_price"], out["exit_price"], json.dumps(rv, ensure_ascii=False), t["id"]))

    def history(self) -> dict:
        trades = self.memory.trades(300, mode="live")
        closed = [t for t in trades if t["status"] == "closed"]
        m = backtest.compute_metrics([{**t, "review": t["review"] or {}} for t in closed], self.memory,
                                     self.memory.active_version()[1].payout) if closed else None
        if m:
            m.pop("agents", None)
            by_tf = {}
            for t in closed:
                d = by_tf.setdefault(t["tf"], {"n": 0, "wins": 0, "pnl": 0.0})
                d["n"] += 1
                d["wins"] += t["result"] == "WIN"
                d["pnl"] = round(d["pnl"] + (t["pnl"] or 0), 2)
            m["by_tf"] = by_tf
        return {"trades": trades, "metrics": m, "decisions": self.memory.decisions(60)}

    # ------------------------------------------------------------------ chat
    def chat(self, message: str) -> dict:
        txt = message.strip()
        up = txt.upper()
        asset = None
        for m in re.finditer(r"([A-Z]{3})\s*[/\-]?\s*([A-Z]{3})", up):
            asset = normalize_asset(m.group(1) + m.group(2))
            if asset:
                break
        if not asset:
            for k, v in ALIASES.items():
                if k in up and v:
                    asset = v
        H = "Head Trader"
        tf = self.base_tf
        m_tf = re.search(r"\b(M1|M5|M15|M30|H1)\b", up) or re.search(r"\b(1|5|15|30)\s*MIN", up)
        if m_tf:
            tf = m_tf.group(1) if m_tf.group(1).startswith(("M", "H")) else "M" + m_tf.group(1)
        if asset:
            res = self.analyze(asset, tf)
            if "error" in res:
                return {"reply": res["error"], "speaker": H, "transcript": []}
            c = res["confluence"]
            reply = [f"Consultei os especialistas sobre {asset_label(asset)} em {tf} (candles fechados até {res['as_of_label']}).",
                     f"Decisão coletiva: {res['decision']} — {res['reason']}",
                     f"Confluência {c['classification']} ({c['score']}/100; {c['agreeing_groups']} grupos independentes confirmam). "
                     f"{c['calibration']['note']}",
                     f"Qualidade do processo: {res['process']['label']} ({res['process']['score']:.2f})."]
            if res["divergences"]:
                d = res["divergences"][0]
                reply.append(f"Divergência principal: {d['a_name']} ({DIR_LABEL[d['a_bias']]}) × {d['b_name']} ({DIR_LABEL[d['b_bias']]}).")
            reply.append(f"Fonte dos dados: {res['source']}.")
            if res["synthetic"]:
                reply.append("⚠ Dados SINTÉTICOS: esta resposta demonstra o processo, não o mercado real.")
            reply.append("Lembrete: análise educacional; nenhuma operação real é executada e não há promessa de lucro.")
            return {"reply": "\n".join(reply), "speaker": H, "asset": asset, "transcript": res["transcript"], "analysis_asset": asset}
        if any(w in up for w in ("DESEMPENHO", "AGENTES", "ACERTO", "RANKING")):
            st = self.memory.agent_stats()
            if not st:
                return {"reply": "Ainda não há operações avaliadas para medir o desempenho dos agentes. "
                                 "Rode um backtest no Laboratório ou aguarde a expiração das simulações.", "speaker": H, "transcript": []}
            lines = [f"{k}: {v['hit_rate']:.1%} em {v['n']} avaliações (IC95% {v['ci'][0]:.0%}–{v['ci'][1]:.0%})"
                     for k, v in sorted(st.items(), key=lambda kv: -(kv[1]['hit_rate'] or 0))]
            return {"reply": "Desempenho direcional por agente (todas as execuções registradas):\n" + "\n".join(lines) +
                             "\nTaxas sem significância estatística não devem ser tratadas como vantagem.", "speaker": H, "transcript": []}
        if any(w in up for w in ("NOTÍCIA", "NOTICIA", "CALENDÁRIO", "CALENDARIO")):
            if not self.news.loaded:
                return {"reply": "Nenhum calendário econômico carregado. Não invento notícias: carregue data/news/*.json "
                                 "ou execute `python -m tio news --fetch`.", "speaker": H, "transcript": []}
            evs = self.news.events[-8:]
            return {"reply": "\n".join(f"{e.to_dict()['time_label']} · {e.currency} · {e.to_dict()['impact_label']} · {e.title} "
                                       f"(fonte: {e.source})" for e in evs), "speaker": H, "transcript": []}
        return {"reply": "Posso consolidar a visão do escritório sobre um ativo — por exemplo: “Qual é a situação do EUR/USD?”. "
                         "Ativos monitorados: " + ", ".join(asset_label(a) for a in ASSETS) +
                         ". Também respondo sobre “desempenho dos agentes” e “notícias”.", "speaker": H, "transcript": []}

    # ------------------------------------------------------------------ laboratório
    def start_job(self, kind: str, fn) -> str:
        import uuid
        jid = uuid.uuid4().hex[:10]
        self.jobs[jid] = {"id": jid, "kind": kind, "status": "running", "progress": [], "result": None, "error": None}

        def work():
            try:
                self.jobs[jid]["result"] = fn(lambda p: self.jobs[jid]["progress"].append(p))
                self.jobs[jid]["status"] = "done"
            except Exception as e:  # pragma: no cover
                self.jobs[jid]["status"] = "error"
                self.jobs[jid]["error"] = repr(e)

        threading.Thread(target=work, daemon=True).start()
        return jid

    def run_backtest(self, cfg: dict, progress=None) -> dict:
        assets = [a for a in cfg.get("assets") or ASSETS if a in ASSETS]
        tf = cfg.get("timeframe") or self.base_tf
        datasets = {a: self.data(a, tf) for a in assets}
        datasets = {a: d for a, d in datasets.items() if d}
        version, params = self.memory.active_version()
        agents = cfg.get("agents") or None
        bc = backtest.BTConfig(assets=list(datasets), timeframe=tf, strategy=cfg.get("strategy", "comite"),
                               agents=agents, expiry_bars=int(cfg.get("expiry_bars", 4)), step=int(cfg.get("step", 4)),
                               start_frac=float(cfg.get("start_frac", 0)), end_frac=float(cfg.get("end_frac", 1)),
                               payout=float(cfg["payout"]) if cfg.get("payout") else None,
                               debate=bool(cfg.get("debate", True)))
        if cfg.get("rsi_overbought"):
            params.rsi_overbought = float(cfg["rsi_overbought"])
            params.rsi_oversold = float(cfg.get("rsi_oversold", 100 - params.rsi_overbought))
        m = backtest.run(datasets, bc, params, self.news, version, progress=progress)
        self.memory.save_backtest(m["run_id"], bc.to_dict(), m, m["synthetic"])
        return m

    def learn(self, cfg: dict, progress=None) -> dict:
        assets = [a for a in cfg.get("assets") or ASSETS[:3] if a in ASSETS]
        tf = cfg.get("timeframe") or self.base_tf
        datasets = {a: self.data(a, tf) for a in assets}
        datasets = {a: d for a, d in datasets.items() if d}
        rep = backtest.improvement_cycle(datasets, self.memory, self.news, timeframe=tf, split=float(cfg.get("split", 0.7)),
                                         step=int(cfg.get("step", 6)), expiry_bars=int(cfg.get("expiry_bars", 4)),
                                         min_trades=int(cfg.get("min_trades", 30)),
                                         max_candidates=int(cfg.get("max_candidates", 4)), progress=progress)
        with self.lock:
            self._analysis.clear()
        return rep

    def memory_view(self) -> dict:
        return {"lessons": self.memory.lessons(80, mode=None), "versions": self.memory.versions(),
                "reports": self.memory.reports(20), "backtests": [{**b, "metrics": {k: v for k, v in b["metrics"].items()
                                                                                   if k not in ("trades", "equity")}}
                                                                  for b in self.memory.backtests(15)]}
