"""Ponte para o pacote MetaTrader5 em um PROCESSO SEPARADO.

O conector oficial do MT5 para Python segura o interpretador inteiro enquanto espera o terminal
(ex.: baixando histórico). Rodando-o em outro processo, um travamento do MT5 nunca congela o site:
cada chamada tem tempo limite e, se o processo travar, ele é reiniciado na chamada seguinte.
"""
from __future__ import annotations

import multiprocessing as mp
import threading
from typing import Any

SLOW = {"initialize": 45, "copy_rates_from_pos": 60, "copy_ticks_range": 30, "symbols_get": 30}


def _plain(res):
    """Converte os objetos do MetaTrader5 (AccountInfo, TerminalInfo, SymbolInfo, Tick...) em tipos transportáveis."""
    import types
    if hasattr(res, "_asdict"):
        return types.SimpleNamespace(**{k: _plain(v) for k, v in res._asdict().items()})
    if isinstance(res, (tuple, list)) and res and hasattr(res[0], "_asdict"):
        return [_plain(x) for x in res]
    return res


def _worker(conn) -> None:  # roda no processo filho
    try:
        import MetaTrader5 as mt5  # type: ignore
    except Exception as e:  # pragma: no cover - depende do Windows
        conn.send(("err", f"Pacote MetaTrader5 indisponível: {e!r}"))
        return
    conn.send(("ok", "pronto"))
    while True:
        try:
            msg = conn.recv()
        except EOFError:
            break
        if msg is None:
            break
        name, args, kwargs = msg
        try:
            attr = getattr(mt5, name)
            res = attr(*args, **kwargs) if callable(attr) else attr
            conn.send(("ok", _plain(res)))
        except Exception as e:
            conn.send(("err", repr(e)))


class MT5Timeout(RuntimeError):
    pass


class ProcessMT5:
    """Objeto com a mesma interface do módulo MetaTrader5 (mt5.initialize(), mt5.copy_rates_from_pos(...)...)."""

    def __init__(self, target=_worker):
        self._target = target
        self._lock = threading.RLock()
        self._proc = None
        self._conn = None
        self._consts: dict[str, Any] = {}
        self.restarts = 0

    def _start(self) -> None:
        ctx = mp.get_context("spawn")
        parent, child = ctx.Pipe()
        self._proc = ctx.Process(target=self._target, args=(child,), daemon=True, name="tio-mt5")
        self._proc.start()
        self._conn = parent
        for _ in range(600):   # até 60 s, mas desiste na hora se o processo filho morrer
            if parent.poll(0.1):
                break
            if not self._proc.is_alive():
                self._kill()
                raise RuntimeError("O processo do MetaTrader 5 fechou ao iniciar (veja a mensagem na janela preta).")
        else:
            self._kill()
            raise MT5Timeout("O processo do MetaTrader 5 não iniciou em 60 segundos.")
        st, val = parent.recv()
        if st != "ok":
            self._kill()
            raise RuntimeError(val)

    def _kill(self) -> None:
        try:
            if self._proc is not None:
                self._proc.kill()
        except Exception:
            pass
        self._proc = None
        self._conn = None

    def call(self, name: str, *args, **kwargs):
        with self._lock:
            if self._proc is None or not self._proc.is_alive():
                fresh = self._consts.get("__initialized__")
                self._start()
                if fresh:
                    self.restarts += 1
                if name != "initialize" and self._consts.get("__initialized__"):
                    self._send("initialize", (), {}, SLOW["initialize"])   # novo processo: reconecta ao terminal
            res = self._send(name, args, kwargs, SLOW.get(name, 20))
            if name == "initialize" and res:
                self._consts["__initialized__"] = True
            return res

    def _send(self, name, args, kwargs, timeout):
        self._conn.send((name, args, kwargs))
        if not self._conn.poll(timeout):
            self._kill()   # o MT5 travou: descarta o processo (será recriado na próxima chamada)
            raise MT5Timeout(f"O MetaTrader 5 não respondeu a '{name}' em {timeout} segundos.")
        st, val = self._conn.recv()
        if st != "ok":
            raise RuntimeError(f"MT5 {name}: {val}")
        return val

    def __getattr__(self, name: str):
        if name.startswith("_"):
            raise AttributeError(name)
        if name.isupper() or name.startswith(("TIMEFRAME_", "COPY_TICKS")):
            if name not in self._consts:
                self._consts[name] = self.call(name)
            return self._consts[name]
        return lambda *a, **k: self.call(name, *a, **k)

    def shutdown_process(self) -> None:
        with self._lock:
            try:
                if self._conn is not None:
                    self._conn.send(None)
            except Exception:
                pass
            self._kill()
