"""Ranking individual dos agentes: qualidade e consistência, não quantidade de vitórias.

Ordenação pelo limite inferior do IC95% (Wilson) da taxa de acerto direcional, combinado com o
Brier skill (calibração da confiança). Agentes com menos de 30 avaliações ficam marcados como
"amostra insuficiente" e vão para o fim da lista.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Optional

from .indicators import wilson


def ranking(memory, mode: Optional[str] = None, min_n: int = 30) -> list[dict]:
    sql = ("SELECT agent, asset, tf, condition, confidence, correct FROM agent_outcomes WHERE correct IS NOT NULL "
           "AND run_id=?" + (" AND mode=?" if mode else ""))
    args = (memory.run_id, mode) if mode else (memory.run_id,)
    if mode == "live":
        sql = "SELECT agent, asset, tf, condition, confidence, correct FROM agent_outcomes WHERE correct IS NOT NULL AND mode='live'"
        args = ()
    agg: dict = defaultdict(lambda: {"n": 0, "hits": 0, "brier": 0.0, "tf": defaultdict(lambda: [0, 0]),
                                     "asset": defaultdict(lambda: [0, 0]), "cond": defaultdict(lambda: [0, 0])})
    for r in memory.q(sql, args):
        if ":" in r["agent"]:
            continue
        a = agg[r["agent"]]
        c = int(r["correct"])
        prob = 0.5 + 0.45 * min(1.0, float(r["confidence"] or 0))   # probabilidade implícita de acerto
        a["n"] += 1
        a["hits"] += c
        a["brier"] += (prob - c) ** 2
        for k, key in (("tf", r["tf"]), ("asset", r["asset"]), ("cond", r["condition"])):
            if key:
                a[k][key][0] += c
                a[k][key][1] += 1
    out = []
    for code, a in agg.items():
        n = a["n"]
        lo, hi = wilson(a["hits"], n)
        brier = a["brier"] / n
        skill = 1 - brier / 0.25
        quality = 0.7 * lo + 0.3 * (0.5 + skill / 2)
        rate = lambda d: {k: {"n": v[1], "hit_rate": v[0] / v[1]} for k, v in d.items()}
        out.append({"agent": code, "n": n, "hits": a["hits"], "errors": n - a["hits"], "hit_rate": a["hits"] / n,
                    "ci": [round(lo, 3), round(hi, 3)], "brier": round(brier, 4), "brier_skill": round(skill, 3),
                    "quality": round(quality, 4), "enough": n >= min_n,
                    "by_tf": rate(a["tf"]), "by_asset": rate(a["asset"]), "by_condition": rate(a["cond"])})
    out.sort(key=lambda x: (not x["enough"], -x["quality"]))
    for i, x in enumerate(out, 1):
        x["rank"] = i
    return out
