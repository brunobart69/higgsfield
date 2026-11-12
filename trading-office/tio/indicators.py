"""Indicadores e detectores estruturais (Python puro, sem lookahead).

Todas as funções recebem apenas candles FECHADOS. Pivôs (swings) só são
confirmados quando existem `right` candles fechados à direita do pivô.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

from .models import Candle

FIB_RETRACEMENTS = [0.236, 0.382, 0.5, 0.618, 0.705, 0.786]
FIB_EXTENSIONS = [1.272, 1.618, 2.0]


# --------------------------------------------------------------------------- #
# Médias, RSI, ATR
# --------------------------------------------------------------------------- #
def ema(values: list[float], n: int) -> list[float]:
    if not values:
        return []
    k = 2.0 / (n + 1)
    out = [values[0]]
    for v in values[1:]:
        out.append(v * k + out[-1] * (1 - k))
    return out


def sma(values: list[float], n: int) -> Optional[float]:
    if len(values) < n or n <= 0:
        return None
    return sum(values[-n:]) / n


def rsi(closes: list[float], n: int = 14) -> list[Optional[float]]:
    """RSI de Wilder. Retorna lista alinhada com `closes` (None no aquecimento)."""
    out: list[Optional[float]] = [None] * len(closes)
    if len(closes) <= n:
        return out
    gains = losses = 0.0
    for i in range(1, n + 1):
        d = closes[i] - closes[i - 1]
        gains += max(d, 0.0)
        losses += max(-d, 0.0)
    ag, al = gains / n, losses / n
    out[n] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    for i in range(n + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        ag = (ag * (n - 1) + max(d, 0.0)) / n
        al = (al * (n - 1) + max(-d, 0.0)) / n
        out[i] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    return out


def atr(candles: list[Candle], n: int = 14) -> list[Optional[float]]:
    out: list[Optional[float]] = [None] * len(candles)
    if len(candles) <= n:
        return out
    trs = [candles[0].range]
    for i in range(1, len(candles)):
        c, p = candles[i], candles[i - 1]
        trs.append(max(c.high - c.low, abs(c.high - p.close), abs(c.low - p.close)))
    a = sum(trs[1:n + 1]) / n
    out[n] = a
    for i in range(n + 1, len(candles)):
        a = (a * (n - 1) + trs[i]) / n
        out[i] = a
    return out


def last_atr(candles: list[Candle], n: int = 14) -> Optional[float]:
    vals = atr(candles, n)
    return vals[-1] if vals else None


# --------------------------------------------------------------------------- #
# Pivôs e estrutura
# --------------------------------------------------------------------------- #
@dataclass
class Swing:
    idx: int
    ts: int
    price: float
    kind: str  # "H" ou "L"


def swings(candles: list[Candle], left: int = 3, right: int = 3) -> list[Swing]:
    out: list[Swing] = []
    n = len(candles)
    H = [c.high for c in candles]
    L = [c.low for c in candles]
    for i in range(left, n - right):
        h, l = H[i], L[i]
        if h >= max(H[i - left:i]) and h > max(H[i + 1:i + right + 1]):
            out.append(Swing(i, candles[i].ts, h, "H"))
        if l <= min(L[i - left:i]) and l < min(L[i + 1:i + right + 1]):
            out.append(Swing(i, candles[i].ts, l, "L"))
    return out


@dataclass
class StructureEvent:
    idx: int
    ts: int
    kind: str       # "BOS" ou "CHOCH"
    direction: int  # +1 / -1
    level: float


@dataclass
class Structure:
    trend: int                     # +1, -1, 0 (indefinida)
    events: list[StructureEvent] = field(default_factory=list)
    last_high: Optional[Swing] = None
    last_low: Optional[Swing] = None
    hh_hl: int = 0                 # contagem de topos/fundos ascendentes recentes
    lh_ll: int = 0


def market_structure(candles: list[Candle], sw: list[Swing], right: int = 3) -> Structure:
    """BOS/CHOCH por FECHAMENTO além do último pivô confirmado."""
    st = Structure(trend=0)
    by_idx: dict[int, list[Swing]] = {}
    for s in sw:
        by_idx.setdefault(s.idx, []).append(s)
    # pivô em idx só é conhecido em idx+right; usamos a ordem de confirmação aproximada
    pending = sorted(sw, key=lambda s: s.idx)
    pi = 0
    broken_h = broken_l = None
    for i, c in enumerate(candles):
        while pi < len(pending) and pending[pi].idx + right <= i:
            s = pending[pi]
            if s.kind == "H":
                st.last_high = s
            else:
                st.last_low = s
            pi += 1
        if st.last_high and broken_h is not st.last_high and c.close > st.last_high.price:
            kind = "CHOCH" if st.trend == -1 else "BOS"
            st.events.append(StructureEvent(i, c.ts, kind, 1, st.last_high.price))
            st.trend = 1
            broken_h = st.last_high
        elif st.last_low and broken_l is not st.last_low and c.close < st.last_low.price:
            kind = "CHOCH" if st.trend == 1 else "BOS"
            st.events.append(StructureEvent(i, c.ts, kind, -1, st.last_low.price))
            st.trend = -1
            broken_l = st.last_low
    highs = [s for s in sw if s.kind == "H"][-3:]
    lows = [s for s in sw if s.kind == "L"][-3:]
    st.hh_hl = sum(1 for a, b in zip(highs, highs[1:]) if b.price > a.price) + \
        sum(1 for a, b in zip(lows, lows[1:]) if b.price > a.price)
    st.lh_ll = sum(1 for a, b in zip(highs, highs[1:]) if b.price < a.price) + \
        sum(1 for a, b in zip(lows, lows[1:]) if b.price < a.price)
    return st


# --------------------------------------------------------------------------- #
# Deslocamento, FVG e Order Blocks
# --------------------------------------------------------------------------- #
@dataclass
class Zone:
    low: float
    high: float
    direction: int
    ts: int
    idx: int
    kind: str
    mitigated: bool = False
    touches: int = 0

    @property
    def mid(self) -> float:
        return (self.low + self.high) / 2


def displacements(candles: list[Candle], atr_vals: list[Optional[float]], k: float = 1.6) -> list[int]:
    """Índices de candles com corpo > k*ATR (impulso forte)."""
    out = []
    for i, c in enumerate(candles):
        a = atr_vals[i - 1] if i > 0 else None
        if a and c.body > k * a and c.body > 0.6 * c.range:
            out.append(i)
    return out


def fair_value_gaps(candles: list[Candle], min_size: float = 0.0) -> list[Zone]:
    out: list[Zone] = []
    for i in range(2, len(candles)):
        a, c = candles[i - 2], candles[i]
        if c.low > a.high and c.low - a.high > min_size:
            out.append(Zone(a.high, c.low, 1, candles[i - 1].ts, i - 1, "FVG"))
        elif c.high < a.low and a.low - c.high > min_size:
            out.append(Zone(c.high, a.low, -1, candles[i - 1].ts, i - 1, "FVG"))
    for z in out:
        for c in candles[z.idx + 2:]:
            if z.direction == 1 and c.low <= z.low:
                z.mitigated = True
                break
            if z.direction == -1 and c.high >= z.high:
                z.mitigated = True
                break
    return out


def order_blocks(candles: list[Candle], disp_idx: list[int]) -> list[Zone]:
    out: list[Zone] = []
    for i in disp_idx:
        d = 1 if candles[i].bullish else -1
        for j in range(i - 1, max(i - 4, -1), -1):
            cj = candles[j]
            if (d == 1 and cj.bearish) or (d == -1 and cj.bullish):
                z = Zone(cj.low, cj.high, d, cj.ts, j, "OB")
                for c in candles[i + 1:]:
                    if d == 1 and c.low <= z.high:
                        z.touches += 1
                        if c.close < z.low:
                            z.mitigated = True
                            break
                    if d == -1 and c.high >= z.low:
                        z.touches += 1
                        if c.close > z.high:
                            z.mitigated = True
                            break
                out.append(z)
                break
    return out


# --------------------------------------------------------------------------- #
# Volume Profile
# --------------------------------------------------------------------------- #
@dataclass
class VolumeProfile:
    poc: float
    vah: float
    val: float
    bins: list[tuple[float, float]]  # (preço central, volume)
    mode: str                        # "volume" ou "tpo"
    hvn: list[float]
    lvn: list[float]


def volume_profile(candles: list[Candle], nbins: int = 40, va: float = 0.70) -> Optional[VolumeProfile]:
    if len(candles) < 10:
        return None
    lo = min(c.low for c in candles)
    hi = max(c.high for c in candles)
    if hi <= lo:
        return None
    step = (hi - lo) / nbins
    vols = [0.0] * nbins
    use_volume = sum(c.volume for c in candles) > 0
    for c in candles:
        w = c.volume if use_volume else 1.0
        b0 = min(nbins - 1, int((c.low - lo) / step))
        b1 = min(nbins - 1, int((c.high - lo) / step))
        cnt = b1 - b0 + 1
        for b in range(b0, b1 + 1):
            vols[b] += w / cnt
    poc_i = max(range(nbins), key=lambda i: vols[i])
    total = sum(vols)
    inc = vols[poc_i]
    lo_i = hi_i = poc_i
    while inc < va * total and (lo_i > 0 or hi_i < nbins - 1):
        up = vols[hi_i + 1] if hi_i < nbins - 1 else -1
        dn = vols[lo_i - 1] if lo_i > 0 else -1
        if up >= dn:
            hi_i += 1
            inc += up
        else:
            lo_i -= 1
            inc += dn
    centers = [lo + (i + 0.5) * step for i in range(nbins)]
    mean = total / nbins
    hvn = [centers[i] for i in range(1, nbins - 1) if vols[i] > 1.3 * mean and vols[i] >= vols[i - 1] and vols[i] >= vols[i + 1]]
    lvn = [centers[i] for i in range(1, nbins - 1) if vols[i] < 0.5 * mean and vols[i] <= vols[i - 1] and vols[i] <= vols[i + 1]]
    return VolumeProfile(
        poc=centers[poc_i], vah=lo + (hi_i + 1) * step, val=lo + lo_i * step,
        bins=list(zip(centers, vols)), mode="volume" if use_volume else "tpo", hvn=hvn, lvn=lvn,
    )


# --------------------------------------------------------------------------- #
# Fibonacci
# --------------------------------------------------------------------------- #
def fib_levels(low: float, high: float, direction: int) -> dict[str, float]:
    """direction=+1: impulso de alta (retração mede de high para baixo)."""
    rng = high - low
    out = {}
    for r in FIB_RETRACEMENTS:
        out[f"{r:.3f}"] = high - rng * r if direction == 1 else low + rng * r
    for e in FIB_EXTENSIONS:
        out[f"ext {e:.3f}"] = low + rng * e if direction == 1 else high - rng * e
    return out


# --------------------------------------------------------------------------- #
# Suporte/resistência e liquidez
# --------------------------------------------------------------------------- #
@dataclass
class SRZone:
    low: float
    high: float
    touches: int
    last_ts: int
    closes_respected: int
    breaks: int
    kinds: str  # "H", "L" ou "HL"

    @property
    def mid(self) -> float:
        return (self.low + self.high) / 2


def sr_zones(candles: list[Candle], sw: list[Swing], tol: float) -> list[SRZone]:
    pts = sorted(sw, key=lambda s: s.price)
    clusters: list[list[Swing]] = []
    for s in pts:
        if clusters and s.price - clusters[-1][-1].price <= tol:
            clusters[-1].append(s)
        else:
            clusters.append([s])
    zones = []
    for cl in clusters:
        lo = min(s.price for s in cl) - tol * 0.25
        hi = max(s.price for s in cl) + tol * 0.25
        first = min(s.idx for s in cl)
        respected = breaks = 0
        side = None
        for c in candles[first + 1:]:
            s_now = 1 if c.close > hi else (-1 if c.close < lo else 0)
            touched = c.low <= hi and c.high >= lo
            if s_now and side:
                if s_now != side:
                    breaks += 1          # rompimento confirmado por fechamento
                elif touched:
                    respected += 1       # tocou e fechou do mesmo lado: reação
            if s_now:
                side = s_now
        kinds = "".join(sorted({s.kind for s in cl}))
        zones.append(SRZone(lo, hi, len(cl), max(s.ts for s in cl), respected, breaks, kinds))
    return zones


@dataclass
class LiquidityPool:
    price: float
    side: str        # "acima" (buy-side) ou "abaixo" (sell-side)
    kind: str        # "equal_highs", "equal_lows", "prev_high", "prev_low", "swing"
    count: int
    ts: int
    swept: bool = False
    swept_ts: Optional[int] = None
    external: bool = False


def liquidity_pools(candles: list[Candle], sw: list[Swing], tol: float) -> list[LiquidityPool]:
    pools: list[LiquidityPool] = []
    highs = [s for s in sw if s.kind == "H"]
    lows = [s for s in sw if s.kind == "L"]

    def group(points: list[Swing], kind: str, side: str):
        used = set()
        for i, a in enumerate(points):
            if i in used:
                continue
            eq = [a]
            for j in range(i + 1, len(points)):
                if abs(points[j].price - a.price) <= tol:
                    eq.append(points[j])
                    used.add(j)
            price = max(s.price for s in eq) if side == "acima" else min(s.price for s in eq)
            k = kind if len(eq) >= 2 else "swing"
            last_idx = max(s.idx for s in eq)
            pool = LiquidityPool(price, side, k, len(eq), max(s.ts for s in eq))
            for c in candles[last_idx + 1:]:
                if (side == "acima" and c.high > price) or (side == "abaixo" and c.low < price):
                    pool.swept = True
                    pool.swept_ts = c.ts
                    break
            pools.append(pool)

    group(highs, "equal_highs", "acima")
    group(lows, "equal_lows", "abaixo")
    if candles:
        rng_hi = max(c.high for c in candles)
        rng_lo = min(c.low for c in candles)
        for p in pools:
            p.external = abs(p.price - rng_hi) <= tol or abs(p.price - rng_lo) <= tol
    return pools


@dataclass
class Sweep:
    idx: int
    ts: int
    level: float
    direction: int  # +1: varreu mínimas e fechou acima (favorece alta); -1 o contrário


def detect_sweeps(candles: list[Candle], pools: list[LiquidityPool], lookback: int = 6) -> list[Sweep]:
    """Varredura: pavio além do nível e FECHAMENTO de volta para dentro."""
    out = []
    start = max(0, len(candles) - lookback)
    for i in range(start, len(candles)):
        c = candles[i]
        for p in pools:
            if p.ts >= c.ts:
                continue
            if p.side == "abaixo" and c.low < p.price < c.close and (p.swept_ts is None or p.swept_ts == c.ts):
                out.append(Sweep(i, c.ts, p.price, 1))
            elif p.side == "acima" and c.high > p.price > c.close and (p.swept_ts is None or p.swept_ts == c.ts):
                out.append(Sweep(i, c.ts, p.price, -1))
    return out


# --------------------------------------------------------------------------- #
# Divergências e utilidades
# --------------------------------------------------------------------------- #
def rsi_divergence(candles: list[Candle], rsi_vals: list[Optional[float]], sw: list[Swing]) -> Optional[tuple[int, str]]:
    """Divergência regular entre os dois últimos pivôs do mesmo tipo."""
    highs = [s for s in sw if s.kind == "H" and rsi_vals[s.idx] is not None][-2:]
    lows = [s for s in sw if s.kind == "L" and rsi_vals[s.idx] is not None][-2:]
    res = None
    if len(highs) == 2 and highs[1].price > highs[0].price and rsi_vals[highs[1].idx] < rsi_vals[highs[0].idx] - 2:
        res = (-1, f"topo mais alto ({highs[1].price:.5g}) com RSI menor ({rsi_vals[highs[1].idx]:.1f} < {rsi_vals[highs[0].idx]:.1f})", highs[1].idx)
    if len(lows) == 2 and lows[1].price < lows[0].price and rsi_vals[lows[1].idx] > rsi_vals[lows[0].idx] + 2:
        cand = (1, f"fundo mais baixo ({lows[1].price:.5g}) com RSI maior ({rsi_vals[lows[1].idx]:.1f} > {rsi_vals[lows[0].idx]:.1f})", lows[1].idx)
        if res is None or cand[2] > res[2]:
            res = cand
    if res and len(candles) - res[2] <= 25:
        return res[0], res[1]
    return None


def wick_rejection(c: Candle) -> int:
    """+1 pavio inferior dominante (rejeição de baixa), -1 pavio superior dominante."""
    if c.range <= 0:
        return 0
    upper = c.high - max(c.open, c.close)
    lower = min(c.open, c.close) - c.low
    if lower > 0.55 * c.range and c.body < 0.35 * c.range:
        return 1
    if upper > 0.55 * c.range and c.body < 0.35 * c.range:
        return -1
    return 0


def slope(values: list[float], n: int) -> float:
    if len(values) < n or n < 2:
        return 0.0
    ys = values[-n:]
    xm = (n - 1) / 2
    ym = sum(ys) / n
    num = sum((i - xm) * (y - ym) for i, y in enumerate(ys))
    den = sum((i - xm) ** 2 for i in range(n))
    return num / den if den else 0.0


def median(values: list[float]) -> Optional[float]:
    v = sorted(x for x in values if x is not None)
    if not v:
        return None
    m = len(v) // 2
    return v[m] if len(v) % 2 else (v[m - 1] + v[m]) / 2


def wilson(wins: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = wins / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (max(0.0, centre - half), min(1.0, centre + half))


# --------------------------------------------------------------------------- #
# Linhas de tendência (LTA / LTB)
# --------------------------------------------------------------------------- #
@dataclass
class TrendLine:
    kind: str            # "LTA" (liga fundos, suporte) ou "LTB" (liga topos, resistência)
    i1: int
    p1: float
    i2: int
    p2: float
    touches: int
    slope: float         # preço por candle

    def value_at(self, i: int) -> float:
        return self.p1 + self.slope * (i - self.i1)


def trend_lines(candles: list[Candle], sw: list[Swing], atr_value: float, max_points: int = 10) -> list[TrendLine]:
    """Linhas ligando pivôs confirmados, com ao menos 3 toques e sem fechamento além da linha.

    Um rompimento nas 2 últimas velas fechadas é mantido (é o próprio evento de rompimento).
    """
    if not candles or not atr_value:
        return []
    n = len(candles)
    tol = 0.18 * atr_value
    out: list[TrendLine] = []
    for kind, pts in (("LTA", [s for s in sw if s.kind == "L"][-max_points:]),
                      ("LTB", [s for s in sw if s.kind == "H"][-max_points:])):
        best = None
        for a in range(len(pts)):
            for b in range(a + 1, len(pts)):
                s1, s2 = pts[a], pts[b]
                if s2.idx - s1.idx < 5:
                    continue
                if kind == "LTA" and s2.price <= s1.price:
                    continue
                if kind == "LTB" and s2.price >= s1.price:
                    continue
                slope = (s2.price - s1.price) / (s2.idx - s1.idx)
                line = TrendLine(kind, s1.idx, s1.price, s2.idx, s2.price, 0, slope)
                touches = sum(1 for s in pts if s.idx >= s1.idx and abs(s.price - line.value_at(s.idx)) <= tol)
                if touches < 3:
                    continue
                broken_early = False
                for i in range(s1.idx, max(s1.idx, n - 2)):
                    v = line.value_at(i)
                    c = candles[i].close
                    if (kind == "LTA" and c < v - tol) or (kind == "LTB" and c > v + tol):
                        broken_early = True
                        break
                if broken_early:
                    continue
                line.touches = touches
                score = touches * 10 + s2.idx / n
                if best is None or score > best[0]:
                    best = (score, line)
        if best:
            out.append(best[1])
    return out
