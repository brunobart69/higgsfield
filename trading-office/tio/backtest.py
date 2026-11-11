"""Laboratório de backtesting walk-forward (sem vazamento de informação futura).

Garantias anti-lookahead:
* a cada passo o contexto só contém candles com fechamento <= as_of;
* temporalidades maiores só incluem candles já FECHADOS em as_of;
* entrada = abertura do candle seguinte; resultado conhecido só na expiração;
* a memória (lições/estatísticas) é isolada por execução e consultada com
  available_at <= as_of; resultados só entram na memória após a expiração.
"""
from __future__ import annotations

import math
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

from . import binary, learning
from .context import MarketData
from .data.news import NewsStore
from .indicators import wilson
from .meeting import STRATEGIES, Office
from .memory import Memory
from .models import TF_SECONDS, asset_label
from .params import ModelParams


@dataclass
class BTConfig:
    assets: list[str]
    timeframe: str = "M15"
    strategy: str = "comite"
    agents: Optional[list[str]] = None
    expiry_bars: int = 4
    step: int = 4
    warmup: int = 450
    start_frac: float = 0.0
    end_frac: float = 1.0
    payout: Optional[float] = None
    debate: bool = True
    max_steps: Optional[int] = None

    def to_dict(self) -> dict:
        return self.__dict__.copy()


def run(datasets: dict[str, MarketData], cfg: BTConfig, params: ModelParams, news: Optional[NewsStore] = None,
        model_version: str = "v1.0", memory: Optional[Memory] = None, progress=None) -> dict:
    run_id = "bt-" + uuid.uuid4().hex[:8]
    mem = memory or Memory(":memory:", run_id=run_id, mode="backtest")
    mem.run_id, mem.mode = run_id, "backtest"
    p = params.copy()
    if cfg.payout is not None:
        p.payout = cfg.payout
    office = Office(agents=cfg.agents, strategy=cfg.strategy)
    trades: list[dict] = []
    decisions_count = defaultdict(int)
    abstentions = {"correct": 0, "total": 0}
    t0 = time.time()
    steps_done = 0
    for asset, data in datasets.items():
        base = data.base
        open_ts = [c.ts for c in base]
        close_ts = [c.close_ts for c in base]
        n = len(base)
        i0 = max(cfg.warmup, int(n * cfg.start_frac))
        i1 = min(n - cfg.expiry_bars - 1, int(n * cfg.end_frac))
        pending: list[dict] = []
        busy_until = 0
        for i in range(i0, i1, cfg.step):
            as_of = base[i].close_ts
            # 1) resolve pendências cuja expiração já ocorreu (conhecimento passa a existir agora)
            still = []
            for pd in pending:
                if pd["expiry_ts"] <= as_of:
                    out = binary.settle(base, open_ts, close_ts, pd["direction"] or pd["lean"] or 1, pd["entry_ts"],
                                        pd["expiry_ts"], p.payout)
                    if out is None:
                        continue
                    _resolve(mem, pd, out, trades, abstentions)
                else:
                    still.append(pd)
            pending = still
            # 2) reunião com dados até as_of
            ctx = data.context(as_of, news, mem, p)
            res = office.meet(ctx, model_version, debate=cfg.debate)
            decisions_count[res["decision"]] += 1
            did = mem.record_decision(res, office.strategy)
            plan = binary.plan_trade(res, base, cfg.timeframe, cfg.expiry_bars, p.payout, office.strategy)
            if plan and as_of >= busy_until:
                tid = mem.open_trade(did, plan)
                pending.append({**plan, "decision": res, "decision_id": did, "trade_id": tid, "lean": res["lean"]})
                busy_until = plan["expiry_ts"]
            else:
                expiry = as_of + cfg.expiry_bars * TF_SECONDS[cfg.timeframe]
                pending.append({"asset": asset, "direction": 0, "lean": res["lean"], "entry_ts": as_of, "expiry_ts": expiry,
                                "decision": res, "decision_id": did, "trade_id": None})
            steps_done += 1
            if progress and steps_done % 25 == 0:
                progress(steps_done)
            if cfg.max_steps and steps_done >= cfg.max_steps:
                break
        for pd in pending:  # resolve o que for possível no fim da série
            out = binary.settle(base, open_ts, close_ts, pd["direction"] or pd["lean"] or 1, pd["entry_ts"], pd["expiry_ts"], p.payout)
            if out:
                _resolve(mem, pd, out, trades, abstentions)
    metrics = compute_metrics(trades, mem, p.payout)
    metrics["decisions"] = dict(decisions_count)
    metrics["steps"] = steps_done
    metrics["abstention"] = {**abstentions, "rate": abstentions["correct"] / abstentions["total"] if abstentions["total"] else None}
    metrics["elapsed_s"] = round(time.time() - t0, 1)
    metrics["synthetic"] = any(d.synthetic for d in datasets.values())
    metrics["sources"] = sorted({d.source for d in datasets.values()})
    metrics["run_id"] = run_id
    metrics["model_version"] = model_version
    metrics["period"] = {a: [d.base[max(cfg.warmup, int(len(d.base) * cfg.start_frac))].ts,
                             d.base[min(len(d.base) - 1, int(len(d.base) * cfg.end_frac) - 1)].ts] for a, d in datasets.items()}
    return metrics


def _resolve(mem: Memory, pd: dict, out: dict, trades: list, abstentions: dict) -> None:
    rv = learning.review(mem, pd["decision"], pd["decision_id"], pd["trade_id"], out, pd["expiry_ts"])
    if pd["trade_id"]:
        mem.close_trade(pd["trade_id"], out["entry_price"], out["exit_price"], out["result"], out["pnl"], rv)
        trades.append({**{k: v for k, v in pd.items() if k != "decision"}, **out, "review": rv})
    elif "abstention_correct" in rv:
        abstentions["total"] += 1
        abstentions["correct"] += int(rv["abstention_correct"])


def compute_metrics(trades: list[dict], mem: Memory, payout: float) -> dict:
    trades = sorted(trades, key=lambda t: t["entry_ts"])
    n = len(trades)
    wins = sum(1 for t in trades if t["result"] == "WIN")
    losses = sum(1 for t in trades if t["result"] == "LOSS")
    ties = n - wins - losses
    pnl = [t["pnl"] for t in trades]
    eq, peak, dd = 0.0, 0.0, 0.0
    curve = []
    for t in trades:
        eq += t["pnl"]
        peak = max(peak, eq)
        dd = max(dd, peak - eq)
        curve.append([t["entry_ts"], round(eq, 2)])
    best_w = best_l = cur_w = cur_l = 0
    for t in trades:
        if t["result"] == "WIN":
            cur_w += 1
            cur_l = 0
        elif t["result"] == "LOSS":
            cur_l += 1
            cur_w = 0
        best_w, best_l = max(best_w, cur_w), max(best_l, cur_l)
    decided = wins + losses
    wr = wins / decided if decided else None
    breakeven = 1 / (1 + payout)
    # teste binomial (aprox. normal) contra o ponto de equilíbrio
    pval = None
    if decided >= 10:
        z = (wins - decided * breakeven) / math.sqrt(decided * breakeven * (1 - breakeven))
        pval = 0.5 * math.erfc(z / math.sqrt(2))

    def group(key):
        g = defaultdict(lambda: {"n": 0, "wins": 0, "pnl": 0.0})
        for t in trades:
            k = key(t)
            g[k]["n"] += 1
            g[k]["wins"] += t["result"] == "WIN"
            g[k]["pnl"] += t["pnl"]
        out = {}
        for k, v in sorted(g.items(), key=lambda kv: str(kv[0])):
            lo, hi = wilson(v["wins"], v["n"])
            out[str(k)] = {**v, "pnl": round(v["pnl"], 2), "win_rate": v["wins"] / v["n"] if v["n"] else None,
                           "ci": [round(lo, 3), round(hi, 3)], "expectancy": round(v["pnl"] / v["n"], 4) if v["n"] else None}
        return out

    agents = {}
    for code, s in mem.agent_stats().items():
        agents[code] = {"n": s["n"], "hits": s["hits"], "hit_rate": s["hit_rate"], "ci": [round(x, 3) for x in s["ci"]]}
    quad = defaultdict(int)
    for t in trades:
        quad[t["review"].get("quadrant", "?")] += 1
    return {
        "total": n, "wins": wins, "losses": losses, "ties": ties, "win_rate": wr,
        "loss_rate": losses / decided if decided else None, "return": round(sum(pnl), 2),
        "expectancy": round(sum(pnl) / n, 4) if n else None, "max_drawdown": round(dd, 2),
        "max_win_streak": best_w, "max_loss_streak": best_l, "breakeven": breakeven,
        "win_rate_ci": [round(x, 3) for x in wilson(wins, decided)] if decided else None,
        "p_value_vs_breakeven": round(pval, 4) if pval is not None else None,
        "significant": bool(pval is not None and pval < 0.05),
        "equity": curve, "by_asset": group(lambda t: asset_label(t["asset"])), "by_hour": group(lambda t: f"{t['hour']:02d}h"),
        "by_strategy": group(lambda t: t["strategy"]), "by_confluence": group(lambda t: f"{int(t['confluence'] // 10 * 10)}-{int(t['confluence'] // 10 * 10 + 10)}"),
        "by_direction": group(lambda t: "CALL (alta)" if t["direction"] == 1 else "PUT (baixa)"),
        "agents": agents, "quadrants": dict(quad),
        "trades": [{k: t[k] for k in ("asset", "direction", "entry_ts", "expiry_ts", "entry_price", "exit_price",
                                      "result", "pnl", "confluence", "process_quality")} | {"quadrant": t["review"].get("quadrant")}
                   for t in trades[-300:]],
    }


# --------------------------------------------------------------------------- #
# Ciclo de melhoria com validação fora da amostra
# --------------------------------------------------------------------------- #
def improvement_cycle(datasets: dict[str, MarketData], memory: Memory, news: Optional[NewsStore] = None,
                      split: float = 0.7, step: int = 6, expiry_bars: int = 4, min_trades: int = 30,
                      max_candidates: int = 4, progress=None) -> dict:
    version, params = memory.active_version()
    base_cfg = dict(assets=list(datasets), step=step, expiry_bars=expiry_bars)
    ins_cfg = BTConfig(**base_cfg, start_frac=0.0, end_frac=split)
    oos_cfg = BTConfig(**base_cfg, start_frac=split, end_frac=1.0)
    log = []

    def bt(cfg, prm, label):
        m = run(datasets, cfg, prm, news, label)
        if progress:
            progress(f"{label}: {m['total']} operações, expectativa {m['expectancy']}")
        return m

    base_in = bt(ins_cfg, params, version)
    base_out = bt(oos_cfg, params, version)

    candidates = []
    # (a) re-ponderação dos agentes pela taxa de acerto IN-SAMPLE (com encolhimento bayesiano)
    w = dict(params.agent_weights)
    for code, s in base_in["agents"].items():
        if s["n"] and s["hit_rate"] is not None:
            shrink = s["n"] / (s["n"] + 80)
            w[code] = round(max(0.5, min(1.5, 1 + (s["hit_rate"] - 0.5) * 4 * shrink)), 3)
    cp = params.copy()
    cp.agent_weights = w
    candidates.append(("Re-ponderação dos agentes pela confiabilidade in-sample", cp))
    cp = params.copy(); cp.confluence_high = params.confluence_high + 6
    candidates.append((f"Limiar de confluência ALTA {params.confluence_high:.0f} → {cp.confluence_high:.0f}", cp))
    cp = params.copy(); cp.confluence_high = params.confluence_high - 6
    candidates.append((f"Limiar de confluência ALTA {params.confluence_high:.0f} → {cp.confluence_high:.0f}", cp))
    cp = params.copy(); cp.lesson_penalty = 0.3
    candidates.append(("Ativar penalidade de confiança por lições recorrentes (30%)", cp))
    cp = params.copy(); cp.rsi_overbought, cp.rsi_oversold = 75.0, 25.0
    candidates.append(("RSI extremos 80/20 → 75/25", cp))
    candidates = candidates[:max_candidates]

    results = []
    accepted = None
    for desc, cp in candidates:
        if cp.fingerprint() == params.fingerprint():
            continue
        ins = bt(ins_cfg, cp, "candidato")
        entry = {"change": desc, "in_sample": _summ(ins), "baseline_in": _summ(base_in)}
        ok_in = ins["total"] >= min_trades and (ins["expectancy"] or -9) > (base_in["expectancy"] or -9)
        if not ok_in:
            entry.update(status="rejected", reason="Não melhorou dentro da amostra (ou amostra insuficiente).")
            oos = None
        else:
            oos = bt(oos_cfg, cp, "candidato")
            entry["out_sample"] = _summ(oos)
            better = (oos["expectancy"] or -9) > (base_out["expectancy"] or -9)
            enough = oos["total"] >= min_trades
            if better and enough:
                entry.update(status="approved", reason="Melhorou dentro E fora da amostra com amostra mínima.")
            else:
                entry.update(status="rejected", reason="Piorou ou não melhorou fora da amostra" if enough else
                             f"Amostra fora da amostra insuficiente ({oos['total']} < {min_trades}).")
        new_v = memory.next_version()
        memory.add_version(new_v, version, cp, "rejected" if entry["status"] == "rejected" else "approved", desc,
                           entry["reason"], _summ(ins), _summ(oos) if oos else {}, _summ(base_in), _summ(base_out))
        entry["version"] = new_v
        results.append(entry)
        if entry["status"] == "approved" and (accepted is None or entry["out_sample"]["expectancy"] > accepted[1]["out_sample"]["expectancy"]):
            accepted = (cp, entry)
    if accepted:
        cp, entry = accepted
        memory.add_version(entry["version"] + "-active", version, cp, "active", entry["change"],
                           "Promovida após validação fora da amostra.", entry["in_sample"], entry["out_sample"],
                           _summ(base_in), _summ(base_out))
    report = {"baseline_version": version, "baseline_in": _summ(base_in), "baseline_out": _summ(base_out),
              "candidates": results, "promoted": accepted[1]["version"] if accepted else None,
              "synthetic": base_in["synthetic"], "split": split,
              "note": "Melhorias só são incorporadas se superarem a versão ativa FORA da amostra."}
    memory.add_report("evolucao", f"Ciclo de aprendizado sobre {version}", report)
    return report


def _summ(m: Optional[dict]) -> dict:
    if not m:
        return {}
    return {k: m.get(k) for k in ("total", "win_rate", "expectancy", "return", "max_drawdown", "p_value_vs_breakeven")}
