"""Módulo EDUCACIONAL de simulação de opções binárias.

Não existe (e não deve existir) integração com corretoras: nenhuma ordem real é
enviada. Entrada hipotética = abertura do candle seguinte ao fechamento usado na
decisão; resultado = fechamento do candle de expiração.
"""
from __future__ import annotations

import bisect
from typing import Optional

from .models import Candle, TF_SECONDS

REAL_MONEY_ENABLED = False  # trava de segurança: não alterar


def plan_trade(decision: dict, base: list[Candle], tf: str, expiry_bars: int, payout: float, strategy: str) -> Optional[dict]:
    if decision["direction"] == 0:
        return None
    sec = TF_SECONDS[tf]
    entry_ts = decision["as_of"]  # abertura do próximo candle = fechamento do último candle usado
    hour = (entry_ts // 3600) % 24
    return {"asset": decision["asset"], "tf": tf, "strategy": strategy, "direction": decision["direction"],
            "entry_ts": entry_ts, "expiry_ts": entry_ts + expiry_bars * sec, "payout": payout, "stake": 1.0,
            "hour": int(hour), "confluence": decision["confluence"]["score"],
            "confluence_class": decision["confluence"]["classification"],
            "process_quality": decision["process"]["score"], "synthetic": decision["synthetic"]}


def settle(base: list[Candle], open_ts: list[int], close_ts: list[int], direction: int, entry_ts: int, expiry_ts: int,
           payout: float, stake: float = 1.0) -> Optional[dict]:
    """Retorna None se ainda não há dados até a expiração."""
    i = bisect.bisect_left(open_ts, entry_ts)
    if i >= len(base):
        return None
    j = bisect.bisect_right(close_ts, expiry_ts) - 1
    if j < i or close_ts[-1] < expiry_ts:
        return None
    entry, exit_ = base[i].open, base[j].close
    if exit_ == entry:
        res, pnl = "TIE", 0.0
    elif (exit_ - entry) * direction > 0:
        res, pnl = "WIN", payout * stake
    else:
        res, pnl = "LOSS", -stake
    return {"entry_price": entry, "exit_price": exit_, "result": res, "pnl": pnl,
            "move": (exit_ - entry), "actual_dir": 1 if exit_ > entry else -1 if exit_ < entry else 0}


def execute_real_order(*_a, **_k):
    raise PermissionError("Execução com dinheiro real é proibida neste sistema (módulo educacional).")
