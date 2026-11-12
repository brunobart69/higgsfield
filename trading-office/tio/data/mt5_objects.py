"""Marcações desenhadas pelos indicadores no MT5 (objetos do gráfico).

Muitos indicadores de Smart Money (BOS, CHoCH, FVG, Order Block, Liquidez, POC, níveis "M15 · M30")
desenham OBJETOS (textos, caixas, linhas) em vez de preencher buffers. O TIO_Exportador grava todos
os objetos dos gráficos abertos em Files/TIO/objects.tsv; aqui eles são reconhecidos e convertidos em
marcações que os agentes entendem — e comparados com o que o escritório detecta sozinho.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

PERIOD = {1: "M1", 5: "M5", 15: "M15", 30: "M30", 16385: "H1", 16388: "H4", 16408: "D1", 32769: "W1", 49153: "MN"}
TFS = r"(?:M1|M5|M15|M30|H1|H4|D1|W1|MN)"
PATTERNS = [
    ("CHOCH", re.compile(r"CH\s*O\s*CH", re.I)), ("BOS", re.compile(r"\bBOS\b", re.I)),
    ("FVG", re.compile(r"\bFVG\b|fair\s*value", re.I)), ("OB", re.compile(r"order\s*block|\bOB\b", re.I)),
    ("EQH", re.compile(r"\bEQH\b|equal\s*highs?", re.I)), ("EQL", re.compile(r"\bEQL\b|equal\s*lows?", re.I)),
    ("STRONG_HIGH", re.compile(r"strong\s*high", re.I)), ("STRONG_LOW", re.compile(r"strong\s*low", re.I)),
    ("WEAK_HIGH", re.compile(r"weak\s*high", re.I)), ("WEAK_LOW", re.compile(r"weak\s*low", re.I)),
    ("POC", re.compile(r"\bPOC\b", re.I)), ("LIQ", re.compile(r"liquidez|liquidity|\bLIQ\b", re.I)),
    ("MTF", re.compile(rf"\b{TFS}\b(?:\s*[·•\-/|]\s*\b{TFS}\b)+")),
]
FIB_RE = re.compile(r"(\d\.\d{1,3})\s*\(\s*(\d+\.\d+)\s*\)")


def _read_tsv(p: Path) -> list[list[str]]:
    if not p.exists():
        return []
    raw = p.read_bytes()
    txt = raw.decode("utf-16", "ignore") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode("utf-8", "ignore")
    rows = [ln.split("\t") for ln in txt.splitlines() if ln.strip()]
    return rows[1:]


def read_export(directory: Optional[Path], offset: int = 0) -> dict:
    """{'charts': [...], 'objects': {(symbol, tf): [obj, ...]}} com horários convertidos para UTC."""
    out = {"charts": [], "objects": {}}
    if not directory:
        return out
    for r in _read_tsv(Path(directory) / "charts.tsv"):
        if len(r) >= 4:
            out["charts"].append({"chart": r[0], "symbol": r[1], "tf": PERIOD.get(int(r[2] or 0), r[2]),
                                  "indicators": [x for x in r[3].split("|") if x]})
    for r in _read_tsv(Path(directory) / "objects.tsv"):
        if len(r) < 11:
            continue
        try:
            t1, p1, t2, p2 = int(r[6]), float(r[7]), int(r[8]), float(r[9])
        except ValueError:
            continue
        tf = PERIOD.get(int(r[2] or 0), r[2])
        o = {"name": r[3], "type": r[4].replace("OBJ_", ""), "text": r[5].strip(),
             "t1": t1 - offset if t1 > 0 else 0, "p1": p1, "t2": t2 - offset if t2 > 0 else 0, "p2": p2, "color": int(r[10] or 0)}
        out["objects"].setdefault((r[1], tf), []).append(o)
    return out


def _kind(text: str) -> Optional[str]:
    for k, pat in PATTERNS:
        if pat.search(text):
            return k
    return None


def classify(objs: list[dict], candles: list, atr: float) -> dict:
    """Converte objetos em marcações: eventos (BOS/CHoCH), zonas (OB/FVG), níveis (liquidez, EQH/EQL, POC, Fibo, multi-TF)."""
    tol = max(atr * 0.25, 1e-9)
    texts = [o for o in objs if o["text"]]
    rects = [o for o in objs if o["type"] == "RECTANGLE" and o["p2"]]
    lines = [o for o in objs if o["type"] in ("HLINE", "TREND") and (o["type"] == "HLINE" or abs(o["p1"] - o["p2"]) <= tol)]
    ts = [c.ts for c in candles]
    events, zones, levels = [], [], []

    def label_near(price, t=None):
        best = None
        for o in texts:
            if abs(o["p1"] - price) <= tol and (t is None or not o["t1"] or abs(o["t1"] - t) < 86400):
                k = _kind(o["text"])
                if k and (best is None or abs(o["p1"] - price) < abs(best[1]["p1"] - price)):
                    best = (k, o)
        return best

    for o in texts:
        k = _kind(o["text"])
        if k in ("BOS", "CHOCH") and o["t1"]:
            # direção = sentido em que o preço CRUZOU o nível: lado antes da marcação → lado depois
            import bisect
            i = bisect.bisect_left(ts, o["t1"])
            ref = candles[i - 1] if i > 0 else (candles[0] if candles else None)
            d = 0
            if ref is not None:
                side = 1 if ref.close > o["p1"] else -1
                for c in candles[i: i + 60]:
                    if (c.close - o["p1"]) * side < -0.02 * tol:
                        d = -side
                        break
            events.append({"kind": k, "dir": d, "ts": o["t1"], "price": o["p1"], "text": o["text"]})
        elif k in ("EQH", "EQL", "STRONG_HIGH", "STRONG_LOW", "WEAK_HIGH", "WEAK_LOW", "POC", "LIQ", "MTF"):
            levels.append({"kind": k, "label": o["text"], "price": o["p1"], "ts": o["t1"]})
        m = FIB_RE.search(o["text"])
        if m:
            levels.append({"kind": "FIB", "label": f"{m.group(1)} ({m.group(2)})", "price": float(m.group(2)), "ts": o["t1"]})
    for o in rects:
        lo, hi = min(o["p1"], o["p2"]), max(o["p1"], o["p2"])
        k = "zona"
        for t in texts:
            tk = _kind(t["text"])
            if tk in ("OB", "FVG") and lo - tol <= t["p1"] <= hi + tol:
                k = tk
                break
        if k == "zona" and (hi - lo) <= 1.2 * atr:
            k = "FVG?" if (hi - lo) < 0.6 * atr else "OB?"
        zones.append({"kind": k, "low": lo, "high": hi, "t1": min(o["t1"], o["t2"] or o["t1"]), "t2": max(o["t1"], o["t2"])})
    for o in lines:
        near = label_near(o["p1"], o["t1"] or None)
        levels.append({"kind": near[0] if near else "LINHA", "label": near[1]["text"] if near else "", "price": o["p1"],
                       "ts": o["t1"]})
    # remove níveis duplicados (texto + linha no mesmo preço)
    uniq = []
    for lv in sorted(levels, key=lambda x: (x["kind"], x["price"])):
        if uniq and uniq[-1]["kind"] == lv["kind"] and abs(uniq[-1]["price"] - lv["price"]) <= tol * 0.3:
            continue
        uniq.append(lv)
    return {"events": sorted(events, key=lambda e: e["ts"]), "zones": zones, "levels": uniq}


def compare(marks: dict, office: dict, atr: float, bar_sec: int) -> dict:
    """Quanto do que o indicador marcou o escritório também enxerga (por tipo)."""
    tol = 0.35 * atr
    out = {}

    def stat(name, items, ok):
        hit = [x for x in items if ok(x)]
        miss = [x for x in items if not ok(x)]
        out[name] = {"indicator": len(items), "matched": len(hit), "rate": (len(hit) / len(items)) if items else None,
                     "missed": miss[:5]}

    oev = office.get("events", [])
    stat("BOS/CHoCH", [e for e in marks["events"] if e["dir"]],
         lambda e: any(x["dir"] == e["dir"] and abs(x["level"] - e["price"]) <= tol and abs(x["ts"] - e["ts"]) <= 25 * bar_sec
                       for x in oev))
    oz = office.get("zones", [])
    stat("Zonas (OB/FVG)", marks["zones"], lambda z: any(x["low"] <= z["high"] + tol and x["high"] >= z["low"] - tol for x in oz))
    olv = office.get("levels", [])
    stat("Liquidez / EQH / EQL / multi-TF", [lv for lv in marks["levels"] if lv["kind"] in ("LIQ", "EQH", "EQL", "MTF", "STRONG_HIGH",
                                                                                          "STRONG_LOW", "WEAK_HIGH", "WEAK_LOW")],
         lambda lv: any(abs(p - lv["price"]) <= tol for p in olv))
    poc = office.get("poc")
    stat("POC", [lv for lv in marks["levels"] if lv["kind"] == "POC"], lambda lv: poc is not None and abs(poc - lv["price"]) <= 2 * tol)
    tot = sum(v["indicator"] for v in out.values())
    hit = sum(v["matched"] for v in out.values())
    return {"by_kind": out, "total": tot, "matched": hit, "rate": (hit / tot) if tot else None}
