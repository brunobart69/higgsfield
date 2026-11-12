"""Agentes 01 a 10 — especialistas."""
from __future__ import annotations

from typing import Optional

from .. import indicators as ind
from ..context import MarketContext
from ..data.news import IMPACT_PT, IMPACT_RANK
from ..models import BEAR, BULL, NEUTRAL, DIR_LABEL, TIMEFRAMES, TF_LABEL, TF_SECONDS, AgentReport, bucket_end, bucket_start, fmt_ts
from .base import Agent


def _fmt(x: float) -> str:
    return f"{x:.5f}" if x < 20 else f"{x:.3f}"


def _efficiency(closes: list[float], n: int = 20) -> float:
    if len(closes) < n + 1:
        return 0.0
    seg = closes[-n - 1:]
    path = sum(abs(b - a) for a, b in zip(seg, seg[1:]))
    return abs(seg[-1] - seg[0]) / path if path else 0.0


# =========================================================================== 01
class NewsAgent(Agent):
    code, number, name, group = "NEWS", 1, "News Intelligence", "macro"
    specialty = "Notícias, calendário econômico, bancos centrais e geopolítica"
    personality = "Cético e cronológico: só aceita evento com data, horário e fonte."
    methodology = ("Classifica impacto (alto/médio/baixo), mede surpresa (atual - previsão), verifica se o "
                   "preço já reagiu (precificação) e bloqueia operações próximas a eventos de alto impacto.")

    def analyze(self, ctx: MarketContext) -> AgentReport:
        rep = self.new_report(ctx)
        rep.data["events"] = []
        store = ctx.news
        if store is None or not store.loaded:
            rep.abstain = True
            rep.summary = "Nenhum calendário econômico carregado: contexto macro NÃO avaliado (não invento notícias)."
            rep.warnings.append("Carregue data/news/*.json ou use `python -m tio news --fetch`.")
            return rep
        cov = store.coverage()
        if cov and not (cov[0] - 86400 * 2 <= ctx.as_of <= cov[1] + 86400 * 2):
            rep.abstain = True
            rep.summary = (f"O calendário carregado cobre {fmt_ts(cov[0])} → {fmt_ts(cov[1])} e não inclui o "
                           f"instante analisado ({fmt_ts(ctx.as_of)}).")
            return rep
        p = ctx.params
        events = store.for_pair(ctx.asset, ctx.as_of - 8 * 3600, ctx.as_of + 6 * 3600)
        base, quote = ctx.asset[:3], ctx.asset[3:]
        atr = ctx.atr() or 0
        cs = ctx.candles() or []
        avoid = False
        for e in events:
            info = e.to_dict()
            known = e.ts <= ctx.as_of
            if not known:  # evento futuro: valores ainda não divulgados
                info["actual"] = None
            rep.data["events"].append(info)
            mins = (e.ts - ctx.as_of) / 60
            if e.impact == "high" and -p.news_block_after_min <= mins <= p.news_block_before_min:
                avoid = True
                rep.warnings.append(f"Evento de ALTO impacto {e.currency} '{e.title}' às {info['time_label']} "
                                    f"(fonte: {e.source}). Volatilidade elevada — evitar operar.")
            if not known or e.surprise() is None or e.category_sign == 0:
                continue
            sign = (1 if e.surprise() > 0 else -1 if e.surprise() < 0 else 0) * e.category_sign
            if sign == 0:
                continue
            pair_dir = sign if e.currency == base else -sign
            moved = 0.0
            after = [c for c in cs if c.ts >= e.ts]
            if after and atr:
                moved = (cs[-1].close - after[0].open) / atr
            priced = moved * pair_dir > 1.5
            q = (0.35 if priced else 0.8) * (1.0 if e.impact == "high" else 0.6 if e.impact == "medium" else 0.3)
            age_h = (ctx.as_of - e.ts) / 3600
            q *= max(0.3, 1 - age_h / 8)
            self.ev(rep, "news_surprise",
                    f"{e.title} ({e.currency}, {IMPACT_PT.get(e.impact)}) {info['time_label']}: atual {e.actual} vs "
                    f"previsão {e.forecast} → favorece {DIR_LABEL[pair_dir]} em {ctx.asset}"
                    f"{' (provavelmente já precificado)' if priced else ''}. Fonte: {e.source}",
                    pair_dir, 0.7 if e.impact == "high" else 0.4, q, ctx.focus_tf)
        rep.data["avoid"] = avoid
        rep.data["high_volatility"] = avoid or any(IMPACT_RANK.get(x["impact"], 0) == 3 and abs(x["ts"] - ctx.as_of) < 7200
                                                   for x in rep.data["events"])
        rep.veto = avoid
        if avoid:
            rep.summary = "Evento de alto impacto na janela de bloqueio: recomendo NÃO operar agora."
        elif not events:
            rep.summary = "Calendário verificado: nenhum evento relevante para o par na janela (-8h/+6h)."
        return rep


# =========================================================================== 02
class PriceActionAgent(Agent):
    code, number, name, group = "PA", 2, "Price Action & Fluxo", "structure"
    specialty = "Deslocamentos, BOS/CHOCH, Order Blocks, FVG, absorção e rejeição"
    personality = "Objetivo; só considera estrutura rompida por FECHAMENTO."
    methodology = ("Mapeia pivôs confirmados, rupturas de estrutura por fechamento, impulsos com corpo > 1,6 ATR, "
                   "zonas de FVG/OB não mitigadas e mede a eficiência do movimento para separar fluxo de ruído.")

    def analyze(self, ctx: MarketContext) -> AgentReport:
        rep = self.new_report(ctx)
        tf = ctx.focus_tf
        cs = ctx.candles(tf)
        if not cs or len(cs) < 80:
            rep.abstain = True
            return rep
        atr = ctx.atr(tf)
        st = ctx.structure(tf)
        n = len(cs)
        eff = _efficiency([c.close for c in cs], 20)
        rep.data["efficiency"] = round(eff, 3)
        noise = eff < 0.18
        if st.events:
            e = st.events[-1]
            age = n - 1 - e.idx
            q = max(0.25, 1 - age / 60) * (0.6 if noise else 1.0)
            self.ev(rep, e.kind.lower(), f"{e.kind} de {DIR_LABEL[e.direction]} em {_fmt(e.level)} ({tf}, há {age} candles fechados)",
                    e.direction, 0.8 if e.kind == "BOS" else 0.7, q, tf)
            rep.data["structure_events"] = [{"ts": x.ts, "kind": x.kind, "dir": x.direction, "level": x.level,
                                             "swing_ts": x.swing_ts} for x in st.events[-20:]]
            # Strong/Weak (SMC): o extremo que originou o último rompimento é "forte"; o extremo atual é "fraco" (alvo)
            ev = st.events[-1]
            seg = cs[max(0, ev.idx - 40):ev.idx + 1]
            after = cs[ev.idx:]
            if ev.direction == 1 and seg and after:
                rep.data["strong_weak"] = {"strong": {"kind": "STRONG LOW", "price": min(c.low for c in seg)},
                                           "weak": {"kind": "WEAK HIGH", "price": max(c.high for c in after)}}
            elif seg and after:
                rep.data["strong_weak"] = {"strong": {"kind": "STRONG HIGH", "price": max(c.high for c in seg)},
                                           "weak": {"kind": "WEAK LOW", "price": min(c.low for c in after)}}
        disp = [i for i in ind.displacements(cs, ctx.atr_series(tf)) if i >= n - 8]
        if disp:
            i = disp[-1]
            d = 1 if cs[i].bullish else -1
            self.ev(rep, "displacement", f"Deslocamento forte de {DIR_LABEL[d]} (corpo {cs[i].body / atr:.1f}× ATR) há {n - 1 - i} candles",
                    d, 0.5, 0.9 - 0.08 * (n - 1 - i), tf)
        price = cs[-1].close
        fvgs = [z for z in ind.fair_value_gaps(cs[-150:], 0.15 * atr) if not z.mitigated]
        all_fvg = ind.fair_value_gaps(cs[-160:], 0.15 * atr)
        rep.data["fvg_all"] = [{"low": z.low, "high": z.high, "dir": z.direction, "ts": z.ts, "mitigated": z.mitigated} for z in all_fvg[-25:]]
        obs = [z for z in ind.order_blocks(cs[-200:], ind.displacements(cs[-200:], ind.atr(cs[-200:]))) if not z.mitigated]
        rep.data["fvg"] = [{"low": z.low, "high": z.high, "dir": z.direction, "ts": z.ts} for z in fvgs[-8:]]
        rep.data["order_blocks"] = [{"low": z.low, "high": z.high, "dir": z.direction, "ts": z.ts} for z in obs[-8:]]
        for z in (fvgs[-4:] + obs[-4:]):
            near = (z.low - 0.5 * atr) <= price <= (z.high + 0.5 * atr)
            if near and ((z.direction == 1 and price >= z.low) or (z.direction == -1 and price <= z.high)):
                self.ev(rep, z.kind.lower(), f"Preço reagindo em {z.kind} de {DIR_LABEL[z.direction]} não mitigado "
                                             f"[{_fmt(z.low)}–{_fmt(z.high)}]", z.direction, 0.4, 0.7, tf)
                break
        rj = ind.wick_rejection(cs[-1])
        if rj:
            self.ev(rep, "rejection", f"Último candle fechado com pavio de rejeição ({'inferior' if rj == 1 else 'superior'})",
                    rj, 0.3, 0.7, tf)
        if ctx.data.volume_kind != "none":
            vavg = sum(c.volume for c in cs[-50:]) / 50
            last = cs[-1]
            if vavg and last.volume > 1.8 * vavg and last.body < 0.3 * last.range:
                rep.warnings.append("Possível absorção: volume alto com corpo pequeno no último candle.")
        if noise:
            rep.warnings.append(f"Eficiência direcional baixa ({eff:.2f}): predominância de ruído, não de fluxo.")
        return rep


# =========================================================================== 03
class RetracementAgent(Agent):
    code, number, name, group = "RET", 3, "Retração", "fib"
    specialty = "Retrações saudáveis vs. reversões em H4, H1 e M15"
    personality = "Paciente: prefere esperar a correção a perseguir o preço."
    methodology = ("Identifica a última perna impulsiva confirmada, mede a retração (0,382–0,705 = zona saudável), "
                   "verifica confluência com S/R e invalida a retração acima de 0,786 ou com deslocamento contrário.")

    def leg(self, ctx: MarketContext, tf: str):
        sw = ctx.swings(tf)
        st = ctx.structure(tf)
        if st.trend == 0 or len(sw) < 4:
            return None
        highs = [s for s in sw if s.kind == "H"]
        lows = [s for s in sw if s.kind == "L"]
        if not highs or not lows:
            return None
        if st.trend == 1:
            hi = highs[-1]
            prior = [l for l in lows if l.idx < hi.idx]
            return (prior[-1], hi, 1) if prior else None
        lo = lows[-1]
        prior = [h for h in highs if h.idx < lo.idx]
        return (prior[-1], lo, -1) if prior else None

    def analyze(self, ctx: MarketContext) -> AgentReport:
        rep = self.new_report(ctx)
        price = ctx.price
        tfs = [t for t in ("H4", "H1", ctx.focus_tf) if ctx.enough(t, 60)]
        tfs = list(dict.fromkeys(tfs))
        if not tfs:
            rep.abstain = True
            return rep
        rep.data["legs"] = {}
        for tf in tfs:
            lg = self.leg(ctx, tf)
            if not lg:
                continue
            a, b, d = lg
            rng = abs(b.price - a.price)
            atr = ctx.atr(tf) or 0
            if rng < 2 * atr or rng == 0:
                continue
            r = (b.price - price) / rng if d == 1 else (price - b.price) / rng
            rep.data["legs"][tf] = {"from": a.price, "to": b.price, "dir": d, "retr": round(r, 3)}
            w = {"H4": 0.75, "H1": 0.65}.get(tf, 0.55)
            cs = ctx.candles(tf)
            since = cs[b.idx + 1:] if b.idx + 1 < len(cs) else []
            counter_disp = any(c.body > 1.8 * atr and ((c.close < c.open) if d == 1 else (c.close > c.open)) for c in since)
            if 0.382 <= r <= 0.705:
                zones = ctx.zones(tf)
                conf = any(z.low - 0.3 * atr <= price <= z.high + 0.3 * atr and z.touches >= 2 for z in zones)
                q = 0.55 + (0.25 if conf else 0) - (0.3 if counter_disp else 0)
                self.ev(rep, "healthy_retracement",
                        f"Retração saudável de {r:.0%} da perna de {DIR_LABEL[d]} em {tf}"
                        f"{' com confluência de S/R' if conf else ''}{' (atenção: deslocamento contrário)' if counter_disp else ''}",
                        d, w, q, tf)
            elif 0.705 < r <= 0.886:
                self.ev(rep, "deep_retracement", f"Retração profunda ({r:.0%}) em {tf}: continuação ainda possível, mas frágil",
                        d, w * 0.6, 0.35, tf)
            elif r > 0.886:
                self.ev(rep, "retracement_invalid", f"Retração de {r:.0%} em {tf} perdeu validade: possível reversão",
                        -d, w * 0.5, 0.5, tf)
            elif r < 0.236:
                rep.warnings.append(f"{tf}: preço perto do extremo da perna — sem retração para entrada de continuação.")
        return rep


# =========================================================================== 04
class ReversalAgent(Agent):
    code, number, name, group = "REV", 4, "Reversão", "reversal"
    specialty = "Exaustão, divergências, rejeições, CHOCH e falsas rupturas"
    personality = "Contrarian disciplinado: exige pelo menos dois sinais independentes."
    methodology = ("Coleta sinais de exaustão (RSI extremo, divergência, pavio de rejeição em zona, CHOCH recente, "
                   "varredura de liquidez, extensão > 3 ATR da EMA50). Nunca recomenda reversão com um sinal só.")

    def analyze(self, ctx: MarketContext) -> AgentReport:
        rep = self.new_report(ctx)
        tf = ctx.focus_tf
        cs = ctx.candles(tf)
        if not cs or len(cs) < 80:
            rep.abstain = True
            return rep
        p = ctx.params
        atr = ctx.atr(tf)
        r = ctx.rsi(tf)
        signals = {BULL: [], BEAR: []}
        if r[-1] is not None:
            if r[-1] >= p.rsi_overbought - 5:
                signals[BEAR].append(f"RSI esticado ({r[-1]:.1f})")
            if r[-1] <= p.rsi_oversold + 5:
                signals[BULL].append(f"RSI esticado ({r[-1]:.1f})")
        div = ind.rsi_divergence(cs, r, ctx.swings(tf))
        if div:
            signals[div[0]].append(f"divergência: {div[1]}")
        rj = ind.wick_rejection(cs[-1])
        if rj:
            near_zone = any(z.low - 0.3 * atr <= cs[-1].close <= z.high + 0.3 * atr for z in ctx.zones(tf) if z.touches >= 2)
            if near_zone:
                signals[rj].append("pavio de rejeição em zona testada")
        st = ctx.structure(tf)
        if st.events and st.events[-1].kind == "CHOCH" and len(cs) - 1 - st.events[-1].idx <= 12:
            signals[st.events[-1].direction].append("CHOCH recente (mudança de caráter)")
        for s in ind.detect_sweeps(cs, ctx.pools(tf), 4):
            signals[s.direction].append(f"falsa ruptura/varredura em {_fmt(s.level)}")
            break
        e50 = ctx.ema(tf, 50)
        ext = (cs[-1].close - e50[-1]) / atr if atr else 0
        if ext > 3:
            signals[BEAR].append(f"extensão de {ext:.1f} ATR acima da EMA50")
        elif ext < -3:
            signals[BULL].append(f"extensão de {-ext:.1f} ATR abaixo da EMA50")
        rep.data["signals"] = {DIR_LABEL[k]: v for k, v in signals.items()}
        for d, sig in signals.items():
            sig = list(dict.fromkeys(sig))
            if len(sig) >= 2:
                self.ev(rep, "reversal_setup", f"Possível reversão para {DIR_LABEL[d]}: " + "; ".join(sig),
                        d, 0.7, min(1.0, 0.35 + 0.2 * len(sig)), tf)
            elif len(sig) == 1:
                rep.warnings.append(f"Apenas um sinal de reversão para {DIR_LABEL[d]} ({sig[0]}) — insuficiente.")
        if not rep.evidence:
            rep.summary = "Sem confirmação estrutural de reversão."
        return rep


# =========================================================================== 05
class VolumeRSIAgent(Agent):
    code, number, name, group = "VOL", 5, "Volume & RSI", "momentum"
    specialty = "Força do movimento: volume, RSI, sobrecompra/sobrevenda e divergências"
    personality = "Desconfiado de extremos: RSI só vale com confirmação de preço e volume."
    methodology = ("RSI(14) de Wilder com 80/20/50. Extremos exigem candle de confirmação; volume comparado à "
                   "média de 50 candles. Sem volume real (forex à vista), declara a limitação.")

    def analyze(self, ctx: MarketContext) -> AgentReport:
        rep = self.new_report(ctx)
        tf = ctx.focus_tf
        cs = ctx.candles(tf)
        if not cs or len(cs) < 60:
            rep.abstain = True
            return rep
        p = ctx.params
        r = ctx.rsi(tf)
        cur = r[-1]
        prev = r[-4] if r[-4] is not None else cur
        rep.data["rsi"] = round(cur, 2) if cur is not None else None
        rep.data["rsi_series"] = [round(x, 2) if x is not None else None for x in r[-120:]]
        last = cs[-1]
        if cur is not None:
            if cur >= p.rsi_overbought:
                if last.bearish or ind.wick_rejection(last) == -1:
                    self.ev(rep, "rsi_overbought_confirmed", f"RSI {cur:.1f} em sobrecompra extrema com candle de rejeição fechado",
                            BEAR, 0.5, 0.7, tf)
                else:
                    rep.warnings.append(f"RSI {cur:.1f} em sobrecompra extrema SEM confirmação de preço — não é sinal isolado.")
            elif cur <= p.rsi_oversold:
                if last.bullish or ind.wick_rejection(last) == 1:
                    self.ev(rep, "rsi_oversold_confirmed", f"RSI {cur:.1f} em sobrevenda extrema com candle de rejeição fechado",
                            BULL, 0.5, 0.7, tf)
                else:
                    rep.warnings.append(f"RSI {cur:.1f} em sobrevenda extrema SEM confirmação de preço — não é sinal isolado.")
            elif cur > p.rsi_mid + 5 and cur > prev:
                self.ev(rep, "rsi_momentum", f"RSI {cur:.1f} acima do equilíbrio (50) e subindo", BULL, 0.35, 0.6, tf)
            elif cur < p.rsi_mid - 5 and cur < prev:
                self.ev(rep, "rsi_momentum", f"RSI {cur:.1f} abaixo do equilíbrio (50) e caindo", BEAR, 0.35, 0.6, tf)
        div = ind.rsi_divergence(cs, r, ctx.swings(tf))
        if div:
            self.ev(rep, "rsi_divergence", f"Divergência RSI: {div[1]}", div[0], 0.45, 0.6, tf)
        vk = ctx.data.volume_kind
        rep.data["volume_kind"] = vk
        if vk == "none":
            rep.warnings.append("Volume indisponível nesta fonte (forex à vista não possui volume centralizado). "
                                "Força avaliada apenas pelo RSI.")
            return rep
        vols = [c.volume for c in cs]
        avg = sum(vols[-50:]) / 50
        recent = sum(vols[-5:]) / 5
        move = cs[-1].close - cs[-6].close
        d = 1 if move > 0 else -1 if move < 0 else 0
        ratio = recent / avg if avg else 1
        rep.data["volume_ratio"] = round(ratio, 2)
        label = "tick volume" if vk == "tick" else "volume"
        if ratio > 1.25 and d:
            self.ev(rep, "volume_confirm", f"{label} {ratio:.2f}× a média acompanhando movimento de {DIR_LABEL[d]}",
                    d, 0.5, min(1.0, 0.4 + (ratio - 1) * 0.5), tf, group="volume")
        elif ratio < 0.75 and d:
            self.ev(rep, "volume_fading", f"Movimento de {DIR_LABEL[d]} com {label} fraco ({ratio:.2f}× a média): possível exaustão",
                    -d, 0.25, 0.45, tf, group="volume")
        return rep


# =========================================================================== 06
class VolumeProfileAgent(Agent):
    code, number, name, group = "VP", 6, "Volume Profile & POC", "profile"
    specialty = "Distribuição de volume por preço: POC, VAH, VAL, HVN/LVN"
    personality = "Pensa em aceitação e rejeição de preço, não em direção pura."
    methodology = ("Perfil dos últimos 200 candles (70% de área de valor). Aceitação fora da área de valor "
                   "(3 fechamentos) indica busca de novo valor; dentro dela, rotação para o POC.")

    def analyze(self, ctx: MarketContext) -> AgentReport:
        rep = self.new_report(ctx)
        tf = ctx.focus_tf
        cs = ctx.candles(tf)
        vp = ctx.profile(tf)
        if not cs or vp is None or len(cs) < 60:
            rep.abstain = True
            return rep
        price = cs[-1].close
        atr = ctx.atr(tf)
        rep.data.update({"poc": vp.poc, "vah": vp.vah, "val": vp.val, "mode": vp.mode,
                         "bins": [[round(p, 6), round(v, 2)] for p, v in vp.bins], "hvn": vp.hvn[:6], "lvn": vp.lvn[:6]})
        q_mode = 1.0 if vp.mode == "volume" else 0.6
        if vp.mode == "tpo":
            rep.warnings.append("Sem volume na fonte: perfil construído por tempo no preço (TPO), não por volume.")
        last3 = [c.close for c in cs[-3:]]
        if all(c > vp.vah for c in last3):
            self.ev(rep, "acceptance_above", f"Aceitação acima da VAH ({_fmt(vp.vah)}): 3 fechamentos fora do valor",
                    BULL, 0.55, 0.75 * q_mode, tf)
        elif all(c < vp.val for c in last3):
            self.ev(rep, "acceptance_below", f"Aceitação abaixo da VAL ({_fmt(vp.val)}): 3 fechamentos fora do valor",
                    BEAR, 0.55, 0.75 * q_mode, tf)
        elif cs[-1].high > vp.vah and price < vp.vah:
            self.ev(rep, "rejection_vah", f"Rejeição na VAH ({_fmt(vp.vah)}): retorno para a área de valor", BEAR, 0.45, 0.65 * q_mode, tf)
        elif cs[-1].low < vp.val and price > vp.val:
            self.ev(rep, "rejection_val", f"Rejeição na VAL ({_fmt(vp.val)}): retorno para a área de valor", BULL, 0.45, 0.65 * q_mode, tf)
        elif vp.val <= price <= vp.vah:
            dist = (price - vp.poc) / atr if atr else 0
            if abs(dist) > 1.0:
                d = BEAR if dist > 0 else BULL
                self.ev(rep, "poc_magnet", f"Dentro do valor, {abs(dist):.1f} ATR {'acima' if dist > 0 else 'abaixo'} do POC "
                                           f"({_fmt(vp.poc)}): rotação provável em direção ao POC", d, 0.3, 0.5 * q_mode, tf)
            else:
                rep.warnings.append(f"Preço no POC ({_fmt(vp.poc)}): região de equilíbrio, sem vantagem direcional.")
        rep.data["price_vs_poc"] = "acima" if price > vp.poc else "abaixo"
        return rep


# =========================================================================== 07
class SupportResistanceAgent(Agent):
    code, number, name, group = "SR", 7, "Suporte & Resistência", "zones"
    specialty = "Zonas de reação, consolidações e rompimentos falsos em H1 e H4"
    personality = "Cartógrafo: prioriza zonas confirmadas por fechamento e desconfia de zonas gastas."
    methodology = ("Agrupa pivôs em zonas (tolerância 0,35 ATR), conta toques, reações e rompimentos por "
                   "fechamento. Zona com 4+ testes é considerada desgastada.")

    def analyze(self, ctx: MarketContext) -> AgentReport:
        rep = self.new_report(ctx)
        price = ctx.price
        found = False
        rep.data["zones"] = []
        for tf in ("H4", "H1"):
            if not ctx.enough(tf, 60):
                continue
            found = True
            atr = ctx.atr(tf)
            cs = ctx.candles(tf)
            zones = [z for z in ctx.zones(tf) if z.touches >= 2]
            for z in zones:
                role = "suporte" if z.high < price else ("resistência" if z.low > price else "em teste")
                if abs(z.mid - price) <= 4 * atr:
                    rep.data["zones"].append({"tf": tf, "low": z.low, "high": z.high, "touches": z.touches,
                                              "reactions": z.closes_respected, "breaks": z.breaks, "role": role})
            w = 0.65 if tf == "H4" else 0.55
            sup = max((z for z in zones if z.mid < price + 0.1 * atr), key=lambda z: z.mid, default=None)
            res = min((z for z in zones if z.mid > price - 0.1 * atr), key=lambda z: z.mid, default=None)
            last = cs[-1]
            for z, d, nm in ((sup, BULL, "suporte"), (res, BEAR, "resistência")):
                if z is None:
                    continue
                dist = (price - z.high) / atr if d == BULL else (z.low - price) / atr
                if dist <= 0.4:
                    worn = z.touches >= 4
                    held = (last.close > z.low) if d == BULL else (last.close < z.high)
                    if not held:
                        continue
                    q = 0.5 + 0.1 * min(z.closes_respected, 3) - (0.25 if worn else 0) - 0.1 * z.breaks
                    self.ev(rep, f"at_{'support' if d == BULL else 'resistance'}",
                            f"Preço em {nm} {tf} [{_fmt(z.low)}–{_fmt(z.high)}], {z.touches} toques, {z.closes_respected} reações"
                            f"{' — zona desgastada' if worn else ''}", d, w, q, tf)
                # falso rompimento: pavio além da zona e fechamento de volta
                if d == BULL and last.low < z.low and last.close > z.low:
                    self.ev(rep, "false_break", f"Rompimento falso do {nm} {tf} em {_fmt(z.low)} (fechou de volta)", BULL, 0.5, 0.65, tf)
                if d == BEAR and last.high > z.high and last.close < z.high:
                    self.ev(rep, "false_break", f"Rompimento falso da {nm} {tf} em {_fmt(z.high)} (fechou de volta)", BEAR, 0.5, 0.65, tf)
            # rompimento confirmado por fechamento
            prev = cs[-2]
            for z in zones:
                if prev.close <= z.high < last.close and last.body > 0.5 * atr:
                    self.ev(rep, "breakout", f"Rompimento de resistência {tf} {_fmt(z.high)} confirmado por fechamento", BULL, 0.5, 0.6, tf)
                elif prev.close >= z.low > last.close and last.body > 0.5 * atr:
                    self.ev(rep, "breakdown", f"Rompimento de suporte {tf} {_fmt(z.low)} confirmado por fechamento", BEAR, 0.5, 0.6, tf)
        if not found:
            rep.abstain = True
        hi20 = max(c.high for c in (ctx.candles("H1") or ctx.candles())[-20:])
        lo20 = min(c.low for c in (ctx.candles("H1") or ctx.candles())[-20:])
        atr1 = ctx.atr("H1") or ctx.atr()
        if atr1 and hi20 - lo20 < 2.5 * atr1:
            rep.warnings.append(f"Consolidação: últimos 20 candles H1 em faixa estreita ({_fmt(lo20)}–{_fmt(hi20)}).")
            rep.data["consolidation"] = [lo20, hi20]
        return rep


# =========================================================================== 08
class FibonacciAgent(Agent):
    code, number, name, group = "FIB", 8, "Fibonacci Intelligence", "fib"
    specialty = "Taxa OURO (mensal), Taxa PRATA (semanal), Diamante (anual) e Bronze (H4)"
    personality = "Geômetra: só valoriza níveis que coincidem entre temporalidades e nunca move uma âncora."
    methodology = ("TAXA OURO = máxima/mínima da última vela MENSAL fechada; TAXA PRATA = da última vela SEMANAL fechada; "
                   "níveis traçados dentro da própria vela, vinculados a ela e gravados na memória no momento do "
                   "fechamento (nunca alterados retroativamente). DIAMANTE = ano fechado; BRONZE = última perna H4. "
                   "Fibonacci sozinho nunca autoriza entrada: perto de uma Taxa, todos os especialistas são acionados.")

    CATS = [("DIAMANTE", "Y1"), ("OURO", "MN"), ("PRATA", "W1"), ("BRONZE", "H4")]
    LABEL = {"OURO": "TAXA OURO (MENSAL)", "PRATA": "TAXA PRATA (SEMANAL)", "DIAMANTE": "DIAMANTE (ANUAL)", "BRONZE": "BRONZE (H4)"}

    def analyze(self, ctx: MarketContext) -> AgentReport:
        rep = self.new_report(ctx)
        price = ctx.price
        atr = ctx.atr("H1") or ctx.atr()
        if not atr:
            rep.abstain = True
            return rep
        cats = {}
        for name, tf in self.CATS:
            cs = ctx.candles(tf)
            if tf == "H4":
                lg = RetracementAgent().leg(ctx, "H4") if ctx.enough("H4", 60) else None
                if not lg:
                    cats[name] = None
                    continue
                a, b, d = lg
                lo, hi = (a.price, b.price) if d == 1 else (b.price, a.price)
                ref, ref_ts = f"perna H4 {fmt_ts(a.ts)} → {fmt_ts(b.ts)}", b.ts
            else:
                if not cs:
                    cats[name] = None
                    continue
                c = cs[-1]  # último candle FECHADO da referência
                lo, hi, d = c.low, c.high, (1 if c.close >= c.open else -1)
                ref, ref_ts = f"vela {TF_LABEL[tf].lower()} {fmt_ts(c.ts)[:10]} (fechada em {fmt_ts(c.close_ts)})", c.ts
                if ctx.memory is not None and hasattr(ctx.memory, "fib_anchor"):
                    # âncora gravada no primeiro uso; leituras seguintes usam o valor gravado (sem alteração retroativa)
                    lo, hi, d = ctx.memory.fib_anchor(ctx.asset, tf, ref_ts, lo, hi, d)
            cats[name] = {"tf": tf, "low": lo, "high": hi, "dir": d, "ref": ref, "ref_ts": ref_ts,
                          "label": self.LABEL[name], "levels": ind.fib_levels(lo, hi, d)}
        for t in dict.fromkeys([ctx.focus_tf, "M5" if ctx.focus_tf == "M1" else ctx.focus_tf]):
            lf = leg_fib(ctx, t) if ctx.enough(t, 60) else None
            if lf:
                cats[f"PERNA {t}"] = lf
                self.LABEL[f"PERNA {t}"] = f"PERNA ATUAL {t}"
        rep.data["categories"] = cats
        missing = [k for k, v in cats.items() if v is None]
        if missing:
            rep.warnings.append(f"Categorias sem dados suficientes: {', '.join(missing)}.")
        if all(v is None for v in cats.values()):
            rep.abstain = True
            return rep
        tol = 0.35 * atr
        tol_leg = 0.25 * (ctx.atr(ctx.focus_tf) or atr)   # perna atual: tolerância da própria temporalidade
        near = []
        for name, c in cats.items():
            if not c:
                continue
            t_ = tol_leg if name.startswith("PERNA") else tol
            for lvl, val in c["levels"].items():
                if not lvl.startswith("ext") and abs(val - price) <= t_:
                    near.append((name, lvl, val, c["dir"]))
        rep.data["near_levels"] = [{"cat": n, "level": l, "price": v, "label": self.LABEL[n]} for n, l, v, _ in near]
        if near:
            cats_hit = sorted({n for n, *_ in near})
            dirs = [d for *_, d in near]
            d = BULL if sum(dirs) > 0 else BEAR if sum(dirs) < 0 else NEUTRAL
            golden = any(l in ("0.618", "0.705", "0.500") for _, l, _, _ in near)
            q = min(1.0, 0.35 + 0.2 * len(cats_hit) + (0.15 if golden else 0))
            rank = ["PERNA M1", "PERNA M5", "PERNA M15", "BRONZE", "PRATA", "OURO", "DIAMANTE"]
            w = {"DIAMANTE": 0.8, "OURO": 0.7, "PRATA": 0.6, "BRONZE": 0.5}.get(
                max(cats_hit, key=lambda n: rank.index(n) if n in rank else 0), 0.4)
            txt = ", ".join(f"{self.LABEL[n]} {l}" for n, l, _, _ in near[:4])
            if d != NEUTRAL:
                self.ev(rep, "fib_confluence", f"Preço em nível(is) de Fibonacci: {txt}"
                                               f"{' — sobreposição entre categorias' if len(cats_hit) > 1 else ''}", d, w, q, "H1")
            else:
                rep.warnings.append(f"Níveis de Fibonacci com sinais opostos: {txt}")
        # ---- alerta de Taxa OURO / PRATA: cenário na região (continuação, reversão, rejeição, rompimento, ausência)
        taxa = [(n, l, v) for n, l, v, _ in near if n in ("OURO", "PRATA")]
        if taxa:
            n, l, v = min(taxa, key=lambda x: abs(x[2] - price))
            rep.data["taxa_alert"] = self.taxa_scenario(ctx, n, l, v)
            rep.warnings.insert(0, f"Preço na {self.LABEL[n]} {l} ({_fmt(v)}): {rep.data['taxa_alert']['scenario']}. "
                                   "Fibonacci isolado não autoriza entrada.")
        tgt = []
        for name, c in cats.items():
            if c:
                for lvl, val in c["levels"].items():
                    if lvl.startswith("ext"):
                        tgt.append({"cat": name, "level": lvl, "price": val, "dist_atr": round((val - price) / atr, 1)})
        rep.data["targets"] = sorted(tgt, key=lambda t: abs(t["dist_atr"]))[:6]
        return rep

    def taxa_scenario(self, ctx: MarketContext, name: str, level: str, value: float) -> dict:
        tf = ctx.focus_tf
        cs = ctx.candles(tf) or []
        a = ctx.atr(tf) or 1e-9
        last3 = cs[-3:]
        side = [1 if c.close > value + 0.15 * a else -1 if c.close < value - 0.15 * a else 0 for c in cs[-8:]]
        react = 0
        scenario = "ausência de confirmação"
        if len(side) >= 3 and side[-1] == side[-2] != 0 and any(s == -side[-1] for s in side[:-2]):
            react = side[-1]
            scenario = f"rompimento confirmado para {'cima' if react > 0 else 'baixo'} (2 fechamentos além da região)"
        elif last3:
            c = last3[-1]
            if c.low < value < c.close and ind.wick_rejection(c) == 1:
                react, scenario = 1, "rejeição da região (pavio inferior, fechou acima)"
            elif c.close < value < c.high and ind.wick_rejection(c) == -1:
                react, scenario = -1, "rejeição da região (pavio superior, fechou abaixo)"
        trend = 0
        for t in ("M5", "H1"):
            if ctx.enough(t, 60):
                trend = ctx.structure(t).trend or trend
                if trend:
                    break
        if react and trend:
            scenario += "; possibilidade de " + ("continuação" if react == trend else "reversão") + \
                        f" (tendência {'M5' if ctx.enough('M5', 60) else 'H1'} de {DIR_LABEL[trend]})"
        return {"taxa": name, "label": self.LABEL[name], "level": level, "price": value, "reaction": react,
                "scenario": scenario, "relevant_agents": ["MTF", "LIQ", "SR", "VOL", "VP", "PA", "TIM"]}


# =========================================================================== 09
class MultiTimeframeAgent(Agent):
    code, number, name, group = "MTF", 9, "Multi-Timeframe Trend", "trend"
    specialty = "Tendência principal/secundária e alinhamento de Anual a M1"
    personality = "Hierárquico: a temporalidade maior manda até prova em contrário."
    methodology = ("Por temporalidade: estrutura (topos/fundos) + inclinação EMA20/EMA50. Principal = D1/H4, "
                   "secundária = H1/M15. Alinhamento exige concordância das três temporalidades operacionais.")

    def tf_trend(self, ctx: MarketContext, tf: str) -> dict:
        cs = ctx.candles(tf)
        need = 3 if tf == "Y1" else 12 if tf in ("MN", "W1") else 60
        if not cs or len(cs) < need:
            return {"tf": tf, "trend": None, "label": "sem dados"}
        if len(cs) < 60:
            d = 1 if cs[-1].close > cs[0].open else -1
            return {"tf": tf, "trend": d, "label": DIR_LABEL[d], "strength": 0.4, "note": "poucos candles"}
        st = ctx.structure(tf)
        e20, e50 = ctx.ema(tf, 20), ctx.ema(tf, 50)
        atr = ctx.atr(tf) or 1e-9
        sl = ind.slope(e20, 10) / atr
        ema_dir = 1 if e20[-1] > e50[-1] and sl > 0.02 else -1 if e20[-1] < e50[-1] and sl < -0.02 else 0
        eff = _efficiency([c.close for c in cs], 30)
        if st.trend == ema_dir and st.trend != 0:
            trend, s = st.trend, 0.8
        elif st.trend != 0 and ema_dir == 0:
            trend, s = st.trend, 0.5
        elif ema_dir != 0 and st.trend == 0:
            trend, s = ema_dir, 0.45
        else:
            trend, s = 0, 0.0
        consolidation = eff < 0.12 and abs(sl) < 0.03
        if consolidation:
            trend, s = 0, 0.0
        recent_choch = bool(st.events and st.events[-1].kind == "CHOCH" and len(cs) - 1 - st.events[-1].idx <= 15)
        label = "CONSOLIDAÇÃO" if consolidation else DIR_LABEL[trend] if trend else "INDEFINIDA"
        return {"tf": tf, "trend": trend, "label": label, "strength": round(s, 2), "choch": recent_choch,
                "slope": round(sl, 3)}

    def analyze(self, ctx: MarketContext) -> AgentReport:
        rep = self.new_report(ctx)
        tmap = {tf: self.tf_trend(ctx, tf) for tf in TIMEFRAMES}
        rep.data["map"] = tmap
        oper = [tf for tf in ("H4", "H1", ctx.focus_tf) if tmap.get(tf, {}).get("trend") is not None]
        oper = list(dict.fromkeys(oper))
        if len(oper) < 2:
            rep.abstain = True
            return rep
        primary = next((tmap[t] for t in ("D1", "H4") if tmap[t].get("trend")), None)
        secondary = next((tmap[t] for t in ("H1", "M15") if tmap[t].get("trend")), None)
        rep.data["primary"] = primary
        rep.data["secondary"] = secondary
        dirs = [tmap[t]["trend"] for t in oper]
        if all(d == dirs[0] for d in dirs) and dirs[0] != 0:
            q = sum(tmap[t]["strength"] for t in oper) / len(oper)
            hi = [t for t in ("W1", "D1") if tmap[t].get("trend") == dirs[0]]
            self.ev(rep, "aligned", f"Temporalidades alinhadas em {DIR_LABEL[dirs[0]]}: {', '.join(oper)}"
                                    f"{' (+' + ', '.join(hi) + ')' if hi else ''}", dirs[0], 0.85, min(1.0, q + 0.1 * len(hi)), "H4")
        else:
            h4 = tmap.get("H4", {}).get("trend")
            if h4:
                self.ev(rep, "htf_trend", f"Tendência principal H4 de {DIR_LABEL[h4]}, mas sem alinhamento nas menores",
                        h4, 0.5, tmap["H4"]["strength"] * 0.7, "H4")
            counter = [t for t in oper if tmap[t]["trend"] and h4 and tmap[t]["trend"] == -h4]
            if counter:
                rep.warnings.append(f"Movimento contrário em {', '.join(counter)} frente à tendência H4.")
        for t in ("H4", "H1"):
            if tmap.get(t, {}).get("choch"):
                rep.warnings.append(f"Possível mudança de tendência: CHOCH recente em {t}.")
        return rep


# =========================================================================== 10
class LiquidityHunterAgent(Agent):
    code, number, name, group = "LIQ", 10, "Liquidity Hunter", "liquidity"
    specialty = "Liquidez acima de topos/abaixo de fundos, equal highs/lows, varreduras e armadilhas"
    personality = "Investigativo e prudente: descreve comportamento compatível com busca de liquidez, sem acusar manipulação."
    methodology = ("Mapeia pools (equal highs/lows, máximas/mínimas anteriores, PDH/PDL), separa liquidez interna e "
                   "externa e identifica varreduras: pavio além do nível com fechamento de volta.")

    def analyze(self, ctx: MarketContext) -> AgentReport:
        rep = self.new_report(ctx)
        tf = ctx.focus_tf
        cs = ctx.candles(tf)
        if not cs or len(cs) < 80:
            rep.abstain = True
            return rep
        price = cs[-1].close
        atr = ctx.atr(tf)
        pools = ctx.pools(tf)
        live = [p for p in pools if not p.swept]
        above = sorted([p for p in live if p.price > price], key=lambda p: p.price)[:5]
        below = sorted([p for p in live if p.price < price], key=lambda p: -p.price)[:5]
        d1 = ctx.candles("D1")
        extra = []
        if d1:
            pd = d1[-1]
            extra = [{"price": pd.high, "side": "acima", "kind": "PDH (máxima do dia anterior)"},
                     {"price": pd.low, "side": "abaixo", "kind": "PDL (mínima do dia anterior)"}]
        kind_pt = {"equal_highs": "Equal Highs", "equal_lows": "Equal Lows", "swing": "topo/fundo anterior"}
        rep.data["pools"] = [{"price": p.price, "side": p.side, "kind": kind_pt.get(p.kind, p.kind), "count": p.count,
                              "external": p.external, "dist_atr": round((p.price - price) / atr, 2)} for p in above + below] + extra
        rep.data["swept"] = [{"price": p.price, "side": p.side, "ts": p.swept_ts} for p in pools if p.swept][-6:]
        # níveis em que topos/fundos de temporalidades diferentes coincidem ("M15 · M30", "M30 · H1", "H1 · H4")
        pts = []
        for t in ("M5", "M15", "M30", "H1", "H4"):
            if ctx.enough(t, 40):
                for s in ctx.swings(t)[-14:]:
                    pts.append((s.price, t, s.kind))
        pts.sort()
        order = ["M1", "M5", "M15", "M30", "H1", "H4"]
        mtf, used = [], set()
        tol_m = 0.3 * atr
        for i, (p, t, k) in enumerate(pts):
            if i in used:
                continue
            grp = [(p, t, k)]
            for j in range(i + 1, len(pts)):
                if pts[j][0] - p > tol_m:
                    break
                grp.append(pts[j])
                used.add(j)
            tfs = sorted({g[1] for g in grp}, key=order.index)
            if len(tfs) >= 2:
                lvl = max(g[0] for g in grp) if grp[0][2] == "H" else min(g[0] for g in grp)
                swept = any((c.high > lvl if lvl > price else c.low < lvl) for c in cs[-3:])
                mtf.append({"price": lvl, "tfs": tfs, "label": " · ".join(tfs[-2:]), "side": "acima" if lvl > price else "abaixo",
                            "dist_atr": round((lvl - price) / atr, 2), "swept_now": swept})
        rep.data["mtf_levels"] = sorted(mtf, key=lambda m: abs(m["dist_atr"]))[:8]
        sweeps = ind.detect_sweeps(cs, pools, 4)
        if sweeps:
            s = sweeps[-1]
            age = len(cs) - 1 - s.idx
            self.ev(rep, "sweep", f"Varredura de liquidez {'abaixo' if s.direction == 1 else 'acima'} de {_fmt(s.level)} "
                                  f"com fechamento de volta (há {age} candles). Comportamento compatível com busca de liquidez; "
                                  f"não há evidência suficiente para afirmar manipulação.", s.direction, 0.75, 0.85 - 0.1 * age, tf)
        # alvo de liquidez (draw on liquidity): pool mais forte e próximo
        def score(p):
            return (p.count + (1 if p.external else 0)) / (1 + abs(p.price - price) / atr)
        cand = above[:3] + below[:3]
        if cand:
            best = max(cand, key=score)
            d = BULL if best.price > price else BEAR
            dist = abs(best.price - price) / atr
            if best.count >= 2 and dist <= 3:
                self.ev(rep, "draw_on_liquidity", f"{kind_pt.get(best.kind)} ({best.count}×) em {_fmt(best.price)}, "
                                                  f"{dist:.1f} ATR {'acima' if d == BULL else 'abaixo'}: possível alvo de liquidez",
                        d, 0.35, 0.55, tf)
        if above and below:
            ia, ib = abs(above[0].price - price) / atr, abs(price - below[0].price) / atr
            if ia < 0.5 and ib < 0.5:
                rep.warnings.append("Liquidez muito próxima dos dois lados: risco de armadilha em ambas as direções.")
        return rep


# =========================================================================== 13
class UserIndicatorsAgent(Agent):
    code, number, name, group = "MT5I", 13, "Indicadores MT5", "mt5"
    specialty = "Lê os indicadores do próprio usuário no MetaTrader 5 e mede se eles acertam"
    personality = "Neutro e auditável: trata cada indicador como hipótese até o histórico provar valor."
    methodology = ("Usa somente barras FECHADAS exportadas pelo TIO_Exportador. Setas de compra/venda na última barra "
                   "fechada viram evidência; linhas de preço indicam lado. Detecta indicadores que redesenham (repaint) "
                   "comparando o registro ao vivo com o histórico. Peso baixo até a validação estatística.")

    def analyze(self, ctx: MarketContext) -> AgentReport:
        from ..data.mt5_indicators import ROLE_PT, classify
        rep = self.new_report(ctx)
        tf = ctx.focus_tf
        exports = {k: v for k, v in (ctx.data.indicators or {}).items() if k[1] == tf}
        objs = (ctx.data.chart_objects or {}).get(tf)
        if objs:
            self.read_marks(ctx, rep, objs)
        if not exports and objs:
            if not rep.evidence:
                rep.summary = "Li as marcações do seu indicador no gráfico: nada ativo perto do preço na última vela fechada."
            return rep
        if not exports:
            rep.abstain = True
            rep.summary = (f"Nenhum indicador do MT5 exportado para {tf}. Escolha seus indicadores na aba MT5 "
                           "e coloque o TIO_Exportador em um gráfico.")
            return rep
        sec = TF_SECONDS[tf]
        cs = ctx.candles(tf) or []
        by_ts = {c.ts: c for c in cs}
        rep.data["indicators"] = {}
        rep.data["signals"] = {}
        for (name, _), exp in sorted(exports.items()):
            rows = [r for r in exp.rows if r[0] + sec <= ctx.as_of]
            if not exp.roles:
                exp.roles = classify(exp.rows[-400:], by_ts)
            info = {"roles": {str(b): ROLE_PT.get(r, r) for b, r in exp.roles.items()}, "auto": exp.auto, "bars": len(rows)}
            rep.data["indicators"][name] = info
            if not rows:
                continue
            last_ts, vals = rows[-1]
            if last_ts + sec != ctx.as_of:
                info["note"] = "exportação atrasada em relação ao gráfico"
                rep.warnings.append(f"{name}: última barra exportada não é a última fechada (exportador parado?).")
                continue
            live_vals = exp.live.get(last_ts)
            use = live_vals if live_vals is not None else vals
            rp = exp.repaint()
            q = 0.5
            if rp:
                info["repaint"] = rp
                if rp["rate"] > 0.1:
                    q = 0.25
                    rep.warnings.append(f"{name} REDESENHA: {rp['changed']} de {rp['checked']} sinais mudaram depois do "
                                        "fechamento. Backtests com ele ficam otimistas.")
            tag = " (papéis deduzidos automaticamente)" if exp.auto else ""
            for b, role in exp.roles.items():
                v = use[b] if b < len(use) else None
                if role in ("compra", "venda") and v is not None:
                    d = BULL if role == "compra" else BEAR
                    rep.data["signals"][name] = d
                    self.ev(rep, "user_arrow", f"{name}: {ROLE_PT[role]} na barra fechada {fmt_ts(last_ts)}{tag}",
                            d, 0.5, q, tf)
                elif role == "linha" and v is not None and cs:
                    d = BULL if cs[-1].close > v else BEAR
                    self.ev(rep, "user_line", f"{name} (buffer {b}): preço {'acima' if d == BULL else 'abaixo'} da linha {_fmt(v)}",
                            d, 0.25, q, tf)
                elif role == "oscilador" and v is not None:
                    info.setdefault("values", {})[str(b)] = round(v, 4)
        if not rep.evidence and not rep.abstain:
            rep.summary = "Indicadores do MT5 lidos: nenhum sinal na última barra fechada."
        return rep

    def read_marks(self, ctx: MarketContext, rep: AgentReport, objs: list) -> None:
        """Usa as marcações desenhadas pelo indicador (BOS/CHoCH, OB/FVG, liquidez) como evidência."""
        from ..data.mt5_objects import classify
        tf = ctx.focus_tf
        cs = ctx.candles(tf) or []
        atr = ctx.atr(tf) or 0
        if not cs or not atr:
            return
        name = next((n for n in ctx.data.chart_indicators if n), "indicador do gráfico")
        visible = [o for o in objs if not o["t1"] or o["t1"] <= ctx.as_of]       # nada desenhado depois do instante
        mk = classify(visible, cs, atr)
        rep.data["marks"] = {"indicator": name, "events": mk["events"][-8:], "zones": mk["zones"][-10:], "levels": mk["levels"][:20]}
        price = cs[-1].close
        sec = TF_SECONDS[tf]
        ev = [e for e in mk["events"] if e["dir"] and ctx.as_of - e["ts"] <= 15 * sec]
        if ev:
            e = ev[-1]
            rep.data.setdefault("signals", {})[f"{name}:{e['kind']}"] = e["dir"]
            self.ev(rep, "user_mark_structure", f"{name}: {e['kind']} de {DIR_LABEL[e['dir']]} em {_fmt(e['price'])} "
                                                f"({fmt_ts(e['ts'])})", e["dir"], 0.5 if e["kind"] == "BOS" else 0.45, 0.6, tf)
        for z in mk["zones"]:
            if z["low"] - 0.2 * atr <= price <= z["high"] + 0.2 * atr and z["kind"] in ("OB", "FVG", "OB?", "FVG?"):
                d = BULL if price >= (z["low"] + z["high"]) / 2 else BEAR
                rep.data.setdefault("signals", {})[f"{name}:{z['kind'].rstrip('?')}"] = d
                self.ev(rep, "user_mark_zone", f"{name}: preço na zona {z['kind'].rstrip('?')} [{_fmt(z['low'])}–{_fmt(z['high'])}] "
                                               f"→ reação esperada de {DIR_LABEL[d]}", d, 0.4, 0.5, tf)
                break
        near = [lv for lv in mk["levels"] if lv["kind"] in ("LIQ", "EQH", "EQL", "MTF") and abs(lv["price"] - price) <= 0.5 * atr]
        if near:
            rep.warnings.append(f"{name}: preço perto de {near[0]['label'] or near[0]['kind']} em {_fmt(near[0]['price'])} "
                                "— possível busca de liquidez.")


# =========================================================================== 14
class TrendlineAgent(Agent):
    code, number, name, group = "TL", 14, "Linhas de Tendência", "trendline"
    specialty = "Traça LTA e LTB automaticamente e lê toques e rompimentos"
    personality = "Desenhista rigorosa: só aceita linha com 3 toques e nenhum fechamento do outro lado."
    methodology = ("Liga pivôs confirmados (fundos para LTA, topos para LTB) na temporalidade de operação e em H1. "
                   "Exige 3 toques (tolerância 0,18 ATR) e nenhum fechamento além da linha. Toque com rejeição = "
                   "continuação; fechamento além da linha nas 2 últimas velas = rompimento.")

    def analyze(self, ctx: MarketContext) -> AgentReport:
        rep = self.new_report(ctx)
        rep.data["lines"] = []
        tfs = list(dict.fromkeys([ctx.focus_tf, "H1"]))
        seen = False
        for tf in tfs:
            cs = ctx.candles(tf)
            atr = ctx.atr(tf)
            if not cs or len(cs) < 80 or not atr:
                continue
            seen = True
            n = len(cs)
            w = 0.6 if tf == "H1" else 0.5
            for ln in ind.trend_lines(cs, ctx.swings(tf), atr):
                now_v = ln.value_at(n - 1)
                prev_v = ln.value_at(n - 2)
                last, prev = cs[-1], cs[-2]
                rep.data["lines"].append({"tf": tf, "kind": ln.kind, "t1": cs[ln.i1].ts, "p1": ln.p1,
                                          "t2": cs[-1].ts, "p2": now_v, "touches": ln.touches})
                d = BULL if ln.kind == "LTA" else BEAR
                label = "LTA (linha de alta)" if ln.kind == "LTA" else "LTB (linha de baixa)"
                if d == BULL and last.close < now_v - 0.1 * atr and prev.close >= prev_v:
                    self.ev(rep, "tl_break", f"Rompimento da {label} {tf} por fechamento em {_fmt(last.close)} "
                                             f"({ln.touches} toques)", BEAR, w, 0.7, tf)
                elif d == BEAR and last.close > now_v + 0.1 * atr and prev.close <= prev_v:
                    self.ev(rep, "tl_break", f"Rompimento da {label} {tf} por fechamento em {_fmt(last.close)} "
                                             f"({ln.touches} toques)", BULL, w, 0.7, tf)
                else:
                    touch = (last.low <= now_v + 0.25 * atr) if d == BULL else (last.high >= now_v - 0.25 * atr)
                    held = (last.close >= now_v) if d == BULL else (last.close <= now_v)
                    if touch and held:
                        q = min(1.0, 0.45 + 0.1 * ln.touches) * (1.0 if ind.wick_rejection(last) == d else 0.8)
                        self.ev(rep, "tl_touch", f"Preço tocou a {label} {tf} ({ln.touches} toques) e fechou respeitando",
                                d, w, q, tf)
                    else:
                        dist = abs(last.close - now_v) / atr
                        rep.warnings.append(f"{label} {tf} ativa em {_fmt(now_v)} ({dist:.1f} ATR do preço, {ln.touches} toques).")
        if not seen:
            rep.abstain = True
        elif not rep.data["lines"]:
            rep.summary = "Nenhuma linha de tendência válida (3 toques sem fechamento contrário) no momento."
        return rep


# =========================================================================== 15
class TimingAgent(Agent):
    code, number, name, group = "TIM", 15, "Timing & Micro-estrutura M1", "timing"
    specialty = "Pressão compradora/vendedora, velocidade, rompimentos curtos e espaço até a expiração"
    personality = "Cronometrista: pergunta sempre se o preço tem ESPAÇO e TEMPO para chegar lá antes da expiração."
    methodology = ("Lê as velas M1 FECHADAS: posição do fechamento no range, corpo × pavios, sequência, velocidade, "
                   "rompimentos e falsos rompimentos, varreduras curtas, retrações curtas e exaustão. Uma vela verde "
                   "ou vermelha nunca é confirmação sozinha: exige ao menos 2 fatos independentes no mesmo sentido. "
                   "Mede o espaço até o obstáculo mais próximo (S/R, liquidez, Taxa Ouro/Prata, POC) contra o "
                   "movimento esperado até a expiração (ATR M1 × √minutos restantes).")

    def analyze(self, ctx: MarketContext) -> AgentReport:
        rep = self.new_report(ctx)
        if ctx.focus_tf not in ("M1", "M5") or not ctx.enough("M1", 40):
            rep.abstain = True
            rep.summary = "Atuo em operações M1/M5 e preciso de velas M1."
            return rep
        cs = ctx.candles("M1")
        a1 = ctx.atr("M1") or 1e-9
        ticket = getattr(ctx, "ticket", None) or {}
        expiry = ticket.get("expiry_ts") or bucket_end(bucket_start(ctx.as_of, ctx.focus_tf), ctx.focus_tf)
        if expiry <= ctx.as_of:
            expiry = ctx.as_of + TF_SECONDS[ctx.focus_tf]
        entry = ticket.get("entry_ts") or ctx.as_of
        remaining = max(1, expiry - entry)
        facts = {BULL: [], BEAR: []}
        last = cs[-1]
        rng = last.range or 1e-9
        pos = (last.close - last.low) / rng
        if last.body >= 0.5 * rng and pos >= 0.7:
            facts[BULL].append(f"fechamento no topo do range ({pos:.0%}) com corpo forte")
        elif last.body >= 0.5 * rng and pos <= 0.3:
            facts[BEAR].append(f"fechamento no fundo do range ({pos:.0%}) com corpo forte")
        dirs = [1 if c.close > c.open else -1 if c.close < c.open else 0 for c in cs[-6:]]
        run = 0
        for d in reversed(dirs):
            if d == dirs[-1] and d != 0:
                run += 1
            else:
                break
        if 3 <= run <= 4:
            facts[dirs[-1]].append(f"{run} velas M1 seguidas no mesmo sentido")
        vel = (cs[-1].close - cs[-4].close) / a1
        if abs(vel) >= 1.2:
            facts[BULL if vel > 0 else BEAR].append(f"velocidade de {abs(vel):.1f} ATR em 3 minutos")
        rj = ind.wick_rejection(last)
        if rj:
            facts[rj].append("pavio de rejeição na última vela M1")
        hi15 = max(c.high for c in cs[-16:-1])
        lo15 = min(c.low for c in cs[-16:-1])
        if last.close > hi15:
            facts[BULL].append(f"rompimento da máxima de 15 min ({_fmt(hi15)}) por fechamento")
        elif last.close < lo15:
            facts[BEAR].append(f"rompimento da mínima de 15 min ({_fmt(lo15)}) por fechamento")
        elif last.high > hi15 and last.close < hi15:
            facts[BEAR].append(f"falso rompimento da máxima de 15 min ({_fmt(hi15)})")
        elif last.low < lo15 and last.close > lo15:
            facts[BULL].append(f"falso rompimento da mínima de 15 min ({_fmt(lo15)})")
        for s in ind.detect_sweeps(cs, ctx.pools("M1"), 2):
            facts[s.direction].append(f"varredura curta de liquidez em {_fmt(s.level)}")
            break
        # retração curta após impulso: impulso nas velas -5..-3, 1-2 velas pequenas contrárias, retomada na última
        imp = (cs[-3].close - cs[-6].close) / a1
        if abs(imp) >= 1.2:
            d = 1 if imp > 0 else -1
            small = all(abs(c.close - c.open) < 0.45 * a1 and (c.close - c.open) * d <= 0 for c in cs[-3:-1])
            if small and (last.close - last.open) * d > 0:
                facts[d].append("retração curta após impulso e retomada")
        r = ctx.rsi("M1")
        exhaustion = None
        if run >= 6 or abs(vel) >= 2.6 or (r[-1] is not None and (r[-1] >= 78 or r[-1] <= 22)):
            exhaustion = BULL if (vel > 0 or (r[-1] or 50) >= 78) else BEAR
            rep.warnings.append(f"Possível exaustão do movimento de {DIR_LABEL[exhaustion]} no M1 "
                                f"(sequência {run}, velocidade {vel:+.1f} ATR, RSI {r[-1] or 0:.0f}).")
        if ctx.data.volume_kind != "none":
            v = [c.volume for c in cs[-21:]]
            ratio = v[-1] / (sum(v[:-1]) / 20) if sum(v[:-1]) else 1
            rep.data["volume_ratio_m1"] = round(ratio, 2)
            if ratio >= 1.4 and dirs[-1]:
                facts[dirs[-1]].append(f"tick volume {ratio:.1f}× a média na última vela")
        rep.data["facts"] = {DIR_LABEL[k]: v for k, v in facts.items()}
        # direção só com >= 2 fatos independentes (vela colorida sozinha não confirma)
        for d in (BULL, BEAR):
            f = facts[d]
            if len(f) >= 2 and len(f) > len(facts[-d]):
                q = min(1.0, 0.35 + 0.15 * len(f)) * (0.6 if exhaustion == d else 1.0)
                self.ev(rep, "m1_pressure", f"Pressão de {DIR_LABEL[d]} no M1: " + "; ".join(f[:4]), d, 0.55, q, "M1")
        if not rep.evidence and (facts[BULL] or facts[BEAR]):
            rep.warnings.append("Sinais de M1 isolados ou contraditórios — insuficiente para confirmar direção.")
        # espaço até a expiração
        exp_move = a1 * (remaining / 60) ** 0.5
        rep.data.update({"remaining_s": remaining, "expected_move": exp_move, "expiry_ts": expiry})
        price = last.close
        obstacles = []
        for tf in ("M5", "H1"):
            if ctx.enough(tf, 60):
                for z in ctx.zones(tf):
                    if z.touches >= 2:
                        obstacles.append((z.low if z.low > price else z.high, f"zona S/R {tf}"))
        for p in ctx.pools("M1"):
            if not p.swept:
                obstacles.append((p.price, f"liquidez M1 ({'acima' if p.price > price else 'abaixo'})"))
        fib = getattr(ctx, "_fib_taxas", None)
        if fib:
            obstacles += fib
        vp = ctx.profile(ctx.focus_tf)
        if vp:
            obstacles.append((vp.poc, f"POC {ctx.focus_tf}"))
        rep.data["room"] = {}
        for d in (BULL, BEAR):
            ahead = [(abs(v - price), nm) for v, nm in obstacles if (v - price) * d > 0.05 * a1]
            if not ahead:
                continue
            dist, nm = min(ahead)
            ratio = dist / exp_move if exp_move else 9
            rep.data["room"][DIR_LABEL[d]] = {"obstacle": nm, "dist": dist, "ratio": round(ratio, 2)}
            if ratio < 0.6 and any(e.direction == d for e in rep.evidence):
                self.ev(rep, "no_room", f"Pouco espaço para {DIR_LABEL[d]}: {nm} a {dist / a1:.1f} ATR M1, "
                                        f"menor que o movimento esperado até a expiração ({remaining}s)", -d, 0.4, 0.6, "M1")
        if not rep.evidence:
            rep.summary = f"Sem pressão clara no M1 ({remaining}s até a expiração)."
        return rep


# =========================================================================== 16
class ResearchAgent(Agent):
    code, number, name, group = "RES", 16, "Pesquisador de Estratégias", "research"
    specialty = "Pesquisa vídeos-aula, artigos e estudos; transforma ideias em indicadores testados"
    personality = "Curioso e cético: toda ideia vinda de vídeo é hipótese até passar no laboratório."
    methodology = ("Busca materiais (YouTube, Wikipédia, arXiv), avalia credibilidade (promessas de lucro, afiliados e "
                   "martingale são sinalizados), extrai indicadores e parâmetros citados e testa cada um nos dados "
                   "históricos (estudo × validação, teste binomial). Nas reuniões só usa indicadores APROVADOS.")

    def analyze(self, ctx: MarketContext) -> AgentReport:
        from ..research.indicators_lab import CATALOG, describe, last_signal
        rep = self.new_report(ctx)
        mem = ctx.memory
        approved = [r for r in (mem.research_indicators("aprovado") if mem is not None and hasattr(mem, "research_indicators") else [])
                    if r["tf"] == ctx.focus_tf]
        rep.data["approved"] = [r["label"] for r in approved]
        if not approved:
            rep.abstain = True
            rep.summary = (f"Nenhum indicador da pesquisa aprovado para {ctx.focus_tf} ainda. "
                           "Os candidatos ficam no laboratório até provarem vantagem estatística.")
            return rep
        cs = ctx.candles(ctx.focus_tf) or []
        if len(cs) < 120:
            rep.abstain = True
            return rep
        for r in approved:
            if r["key"] not in CATALOG:
                continue
            s = last_signal(r["key"], cs, r["params"])
            if s:
                oos = (r["result"] or {}).get("out_sample") or {}
                edge = (oos.get("rate") or 0.5) - (r["result"] or {}).get("breakeven", 0.556)
                self.ev(rep, "research_signal", f"{describe(r['key'], r['params'])}: sinal de {DIR_LABEL[s]} "
                                                f"(validado: {oos.get('rate', 0):.1%} em {oos.get('n')} sinais fora da amostra)",
                        s, 0.45, min(1.0, 0.4 + edge * 5), ctx.focus_tf)
        if not rep.evidence:
            rep.summary = f"Indicadores aprovados ({len(approved)}) sem sinal na última vela fechada."
        return rep


# =========================================================================== 17
def current_leg(ctx: MarketContext, tf: str):
    """Perna atual: a que gerou o último rompimento; sem tendência definida, os dois últimos pivôs opostos."""
    lg = RetracementAgent().leg(ctx, tf)
    if lg:
        return lg
    sw = ctx.swings(tf)
    if len(sw) < 2:
        return None
    b = sw[-1]
    a = next((s for s in reversed(sw[:-1]) if s.kind != b.kind), None)
    if a is None:
        return None
    return (a, b, 1 if b.kind == "H" else -1)


def leg_fib(ctx: MarketContext, tf: str) -> Optional[dict]:
    lg = current_leg(ctx, tf)
    atr = ctx.atr(tf)
    if not lg or not atr:
        return None
    a, b, d = lg
    if abs(b.price - a.price) < 1.5 * atr:
        return None
    lo, hi = (a.price, b.price) if d == 1 else (b.price, a.price)
    return {"tf": tf, "low": lo, "high": hi, "dir": d, "t1": a.ts, "t2": b.ts, "label": f"PERNA {tf}",
            "ref": f"perna de {DIR_LABEL[d]} {tf}: {_fmt(a.price)} → {_fmt(b.price)}", "levels": ind.fib_levels(lo, hi, d)}


class PullbackAgent(Agent):
    code, number, name, group = "PB", 17, "Pullback", "pullback"
    specialty = "Pullback após rompimento: reteste do nível rompido, zona 0,5–0,705, FVG/OB e retomada"
    personality = "Paciente: não persegue o preço; espera ele voltar e mostrar que o rompimento se sustenta."
    methodology = ("Depois de um BOS, mede a perna do impulso e acompanha o recuo. Pullback válido = preço volta à zona "
                   "de valor (Fibonacci 0,5–0,705 da perna, reteste do nível rompido ou FVG/OB a favor) SEM fechar além da "
                   "origem da perna e SEM CHoCH contra, e a última vela fechada mostra rejeição a favor do rompimento. "
                   "Estados: aguardando pullback · em pullback · pullback confirmado · pullback falhou.")

    def analyze(self, ctx: MarketContext) -> AgentReport:
        rep = self.new_report(ctx)
        tf = ctx.focus_tf
        cs = ctx.candles(tf)
        atr = ctx.atr(tf)
        if not cs or len(cs) < 80 or not atr:
            rep.abstain = True
            return rep
        st = ctx.structure(tf)
        bos = [e for e in st.events if e.kind == "BOS"]
        if not bos:
            rep.summary = "Sem BOS recente: não há rompimento para esperar pullback."
            rep.data["state"] = "sem rompimento"
            return rep
        e = bos[-1]
        d = e.direction
        n = len(cs)
        after = cs[e.idx:]
        ext = max(c.high for c in after) if d == 1 else min(c.low for c in after)
        seg = cs[max(0, e.idx - 60):e.idx + 1]
        origin = min(c.low for c in seg) if d == 1 else max(c.high for c in seg)
        rng = abs(ext - origin)
        if rng < 1.5 * atr:
            rep.summary = "Impulso pequeno demais para medir pullback."
            return rep
        price = cs[-1].close
        retr = (ext - price) / rng if d == 1 else (price - ext) / rng
        lo, hi = (origin, ext) if d == 1 else (ext, origin)
        fib = ind.fib_levels(lo, hi, d)
        z1, z2 = sorted((fib["0.500"], fib["0.705"]))
        later_choch = [x for x in st.events if x.idx > e.idx and x.kind == "CHOCH" and x.direction == -d]
        broke_origin = (price < origin) if d == 1 else (price > origin)
        rep.data.update({"bos": {"ts": e.ts, "level": e.level, "dir": d}, "leg": {"origin": origin, "extreme": ext,
                         "t1": seg[0].ts if seg else e.ts, "t2": e.ts}, "retr": round(retr, 3), "zone": [z1, z2],
                         "fib": {k: fib[k] for k in ("0.382", "0.500", "0.618", "0.705", "0.786")}})
        if later_choch or broke_origin:
            rep.data["state"] = "pullback falhou"
            self.ev(rep, "pullback_failed", f"Pullback do BOS de {DIR_LABEL[d]} falhou "
                                            f"({'CHoCH contra' if later_choch else 'fechou além da origem da perna'})",
                    -d, 0.35, 0.55, tf)
            return rep
        confl = []
        if z1 - 0.15 * atr <= price <= z2 + 0.15 * atr:
            confl.append(f"zona 0,5–0,705 da perna ({_fmt(z1)}–{_fmt(z2)})")
        if abs(price - e.level) <= 0.35 * atr:
            confl.append(f"reteste do nível rompido {_fmt(e.level)}")
        for z in ind.fair_value_gaps(cs[-120:], 0.15 * atr):
            if not z.mitigated and z.direction == d and z.low - 0.2 * atr <= price <= z.high + 0.2 * atr:
                confl.append(f"FVG a favor [{_fmt(z.low)}–{_fmt(z.high)}]")
                break
        if retr < 0.236:
            rep.data["state"] = "aguardando pullback"
            rep.summary = (f"BOS de {DIR_LABEL[d]} em {_fmt(e.level)}; preço ainda perto do extremo — aguardando o "
                           f"pullback para a zona {_fmt(z1)}–{_fmt(z2)}.")
            return rep
        last = cs[-1]
        rejection = ind.wick_rejection(last) == d or ((last.close - last.open) * d > 0 and last.body > 0.4 * last.range)
        ctx_tf = "M5" if tf == "M1" else "M15" if tf == "M5" else "H1"
        htf = ctx.structure(ctx_tf).trend if ctx.enough(ctx_tf, 60) else 0
        if htf == d:
            confl.append(f"tendência {ctx_tf} a favor")
        if confl and rejection:
            rep.data["state"] = "pullback confirmado"
            q = min(1.0, 0.4 + 0.15 * len(confl))
            self.ev(rep, "pullback_confirmed", f"Pullback confirmado no BOS de {DIR_LABEL[d]}: recuo de {retr:.0%}, "
                                               + "; ".join(confl) + ", rejeição na última vela fechada", d, 0.65, q, tf)
        elif confl:
            rep.data["state"] = "em pullback"
            rep.warnings.append(f"Em pullback ({retr:.0%}) na região de valor ({'; '.join(confl)}) — falta a vela de rejeição.")
            self.ev(rep, "pullback_zone", f"Preço em pullback na região de valor do BOS de {DIR_LABEL[d]}", d, 0.3, 0.45, tf)
        else:
            rep.data["state"] = "em pullback"
            rep.summary = f"Recuo de {retr:.0%} do BOS de {DIR_LABEL[d]}, ainda fora da região de valor ({_fmt(z1)}–{_fmt(z2)})."
        return rep


SPECIALISTS = [NewsAgent, PriceActionAgent, RetracementAgent, ReversalAgent, VolumeRSIAgent, VolumeProfileAgent,
               SupportResistanceAgent, FibonacciAgent, MultiTimeframeAgent, LiquidityHunterAgent, UserIndicatorsAgent, TrendlineAgent, TimingAgent, ResearchAgent, PullbackAgent]
