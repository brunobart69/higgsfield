"""Roteiro do vídeo: narração, cenas e legendas.

Cada fala tem: cena, texto narrado, pausa depois (s) e palavras-chave
(destacadas em dourado / tamanho maior na legenda).
"""

# Tradução bíblica usada na tela e na narração de Romanos 12:2: NVI.
# Lucas 5:37 é narrado em paráfrase; na tela mostramos o trecho da ARC.

FALAS = [
    # CENA 1 — O GANCHO
    dict(cena=1, pre=1.4, texto="Você não vai construir uma nova vida com a mente velha.",
         chave=["NOVA", "VIDA", "MENTE", "VELHA"], pausa=0.9),
    dict(cena=1, texto="Quer dar um salto quântico na sua vida?",
         chave=["SALTO", "QUÂNTICO"], pausa=1.0),
    # CENA 2 — A VERDADE INCÔMODA
    dict(cena=2, texto="Você quer resultados diferentes, mas continua fazendo as mesmas coisas.",
         chave=["DIFERENTES", "MESMAS", "COISAS"], pausa=0.35),
    dict(cena=2, texto="Cercado pelas mesmas influências, repetindo os mesmos hábitos e alimentando os mesmos pensamentos.",
         chave=["INFLUÊNCIAS", "HÁBITOS", "PENSAMENTOS"], pausa=0.35),
    dict(cena=2, texto="Como espera viver uma nova história se continua escrevendo o mesmo roteiro?",
         chave=["NOVA", "HISTÓRIA", "MESMO", "ROTEIRO"], pausa=0.9),
    # CENA 3 — A DECISÃO DE MUDAR
    dict(cena=3, texto="Para viver uma nova vida, você precisa mudar.",
         chave=["NOVA", "VIDA", "MUDAR"], pausa=0.3),
    dict(cena=3, texto="Mudar seus hábitos.", chave=["HÁBITOS"], pausa=0.25, palavra="HÁBITOS"),
    dict(cena=3, texto="Mudar os lugares que frequenta.", chave=["LUGARES"], pausa=0.25, palavra="AMBIENTES"),
    dict(cena=3, texto="Mudar as influências que aceita.", chave=["INFLUÊNCIAS"], pausa=0.25, palavra="INFLUÊNCIAS"),
    dict(cena=3, texto="E, às vezes, até se afastar de pessoas que alimentam a versão de você que precisa ficar para trás.",
         chave=["AFASTAR", "VERSÃO", "TRÁS"], pausa=1.0, palavra="ESCOLHAS"),
    # CENA 4 — A BÍBLIA JÁ ENSINAVA ISSO
    dict(cena=4, texto="Isso não é apenas uma ideia de desenvolvimento pessoal.",
         chave=["APENAS"], pausa=0.3),
    dict(cena=4, texto="Existe um ensinamento bíblico que ilustra essa transformação.",
         chave=["BÍBLICO", "TRANSFORMAÇÃO"], pausa=0.5),
    dict(cena=4, texto="Em Lucas, capítulo cinco, versículo trinta e sete, Jesus ensina que vinho novo não deve ser colocado em odres velhos.",
         legenda="Em Lucas 5:37, Jesus ensina que vinho novo não deve ser colocado em odres velhos.",
         chave=["LUCAS", "5:37", "VINHO", "NOVO", "ODRES", "VELHOS"], pausa=3.4),
    # CENA 5 — A RENOVAÇÃO DA MENTE
    dict(cena=5, texto="E em Romanos, capítulo doze, versículo dois, encontramos outro ensinamento poderoso.",
         legenda="E em Romanos 12:2, encontramos outro ensinamento poderoso.",
         chave=["ROMANOS", "12:2", "PODEROSO"], pausa=0.45),
    dict(cena=5, texto="Não se amoldem ao padrão deste mundo, mas transformem-se pela renovação da sua mente.",
         chave=["TRANSFORMEM-SE", "RENOVAÇÃO", "MENTE"], pausa=0.6),
    dict(cena=5, texto="Uma nova vida começa quando você deixa de alimentar os pensamentos que mantêm você preso ao passado.",
         chave=["NOVA", "VIDA", "PRESO", "PASSADO"], pausa=0.8),
    # CENA 6 — FRASES DE IMPACTO (reflexões autorais, não bíblicas)
    dict(cena=6, texto="Você não muda de vida apenas desejando.", chave=["DESEJANDO"], pausa=0.3),
    dict(cena=6, texto="Você muda quando suas escolhas começam a refletir quem você quer se tornar.",
         chave=["ESCOLHAS", "TORNAR"], pausa=0.3),
    dict(cena=6, texto="Não adianta pedir uma nova direção e continuar caminhando pelos mesmos caminhos.",
         chave=["NOVA", "DIREÇÃO", "MESMOS", "CAMINHOS"], pausa=0.3),
    dict(cena=6, texto="Não adianta buscar transformação enquanto protege todos os hábitos que impedem você de crescer.",
         chave=["TRANSFORMAÇÃO", "HÁBITOS", "CRESCER"], pausa=0.3),
    dict(cena=6, texto="Uma nova fase exige novas atitudes.", chave=["NOVA", "FASE", "NOVAS", "ATITUDES"], pausa=0.8),
    # CENA 7 — O FINAL QUE MARCA
    dict(cena=7, texto="Se você quer uma nova vida, comece renovando sua mente.",
         chave=["NOVA", "VIDA", "RENOVANDO", "MENTE"], pausa=0.4),
    dict(cena=7, texto="Mude seus hábitos. Reavalie suas escolhas. Transforme suas atitudes.",
         chave=["HÁBITOS", "ESCOLHAS", "ATITUDES"], pausa=0.4),
    dict(cena=7, texto="Porque você não constrói um novo futuro vivendo preso à sua antiga versão.",
         chave=["NOVO", "FUTURO", "ANTIGA", "VERSÃO"], pausa=1.5),
    dict(cena=7, texto="Uma nova vida exige uma nova mentalidade.",
         chave=["NOVA", "VIDA", "NOVA", "MENTALIDADE"], pausa=0.0, final=True),
]
