"""Agente 16 — pesquisa de indicadores e materiais de estudo (vídeos-aula, artigos, estudos)."""

CURRICULUM = [
    {"topic": "Como funciona um ticket de opção binária", "level": "básico",
     "text": "Entrada, direção (CALL/PUT), expiração e payout. Com payout de 80%, é preciso acertar mais de 55,6% só para "
             "empatar: ganho de 0,8 contra perda de 1. Taxa de acerto sem considerar o payout não diz nada.",
     "query": "opções binárias como funciona payout expiração explicação"},
    {"topic": "Price action no M1", "level": "básico",
     "text": "Corpo × pavio, posição do fechamento no range, sequência de velas e rejeições. Uma vela verde não é motivo "
             "para CALL: o que importa é o contexto (onde a vela fechou em relação a zonas e liquidez).",
     "query": "price action M1 leitura de velas pavio rejeição aula"},
    {"topic": "Contexto no M5 e confirmação no M1", "level": "intermediário",
     "text": "O M5 mostra a estrutura (tendência, zonas, liquidez); o M1 mostra o gatilho. Operar M1 contra o M5 é uma das "
             "causas mais comuns de perda registradas pelo Loss Analyzer.",
     "query": "análise multi timeframe M5 M1 opções binárias"},
    {"topic": "Suporte, resistência e liquidez", "level": "intermediário",
     "text": "Zonas confirmadas por fechamento, equal highs/lows e varreduras. O preço costuma buscar a liquidez antes de "
             "reverter; entrar antes da varredura gera 'Varredura de liquidez' no banco de erros.",
     "query": "liquidez varredura equal highs suporte resistência aula"},
    {"topic": "Fibonacci: Taxa Ouro e Taxa Prata", "level": "intermediário",
     "text": "Níveis da última vela mensal/semanal fechada. Servem como regiões de atenção — nunca como sinal sozinho.",
     "query": "fibonacci vela mensal semanal retração região"},
    {"topic": "Gestão de risco e por que martingale quebra contas", "level": "essencial",
     "text": "Dobrar a mão após perda aumenta a exposição justamente quando a estratégia está errando. Uma sequência de "
             "8 perdas (comum ao longo de meses) exige 255× a entrada inicial. O escritório proíbe progressões.",
     "query": "martingale por que não funciona risco de ruína explicação"},
    {"topic": "Backtest, amostra e sobreajuste", "level": "essencial",
     "text": "Uma estratégia que 'funcionou' em poucos dias pode ser sorte. Separe dados de estudo e de validação, exija "
             "amostra mínima e teste estatístico — é o que o laboratório do escritório faz automaticamente.",
     "query": "backtest overfitting amostra validação fora da amostra explicação"},
    {"topic": "Como reconhecer conteúdo enganoso", "level": "essencial",
     "text": "Promessas de 90–100% de acerto, 'sem loss', lucro diário fixo, venda de robô/sinais e links de afiliado de "
             "corretora são sinais de alerta. O pesquisador marca esses materiais como suspeitos.",
     "query": "golpe opções binárias como identificar promessas falsas"},
]
