"""Linha do tempo de edição derivada dos tempos reais da narração.

Tudo que precisa estar sincronizado (cortes, títulos, flashes, glitches,
SFX) é calculado aqui a partir de build/timeline.json, e consumido tanto
pelo render de vídeo quanto pela trilha.
"""


def construir_eventos(tl):
    F = tl["falas"]
    total = tl["total"]

    def T(linha, palavra=0, fim=False):
        w = F[linha]["palavras"][palavra]
        return w["fim"] if fim else w["ini"]

    def L(linha, fim=False):
        return F[linha]["fim"] if fim else F[linha]["inicio"]

    cenas = [0.0] * 9
    for k in range(2, 8):
        cenas[k] = min(f["inicio"] for f in F if f["cena"] == k) - 0.35
    cenas[8] = total

    shots, titulos, fx, sfx = [], [], [], []

    def shot(tipo, ini, fim, entrada="corte", **kw):
        shots.append(dict(tipo=tipo, ini=ini, fim=fim, entrada=entrada, **kw))

    def ef(tipo, t, d=0.2, **kw):
        fx.append(dict(tipo=tipo, t=t, d=d, **kw))

    def som(tipo, t, **kw):
        sfx.append(dict(tipo=tipo, t=t, **kw))

    def titulo(texto, ini, fim, estilo, linha=None, palavras=(), **kw):
        titulos.append(dict(texto=texto, ini=ini, fim=fim, estilo=estilo,
                            linha=linha, palavras=list(palavras), **kw))

    # ------------------------------------------------------------ CENA 1
    t_mente = T(0, 9)
    t_salto = T(1, 3)
    som("impacto", 0.32, g=1.2)
    ef("preto", 0.0, 0.5)
    ef("flash", 0.5, 0.25)
    shot("cidade", 0.5, t_salto - 0.12, camera="aproxima", congela=(t_mente, 0.55))
    ef("glitch", t_mente, 0.5)
    ef("shake", t_mente, 0.45, forca=1.0)
    ef("flash", t_mente, 0.12)
    som("glitch", t_mente)
    som("impacto", t_mente, g=1.0)
    titulo("MENTE VELHA", t_mente - 0.02, L(1) - 0.05, "glitch", linha=0, palavras=[9, 10], explode=True)
    som("riser", t_salto - 0.1, d=1.4)
    ef("whip", t_salto - 0.12, 0.24, direcao=1)
    som("whoosh", t_salto - 0.12)
    shot("abismo", t_salto - 0.12, cenas[2], camera="afasta", luz_expande=t_salto)
    ef("flash", t_salto, 0.3, cor="ouro")
    som("impacto", t_salto + 0.02, g=1.1)
    som("brilho", t_salto)
    titulo("SALTO QUÂNTICO", t_salto, cenas[2] - 0.05, "luz", linha=1, palavras=[3, 4])

    # ------------------------------------------------------------ CENA 2
    t_rot = T(4, 10)
    ciclo = ["despertador", "celular", "quarto", "multidao", "despertador", "celular",
             "multidao", "quarto", "despertador", "celular", "multidao", "despertador",
             "quarto", "celular", "multidao", "despertador", "celular", "quarto"]
    # cortes nas palavras: cada 2–3 palavras um corte seco
    cortes = [cenas[2]]
    for li in (2, 3, 4):
        ws = F[li]["palavras"]
        for i in range(0, len(ws), 2):
            tc = ws[i]["ini"] - 0.06
            if tc - cortes[-1] > 0.55 and tc < t_rot - 0.3:
                cortes.append(tc)
    cortes.append(t_rot)
    for i in range(len(cortes) - 1):
        shot(ciclo[i % len(ciclo)], cortes[i], cortes[i + 1], camera="punch" if i % 2 else "zoom_rapido",
             variacao=i)
        if i:
            ef("zoom_punch", cortes[i], 0.25)
            if i % 3 == 0:
                ef("preto", cortes[i] - 0.04, 0.05)
    t_rasga = T(4, 11, fim=True) + 0.35
    shot("multidao", t_rot, t_rasga, camera="parado", congela=(t_rot, 9.0), variacao=99)
    ef("glitch", t_rot, 0.3)
    ef("distorce", t_rot, 0.8)
    som("glitch", t_rot)
    som("impacto", t_rot, g=0.8)
    titulo("O MESMO ROTEIRO", t_rot - 0.02, t_rasga, "distorce", linha=4, palavras=[9, 10, 11])
    ef("rasgo", t_rasga, 0.75)
    som("whoosh", t_rasga + 0.1, g=1.0)
    som("riser", t_rasga, d=1.6)
    shot("amanhecer", t_rasga, cenas[3] + 2.2, entrada="rasgo", camera="sobe")

    # ------------------------------------------------------------ CENA 3
    som("impacto", L(5), g=0.7)
    b = [L(6) - 0.12, L(7) - 0.12, L(8) - 0.12, L(9) - 0.12]
    shot("cortina", cenas[3] + 2.2, b[0], entrada="flash", camera="aproxima")
    ef("flash", cenas[3] + 2.2, 0.18)
    som("whoosh", cenas[3] + 2.2)
    planos = [("estudo", "HÁBITOS", 6, 2), ("caminhada", "AMBIENTES", 7, 2),
              ("porta", "INFLUÊNCIAS", 8, 2), ("afastar", "ESCOLHAS", 9, 5)]
    fins = b[1:] + [cenas[4]]
    for (tipo, pal, li, wi), ini, fim in zip(planos, b, fins):
        shot(tipo, ini, fim, entrada="whip" if tipo in ("caminhada", "afastar") else "flash",
             camera="paralaxe")
        if tipo in ("caminhada", "afastar"):
            ef("whip", ini, 0.24, direcao=-1 if tipo == "afastar" else 1)
        else:
            ef("flash", ini, 0.16)
        som("whoosh", ini)
        tp = T(li, wi)
        som("tambor", tp)
        ef("zoom_punch", tp, 0.3)
        titulo(pal, tp - 0.05, fim - 0.08, "palavra")

    # ------------------------------------------------------------ CENA 4
    som("impacto", cenas[4] + 0.1, g=0.6)
    ef("preto", cenas[4] - 0.1, 0.35)
    t_vinho = T(12, 6)
    shot("biblia", cenas[4], t_vinho - 0.2, entrada="fade", camera="lento")
    t_lucas = T(12, 1)
    som("brilho", t_lucas)
    titulo("LUCAS 5:37", t_lucas, t_vinho - 0.25, "referencia", linha=12, palavras=[1, 2],
           sub="“E ninguém deita vinho novo em odres velhos…” (ARC)")
    shot("odres", t_vinho - 0.2, cenas[5], entrada="dissolve", camera="lento", novo_em=T(12, 13) + 0.2)
    som("whoosh", t_vinho - 0.2, g=0.5)
    t_odres = T(12, 14, fim=True) + 0.1
    titulo("VINHO NOVO NÃO COMBINA COM ODRES VELHOS.", t_odres, cenas[5] - 0.05, "frase",
           ouro=["VINHO", "NOVO", "ODRES", "VELHOS."])
    som("brilho", t_odres)

    # ------------------------------------------------------------ CENA 5
    t_renov = T(14, 10)
    shot("espelho", cenas[5], L(15) - 0.15, entrada="fade", camera="aproxima", acende=t_renov,
         levanta=T(14, 0))
    titulo("ROMANOS 12:2", T(13, 2), L(14) - 0.1, "referencia", linha=13, palavras=[2, 3],
           sub="Nova Versão Internacional (NVI)")
    som("brilho", T(13, 2))
    titulo("versiculo", L(14), L(15) - 0.2, "versiculo", linha=14, palavras=list(range(14)))
    som("riser", t_renov, d=2.2)
    ef("luz_expande", t_renov, 1.2)
    ef("flash", t_renov, 0.35, cor="ouro")
    som("impacto", t_renov, g=0.9)
    som("brilho", t_renov + 0.05)
    titulo("RENOVAÇÃO DA MENTE", t_renov + 0.05, L(15) - 0.15, "luz")
    shot("reflexao", L(15) - 0.15, cenas[6], entrada="dissolve", camera="paralaxe")

    # ------------------------------------------------------------ CENA 6
    tipos6 = ["montanhas", "estrada", "luz_caminho", "escalada", "sol_nascente"]
    for k, (li, tipo) in enumerate(zip(range(16, 21), tipos6)):
        ini = L(li) - 0.15 if k else cenas[6]
        fim = L(li + 1) - 0.15 if li < 20 else cenas[7]
        entrada = ["flash", "whip", "glitch", "whip", "flash"][k]
        shot(tipo, ini, fim, entrada=entrada, camera=["aproxima", "avanca", "paralaxe", "sobe", "afasta"][k],
             rampa=True)
        if entrada == "whip":
            ef("whip", ini, 0.26, direcao=1 if k == 1 else -1)
            som("whoosh", ini, g=1.0)
        elif entrada == "glitch":
            ef("glitch", ini, 0.22)
            som("glitch", ini)
        else:
            ef("flash", ini, 0.2)
        som("impacto", ini + 0.02, g=0.55)
        ef("shake", ini, 0.3, forca=0.6)

    # ------------------------------------------------------------ CENA 7
    t_final = L(24)
    som("impacto", cenas[7], g=0.8)
    ef("flash", cenas[7], 0.25, cor="ouro")
    shot("cume", cenas[7], total, entrada="flash", camera="afasta_longo")
    for li, pal in ((22, 0), (22, 3), (22, 6)):
        som("tambor", T(li, pal))
        ef("zoom_punch", T(li, pal), 0.3)
    som("riser", t_final - 0.15, d=2.4)
    ef("preto", t_final - 0.32, 0.22)
    som("impacto", t_final, g=1.3)
    ef("flash", t_final, 0.3, cor="ouro")
    ef("shake", t_final, 0.5, forca=0.8)
    titulo("UMA NOVA VIDA EXIGE UMA NOVA MENTALIDADE.", t_final, total - 2.6, "final", linha=24,
           palavras=list(range(7)))
    ef("fade_preto", total - 3.4, 1.4)
    titulo("RENOVE A SUA MENTE.\nTRANSFORME A SUA VIDA.", total - 2.4, total, "assinatura")

    shots.sort(key=lambda s: s["ini"])
    return dict(total=total, cenas=cenas, shots=shots, titulos=titulos, fx=fx, sfx=sfx,
                bpm=84, **{"clímax": t_final})
