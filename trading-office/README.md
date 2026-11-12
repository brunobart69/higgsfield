# AI Trading Intelligence Office

Escritório virtual de inteligência artificial para **análise** de mercado (forex), com 12 agentes especialistas que
analisam individualmente, debatem, contestam uns aos outros e chegam a uma decisão coletiva conduzida pelo Head Trader.

> **Uso educacional.** O sistema não executa operações com dinheiro real (trava em `tio/binary.py`), não promete lucros,
> não inventa dados de mercado e não apresenta pontuação de confluência como probabilidade de acerto.

## Usar com o MetaTrader 5 (Windows) — passo a passo

1. Instale o Python em https://www.python.org/downloads/ e, na primeira tela da instalação, marque **“Add python.exe to PATH”**.
2. Baixe este projeto: no GitHub, botão verde **Code → Download ZIP**, e extraia a pasta.
3. Abra o **MetaTrader 5** e faça login (conta demo serve).
4. Dentro da pasta `trading-office`, dê **dois cliques em `INICIAR-MT5.bat`**.
5. O navegador abre em http://127.0.0.1:8765 com os dados da sua corretora.

O programa **só lê** os candles do MT5 (nenhuma ordem é enviada). Os horários da corretora são convertidos para UTC e o
volume usado é o tick volume. O ativo é localizado mesmo com sufixo da corretora (ex.: `EURUSDm`, `EURUSD.r`).

### Escritório virtual

A aba **Escritório** é a sede da equipe: diretoria (Head Trader), sala de reunião, gestão de risco, copa e a mesa de
análise com as estações dos especialistas. Cada agente é uma pessoa (Helena · Notícias, Rafael · Price Action,
Bianca · Retração, Otávio · Reversão, Marina · Volume/RSI, Caio · Volume Profile, Lúcia · S/R, Teodoro · Fibonacci,
Sofia · Tendência, Gustavo · Liquidez, Nina · Indicadores MT5, Diego · LTA/LTB, Vera · Risco e Augusto · Head Trader).

* As telas de cada computador ficam verdes, vermelhas ou cinzas conforme o viés atual do agente.
* A cada vela fechada nova (com intervalo mínimo), o Head Trader convoca a equipe: todos andam até a sala e as falas
  da reunião real aparecem em balões; depois cada um volta para a mesa.
* Entre reuniões, as pessoas trabalham, tomam café e visitam colegas — quando discordam, vão até a mesa do outro
  defender a própria leitura.
* Clique em uma pessoa (ou na mesa dela) para conversar: visão atual, motivos, níveis, taxa de acerto, metodologia,
  horários. As respostas vêm da análise real do agente, não são inventadas.

### Linhas de tendência (Agente 14) e horários

* **Diego · Linhas de Tendência** traça LTA/LTB ligando pivôs confirmados (mínimo de 3 toques e nenhum fechamento do
  outro lado), em M1/M5/M15 e H1, e as desenha no gráfico do Painel.
* A aba **Horários** registra o acerto por hora de entrada (UTC e horário local) e por temporalidade. Você pode ligar um
  **filtro de horário**: o Risk Manager passa a aprovar simulações só nas horas escolhidas. O ciclo de aprendizado
  também testa um filtro de horário e só o adota se melhorar fora da amostra.

### Multi-Pares, M1/M5 e treino automático

* A aba **Multi-Pares** mostra os 8 pares ao mesmo tempo, com mini-gráfico, decisão, viés de cada agente e a operação
  simulada em andamento. O seletor **M1 / M5 / M15** no topo troca a temporalidade de todas as telas.
* Com `serve --auto` (já ligado no `INICIAR-MT5.bat`), o escritório analisa todos os pares em todas as temporalidades
  a cada poucos segundos e registra operações **apenas simuladas** (expiração padrão: 3 velas em M1/M5, 4 em M15).
  Decisões que chegam tarde demais em relação ao fechamento da vela não abrem simulação.

### Seus indicadores do MT5 (Agente 13)

1. Ao conectar, o escritório copia e compila o Expert Advisor `mql5/TIO_Exportador.mq5` na sua pasta do MT5.
   Ele **não envia ordens**; só copia os valores dos indicadores escolhidos para `Files\TIO` na pasta comum do MT5.
2. Arraste o **TIO_Exportador** para qualquer gráfico (Navegador → Expert Advisors).
3. Na aba **MT5** do painel, marque seus indicadores e clique em **Salvar escolha**.

O Agente 13 deduz o papel de cada buffer (seta de compra, seta de venda, linha de preço, oscilador), usa somente velas
fechadas, detecta indicadores que **redesenham** (repaint) e mede a taxa de acerto de cada indicador em separado.
Papéis podem ser corrigidos em `data/mt5_indicators.json` (`{"roles": {"Nome": {"0": "compra", "1": "venda"}}}`).
Os indicadores são carregados com os parâmetros padrão.

## Início rápido

Requer apenas Python ≥ 3.10 (biblioteca padrão, sem dependências). `pytest` é necessário somente para os testes.

```bash
cd trading-office
python -m tio serve                 # dashboard em http://127.0.0.1:8765
python -m tio analyze EURUSD        # reunião completa no terminal
python -m tio backtest --assets EURUSD,USDJPY --strategy comite --expiry 4
python -m tio learn --assets EURUSD,USDJPY,EURJPY   # ciclo de melhoria com validação fora da amostra
python -m pytest -q tests
```

### Dados de mercado (regra nº 1: nunca inventar dados)

| Fonte | Como usar | Observação |
|---|---|---|
| MetaTrader 5 | `pip install MetaTrader5` e `python -m tio --provider mt5 serve` com o MT5 aberto (Windows) | tick volume da corretora; somente leitura |
| CSV local | `data/market/{ATIVO}_{TF}.csv` com `timestamp,open,high,low,close[,volume]` (UTC) | `{ATIVO}_{TF}.meta.json` opcional com `source` |
| Twelve Data | `export TWELVEDATA_API_KEY=...` e `python -m tio fetch --source twelvedata --tfs M15` | grava CSV + metadados com a origem |
| Yahoo Finance | `python -m tio fetch --source yahoo --tfs M15` | forex sem volume |
| **Sintético** | usado automaticamente quando não há CSV | **não é mercado**: banner vermelho no dashboard, marcado no banco e em toda resposta |

Seleção: `--provider csv|twelvedata|yahoo|synthetic|auto` (padrão `auto` = CSV se existir, senão sintético).

Forex à vista não tem volume centralizado. Sem volume, o agente de Volume declara a limitação e o Volume Profile passa a
ser construído por tempo no preço (TPO), sinalizado como tal.

### Calendário econômico

Notícias nunca são geradas pelo sistema. Fontes aceitas:

* `python -m tio news --fetch` — semana atual do calendário ForexFactory (faireconomy.media);
* arquivos JSON em `data/news/` no formato:

```json
{"source": "nome da fonte", "events": [
  {"datetime": "2026-11-12T13:30:00Z", "currency": "USD", "impact": "high",
   "title": "CPI m/m", "actual": "0.3%", "forecast": "0.2%", "previous": "0.2%"}
]}
```

Eventos sem `datetime` ou sem `source` são descartados. Valores `actual` de eventos posteriores ao instante analisado
são ignorados (sem vazamento).

## Os 12 agentes

| # | Agente | Grupo de evidência | Metodologia resumida |
|---|---|---|---|
| 01 | News Intelligence | macro | impacto, surpresa (atual − previsão), precificação, bloqueio ±30/45 min de evento de alto impacto |
| 02 | Price Action & Fluxo | structure | BOS/CHOCH por fechamento, deslocamento > 1,6 ATR, FVG, Order Blocks, rejeição, eficiência (fluxo × ruído) |
| 03 | Retração | fib | última perna impulsiva em H4/H1/M15; 0,382–0,705 saudável; > 0,886 perde validade |
| 04 | Reversão | reversal | exige ≥ 2 sinais independentes (RSI, divergência, rejeição em zona, CHOCH, varredura, extensão) |
| 05 | Volume & RSI | momentum / volume | RSI 80/20/50 com confirmação de candle; volume vs média de 50 |
| 06 | Volume Profile & POC | profile | POC, VAH, VAL (70%), HVN/LVN, aceitação/rejeição fora do valor |
| 07 | Suporte & Resistência | zones | zonas H1/H4 por agrupamento de pivôs, toques, reações e rompimentos por fechamento |
| 08 | Fibonacci Intelligence | fib | DIAMANTE (ano), OURO (mês), PRATA (semana), BRONZE (perna H4) — só candles de referência fechados |
| 09 | Multi-Timeframe Trend | trend | mapa Anual → M1, principal/secundária, alinhamento, CHOCH |
| 10 | Liquidity Hunter | liquidity | equal highs/lows, PDH/PDL, interna/externa, varreduras; nunca afirma manipulação |
| 11 | Risk Manager | — | confluência ALTA, equilíbrio do payout, sequência de perdas, limite diário, volatilidade, proíbe martingale |
| 12 | Head Trader | — | debate, reanálise em TF maior, confluência por qualidade (não por votos), decisão final |

Decisões possíveis: **CENÁRIO DE ALTA · CENÁRIO DE BAIXA · SEM OPORTUNIDADE · AGUARDAR CONFIRMAÇÃO**.

## Como a reunião funciona (`tio/meeting.py`)

1. **Análises individuais**: cada especialista consulta a memória (erros anteriores em contexto semelhante) e produz
   evidências com direção, peso metodológico, qualidade e grupo de independência.
2. **Debate**: agentes com viés oposto e confiança ≥ 0,35 contestam os mais confiantes do lado contrário; o contestado
   compara evidências (força e temporalidade) e mantém ou revisa a confiança.
3. **Reanálise**: na divergência principal, o Head Trader pede aos dois agentes uma leitura na temporalidade superior.
4. **Confluência** (`tio/confluence.py`): por grupo independente conta-se só a evidência mais forte (evita dupla contagem);
   critérios sem dados aparecem como "não avaliado". Classificação ALTA/MÉDIA/BAIXA.
5. **Risk Manager**: acionado apenas em confluência ALTA; qualquer bloqueio impede o cenário.
6. **Decisão** com narrativa, divergências, qualidade do processo e nota de calibração.

## Self Learning Intelligence

* Após a expiração de cada simulação (`tio/learning.py`): resultado, agentes que acertaram/erraram, sinais ignorados,
  investigação da falha e classificação **processo × resultado** (bom processo + perda = variância; processo fraco +
  ganho = sorte, não reforçado). Decisões sem operação também são avaliadas ("não operar evitou perda?").
* Banco de conhecimento SQLite (`data/office.db`): decisões, operações, resultados por agente, lições, versões do modelo,
  relatórios e backtests. Toda lição tem `available_at` e só é consultada depois desse instante.
* **Controle de versões** (`tio/backtest.py::improvement_cycle`): candidatos (re-ponderação de agentes, limiares, RSI,
  penalidade por lições) são testados dentro da amostra e só promovidos se superarem a versão ativa **fora da amostra**
  com amostra mínima. Rejeitados ficam registrados. Nenhuma metodologia muda sozinha.

## Backtesting sem vazamento

* contexto contém apenas candles com fechamento ≤ instante da decisão (inclusive temporalidades maiores);
* entrada hipotética na abertura do candle seguinte, resultado no fechamento da expiração;
* memória isolada por execução; resultados só passam a existir na memória após a expiração;
* teste `test_no_lookahead` garante que a análise é idêntica com ou sem dados futuros.

Métricas: operações, acerto/erro, retorno teórico, expectativa, drawdown, sequências, IC95% (Wilson), p-valor contra o
ponto de equilíbrio do payout, desempenho por ativo, horário, direção, estratégia, faixa de confluência e por agente.

## API

`GET /api/status · /api/overview · /api/analysis?asset=EURUSD · /api/agents · /api/history · /api/news · /api/memory · /api/job?id=`
`POST /api/chat {message} · /api/backtest {...} · /api/learn {...} · /api/news/reload`

Mais detalhes em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
