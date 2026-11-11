"""Indicadores do usuário no MetaTrader 5.

O Expert Advisor `mql5/TIO_Exportador.mq5` (somente leitura, não envia ordens)
grava em <pasta comum do MT5>/Files/TIO/:

* `{indicador}_{símbolo}_{TF}.csv` — histórico dos buffers (barras FECHADAS);
* `live_{indicador}_{símbolo}_{TF}.csv` — registro feito no momento em que cada
  barra fechou (permite detectar indicadores que "redesenham" / repaint);
* `status.txt` — batimento do exportador.

O escritório lê `config.txt` (escrito pelo dashboard) para saber quais
indicadores, símbolos e temporalidades exportar.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from ..models import TF_SECONDS
from .providers import DATA_DIR

ROLE_PT = {"compra": "seta de COMPRA", "venda": "seta de VENDA", "linha": "linha de preço",
           "oscilador": "oscilador", "ignorar": "ignorado"}


def safe_name(name: str) -> str:
    out = name
    for ch in "\\/:*?\"<>| ":
        out = out.replace(ch, "_")
    return out


def _val(s: str) -> Optional[float]:
    s = s.strip()
    if not s:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    if v != v or abs(v) > 1e300 or v == 0.0:
        return None
    return v


def read_csv(path: Path, offset: int) -> list[tuple[int, list[Optional[float]]]]:
    rows = []
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return rows
    for ln in lines[1:]:
        parts = ln.split(",")
        if not parts or not parts[0].strip().lstrip("-").isdigit():
            continue
        rows.append((int(parts[0]) - offset, [_val(x) for x in parts[1:]]))
    rows.sort(key=lambda r: r[0])
    return rows


@dataclass
class IndicatorExport:
    name: str
    tf: str
    rows: list[tuple[int, list[Optional[float]]]]          # (abertura UTC, buffers)
    live: dict[int, list[Optional[float]]] = field(default_factory=dict)
    roles: dict[int, str] = field(default_factory=dict)    # buffer -> papel
    auto: bool = True                                      # papéis deduzidos (não configurados)

    def repaint(self) -> Optional[dict]:
        """Compara o que foi registrado ao vivo com o histórico atual das mesmas barras."""
        hist = dict(self.rows)
        checked = changed = 0
        for ts, vals in self.live.items():
            if ts not in hist:
                continue
            for b, role in self.roles.items():
                if role not in ("compra", "venda"):
                    continue
                a = vals[b] if b < len(vals) else None
                h = hist[ts][b] if b < len(hist[ts]) else None
                checked += 1
                changed += (a is None) != (h is None)
        if checked < 10:
            return None
        return {"checked": checked, "changed": changed, "rate": changed / checked}


def classify(rows, candles_by_ts: dict) -> dict[int, str]:
    """Deduz o papel de cada buffer: setas (esparsas, perto do preço), linha ou oscilador."""
    if not rows:
        return {}
    nb = max(len(v) for _, v in rows)
    roles = {}
    for b in range(nb):
        vals = [(ts, v[b]) for ts, v in rows if b < len(v) and v[b] is not None]
        if not vals:
            roles[b] = "ignorar"
            continue
        density = len(vals) / len(rows)
        near = []
        side = 0
        for ts, v in vals:
            c = candles_by_ts.get(ts)
            if c is None:
                continue
            near.append(abs(v - c.close) / c.close < 0.03)
            mid = (c.high + c.low) / 2
            side += 1 if v < mid else -1
        is_price = bool(near) and sum(near) / len(near) > 0.9
        if is_price and density < 0.4:
            roles[b] = "compra" if side > 0 else "venda"
        elif is_price:
            roles[b] = "linha"
        else:
            roles[b] = "oscilador"
    return roles


class IndicatorStore:
    """Lê as exportações do EA para um diretório (pasta comum do MT5 ou data/mt5_export)."""

    def __init__(self, directory: Path | str | None, offset: int = 0):
        self.dir = Path(directory) if directory else None
        self.offset = offset

    @property
    def available(self) -> bool:
        return bool(self.dir and self.dir.exists())

    def status(self) -> dict:
        if not self.available:
            return {"running": False, "note": "Pasta de exportação não encontrada."}
        st = self.dir / "status.txt"
        files = sorted(p.name for p in self.dir.glob("*.csv") if not p.name.startswith("live_"))
        info = {"dir": str(self.dir), "files": files, "running": False}
        if st.exists():
            txt = st.read_text(encoding="utf-8", errors="ignore")
            info["status_text"] = txt.strip()[:2000]
            info["running"] = (os.path.getmtime(st) > __import__("time").time() - 60)
        return info

    def load(self, symbol: str, asset: str, overrides: dict) -> dict[tuple[str, str], IndicatorExport]:
        out: dict[tuple[str, str], IndicatorExport] = {}
        if not self.available:
            return out
        suffix_sym = f"_{symbol}_"
        for p in self.dir.glob("*.csv"):
            if p.name.startswith("live_") or suffix_sym not in p.name:
                continue
            stem = p.stem
            name_part, tf = stem.rsplit(suffix_sym, 1)
            if tf not in TF_SECONDS:
                continue
            rows = read_csv(p, self.offset)
            live_p = self.dir / f"live_{p.name}"
            live = dict(read_csv(live_p, self.offset)) if live_p.exists() else {}
            exp = IndicatorExport(name_part, tf, rows, live)
            ov = overrides.get(name_part) or {}
            if ov:
                exp.roles = {int(k): v for k, v in ov.items() if str(k).isdigit()}
                exp.auto = False
            out[(name_part, tf)] = exp
        return out


CONFIG_PATH = DATA_DIR / "mt5_indicators.json"


def load_overrides() -> dict:
    try:
        return json.loads(CONFIG_PATH.read_text()).get("roles", {})
    except (OSError, ValueError):
        return {}


def load_selection() -> list[str]:
    try:
        return json.loads(CONFIG_PATH.read_text()).get("selected", [])
    except (OSError, ValueError):
        return []


def save_config(selected: list[str], roles: Optional[dict] = None) -> None:
    cur = {}
    try:
        cur = json.loads(CONFIG_PATH.read_text())
    except (OSError, ValueError):
        pass
    cur["selected"] = selected
    if roles is not None:
        cur["roles"] = roles
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(cur, indent=2, ensure_ascii=False))


def write_exporter_config(directory: Path, indicators: list[str], symbols: list[str], tfs: list[str]) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "config.txt").write_text(
        f"indicators={'|'.join(indicators)}\nsymbols={'|'.join(symbols)}\ntimeframes={'|'.join(tfs)}\n", encoding="ascii",
        errors="ignore")
