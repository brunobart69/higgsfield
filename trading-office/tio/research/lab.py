"""Laboratório de pesquisa: transforma ideias (de vídeos, artigos ou do usuário) em hipóteses testáveis.

Um indicador só é APROVADO para uso nas reuniões se:
* acertar acima do ponto de equilíbrio do payout nos dados de estudo (in-sample) E nos dados guardados (out-of-sample);
* tiver pelo menos `min_signals` sinais fora da amostra;
* passar no teste binomial unilateral contra o ponto de equilíbrio fora da amostra (p < 0,10).
Caso contrário fica REJEITADO ou INCONCLUSIVO — e o motivo é registrado.
"""
from __future__ import annotations

import math
from typing import Optional

from ..indicators import wilson
from .indicators_lab import CATALOG, describe, signals


def evaluate(key: str, params: dict, candles_by_asset: dict, payout: float = 0.8, split: float = 0.6,
             min_signals: int = 30) -> dict:
    """Sinal na vela i ⇒ ticket na vela i+1 (entrada na abertura, expira no fechamento dela)."""
    be = 1 / (1 + payout)
    agg = {"in": [0, 0], "out": [0, 0]}
    per_asset = {}
    for asset, cs in candles_by_asset.items():
        if len(cs) < 200:
            continue
        sig = signals(key, cs, params)
        cut = int(len(cs) * split)
        w = {"in": [0, 0], "out": [0, 0]}
        for i in range(60, len(cs) - 1):
            s = sig[i]
            if not s:
                continue
            nxt = cs[i + 1]
            if nxt.close == nxt.open:
                continue
            win = (nxt.close - nxt.open) * s > 0
            part = "in" if i + 1 < cut else "out"
            w[part][0] += win
            w[part][1] += 1
        per_asset[asset] = {k: {"wins": v[0], "n": v[1], "rate": v[0] / v[1] if v[1] else None} for k, v in w.items()}
        for part in ("in", "out"):
            agg[part][0] += w[part][0]
            agg[part][1] += w[part][1]

    def stats(w, n):
        lo, hi = wilson(w, n)
        p = None
        if n >= 10:
            z = (w - n * be) / math.sqrt(n * be * (1 - be))
            p = 0.5 * math.erfc(z / math.sqrt(2))
        return {"wins": w, "n": n, "rate": (w / n) if n else None, "ci": [round(lo, 3), round(hi, 3)],
                "p_value": round(p, 4) if p is not None else None,
                "expectancy": round((w * payout - (n - w)) / n, 4) if n else None}

    ins, oos = stats(*agg["in"]), stats(*agg["out"])
    if oos["n"] < min_signals or ins["n"] < min_signals:
        status, reason = "inconclusivo", f"poucos sinais (estudo {ins['n']}, validação {oos['n']}; mínimo {min_signals})"
    elif (ins["rate"] or 0) <= be:
        status, reason = "rejeitado", f"abaixo do ponto de equilíbrio ({be:.1%}) nos dados de estudo"
    elif (oos["rate"] or 0) <= be:
        status, reason = "rejeitado", f"bom no estudo, mas abaixo do equilíbrio nos dados guardados (sobreajuste)"
    elif oos["p_value"] is None or oos["p_value"] >= 0.10:
        status, reason = "inconclusivo", f"acima do equilíbrio sem significância estatística (p = {oos['p_value']})"
    else:
        status, reason = "aprovado", f"acima do equilíbrio dentro e fora da amostra (p = {oos['p_value']})"
    return {"key": key, "name": CATALOG[key]["name"], "label": describe(key, params), "params": params,
            "rule": CATALOG[key]["rule"], "in_sample": ins, "out_sample": oos, "breakeven": be, "status": status,
            "reason": reason, "per_asset": per_asset}


def research_plan(mentions: list[dict], tested: set, limit: int = 12) -> list[tuple[str, dict]]:
    """Ordem de teste: indicadores mais citados primeiro, depois o restante do catálogo."""
    from collections import Counter
    import json
    cnt = Counter(json.dumps([m["key"], m.get("params") or {}], sort_keys=True) for m in mentions)
    plan = []
    for k, _ in cnt.most_common():
        key, params = json.loads(k)
        if (key, json.dumps(params, sort_keys=True)) not in tested:
            plan.append((key, params))
    for key in CATALOG:
        if (key, "{}") not in tested and (key, {}) not in plan:
            plan.append((key, {}))
    seen, out = set(), []
    for key, params in plan:
        sig = (key, json.dumps(params, sort_keys=True))
        if sig in seen:
            continue
        seen.add(sig)
        out.append((key, params))
    return out[:limit]
