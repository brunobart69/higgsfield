# Arquitetura

```
tio/
├── models.py          Candle, Series, Evidence, AgentReport, Message, temporalidades
├── indicators.py      RSI, ATR, EMA, pivôs, BOS/CHOCH, FVG, OB, Volume Profile, Fibonacci, S/R, liquidez, varreduras
├── data/providers.py  CSV, Twelve Data, Yahoo, Sintético (sinalizado), reamostragem só com candles fechados
├── data/news.py       calendário econômico (JSON local / ForexFactory) — eventos exigem data, hora e fonte
├── context.py         MarketData (todas as TFs) e MarketContext (visão até as_of, com cache de indicadores)
├── agents/            especialistas 01-10, Risk Manager (11) e Head Trader (12)
├── meeting.py         sala de reuniões: análise → debate → reanálise → confluência → risco → decisão
├── confluence.py      pontuação por grupos independentes + calibração histórica
├── binary.py          simulação educacional de opções binárias (execução real bloqueada)
├── learning.py        revisão pós-operação: processo × resultado, sinais ignorados, lições
├── backtest.py        walk-forward, métricas, ciclo de melhoria com validação fora da amostra
├── memory.py          SQLite: decisões, operações, resultados por agente, lições, versões, relatórios
├── params.py          parâmetros versionados do modelo
├── service.py         orquestração para API/CLI, operações simuladas ao vivo, chat do Head Trader
├── server.py          HTTP (biblioteca padrão) + dashboard
└── web/               dashboard (HTML/CSS/JS sem dependências, gráficos em canvas)
```

## Evidência

Cada evidência tem `direction` (+1/−1/0), `weight` (importância metodológica), `quality` (confirmação, idade,
disponibilidade de dados) e `group` (fonte independente). A força é `weight × quality`. O viés e a confiança bruta do
agente derivam da força líquida; a confiança **calibrada** só é exibida quando há ≥ 30 avaliações históricas na faixa.

## Grupos independentes

`trend, structure, zones, fib, momentum, volume, profile, liquidity, macro, reversal`. Retração e Fibonacci compartilham
o grupo `fib`, de modo que dois agentes medindo a mesma geometria não contam como duas confirmações.

## Princípios aplicados no código

| Princípio | Onde |
|---|---|
| Nunca inventar dados / informar origem | `providers.py` (`source`, `synthetic`), banner no dashboard, campo `source` nas respostas |
| Verificar data e hora das notícias | `news.py` descarta eventos sem horário/fonte; valores futuros ocultados |
| Não usar candle aberto | `closed_only`, `resample(as_of)`, `MarketData.closed` |
| Indicador isolado não é certeza | Reversão exige 2 sinais; RSI extremo exige candle de confirmação |
| Identificar discordâncias | `HeadTrader.divergences`, debate e reanálise |
| Não fabricar oportunidades | decisões SEM OPORTUNIDADE / AGUARDAR por padrão; Risk Manager exige confluência ALTA |
| Coincidência ≠ causalidade | p-valor e IC95% no backtest; "sem evidência estatística de vantagem" |
| Registrar todas as decisões | tabela `decisions` |
| Não executar operações reais | `binary.REAL_MONEY_ENABLED = False`, `/api/execute` responde 403 |
| Mudança de metodologia só com validação | `improvement_cycle` + `model_versions` |
