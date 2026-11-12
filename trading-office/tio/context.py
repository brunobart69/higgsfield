"""MarketContext: visão do mercado *até* um instante `as_of` (sem dados futuros)."""
from __future__ import annotations

import bisect
from dataclasses import dataclass, field
from typing import Any, Optional

from . import indicators as ind
from .data.news import NewsStore
from .data.providers import Provider, closed_only, resample
from .models import TIMEFRAMES, TF_SECONDS, Candle, Series

WINDOW = {"Y1": 30, "MN": 120, "W1": 260, "D1": 400, "H4": 400, "H1": 400, "M30": 400, "M15": 400, "M5": 400, "M1": 400}


class MarketData:
    """Todas as temporalidades de um ativo, pré-indexadas por instante de fechamento.

    Temporalidades maiores que a base são reamostradas da base (ou carregadas da
    fonte, quando disponíveis). Menores que a base só existem se a fonte fornecer.
    """

    def __init__(self, asset: str, base: Series, extra: Optional[dict[str, Series]] = None):
        self.asset = asset
        self.base_tf = base.timeframe
        self.source = base.source
        self.synthetic = base.synthetic
        self.volume_kind = base.volume_kind
        self.indicators: dict = {}   # exportações de indicadores do usuário (MT5): (nome, tf) -> IndicatorExport
        self.chart_objects: dict = {}  # marcações desenhadas no MT5: tf -> [objetos]
        self.chart_indicators: list = []  # indicadores aplicados nos gráficos desse ativo
        self.tf: dict[str, list[Candle]] = {self.base_tf: base.candles}
        base_sec = TF_SECONDS[self.base_tf]
        extra = extra or {}
        for tf in TIMEFRAMES:
            if tf == self.base_tf:
                continue
            if tf in extra and extra[tf] and len(extra[tf]):
                self.tf[tf] = extra[tf].candles
            elif TF_SECONDS[tf] > base_sec:
                self.tf[tf] = resample(base.candles, tf)
        self._close_ts = {tf: [c.close_ts for c in cs] for tf, cs in self.tf.items()}

    @classmethod
    def load(cls, provider: Provider, asset: str, base_tf: str = "M15", extra_tfs: tuple[str, ...] = ()) -> Optional["MarketData"]:
        base = provider.load(asset, base_tf)
        if base is not None:
            base.candles = closed_only(base.candles)  # descarta o candle ainda em formação
        if base is None or len(base) == 0:
            return None
        extra = {}
        for tf in extra_tfs:
            s = provider.load(asset, tf)
            if s is not None:
                extra[tf] = s
        return cls(asset, base, extra)

    @property
    def base(self) -> list[Candle]:
        return self.tf[self.base_tf]

    def closed(self, tf: str, as_of: int, window: Optional[int] = None) -> Optional[list[Candle]]:
        if tf not in self.tf:
            return None
        k = bisect.bisect_right(self._close_ts[tf], as_of)
        w = window or WINDOW.get(tf, 400)
        return self.tf[tf][max(0, k - w):k]

    def context(self, as_of: Optional[int] = None, news: Optional[NewsStore] = None, memory=None, params=None,
                focus_tf: Optional[str] = None) -> "MarketContext":
        if as_of is None:
            as_of = self.base[-1].close_ts
        return MarketContext(self, as_of, news, memory, params, focus_tf or self.base_tf)


@dataclass
class MarketContext:
    data: MarketData
    as_of: int
    news: Optional[NewsStore]
    memory: Any
    params: Any
    focus_tf: str
    _cache: dict = field(default_factory=dict)

    @property
    def asset(self) -> str:
        return self.data.asset

    @property
    def base_tf(self) -> str:
        return self.data.base_tf

    def candles(self, tf: Optional[str] = None) -> Optional[list[Candle]]:
        tf = tf or self.focus_tf
        key = ("c", tf)
        if key not in self._cache:
            self._cache[key] = self.data.closed(tf, self.as_of)
        return self._cache[key]

    def enough(self, tf: str, n: int = 60) -> bool:
        cs = self.candles(tf)
        return cs is not None and len(cs) >= n

    @property
    def price(self) -> float:
        return self.data.closed(self.base_tf, self.as_of, 1)[-1].close

    # ------------------------------------------------------------------ cache
    def _get(self, key, fn):
        if key not in self._cache:
            self._cache[key] = fn()
        return self._cache[key]

    def atr(self, tf: Optional[str] = None) -> Optional[float]:
        tf = tf or self.focus_tf
        return self._get(("atr", tf), lambda: ind.last_atr(self.candles(tf) or []))

    def atr_series(self, tf: Optional[str] = None):
        tf = tf or self.focus_tf
        return self._get(("atrs", tf), lambda: ind.atr(self.candles(tf) or []))

    def swings(self, tf: Optional[str] = None, left: int = 3, right: int = 3):
        tf = tf or self.focus_tf
        return self._get(("sw", tf, left, right), lambda: ind.swings(self.candles(tf) or [], left, right))

    def structure(self, tf: Optional[str] = None):
        tf = tf or self.focus_tf
        return self._get(("st", tf), lambda: ind.market_structure(self.candles(tf) or [], self.swings(tf)))

    def rsi(self, tf: Optional[str] = None, n: int = 14):
        tf = tf or self.focus_tf
        return self._get(("rsi", tf, n), lambda: ind.rsi([c.close for c in self.candles(tf) or []], n))

    def ema(self, tf: str, n: int):
        return self._get(("ema", tf, n), lambda: ind.ema([c.close for c in self.candles(tf) or []], n))

    def pools(self, tf: Optional[str] = None):
        tf = tf or self.focus_tf
        a = self.atr(tf) or 0
        return self._get(("pools", tf), lambda: ind.liquidity_pools(self.candles(tf) or [], self.swings(tf), 0.12 * a))

    def zones(self, tf: str):
        a = self.atr(tf) or 0
        return self._get(("zones", tf), lambda: ind.sr_zones(self.candles(tf) or [], self.swings(tf), 0.35 * a))

    def profile(self, tf: Optional[str] = None, bars: int = 200):
        tf = tf or self.focus_tf
        return self._get(("vp", tf, bars), lambda: ind.volume_profile((self.candles(tf) or [])[-bars:]))
