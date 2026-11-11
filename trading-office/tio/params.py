"""Parâmetros do modelo (versionados). Toda mudança passa por validação fora da amostra."""
from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import dataclass, field, asdict

AGENT_CODES = ["NEWS", "PA", "RET", "REV", "VOL", "VP", "SR", "FIB", "MTF", "LIQ", "RISK", "HEAD"]


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
