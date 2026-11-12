"""Classe base dos agentes especialistas."""
from __future__ import annotations

import datetime as dt
from typing import Optional

from ..context import MarketContext
from ..models import BULL, BEAR, NEUTRAL, DIR_LABEL, AgentReport, Evidence, Message


def session_of(ts: int) -> str:
    h = dt.datetime.fromtimestamp(ts, dt.timezone.utc).hour
    if 0 <= h < 7:
        return "asia"
    if 7 <= h < 12:
        return "londres"
    if 12 <= h < 17:
        return "londres_ny"
    return "ny_tarde"


PERSONAS = {'NEWS': ('Helena', 'f'), 'PA': ('Rafael', 'm'), 'RET': ('Bianca', 'f'), 'REV': ('Otávio', 'm'), 'VOL': ('Marina', 'f'), 'VP': ('Caio', 'm'), 'SR': ('Lúcia', 'f'), 'FIB': ('Teodoro', 'm'), 'MTF': ('Sofia', 'f'), 'LIQ': ('Gustavo', 'm'), 'MT5I': ('Nina', 'f'), 'TL': ('Diego', 'm'), 'TIM': ('Lívia', 'f'), 'RES': ('Henrique', 'm'), 'PB': ('Paula', 'f'), 'RISK': ('Vera', 'f'), 'HEAD': ('Augusto', 'm')}


class Agent:
    code = "BASE"
    number = 0
    name = "Agente"
    specialty = ""
    personality = ""
    methodology = ""
    group = ""

    # ------------------------------------------------------------------ ciclo
    def run(self, ctx: MarketContext) -> AgentReport:
        rep = self.analyze(ctx)
        self._finalize(rep)
        self._consult_memory(ctx, rep)
        return rep

    def analyze(self, ctx: MarketContext) -> AgentReport:  # pragma: no cover
        raise NotImplementedError

    def reanalyze(self, ctx: MarketContext, tf: str) -> Optional[AgentReport]:
        """Nova análise focada em outra temporalidade (pedido do Head Trader)."""
        if not ctx.enough(tf, 60):
            return None
        sub = ctx.data.context(ctx.as_of, ctx.news, ctx.memory, ctx.params, focus_tf=tf)
        rep = self.analyze(sub)
        self._finalize(rep)
        return rep

    def new_report(self, ctx: MarketContext) -> AgentReport:
        return AgentReport(agent=self.code, name=self.name, asset=ctx.asset, timeframe=ctx.focus_tf, as_of=ctx.as_of)

    def ev(self, rep: AgentReport, kind: str, desc: str, direction: int, weight: float, quality: float,
           tf: str = "", group: Optional[str] = None, confirmed: bool = True) -> Evidence:
        e = Evidence(kind, desc, direction, round(weight, 3), round(max(0.0, min(1.0, quality)), 3),
                     group or self.group, tf, confirmed)
        rep.evidence.append(e)
        return e

    # ------------------------------------------------------------------ síntese
    def _finalize(self, rep: AgentReport) -> None:
        bull = sum(e.strength for e in rep.evidence if e.direction == BULL)
        bear = sum(e.strength for e in rep.evidence if e.direction == BEAR)
        tot = bull + bear
        net = bull - bear
        if rep.abstain or tot < 0.08 or abs(net) < 0.15 * max(tot, 1e-9):
            rep.bias = NEUTRAL
            rep.confidence = round(min(0.3, tot / 3), 3) if not rep.abstain else 0.0
        else:
            rep.bias = BULL if net > 0 else BEAR
            rep.confidence = round(min(0.95, abs(net) / (tot + 0.6) + 0.12 * min(tot, 1.5)), 3)
        if not rep.summary:
            rep.summary = self.default_summary(rep)

    def default_summary(self, rep: AgentReport) -> str:
        if rep.abstain:
            return "Sem condições de opinar (dados insuficientes)."
        top = rep.top_evidence(rep.bias) if rep.bias else None
        if rep.bias == NEUTRAL:
            return "Sem viés definido: evidências fracas ou contraditórias."
        return f"Viés de {DIR_LABEL[rep.bias]}: {top.description}" if top else f"Viés de {DIR_LABEL[rep.bias]}."

    # ------------------------------------------------------------------ memória
    def tags(self, ctx: MarketContext, rep: AgentReport) -> list[str]:
        if rep.bias == NEUTRAL:
            return []
        htf = ctx.structure("H4").trend if ctx.enough("H4", 30) else 0
        align = "indef" if htf == 0 else ("a_favor" if htf == rep.bias else "contra")
        d = DIR_LABEL[rep.bias].lower()
        return [f"{d}:htf_{align}", f"{d}:sessao_{session_of(ctx.as_of)}"]

    def _consult_memory(self, ctx: MarketContext, rep: AgentReport) -> None:
        tags = self.tags(ctx, rep)
        rep.data["tags"] = tags
        mem = ctx.memory
        if mem is None or not tags:
            return
        stats = mem.lesson_stats(self.code, tags, ctx.as_of)
        rep.lessons_used = sum(v["erro"] + v["acerto"] for v in stats.values())
        p = ctx.params
        for tag, s in stats.items():
            n = s["erro"] + s["acerto"]
            if n >= p.lesson_min_samples and s["erro"] / n >= 0.6:
                msg = (f"Memória: em contexto semelhante ({tag}) errei {s['erro']} de {n} vezes. "
                       "Reduzo a confiança." if p.lesson_penalty > 0 else
                       f"Memória: em contexto semelhante ({tag}) errei {s['erro']} de {n} vezes (alerta; penalidade não validada).")
                rep.warnings.append(msg)
                if p.lesson_penalty > 0:
                    rep.confidence = round(rep.confidence * (1 - p.lesson_penalty), 3)
        cal = mem.calibration(self.code, rep.confidence, ctx.as_of, p.min_bucket_samples)
        rep.calibrated = cal

    # ------------------------------------------------------------------ debate
    def challenge(self, own: AgentReport, others: list[AgentReport]) -> list[tuple[str, Message]]:
        """Contesta, no máximo, os 2 agentes mais confiantes com viés oposto."""
        if own.bias == NEUTRAL or own.confidence < 0.35:
            return []
        top = own.top_evidence(own.bias)
        if top is None:
            return []
        opp = sorted([o for o in others if o.bias == -own.bias and not o.abstain], key=lambda o: -o.confidence)[:2]
        out = []
        for o in opp:
            out.append((o.agent, Message(self.name, f"@{o.name}: discordo do viés de {DIR_LABEL[o.bias]}. "
                                                    f"Minha evidência principal: {top.description} "
                                                    f"(força {top.strength:.2f}{', ' + top.timeframe if top.timeframe else ''}).",
                                         "challenge", o.agent)))
        return out

    def respond(self, own: AgentReport, challenger: AgentReport) -> Message:
        mine = own.top_evidence(own.bias)
        theirs = challenger.top_evidence(challenger.bias)
        if mine is None or theirs is None:
            return Message(self.name, "Sem argumento adicional.", "reply", challenger.agent)
        tf_rank = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN", "Y1"]
        theirs_rank = tf_rank.index(theirs.timeframe) if theirs.timeframe in tf_rank else 0
        mine_rank = tf_rank.index(mine.timeframe) if mine.timeframe in tf_rank else 0
        their_score = theirs.strength * (1 + 0.08 * (theirs_rank - mine_rank))
        if their_score > mine.strength * 1.15:
            old = own.confidence
            own.confidence = round(own.confidence * 0.75, 3)
            note = f"Revisado após contestação de {challenger.name}: confiança {old:.2f} → {own.confidence:.2f}."
            own.revisions.append(note)
            return Message(self.name, f"@{challenger.name}: reconheço que sua evidência é mais forte que a minha "
                                      f"({mine.description}). Reduzo minha confiança para {own.confidence:.2f}.",
                           "reply", challenger.agent)
        return Message(self.name, f"@{challenger.name}: mantenho minha leitura. {mine.description} "
                                  f"(força {mine.strength:.2f}) não foi invalidada.", "reply", challenger.agent)

    def card(self) -> dict:
        person, gender = PERSONAS.get(self.code, (self.name, "m"))
        return {"code": self.code, "number": self.number, "name": self.name, "specialty": self.specialty,
                "personality": self.personality, "methodology": self.methodology, "person": person, "gender": gender}
