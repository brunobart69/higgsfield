"""SELF LEARNING INTELLIGENCE.

1. Verifica o resultado; 2. compara com a análise original; 3-4. identifica
agentes que acertaram/erraram; 5. investiga a falha; 6. identifica sinais
ignorados; 7. registra o aprendizado; 8. atualiza estatísticas; 9. testa
melhorias em dados históricos; 10. valida fora da amostra antes de incorporar.

Princípio: resultado ≠ qualidade. A avaliação separa PROCESSO de RESULTADO.
"""
from __future__ import annotations

from typing import Optional

from .models import DIR_LABEL, NEUTRAL

QUADRANTS = {
    ("BOM", "WIN"): ("decisao_correta", "Bom processo e resultado positivo: decisão consistente."),
    ("BOM", "LOSS"): ("variancia", "Bom processo com resultado negativo: variância esperada — não penalizar a metodologia isoladamente."),
    ("FRACO", "WIN"): ("sorte", "Processo fraco com resultado positivo: SORTE — não reforçar este comportamento."),
    ("FRACO", "LOSS"): ("erro_processo", "Processo fraco e resultado negativo: erro de processo a corrigir."),
}


def review(memory, decision: dict, decision_id: int, trade_id: Optional[int], outcome: dict, available_at: int) -> dict:
    actual = outcome["actual_dir"]
    right, wrong, ignored = [], [], []
    for r in decision["reports"]:
        if r["abstain"] or r["bias"] == NEUTRAL or actual == 0:
            correct = None
        else:
            correct = int(r["bias"] == actual)
        memory.record_agent_outcome(decision_id, trade_id or 0, r["agent"], decision["asset"], r["bias"],
                                    r["confidence"], correct, available_at)
        if r["agent"] == "MT5I" and actual:
            for ind_name, d in (r["data"].get("signals") or {}).items():  # desempenho por indicador do usuário
                memory.record_agent_outcome(decision_id, trade_id or 0, f"MT5I:{ind_name}", decision["asset"], d,
                                            0.5, int(d == actual), available_at)
        if correct is None:
            continue
        (right if correct else wrong).append(r["name"])
        for tag in r["data"].get("tags", []):
            memory.add_lesson(r["agent"], decision["asset"], tag, "acerto" if correct else "erro",
                              f"{r['name']}: viés {DIR_LABEL[r['bias']]} ({r['summary'][:140]}) — mercado foi "
                              f"{DIR_LABEL[actual]}.", decision_id, trade_id, available_at)
        if trade_id and not correct is None and correct and r["bias"] != decision["direction"]:
            top = max((e for e in r["evidence"] if e["direction"] == r["bias"]), key=lambda e: e["weight"] * e["quality"], default=None)
            ignored.append({"agent": r["name"], "evidence": top["description"] if top else r["summary"]})

    out = {"actual_dir": actual, "agents_right": right, "agents_wrong": wrong, "ignored_signals": ignored}
    if trade_id:
        pq = decision["process"]["label"]
        pq = "BOM" if pq == "BOM" else "FRACO"
        res = outcome["result"]
        if res == "TIE":
            out["quadrant"], out["explanation"] = "empate", "Empate: sem aprendizado de resultado."
        else:
            out["quadrant"], out["explanation"] = QUADRANTS[(pq, res)]
        if res == "LOSS":
            why = []
            if ignored:
                why.append("Sinais contrários subestimados: " + "; ".join(f"{i['agent']} ({i['evidence'][:90]})" for i in ignored[:3]))
            weak = [r for r in decision["confluence"]["criteria"] if r["status"] in ("neutro", "não avaliado")]
            if weak:
                why.append("Critérios sem confirmação: " + ", ".join(r["criterion"] for r in weak[:4]))
            out["investigation"] = why or ["Nenhuma falha de processo evidente: tratar como variância."]
            for i in ignored:
                memory.add_lesson("HEAD", decision["asset"], f"sinal_ignorado:{i['agent']}", "erro",
                                  f"Perda com sinal contrário de {i['agent']}: {i['evidence'][:160]}", decision_id, trade_id, available_at)
        memory.add_lesson("HEAD", decision["asset"], f"processo_{pq.lower()}", "acerto" if res == "WIN" else "erro",
                          out["explanation"], decision_id, trade_id, available_at)
    else:
        lean = decision.get("lean", 0)
        if lean and actual:
            would_win = lean == actual
            out["abstention"] = ("não operar evitou uma perda" if not would_win else
                                 "não operar deixou passar um movimento favorável (aceitável sem confirmação)")
            out["abstention_correct"] = not would_win
    return out
