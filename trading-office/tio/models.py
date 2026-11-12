"""Estruturas de dados centrais do escritório."""
from __future__ import annotations

import calendar
import datetime as dt
from dataclasses import dataclass, field, asdict
from typing import Any, Optional

# --------------------------------------------------------------------------- #
# Temporalidades
# --------------------------------------------------------------------------- #
TIMEFRAMES = ["Y1", "MN", "W1", "D1", "H4", "H1", "M30", "M15", "M5", "M1"]
TF_SECONDS = {
    "M1": 60, "M5": 300, "M15": 900, "M30": 1800, "H1": 3600, "H4": 14400,
    "D1": 86400, "W1": 604800, "MN": 2_592_000, "Y1": 31_536_000,  # MN/Y1 aproximados
}
TF_LABEL = {
    "Y1": "Anual", "MN": "Mensal", "W1": "Semanal", "D1": "Diário", "H4": "H4",
    "H1": "H1", "M30": "M30", "M15": "M15", "M5": "M5", "M1": "M1",
}

ASSETS = ["EURUSD", "EURJPY", "EURGBP", "GBPJPY", "USDJPY", "USDCAD", "AUDJPY", "CHFJPY"]


def asset_label(asset: str) -> str:
    return f"{asset[:3]}/{asset[3:]}"


def normalize_asset(text: str) -> Optional[str]:
    t = text.upper().replace("/", "").replace("-", "").replace(" ", "").replace("_", "")
    return t if t in ASSETS else None


def bucket_start(ts: int, tf: str) -> int:
    """Início (UTC) do candle da temporalidade `tf` que contém `ts`."""
    if tf in ("M1", "M5", "M15", "M30", "H1", "H4", "D1"):
        s = TF_SECONDS[tf]
        return ts - ts % s
    d = dt.datetime.fromtimestamp(ts, dt.timezone.utc)
    if tf == "W1":
        monday = (d - dt.timedelta(days=d.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        return int(monday.timestamp())
    if tf == "MN":
        return int(dt.datetime(d.year, d.month, 1, tzinfo=dt.timezone.utc).timestamp())
    if tf == "Y1":
        return int(dt.datetime(d.year, 1, 1, tzinfo=dt.timezone.utc).timestamp())
    raise ValueError(tf)


def bucket_end(start: int, tf: str) -> int:
    """Instante em que o candle iniciado em `start` fecha."""
    if tf in ("M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"):
        return start + TF_SECONDS[tf]
    d = dt.datetime.fromtimestamp(start, dt.timezone.utc)
    if tf == "MN":
        days = calendar.monthrange(d.year, d.month)[1]
        return start + days * 86400
    if tf == "Y1":
        return int(dt.datetime(d.year + 1, 1, 1, tzinfo=dt.timezone.utc).timestamp())
    raise ValueError(tf)


def fmt_ts(ts: Optional[int]) -> str:
    if ts is None:
        return "-"
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


# --------------------------------------------------------------------------- #
# Candles
# --------------------------------------------------------------------------- #
@dataclass(slots=True)
class Candle:
    ts: int          # abertura, epoch UTC (s)
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0
    close_ts: int = 0  # instante de fechamento

    @property
    def body(self) -> float:
        return abs(self.close - self.open)

    @property
    def range(self) -> float:
        return self.high - self.low

    @property
    def bullish(self) -> bool:
        return self.close > self.open

    @property
    def bearish(self) -> bool:
        return self.close < self.open

    def to_list(self) -> list:
        return [self.ts, self.open, self.high, self.low, self.close, self.volume]


@dataclass
class Series:
    asset: str
    timeframe: str
    candles: list[Candle]
    source: str               # origem declarada dos dados
    synthetic: bool = False   # True => NÃO é dado de mercado
    volume_kind: str = "none"  # "real", "tick", "none"

    def __len__(self) -> int:
        return len(self.candles)


# --------------------------------------------------------------------------- #
# Direções, evidências e relatórios
# --------------------------------------------------------------------------- #
BULL, BEAR, NEUTRAL = 1, -1, 0
DIR_LABEL = {BULL: "ALTA", BEAR: "BAIXA", NEUTRAL: "NEUTRO"}

# Grupos de independência: evidências do mesmo grupo não se somam (evita dupla contagem)
GROUPS = {
    "trend": "Tendência multi-temporal",
    "structure": "Estrutura / Price Action",
    "zones": "Suporte e resistência",
    "fib": "Fibonacci / retração",
    "momentum": "Momentum (RSI)",
    "volume": "Volume",
    "profile": "Volume Profile / POC",
    "liquidity": "Liquidez",
    "macro": "Contexto econômico",
    "reversal": "Exaustão / reversão",
    "mt5": "Indicadores do usuário (MT5)",
    "trendline": "Linhas de tendência",
    "timing": "Timing / micro-estrutura M1",
    "research": "Indicadores pesquisados e aprovados",
    "pullback": "Pullback após rompimento",
}


@dataclass
class Evidence:
    kind: str             # identificador curto (ex.: "bos", "rsi_div")
    description: str
    direction: int        # +1 alta, -1 baixa, 0 neutro/informativo
    weight: float         # importância metodológica 0..1
    quality: float        # qualidade da evidência 0..1 (candle fechado, confirmação, dados)
    group: str            # grupo de independência
    timeframe: str = ""
    confirmed: bool = True  # baseada em candle fechado/estrutura confirmada

    @property
    def strength(self) -> float:
        return self.weight * self.quality

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class AgentReport:
    agent: str
    name: str
    asset: str
    timeframe: str
    as_of: int
    bias: int = NEUTRAL
    confidence: float = 0.0          # confiança bruta 0..1 (metodologia)
    calibrated: Optional[dict] = None  # calibragem histórica (n, taxa, IC) se existir
    evidence: list[Evidence] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    summary: str = ""
    abstain: bool = False            # sem dados/condição para opinar
    data: dict[str, Any] = field(default_factory=dict)  # artefatos (níveis, zonas...)
    lessons_used: int = 0
    revisions: list[str] = field(default_factory=list)
    veto: bool = False

    def top_evidence(self, direction: Optional[int] = None) -> Optional[Evidence]:
        ev = [e for e in self.evidence if direction is None or e.direction == direction]
        ev = [e for e in ev if e.direction != 0] if direction is None else ev
        return max(ev, key=lambda e: e.strength, default=None)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["bias_label"] = DIR_LABEL[self.bias]
        d["as_of_label"] = fmt_ts(self.as_of)
        return d


@dataclass
class Message:
    speaker: str
    text: str
    kind: str = "analysis"   # analysis | challenge | reply | request | decision | risk | system
    target: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


DECISIONS = ("CENÁRIO DE ALTA", "CENÁRIO DE BAIXA", "SEM OPORTUNIDADE", "AGUARDAR CONFIRMAÇÃO")
