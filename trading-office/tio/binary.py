"""Módulo EDUCACIONAL de simulação de opções binárias (M1 / M5).

Não existe (e não deve existir) integração com corretoras: nenhuma ordem real é enviada.

Modelo de um "ticket" simulado:
* preço de entrada, direção (CALL/PUT), horário de entrada, temporalidade de referência,
  horário de expiração, preço de fechamento e resultado (WIN/LOSS/TIE);
* expiração padrão = FECHAMENTO DA PRÓPRIA VELA da temporalidade de referência
  (ex.: M1 entrada 10:30:15 → expira 10:31:00; M5 entrada 10:32:00 → expira 10:35:00);
* o preço de entrada é o preço NO INSTANTE da entrada (ticks da corretora quando disponíveis).
  Nunca se usa a abertura da vela quando a entrada acontece depois da abertura: sem ticks,
  a entrada é deslocada para um instante cujo preço é conhecido exatamente (fronteira de M1)
  e isso fica registrado.
"""
from __future__ import annotations

import bisect
from dataclasses import asdict, dataclass, field
from typing import Callable, Optional

from .models import TF_SECONDS, Candle, bucket_end, bucket_start

REAL_MONEY_ENABLED = False  # trava de segurança: não alterar


@dataclass
class BrokerRules:
    price_ref: str = "bid"            # preço de referência da corretora: bid | ask | mid
    entry_delay_s: int = 15           # atraso entre o fechamento do sinal e a entrada (precisa de ticks)
    expiry_mode: str = "candle_close"  # candle_close (fecha com a própria vela) | bars (N velas)
    expiry_bars: int = 1
    min_remaining_s: dict = field(default_factory=lambda: {"M1": 30, "M5": 120, "M15": 300})
    tie_rule: str = "refund"          # refund (devolve) | loss
    payout: float = 0.80
    settlement_offset_ms: int = 0     # diferença conhecida entre o relógio da corretora e o do servidor

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Optional[dict]) -> "BrokerRules":
        r = cls()
        for k, v in (d or {}).items():
            if hasattr(r, k):
                setattr(r, k, v)
        return r


def plan_ticket(decision: dict, tf: str, rules: BrokerRules, decided_at: Optional[float] = None,
                has_ticks: bool = False, strategy: str = "comite") -> dict:
    """Define entrada e expiração. Retorna {'ok': False, 'reason': ...} se não houver tempo útil."""
    sec = TF_SECONDS[tf]
    as_of = decision["as_of"]
    delay = rules.entry_delay_s if has_ticks else 0
    entry_ts = as_of + delay
    if decided_at is not None and decided_at > entry_ts:
        entry_ts = int(decided_at) + (1 if decided_at % 1 else 0)
    if not has_ticks and entry_ts % 60:
        entry_ts += 60 - entry_ts % 60   # sem ticks: só fronteiras de minuto têm preço exato
    if rules.expiry_mode == "candle_close":
        expiry_ts = bucket_end(bucket_start(entry_ts, tf), tf)
    else:
        expiry_ts = bucket_end(bucket_start(entry_ts, tf), tf) + (max(1, rules.expiry_bars) - 1) * sec
    remaining = expiry_ts - entry_ts
    t = {"asset": decision["asset"], "tf": tf, "strategy": strategy, "direction": decision["direction"],
         "signal_ts": as_of, "entry_ts": entry_ts, "expiry_ts": expiry_ts, "payout": rules.payout, "stake": 1.0,
         "hour": int((entry_ts // 3600) % 24), "confluence": decision["confluence"]["score"],
         "confluence_class": decision["confluence"]["classification"],
         "process_quality": decision["process"]["score"], "synthetic": decision["synthetic"],
         "entry_delay_s": entry_ts - as_of, "remaining_s": remaining}
    min_rem = (rules.min_remaining_s or {}).get(tf, 0)
    if remaining < min_rem or remaining <= 0:
        return {**t, "ok": False, "reason": f"restariam {remaining}s até a expiração (mínimo {min_rem}s)"}
    return {**t, "ok": True}


class PricePath:
    """Preços de M1 (a série mais fina disponível) para liquidar e investigar tickets."""

    def __init__(self, candles: list[Candle], price_fn: Optional[Callable[[int, str], Optional[float]]] = None):
        self.c = candles
        self.open_ts = [x.ts for x in candles]
        self.close_ts = [x.close_ts for x in candles]
        self.price_fn = price_fn

    def price_at(self, ts: int, ref: str, at_expiry: bool = False) -> tuple[Optional[float], str]:
        """Entrada: preço no instante (abertura da vela M1 que começa ali). Expiração: fechamento da vela que termina ali."""
        if self.price_fn:
            v = self.price_fn(ts, ref)
            if v is not None:
                return v, "tick da corretora"
        j = bisect.bisect_right(self.close_ts, ts) - 1
        i = bisect.bisect_left(self.open_ts, ts)
        if at_expiry and j >= 0 and self.close_ts[j] == ts:
            return self.c[j].close, "fechamento da vela que expira"
        if i < len(self.c) and self.open_ts[i] == ts:
            return self.c[i].open, "abertura exata da vela M1 no instante"
        if j >= 0 and self.close_ts[j] == ts:
            return self.c[j].close, "fechamento exato da vela M1 no instante"
        return None, "sem preço exato"

    def last_ts(self) -> int:
        return self.close_ts[-1] if self.close_ts else 0

    def window(self, a: int, b: int) -> list[Candle]:
        i = bisect.bisect_left(self.open_ts, a)
        j = bisect.bisect_right(self.close_ts, b)
        return self.c[i:j]


def settle_ticket(path: PricePath, t: dict, rules: BrokerRules) -> Optional[dict]:
    """Liquida um ticket. None se ainda não há dados até a expiração."""
    exp_ts = t["expiry_ts"] + int(rules.settlement_offset_ms / 1000)
    if path.last_ts() < exp_ts:
        return None
    entry, src_in = path.price_at(t["entry_ts"], rules.price_ref)
    exit_, src_out = path.price_at(exp_ts, rules.price_ref, at_expiry=True)
    if entry is None or exit_ is None:
        return {"void": True, "reason": f"preço indisponível (entrada: {src_in}; saída: {src_out})"}
    d = t["direction"] or 1
    if exit_ == entry:
        res, pnl = ("TIE", 0.0) if rules.tie_rule == "refund" else ("LOSS", -1.0)
    elif (exit_ - entry) * d > 0:
        res, pnl = "WIN", t.get("payout", rules.payout) * t.get("stake", 1.0)
    else:
        res, pnl = "LOSS", -t.get("stake", 1.0)
    # comportamento ENTRE a entrada e a expiração (e logo depois) — insumo do Loss Analyzer
    inside = path.window(t["entry_ts"], exp_ts)
    span = max(60, exp_ts - t["entry_ts"])
    after = path.window(exp_ts, exp_ts + 2 * span)
    mfe = max(((c.high - entry) if d > 0 else (entry - c.low)) for c in inside) if inside else 0.0
    mae = max(((entry - c.low) if d > 0 else (c.high - entry)) for c in inside) if inside else 0.0
    post = ((after[-1].close - exit_) * d) if after else None
    return {"entry_price": entry, "exit_price": exit_, "entry_source": src_in, "exit_source": src_out,
            "result": res, "pnl": pnl, "move": exit_ - entry,
            "actual_dir": 1 if exit_ > entry else -1 if exit_ < entry else 0,
            "mfe": mfe, "mae": mae, "post_move": post, "path_bars": len(inside)}


# --------------------------------------------------------------------------- #
# Compatibilidade (modo antigo: expiração em N velas a partir da abertura da vela seguinte)
# --------------------------------------------------------------------------- #
def plan_trade(decision: dict, base: list[Candle], tf: str, expiry_bars: int, payout: float, strategy: str) -> Optional[dict]:
    if decision["direction"] == 0:
        return None
    sec = TF_SECONDS[tf]
    entry_ts = decision["as_of"]
    return {"asset": decision["asset"], "tf": tf, "strategy": strategy, "direction": decision["direction"],
            "entry_ts": entry_ts, "expiry_ts": entry_ts + expiry_bars * sec, "payout": payout, "stake": 1.0,
            "hour": int((entry_ts // 3600) % 24), "confluence": decision["confluence"]["score"],
            "confluence_class": decision["confluence"]["classification"],
            "process_quality": decision["process"]["score"], "synthetic": decision["synthetic"]}


def settle(base: list[Candle], open_ts: list[int], close_ts: list[int], direction: int, entry_ts: int, expiry_ts: int,
           payout: float, stake: float = 1.0) -> Optional[dict]:
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
