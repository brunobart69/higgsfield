"""Biblioteca de indicadores candidatos (pesquisa) com regra de sinal para opções binárias.

Cada indicador é calculado só com velas FECHADAS até o índice i (sem lookahead) e devolve
+1 (CALL), -1 (PUT) ou 0 na vela i. O sinal vale para a vela seguinte (entrada na abertura,
expiração no fechamento dela) — o mesmo ticket da mesa M1/M5.
"""
from __future__ import annotations

from typing import Callable

from .. import indicators as ind
from ..models import Candle


def _sma(v, n):
    out, s = [None] * len(v), 0.0
    for i, x in enumerate(v):
        s += x
        if i >= n:
            s -= v[i - n]
        if i >= n - 1:
            out[i] = s / n
    return out


def _std(v, n, m):
    out = [None] * len(v)
    for i in range(n - 1, len(v)):
        w = v[i - n + 1:i + 1]
        out[i] = (sum((x - m[i]) ** 2 for x in w) / n) ** 0.5
    return out


def _cross(a, b, i):
    """+1 se a cruzou b para cima na vela i, -1 para baixo."""
    if i < 1 or None in (a[i], b[i], a[i - 1], b[i - 1]):
        return 0
    if a[i - 1] <= b[i - 1] and a[i] > b[i]:
        return 1
    if a[i - 1] >= b[i - 1] and a[i] < b[i]:
        return -1
    return 0


# ----------------------------------------------------------------------------- séries de sinais
def sig_bollinger(cs: list[Candle], n=20, k=2.0):
    c = [x.close for x in cs]
    m = _sma(c, n)
    sd = _std(c, n, m)
    out = [0] * len(cs)
    for i in range(n, len(cs)):
        up, lo = m[i] + k * sd[i], m[i] - k * sd[i]
        upp, lop = m[i - 1] + k * sd[i - 1], m[i - 1] - k * sd[i - 1]
        if c[i - 1] < lop and c[i] > lo:
            out[i] = 1
        elif c[i - 1] > upp and c[i] < up:
            out[i] = -1
    return out


def sig_stochastic(cs, n=14, d=3, ob=80, os_=20):
    k = [None] * len(cs)
    for i in range(n - 1, len(cs)):
        hh = max(x.high for x in cs[i - n + 1:i + 1])
        ll = min(x.low for x in cs[i - n + 1:i + 1])
        k[i] = 100 * (cs[i].close - ll) / (hh - ll) if hh > ll else 50
    kk = [x if x is not None else 50 for x in k]
    dd = _sma(kk, d)
    out = [0] * len(cs)
    for i in range(n + d, len(cs)):
        x = _cross(kk, dd, i)
        if x == 1 and kk[i] < os_ + 5:
            out[i] = 1
        elif x == -1 and kk[i] > ob - 5:
            out[i] = -1
    return out


def sig_macd(cs, f=12, s=26, sig=9):
    c = [x.close for x in cs]
    ef, es = ind.ema(c, f), ind.ema(c, s)
    line = [a - b for a, b in zip(ef, es)]
    sl = ind.ema(line, sig)
    hist = [a - b for a, b in zip(line, sl)]
    zero = [0.0] * len(cs)
    return [_cross(hist, zero, i) if i > s else 0 for i in range(len(cs))]


def sig_ema_cross(cs, a=9, b=21):
    c = [x.close for x in cs]
    ea, eb = ind.ema(c, a), ind.ema(c, b)
    return [_cross(ea, eb, i) if i > b else 0 for i in range(len(cs))]


def sig_cci(cs, n=20, lvl=100):
    tp = [(x.high + x.low + x.close) / 3 for x in cs]
    m = _sma(tp, n)
    cci = [None] * len(cs)
    for i in range(n - 1, len(cs)):
        md = sum(abs(t - m[i]) for t in tp[i - n + 1:i + 1]) / n
        cci[i] = (tp[i] - m[i]) / (0.015 * md) if md else 0
    out = [0] * len(cs)
    for i in range(n, len(cs)):
        if cci[i - 1] < -lvl <= cci[i]:
            out[i] = 1
        elif cci[i - 1] > lvl >= cci[i]:
            out[i] = -1
    return out


def sig_williams(cs, n=14):
    w = [None] * len(cs)
    for i in range(n - 1, len(cs)):
        hh = max(x.high for x in cs[i - n + 1:i + 1])
        ll = min(x.low for x in cs[i - n + 1:i + 1])
        w[i] = -100 * (hh - cs[i].close) / (hh - ll) if hh > ll else -50
    out = [0] * len(cs)
    for i in range(n, len(cs)):
        if w[i - 1] < -80 <= w[i]:
            out[i] = 1
        elif w[i - 1] > -20 >= w[i]:
            out[i] = -1
    return out


def sig_rsi(cs, n=7, lo=30, hi=70):
    r = ind.rsi([x.close for x in cs], n)
    out = [0] * len(cs)
    for i in range(n + 1, len(cs)):
        if r[i - 1] is None or r[i] is None:
            continue
        if r[i - 1] < lo <= r[i]:
            out[i] = 1
        elif r[i - 1] > hi >= r[i]:
            out[i] = -1
    return out


def _supertrend_dir(cs, n=10, mult=3.0):
    a = ind.atr(cs, n)
    d = [0] * len(cs)
    up = dn = None
    trend = 1
    for i in range(len(cs)):
        if a[i] is None:
            continue
        mid = (cs[i].high + cs[i].low) / 2
        bu, bd = mid - mult * a[i], mid + mult * a[i]
        up = bu if up is None or cs[i - 1].close < up else max(bu, up)
        dn = bd if dn is None or cs[i - 1].close > dn else min(bd, dn)
        if cs[i].close > dn:
            trend = 1
        elif cs[i].close < up:
            trend = -1
        d[i] = trend
    return d


def sig_supertrend(cs, n=10, mult=3.0):
    d = _supertrend_dir(cs, n, mult)
    return [d[i] if i and d[i] and d[i - 1] and d[i] != d[i - 1] else 0 for i in range(len(cs))]


def sig_donchian(cs, n=20):
    out = [0] * len(cs)
    for i in range(n, len(cs)):
        hh = max(x.high for x in cs[i - n:i])
        ll = min(x.low for x in cs[i - n:i])
        if cs[i].close > hh:
            out[i] = 1
        elif cs[i].close < ll:
            out[i] = -1
    return out


def sig_keltner(cs, n=20, mult=2.0):
    c = [x.close for x in cs]
    e = ind.ema(c, n)
    a = ind.atr(cs, n)
    out = [0] * len(cs)
    for i in range(n + 1, len(cs)):
        if a[i] is None or a[i - 1] is None:
            continue
        if c[i - 1] < e[i - 1] - mult * a[i - 1] and c[i] > e[i] - mult * a[i]:
            out[i] = 1
        elif c[i - 1] > e[i - 1] + mult * a[i - 1] and c[i] < e[i] + mult * a[i]:
            out[i] = -1
    return out


def sig_heikin(cs, streak=3):
    ho = hc = None
    col = []
    for x in cs:
        nc = (x.open + x.high + x.low + x.close) / 4
        no = (x.open + x.close) / 2 if ho is None else (ho + hc) / 2
        ho, hc = no, nc
        col.append(1 if nc > no else -1)
    out = [0] * len(cs)
    for i in range(streak, len(cs)):
        if all(col[i - k] == col[i] for k in range(streak)) and col[i - streak] != col[i]:
            out[i] = col[i]
    return out


def sig_psar(cs, step=0.02, mx=0.2):
    if len(cs) < 3:
        return [0] * len(cs)
    trend, ep, af = 1, cs[0].high, step
    sar = cs[0].low
    out = [0] * len(cs)
    for i in range(1, len(cs)):
        sar = sar + af * (ep - sar)
        if trend == 1:
            sar = min(sar, cs[i - 1].low)
            if cs[i].low < sar:
                trend, sar, ep, af = -1, ep, cs[i].low, step
                out[i] = -1
            elif cs[i].high > ep:
                ep, af = cs[i].high, min(mx, af + step)
        else:
            sar = max(sar, cs[i - 1].high)
            if cs[i].high > sar:
                trend, sar, ep, af = 1, ep, cs[i].high, step
                out[i] = 1
            elif cs[i].low < ep:
                ep, af = cs[i].low, min(mx, af + step)
    return out


def sig_ao(cs, a=5, b=34):
    mp = [(x.high + x.low) / 2 for x in cs]
    sa, sb = _sma(mp, a), _sma(mp, b)
    ao = [(x - y) if x is not None and y is not None else None for x, y in zip(sa, sb)]
    zero = [0.0] * len(cs)
    return [_cross(ao, zero, i) for i in range(len(cs))]


def sig_roc(cs, n=10):
    c = [x.close for x in cs]
    roc = [None] * len(cs)
    for i in range(n, len(cs)):
        roc[i] = c[i] - c[i - n]
    zero = [0.0] * len(cs)
    return [_cross(roc, zero, i) for i in range(len(cs))]


def sig_ichimoku(cs, t=9, k=26):
    def mid(i, n):
        w = cs[i - n + 1:i + 1]
        return (max(x.high for x in w) + min(x.low for x in w)) / 2
    tk = [mid(i, t) if i >= t - 1 else None for i in range(len(cs))]
    kj = [mid(i, k) if i >= k - 1 else None for i in range(len(cs))]
    return [_cross(tk, kj, i) for i in range(len(cs))]


def sig_adx_di(cs, n=14, min_adx=20.0):
    pdm, mdm, tr = [0.0], [0.0], [cs[0].range if cs else 0]
    for i in range(1, len(cs)):
        up = cs[i].high - cs[i - 1].high
        dn = cs[i - 1].low - cs[i].low
        pdm.append(up if up > dn and up > 0 else 0.0)
        mdm.append(dn if dn > up and dn > 0 else 0.0)
        tr.append(max(cs[i].high - cs[i].low, abs(cs[i].high - cs[i - 1].close), abs(cs[i].low - cs[i - 1].close)))
    sp, sm, st = ind.ema(pdm, n), ind.ema(mdm, n), ind.ema(tr, n)
    pdi = [100 * a / c if c else 0 for a, c in zip(sp, st)]
    mdi = [100 * a / c if c else 0 for a, c in zip(sm, st)]
    dx = [100 * abs(a - b) / (a + b) if a + b else 0 for a, b in zip(pdi, mdi)]
    adx = ind.ema(dx, n)
    return [(_cross(pdi, mdi, i) if adx[i] >= min_adx else 0) if i > 2 * n else 0 for i in range(len(cs))]


# ----------------------------------------------------------------------------- catálogo
CATALOG: dict[str, dict] = {
    "bollinger": {"name": "Bandas de Bollinger", "fn": sig_bollinger, "params": {"n": 20, "k": 2.0},
                  "rule": "Fechou fora da banda e voltou para dentro → entrada a favor da média (reversão).",
                  "aliases": ["bollinger", "bandas de bollinger", "bb "]},
    "stochastic": {"name": "Estocástico", "fn": sig_stochastic, "params": {"n": 14, "d": 3, "ob": 80, "os_": 20},
                   "rule": "%K cruza %D na sobrevenda (CALL) ou sobrecompra (PUT).",
                   "aliases": ["estocástico", "estocastico", "stochastic", "stoch"]},
    "macd": {"name": "MACD", "fn": sig_macd, "params": {"f": 12, "s": 26, "sig": 9},
             "rule": "Histograma do MACD cruza o zero.", "aliases": ["macd"]},
    "ema_cross": {"name": "Cruzamento de médias", "fn": sig_ema_cross, "params": {"a": 9, "b": 21},
                  "rule": "Média curta cruza a média longa.", "aliases": ["média móvel", "media movel", "médias móveis", "ema", "mme", "cruzamento de médias"]},
    "cci": {"name": "CCI", "fn": sig_cci, "params": {"n": 20, "lvl": 100},
            "rule": "CCI volta para dentro de ±100.", "aliases": ["cci", "commodity channel"]},
    "williams": {"name": "Williams %R", "fn": sig_williams, "params": {"n": 14},
                 "rule": "%R sai da sobrevenda (-80) ou sobrecompra (-20).", "aliases": ["williams", "%r"]},
    "rsi": {"name": "RSI curto", "fn": sig_rsi, "params": {"n": 7, "lo": 30, "hi": 70},
            "rule": "RSI sai da sobrevenda/sobrecompra.", "aliases": ["rsi", "ifr", "índice de força relativa"]},
    "supertrend": {"name": "Supertrend", "fn": sig_supertrend, "params": {"n": 10, "mult": 3.0},
                   "rule": "Virada de direção do Supertrend.", "aliases": ["supertrend", "super trend"]},
    "donchian": {"name": "Canal Donchian", "fn": sig_donchian, "params": {"n": 20},
                 "rule": "Fechamento rompe a máxima/mínima de N velas.", "aliases": ["donchian"]},
    "keltner": {"name": "Canal Keltner", "fn": sig_keltner, "params": {"n": 20, "mult": 2.0},
                "rule": "Fechou fora do canal e voltou para dentro.", "aliases": ["keltner"]},
    "heikin": {"name": "Heikin Ashi", "fn": sig_heikin, "params": {"streak": 3},
               "rule": "Troca de cor do Heikin Ashi confirmada por N velas.", "aliases": ["heikin", "heiken", "ashi"]},
    "psar": {"name": "Parabolic SAR", "fn": sig_psar, "params": {"step": 0.02, "mx": 0.2},
             "rule": "Virada do Parabolic SAR.", "aliases": ["parabolic", "sar"]},
    "ao": {"name": "Awesome Oscillator", "fn": sig_ao, "params": {"a": 5, "b": 34},
           "rule": "AO cruza o zero.", "aliases": ["awesome", "oscilador awesome"]},
    "roc": {"name": "Momentum / ROC", "fn": sig_roc, "params": {"n": 10},
            "rule": "Momentum cruza o zero.", "aliases": ["momentum", "roc", "rate of change"]},
    "ichimoku": {"name": "Ichimoku (Tenkan × Kijun)", "fn": sig_ichimoku, "params": {"t": 9, "k": 26},
                 "rule": "Tenkan cruza a Kijun.", "aliases": ["ichimoku", "tenkan", "kijun"]},
    "adx": {"name": "ADX / DMI", "fn": sig_adx_di, "params": {"n": 14, "min_adx": 20.0},
            "rule": "+DI cruza -DI com ADX acima de 20.", "aliases": ["adx", "dmi"]},
}


def signals(key: str, candles: list[Candle], params: dict | None = None) -> list[int]:
    spec = CATALOG[key]
    p = {**spec["params"], **(params or {})}
    return spec["fn"](candles, **p)


def last_signal(key: str, candles: list[Candle], params: dict | None = None) -> int:
    window = candles[-300:]
    s = signals(key, window, params)
    return s[-1] if s else 0


def describe(key: str, params: dict | None = None) -> str:
    spec = CATALOG[key]
    p = {**spec["params"], **(params or {})}
    return f"{spec['name']} ({', '.join(f'{k}={v}' for k, v in p.items())})"
