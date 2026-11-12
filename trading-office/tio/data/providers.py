"""Fontes de dados de mercado.

Regra nº 1 do escritório: nunca inventar dados de mercado. Toda série carrega
`source` (origem declarada). O gerador SINTÉTICO existe apenas para testes e
demonstração da interface e é marcado com `synthetic=True` em toda a cadeia
(API, dashboard, banco de dados).
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import math
import os
import random
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional

from ..models import ASSETS, TF_SECONDS, Candle, Series, bucket_end, bucket_start

DATA_DIR = Path(os.environ.get("TIO_DATA_DIR", Path(__file__).resolve().parents[2] / "data"))


def _parse_ts(v: str) -> int:
    v = v.strip()
    if v.replace(".", "", 1).isdigit():
        x = float(v)
        return int(x / 1000) if x > 1e11 else int(x)
    v = v.replace("Z", "+00:00").replace(" ", "T", 1) if "T" not in v else v.replace("Z", "+00:00")
    d = dt.datetime.fromisoformat(v)
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return int(d.timestamp())


def finalize(candles: list[Candle], tf: str) -> list[Candle]:
    candles.sort(key=lambda c: c.ts)
    out: list[Candle] = []
    for c in candles:
        if out and out[-1].ts == c.ts:
            continue
        c.close_ts = bucket_end(c.ts, tf)
        out.append(c)
    return out


def closed_only(candles: list[Candle], now: Optional[int] = None) -> list[Candle]:
    """Remove o candle em formação (regra 4: não usar candle aberto como confirmação)."""
    now = int(dt.datetime.now(dt.timezone.utc).timestamp()) if now is None else now
    return [c for c in candles if c.close_ts <= now]


def resample(candles: list[Candle], tf: str, as_of: Optional[int] = None) -> list[Candle]:
    """Agrega candles para `tf`. Mantém só candles cujo fechamento <= as_of."""
    out: list[Candle] = []
    cur: Optional[Candle] = None
    for c in candles:
        b = bucket_start(c.ts, tf)
        if cur is None or cur.ts != b:
            if cur is not None:
                out.append(cur)
            cur = Candle(b, c.open, c.high, c.low, c.close, c.volume, bucket_end(b, tf))
        else:
            cur.high = max(cur.high, c.high)
            cur.low = min(cur.low, c.low)
            cur.close = c.close
            cur.volume += c.volume
    if cur is not None:
        out.append(cur)
    if as_of is not None:
        out = [c for c in out if c.close_ts <= as_of]
    return out


# --------------------------------------------------------------------------- #
class Provider:
    name = "base"
    synthetic = False
    native_multi_tf = False  # True: cada temporalidade vem da própria fonte (não reamostrada)

    def load(self, asset: str, tf: str) -> Optional[Series]:  # pragma: no cover
        raise NotImplementedError


class CSVProvider(Provider):
    """Lê data/market/{ASSET}_{TF}.csv (timestamp,open,high,low,close[,volume]).

    Metadados opcionais em {ASSET}_{TF}.meta.json: {"source": ..., "volume_kind": ...}.
    """
    name = "csv"
    native_multi_tf = True

    def __init__(self, directory: Path | str | None = None):
        self.dir = Path(directory) if directory else DATA_DIR / "market"

    def available(self) -> list[tuple[str, str]]:
        out = []
        for p in sorted(self.dir.glob("*_*.csv")):
            a, tf = p.stem.split("_", 1)
            out.append((a.upper(), tf.upper()))
        return out

    def load(self, asset: str, tf: str) -> Optional[Series]:
        p = self.dir / f"{asset}_{tf}.csv"
        if not p.exists():
            return None
        meta = {}
        mp = p.with_suffix(".meta.json")
        if mp.exists():
            meta = json.loads(mp.read_text())
        candles = []
        with p.open() as f:
            rd = csv.DictReader(f)
            for r in rd:
                r = {k.strip().lower(): v for k, v in r.items() if k}
                ts_key = next(k for k in ("timestamp", "time", "datetime", "date") if k in r)
                candles.append(Candle(_parse_ts(r[ts_key]), float(r["open"]), float(r["high"]),
                                      float(r["low"]), float(r["close"]), float(r.get("volume") or 0)))
        candles = finalize(candles, tf)
        vk = meta.get("volume_kind") or ("tick" if any(c.volume for c in candles) else "none")
        return Series(asset, tf, candles, meta.get("source", f"CSV local ({p.name})"),
                      synthetic=bool(meta.get("synthetic", False)), volume_kind=vk)


def save_csv(series: Series, directory: Path | str | None = None) -> Path:
    d = Path(directory) if directory else DATA_DIR / "market"
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{series.asset}_{series.timeframe}.csv"
    with p.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["timestamp", "open", "high", "low", "close", "volume"])
        for c in series.candles:
            w.writerow([dt.datetime.fromtimestamp(c.ts, dt.timezone.utc).isoformat(), c.open, c.high, c.low, c.close, c.volume])
    p.with_suffix(".meta.json").write_text(json.dumps({
        "source": series.source, "synthetic": series.synthetic, "volume_kind": series.volume_kind,
        "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }, indent=2))
    return p


def _http_json(url: str, headers: Optional[dict] = None, timeout: int = 20) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "trading-intelligence-office/1.0", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


class TwelveDataProvider(Provider):
    """API Twelve Data (requer TWELVEDATA_API_KEY). Forex sem volume centralizado."""
    name = "twelvedata"
    TF = {"M1": "1min", "M5": "5min", "M15": "15min", "M30": "30min", "H1": "1h", "H4": "4h",
          "D1": "1day", "W1": "1week", "MN": "1month"}

    def __init__(self, api_key: Optional[str] = None):
        self.key = api_key or os.environ.get("TWELVEDATA_API_KEY")

    def load(self, asset: str, tf: str, outputsize: int = 5000) -> Optional[Series]:
        if not self.key or tf not in self.TF:
            return None
        q = urllib.parse.urlencode({"symbol": f"{asset[:3]}/{asset[3:]}", "interval": self.TF[tf],
                                    "outputsize": outputsize, "timezone": "UTC", "apikey": self.key})
        js = _http_json(f"https://api.twelvedata.com/time_series?{q}")
        if js.get("status") != "ok":
            raise RuntimeError(f"Twelve Data: {js.get('message')}")
        candles = [Candle(_parse_ts(v["datetime"]), float(v["open"]), float(v["high"]), float(v["low"]),
                          float(v["close"]), float(v.get("volume") or 0)) for v in js["values"]]
        candles = finalize(candles, tf)
        return Series(asset, tf, candles, "Twelve Data (api.twelvedata.com)", volume_kind="none")


class YahooProvider(Provider):
    """Endpoint público de gráficos do Yahoo Finance. Forex: volume = 0."""
    name = "yahoo"
    TF = {"M1": ("1m", "7d"), "M5": ("5m", "60d"), "M15": ("15m", "60d"), "M30": ("30m", "60d"),
          "H1": ("60m", "730d"), "D1": ("1d", "10y"), "W1": ("1wk", "10y"), "MN": ("1mo", "10y")}

    def load(self, asset: str, tf: str) -> Optional[Series]:
        if tf not in self.TF:
            return None
        interval, rng = self.TF[tf]
        js = _http_json(f"https://query1.finance.yahoo.com/v8/finance/chart/{asset}=X?interval={interval}&range={rng}",
                        headers={"User-Agent": "Mozilla/5.0"})
        r = js["chart"]["result"][0]
        q = r["indicators"]["quote"][0]
        candles = []
        for i, ts in enumerate(r["timestamp"]):
            if None in (q["open"][i], q["high"][i], q["low"][i], q["close"][i]):
                continue
            candles.append(Candle(int(ts), q["open"][i], q["high"][i], q["low"][i], q["close"][i], float(q["volume"][i] or 0)))
        candles = finalize(candles, tf)
        return Series(asset, tf, candles, "Yahoo Finance (query1.finance.yahoo.com)", volume_kind="none")


class MT5Provider(Provider):
    """Lê candles do terminal MetaTrader 5 aberto no mesmo computador (Windows).

    SOMENTE LEITURA: usa apenas copy_rates_from_pos / symbol_info. Nenhuma
    função de envio de ordens é chamada. Horários do servidor da corretora são
    convertidos para UTC. Volume = tick volume da corretora.
    """
    name = "mt5"
    native_multi_tf = True

    def __init__(self):
        try:
            import MetaTrader5 as mt5  # type: ignore
        except ImportError as e:
            raise RuntimeError("Pacote MetaTrader5 não instalado (pip install MetaTrader5; só funciona no Windows).") from e
        self.mt5 = mt5
        if not mt5.initialize():
            raise RuntimeError(f"Não consegui conectar ao MetaTrader 5 aberto: {mt5.last_error()}")
        self.TF = {"M1": mt5.TIMEFRAME_M1, "M5": mt5.TIMEFRAME_M5, "M15": mt5.TIMEFRAME_M15, "M30": mt5.TIMEFRAME_M30,
                   "H1": mt5.TIMEFRAME_H1, "H4": mt5.TIMEFRAME_H4, "D1": mt5.TIMEFRAME_D1, "W1": mt5.TIMEFRAME_W1,
                   "MN": mt5.TIMEFRAME_MN1}
        info = mt5.account_info()
        term = mt5.terminal_info()
        self.broker = (info.server if info else None) or (term.company if term else "MetaTrader 5")
        self._symbols: dict[str, Optional[str]] = {}
        self._offset: Optional[int] = None
        self.data_path = Path(term.data_path) if term and getattr(term, "data_path", None) else None
        self.common_path = Path(term.commondata_path) if term and getattr(term, "commondata_path", None) else None
        self.install_path = Path(term.path) if term and getattr(term, "path", None) else None
        self.exporter_note = self.install_exporter()

    # ------------------------------------------------------------ indicadores do usuário
    @property
    def export_dir(self) -> Optional[Path]:
        env = os.environ.get("TIO_MT5_FILES")
        if env:
            return Path(env)
        return self.common_path / "Files" / "TIO" if self.common_path else None

    def list_indicators(self) -> list[str]:
        """Indicadores compilados (.ex5) da pasta MQL5/Indicators, no formato aceito pelo iCustom."""
        if not self.data_path:
            return []
        root = self.data_path / "MQL5" / "Indicators"
        out = []
        for p in sorted(root.rglob("*.ex5")):
            rel = p.relative_to(root).with_suffix("")
            out.append("\\".join(rel.parts))
        return out

    @property
    def exporter_paths(self) -> dict:
        if not self.data_path:
            return {}
        dst = self.data_path / "MQL5" / "Experts" / "TIO_Exportador.mq5"
        return {"mq5": dst, "ex5": dst.with_suffix(".ex5"), "folder": dst.parent,
                "editor": self.install_path / "metaeditor64.exe" if self.install_path else None}

    def exporter_state(self) -> dict:
        ps = self.exporter_paths
        if not ps:
            return {"copied": False, "compiled": False, "note": "Pasta de dados do MT5 não encontrada."}
        log = ps["mq5"].with_suffix(".log")
        log_txt = ""
        if log.exists():
            raw = log.read_bytes()
            log_txt = (raw.decode("utf-16", "ignore") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode("utf-8", "ignore"))[-1500:]
        return {"copied": ps["mq5"].exists(), "compiled": ps["ex5"].exists(), "folder": str(ps["folder"]),
                "editor_found": bool(ps["editor"] and ps["editor"].exists()), "compile_log": log_txt.strip()}

    def install_exporter(self) -> str:
        """Copia o EA exportador para MQL5/Experts e tenta compilá-lo com o MetaEditor."""
        import shutil
        import subprocess
        src = Path(__file__).resolve().parents[2] / "mql5" / "TIO_Exportador.mq5"
        ps = self.exporter_paths
        if not ps or not src.exists():
            return "Pasta de dados do MT5 não encontrada."
        dst, ex5 = ps["mq5"], ps["ex5"]
        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            if not dst.exists() or dst.read_bytes() != src.read_bytes():
                shutil.copyfile(src, dst)
            if ex5.exists() and ex5.stat().st_mtime >= dst.stat().st_mtime:
                return "Exportador instalado e compilado."
            editor = ps["editor"]
            if editor and editor.exists() and not getattr(self, "_compile_tried", False):
                self._compile_tried = True  # tenta compilar uma vez por execução
                # formato documentado pela MetaQuotes: metaeditor64.exe /compile:"arquivo" /log
                cmd = f'"{editor}" /compile:"{dst}" /log'
                subprocess.run(cmd, timeout=120, check=False, shell=False)
            if ex5.exists():
                return "Exportador instalado e compilado."
            return ("Exportador copiado, mas não compilado automaticamente. Clique em 'Abrir no MetaEditor' "
                    "e aperte F7.")
        except Exception as e:  # pragma: no cover - depende do Windows
            return f"Não foi possível instalar o exportador automaticamente: {e}"

    def open_exporter(self, what: str = "editor") -> str:
        """Abre o arquivo do exportador no MetaEditor (ou a pasta no Explorer). Só funciona no Windows."""
        import subprocess
        ps = self.exporter_paths
        if not ps:
            return "Pasta de dados do MT5 não encontrada."
        self.install_exporter()
        try:
            if what == "folder":
                os.startfile(str(ps["folder"]))  # type: ignore[attr-defined]
                return "Pasta aberta."
            if ps["editor"] and ps["editor"].exists():
                subprocess.Popen([str(ps["editor"]), str(ps["mq5"])])
            else:
                os.startfile(str(ps["mq5"]))  # type: ignore[attr-defined]
            return "MetaEditor aberto: aperte F7 para compilar."
        except Exception as e:  # pragma: no cover
            return f"Não consegui abrir automaticamente: {e}"

    def price_at(self, asset: str, ts: int, ref: str = "bid") -> Optional[float]:
        """Preço da corretora no instante `ts` (UTC): último tick com horário <= ts (bid, ask ou médio)."""
        sym = self.symbol(asset)
        if sym is None:
            return None
        off = self.server_offset(sym)
        srv = ts + off
        frm = dt.datetime.fromtimestamp(srv - 120, dt.timezone.utc).replace(tzinfo=None)
        to = dt.datetime.fromtimestamp(srv + 1, dt.timezone.utc).replace(tzinfo=None)
        try:
            ticks = self.mt5.copy_ticks_range(sym, frm, to, self.mt5.COPY_TICKS_ALL)
        except Exception:
            return None
        if ticks is None or len(ticks) == 0:
            return None
        lim = srv * 1000
        sel = [t for t in ticks if int(t["time_msc"]) <= lim and t["bid"] > 0]
        if not sel:
            return None
        t = sel[-1]
        bid, ask = float(t["bid"]), float(t["ask"])
        return ask if ref == "ask" else (bid + ask) / 2 if ref == "mid" else bid

    def indicator_store(self, asset: str):
        from .mt5_indicators import IndicatorStore
        sym = self.symbol(asset)
        return IndicatorStore(self.export_dir, self.server_offset(sym) if sym else 0), sym

    def symbol(self, asset: str) -> Optional[str]:
        """Encontra o nome do ativo na corretora (ex.: EURUSD, EURUSDm, EURUSD.r)."""
        if asset not in self._symbols:
            found = None
            if self.mt5.symbol_info(asset) is not None:
                found = asset
            else:
                for s in self.mt5.symbols_get() or []:
                    if s.name.upper().startswith(asset) and len(s.name) <= len(asset) + 4:
                        found = s.name
                        break
            if found:
                self.mt5.symbol_select(found, True)
            self._symbols[asset] = found
        return self._symbols[asset]

    def server_offset(self, sym: str) -> int:
        """Diferença (s) entre o horário do servidor da corretora e UTC, arredondada à meia hora."""
        if self._offset is None:
            tick = self.mt5.symbol_info_tick(sym)
            now = dt.datetime.now(dt.timezone.utc).timestamp()
            self._offset = int(round((tick.time - now) / 1800) * 1800) if tick and abs(tick.time - now) < 15 * 3600 else 0
        return self._offset

    def load(self, asset: str, tf: str, count: int = 6000) -> Optional[Series]:
        sym = self.symbol(asset)
        if sym is None or tf not in self.TF:
            return None
        rates = self.mt5.copy_rates_from_pos(sym, self.TF[tf], 0, count)
        if rates is None or len(rates) == 0:
            return None
        off = self.server_offset(sym)
        candles = [Candle(int(r["time"]) - off, float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"]),
                          float(r["tick_volume"])) for r in rates]
        candles = finalize(candles, tf)
        src = f"MetaTrader 5 · {self.broker} · {sym} (horário convertido para UTC, offset {off // 3600:+d}h)"
        return Series(asset, tf, candles, src, volume_kind="tick")


# --------------------------------------------------------------------------- #
BASE_PRICE = {"EURUSD": 1.085, "EURJPY": 162.0, "EURGBP": 0.855, "GBPJPY": 190.0, "USDJPY": 150.0,
              "USDCAD": 1.36, "AUDJPY": 98.0, "CHFJPY": 170.0}


class SyntheticProvider(Provider):
    """GERADOR SINTÉTICO — NÃO SÃO DADOS DE MERCADO.

    Passeio aleatório com regimes (tendência / lateralização / volatilidade),
    sazonalidade intradiária e volume tipo "tick" correlacionado com a amplitude.
    Serve apenas para testar o software sem conexão a fontes reais.
    """
    name = "synthetic"
    synthetic = True

    def __init__(self, seed: int = 7, bars: int = 6000, end: Optional[int] = None):
        self.seed = seed
        self.bars = bars
        now = int(dt.datetime.now(dt.timezone.utc).timestamp()) if end is None else end
        self.end = now

    def load(self, asset: str, tf: str) -> Optional[Series]:
        if tf not in TF_SECONDS or tf in ("MN", "Y1", "W1"):
            return None
        sec = TF_SECONDS[tf]
        rnd = random.Random(f"{self.seed}-{asset}-{tf}")
        price = BASE_PRICE.get(asset, 1.0)
        vol = 0.0009 * math.sqrt(sec / 900)  # vol por candle relativa
        end = self.end - self.end % sec
        ts = end - int(self.bars * sec * 1.5)
        candles: list[Candle] = []
        drift = 0.0
        regime_left = 0
        vol_mult = 1.0
        while ts + sec <= end:
            d = dt.datetime.fromtimestamp(ts, dt.timezone.utc)
            if d.weekday() == 5 or (d.weekday() == 6 and d.hour < 22) or (d.weekday() == 4 and d.hour >= 22):
                ts += sec
                continue
            if regime_left <= 0:
                regime_left = rnd.randint(60, 400)
                r = rnd.random()
                drift = 0.0 if r < 0.4 else rnd.choice([-1, 1]) * vol * rnd.uniform(0.05, 0.22)
                vol_mult = rnd.choice([0.7, 1.0, 1.0, 1.3, 1.8])
            regime_left -= 1
            hour = d.hour
            session = 1.25 if 7 <= hour < 17 else (0.7 if hour < 6 else 1.0)
            sigma = vol * vol_mult * session
            ret = drift + rnd.gauss(0, sigma)
            if rnd.random() < 0.01:
                ret += rnd.choice([-1, 1]) * sigma * rnd.uniform(3, 6)  # choque
            o = price
            c = price * (1 + ret)
            hi = max(o, c) * (1 + abs(rnd.gauss(0, sigma * 0.6)))
            lo = min(o, c) * (1 - abs(rnd.gauss(0, sigma * 0.6)))
            v = max(1.0, round(abs(ret) / sigma * 400 * session + rnd.uniform(50, 250)))
            candles.append(Candle(ts, o, hi, lo, c, v, ts + sec))
            price = c
            ts += sec
        candles = candles[-self.bars:]
        return Series(asset, tf, candles, "SINTÉTICO (gerador interno — não é dado de mercado)",
                      synthetic=True, volume_kind="tick")


def get_provider(name: Optional[str] = None) -> Provider:
    name = (name or os.environ.get("TIO_PROVIDER") or "auto").lower()
    if name == "csv":
        return CSVProvider()
    if name == "twelvedata":
        return TwelveDataProvider()
    if name == "yahoo":
        return YahooProvider()
    if name == "synthetic":
        return SyntheticProvider()
    if name == "mt5":
        return MT5Provider()
    # auto: CSV se houver arquivos, senão sintético (explicitamente sinalizado)
    csvp = CSVProvider()
    if csvp.available():
        return csvp
    return SyntheticProvider()


__all__ = ["ASSETS", "CSVProvider", "MT5Provider", "TwelveDataProvider", "YahooProvider", "SyntheticProvider",
           "get_provider", "resample", "closed_only", "save_csv"]
