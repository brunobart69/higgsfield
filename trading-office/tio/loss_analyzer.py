"""LOSS ANALYZER — investigação obrigatória de toda operação simulada perdida.

Não basta registrar que perdeu: o objetivo é descobrir POR QUE perdeu. A investigação
reconstrói o mercado no instante da entrada (somente dados até o sinal), compara com o
que aconteceu entre a entrada e a expiração (e logo depois), classifica as causas em 16
categorias, convoca os agentes envolvidos para uma reunião pós-LOSS e propõe uma regra de
prevenção — que só será adotada se for validada fora da amostra pelo ciclo de treinamento.
"""
from __future__ import annotations

from typing import Optional

from .models import DIR_LABEL, TF_SECONDS, fmt_ts
from .params import ModelParams

CATEGORIES = [
    "Entrada antecipada", "Entrada atrasada", "Falsa reversão", "Falso rompimento", "Varredura de liquidez",
    "Tendência mal identificada", "Retração mal identificada", "Volume insuficiente", "Exaustão do movimento",
    "Região de consolidação", "Notícia de impacto", "Fibonacci mal aplicado", "Suporte ou resistência mal identificado",
    "Expiração inadequada", "Conflito entre temporalidades", "Dados insuficientes",
]

# categoria -> (parâmetros da regra de prevenção, texto da regra)
PREVENTION = {
    "Entrada antecipada": ({"require_lower_tf_confirmation": True}, "Exigir pressão M1 a favor antes de entrar."),
    "Entrada atrasada": ({"max_premove_atr": 0.8}, "Não entrar se o preço já percorreu mais de 0,8 ATR M1 desde o sinal."),
    "Falsa reversão": ({"reversal_requires_choch": True}, "Reversão só com CHOCH confirmado por fechamento."),
    "Falso rompimento": ({"breakout_confirm_closes": 2}, "Rompimento só vale com 2 fechamentos além do nível."),
    "Varredura de liquidez": ({"liquidity_buffer_atr": 0.6}, "Não entrar com liquidez não varrida contra a entrada a menos de 0,6 ATR."),
    "Tendência mal identificada": ({"require_htf_alignment": True}, "Não operar contra a tendência da temporalidade de contexto."),
    "Retração mal identificada": ({"require_htf_alignment": True, "reversal_requires_choch": True},
                                  "Retração só com tendência de contexto a favor; reversão exige CHOCH."),
    "Volume insuficiente": ({"min_volume_ratio": 0.9}, "Exigir volume ≥ 0,9× a média quando houver volume."),
    "Exaustão do movimento": ({"block_exhaustion_rsi": 72.0}, "Não entrar a favor com RSI M1 ≥ 72 (CALL) / ≤ 28 (PUT)."),
    "Região de consolidação": ({"block_consolidation": True}, "Não operar em consolidação."),
    "Notícia de impacto": ({"news_block_before_min": 45, "news_block_after_min": 60}, "Ampliar o bloqueio em torno de notícias."),
    "Fibonacci mal aplicado": ({"fib_requires_reaction": True}, "Fibonacci só com reação de preço confirmada no nível."),
    "Suporte ou resistência mal identificado": ({"sr_min_reactions": 2}, "Usar só zonas S/R com ≥ 2 reações confirmadas."),
    "Expiração inadequada": ({"__expiry__": True}, "Testar outra expiração (fechamento da vela × N velas)."),
    "Conflito entre temporalidades": ({"require_htf_alignment": True, "require_lower_tf_confirmation": True},
                                      "Exigir M5 e M1 alinhados."),
    "Dados insuficientes": ({"min_active_agents": 9}, "Exigir pelo menos 9 agentes com dados."),
}


def _rep(decision: dict, code: str) -> dict:
    return next((r for r in decision["reports"] if r["agent"] == code), {"data": {}, "evidence": [], "warnings": [],
                                                                          "abstain": True, "bias": 0, "name": code})


def _supports(decision: dict, d: int, group: Optional[str] = None, kinds: tuple = ()) -> list[dict]:
    out = []
    for r in decision["reports"]:
        for e in r["evidence"]:
            if e["direction"] == d and (group is None or e["group"] == group) and (not kinds or e["kind"] in kinds):
                out.append({**e, "agent": r["agent"], "agent_name": r["name"]})
    return out


def investigate(decision: dict, ticket: dict, outcome: dict, md, news=None) -> dict:
    """Investigação completa (passos 1–15). `md` = MarketData com histórico (o instante da entrada é reconstruído)."""
    d = ticket["direction"]
    tf = ticket["tf"]
    as_of = decision["as_of"]
    side = "CALL" if d > 0 else "PUT"
    ctx = md.context(as_of, None, None, ModelParams(), focus_tf=tf)        # 1. gráfico no instante da entrada
    m1 = ctx.candles("M1") or ctx.candles(tf) or []
    a1 = ctx.atr("M1") or ctx.atr(tf) or 1e-9
    snapshot = [c.to_list() for c in m1[-20:]]                               # 2. candles anteriores
    mtf = _rep(decision, "MTF")["data"].get("map") or {}
    trends = {t: (mtf.get(t) or {}).get("label", "sem dados") for t in ("M1", "M5", "H1", "H4")}   # 4.
    found: list[dict] = []

    def add(cat, evidence, agents):
        found.append({"category": cat, "evidence": evidence, "agents": agents})

    entry, exit_ = outcome["entry_price"], outcome["exit_price"]
    mfe, mae, post = outcome.get("mfe") or 0.0, outcome.get("mae") or 0.0, outcome.get("post_move")
    # 11. entrada atrasada
    delay = ticket["entry_ts"] - as_of
    pre = (entry - (m1[-3].open if len(m1) >= 3 else entry)) * d / a1
    if delay > 0.35 * TF_SECONDS[tf] or pre > 1.0:
        add("Entrada atrasada", f"Entrada {delay}s após o sinal; o preço já tinha andado {pre:.1f} ATR M1 a favor antes da entrada.",
            ["TIM", "HEAD"])
    # entrada antecipada / expiração inadequada (comportamento entre entrada e expiração)
    if post is not None and post > 0.5 * a1:
        add("Entrada antecipada", f"Depois da expiração o preço andou {post / a1:.1f} ATR na direção do {side}: "
                                  "direção certa, momento errado.", ["TIM", "REV", "HEAD"])
    if mfe > 0.35 * a1:
        add("Expiração inadequada", f"O {side} chegou a ficar {mfe / a1:.1f} ATR M1 a favor antes de virar; a expiração "
                                    "não capturou o movimento.", ["TIM", "HEAD"])
    # 12. contra a tendência / 4. tendência
    ctx_tf = "M5" if tf == "M1" else "H1"
    ctx_trend = (mtf.get(ctx_tf) or {}).get("trend")
    if ctx_trend == -d:
        add("Tendência mal identificada", f"A tendência {ctx_tf} estava {trends.get(ctx_tf)}; o {side} foi contra a estrutura predominante.",
            ["MTF", "HEAD"])
    m1t, m5t = (mtf.get("M1") or {}).get("trend"), (mtf.get("M5") or {}).get("trend")
    tfc = decision.get("tf_compare") or {}
    if (m1t and m5t and m1t == -m5t) or (tfc.get("applies") and not tfc.get("ok")):
        add("Conflito entre temporalidades", f"M1 {trends['M1']} × M5 {trends['M5']} no momento da entrada.", ["MTF", "TIM", "HEAD"])
    # 3. condição de mercado
    if decision.get("condition") == "consolidação" or (_rep(decision, "PA")["data"].get("efficiency") or 1) < 0.15:
        add("Região de consolidação", f"Mercado em consolidação no {tf} (eficiência direcional "
                                      f"{_rep(decision, 'PA')['data'].get('efficiency')}).", ["PA", "MTF", "SR"])
    # 5–6. liquidez e varredura
    pools = _rep(decision, "LIQ")["data"].get("pools") or []
    against = [p for p in pools if p.get("dist_atr") is not None and p["dist_atr"] * d < 0 and abs(p["dist_atr"]) < 1.5]
    inside = md.closed("M1", ticket["expiry_ts"]) if "M1" in md.tf else None
    swept = []
    if against and inside:
        for p in against:
            if any((c.low < p["price"] if d > 0 else c.high > p["price"]) for c in inside if ticket["entry_ts"] <= c.ts < ticket["expiry_ts"]):
                swept.append(p)
    if swept:
        p = swept[0]
        add("Varredura de liquidez", f"Havia {p['kind']} {p['side']} em {p['price']:.5g} ({abs(p['dist_atr'])} ATR contra a entrada); "
                                     "o preço buscou essa liquidez durante a operação.", ["LIQ"])
    # rompimento falso / reversão falsa / retração
    if _supports(decision, d, kinds=("breakout", "breakdown", "tl_break")) and outcome["actual_dir"] == -d:
        add("Falso rompimento", "A decisão usou um rompimento que não se sustentou até a expiração.", ["SR", "TL", "PA"])
    if _supports(decision, d, group="reversal") and outcome["actual_dir"] == -d:
        add("Falsa reversão", "A leitura de reversão não se confirmou: a tendência anterior continuou.", ["REV", "VOL"])
    if _supports(decision, d, kinds=("healthy_retracement", "deep_retracement")) and outcome["actual_dir"] == -d:
        add("Retração mal identificada", "A 'retração saudável' virou movimento contra a perna original.", ["RET"])
    # 7–8. S/R e Fibonacci
    if _supports(decision, d, group="zones") and outcome["actual_dir"] == -d:
        add("Suporte ou resistência mal identificado", "A zona usada como apoio foi atravessada até a expiração.", ["SR"])
    if _supports(decision, d, group="fib") and outcome["actual_dir"] == -d:
        add("Fibonacci mal aplicado", "O nível de Fibonacci usado não segurou o preço.", ["FIB"])
    # 9. RSI e volume
    vol = _rep(decision, "VOL")["data"]
    if vol.get("volume_ratio") is not None and vol["volume_ratio"] < 0.85:
        add("Volume insuficiente", f"Volume {vol['volume_ratio']}× a média no sinal.", ["VOL"])
    rsi = ctx.rsi("M1")[-1] if ctx.enough("M1", 30) else vol.get("rsi")
    if rsi is not None and ((d > 0 and rsi >= 70) or (d < 0 and rsi <= 30)):
        add("Exaustão do movimento", f"RSI {rsi:.0f} já esticado a favor do {side} na entrada.", ["VOL", "TIM"])
    # 10. notícias
    if news is not None and getattr(news, "loaded", False):
        evs = [e for e in news.for_pair(decision["asset"], ticket["entry_ts"] - 3600, ticket["expiry_ts"] + 1800)
               if e.impact in ("high", "medium")]
        if evs:
            e = evs[0]
            add("Notícia de impacto", f"{e.title} ({e.currency}, {e.impact}) às {fmt_ts(e.ts)} — fonte: {e.source}.", ["NEWS"])
    # dados insuficientes
    abst = [r["name"] for r in decision["reports"] if r["abstain"]]
    not_eval = decision["confluence"].get("not_evaluated") or []
    if len(abst) >= 5 or len(not_eval) >= 3:
        add("Dados insuficientes", f"{len(abst)} agentes sem dados; não avaliado: {', '.join(not_eval) or '—'}.", ["HEAD"])

    # 13–14. sinais ignorados e agentes que erraram
    wrong = [r for r in decision["reports"] if not r["abstain"] and r["bias"] == d]
    ignored = [r for r in decision["reports"] if not r["abstain"] and r["bias"] == -d and r["confidence"] >= 0.3]
    cats = [f["category"] for f in found] or ["Variância (sem falha identificável)"]
    cause = found[0]["category"] if found else "Variância (sem falha identificável)"

    # ---------------- reunião pós-LOSS
    meeting = [{"speaker": "Head Trader", "kind": "request",
                "text": f"Reunião pós-LOSS: {side} em {decision['asset']} {tf}, entrada {fmt_ts(ticket['entry_ts'])} a "
                        f"{entry:.5g}, expiração {fmt_ts(ticket['expiry_ts'])} a {exit_:.5g}. Vamos descobrir por que perdemos."}]
    names = {r["agent"]: r["name"] for r in decision["reports"]}
    spoke = set()
    for f in found:
        for code in f["agents"]:
            if code in spoke or code == "HEAD" or code not in names:
                continue
            spoke.add(code)
            meeting.append({"speaker": names[code], "kind": "reply", "text": statement(code, f, decision, d)})
    for r in ignored[:3]:
        if r["agent"] in spoke:
            continue
        top = max(r["evidence"], key=lambda e: e["weight"] * e["quality"], default=None) if r["evidence"] else None
        meeting.append({"speaker": r["name"], "kind": "reply",
                        "text": f"Eu apontava {DIR_LABEL[r['bias']]}"
                                + (f": {top['description']}" if top else "") + ". Esse sinal foi subestimado."})
    rules = []
    for c in cats:
        if c in PREVENTION:
            params, text = PREVENTION[c]
            if text not in [x["text"] for x in rules]:
                rules.append({"category": c, "text": text, "params": params})
    head = (f"A perda teve como causa provável: {cause.lower()}. "
            + (f"Outras causas: {', '.join(c.lower() for c in cats[1:])}. " if len(cats) > 1 else "")
            + (f"Sinais contrários ignorados: {', '.join(r['name'] for r in ignored[:3])}. " if ignored else "")
            + (f"Regra de prevenção proposta: {rules[0]['text']} Ela só será adotada se melhorar fora da amostra."
               if rules else "Sem falha de processo identificável: tratar como variância e não mudar a metodologia por um caso."))
    meeting.append({"speaker": "Head Trader", "kind": "decision", "text": head})
    learning_txt = (f"{side} em {decision['asset']} {tf} ({decision.get('condition', 'condição indefinida')}): "
                    + "; ".join(f"{f['category']} — {f['evidence']}" for f in found[:4]) if found else
                    "Perda sem causa identificável (variância).")
    return {
        "asset": decision["asset"], "tf": tf, "direction": d, "signal_ts": as_of, "entry_ts": ticket["entry_ts"],
        "expiry_ts": ticket["expiry_ts"], "entry_price": entry, "exit_price": exit_, "result": outcome["result"],
        "hour": int((ticket["entry_ts"] // 3600) % 24), "condition": decision.get("condition"),
        "categories": cats, "cause": cause,
        "evidence": {"findings": found, "trends": trends, "snapshot_m1": snapshot, "mfe_atr": round(mfe / a1, 2),
                     "mae_atr": round(mae / a1, 2), "post_atr": round(post / a1, 2) if post is not None else None,
                     "entry_source": outcome.get("entry_source"), "exit_source": outcome.get("exit_source"),
                     "delay_s": delay, "confluence": decision["confluence"]["score"]},
        "agents": {"wrong": [r["name"] for r in wrong], "ignored": [r["name"] for r in ignored],
                   "involved": sorted({names.get(a, a) for f in found for a in f["agents"] if a != "HEAD"})},
        "meeting": meeting, "learning": learning_txt, "prevention": rules,
        "analysis": {"decision": decision["decision"], "reason": decision["reason"], "narrative": decision.get("narrative"),
                     "confluence": decision["confluence"]["score"]},
    }


def statement(code: str, f: dict, decision: dict, d: int) -> str:
    side = "CALL" if d > 0 else "PUT"
    c = f["category"]
    ev = f["evidence"]
    T = {
        "LIQ": f"Identifiquei a liquidez, mas não considerei a possibilidade de uma varredura antes do movimento. {ev}",
        "MTF": f"{ev} Eu deveria ter pesado mais a temporalidade de contexto.",
        "VOL": f"{ev} Faltou confirmação suficiente pelo preço.",
        "REV": f"{ev} Interpretei uma possível reversão sem confirmação estrutural.",
        "RET": f"{ev} A retração tinha características de reversão que não ponderei.",
        "SR": f"{ev} A zona não tinha a força que atribuí a ela.",
        "FIB": f"{ev} O nível precisava de reação de preço para valer.",
        "TL": f"{ev} A linha de tendência não se sustentou.",
        "PA": f"{ev} O fluxo não confirmava a continuidade.",
        "TIM": f"{ev} O timing da entrada não respeitou o comportamento do M1 até a expiração.",
        "NEWS": f"{ev} A janela de bloqueio deveria ter evitado a entrada.",
    }
    return T.get(code, f"{c}: {ev}")
