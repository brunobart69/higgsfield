"""Calendário econômico e notícias.

Nenhuma notícia é gerada pelo sistema: os eventos vêm de arquivos JSON em
data/news/ (formato documentado no README) ou do feed semanal público do
calendário ForexFactory (faireconomy.media). Todo evento tem data/hora (UTC) e fonte.
"""
from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

from .providers import DATA_DIR, _http_json, _parse_ts

IMPACT_RANK = {"high": 3, "medium": 2, "low": 1, "holiday": 0}
IMPACT_PT = {"high": "ALTO", "medium": "MÉDIO", "low": "BAIXO", "holiday": "FERIADO"}

# Categorias: sinal +1 => valor acima do esperado favorece a moeda
CATEGORY_SIGN = [
    (("unemployment", "jobless", "claimant", "desemprego"), -1),
    (("cpi", "inflation", "pce", "ppi", "inflação"), 1),
    (("rate", "juros", "interest", "cash rate"), 1),
    (("gdp", "pib"), 1),
    (("payroll", "employment change", "nfp", "emprego"), 1),
    (("retail", "pmi", "ism", "sentiment", "confidence"), 1),
]
CB_WORDS = ("fomc", "ecb", "boe", "boj", "snb", "boc", "rba", "fed", "lagarde", "powell", "bailey",
            "ueda", "speaks", "press conference", "minutes", "policy", "monetary")


@dataclass
class NewsEvent:
    ts: int
    currency: str
    impact: str
    title: str
    source: str
    actual: Optional[float] = None
    forecast: Optional[float] = None
    previous: Optional[float] = None
    url: str = ""

    @property
    def central_bank(self) -> bool:
        t = self.title.lower()
        return any(w in t for w in CB_WORDS)

    @property
    def category_sign(self) -> int:
        t = self.title.lower()
        for words, sign in CATEGORY_SIGN:
            if any(w in t for w in words):
                return sign
        return 0

    def surprise(self) -> Optional[float]:
        if self.actual is None or self.forecast is None:
            return None
        return self.actual - self.forecast

    def to_dict(self) -> dict:
        d = asdict(self)
        d["time_label"] = dt.datetime.fromtimestamp(self.ts, dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        d["impact_label"] = IMPACT_PT.get(self.impact, self.impact)
        return d


def _num(v) -> Optional[float]:
    if v in (None, ""):
        return None
    s = str(v).strip().replace("%", "").replace(",", "")
    mult = 1.0
    if s and s[-1] in "KMBT":
        mult = {"K": 1e3, "M": 1e6, "B": 1e9, "T": 1e12}[s[-1]]
        s = s[:-1]
    try:
        return float(s) * mult
    except ValueError:
        return None


class NewsStore:
    def __init__(self, directory: Path | str | None = None):
        self.dir = Path(directory) if directory else DATA_DIR / "news"
        self.events: list[NewsEvent] = []
        self.reload()

    def reload(self) -> None:
        evs: list[NewsEvent] = []
        if self.dir.exists():
            for p in sorted(self.dir.glob("*.json")):
                try:
                    raw = json.loads(p.read_text())
                except json.JSONDecodeError:
                    continue
                items = raw.get("events", raw) if isinstance(raw, dict) else raw
                default_source = raw.get("source") if isinstance(raw, dict) else None
                for r in items:
                    src = r.get("source") or default_source
                    when = r.get("datetime") or r.get("date") or r.get("ts")
                    if not src or not when:
                        continue  # sem fonte ou sem horário => descartado (regra 2 e 3)
                    evs.append(NewsEvent(
                        ts=_parse_ts(str(when)), currency=str(r.get("currency") or r.get("country") or "").upper(),
                        impact=str(r.get("impact", "low")).lower(), title=r.get("title", ""), source=src,
                        actual=_num(r.get("actual")), forecast=_num(r.get("forecast")),
                        previous=_num(r.get("previous")), url=r.get("url", "")))
        evs.sort(key=lambda e: e.ts)
        self.events = evs

    @property
    def loaded(self) -> bool:
        return bool(self.events)

    def for_pair(self, asset: str, start: int, end: int) -> list[NewsEvent]:
        cur = {asset[:3], asset[3:]}
        return [e for e in self.events if e.currency in cur and start <= e.ts <= end]

    def coverage(self) -> Optional[tuple[int, int]]:
        if not self.events:
            return None
        return self.events[0].ts, self.events[-1].ts


def fetch_forexfactory_week(directory: Path | str | None = None) -> Path:
    """Baixa o calendário semanal público (faireconomy.media) e salva em data/news/."""
    url = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
    raw = _http_json(url)
    events = []
    for r in raw:
        events.append({
            "datetime": r.get("date"), "currency": r.get("country"), "impact": str(r.get("impact", "")).lower(),
            "title": r.get("title"), "forecast": r.get("forecast"), "previous": r.get("previous"),
            "actual": r.get("actual"), "source": "ForexFactory calendar (nfs.faireconomy.media)", "url": url,
        })
    d = Path(directory) if directory else DATA_DIR / "news"
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"ff_{dt.date.today().isoformat()}.json"
    p.write_text(json.dumps({"source": "ForexFactory calendar (nfs.faireconomy.media)", "events": events}, indent=2, ensure_ascii=False))
    return p
