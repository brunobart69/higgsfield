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
from .models import ASSETS, DIR_LABEL, TF_SECONDS, asset_label, fmt_ts, normalize_asset

ALIASES = {"EURO DOLAR": "EURUSD", "EURO DÓLAR": "EURUSD", "EURODOLAR": "EURUSD", "FIBER": "EURUSD",
           "CABLE": None, "IENE": "USDJPY", "LOONIE": "USDCAD", "GOPHER": "GBPJPY", "GUPPY": "GBPJPY"}


class OfficeService:
    def __init__(self, provider: Optional[Provider] = None, memory: Optional[Memory] = None, base_tf: str = "M15",
                 expiry_bars: int = 4, cache_ttl: int = 60):
        self.provider = provider or get_provider()
        self.memory = memory or Memory()
        self.news = NewsStore()
        self.base_tf = base_tf
        self.expiry_bars = expiry_bars
        self.cache_ttl = cache_ttl
        self._data: dict[str, tuple[float, MarketData]] = {}
        self._analysis: dict[tuple, dict] = {}
        self.lock = threading.RLock()
        self.office = Office()
        self.jobs: dict[str, dict] = {}

    # ------------------------------------------------------------------ dados
    def data(self, asset: str) -> Optional[MarketData]:
        with self.lock:
            hit = self._data.get(asset)
            if hit and time.time() - hit[0] < self.cache_ttl:
                return hit[1]
            md = MarketData.load(self.provider, asset, self.base_tf)
            if md is not None:
                self._data[asset] = (time.time(), md)
            return md

    def status(self) -> dict:
        md = self.data(ASSETS[0])
        version, params = self.memory.active_version()
        cov = self.news.coverage()
        return {"provider": self.provider.name, "source": md.source if md else None,
                "synthetic": bool(md and md.synthetic), "volume_kind": md.volume_kind if md else None,
                "base_tf": self.base_tf, "assets": ASSETS, "model_version": version,
                "news_loaded": self.news.loaded, "news_events": len(self.news.events),
                "news_coverage": [fmt_ts(cov[0]), fmt_ts(cov[1])] if cov else None,
                "last_candle": fmt_ts(md.base[-1].close_ts) if md else None, "payout": params.payout,
                "real_money": binary.REAL_MONEY_ENABLED,
                "strategies": list(STRATEGIES)}

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
    def analyze(self, asset: str, record: bool = True) -> dict:
        md = self.data(asset)
        if md is None:
            return {"error": f"Sem dados para {asset} na fonte '{self.provider.name}'."}
        version, params = self.memory.active_version()
        key = (asset, md.base[-1].close_ts, version)
        with self.lock:
            if key in self._analysis:
                return self._analysis[key]
            self.resolve_pending(asset, md)
            ctx = md.context(None, self.news, self.memory, params)
            res = self.office.meet(ctx, version)
            res["as_of_label"] = fmt_ts(res["as_of"])
            res["chart"] = self.chart(md, res)
            if record:
                exists = self.memory.q("SELECT id FROM decisions WHERE mode='live' AND asset=? AND as_of=? AND model_version=?",
                                       (asset, res["as_of"], version))
                if not exists:
                    did = self.memory.record_decision(res, self.office.strategy)
                    plan = binary.plan_trade(res, md.base, self.base_tf, self.expiry_bars, params.payout, self.office.strategy)
                    if plan and not self.memory.open_trades(asset):
                        self.memory.open_trade(did, plan)
                    elif not plan:
                        # decisão sem operação também é avaliada (qualidade de "não operar")
                        self.memory.x("INSERT INTO trades(decision_id,run_id,mode,asset,tf,strategy,direction,entry_ts,expiry_ts,"
                                      "payout,stake,hour,confluence,confluence_class,process_quality,synthetic,status)"
                                      " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                                      (did, self.memory.run_id, "live-shadow", asset, self.base_tf, self.office.strategy,
                                       res["lean"], res["as_of"], res["as_of"] + self.expiry_bars * TF_SECONDS[self.base_tf], params.payout, 0,
                                       0, res["confluence"]["score"], res["confluence"]["classification"],
                                       res["process"]["score"], int(res["synthetic"]), "open"))
                    res["decision_id"] = did
            self._analysis[key] = res
            return res

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

    def overview(self) -> list[dict]:
        out = []
        for a in ASSETS:
            r = self.analyze(a)
            if "error" in r:
                out.append({"asset": a, "label": asset_label(a), "error": r["error"]})
                continue
            mtf = next((x for x in r["reports"] if x["agent"] == "MTF"), {})
            tmap = mtf.get("data", {}).get("map", {})
            cs = r["chart"]["candles"]
            chg = (cs[-1][4] / cs[-97][4] - 1) * 100 if len(cs) > 97 else None
            out.append({"asset": a, "label": asset_label(a), "price": r["price"], "change_24h": chg,
                        "decision": r["decision"], "confluence": r["confluence"]["score"],
                        "class": r["confluence"]["classification"], "lean": r["lean"],
                        "trend": {tf: (tmap.get(tf) or {}).get("label") for tf in ("D1", "H4", "H1", "M15")},
                        "as_of": r["as_of_label"], "synthetic": r["synthetic"]})
        return out

    # ------------------------------------------------------------------ simuladas
    def resolve_pending(self, asset: str, md: MarketData) -> None:
        base = md.base
        open_ts = [c.ts for c in base]
        close_ts = [c.close_ts for c in base]
        rows = self.memory.q("SELECT * FROM trades WHERE status='open' AND asset=? AND mode IN ('live','live-shadow')", (asset,))
        for t in rows:
            if t["expiry_ts"] > base[-1].close_ts:
                continue
            out = binary.settle(base, open_ts, close_ts, t["direction"] or 1, t["entry_ts"], t["expiry_ts"], t["payout"])
            if out is None:
                continue
            decision = self.memory.decision_payload(t["decision_id"])
            if decision is None:
                continue
            is_trade = t["mode"] == "live"
            rv = learning.review(self.memory, decision, t["decision_id"], t["id"] if is_trade else None, out, t["expiry_ts"])
            if is_trade:
                self.memory.close_trade(t["id"], out["entry_price"], out["exit_price"], out["result"], out["pnl"], rv)
            else:
                self.memory.x("UPDATE trades SET status='closed', entry_price=?, exit_price=?, review=? WHERE id=?",
                              (out["entry_price"], out["exit_price"], json.dumps(rv, ensure_ascii=False), t["id"]))

    def history(self) -> dict:
        trades = self.memory.trades(200, mode="live")
        closed = [t for t in trades if t["status"] == "closed"]
        m = backtest.compute_metrics([{**t, "review": t["review"] or {}} for t in closed], self.memory, self.memory.active_version()[1].payout) if closed else None
        if m:
            m.pop("agents", None)
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
        if asset:
            res = self.analyze(asset)
            if "error" in res:
                return {"reply": res["error"], "speaker": H, "transcript": []}
            c = res["confluence"]
            reply = [f"Consultei os especialistas sobre {asset_label(asset)} (candles fechados até {res['as_of_label']}).",
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
        datasets = {a: self.data(a) for a in assets}
        datasets = {a: d for a, d in datasets.items() if d}
        version, params = self.memory.active_version()
        agents = cfg.get("agents") or None
        bc = backtest.BTConfig(assets=list(datasets), timeframe=self.base_tf, strategy=cfg.get("strategy", "comite"),
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
        datasets = {a: self.data(a) for a in assets}
        datasets = {a: d for a, d in datasets.items() if d}
        rep = backtest.improvement_cycle(datasets, self.memory, self.news, split=float(cfg.get("split", 0.7)),
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
