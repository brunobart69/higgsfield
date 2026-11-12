"""Sala de reuniões: análises individuais → debate → reanálise → decisão → risco."""
from __future__ import annotations

from typing import Optional

from . import confluence as conf
from .agents import SPECIALISTS, HeadTrader, RiskManager
from .context import MarketContext
from .models import BEAR, BULL, NEUTRAL, DIR_LABEL, GROUPS, TIMEFRAMES, Message, asset_label

STRATEGIES = {
    "comite": ["NEWS", "PA", "RET", "REV", "VOL", "VP", "SR", "FIB", "MTF", "LIQ", "MT5I", "TL", "TIM", "RES"],
    "indicadores_mt5": ["NEWS", "MT5I", "MTF", "SR", "LIQ"],
    "tendencia": ["NEWS", "PA", "RET", "SR", "FIB", "MTF", "LIQ", "TL"],
    "reversao": ["NEWS", "REV", "LIQ", "VOL", "SR", "VP", "PA"],
    "estrutura_liquidez": ["NEWS", "PA", "LIQ", "MTF", "SR"],
}
NEXT_TF = {"M1": "M5", "M5": "M15", "M15": "H1", "M30": "H1", "H1": "H4", "H4": "D1"}


class Office:
    def __init__(self, agents: Optional[list[str]] = None, strategy: str = "comite"):
        codes = agents or STRATEGIES.get(strategy, STRATEGIES["comite"])
        self.strategy = strategy if agents is None else "custom:" + "+".join(codes)
        self.specialists = [cls() for cls in SPECIALISTS if cls.code in codes]
        self.risk = RiskManager()
        self.head = HeadTrader()

    def all_agents(self):
        return self.specialists + [self.risk, self.head]

    def meet(self, ctx: MarketContext, model_version: str = "v1.0", debate: bool = True) -> dict:
        tr: list[Message] = []
        H = self.head.name
        tr.append(Message(H, f"Abrindo reunião sobre {asset_label(ctx.asset)} ({ctx.focus_tf}). "
                             f"Fonte de dados: {ctx.data.source}. Solicito as análises individuais.", "request"))
        if ctx.data.synthetic:
            tr.append(Message("Sistema", "DADOS SINTÉTICOS em uso — qualquer conclusão serve apenas para testar o software.", "system"))

        # ---------------------------------------------------------- rodada 1
        reports = []
        for a in self.specialists:
            r = a.run(ctx)
            reports.append(r)
            if a.code == "FIB" and not r.abstain:   # Taxas Ouro/Prata viram obstáculos para o agente de Timing
                ctx._fib_taxas = [(v, f"{c['label']} {k}") for n, c in (r.data.get("categories") or {}).items()
                                  if c and n in ("OURO", "PRATA") for k, v in c["levels"].items() if not k.startswith("ext")]
            txt = r.summary
            if r.lessons_used:
                txt += f" [consultei {r.lessons_used} registros de memória]"
            tr.append(Message(a.name, f"{txt} (viés {DIR_LABEL[r.bias]}, confiança {r.confidence:.2f})", "analysis"))
            for w in r.warnings[:2]:
                tr.append(Message(a.name, "⚠ " + w, "analysis"))
        by_code = {r.agent: r for r in reports}
        agents_by_code = {a.code: a for a in self.specialists}

        # ---------------------------------------------------------- alerta de Taxa OURO / PRATA
        fibr = by_code.get("FIB")
        taxa = fibr.data.get("taxa_alert") if fibr else None
        if taxa:
            tr.append(Message(H, f"Atenção: preço na {taxa['label']} {taxa['level']} ({taxa['price']:.5g}). Acionando os "
                                 f"especialistas relevantes. Leitura da região: {taxa['scenario']}. Fibonacci sozinho não "
                                 "autoriza entrada.", "request"))
            for code in taxa["relevant_agents"]:
                rr = by_code.get(code)
                if rr and not rr.abstain:
                    tr.append(Message(rr.name, f"Na região da {taxa['label']}: {rr.summary} (viés {DIR_LABEL[rr.bias]})", "reply"))

        # ---------------------------------------------------------- consulta ao banco de erros
        mem = ctx.memory
        if mem is not None and hasattr(mem, "mistake_stats"):
            lean_now = 0
            bull = sum(r.confidence for r in reports if r.bias == 1)
            bear = sum(r.confidence for r in reports if r.bias == -1)
            lean_now = 1 if bull > bear else -1 if bear > bull else 0
            if lean_now:
                ms = mem.mistake_stats(ctx.asset, ctx.focus_tf, lean_now, ctx.as_of)
                if ms["n"]:
                    top = sorted(ms["categories"].items(), key=lambda kv: -kv[1])[:3]
                    tr.append(Message(H, f"Consultei o banco de erros: {ms['n']} perda(s) anteriores em {ctx.asset} "
                                         f"{ctx.focus_tf} na direção {DIR_LABEL[lean_now]}. Causas mais comuns: "
                                         + ", ".join(f"{k} ({v})" for k, v in top) + ".", "request"))

        # ---------------------------------------------------------- rodada 2: debate
        if debate:
            replies = 0
            for a in self.specialists:
                own = by_code[a.code]
                for target, msg in a.challenge(own, [r for r in reports if r.agent != a.code]):
                    tr.append(msg)
                    tr.append(agents_by_code[target].respond(by_code[target], own))
                    replies += 1
                    if replies >= 8:
                        break
                if replies >= 8:
                    break

        # ---------------------------------------------------------- rodada 3: reanálise
        divergences = self.head.divergences(reports)
        reanalyzed = 0
        if divergences:
            dv = divergences[0]
            up = NEXT_TF.get(ctx.focus_tf)
            if up and dv["severity"] >= 0.35:
                tr.append(Message(H, f"Divergência entre {dv['a_name']} e {dv['b_name']}. Solicito reanálise em {up} "
                                     "para verificar qual leitura se sustenta na temporalidade maior.", "request"))
                for code in (dv["a"], dv["b"]):
                    ag = agents_by_code.get(code)
                    if not ag:
                        continue
                    rr = ag.reanalyze(ctx, up)
                    if rr is None:
                        tr.append(Message(ag.name, f"Sem dados suficientes em {up} para reanalisar.", "reply"))
                        continue
                    reanalyzed += 1
                    orig = by_code[code]
                    if rr.bias == orig.bias and rr.bias != NEUTRAL:
                        orig.confidence = round(min(0.95, orig.confidence * 1.1), 3)
                        orig.revisions.append(f"Confirmado em {up} (confiança {orig.confidence:.2f}).")
                        tr.append(Message(ag.name, f"Em {up} a leitura se mantém ({DIR_LABEL[rr.bias]}): {rr.summary}", "reply"))
                    else:
                        orig.confidence = round(orig.confidence * 0.7, 3)
                        orig.revisions.append(f"Não confirmado em {up} (viés {DIR_LABEL[rr.bias]}); confiança reduzida.")
                        tr.append(Message(ag.name, f"Em {up} minha leitura NÃO se confirma ({DIR_LABEL[rr.bias]}). "
                                                   f"Reduzo a confiança para {orig.confidence:.2f}.", "reply"))

        # ---------------------------------------------------------- confluência
        p = ctx.params
        evaluated = set()
        for r in reports:
            if not r.abstain:
                evaluated.add(r.agent and next((a.group for a in self.specialists if a.code == r.agent), ""))
                evaluated.update(e.group for e in r.evidence)
        if ctx.data.volume_kind != "none" and "VOL" in by_code and not by_code["VOL"].abstain:
            evaluated.add("volume")
        evaluated.discard("")
        c = conf.score(reports, p.agent_weights, evaluated, p)
        c["calibration"] = conf.calibration(ctx.memory, c["score"], ctx.as_of, p.min_bucket_samples, self.strategy)

        news = by_code.get("NEWS")
        news_avoid = bool(news and news.data.get("avoid"))
        data_ok = sum(1 for r in reports if not r.abstain) >= max(3, len(reports) // 2)
        tf_cmp = self.head.compare_tfs(ctx, by_code, c["direction"])
        if tf_cmp["applies"]:
            tr.append(Message(H, f"Comparando temporalidades: {tf_cmp['text']}", "request"))
        draft = {"confluence": c, "news_avoid": news_avoid, "tf_compare": tf_cmp, "reports": by_code}
        risk = None
        if c["classification"] == "ALTA" and data_ok and not news_avoid and c["direction"] != NEUTRAL:
            tr.append(Message(H, f"Cenário preliminar de {DIR_LABEL[c['direction']]} com confluência ALTA "
                                 f"({c['score']}). Encaminho ao Risk Manager.", "request"))
            risk = self.risk.review(ctx, draft, self.strategy)
            for chk in risk["checks"]:
                tr.append(Message(self.risk.name, ("✔ " if chk["ok"] else "✖ ") + chk["text"], "risk"))
        decision, reason = self.head.conclude(ctx, reports, c, risk, news_avoid, data_ok)
        process = self.head.process_quality(ctx, reports, c, reanalyzed, divergences)
        narrative = self.head.narrative(ctx, reports, c, decision, reason, divergences)
        tr.append(Message(H, narrative, "decision"))

        if decision.startswith("CENÁRIO") and tf_cmp["applies"] and not tf_cmp["ok"] and p.require_tf_agreement:
            decision, reason = "AGUARDAR CONFIRMAÇÃO", ("Conflito entre temporalidades: " if tf_cmp.get("conflict")
                                                        else "Falta confirmação: ") + tf_cmp["text"]
        direction = c["direction"] if decision.startswith("CENÁRIO") else NEUTRAL
        mtfr = by_code.get("MTF")
        lab = ((mtfr.data.get("map") or {}).get(ctx.focus_tf) or {}).get("label") if mtfr else None
        condition = {"ALTA": "tendência de alta", "BAIXA": "tendência de baixa", "CONSOLIDAÇÃO": "consolidação"}.get(lab, "indefinida")
        return {
            "asset": ctx.asset, "timeframe": ctx.focus_tf, "as_of": ctx.as_of, "price": ctx.price,
            "decision": decision, "reason": reason, "direction": direction, "lean": c["direction"],
            "confluence": c, "risk": risk, "process": process, "divergences": divergences,
            "reports": [r.to_dict() for r in reports], "transcript": [m.to_dict() for m in tr],
            "narrative": narrative, "source": ctx.data.source, "synthetic": ctx.data.synthetic,
            "volume_kind": ctx.data.volume_kind, "model_version": model_version, "strategy": self.strategy,
            "news_avoid": news_avoid, "tf_compare": tf_cmp, "condition": condition, "taxa_alert": taxa,
            "ticket": getattr(ctx, "ticket", None),
        }
