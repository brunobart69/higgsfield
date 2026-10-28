"""Render final 1080x1920 @30fps: planos + efeitos + legendas + títulos.

Uso:
  python3 render.py                 # vídeo completo -> saida/video_motivacional_cristao.mp4
  python3 render.py --quadros 3.0 4.2 ...   # PNGs de conferência em build/quadros/
"""
import argparse
import json
import math
import os
import subprocess
import sys
from functools import lru_cache
from multiprocessing import Pool

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

import visuais as V
from eventos import construir_eventos

AQUI = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(AQUI, "build")
SAIDA = os.path.join(AQUI, "saida")
FONTES = os.path.join(AQUI, "fontes")
FW, FH = 1080, 1920
FPS = 30

OURO8 = (255, 196, 92)
BRANCO8 = (255, 255, 255)

TL = json.load(open(os.path.join(BUILD, "timeline.json")))
EV = construir_eventos(TL)
TOTAL = EV["total"]


# ================================================================== fontes
@lru_cache(maxsize=64)
def fonte(nome, tam):
    arq = {"anton": "Anton-Regular.ttf", "mont": "Montserrat[wght].ttf", "cinzel": "Cinzel[wght].ttf",
           "playfair": "PlayfairDisplay-Italic[wght].ttf"}[nome]
    f = ImageFont.truetype(os.path.join(FONTES, arq), tam)
    peso = {"mont": 900, "cinzel": 700, "playfair": 600}.get(nome)
    if peso:
        try:
            f.set_variation_by_axes([peso])
        except Exception:
            pass
    return f


@lru_cache(maxsize=512)
def sprite(texto, nome, tam, cor, contorno=6, brilho=0, espac=0):
    """Texto renderizado em RGBA (numpy float) com contorno/sombra e brilho opcional."""
    f = fonte(nome, tam)
    if espac:
        larg = sum(f.getlength(c) for c in texto) + espac * (len(texto) - 1)
    else:
        larg = f.getlength(texto)
    asc, desc = f.getmetrics()
    pad = 40 + brilho
    w, h = int(larg + 2 * pad), int(asc + desc + 2 * pad)
    txt = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(txt)
    if espac:
        x = pad
        for c in texto:
            d.text((x, pad), c, font=f, fill=255)
            x += f.getlength(c) + espac
    else:
        d.text((pad, pad), texto, font=f, fill=255)
    a = np.asarray(txt, np.float32) / 255
    # sombra/contorno escuro difuso para legibilidade
    cont = np.asarray(txt.filter(ImageFilter.MaxFilter(2 * (contorno // 2) + 1)).filter(ImageFilter.GaussianBlur(contorno * 0.9)),
                      np.float32) / 255 if contorno else np.zeros_like(a)
    rgb = np.zeros((h, w, 3), np.float32)
    alfa = np.clip(cont * 0.85, 0, 1)
    if brilho:
        g = np.asarray(txt.filter(ImageFilter.GaussianBlur(brilho)), np.float32) / 255
        cor_b = np.array(cor, np.float32) / 255
        rgb = rgb * (1 - g[..., None]) + cor_b * g[..., None]
        alfa = np.maximum(alfa, g * 0.9)
    cor_t = np.array(cor, np.float32) / 255
    if cor == OURO8:  # ouro com leve gradiente vertical
        grad = np.linspace(1.12, 0.78, h)[:, None, None]
        cor_t = np.clip(cor_t * grad, 0, 1)
    rgb = rgb * (1 - a[..., None]) + cor_t * a[..., None]
    alfa = np.maximum(alfa, a)
    return np.dstack([rgb * alfa[..., None], alfa]).astype(np.float32)  # pré-multiplicado


def colar(quadro, spr, cx, cy, escala=1.0, alfa=1.0):
    """Cola sprite pré-multiplicado centrado em (cx, cy)."""
    if alfa <= 0.003:
        return
    if abs(escala - 1) > 0.01:
        h, w = spr.shape[:2]
        nw, nh = max(1, int(w * escala)), max(1, int(h * escala))
        spr = np.dstack([np.asarray(Image.fromarray(spr[..., i]).resize((nw, nh), Image.BILINEAR)) for i in range(4)])
    h, w = spr.shape[:2]
    x0, y0 = int(cx - w / 2), int(cy - h / 2)
    xa, ya = max(0, x0), max(0, y0)
    xb, yb = min(FW, x0 + w), min(FH, y0 + h)
    if xb <= xa or yb <= ya:
        return
    s = spr[ya - y0:yb - y0, xa - x0:xb - x0] * alfa
    reg = quadro[ya:yb, xa:xb]
    reg[:] = reg * (1 - s[..., 3:4]) + s[..., :3]


def ease_out(x):
    x = min(max(x, 0.0), 1.0)
    return 1 - (1 - x) ** 3


def ease_back(x):
    x = min(max(x, 0.0), 1.0)
    c = 1.9
    return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2


# ================================================================== legendas
def limpa(w):
    return w.upper().strip(",.?!:;“”\"")


def montar_legendas():
    consumidas = set()
    for ti in EV["titulos"]:
        if ti.get("linha") is not None:
            for i in ti["palavras"]:
                consumidas.add((ti["linha"], i))
    blocos = []
    for fl in TL["falas"]:
        chave = set(fl["chave"])
        atual = []
        palavras = fl["palavras"]

        def fecha():
            if atual:
                blocos.append(dict(linha=fl["id"], palavras=list(atual)))
                atual.clear()

        for i, w in enumerate(palavras):
            if (fl["id"], i) in consumidas:
                fecha()
                continue
            atual.append(dict(w=w["w"].upper(), ini=w["ini"], fim=w["fim"], chave=limpa(w["w"]) in chave))
            nchar = sum(len(x["w"]) for x in atual)
            if len(atual) >= 3 or nchar >= 15 or w["w"][-1] in ",.?!":
                fecha()
        fecha()
    # janela de exibição de cada bloco
    for k, b in enumerate(blocos):
        fim_linha = next(f["fim"] for f in TL["falas"] if f["id"] == b["linha"])
        prox = blocos[k + 1]["palavras"][0]["ini"] if k + 1 < len(blocos) else 1e9
        b["ini"] = b["palavras"][0]["ini"] - 0.03
        b["fim"] = min(prox - 0.02, max(b["palavras"][-1]["fim"], fim_linha) + 0.35)
    return blocos


LEGENDAS = montar_legendas()
Y_LEGENDA = 1240


def desenhar_legendas(q, t):
    for b in LEGENDAS:
        if not (b["ini"] <= t < b["fim"]):
            continue
        saida = 1 - ease_out((t - (b["fim"] - 0.1)) / 0.1) if t > b["fim"] - 0.1 else 1.0
        sprs = []
        for w in b["palavras"]:
            if w["chave"]:
                sprs.append((sprite(w["w"], "mont", 104, OURO8, 9, 14), w, 54))
            else:
                sprs.append((sprite(w["w"], "mont", 82, BRANCO8, 9), w, 40))
        # largura útil = sprite menos as margens internas (pad) + espaço entre palavras
        larg = sum(s.shape[1] - 2 * pd for s, _, pd in sprs) + 36 * (len(sprs) - 1)
        esc_bloco = min(1.0, 960 / max(larg, 1))
        x = FW / 2 - larg * esc_bloco / 2
        for s, w, pd in sprs:
            wl = (s.shape[1] - 2 * pd) * esc_bloco
            dt = t - w["ini"]
            if dt < 0:
                x += wl + 36 * esc_bloco
                continue
            e = ease_back(dt / 0.16)
            escala = esc_bloco * (1.45 - 0.45 * e)
            alfa = min(1, dt / 0.06) * saida
            dy = (1 - ease_out(dt / 0.16)) * 26
            colar(q, s, x + wl / 2, Y_LEGENDA + dy, escala, alfa)
            x += wl + 36 * esc_bloco


# ================================================================== títulos
def fragmentos(spr, prog, semente=1):
    """Explode o sprite em blocos que voam para fora e somem."""
    h, w = spr.shape[:2]
    out = np.zeros((int(h * 1.8), int(w * 1.4), 4), np.float32)
    oh, ow = out.shape[:2]
    rng = np.random.default_rng(semente)
    bs = 22
    for y in range(0, h, bs):
        for x in range(0, w, bs):
            bloco = spr[y:y + bs, x:x + bs]
            if bloco[..., 3].max() < 0.05:
                continue
            ang = math.atan2(y - h / 2, x - w / 2) + rng.uniform(-0.6, 0.6)
            vel = rng.uniform(150, 520)
            dx = math.cos(ang) * vel * prog
            dy = math.sin(ang) * vel * prog + 300 * prog ** 2
            X = int(x + (ow - w) / 2 + dx)
            Y = int(y + (oh - h) / 2 + dy)
            bh, bw = bloco.shape[:2]
            if 0 <= X and X + bw <= ow and 0 <= Y and Y + bh <= oh:
                out[Y:Y + bh, X:X + bw] += bloco * (1 - prog) * rng.uniform(0.6, 1.0)
    return np.clip(out, 0, 1)


def glitch_sprite(spr, intensidade, semente):
    rng = np.random.default_rng(semente)
    s = spr.copy()
    d = int(14 * intensidade) + 1
    s[..., 0] = np.roll(spr[..., 0], d, 1)
    s[..., 2] = np.roll(spr[..., 2], -d, 1)
    s[..., 3] = np.maximum.reduce([spr[..., 3], np.roll(spr[..., 3], d, 1), np.roll(spr[..., 3], -d, 1)])
    h = s.shape[0]
    for _ in range(int(6 * intensidade)):
        y = rng.integers(0, h - 8)
        hh = rng.integers(4, max(5, h // 6))
        s[y:y + hh] = np.roll(s[y:y + hh], rng.integers(-40, 40), 1)
    return s


def distorcer_sprite(spr, intensidade, t):
    h, w = spr.shape[:2]
    out = np.empty_like(spr)
    for y in range(h):
        out[y] = np.roll(spr[y], int(math.sin(y * 0.09 + t * 25) * 18 * intensidade), 0)
    return out


@lru_cache(maxsize=16)
def alvos_particulas(texto, tam, cor):
    spr = sprite(texto, "anton", tam, cor, 0)
    ys, xs = np.nonzero(spr[..., 3] > 0.5)
    rng = np.random.default_rng(len(texto))
    idx = rng.choice(len(xs), min(900, len(xs)), replace=False)
    return xs[idx] - spr.shape[1] / 2, ys[idx] - spr.shape[0] / 2, spr


def particulas_texto(q, texto, tam, cor, cx, cy, prog, semente):
    """Letras surgindo através de partículas que convergem para o desenho da palavra."""
    xs, ys, spr = alvos_particulas(texto, tam, cor)
    rng = np.random.default_rng(semente)
    ang = rng.uniform(0, 2 * math.pi, len(xs))
    dist = rng.uniform(200, 700, len(xs))
    e = ease_out(prog)
    px = cx + xs + np.cos(ang) * dist * (1 - e)
    py = cy + ys + np.sin(ang) * dist * (1 - e)
    c = np.array(cor, np.float32) / 255 * 1.2
    ok = (px >= 2) & (px < FW - 2) & (py >= 2) & (py < FH - 2)
    px, py = px[ok].astype(int), py[ok].astype(int)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            k = 0.9 if dx == 0 and dy == 0 else 0.35
            q[py + dy, px + dx] = np.minimum(1.3, q[py + dy, px + dx] + c * k * (1 - 0.6 * e))
    if prog > 0.6:
        colar(q, sprite(texto, "anton", tam, cor, 8, 16), cx, cy, 1.0, (prog - 0.6) / 0.4)


def palavras_titulo(ti):
    """Tempos de cada palavra do título (das falas consumidas), se houver."""
    if ti.get("linha") is None or not ti["palavras"]:
        return None
    fl = TL["falas"][ti["linha"]]
    return [fl["palavras"][i] for i in ti["palavras"]]


def desenhar_titulo(q, ti, t):
    dt = t - ti["ini"]
    dur = ti["fim"] - ti["ini"]
    resta = ti["fim"] - t
    est = ti["estilo"]
    if est == "glitch":
        partes = ti["texto"].split()
        sprs = [sprite(partes[0], "anton", 190, BRANCO8, 10), sprite(partes[1], "anton", 230, OURO8, 10, 22)]
        if ti.get("explode") and resta < 0.45:
            prog = 1 - resta / 0.45
            colar(q, fragmentos(sprs[0], prog, 3), FW / 2, 760, 1.0)
            colar(q, fragmentos(sprs[1], prog, 4), FW / 2, 960, 1.0)
            return
        e = ease_out(dt / 0.12)
        esc = 1.5 - 0.5 * e
        inten = max(0.0, 1 - dt / 0.5) + (0.8 if int(t * 30) % 11 == 0 else 0)
        for k, (s, y) in enumerate(zip(sprs, (760, 960))):
            if k == 1 and dt < 0.18:
                continue
            g = glitch_sprite(s, inten, int(t * 30) + k) if inten > 0.05 else s
            colar(q, g, FW / 2, y, esc, min(1, dt / 0.04))
    elif est == "luz":
        y = 900 if "SALTO" in ti["texto"] else 560
        partes = ti["texto"].split(" ", 1) if "SALTO" in ti["texto"] else [ti["texto"]]
        tam = 200 if len(partes) > 1 else 116
        saida = min(1, resta / 0.25)
        for k, p in enumerate(partes):
            s = sprite(p, "anton", tam, OURO8 if k or len(partes) == 1 else BRANCO8, 8, 30)
            lt = dt - 0.12 * k
            if lt < 0:
                continue
            esc = 1.25 - 0.25 * ease_out(lt / 0.35) + 0.04 * dt / dur
            colar(q, s, FW / 2, y + k * 210 - (len(partes) - 1) * 105, esc, min(1, lt / 0.2) * saida)
    elif est == "distorce":
        s = sprite(ti["texto"], "anton", 150, BRANCO8, 10)
        inten = max(0.0, 1 - dt / 0.35)
        s2 = distorcer_sprite(s, inten * 0.6, t) if inten > 0 else s
        if int(t * 30) % 9 == 0 or inten > 0.5:
            s2 = glitch_sprite(s2, 0.35, int(t * 30))
        colar(q, s2, FW / 2, 880, 1.15 - 0.15 * ease_out(dt / 0.15), min(1, dt / 0.05))
    elif est == "palavra":
        # letras surgindo individualmente
        texto = ti["texto"]
        f = fonte("anton", 200)
        larg = f.getlength(texto) + 8 * (len(texto) - 1)
        x = FW / 2 - larg / 2
        saida = min(1, resta / 0.15)
        for i, c in enumerate(texto):
            lt = dt - 0.045 * i
            wc = f.getlength(c)
            if lt > 0:
                s = sprite(c, "anton", 200, OURO8, 8, 20)
                dy = (1 - ease_out(lt / 0.2)) * -60
                colar(q, s, x + wc / 2, 760 + dy, 1.0 + 0.6 * (1 - ease_back(lt / 0.2)), min(1, lt / 0.08) * saida)
            x += wc + 8
    elif est == "referencia":
        saida = min(1, resta / 0.3)
        e = ease_out(dt / 0.6)
        s = sprite(ti["texto"], "cinzel", 112, OURO8, 6, 18, espac=int(4 + 14 * e))
        colar(q, s, FW / 2, 520, 1.0, e * saida)
        larg_l = 340 * e
        q[598:601, int(FW / 2 - larg_l):int(FW / 2 + larg_l)] = q[598:601, int(FW / 2 - larg_l):int(FW / 2 + larg_l)] * (1 - 0.8 * saida) + np.array(OURO8) / 255 * 0.8 * saida
        if ti.get("sub") and dt > 0.4:
            s2 = sprite(ti["sub"], "playfair", 40, BRANCO8, 6)
            colar(q, s2, FW / 2, 650, 1.0, min(1, (dt - 0.4) / 0.4) * saida)
    elif est == "frase":
        linhas = ["VINHO NOVO", "NÃO COMBINA COM", "ODRES VELHOS."]
        ouro = set(ti.get("ouro", []))
        k = 0
        for li, linha in enumerate(linhas):
            ws = linha.split()
            tam = 150 if li != 1 else 96
            sprs = [(sprite(w, "anton", tam, OURO8 if w in ouro else BRANCO8, 9, 16 if w in ouro else 0),
                     56 if w in ouro else 40) for w in ws]
            larg = sum(s.shape[1] - 2 * pd for s, pd in sprs) + 30 * (len(sprs) - 1)
            x = FW / 2 - larg / 2
            for s, pd in sprs:
                wl = s.shape[1] - 2 * pd
                lt = dt - 0.13 * k
                if lt > 0:
                    colar(q, s, x + wl / 2, 720 + [0, 150, 290][li], 1.3 - 0.3 * ease_back(lt / 0.2), min(1, lt / 0.08))
                x += wl + 30
                k += 1
    elif est == "versiculo":
        fl = TL["falas"][ti["linha"]]
        ws = fl["palavras"]
        f = fonte("playfair", 64)
        linhas, atual, larg = [], [], 0
        for i, w in enumerate(ws):
            lw = f.getlength(w["w"] + " ")
            if larg + lw > 900 and atual:
                linhas.append(atual)
                atual, larg = [], 0
            atual.append(i)
            larg += lw
        linhas.append(atual)
        ouro_i = set(range(10, 14))
        y0 = 1180 - (len(linhas) - 1) * 44
        saida = min(1, resta / 0.25)
        for li, idxs in enumerate(linhas):
            larg = sum(f.getlength(ws[i]["w"] + " ") for i in idxs)
            x = FW / 2 - larg / 2
            for i in idxs:
                w = ws[i]
                lw = f.getlength(w["w"] + " ")
                lt = t - w["ini"]
                if lt > 0:
                    s = sprite(w["w"], "playfair", 64, OURO8 if i in ouro_i else BRANCO8, 8, 12 if i in ouro_i else 0)
                    colar(q, s, x + f.getlength(w["w"]) / 2, y0 + li * 88 + (1 - ease_out(lt / 0.25)) * 18,
                          1.0, min(1, lt / 0.2) * saida)
                x += lw
        s = sprite("Romanos 12:2 · NVI", "cinzel", 36, OURO8, 5)
        colar(q, s, FW / 2, y0 + len(linhas) * 88 + 20, 1.0, min(1, dt / 0.5) * saida)
    elif est == "final":
        ws = palavras_titulo(ti)
        linhas = [[0, 1, 2], [3, 4], [5, 6]]
        rotulos = ["UMA", "NOVA", "VIDA", "EXIGE", "UMA", "NOVA", "MENTALIDADE."]
        ouro = {1, 2, 5, 6}
        tams = {0: 150, 1: 120, 2: 150}
        for li, idxs in enumerate(linhas):
            tam = tams[li]
            sprs = [sprite(rotulos[i], "anton", tam, OURO8 if i in ouro else BRANCO8, 9, 18 if i in ouro else 0) for i in idxs]
            pads = [58 if i in ouro else 40 for i in idxs]
            larg = sum(s.shape[1] - 2 * pd for s, pd in zip(sprs, pads)) + 34 * (len(sprs) - 1)
            esc = min(1.0, 980 / larg)
            x = FW / 2 - larg * esc / 2
            for i, s, pd in zip(idxs, sprs, pads):
                wl = (s.shape[1] - 2 * pd) * esc
                lt = t - ws[i]["ini"] + 0.05
                cx, cy = x + wl / 2, 760 + li * 175
                if 0 < lt < 0.45:
                    particulas_texto(q, rotulos[i], int(tam * esc), OURO8 if i in ouro else BRANCO8, cx, cy, lt / 0.45, i)
                elif lt >= 0.45:
                    pulso = 1 + 0.03 * math.exp(-(lt - 0.45) * 6)
                    colar(q, s, cx, cy, esc * pulso, 1.0)
                x += wl + 34 * esc
    elif est == "assinatura":
        a = min(1, dt / 0.8)
        for k, linha in enumerate(ti["texto"].split("\n")):
            s = sprite(linha, "mont", 46, OURO8 if k else BRANCO8, 0, 0, espac=6)
            colar(q, s, FW / 2, 930 + k * 80, 1.0, a)
        larg = 160 * a
        q[880:882, int(FW / 2 - larg):int(FW / 2 + larg)] = np.array(OURO8) / 255 * 0.7


# ================================================================== pós-processamento
def tempo_do_plano(shot, t):
    """Mapeia o tempo real para o tempo do plano: congelamentos e speed ramp."""
    ini, fim = shot["ini"], shot["fim"]
    te = t
    dur = fim - ini
    if shot.get("congela"):
        t0, d = shot["congela"]
        if t0 <= t < t0 + d:
            te = t0
        elif t >= t0 + d:
            te = t - d
        dur = max(0.3, dur - d)
    p = (te - ini) / max(dur, 1e-6)
    p = min(max(p, 0.0), 1.0)
    if shot.get("rampa"):
        # acelera no início (impacto) e entra em câmera lenta
        p = 0.62 * (1 - math.exp(-p * 7)) / (1 - math.exp(-7)) + 0.38 * p
        te = ini + p * dur
    return p, te


@lru_cache(maxsize=4)
def ruido_grao(k):
    rng = np.random.default_rng(1000 + k)
    return (rng.standard_normal((FH // 2, FW // 2)).astype(np.float32))


def raios_volumetricos(img, luz, forca):
    """God rays: desfoque radial das áreas claras em direção à fonte de luz."""
    lx, ly, li = luz
    if forca <= 0.02:
        return img
    pequeno = Image.fromarray((np.clip(img - 0.45, 0, 1) * 2 * 255).clip(0, 255).astype(np.uint8)).resize((V.W // 4, V.H // 4), Image.BILINEAR)
    cx, cy = lx / 4, ly / 4
    acc = np.zeros((V.H // 4, V.W // 4, 3), np.float32)
    n = 14
    for k in range(n):
        s = 1 + k * 0.045
        a = 1 / s
        im = pequeno.transform(pequeno.size, Image.AFFINE, (a, 0, cx - a * cx, 0, a, cy - a * cy), Image.BILINEAR)
        acc += np.asarray(im, np.float32) / 255 * (1 - k / n)
    acc /= n * 0.5
    acc = np.asarray(Image.fromarray((np.clip(acc, 0, 1) * 255).astype(np.uint8)).resize((V.W, V.H), Image.BILINEAR), np.float32) / 255
    return img + acc * np.array([1.0, 0.82, 0.55]) * forca * 0.5


def bloom(img, forca=0.5):
    br = np.clip(img - 0.7, 0, 2)
    p = Image.fromarray((np.clip(br, 0, 1) * 255).astype(np.uint8)).resize((V.W // 4, V.H // 4), Image.BILINEAR)
    p = p.filter(ImageFilter.GaussianBlur(6)).resize((V.W, V.H), Image.BILINEAR)
    return img + np.asarray(p, np.float32) / 255 * forca


def lens_flare(img, luz, t):
    lx, ly, li = luz
    if li < 0.9:
        return img
    k = min(1, (li - 0.9) / 0.8) * 0.5
    y = np.arange(V.H)[:, None]
    x = np.arange(V.W)[None, :]
    streak = np.exp(-((y - ly) / 2.2) ** 2) * np.exp(-np.abs(x - lx) / 260)
    img = img + streak[..., None] * np.array([1.0, 0.75, 0.45]) * k
    for f, r, c in ((-0.6, 26, (0.4, 0.5, 0.9)), (-1.1, 14, (0.9, 0.6, 0.3)), (0.4, 40, (0.6, 0.4, 0.2))):
        gx = V.W / 2 + (lx - V.W / 2) * f
        gy = V.H / 2 + (ly - V.H / 2) * f
        img = img + V.radial(V.H, V.W, gx, gy, r, 1.5)[..., None] * np.array(c) * k * 0.35
    return img


def particulas(img, tipo, t, luz):
    if not tipo:
        return img
    n = {"chuva": 160, "poeira": 90, "ouro": 110, "poeira_feixe": 140}[tipo]
    rng = np.random.default_rng({"chuva": 1, "poeira": 2, "ouro": 3, "poeira_feixe": 4}[tipo])
    x0 = rng.uniform(0, V.W, n)
    y0 = rng.uniform(0, V.H, n)
    vel = rng.uniform(0.5, 1.5, n)
    fase = rng.uniform(0, 6.28, n)
    tam = rng.uniform(0.6, 1.8, n)
    if tipo == "chuva":
        x = (x0 + t * 60 * vel) % V.W
        y = (y0 + t * 900 * vel) % V.H
        for xi, yi, v in zip(x.astype(int), y.astype(int), vel):
            y1 = min(V.H, yi + int(14 * v))
            img[yi:y1, xi:xi + 1] += 0.12 * v
        return img
    if tipo == "ouro":
        x = (x0 + np.sin(t * 0.8 + fase) * 20) % V.W
        y = (y0 - t * 40 * vel) % V.H
        cor = np.array([1.0, 0.7, 0.3])
        brilho = 0.6 + 0.4 * np.sin(t * 3 + fase)
    else:
        x = (x0 + np.sin(t * 0.3 + fase) * 25 + t * 6 * vel) % V.W
        y = (y0 + np.cos(t * 0.25 + fase) * 20 + t * 4) % V.H
        cor = np.array([1.0, 0.9, 0.75])
        brilho = 0.35 + 0.25 * np.sin(t * 2 + fase)
        if tipo == "poeira_feixe":
            d = np.abs((x - V.W * 0.08) * 0.82 - (y - V.H * 0.02) * 0.57) / 120
            brilho = brilho * np.clip(1.3 - d, 0, 1) * 2
    for xi, yi, b, s in zip(x, y, brilho, tam):
        r = int(2 + s * 2)
        xa, ya = int(xi) - r, int(yi) - r
        if xa < 0 or ya < 0 or xa + 2 * r + 1 > V.W or ya + 2 * r + 1 > V.H:
            continue
        g = _disco(r, s)
        img[ya:ya + 2 * r + 1, xa:xa + 2 * r + 1] += g[..., None] * cor * b
    return img


@lru_cache(maxsize=32)
def _disco(r, s):
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    return np.exp(-(xx ** 2 + yy ** 2) / (2 * (s * 0.8) ** 2)).astype(np.float32)


TONS = {
    "noite": (np.array([0.75, 0.92, 1.15]), np.array([1.12, 0.95, 0.75])),
    "ouro": (np.array([0.9, 0.85, 0.9]), np.array([1.1, 0.98, 0.82])),
    "frio": (np.array([0.8, 0.95, 1.15]), np.array([0.92, 0.98, 1.08])),
    "doente": (np.array([0.9, 1.0, 0.85]), np.array([1.0, 1.0, 0.85])),
    "contraste": (np.array([0.85, 0.85, 1.05]), np.array([1.1, 0.97, 0.85])),
}


@lru_cache(maxsize=1)
def vinheta():
    y, x = np.mgrid[:V.H, :V.W]
    d = np.sqrt(((x - V.W / 2) / (V.W * 0.62)) ** 2 + ((y - V.H / 2) / (V.H * 0.62)) ** 2)
    return np.clip(1.15 - d ** 2 * 0.75, 0.25, 1)[..., None].astype(np.float32)


def gradacao(img, tom):
    sombra, luz = TONS.get(tom, TONS["noite"])
    lum = img.mean(2, keepdims=True)
    w = np.clip(lum * 1.6, 0, 1)
    img = img * (sombra * (1 - w) + luz * w)
    img = img / (1 + img * 0.35) * 1.3  # compressão de realces (filmic)
    img = np.clip(img, 0, 1.5)
    img = img ** 1.08
    return img * vinheta()


def fx_ativos(t, tipo):
    return [e for e in EV["fx"] if e["tipo"] == tipo and e["t"] <= t < e["t"] + e["d"]]


def plano_em(t):
    ativo = None
    for s in EV["shots"]:
        if s["ini"] <= t < s["fim"]:
            ativo = s
    return ativo


def render_plano(shot, t):
    pl = V.plano(shot)
    p, te = tempo_do_plano(shot, t)
    img = pl.render(p, te)
    img = raios_volumetricos(img, pl.luz, pl.raios * min(1.0, pl.luz[2]))
    img = particulas(img, pl.particulas, te, pl.luz)
    img = lens_flare(img, pl.luz, te)
    img = gradacao(img, pl.tom)
    img = bloom(img, 0.3)
    return img


def anterior(shot):
    i = EV["shots"].index(shot)
    return EV["shots"][i - 1] if i else None


def mascara_rasgo(prog, semente=5):
    """Rasgo vertical irregular abrindo do centro."""
    rng = np.random.default_rng(semente)
    borda = V.ruido1d(V.H, 6, semente, 0.65)
    borda = borda / np.abs(borda).max() * 28
    abertura = ease_out(prog) * (V.W * 0.62)
    x = np.arange(V.W)[None, :]
    c = V.W / 2 + borda[:, None]
    m = (np.abs(x - c) < abertura).astype(np.float32)
    papel = ((np.abs(x - c) >= abertura) & (np.abs(x - c) < abertura + 6 + 4 * rng.random((V.H, 1)))).astype(np.float32)
    return m, papel


def quadro_base(t):
    shot = plano_em(t)
    if shot is None:
        return np.zeros((V.H, V.W, 3), np.float32)
    img = render_plano(shot, t)
    dt = t - shot["ini"]
    ent = shot.get("entrada")
    ant = anterior(shot)
    if ant is not None and ent in ("dissolve", "fade") and dt < 0.6:
        a = ease_out(dt / 0.6)
        img_a = render_plano(ant, min(t, ant["fim"] - 1e-3))
        img = img_a * (1 - a) + img * a
    if ant is not None and ent == "rasgo" and dt < 0.75:
        m, papel = mascara_rasgo(dt / 0.75)
        img_a = render_plano(ant, ant["fim"] - 1e-3)
        img = img_a * (1 - m[..., None]) + img * m[..., None]
        img = img * (1 - papel[..., None]) + np.array([0.85, 0.8, 0.7]) * papel[..., None]
    for e in fx_ativos(t, "luz_expande"):
        k = (t - e["t"]) / e["d"]
        r = 60 + 900 * ease_out(k)
        img = img + V.radial(V.H, V.W, V.W / 2, V.H * 0.4, r, 1.2)[..., None] * V.OURO * (1 - k) * 1.2
    return img


def ampliar(img):
    u8 = (np.clip(img, 0, 1) * 255).astype(np.uint8)
    return np.asarray(Image.fromarray(u8).resize((FW, FH), Image.BICUBIC), np.float32) / 255


def transformar_quadro(q, zoom=1.0, dx=0.0, dy=0.0):
    if abs(zoom - 1) < 1e-3 and abs(dx) < 0.5 and abs(dy) < 0.5:
        return q
    im = Image.fromarray((np.clip(q, 0, 1) * 255).astype(np.uint8))
    a = 1 / zoom
    c = FW / 2 - a * FW / 2 - dx
    f = FH / 2 - a * FH / 2 - dy
    return np.asarray(im.transform((FW, FH), Image.AFFINE, (a, 0, c, 0, a, f), Image.BILINEAR), np.float32) / 255


@lru_cache(maxsize=8)
def _faixa(yc, meia):
    y = np.arange(FH, dtype=np.float32)
    return np.clip(1 - np.abs(y - yc) / meia, 0, 1) ** 0.8


def escurecer(q, yc, meia):
    y0, y1 = max(0, yc - meia), min(FH, yc + meia)
    lum = float(q[y0:y1:8, ::8].mean())
    k = float(np.clip((lum - 0.12) * 1.6, 0.0, 0.5))
    if k > 0:
        q *= (1 - k * _faixa(yc, meia))[:, None, None]


def quadro(t):
    q = ampliar(quadro_base(t))
    # scrim adaptativo: escurece suavemente atrás do texto quando o fundo é claro
    ativos = [ti for ti in EV["titulos"] if ti["ini"] <= t < ti["fim"] and ti["estilo"] != "assinatura"]
    if any(b["ini"] <= t < b["fim"] for b in LEGENDAS) or any(ti["estilo"] == "versiculo" for ti in ativos):
        escurecer(q, Y_LEGENDA, 260)
    if ativos:
        escurecer(q, 820, 420)
    # legendas e títulos
    for ti in EV["titulos"]:
        if ti["ini"] <= t < ti["fim"]:
            desenhar_titulo(q, ti, t)
    desenhar_legendas(q, t)
    # efeitos de quadro inteiro
    zoom, dx, dy = 1.0, 0.0, 0.0
    for e in fx_ativos(t, "zoom_punch"):
        k = (t - e["t"]) / e["d"]
        zoom *= 1 + 0.09 * (1 - ease_out(k))
    for e in fx_ativos(t, "shake"):
        k = (t - e["t"]) / e["d"]
        amp = 28 * e.get("forca", 1) * (1 - k)
        dx += math.sin(t * 97) * amp
        dy += math.cos(t * 83) * amp * 0.8
        zoom *= 1.04
    q = transformar_quadro(q, zoom, dx, dy)
    for e in fx_ativos(t, "whip"):
        k = (t - e["t"]) / e["d"]
        forca = math.sin(math.pi * k)
        passos = 9
        desl = int(150 * forca)
        acc = np.zeros_like(q)
        for i in range(passos):
            acc += np.roll(q, int(e.get("direcao", 1) * (desl * i / passos - desl / 2)), 1)
        q = acc / passos
    for e in fx_ativos(t, "glitch"):
        rng = np.random.default_rng(int(t * 30))
        inten = 1 - (t - e["t"]) / e["d"] * 0.6
        d = int(24 * inten)
        q = np.dstack([np.roll(q[..., 0], d, 1), q[..., 1], np.roll(q[..., 2], -d, 1)])
        for _ in range(int(10 * inten)):
            y = rng.integers(0, FH - 40)
            h = rng.integers(8, 120)
            q[y:y + h] = np.roll(q[y:y + h], rng.integers(-120, 120), 1)
        if rng.random() < 0.5:
            y = rng.integers(0, FH - 200)
            q[y:y + rng.integers(20, 200)] *= np.array([0.6, 1.2, 1.3])
    for e in fx_ativos(t, "distorce"):
        k = (t - e["t"]) / e["d"]
        amp = 14 * (1 - k)
        linhas = (np.sin(np.arange(FH) * 0.03 + t * 30) * amp).astype(int)
        for y in range(0, FH, 4):
            q[y:y + 4] = np.roll(q[y:y + 4], linhas[y], 1)
    # flashes, pretos e fade final
    for e in fx_ativos(t, "flash"):
        k = (t - e["t"]) / e["d"]
        cor = np.array([1.0, 0.86, 0.6]) if e.get("cor") == "ouro" else np.array([1.0, 1.0, 1.0])
        a = (1 - k) ** 2
        q = q * (1 - a) + cor * a
    for e in fx_ativos(t, "preto"):
        q = q * 0.0
    for e in fx_ativos(t, "fade_preto"):
        pass
    fp = [e for e in EV["fx"] if e["tipo"] == "fade_preto"]
    if fp and t >= fp[0]["t"]:
        k = min(1, (t - fp[0]["t"]) / fp[0]["d"])
        if t < EV["titulos"][-1]["ini"]:
            q = q * (1 - k)
        else:  # após o fade, só a assinatura sobre preto
            q2 = np.zeros_like(q)
            desenhar_titulo(q2, EV["titulos"][-1], t)
            q = q2
    # grão de filme
    g = ruido_grao(int(t * FPS) % 4)
    g = np.asarray(Image.fromarray(g).resize((FW, FH), Image.NEAREST))
    q = q + g[..., None] * 0.035
    return (np.clip(q, 0, 1) * 255).astype(np.uint8)


# ================================================================== saída
def render_trecho(args):
    i0, i1, caminho = args
    proc = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
                             "-s", f"{FW}x{FH}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "medium",
                             "-crf", "18", "-pix_fmt", "yuv420p", caminho], stdin=subprocess.PIPE)
    for i in range(i0, i1):
        proc.stdin.write(quadro(i / FPS).tobytes())
    proc.stdin.close()
    proc.wait()
    return caminho


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quadros", nargs="*", type=float)
    ap.add_argument("--procs", type=int, default=os.cpu_count())
    ap.add_argument("--ate", type=float, default=None)
    a = ap.parse_args()
    if a.quadros:
        os.makedirs(os.path.join(BUILD, "quadros"), exist_ok=True)
        for t in a.quadros:
            Image.fromarray(quadro(t)).save(os.path.join(BUILD, "quadros", f"q_{t:07.2f}.png"))
        return
    os.makedirs(SAIDA, exist_ok=True)
    fim = a.ate or TOTAL
    n = int(fim * FPS)
    partes = max(1, a.procs) * 3
    tam = math.ceil(n / partes)
    trechos = [(i, min(n, i + tam), os.path.join(BUILD, f"trecho_{k:03d}.mp4")) for k, i in enumerate(range(0, n, tam))]
    with Pool(a.procs) as pool:
        for k, c in enumerate(pool.imap(render_trecho, trechos)):
            print(f"trecho {k + 1}/{len(trechos)}", flush=True)
    lista = os.path.join(BUILD, "trechos.txt")
    with open(lista, "w") as f:
        for _, _, c in trechos:
            f.write(f"file '{c}'\n")
    final = os.path.join(SAIDA, "video_motivacional_cristao.mp4")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lista,
                    "-i", os.path.join(BUILD, "mix.wav"), "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                    "-t", f"{fim:.3f}", "-movflags", "+faststart", final], check=True)
    print("ok:", final)


if __name__ == "__main__":
    main()
