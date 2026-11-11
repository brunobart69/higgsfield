"""Agentes 11 (Risk Manager) e 12 (Head Trader)."""
from __future__ import annotations

import datetime as dt
from typing import Optional

from .. import confluence as conf
from ..context import MarketContext
from ..indicators import median, wilson
from ..models import BEAR, BULL, NEUTRAL, DIR_LABEL, GROUPS, AgentReport, Message, asset_label, fmt_ts
from .base import Agent


class RiskManager(Agent):
    code, number, name, group = "RISK", 11, "Risk Manager", ""
    specialty = "Proteção do capital teórico e controle de qualidade das análises"
    personality = "Conservador e quantitativo: na dúvida, veta."
    methodology = ("Exige confluência ALTA, taxa de acerto acima do ponto de equilíbrio do payout, bloqueia "
                   "estratégias com expectativa negativa validada, pausa após sequência de perdas, impõe limite "
                   "diário e proíbe progressões de recuperação (martingale/soros).")

    def analyze(self, ctx):  # pragma: no cover - não é especialista de mercado
        raise NotImplementedError

    def review(self, ctx: MarketContext, draft: dict, strategy: str, stake_multiplier: float = 1.0) -> dict:
        p = ctx.params
        checks = []
        approved = True

        def chk(ok: bool, text: str, blocking: bool = True):
            nonlocal approved
            checks.append({"ok": ok, "text": text, "blocking": blocking})
            if not ok and blocking:
                approved = False

        breakeven = 1 / (1 + p.payout)
        chk(True, f"Payout {p.payout:.0%}: ponto de equilíbrio = {breakeven:.1%} de acerto. Expectativa = "
                  f"taxa × {p.payout:.2f} − (1 − taxa) × 1.", blocking=False)
        chk(stake_multiplier == 1.0, "Stake fixa de 1 unidade teórica (progressões de recuperação proibidas)."
            if stake_multiplier == 1.0 else f"REJEITADO: aumento de stake ×{stake_multiplier} após perda é progressão de recuperação.")
        chk(draft["confluence"]["classification"] == "ALTA",
            f"Confluência {draft['confluence']['classification']} ({draft['confluence']['score']}) — exige ALTA.")
        mem = ctx.memory
        # sequência de perdas / limite diário
        if mem is not None:
            recent = mem.recent_results(ctx.as_of, 30)
            streak = 0
            for r in recent:
                if r["result"] == "LOSS":
                    streak += 1
                elif r["result"] == "WIN":
                    break
            last_loss_ts = recent[0]["expiry_ts"] if recent and recent[0]["result"] == "LOSS" else None
            sec = ctx.data.tf[ctx.base_tf][1].ts - ctx.data.tf[ctx.base_tf][0].ts if len(ctx.data.base) > 1 else 900
            cooling = streak >= p.max_loss_streak and last_loss_ts is not None and \
                ctx.as_of - last_loss_ts < p.cooldown_bars * sec
            chk(not cooling, f"Sequência atual de perdas: {streak} (pausa obrigatória após {p.max_loss_streak})."
                if not cooling else f"PAUSA: {streak} perdas seguidas — aguardando {p.cooldown_bars} candles.")
            day0 = ctx.as_of - ctx.as_of % 86400
            day_pnl = sum(r["pnl"] or 0 for r in recent if r["expiry_ts"] >= day0)
            chk(day_pnl > -p.daily_loss_limit, f"Resultado teórico do dia: {day_pnl:+.2f} u (limite −{p.daily_loss_limit:.0f} u).")
            cal = conf.calibration(mem, draft["confluence"]["score"], ctx.as_of, p.min_bucket_samples, strategy)
            if cal["n"] >= p.min_bucket_samples:
                lo, hi = cal["ci"]
                chk(hi >= breakeven, f"Histórico da faixa {cal['bucket']}: {cal['win_rate']:.1%} em {cal['n']} operações "
                                     f"(IC95% {lo:.0%}–{hi:.0%}) vs. equilíbrio {breakeven:.1%}.")
            else:
                chk(True, f"Faixa {cal.get('bucket')} ainda sem amostra mínima ({cal['n']}/{p.min_bucket_samples}): "
                          "sem evidência estatística de vantagem.", blocking=False)
        # volatilidade
        tf = ctx.focus_tf
        atrs = [a for a in ctx.atr_series(tf)[-200:] if a]
        if atrs:
            med = median(atrs)
            ratio = atrs[-1] / med if med else 1
            chk(p.volatility_min_mult <= ratio <= p.volatility_max_mult,
                f"Volatilidade (ATR/mediana) = {ratio:.2f} (faixa aceita {p.volatility_min_mult}–{p.volatility_max_mult}).")
        if draft.get("news_avoid"):
            chk(False, "Evento de alto impacto na janela: operação vetada.")
        if ctx.data.synthetic:
            checks.append({"ok": True, "blocking": False,
                           "text": "ATENÇÃO: dados SINTÉTICOS. Resultado não tem qualquer validade de mercado."})
        return {"approved": approved, "checks": checks, "breakeven": breakeven}


class HeadTrader(Agent):
    code, number, name, group = "HEAD", 12, "Head Trader", ""
    specialty = "Direção do escritório: compara argumentos, organiza a reunião e decide"
    personality = "Juiz de evidências: pesa qualidade e independência, não conta votos."
    methodology = ("Agrupa evidências por fonte independente, solicita reanálise quando há divergência relevante, "
                   "submete o cenário ao Risk Manager e aceita que NÃO OPERAR é uma decisão válida.")

    def analyze(self, ctx):  # pragma: no cover
        raise NotImplementedError

    def divergences(self, reports: list[AgentReport]) -> list[dict]:
        active = [r for r in reports if not r.abstain and r.bias != NEUTRAL]
        out = []
        for i, a in enumerate(active):
            for b in active[i + 1:]:
                if a.bias == -b.bias and min(a.confidence, b.confidence) >= 0.3:
                    out.append({"a": a.agent, "a_name": a.name, "a_bias": a.bias, "b": b.agent, "b_name": b.name,
                                "b_bias": b.bias, "severity": round(min(a.confidence, b.confidence), 2)})
        return sorted(out, key=lambda d: -d["severity"])

    def process_quality(self, ctx: MarketContext, reports: list[AgentReport], c: dict, reanalyzed: int,
                        divergences: list) -> dict:
        d = c["direction"]
        items = []
        supp = [e for r in reports for e in r.evidence if d and e.direction == d]
        avg_q = sum(e.quality for e in supp) / len(supp) if supp else 0.0
        items.append(("Qualidade média das evidências a favor", avg_q))
        items.append(("Independência (grupos que confirmam / mínimo)", min(1.0, c["agreeing_groups"] / max(1, ctx.params.min_independent_groups))))
        evaluated = sum(1 for r in c["criteria"] if r["status"] != "não avaliado") / len(c["criteria"])
        items.append(("Cobertura de critérios avaliados", evaluated))
        items.append(("Tratamento de divergências", 1.0 if not divergences else (0.9 if reanalyzed else 0.5)))
        htf = any(e.timeframe in ("H4", "D1", "W1") for e in supp)
        items.append(("Suporte de temporalidade maior", 1.0 if htf else 0.4))
        items.append(("Somente candles fechados", 1.0))
        score = sum(v for _, v in items) / len(items)
        return {"score": round(score, 3), "items": [{"name": n, "value": round(v, 2)} for n, v in items],
                "label": "BOM" if score >= 0.65 else "REGULAR" if score >= 0.5 else "FRACO"}

    def conclude(self, ctx: MarketContext, reports: list[AgentReport], c: dict, risk: Optional[dict],
                 news_avoid: bool, data_ok: bool) -> tuple[str, str]:
        d = c["direction"]
        cls = c["classification"]
        if not data_ok:
            return "SEM OPORTUNIDADE", "Dados insuficientes para uma análise confiável."
        if news_avoid:
            return "AGUARDAR CONFIRMAÇÃO", "Evento de alto impacto na janela: aguardar a normalização após a divulgação."
        if d == NEUTRAL:
            return "SEM OPORTUNIDADE", "Evidências sem direção predominante. Não fabricar oportunidade em mercado indefinido."
        if cls == "ALTA":
            if risk and risk["approved"]:
                return ("CENÁRIO DE ALTA" if d == BULL else "CENÁRIO DE BAIXA",
                        "Fatores independentes confirmam o cenário e o Risk Manager aprovou.")
            return "AGUARDAR CONFIRMAÇÃO", "Confluência alta, mas o Risk Manager não aprovou: " + "; ".join(
                x["text"] for x in (risk or {}).get("checks", []) if not x["ok"] and x["blocking"])
        if cls == "MÉDIA":
            missing = [r["criterion"] for r in c["criteria"] if r["status"] in ("neutro", "não avaliado")][:3]
            return "AGUARDAR CONFIRMAÇÃO", f"Sinais favoráveis a {DIR_LABEL[d]}, mas faltam confirmações ({', '.join(missing)})."
        return "SEM OPORTUNIDADE", "Poucos sinais ou informações contraditórias."

    def narrative(self, ctx: MarketContext, reports: list[AgentReport], c: dict, decision: str, reason: str,
                  divergences: list) -> str:
        votes = {BULL: 0, BEAR: 0, NEUTRAL: 0}
        for r in reports:
            if not r.abstain:
                votes[r.bias] += 1
        parts = [f"{asset_label(ctx.asset)} — análise com candles fechados até {fmt_ts(ctx.as_of)} ({ctx.focus_tf})."]
        parts.append(f"Contagem simples: {votes[BULL]} alta × {votes[BEAR]} baixa × {votes[NEUTRAL]} neutro — "
                     "não decido por votos, mas pela qualidade e independência das evidências.")
        conf_rows = [r for r in c["criteria"] if r["status"] == "confirma"]
        if conf_rows:
            parts.append("Confirmações independentes: " + "; ".join(f"{r['criterion']} ({r['agent']})" for r in conf_rows) + ".")
        contra = [r for r in c["criteria"] if r["status"] == "contra"]
        if contra:
            parts.append("Contra o cenário: " + "; ".join(f"{r['criterion']} ({r['agent']})" for r in contra) + ".")
        if divergences:
            dv = divergences[0]
            parts.append(f"Principal divergência: {dv['a_name']} ({DIR_LABEL[dv['a_bias']]}) × {dv['b_name']} ({DIR_LABEL[dv['b_bias']]}).")
        if c["not_evaluated"]:
            parts.append("Não avaliado: " + ", ".join(c["not_evaluated"]) + ".")
        parts.append(f"Confluência {c['classification']} ({c['score']}/100). Decisão: {decision}. {reason}")
        return " ".join(parts)
