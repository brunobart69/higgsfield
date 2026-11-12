"""Treinamento contínuo — os 10 ciclos.

1 Analisar dados históricos · 2 Identificar oportunidades hipotéticas · 3 Registrar entradas e
expirações simuladas · 4 Conferir resultados · 5 Investigar erros (Loss Analyzer) · 6 Debater os
erros · 7 Propor melhorias (regras de prevenção) · 8 Testar em dados NÃO usados · 9 Aprovar ou
rejeitar com teste estatístico · 10 Atualizar a memória coletiva.

Nenhuma melhoria é aprovada sem: (a) melhorar dentro da amostra, (b) melhorar fora da amostra com
amostra mínima e (c) passar no teste estatístico (bootstrap da diferença de expectativa, p < 0,10).
"""
from __future__ import annotations

import json
import random
from collections import Counter
from typing import Optional

from . import backtest
from .loss_analyzer import PREVENTION
from .memory import Memory
from .models import fmt_ts
from .params import ModelParams

STAGES = ["Analisar dados históricos", "Identificar oportunidades hipotéticas", "Registrar entradas e expirações simuladas",
          "Conferir os resultados", "Investigar os erros", "Debater os erros entre os agentes", "Propor melhorias",
          "Testar as melhorias em dados não utilizados", "Aprovar ou rejeitar as melhorias", "Atualizar a memória coletiva"]


def bootstrap_p(cand: list[float], base: list[float], iters: int = 3000, seed: int = 11) -> Optional[float]:
    """P(expectativa do candidato <= expectativa da base) por bootstrap independente."""
    if len(cand) < 5 or len(base) < 5:
        return None
    rnd = random.Random(seed)
    worse = 0
    for _ in range(iters):
        a = sum(rnd.choice(cand) for _ in cand) / len(cand)
        b = sum(rnd.choice(base) for _ in base) / len(base)
        worse += a <= b
    return worse / iters


def _summ(m: dict) -> dict:
    return {k: m.get(k) for k in ("total", "win_rate", "expectancy", "return", "max_drawdown", "p_value_vs_breakeven")} | \
        {"losses_investigated": (m.get("mistakes") or {}).get("total")}


def run_training(datasets: dict, memory: Memory, news=None, timeframe: str = "M1", split: float = 0.6, step: int = 2,
                 min_trades: int = 20, max_candidates: int = 4, rules: Optional[dict] = None, progress=None,
                 study_mode: bool = True) -> dict:
    stages = []

    def stage(i: int, text: str, data: Optional[dict] = None):
        stages.append({"n": i, "name": STAGES[i - 1], "text": text, "data": data or {}})
        if progress:
            progress(f"Ciclo {i}/10 · {STAGES[i - 1]}: {text}")

    version, params = memory.active_version()
    prod_params = params
    if study_mode:
        # MODO ESTUDO (amostra ampliada): cenários de confluência MÉDIA também viram tickets de estudo.
        # Base e candidatos são avaliados no MESMO regime; a regra aprovada é aplicada à versão de produção.
        params = params.copy()
        params.confluence_high = 30.0
        params.confluence_medium = min(params.confluence_medium, 25.0)
        params.min_independent_groups = max(2, params.min_independent_groups - 1)
    # ---------------------------------------------------------------- 1
    info = {a: {"bars_m1": len(d.tf.get("M1") or []), "from": fmt_ts(d.base[0].ts), "to": fmt_ts(d.base[-1].close_ts),
                "source": d.source} for a, d in datasets.items()}
    stage(1, ("Modo estudo (amostra ampliada: confluência MÉDIA também gera tickets de estudo). " if study_mode else "")
             + f"{len(datasets)} ativo(s), temporalidade de operação {timeframe}; dados divididos em "
             f"{int(split * 100)}% para estudo e {100 - int(split * 100)}% guardados para validação.", info)
    base_kw = dict(assets=list(datasets), timeframe=timeframe, step=step, rules=rules)
    ins_cfg = backtest.BTConfig(**base_kw, start_frac=0.0, end_frac=split)
    oos_cfg = backtest.BTConfig(**base_kw, start_frac=split, end_frac=1.0)
    ins_mem = Memory(":memory:", run_id="train-in", mode="training")
    base_in = backtest.run(datasets, ins_cfg, params, news, version, memory=ins_mem)
    # ---------------------------------------------------------------- 2 / 3 / 4
    dec = base_in["decisions"]
    stage(2, f"{base_in['steps']} reuniões; oportunidades com cenário: "
             f"{dec.get('CENÁRIO DE ALTA', 0) + dec.get('CENÁRIO DE BAIXA', 0)}; aguardar: {dec.get('AGUARDAR CONFIRMAÇÃO', 0)}; "
             f"sem oportunidade: {dec.get('SEM OPORTUNIDADE', 0)}.", {"decisions": dec})
    stage(3, f"{base_in['total']} tickets simulados (entrada e expiração conforme as regras da corretora: "
             f"{base_in['rules']['expiry_mode']}, preço {base_in['rules']['price_ref']}).", {"rules": base_in["rules"]})
    stage(4, f"Acerto {((base_in['win_rate'] or 0) * 100):.1f}% · expectativa {base_in['expectancy']} · "
             f"equilíbrio do payout {base_in['breakeven'] * 100:.1f}%.", _summ(base_in))
    # ---------------------------------------------------------------- 5 / 6
    mistakes = ins_mem.mistakes(2000)
    cats = Counter(c for m in mistakes for c in (m["categories"] or []))
    stage(5, f"{len(mistakes)} perdas investigadas; causas: " +
          (", ".join(f"{k} ({v})" for k, v in cats.most_common(6)) or "nenhuma perda"), {"categories": dict(cats)})
    debate = []
    for m in mistakes[:3]:
        debate.append({"asset": m["asset"], "entry": fmt_ts(m["entry_ts"]), "cause": m["cause"], "meeting": m["meeting"]})
    stage(6, f"{len(mistakes)} reuniões pós-LOSS realizadas; exemplos registrados para consulta.", {"examples": debate})
    # ---------------------------------------------------------------- 7
    candidates = []
    seen = set()
    for cat, _n in cats.most_common():
        if cat not in PREVENTION:
            continue
        changes, text = PREVENTION[cat]
        key = json.dumps(changes, sort_keys=True)
        if key in seen:
            continue
        seen.add(key)
        cp = params.copy()
        prod = prod_params.copy()
        if "__expiry__" in changes:
            prod.expiry_bars = 2 if timeframe in ("M1", "M5") else 1
            cp.expiry_bars = 2 if timeframe in ("M1", "M5") else 1
            text = f"{text} (teste: expiração de {cp.expiry_bars} velas)"
        else:
            for k, v in changes.items():
                setattr(cp, k, v)
                setattr(prod, k, v)
        candidates.append({"category": cat, "rule": text, "params": changes, "p": cp, "prod": prod})
        if len(candidates) >= max_candidates:
            break
    stage(7, f"{len(candidates)} regra(s) de prevenção propostas a partir das causas mais frequentes.",
          {"proposals": [{"category": c["category"], "rule": c["rule"]} for c in candidates]})
    # ---------------------------------------------------------------- 8 / 9
    base_out = backtest.run(datasets, oos_cfg, params, news, version, memory=Memory(":memory:", run_id="train-oos", mode="training"))
    base_out_pnl = [t["pnl"] for t in base_out.get("trades", [])]
    results = []
    best = None
    for c in candidates:
        ins = backtest.run(datasets, ins_cfg, c["p"], news, "candidato", memory=Memory(":memory:", run_id="c-in", mode="training"))
        entry = {"category": c["category"], "rule": c["rule"], "in_sample": _summ(ins), "baseline_in": _summ(base_in)}
        if (ins["expectancy"] if ins["total"] else -9) <= (base_in["expectancy"] if base_in["total"] else -9):
            entry.update(status="rejected", reason="Não melhorou nos dados de estudo.")
        else:
            oos = backtest.run(datasets, oos_cfg, c["p"], news, "candidato", memory=Memory(":memory:", run_id="c-oos", mode="training"))
            entry["out_sample"] = _summ(oos)
            pv = bootstrap_p([t["pnl"] for t in oos.get("trades", [])], base_out_pnl)
            entry["p_value"] = pv
            enough = oos["total"] >= min_trades and base_out["total"] >= min_trades
            better = (oos["expectancy"] or -9) > (base_out["expectancy"] or -9)
            if not enough:
                entry.update(status="rejected", reason=f"Amostra insuficiente fora da amostra ({oos['total']} e {base_out['total']} < {min_trades}).")
            elif not better:
                entry.update(status="rejected", reason="Piorou ou não melhorou nos dados não utilizados.")
            elif pv is None or pv >= 0.10:
                entry.update(status="rejected", reason=f"Melhora sem significância estatística (p = {pv}).")
            else:
                entry.update(status="approved", reason=f"Melhorou dentro e fora da amostra (p = {pv:.3f}).")
                if best is None or oos["expectancy"] > best[1]["out_sample"]["expectancy"]:
                    best = (c, entry)
        new_v = memory.next_version()
        memory.add_version(new_v, version, c["prod"], "rejected" if entry["status"] == "rejected" else "approved",
                           f"[Treino {timeframe}] {c['rule']}", entry["reason"], entry["in_sample"],
                           entry.get("out_sample") or {}, _summ(base_in), _summ(base_out))
        entry["version"] = new_v
        results.append(entry)
    stage(8, f"Base nos dados não utilizados: {base_out['total']} tickets, expectativa {base_out['expectancy']}; "
             f"{sum(1 for r in results if 'out_sample' in r)} candidato(s) testado(s).", {"baseline_out": _summ(base_out)})
    stage(9, ("Aprovada: " + best[1]["rule"]) if best else "Nenhuma melhoria aprovada (sem evidência estatística suficiente).",
          {"results": [{k: v for k, v in r.items() if k != "p"} for r in results]})
    # ---------------------------------------------------------------- 10
    saved = 0
    for m in mistakes:
        memory.add_mistake({k: m[k] for k in ("asset", "tf", "direction", "signal_ts", "entry_ts", "expiry_ts", "entry_price",
                                              "exit_price", "result", "hour", "condition", "categories", "cause", "evidence",
                                              "agents", "meeting", "learning", "prevention", "analysis", "available_at")}
                           | {"decision_id": None, "trade_id": None, "mode": "treinamento"})
        saved += 1
    if best:
        c, e = best
        memory.add_version(e["version"] + "-active", version, c["prod"], "active", f"[Treino {timeframe}] {c['rule']}",
                           "Promovida após validação fora da amostra e teste estatístico.", e["in_sample"], e["out_sample"],
                           _summ(base_in), _summ(base_out))
    stage(10, f"{saved} perdas gravadas no Trading Mistakes Database; "
              + (f"nova versão ativa {best[1]['version']}." if best else "metodologia mantida."), {})
    report = {"timeframe": timeframe, "stages": stages, "baseline_version": version, "promoted": best[1]["version"] if best else None,
              "ranking": base_in.get("ranking"), "synthetic": base_in["synthetic"], "mistakes_by_category": dict(cats),
              "study_mode": study_mode}
    memory.add_report("treinamento", f"Ciclo de treinamento {timeframe} sobre {version}", report)
    return report
