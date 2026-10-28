"""Pintura procedural das cenas (silhuetas cinematográficas em camadas 2.5D).

Cada plano é composto por camadas estáticas (cacheadas) desenhadas com
margem, movidas por uma câmera virtual com paralaxe, mais elementos
animados (figura, cortinas, luz). Resolução de trabalho: 540x960.
"""
import math
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy.ndimage import gaussian_filter

W, H = 540, 960
M = 1.32  # margem das camadas para zoom/paralaxe
LW, LH = int(W * M), int(H * M)

OURO = np.array([1.0, 0.74, 0.34])
NOITE = np.array([0.015, 0.022, 0.045])


# ------------------------------------------------------------------ básicos
def gradiente(h, w, paradas):
    """Gradiente vertical: paradas = [(pos 0..1, (r,g,b)), ...]."""
    ys = np.linspace(0, 1, h)
    pos = [p for p, _ in paradas]
    cor = np.stack([np.interp(ys, pos, [c[i] for _, c in paradas]) for i in range(3)], 1)
    return np.broadcast_to(cor[:, None, :], (h, w, 3)).copy()


def radial(h, w, cx, cy, r, pot=2.0):
    y, x = np.ogrid[:h, :w]
    d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r
    return np.clip(1 - d, 0, 1) ** pot


def ruido1d(n, oitavas=6, semente=0, rug=0.5):
    rng = np.random.default_rng(semente)
    out = np.zeros(n)
    amp, freq = 1.0, 4
    for _ in range(oitavas):
        pts = rng.standard_normal(freq + 2)
        out += amp * np.interp(np.linspace(0, freq, n), np.arange(freq + 2), pts)
        amp *= rug
        freq *= 2
    return out


def ruido2d(h, w, escala=64, semente=0, oitavas=4):
    rng = np.random.default_rng(semente)
    out = np.zeros((h, w), np.float32)
    amp = 1.0
    for o in range(oitavas):
        s = max(2, int(escala / 2 ** o))
        g = rng.standard_normal((h // s + 2, w // s + 2)).astype(np.float32)
        im = Image.fromarray(g).resize((w + 2 * s, h + 2 * s), Image.BICUBIC)
        out += amp * np.asarray(im)[s:s + h, s:s + w]
        amp *= 0.5
    return out / 1.9


def para_rgba(rgb, alfa=None):
    rgb = np.clip(rgb, 0, 1)
    a = np.ones(rgb.shape[:2]) if alfa is None else np.clip(alfa, 0, 1)
    return np.dstack([rgb, a]).astype(np.float32)


def mascara(desenho, w=LW, h=LH, blur=0):
    im = Image.new("L", (w, h), 0)
    desenho(ImageDraw.Draw(im))
    if blur:
        im = im.filter(ImageFilter.GaussianBlur(blur))
    return np.asarray(im, np.float32) / 255


def borrar(a, r):
    if r <= 0:
        return a
    sig = (r, r) if a.ndim == 2 else (r, r, 0)
    return gaussian_filter(a.astype(np.float32), sig)


def camada_cor(cor, alfa):
    h, w = alfa.shape
    return para_rgba(np.broadcast_to(np.array(cor, np.float32), (h, w, 3)).copy(), alfa)


def compor(base, camada):
    a = camada[..., 3:4]
    base[..., :3] = base[..., :3] * (1 - a) + camada[..., :3] * a
    return base


# ------------------------------------------------------------------ figura humana
POSES = {
    #            braço E (ombro, cotovelo)  braço D        perna E (quadril, joelho)  perna D   cabeça
    "parado": dict(be=(8, 4), bd=(-8, -4), pe=(3, 0), pd=(-3, 0), cab=0),
    "abertos": dict(be=(70, 20), bd=(-70, -20), pe=(10, 0), pd=(-10, 0), cab=-8),
    "erguidos": dict(be=(150, 10), bd=(-150, -10), pe=(8, 0), pd=(-8, 0), cab=-12),
    "baixa": dict(be=(4, 2), bd=(-4, -2), pe=(3, 0), pd=(-3, 0), cab=25),
}


def pose_andar(fase):
    s = math.sin(fase)
    return dict(be=(-22 * s, -18), bd=(22 * s, -18), pe=(24 * s, max(0, -30 * s)),
                pd=(-24 * s, max(0, 30 * s)), cab=2)


def desenhar_figura(d, x, y, h, pose, preenchimento=255, casaco=True):
    """Silhueta humana (vista frontal/traseira) com os pés em (x, y) e altura h."""
    if isinstance(pose, str):
        pose = POSES[pose]
    u = h

    def seg(x0, y0, ang, comp):
        a = math.radians(ang)
        return x0 + math.sin(a) * comp, y0 + math.cos(a) * comp

    quad_y = y - 0.5 * u
    omb_y = y - 0.81 * u
    larg_omb = 0.125 * u
    # tronco (casaco levemente aberto embaixo)
    d.polygon([(x - larg_omb, omb_y), (x + larg_omb, omb_y),
               (x + 0.095 * u, quad_y + (0.06 * u if casaco else 0)),
               (x - 0.095 * u, quad_y + (0.06 * u if casaco else 0))], fill=preenchimento)
    d.ellipse([x - larg_omb - 0.02 * u, omb_y - 0.025 * u, x - larg_omb + 0.05 * u, omb_y + 0.05 * u], fill=preenchimento)
    d.ellipse([x + larg_omb - 0.05 * u, omb_y - 0.025 * u, x + larg_omb + 0.02 * u, omb_y + 0.05 * u], fill=preenchimento)
    # pescoço e cabeça
    d.rectangle([x - 0.03 * u, omb_y - 0.06 * u, x + 0.03 * u, omb_y + 0.01 * u], fill=preenchimento)
    inc = pose.get("cab", 0)
    cy = omb_y - 0.11 * u + abs(inc) * 0.0012 * u
    d.ellipse([x - 0.058 * u, cy - 0.068 * u, x + 0.058 * u, cy + 0.068 * u], fill=preenchimento)
    lb = int(0.05 * u) + 1
    lp_ = int(0.065 * u) + 1
    # braços
    for lado, chave in ((-1, "be"), (1, "bd")):
        a1, a2 = pose[chave]
        ox, oy = x + lado * (larg_omb - 0.01 * u), omb_y + 0.02 * u
        ex, ey = seg(ox, oy, a1 * -lado if lado < 0 else a1, 0.17 * u)
        ex, ey = seg(ox, oy, -a1 if lado < 0 else a1, 0.17 * u)
        mx, my = seg(ex, ey, (-a1 - a2) if lado < 0 else (a1 + a2), 0.16 * u)
        d.line([(ox, oy), (ex, ey), (mx, my)], fill=preenchimento, width=lb, joint="curve")
        d.ellipse([mx - lb * 0.6, my - lb * 0.6, mx + lb * 0.6, my + lb * 0.6], fill=preenchimento)
    # pernas
    for lado, chave in ((-1, "pe"), (1, "pd")):
        a1, a2 = pose[chave]
        ox, oy = x + lado * 0.055 * u, quad_y
        jx, jy = seg(ox, oy, a1, 0.25 * u)
        px, py = seg(jx, jy, a1 - a2, 0.24 * u)
        d.line([(ox, oy), (jx, jy), (px, py)], fill=preenchimento, width=lp_, joint="curve")
        d.ellipse([px - lp_ * 0.7, py - lp_ * 0.4, px + lp_ * 0.9, py + lp_ * 0.4], fill=preenchimento)


def figura_rgba(x, y, h, pose, cor_corpo=(0.01, 0.012, 0.02), cor_aro=OURO, aro=0.9, luz_dir=(0, -1),
                w=W, hh=H):
    """Figura com luz de contorno (rim light) vinda da direção luz_dir."""
    m = mascara(lambda d: desenhar_figura(d, x, y, h, pose), w, hh)
    m = borrar(m, 0.6)
    dx, dy = luz_dir
    k = max(1.5, h / 90)
    desl = np.roll(np.roll(m, int(round(-dx * k)), 1), int(round(-dy * k)), 0)
    rim = np.clip(m - desl, 0, 1)
    rim = borrar(rim, 1.0) * 1.8
    cor = np.array(cor_corpo)[None, None] * (1 - rim[..., None]) + np.array(cor_aro)[None, None] * rim[..., None] * aro
    return para_rgba(cor, m)


# ------------------------------------------------------------------ elementos de cenário
def montanhas(h, w, base_y, amp, semente, cor, rug=0.55, nevoa=None, cor_nevoa=None):
    perfil = ruido1d(w, 7, semente, rug)
    perfil = (perfil - perfil.min()) / (np.ptp(perfil) + 1e-9)
    topo = base_y - perfil * amp
    ys = np.arange(h)[:, None]
    alfa = (ys >= topo[None, :]).astype(np.float32)
    alfa = borrar(alfa, 0.7)
    rgb = np.broadcast_to(np.array(cor, np.float32), (h, w, 3)).copy()
    if nevoa:
        # névoa de vale: silhueta sólida na crista, clareando em direção à base
        prof = np.clip((ys - topo[None, :]) / (nevoa * 3.0), 0, 1) ** 1.5 * 0.55
        rgb = rgb * (1 - prof[..., None]) + np.array(cor_nevoa)[None, None] * prof[..., None]
    return para_rgba(rgb, alfa)


def ceu_amanhecer(h, w, sol_y, forca=1.0, frio=0.0):
    ceu = gradiente(h, w, [(0, (0.03, 0.04, 0.09)), (0.25, (0.10, 0.10, 0.17)),
                           (sol_y / h - 0.06, (0.55 * forca, 0.33 * forca, 0.18 * forca)),
                           (sol_y / h, (1.0 * forca, 0.72 * forca, 0.38 * forca)),
                           (1, (0.25, 0.15, 0.10))])
    ceu += radial(h, w, w / 2, sol_y, w * 0.9, 2.2)[..., None] * OURO * 0.6 * forca
    ceu += radial(h, w, w / 2, sol_y, w * 0.12, 1.5)[..., None] * np.array([1, 0.95, 0.85]) * 1.4 * forca
    if frio:
        ceu = ceu * (1 - frio) + ceu.mean(2, keepdims=True) * np.array([0.6, 0.75, 1.0]) * frio
    return ceu


def nuvens(h, w, semente, y0, y1, densidade=0.5, cor=(0.9, 0.7, 0.5)):
    n = ruido2d(h, w, 90, semente, 5)
    ys = np.linspace(0, 1, h)[:, None]
    faixa = np.clip(1 - np.abs((ys - (y0 + y1) / 2) / ((y1 - y0) / 2 + 1e-6)), 0, 1)
    a = np.clip((n + densidade - 0.5) * 1.6, 0, 1) * faixa
    return camada_cor(cor, a * 0.85)


def predios(h, w, base_y, semente, alt_min, alt_max, larg_min, larg_max, cor, janelas=0.25,
            cor_janela=(1.0, 0.75, 0.4), tam_jan=3):
    rng = np.random.default_rng(semente)
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x = -10
    c = tuple(int(v * 255) for v in cor) + (255,)
    while x < w:
        lw = rng.integers(larg_min, larg_max)
        alt = rng.integers(alt_min, alt_max)
        d.rectangle([x, base_y - alt, x + lw, h], fill=c)
        if rng.random() < 0.3:
            d.rectangle([x + lw * 0.4, base_y - alt - alt * 0.12, x + lw * 0.5, base_y - alt], fill=c)
        for jy in range(int(base_y - alt + 6), int(base_y), tam_jan * 3):
            for jx in range(int(x + 4), int(x + lw - 4), tam_jan * 3):
                if rng.random() < janelas:
                    f = rng.uniform(0.35, 1.0)
                    cj = cor_janela if rng.random() < 0.8 else (0.6, 0.8, 1.0)
                    d.rectangle([jx, jy, jx + tam_jan - 1, jy + tam_jan], fill=tuple(int(v * f * 255) for v in cj) + (255,))
        x += lw + rng.integers(0, 6)
    return np.asarray(im, np.float32) / 255


def bokeh(h, w, n, semente, raio=(6, 22), cores=((1, 0.7, 0.35), (1, 0.85, 0.6), (0.6, 0.75, 1.0)),
          y_faixa=(0, 1), blur=3, forca=0.8):
    rng = np.random.default_rng(semente)
    rgb = np.zeros((h, w, 3), np.float32)
    for _ in range(n):
        r = rng.uniform(*raio)
        x, y = rng.uniform(0, w), rng.uniform(y_faixa[0] * h, y_faixa[1] * h)
        c = np.array(cores[rng.integers(len(cores))]) * rng.uniform(0.3, 1.0)
        x0, x1, y0, y1 = int(max(0, x - r)), int(min(w, x + r + 1)), int(max(0, y - r)), int(min(h, y + r + 1))
        if x1 <= x0 or y1 <= y0:
            continue
        yy, xx = np.ogrid[y0:y1, x0:x1]
        disco = np.clip(r - np.sqrt((xx - x) ** 2 + (yy - y) ** 2), 0, 1)
        disco = disco * (0.7 + 0.3 * (np.sqrt((xx - x) ** 2 + (yy - y) ** 2) / r))
        rgb[y0:y1, x0:x1] += disco[..., None] * c
    rgb = borrar(rgb, blur)
    return rgb * forca


def textura_madeira(h, w, semente=3):
    rng = np.random.default_rng(semente)
    y = np.arange(h)[:, None].astype(np.float32)
    x = np.arange(w)[None, :].astype(np.float32)
    n = ruido2d(h, w, 40, semente, 4)
    veio = np.sin(y * 0.12 + n * 6 + np.sin(x * 0.004) * 3) * 0.5 + 0.5
    base = np.array([0.20, 0.11, 0.05])
    escuro = np.array([0.08, 0.04, 0.02])
    rgb = base * veio[..., None] + escuro * (1 - veio[..., None])
    rgb *= (0.85 + 0.15 * rng.random((h, w, 1)))
    return rgb


# ------------------------------------------------------------------ câmera
def amostrar(camada, zoom, px, py, k=1.0, rot=0.0):
    """Amostra uma camada (LH x LW x 4) para a tela com zoom/pan e fator de paralaxe k."""
    z = 1 + (zoom - 1) * k
    c, s = math.cos(rot), math.sin(rot)
    a, b = c / z, -s / z
    d_, e = s / z, c / z
    if isinstance(camada, Image.Image):
        im = camada
    else:
        im = Image.fromarray((np.clip(camada, 0, 1) * 255).astype(np.uint8))
    ww, hh = im.size
    cx, cy = ww / 2 + px * k, hh / 2 + py * k
    cc = cx - a * W / 2 - b * H / 2
    f = cy - d_ * W / 2 - e * H / 2
    out = im.transform((W, H), Image.AFFINE, (a, b, cc, d_, e, f), Image.BILINEAR)
    return np.asarray(out, np.float32) / 255


class Plano:
    """Base: camadas estáticas + paralaxe; subclasses acrescentam animação."""
    luz = (W / 2, H * 0.4, 0.0)  # posição da fonte de luz na tela e intensidade
    particulas = None
    raios = 0.0
    tom = "noite"

    def __init__(self, shot):
        self.shot = shot
        self.camadas = []  # (rgba LHxLW, fator paralaxe)
        self.var = shot.get("variacao", 0)
        self.montar()
        # camadas com alfa 0 em tudo são aditivas (luzes); as demais, normais
        self.camadas = [(Image.fromarray((np.clip(c, 0, 1) * 255).astype(np.uint8)), k, float(c[..., 3].max()) == 0)
                        for c, k in self.camadas]

    def montar(self):
        pass

    def camera(self, p, t):
        modo = self.shot.get("camera", "lento")
        if modo == "aproxima":
            return 1.0 + 0.28 * p, 0, -10 * p, 0
        if modo == "afasta":
            return 1.3 - 0.25 * p, 0, 0, 0
        if modo == "afasta_longo":
            e = 1 - (1 - p) ** 2.2
            return 2.1 - 1.08 * e, 0, -150 * (1 - e), 0
        if modo == "zoom_rapido":
            return 1.0 + 0.22 * (1 - (1 - p) ** 3), 0, 0, 0.012
        if modo == "punch":
            return 1.22 - 0.18 * p, 0, 0, -0.01
        if modo == "paralaxe":
            return 1.12 + 0.06 * p, -40 + 80 * p, 0, 0
        if modo == "sobe":
            return 1.15, 0, 60 - 120 * p, 0
        if modo == "avanca":
            return 1.0 + 0.45 * p ** 1.4, 0, -20 * p, 0
        if modo == "parado":
            return 1.08, 0, 0, 0
        return 1.02 + 0.12 * p, 0, 0, 0

    def fundo(self, p, t):
        return None

    def animado(self, p, t, img):
        return img

    def render(self, p, t):
        z, px, py, rot = self.camera(p, t)
        img = np.zeros((H, W, 3), np.float32)
        f = self.fundo(p, t)
        if f is not None:
            img[:] = f
        for cam, k, aditiva in self.camadas:
            a = amostrar(cam, z, px, py, k, rot * k)
            if aditiva:
                img += a[..., :3]
            else:
                img = img * (1 - a[..., 3:4]) + a[..., :3] * a[..., 3:4]
        self.zoom_atual = z
        return self.animado(p, t, img)


# ------------------------------------------------------------------ PLANOS
class Cidade(Plano):
    particulas = "chuva"
    tom = "noite"

    def montar(self):
        ceu = gradiente(LH, LW, [(0, (0.01, 0.015, 0.03)), (0.42, (0.06, 0.07, 0.12)),
                                 (0.55, (0.16, 0.10, 0.07)), (1, (0.02, 0.02, 0.03))])
        self.camadas.append((para_rgba(ceu), 0.2))
        longe = predios(LH, LW, LH * 0.56, 1, 120, 420, 30, 80, (0.035, 0.04, 0.06), 0.18, tam_jan=2)
        longe[..., :3] = borrar(longe[..., :3], 1.6)
        self.camadas.append((longe, 0.35))
        self.camadas.append((np.dstack([bokeh(LH, LW, 70, 2, (3, 10), y_faixa=(0.35, 0.6), blur=2.5),
                                        np.zeros((LH, LW))]), 0.45))
        # rua em perspectiva com reflexo molhado
        vy = LH * 0.56
        rua = mascara(lambda d: d.polygon([(LW * 0.5 - 8, vy), (LW * 0.5 + 8, vy), (LW * 1.4, LH), (-LW * 0.4, LH)], fill=255))
        cor_rua = gradiente(LH, LW, [(0, (0.03, 0.03, 0.04)), (0.56, (0.10, 0.07, 0.05)), (1, (0.02, 0.02, 0.03))])
        refl = bokeh(LH, LW, 40, 5, (2, 6), y_faixa=(0.58, 1.0), blur=1)
        refl = borrar(refl, 0) * 0.6
        refl_v = np.asarray(Image.fromarray((np.clip(refl, 0, 1) * 255).astype(np.uint8)).resize((LW // 6, LH)).resize((LW, LH), Image.BICUBIC), np.float32) / 255
        self.camadas.append((para_rgba(cor_rua + refl_v * 0.8 + radial(LH, LW, LW / 2, vy, LW * 0.6, 3)[..., None] * OURO * 0.35, rua), 0.7))
        # fachadas laterais
        esq = mascara(lambda d: d.polygon([(0, 0), (LW * 0.36, LH * 0.30), (LW * 0.36, LH * 0.62), (0, LH * 0.82)], fill=255))
        dir_ = mascara(lambda d: d.polygon([(LW, 0), (LW * 0.64, LH * 0.33), (LW * 0.64, LH * 0.62), (LW, LH * 0.85)], fill=255))
        fach = (esq + dir_).clip(0, 1)
        jan = bokeh(LH, LW, 60, 9, (2, 5), y_faixa=(0.1, 0.75), blur=0.8) * fach[..., None]
        self.camadas.append((para_rgba(np.array([0.02, 0.022, 0.03]) + jan * 0.7, fach), 0.85))
        # postes de luz
        postes = bokeh(LH, LW, 10, 11, (10, 26), cores=((1, 0.65, 0.3),), y_faixa=(0.25, 0.5), blur=6, forca=1.2)
        self.camadas.append((np.dstack([postes, np.zeros((LH, LW))]), 1.0))
        self.luz = (W / 2, H * 0.53, 0.5)

    def render(self, p, t):
        z, px, py, rot = self.camera(p, t)
        img = np.zeros((H, W, 3), np.float32)
        for cam, k, aditiva in self.camadas:
            a = amostrar(cam, z, px, py, k, rot)
            if aditiva:
                img += a[..., :3]
            else:
                img = img * (1 - a[..., 3:4]) + a[..., :3] * a[..., 3:4]
        # homem caminhando em direção à câmera (cresce aos poucos)
        fase = t * 2 * math.pi * 0.9
        hh = (200 + 60 * p) * z
        x = W / 2 + 8 * math.sin(fase / 2)
        y = H * 0.56 + hh * 0.9 + 6 * abs(math.sin(fase))
        fig = figura_rgba(x, y, hh, pose_andar(fase), cor_aro=(1.0, 0.68, 0.38), aro=1.0, luz_dir=(0, -1))
        img = img * (1 - fig[..., 3:4]) + fig[..., :3] * fig[..., 3:4]
        return img


class Abismo(Plano):
    particulas = "ouro"
    tom = "ouro"

    def montar(self):
        self.camadas.append((montanhas(LH, LW, LH * 0.62, 60, 21, (0.05, 0.04, 0.05), nevoa=120,
                                       cor_nevoa=(0.5, 0.35, 0.25)), 0.3))
        self.camadas.append((montanhas(LH, LW, LH * 0.80, 40, 22, (0.01, 0.01, 0.015), nevoa=300,
                                       cor_nevoa=(0.12, 0.09, 0.08)), 0.5))
        pe = mascara(lambda d: d.polygon([(0, LH * 0.66), (LW * 0.42, LH * 0.69), (LW * 0.47, LH * 0.74),
                                          (LW * 0.43, LH), (0, LH)], fill=255), blur=1)
        rocha = np.array([0.012, 0.01, 0.012]) + ruido2d(LH, LW, 20, 4)[..., None] * 0.01
        self.camadas.append((para_rgba(rocha, pe), 0.9))
        self.camadas.append((para_rgba(rocha, mascara(lambda d: d.polygon([(LW, LH * 0.6), (LW * 0.7, LH * 0.66), (LW * 0.66, LH), (LW, LH)], fill=255), blur=1)), 1.0))
        self.figura = figura_rgba(LW * 0.40, LH * 0.69, 130, "parado", luz_dir=(0.6, -0.8), w=LW, hh=LH)
        self.camadas.append((self.figura, 0.9))

    def fundo(self, p, t):
        te = self.shot.get("luz_expande", self.shot["ini"])
        e = np.clip((t - te) / 1.2, 0, 1)
        forca = 0.35 + 0.9 * (1 - (1 - e) ** 3)
        self.luz = (W * 0.55, H * 0.47, 0.5 + forca)
        self.raios = forca
        return ceu_amanhecer(H, W, H * 0.47, forca)[:, ::-1] * 0.8


class Despertador(Plano):
    tom = "frio"

    def montar(self):
        self.camadas.append((para_rgba(gradiente(LH, LW, [(0, (0.02, 0.03, 0.06)), (1, (0.04, 0.05, 0.09))])
                                       + radial(LH, LW, LW * 0.8, LH * 0.2, LW * 0.7)[..., None] * np.array([0.1, 0.15, 0.3])), 0.2))
        mesa = mascara(lambda d: d.rectangle([0, LH * 0.66, LW, LH], fill=255))
        self.camadas.append((para_rgba(np.broadcast_to(np.array([0.05, 0.04, 0.04]), (LH, LW, 3)).copy()
                                       + textura_madeira(LH, LW) * 0.25, mesa), 0.6))

    def animado(self, p, t, img):
        im = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
        d = ImageDraw.Draw(im)
        z = self.zoom_atual
        treme = 4 * math.sin(t * 90) * z
        cx, cy, r = W / 2 + treme, H * 0.55, 120 * z
        for lado in (-1, 1):  # sinos
            d.ellipse([cx + lado * r * 0.7 - r * 0.32, cy - r * 1.15, cx + lado * r * 0.7 + r * 0.32, cy - r * 0.55], fill=(110, 95, 70))
        d.line([(cx - r * 0.5, cy + r * 0.85), (cx - r * 0.75, cy + r * 1.2)], fill=(40, 35, 30), width=int(10 * z))
        d.line([(cx + r * 0.5, cy + r * 0.85), (cx + r * 0.75, cy + r * 1.2)], fill=(40, 35, 30), width=int(10 * z))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(70, 60, 45))
        d.ellipse([cx - r * 0.86, cy - r * 0.86, cx + r * 0.86, cy + r * 0.86], fill=(205, 200, 185))
        for k in range(12):
            a = k * math.pi / 6
            d.line([(cx + math.sin(a) * r * 0.72, cy - math.cos(a) * r * 0.72),
                    (cx + math.sin(a) * r * 0.8, cy - math.cos(a) * r * 0.8)], fill=(40, 40, 40), width=int(4 * z))
        ah, am = math.radians(185), math.radians(0 + 6 * (t % 60))
        d.line([(cx, cy), (cx + math.sin(ah) * r * 0.42, cy - math.cos(ah) * r * 0.42)], fill=(20, 20, 20), width=int(8 * z))
        d.line([(cx, cy), (cx + math.sin(am) * r * 0.66, cy - math.cos(am) * r * 0.66)], fill=(20, 20, 20), width=int(5 * z))
        d.ellipse([cx - 7 * z, cy - 7 * z, cx + 7 * z, cy + 7 * z], fill=(160, 40, 30))
        out = np.asarray(im, np.float32) / 255
        out += radial(H, W, cx, cy, r * 2.4)[..., None] * np.array([0.25, 0.3, 0.45]) * 0.3
        self.luz = (cx, cy, 0.15)
        return out


class Celular(Plano):
    tom = "frio"

    def montar(self):
        self.camadas.append((para_rgba(gradiente(LH, LW, [(0, (0.005, 0.008, 0.015)), (1, (0.01, 0.012, 0.02))])), 0.2))

    def animado(self, p, t, img):
        z = self.zoom_atual
        cx, cy = W / 2, H * 0.47
        tela = mascara(lambda d: d.rounded_rectangle([cx - 70 * z, cy - 130 * z, cx + 70 * z, cy + 130 * z], 16 * z, fill=255), W, H)
        pisca = 0.85 + 0.15 * math.sin(t * 13) * (math.sin(t * 3.1) > 0.6)
        brilho = borrar(tela, 40 * z) * 1.6
        img = img + brilho[..., None] * np.array([0.25, 0.45, 0.9]) * pisca
        conteudo = np.zeros((H, W, 3))
        conteudo[:] = np.array([0.55, 0.7, 1.0]) * pisca
        linhas = ((np.arange(H)[:, None] + int(t * 160)) % int(38 * z) < 22 * z) * 0.25
        img = img * (1 - tela[..., None]) + (conteudo - linhas[..., None] * 0.6) * tela[..., None]
        # cabeça e ombros de costas, recortados contra o brilho
        fig = mascara(lambda d: (d.ellipse([cx - 95 * z, H * 0.6 - 120 * z, cx + 95 * z, H * 0.6 + 110 * z], fill=255),
                                 d.polygon([(cx - 260 * z, H + 50), (cx - 200 * z, H * 0.82), (cx - 60 * z, H * 0.74),
                                            (cx + 60 * z, H * 0.74), (cx + 200 * z, H * 0.82), (cx + 260 * z, H + 50)], fill=255)), W, H)
        fig = borrar(fig, 1)
        aro = np.clip(fig - np.roll(fig, int(5 * z), 0), 0, 1)
        img = img * (1 - fig[..., None]) + aro[..., None] * np.array([0.3, 0.5, 1.0]) * 0.8
        self.luz = (cx, cy, 0.3)
        return img


class Quarto(Plano):
    tom = "doente"

    def montar(self):
        rng = np.random.default_rng(self.var)
        self.camadas.append((para_rgba(gradiente(LH, LW, [(0, (0.04, 0.035, 0.03)), (1, (0.08, 0.06, 0.04))])
                                       + radial(LH, LW, LW * 0.3, LH * 0.35, LW * 0.6)[..., None] * np.array([0.25, 0.18, 0.08])), 0.2))
        chao = mascara(lambda d: d.polygon([(0, LH * 0.6), (LW, LH * 0.56), (LW, LH), (0, LH)], fill=255))
        self.camadas.append((para_rgba(np.broadcast_to(np.array([0.06, 0.05, 0.045]), (LH, LW, 3)).copy(), chao), 0.5))
        im = Image.new("RGBA", (LW, LH), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        # mesa com notebook aceso, papéis e roupas espalhados
        d.rectangle([LW * 0.05, LH * 0.47, LW * 0.6, LH * 0.5], fill=(30, 22, 16, 255))
        d.rectangle([LW * 0.1, LH * 0.5, LW * 0.13, LH * 0.66], fill=(22, 16, 12, 255))
        d.rectangle([LW * 0.52, LH * 0.5, LW * 0.55, LH * 0.66], fill=(22, 16, 12, 255))
        d.polygon([(LW * 0.25, LH * 0.47), (LW * 0.42, LH * 0.47), (LW * 0.45, LH * 0.37), (LW * 0.28, LH * 0.37)], fill=(120, 150, 190, 255))
        for _ in range(26):
            x, y = rng.uniform(0, LW), rng.uniform(LH * 0.6, LH * 0.95)
            a = rng.uniform(0, math.pi)
            s = rng.uniform(14, 40)
            pts = [(x + math.cos(a + k * math.pi / 2) * s * (1 if k % 2 else 0.7), y + math.sin(a + k * math.pi / 2) * s * 0.5) for k in range(4)]
            c = rng.integers(60, 170)
            d.polygon(pts, fill=(int(c), int(c * 0.95), int(c * 0.85), 255))
        for _ in range(7):
            x, y = rng.uniform(0, LW), rng.uniform(LH * 0.62, LH * 0.9)
            d.ellipse([x, y, x + rng.uniform(60, 140), y + rng.uniform(25, 50)], fill=(int(rng.integers(20, 60)), 25, 30, 255))
        for _ in range(5):
            x, y = rng.uniform(LW * 0.1, LW * 0.55), LH * 0.47
            d.rectangle([x, y - 26, x + 12, y], fill=(150, 30, 20, 255))
        self.camadas.append((np.asarray(im, np.float32) / 255, 0.8))
        self.luz = (W * 0.36, H * 0.42, 0.2)


class Multidao(Plano):
    tom = "frio"

    def montar(self):
        rng = np.random.default_rng(40 + self.var)
        self.camadas.append((para_rgba(gradiente(LH, LW, [(0, (0.15, 0.16, 0.18)), (0.5, (0.22, 0.2, 0.2)), (1, (0.05, 0.05, 0.06))])), 0.2))
        self.camadas.append((predios(LH, LW, LH * 0.62, 5, 200, 520, 40, 110, (0.08, 0.085, 0.1), 0.1, (0.7, 0.75, 0.8)), 0.4))
        borr = np.zeros((LH, LW))
        for k in range(38):
            h = rng.uniform(170, 330)
            x = rng.uniform(-40, LW + 40)
            y = LH * 0.6 + h * 0.95 + rng.uniform(-10, 60)
            borr = np.maximum(borr, mascara(lambda d: desenhar_figura(d, x, y, h, pose_andar(rng.uniform(0, 6)))))
        # desfoque de movimento horizontal (pessoas passando rápido)
        mb = np.asarray(Image.fromarray((borr * 255).astype(np.uint8)).resize((LW // 4, LH)).resize((LW, LH), Image.BILINEAR), np.float32) / 255
        self.camadas.append((camada_cor((0.03, 0.03, 0.035), np.clip(mb * 1.3, 0, 0.92)), 0.8))

    def animado(self, p, t, img):
        z = self.zoom_atual
        fig = figura_rgba(W / 2, H * 0.6 + 330 * z * 0.95, 330 * z, "baixa", cor_aro=(0.75, 0.8, 0.9), aro=0.5)
        return img * (1 - fig[..., 3:4]) + fig[..., :3] * fig[..., 3:4]


class Amanhecer(Plano):
    particulas = "poeira"
    tom = "ouro"

    def montar(self):
        self.camadas.append((para_rgba(ceu_amanhecer(LH, LW, LH * 0.55, 1.0)), 0.15))
        self.camadas.append((nuvens(LH, LW, 8, 0.25, 0.5, 0.45), 0.25))
        for i, (base, amp, cor, k) in enumerate([(0.62, 110, (0.30, 0.18, 0.14), 0.35), (0.72, 140, (0.16, 0.09, 0.08), 0.55),
                                                 (0.86, 160, (0.05, 0.03, 0.03), 0.8)]):
            self.camadas.append((montanhas(LH, LW, LH * base, amp, 30 + i + self.var, cor, nevoa=90,
                                           cor_nevoa=(0.85, 0.55, 0.32)), k))
        self.luz = (W / 2, H * 0.55, 1.2)
        self.raios = 0.8


class Cortina(Plano):
    particulas = "poeira"
    tom = "ouro"

    def montar(self):
        self.camadas.append((para_rgba(gradiente(LH, LW, [(0, (0.02, 0.02, 0.025)), (1, (0.03, 0.025, 0.02))])), 0.3))

    def animado(self, p, t, img):
        z = self.zoom_atual
        cx, cy = W / 2, H * 0.42
        jw, jh = 300 * z, 520 * z
        abre = 1 - (1 - min(1, p * 1.5)) ** 2
        janela = np.zeros((H, W))
        janela[int(cy - jh / 2):int(cy + jh / 2), int(cx - jw / 2):int(cx + jw / 2)] = 1
        ceu = ceu_amanhecer(H, W, cy + jh * 0.25, 0.4 + 0.9 * abre)
        img = img * (1 - janela[..., None]) + ceu * janela[..., None]
        # caixilhos
        img[int(cy - 3 * z):int(cy + 3 * z), int(cx - jw / 2):int(cx + jw / 2)] *= 0.1
        img[int(cy - jh / 2):int(cy + jh / 2), int(cx - 3 * z):int(cx + 3 * z)] *= 0.1
        # cortinas com dobras
        xs = np.arange(W)[None, :]
        dobra = 0.6 + 0.4 * np.sin(xs / (9 * z) * math.pi) ** 2
        larg = (jw / 2 + 40 * z) * (1 - abre * 0.85)
        esq = ((xs > cx - jw / 2 - 60 * z) & (xs < cx - jw / 2 - 60 * z + larg)).astype(float)
        dir_ = ((xs < cx + jw / 2 + 60 * z) & (xs > cx + jw / 2 + 60 * z - larg)).astype(float)
        ys = np.arange(H)[:, None]
        faixa = ((ys > cy - jh / 2 - 40 * z) & (ys < H)).astype(float)
        cort = np.clip(esq + dir_, 0, 1) * faixa
        cor_c = np.array([0.22, 0.12, 0.06]) * dobra[..., None] * (0.3 + 0.7 * abre)
        img = img * (1 - cort[..., None]) + cor_c * cort[..., None]
        # luz derramando no quarto
        img += radial(H, W, cx, cy, W * 0.9, 2)[..., None] * OURO * 0.5 * abre
        fig = figura_rgba(cx, H * 0.98, 520 * z, "abertos" if abre > 0.6 else "parado", luz_dir=(0, -1), aro=1.0)
        img = img * (1 - fig[..., 3:4]) + fig[..., :3] * fig[..., 3:4]
        self.luz = (cx, cy, 0.4 + 1.0 * abre)
        self.raios = abre
        return img


def figura_sentada(d, x, y, h, fill=255):
    """Silhueta sentada de perfil (lendo/estudando), x,y = assento."""
    d.ellipse([x - 0.06 * h, y - 0.62 * h, x + 0.06 * h, y - 0.48 * h], fill=fill)
    d.polygon([(x - 0.09 * h, y - 0.46 * h), (x + 0.07 * h, y - 0.46 * h), (x + 0.12 * h, y), (x - 0.12 * h, y)], fill=fill)
    d.line([(x + 0.05 * h, y - 0.4 * h), (x + 0.2 * h, y - 0.24 * h), (x + 0.3 * h, y - 0.3 * h)], fill=fill, width=int(0.05 * h))
    d.line([(x, y), (x + 0.26 * h, y), (x + 0.26 * h, y + 0.27 * h)], fill=fill, width=int(0.07 * h))


class Estudo(Plano):
    particulas = "poeira"
    tom = "ouro"
    claro = 0.6

    def montar(self):
        self.camadas.append((para_rgba(gradiente(LH, LW, [(0, (0.03, 0.025, 0.02)), (1, (0.05, 0.035, 0.025))])), 0.2))
        jan = mascara(lambda d: d.rectangle([LW * 0.6, LH * 0.18, LW * 0.95, LH * 0.52], fill=255))
        ceu = ceu_amanhecer(LH, LW, LH * 0.45, 0.4 + self.claro)
        self.camadas.append((para_rgba(ceu, jan), 0.35))
        mesa = mascara(lambda d: (d.rectangle([LW * 0.05, LH * 0.6, LW * 0.95, LH * 0.63], fill=255),
                                  d.rectangle([LW * 0.12, LH * 0.63, LW * 0.15, LH * 0.85], fill=255),
                                  d.rectangle([LW * 0.85, LH * 0.63, LW * 0.88, LH * 0.85], fill=255)))
        self.camadas.append((para_rgba(textura_madeira(LH, LW) * 0.8, mesa), 0.6))
        livro = mascara(lambda d: (d.pieslice([LW * 0.38, LH * 0.57, LW * 0.52, LH * 0.62], 180, 360, fill=255),
                                   d.pieslice([LW * 0.52, LH * 0.57, LW * 0.66, LH * 0.62], 180, 360, fill=255)))
        self.camadas.append((para_rgba(np.broadcast_to(np.array([0.95, 0.85, 0.65]), (LH, LW, 3)).copy(), livro), 0.6))
        pessoa = mascara(lambda d: figura_sentada(d, LW * 0.27, LH * 0.66, 360))
        self.camadas.append((camada_cor((0.012, 0.01, 0.01), pessoa), 0.7))
        self.luz = (W * 0.78, H * 0.35, 0.6 + self.claro)
        self.raios = 0.6 * self.claro + 0.2

    def fundo(self, p, t):
        return None

    def animado(self, p, t, img):
        return img + radial(H, W, W * 0.5, H * 0.58, W * 0.45, 2)[..., None] * OURO * 0.35


class Caminhada(Plano):
    particulas = "poeira"
    tom = "ouro"

    def montar(self):
        self.camadas.append((para_rgba(ceu_amanhecer(LH, LW, LH * 0.5, 1.0)), 0.15))
        self.camadas.append((montanhas(LH, LW, LH * 0.56, 70, 51, (0.35, 0.22, 0.16), nevoa=60, cor_nevoa=(0.9, 0.6, 0.35)), 0.3))
        colina = montanhas(LH, LW, LH * 0.68, 50, 52, (0.06, 0.04, 0.03), rug=0.4)
        estrada = mascara(lambda d: d.polygon([(LW * 0.49, LH * 0.6), (LW * 0.51, LH * 0.6), (LW * 0.85, LH), (LW * 0.15, LH)], fill=255), blur=1)
        colina[..., :3] = colina[..., :3] * (1 - estrada[..., None]) + np.array([0.28, 0.18, 0.12]) * estrada[..., None]
        colina[..., 3] = np.maximum(colina[..., 3], estrada * (np.arange(LH)[:, None] > LH * 0.6))
        self.camadas.append((colina, 0.6))
        self.luz = (W / 2, H * 0.5, 1.4)
        self.raios = 0.9

    def animado(self, p, t, img):
        fase = t * 2 * math.pi * 0.8
        h = 210 - 50 * p
        fig = figura_rgba(W / 2 + 10, H * 0.7 + h * 0.2, h, pose_andar(fase), luz_dir=(0, -1))
        return img * (1 - fig[..., 3:4]) + fig[..., :3] * fig[..., 3:4]


class Porta(Plano):
    particulas = "poeira"
    tom = "contraste"

    def montar(self):
        quarto = gradiente(LH, LW, [(0, (0.04, 0.01, 0.05)), (1, (0.02, 0.0, 0.03))])
        quarto += bokeh(LH, LW, 50, 77, (8, 28), cores=((0.8, 0.1, 0.5), (0.4, 0.1, 0.9), (0.9, 0.2, 0.2)), blur=7, forca=0.7)
        self.camadas.append((para_rgba(quarto), 0.3))
        porta = mascara(lambda d: d.rectangle([LW * 0.4, LH * 0.22, LW * 0.68, LH * 0.78], fill=255))
        luz = np.broadcast_to(np.array([1.0, 0.92, 0.75]), (LH, LW, 3)).copy()
        self.camadas.append((para_rgba(luz, porta), 0.5))
        piso = mascara(lambda d: d.polygon([(LW * 0.4, LH * 0.78), (LW * 0.68, LH * 0.78), (LW * 0.95, LH), (LW * 0.2, LH)], fill=255), blur=8)
        self.camadas.append((camada_cor((0.9, 0.7, 0.45), piso * 0.35), 0.6))
        self.luz = (W * 0.54, H * 0.45, 1.3)
        self.raios = 1.0

    def animado(self, p, t, img):
        fase = t * 2 * math.pi * 0.7
        h = 380 - 140 * p
        x = W * 0.54
        fig = figura_rgba(x, H * 0.78 + h * 0.08, h, pose_andar(fase), luz_dir=(0, -1), aro=1.2)
        return img * (1 - fig[..., 3:4]) + fig[..., :3] * fig[..., 3:4]


class Afastar(Plano):
    particulas = "ouro"
    tom = "contraste"

    def montar(self):
        ceu = gradiente(LH, LW, [(0, (0.02, 0.02, 0.03)), (1, (0.03, 0.02, 0.02))])
        x = np.linspace(0, 1, LW)[None, :, None]
        ceu = ceu * (1 - x) + ceu_amanhecer(LH, LW, LH * 0.55, 1.0) * x ** 1.6
        self.camadas.append((para_rgba(ceu), 0.2))
        rng = np.random.default_rng(3)
        grupo = np.zeros((LH, LW))
        for k in range(9):
            h = rng.uniform(300, 380)
            xx = rng.uniform(-30, LW * 0.33)
            grupo = np.maximum(grupo, mascara(lambda d: desenhar_figura(d, xx, LH * 0.82, h, "parado")))
        self.camadas.append((camada_cor((0.0, 0.0, 0.0), grupo), 0.6))
        chao = mascara(lambda d: d.rectangle([0, LH * 0.82, LW, LH], fill=255))
        self.camadas.append((camada_cor((0.03, 0.02, 0.02), chao), 0.6))
        self.luz = (W * 0.95, H * 0.55, 1.2)
        self.raios = 0.8

    def animado(self, p, t, img):
        fase = t * 2 * math.pi * 0.8
        x = W * (0.45 + 0.25 * p)
        fig = figura_rgba(x, H * 0.82, 330 - 40 * p, pose_andar(fase), luz_dir=(1, -0.2), aro=1.2)
        return img * (1 - fig[..., 3:4]) + fig[..., :3] * fig[..., 3:4]


class Biblia(Plano):
    particulas = "poeira_feixe"
    tom = "ouro"

    def montar(self):
        self.camadas.append((para_rgba(gradiente(LH, LW, [(0, (0.015, 0.012, 0.01)), (1, (0.03, 0.02, 0.015))])), 0.2))
        mesa = mascara(lambda d: d.polygon([(0, LH * 0.5), (LW, LH * 0.5), (LW, LH), (0, LH)], fill=255))
        self.camadas.append((para_rgba(textura_madeira(LH, LW, 9) * 0.9, mesa), 0.5))
        cx, cy = LW / 2, LH * 0.66
        im = Image.new("RGBA", (LW, LH), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        # capa, páginas abertas (curvas) e linhas de texto ilegíveis (sem falsear versículos)
        d.polygon([(cx - 250, cy - 120), (cx + 250, cy - 120), (cx + 270, cy + 150), (cx - 270, cy + 150)], fill=(40, 14, 10, 255))
        for lado in (-1, 1):
            pts = []
            for k in range(41):
                u = k / 40
                pts.append((cx + lado * (8 + u * 236), cy - 110 - 18 * math.sin(u * math.pi) + 12 * u))
            for k in range(40, -1, -1):
                u = k / 40
                pts.append((cx + lado * (8 + u * 240), cy + 132 - 12 * math.sin(u * math.pi) + 8 * u))
            d.polygon(pts, fill=(226, 205, 160, 255))
            for ln in range(17):
                y = cy - 80 + ln * 12.5
                x0 = cx + lado * 30
                x1 = cx + lado * (30 + 190 * (0.75 + 0.25 * ((ln * 7) % 5) / 4))
                d.line([(min(x0, x1), y), (max(x0, x1), y)], fill=(120, 100, 75, 255), width=3)
        d.line([(cx, cy - 112), (cx, cy + 135)], fill=(150, 120, 80, 255), width=4)
        d.line([(cx + 30, cy - 120), (cx + 40, cy + 200)], fill=(160, 20, 20, 255), width=5)  # fita marcadora
        livro = np.asarray(im, np.float32) / 255
        sombra = borrar(livro[..., 3], 18)
        sombra_l = np.zeros_like(livro)
        sombra_l[..., 3] = np.roll(sombra, 20, 0) * 0.7
        self.camadas.append((sombra_l, 0.55))
        self.camadas.append((livro, 0.55))
        self.luz = (W * 0.1, H * 0.05, 1.2)
        self.raios = 1.0

    def animado(self, p, t, img):
        y, x = np.mgrid[:H, :W]
        # feixe diagonal saindo da janela (canto superior esquerdo)
        d = np.abs((x - W * 0.08) * 0.82 - (y - H * 0.02) * 0.57) / 120
        feixe = np.clip(1 - d, 0, 1) ** 1.6 * np.clip(y / (H * 0.7), 0, 1.2)
        img = img * (0.55 + 0.6 * feixe[..., None]) + feixe[..., None] * OURO * 0.25
        brilho = 0.5 + 0.5 * min(1, p * 2)
        img += radial(H, W, W / 2, H * 0.64, W * 0.5, 2)[..., None] * OURO * 0.35 * brilho
        return img


class Odres(Plano):
    particulas = "ouro"
    tom = "ouro"

    def montar(self):
        self.camadas.append((para_rgba(gradiente(LH, LW, [(0, (0.02, 0.012, 0.01)), (1, (0.04, 0.025, 0.015))])
                                       + radial(LH, LW, LW / 2, LH * 0.45, LW * 0.6)[..., None] * np.array([0.2, 0.1, 0.05])), 0.2))
        self.camadas.append((para_rgba(textura_madeira(LH, LW, 5) * 0.6,
                                       mascara(lambda d: d.rectangle([0, LH * 0.74, LW, LH], fill=255))), 0.5))
        self.luz = (W / 2, H * 0.25, 0.6)
        self.raios = 0.5

    def odre(self, novo, t):
        def desenho(d):
            cx, cy = W / 2, H * 0.58
            d.ellipse([cx - 150, cy - 160, cx + 150, cy + 170], fill=255)
            d.polygon([(cx - 45, cy - 140), (cx + 45, cy - 140), (cx + 30, cy - 230), (cx - 30, cy - 230)], fill=255)
            d.ellipse([cx - 40, cy - 245, cx + 40, cy - 215], fill=255)
        m = borrar(mascara(desenho, W, H), 1.5)
        n = ruido2d(H, W, 18, 61, 4)
        if novo:
            cor = np.array([0.55, 0.36, 0.2]) * (0.9 + 0.12 * n[..., None])
            sombra = radial(H, W, W / 2 - 60, H * 0.5, 260, 1.2)[..., None]
            cor = cor * (0.35 + 0.9 * sombra)
        else:
            cor = np.array([0.18, 0.1, 0.06]) * (0.6 + 0.5 * n[..., None])
            racha = (np.abs(ruido2d(H, W, 30, 99, 3)) < 0.035).astype(float)
            vaz = np.clip(np.sin(t * 3) * 0.5 + 0.5, 0.3, 1)
            cor = cor * (1 - racha[..., None]) + np.array([0.35, 0.02, 0.05]) * racha[..., None] * vaz
            cor *= 0.35 + 0.7 * radial(H, W, W / 2 - 60, H * 0.5, 280, 1.2)[..., None]
        return cor, m

    def animado(self, p, t, img):
        t_novo = self.shot.get("novo_em", 1e9)
        mix = float(np.clip((t - t_novo) / 0.6, 0, 1))
        for novo, peso in ((False, 1 - mix), (True, mix)):
            if peso <= 0:
                continue
            cor, m = self.odre(novo, t)
            a = m[..., None] * peso
            img = img * (1 - a) + cor * a
        # fio de vinho caindo dentro do gargalo
        y, x = np.mgrid[:H, :W]
        onda = 3 * np.sin(y * 0.05 + t * 12)
        fio = np.clip(1 - np.abs(x - W / 2 - onda) / 6, 0, 1) * (y < H * 0.58 - 230) * (y > 0)
        img = img * (1 - fio[..., None]) + np.array([0.45, 0.02, 0.08]) * fio[..., None]
        if mix < 1:  # gotas vazando das rachaduras do odre velho
            rng = np.random.default_rng(int(t * 30) // 3)
            for _ in range(6):
                gx = W / 2 + rng.uniform(-120, 120)
                gy = H * 0.58 + rng.uniform(40, 220) + (t * 140) % 80
                img += radial(H, W, gx, gy, 6, 1)[..., None] * np.array([0.4, 0.0, 0.05]) * (1 - mix)
        img += radial(H, W, W / 2, H * 0.55, 330, 2)[..., None] * OURO * 0.55 * mix
        self.luz = (W / 2, H * 0.3, 0.5 + 0.8 * mix)
        return img


class Espelho(Plano):
    particulas = "poeira"
    tom = "noite"

    def montar(self):
        self.camadas.append((para_rgba(gradiente(LH, LW, [(0, (0.01, 0.012, 0.018)), (1, (0.02, 0.02, 0.03))])), 0.2))

    def animado(self, p, t, img):
        z = self.zoom_atual
        t_acende = self.shot.get("acende", 1e9)
        acende = float(np.clip((t - t_acende) / 0.9, 0, 1))
        levanta = float(np.clip((t - self.shot.get("levanta", 1e9)) / 2.5, 0, 1))
        cx, cy = W / 2, H * 0.4
        mw, mh = 330 * z, 520 * z
        esp = np.zeros((H, W))
        esp[int(cy - mh / 2):int(cy + mh / 2), int(cx - mw / 2):int(cx + mw / 2)] = 1
        moldura = np.zeros((H, W))
        moldura[int(cy - mh / 2 - 14 * z):int(cy + mh / 2 + 14 * z), int(cx - mw / 2 - 14 * z):int(cx + mw / 2 + 14 * z)] = 1
        moldura -= esp
        fundo_esp = gradiente(H, W, [(0, (0.04, 0.05, 0.07)), (1, (0.02, 0.025, 0.035))]) * (1 - acende) + \
            ceu_amanhecer(H, W, cy - mh * 0.1, 0.9) * acende * 0.8
        img = img * (1 - esp[..., None]) + fundo_esp * esp[..., None]
        img = img * (1 - moldura[..., None]) + (np.array([0.12, 0.09, 0.05]) + OURO * 0.35 * acende) * moldura[..., None]
        # reflexo: cabeça baixa -> levantada
        inc = 25 * (1 - levanta) - 6 * levanta
        refl = figura_rgba(cx, cy + mh / 2 + 140 * z, 430 * z, dict(POSES["parado"], cab=inc),
                           cor_aro=OURO, aro=0.3 + 0.9 * acende, luz_dir=(0, -1))
        refl[..., 3] *= esp
        img = img * (1 - refl[..., 3:4] * 0.92) + refl[..., :3] * refl[..., 3:4] * 0.92
        # pessoa em primeiro plano, de costas
        fig = figura_rgba(cx + 30 * z, H * 1.78, 900 * z, "parado", aro=0.4 + 0.8 * acende, luz_dir=(0, -1))
        img = img * (1 - fig[..., 3:4]) + fig[..., :3] * fig[..., 3:4]
        img += radial(H, W, cx, cy, W, 2)[..., None] * OURO * 0.4 * acende
        self.luz = (cx, cy - mh * 0.2, 0.2 + 1.2 * acende)
        self.raios = acende
        self.particulas = "poeira" if acende < 0.5 else "ouro"
        return img


class Reflexao(Estudo):
    claro = 1.0


class Montanhas(Amanhecer):
    def montar(self):
        self.camadas.append((para_rgba(ceu_amanhecer(LH, LW, LH * 0.45, 1.15)), 0.15))
        self.camadas.append((nuvens(LH, LW, 18, 0.2, 0.42, 0.5, (1, 0.75, 0.5)), 0.25))
        for i, (base, amp, cor, k) in enumerate([(0.55, 220, (0.40, 0.26, 0.2), 0.3), (0.7, 180, (0.18, 0.11, 0.09), 0.55),
                                                 (0.9, 160, (0.04, 0.025, 0.02), 0.85)]):
            self.camadas.append((montanhas(LH, LW, LH * base, amp, 70 + i, cor, rug=0.42, nevoa=110,
                                           cor_nevoa=(0.95, 0.65, 0.4)), k))
        self.luz = (W / 2, H * 0.45, 1.4)
        self.raios = 1.0


class Estrada(Plano):
    particulas = "poeira"
    tom = "ouro"

    def montar(self):
        self.camadas.append((para_rgba(ceu_amanhecer(LH, LW, LH * 0.48, 1.0)), 0.1))
        self.camadas.append((montanhas(LH, LW, LH * 0.5, 40, 81, (0.3, 0.2, 0.15), nevoa=40, cor_nevoa=(0.9, 0.6, 0.4)), 0.2))
        chao = gradiente(LH, LW, [(0, (0.1, 0.06, 0.04)), (0.5, (0.12, 0.07, 0.05)), (1, (0.03, 0.02, 0.015))])
        m_chao = (np.arange(LH)[:, None] > LH * 0.5) * np.ones((1, LW))
        self.camadas.append((para_rgba(chao, m_chao), 0.4))
        vy = LH * 0.5
        estrada = mascara(lambda d: d.polygon([(LW / 2 - 3, vy), (LW / 2 + 3, vy), (LW * 0.95, LH), (LW * 0.05, LH)], fill=255))
        cor = np.array([0.06, 0.05, 0.05]) + radial(LH, LW, LW / 2, vy, LH * 0.5, 2)[..., None] * OURO * 0.5
        faixa = mascara(lambda d: [d.polygon([(LW / 2 - 0.5 - k * 0.2, vy + (LH - vy) * (k / 10) ** 2),
                                              (LW / 2 + 0.5 + k * 0.2, vy + (LH - vy) * (k / 10) ** 2),
                                              (LW / 2 + 1 + k * 0.5, vy + (LH - vy) * ((k + 0.5) / 10) ** 2),
                                              (LW / 2 - 1 - k * 0.5, vy + (LH - vy) * ((k + 0.5) / 10) ** 2)], fill=255)
                                   for k in range(10)])
        cor = cor * (1 - faixa[..., None]) + np.array([0.8, 0.65, 0.3]) * faixa[..., None]
        self.camadas.append((para_rgba(cor, estrada), 0.4))
        self.luz = (W / 2, H * 0.48, 1.5)
        self.raios = 1.0


class LuzCaminho(Plano):
    particulas = "ouro"
    tom = "ouro"

    def fundo(self, p, t):
        ceu = ceu_amanhecer(H, W, H * 0.45, 1.3)
        n = ruido2d(H, W, 70, 5, 4)
        nevoa = np.clip(0.5 + n * 0.4, 0, 1)
        return ceu * (0.7 + 0.5 * nevoa[..., None])

    def montar(self):
        self.camadas.append((montanhas(LH, LW, LH * 0.78, 60, 91, (0.04, 0.025, 0.02), rug=0.3, nevoa=200, cor_nevoa=(0.6, 0.4, 0.25)), 0.6))
        self.luz = (W / 2, H * 0.45, 1.8)
        self.raios = 1.3

    def animado(self, p, t, img):
        fase = t * 2 * math.pi * 0.75
        fig = figura_rgba(W / 2, H * 0.78, 260 - 40 * p, pose_andar(fase), luz_dir=(0, -1), aro=1.4)
        return img * (1 - fig[..., 3:4]) + fig[..., :3] * fig[..., 3:4]


class Escalada(Plano):
    particulas = "ouro"
    tom = "ouro"

    def montar(self):
        self.camadas.append((para_rgba(ceu_amanhecer(LH, LW, LH * 0.35, 1.1)), 0.15))
        self.camadas.append((nuvens(LH, LW, 28, 0.4, 0.7, 0.55, (0.9, 0.6, 0.45)), 0.3))
        rocha = mascara(lambda d: d.polygon([(0, LH * 0.42), (LW * 0.35, LH * 0.40), (LW * 0.62, LH * 0.47),
                                             (LW * 0.7, LH), (0, LH)], fill=255), blur=1)
        tex = np.array([0.05, 0.035, 0.03]) * (0.6 + 0.6 * ruido2d(LH, LW, 12, 3, 4)[..., None])
        self.camadas.append((para_rgba(tex, rocha), 0.7))
        self.luz = (W * 0.62, H * 0.35, 1.5)
        self.raios = 1.1

    def animado(self, p, t, img):
        z = self.zoom_atual
        sobe = min(1, p * 1.2)
        # alpinista com braço estendido alcançando a borda
        x, y = W * 0.5, H * 0.72 - 120 * sobe * z
        pose = dict(be=(170, 5), bd=(-140, -10), pe=(20, 30), pd=(-10, 50), cab=-10)
        fig = figura_rgba(x, y, 330 * z, pose, luz_dir=(0.4, -1), aro=1.2)
        return img * (1 - fig[..., 3:4]) + fig[..., :3] * fig[..., 3:4]


class SolNascente(Plano):
    particulas = "ouro"
    tom = "ouro"

    def fundo(self, p, t):
        sol_y = H * (0.58 - 0.08 * p)
        self.luz = (W / 2, sol_y, 2.0)
        self.raios = 1.4
        return ceu_amanhecer(H, W, sol_y, 1.35)

    def montar(self):
        self.camadas.append((nuvens(LH, LW, 38, 0.55, 0.95, 0.75, (0.95, 0.7, 0.5)), 0.5))
        self.camadas.append((nuvens(LH, LW, 39, 0.75, 1.0, 0.8, (0.55, 0.38, 0.32)), 0.8))


class Cume(Plano):
    particulas = "ouro"
    tom = "ouro"

    def montar(self):
        self.camadas.append((para_rgba(ceu_amanhecer(LH, LW, LH * 0.5, 1.3)), 0.2))
        self.camadas.append((nuvens(LH, LW, 48, 0.15, 0.4, 0.45, (1, 0.8, 0.55)), 0.3))
        self.camadas.append((nuvens(LH, LW, 49, 0.6, 0.9, 0.75, (0.95, 0.7, 0.5)), 0.45))
        for i, (base, amp, cor, k) in enumerate([(0.75, 160, (0.3, 0.2, 0.17), 0.5), (0.85, 120, (0.12, 0.08, 0.07), 0.7)]):
            self.camadas.append((montanhas(LH, LW, LH * base, amp, 101 + i, cor, nevoa=120, cor_nevoa=(0.95, 0.7, 0.5)), k))
        pico = mascara(lambda d: d.polygon([(LW * 0.12, LH), (LW * 0.44, LH * 0.6), (LW * 0.5, LH * 0.585),
                                            (LW * 0.56, LH * 0.6), (LW * 0.9, LH)], fill=255), blur=1)
        tex = np.array([0.03, 0.02, 0.018]) * (0.6 + 0.5 * ruido2d(LH, LW, 14, 8, 4)[..., None])
        aro = np.clip(pico - np.roll(pico, 3, 0), 0, 1)
        tex = tex + aro[..., None] * OURO * 0.8
        self.camadas.append((para_rgba(tex, pico), 1.0))
        self.camadas.append((figura_rgba(LW * 0.5, LH * 0.588, 110, "erguidos", luz_dir=(0, -1), aro=1.3, w=LW, hh=LH), 1.0))
        self.luz = (W / 2, H * 0.5, 1.9)
        self.raios = 1.4


TIPOS = dict(cidade=Cidade, abismo=Abismo, despertador=Despertador, celular=Celular, quarto=Quarto,
             multidao=Multidao, amanhecer=Amanhecer, cortina=Cortina, estudo=Estudo, caminhada=Caminhada,
             porta=Porta, afastar=Afastar, biblia=Biblia, odres=Odres, espelho=Espelho, reflexao=Reflexao,
             montanhas=Montanhas, estrada=Estrada, luz_caminho=LuzCaminho, escalada=Escalada,
             sol_nascente=SolNascente, cume=Cume)


@lru_cache(maxsize=8)
def _plano(chave):
    import json
    shot = json.loads(chave)
    return TIPOS[shot["tipo"]](shot)


def plano(shot):
    import json
    return _plano(json.dumps(shot, sort_keys=True))
