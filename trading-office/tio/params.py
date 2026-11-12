"""Parâmetros do modelo (versionados). Toda mudança passa por validação fora da amostra."""
from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import dataclass, field, asdict
from typing import Optional

AGENT_CODES = ["NEWS", "PA", "RET", "REV", "VOL", "VP", "SR", "FIB", "MTF", "LIQ", "MT5I", "TL", "TIM", "RES", "PB", "RISK", "HEAD"]


@dataclass
class ModelParams:
    # Agente 05
    rsi_overbought: float = 80.0
    rsi_oversold: float = 20.0
    rsi_mid: float = 50.0
    # Head Trader / confluência (pontuação 0-100)
    confluence_high: float = 62.0
    confluence_medium: float = 42.0
    min_independent_groups: int = 4
    conflict_tolerance: float = 0.35   # força contrária máxima relativa
    # Pesos por agente (confiabilidade metodológica; recalibrados só via validação)
    agent_weights: dict = field(default_factory=lambda: {c: 1.0 for c in AGENT_CODES})
    # Aprendizado: penalidade por lições recorrentes (0 = só alerta)
    lesson_penalty: float = 0.0
    lesson_min_samples: int = 8
    # Risk Manager
    payout: float = 0.80
    max_loss_streak: int = 4
    cooldown_bars: int = 8
    daily_loss_limit: float = 5.0      # unidades de stake teórica
    min_bucket_samples: int = 30
    volatility_max_mult: float = 2.6
    volatility_min_mult: float = 0.35
    # Filtro de horário (horas UTC permitidas para operações simuladas; None = sem filtro)
    allowed_hours: Optional[list] = None
    # Comparação obrigatória M1 × M5 (definida pelo usuário)
    require_tf_agreement: bool = True
    # Regras de prevenção (desligadas até serem validadas fora da amostra pelo ciclo de treinamento)
    require_htf_alignment: bool = False      # não operar contra a tendência da TF de contexto (M5 p/ M1, H1 p/ M5)
    block_consolidation: bool = False        # não operar em consolidação
    require_lower_tf_confirmation: bool = False  # exigir pressão M1 a favor
    max_premove_atr: Optional[float] = None  # entrada atrasada: preço já andou X ATR desde o sinal
    liquidity_buffer_atr: Optional[float] = None  # liquidez não varrida contra a entrada a menos de X ATR
    block_exhaustion_rsi: Optional[float] = None  # RSI M1 extremo a favor da entrada
    breakout_confirm_closes: int = 1         # rompimentos precisam de N fechamentos
    reversal_requires_choch: bool = False
    fib_requires_reaction: bool = False
    sr_min_reactions: int = 0
    min_volume_ratio: Optional[float] = None
    min_active_agents: int = 0
    expiry_bars: Optional[int] = None        # None = regra da corretora (fechamento da vela)
    # Notícias
    news_block_before_min: int = 30
    news_block_after_min: int = 45

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "ModelParams":
        base = cls()
        for k, v in d.items():
            if hasattr(base, k):
                setattr(base, k, copy.deepcopy(v))
        return base

    def fingerprint(self) -> str:
        return hashlib.sha1(json.dumps(self.to_dict(), sort_keys=True).encode()).hexdigest()[:10]

    def copy(self) -> "ModelParams":
        return ModelParams.from_dict(self.to_dict())
