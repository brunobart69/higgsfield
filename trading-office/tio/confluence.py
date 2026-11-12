"""Sistema de pontuação de confluências.

A pontuação (0-100) mede quantos fatores INDEPENDENTES sustentam o cenário,
ponderados pela qualidade das evidências. Ela NÃO é probabilidade de acerto:
a relação pontuação → taxa de acerto só é exibida depois de calibrada por
backtesting com amostra mínima (ver `calibration`).
"""
from __future__ import annotations

from typing import Optional

from .indicators import wilson
from .models import BEAR, BULL, NEUTRAL, GROUPS, AgentReport

CRITERIA = [
    # (grupo, nome exibido, pontos máximos)
    ("trend", "Tendência alinhada", 18),
    ("structure", "Confirmação de Price Action", 15),
    ("liquidity", "Varredura / alvo de liquidez", 13),
    ("zones", "Região de suporte ou resistência", 12),
    ("trendline", "Linha de tendência (LTA/LTB)", 8),
    ("timing", "Timing M1 (pressão e espaço até a expiração)", 10),
    ("fib", "Retração Fibonacci", 10),
    ("reversal", "Exaustão / reversão confirmada", 10),
    ("momentum", "RSI", 8),
    ("volume", "Confirmação de volume", 8),
    ("profile", "POC / Volume Profile", 8),
    ("macro", "Contexto econômico favorável", 8),
    ("mt5", "Indicadores do usuário (MT5)", 8),
]
TOTAL_POINTS = sum(c[2] for c in CRITERIA if c[0] not in ("mt5", "timing"))  # opcional: não penaliza quem não usa


def group_strength(reports: list[AgentReport], weights: dict) -> dict[str, dict[int, tuple[float, str, str]]]:
    """Para cada grupo e direção: (força máxima ponderada, descrição, agente)."""
    out: dict[str, dict[int, tuple[float, str, str]]] = {}
    for r in reports:
        if r.abstain:
            continue
        w = max(0.0, min(1.5, weights.get(r.agent, 1.0)))
        # fator de confiança do agente após debate (revisões reduzem a força)
        conf_factor = 0.6 + 0.4 * min(1.0, r.confidence / 0.6) if r.bias != NEUTRAL else 0.7
        for e in r.evidence:
            if e.direction == NEUTRAL:
                continue
            s = min(1.0, e.strength * w * conf_factor / 0.75)  # normaliza: peso 0.75 × qualidade 1 = força plena
            g = out.setdefault(e.group, {})
            if s > g.get(e.direction, (0, "", ""))[0]:
                g[e.direction] = (s, e.description, r.name)
    return out


def score(reports: list[AgentReport], weights: dict, evaluated_groups: set[str], params) -> dict:
    gs = group_strength(reports, weights)
    net_dir = 0.0
    for grp, _, pts in CRITERIA:
        g = gs.get(grp, {})
        net_dir += pts * (g.get(BULL, (0,))[0] - g.get(BEAR, (0,))[0])
    direction = BULL if net_dir > 0.5 else BEAR if net_dir < -0.5 else NEUTRAL
    rows = []
    pts_for = pts_against = 0.0
    agreeing = 0
    for grp, label, pts in CRITERIA:
        if grp in ("mt5", "timing") and grp not in evaluated_groups:
            continue  # critério opcional: só aparece para quem exporta indicadores do MT5
        g = gs.get(grp, {})
        f = g.get(direction, (0.0, "", ""))[0] if direction else 0.0
        a = g.get(-direction, (0.0, "", ""))[0] if direction else 0.0
        status = "não avaliado" if grp not in evaluated_groups else (
            "confirma" if f >= 0.25 and f > a else "contra" if a >= 0.25 and a > f else "neutro")
        if status == "confirma":
            agreeing += 1
        pts_for += pts * f
        pts_against += pts * a
        rows.append({"group": grp, "criterion": label, "max": pts, "for": round(f, 2), "against": round(a, 2),
                     "points": round(pts * f - 0.75 * pts * a, 1), "status": status,
                     "evidence": (g.get(direction) or g.get(-direction) or (0, "", ""))[1] if direction else "",
                     "agent": (g.get(direction) or g.get(-direction) or (0, "", ""))[2] if direction else ""})
    total = max(0.0, min(100.0, 100 * (pts_for - 0.75 * pts_against) / TOTAL_POINTS * 1.6))
    conflict = pts_against / pts_for if pts_for else 1.0
    if direction == NEUTRAL:
        cls = "BAIXA"
    elif total >= params.confluence_high and agreeing >= params.min_independent_groups and conflict <= params.conflict_tolerance:
        cls = "ALTA"
    elif total >= params.confluence_medium and agreeing >= 2:
        cls = "MÉDIA"
    else:
        cls = "BAIXA"
    return {"direction": direction, "score": round(total, 1), "classification": cls, "agreeing_groups": agreeing,
            "conflict_ratio": round(conflict, 2), "criteria": rows,
            "not_evaluated": [GROUPS[g] for g in GROUPS if g not in evaluated_groups and g not in ("mt5", "timing")],
            "disclaimer": "Pontuação de confluência — NÃO é probabilidade de acerto."}


def calibration(memory, score_value: float, before: Optional[int], min_n: int, strategy: str = "comite") -> dict:
    """Taxa de acerto histórica de trades com pontuação na mesma faixa (somente passado)."""
    if memory is None:
        return {"calibrated": False, "note": "sem memória"}
    lo = int(score_value // 10) * 10
    sql = ("SELECT result FROM trades WHERE status='closed' AND result IN ('WIN','LOSS') AND confluence>=? AND confluence<?"
           " AND strategy=?")
    args: list = [lo, lo + 10, strategy]
    if before is not None:
        sql += " AND expiry_ts<=? AND run_id=?"
        args += [before, memory.run_id]
    rows = memory.q(sql, tuple(args))
    n = len(rows)
    w = sum(1 for r in rows if r["result"] == "WIN")
    ci = wilson(w, n)
    return {"bucket": f"{lo}-{lo + 10}", "n": n, "win_rate": (w / n) if n else None, "ci": ci,
            "calibrated": n >= min_n,
            "note": (f"Calibrado em {n} operações simuladas (IC95% {ci[0]:.0%}–{ci[1]:.0%})" if n >= min_n else
                     f"NÃO calibrado: {n} operações nesta faixa (mínimo {min_n}). Não exibir como probabilidade.")}
