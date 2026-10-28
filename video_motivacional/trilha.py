"""Trilha sonora cinematográfica sintetizada + SFX + mixagem com a narração.

Saída: build/mix.wav
"""
import json
import os
import subprocess

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, fftconvolve

from eventos import construir_eventos

SR = 48000
BUILD = os.path.join(os.path.dirname(__file__), "build")
rng = np.random.default_rng(7)


# ---------------------------------------------------------------- utilidades
def lp(x, fc, ordem=2):
    return sosfilt(butter(ordem, fc, "low", fs=SR, output="sos"), x)


def hp(x, fc, ordem=2):
    return sosfilt(butter(ordem, fc, "high", fs=SR, output="sos"), x)


def bp(x, f1, f2, ordem=2):
    return sosfilt(butter(ordem, [f1, f2], "band", fs=SR, output="sos"), x)


def nota(nome):
    tab = {"C": -9, "C#": -8, "D": -7, "D#": -6, "E": -5, "F": -4, "F#": -3,
           "G": -2, "G#": -1, "A": 0, "A#": 1, "B": 2}
    oit = int(nome[-1])
    return 440.0 * 2 ** ((tab[nome[:-1]] + (oit - 4) * 12) / 12)


def tempo(d):
    return np.arange(int(d * SR)) / SR


def somar(buf, ini, sinal, ganho=1.0):
    i = int(ini * SR)
    if i >= len(buf) or i + len(sinal) <= 0:
        return
    if i < 0:
        sinal, i = sinal[-i:], 0
    n = min(len(sinal), len(buf) - i)
    buf[i:i + n] += sinal[:n] * ganho


def reverb(x, dur=3.2, mix=0.35):
    t = tempo(dur)
    ir = rng.standard_normal(len(t)) * np.exp(-t * 6.9 / dur)
    ir = lp(ir, 6000)
    ir[:int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))
    ir /= np.sqrt((ir ** 2).sum())
    w = fftconvolve(x, ir)[:len(x)]
    return x * (1 - mix) + w * mix * 2.2


# ---------------------------------------------------------------- instrumentos
def piano(f, d=3.0, vel=1.0):
    t = tempo(d)
    s = np.zeros_like(t)
    for k, a in enumerate([1, 0.55, 0.32, 0.18, 0.1, 0.06], 1):
        fk = f * k * (1 + 0.0004 * k * k)
        s += a * np.sin(2 * np.pi * fk * t) * np.exp(-t * (1.1 + 0.9 * k) * (1 + f / 900))
    ataque = np.minimum(1, t / 0.004)
    return s * ataque * vel * 0.25


def pad(freqs, d, ataque=1.5, liberar=2.0, brilho=1800):
    t = tempo(d)
    s = np.zeros_like(t)
    for f in freqs:
        for det in (-0.08, 0.0, 0.07):
            fd = f * 2 ** (det / 12)
            fase = rng.uniform(0, 2 * np.pi)
            # serra suavizada (poucos harmônicos)
            for k in range(1, 7):
                s += np.sin(2 * np.pi * fd * k * t + fase * k) / k
    s = lp(s, brilho)
    env = np.minimum(1, t / ataque) * np.minimum(1, (d - t) / liberar).clip(0, 1)
    return s * env / (len(freqs) * 9)


def sub_impacto(d=2.6, f0=62, gan=1.0):
    t = tempo(d)
    f = f0 * (1 + 1.6 * np.exp(-t * 18))
    fase = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(fase) * np.exp(-t * 1.6)
    ruido = lp(rng.standard_normal(len(t)), 900) * np.exp(-t * 9) * 0.6
    s = np.tanh((s + ruido) * 1.6)
    return s * gan * 0.8


def tambor(d=1.2, f0=95):
    t = tempo(d)
    f = f0 * (1 + 0.7 * np.exp(-t * 30))
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 5)
    s += lp(rng.standard_normal(len(t)), 2500) * np.exp(-t * 22) * 0.5
    return np.tanh(s * 1.3) * 0.55


def whoosh(d=0.6, sobe=True):
    t = tempo(d)
    n = rng.standard_normal(len(t))
    env = np.sin(np.pi * t / d) ** 2
    # varredura de filtro por blocos
    out = np.zeros_like(n)
    bloco = 1024
    for i in range(0, len(n), bloco):
        p = i / len(n)
        fc = 300 + 5000 * (p if sobe else 1 - p) ** 1.5
        out[i:i + bloco] = bp(n[max(0, i - 2048):i + bloco], fc * 0.6, min(fc * 1.6, 20000))[-len(n[i:i + bloco]):]
    return out * env * 0.45


def riser(d=2.5):
    t = tempo(d)
    n = rng.standard_normal(len(t))
    out = np.zeros_like(n)
    for i in range(0, len(n), 2048):
        p = i / len(n)
        fc = 200 + 7000 * p ** 2
        seg = n[max(0, i - 2048):i + 2048]
        out[i:i + 2048] = bp(seg, fc * 0.7, min(fc * 1.4, 20000))[-len(n[i:i + 2048]):]
    tom = np.sin(2 * np.pi * np.cumsum(110 * 2 ** (2 * t / d)) / SR) * 0.25
    env = (t / d) ** 2.2
    return (out * 0.5 + tom) * env * 0.5


def glitch_sfx(d=0.35):
    t = tempo(d)
    s = np.sign(np.sin(2 * np.pi * 70 * t * (1 + 3 * (t > d / 2))))
    s *= (rng.random(len(t)) > 0.3)
    s = np.round(s * 4) / 4 + rng.standard_normal(len(t)) * 0.3
    s *= np.repeat(rng.random(len(t) // 600 + 1) > 0.35, 600)[:len(t)]
    return hp(s, 400) * 0.18


def brilho_sfx(d=2.0):
    t = tempo(d)
    s = sum(np.sin(2 * np.pi * f * t + rng.uniform(0, 6)) for f in (2093, 2637, 3136, 4186))
    return s * np.exp(-t * 2.2) * np.minimum(1, t / 0.01) * 0.05


def tique(d=0.08):
    t = tempo(d)
    return hp(rng.standard_normal(len(t)), 3000) * np.exp(-t * 120) * 0.25


def batida_coracao(d=0.9):
    t = tempo(d)
    a = np.sin(2 * np.pi * 48 * t) * np.exp(-t * 14)
    b = np.sin(2 * np.pi * 44 * (t - 0.22)) * np.exp(-(t - 0.22).clip(0) * 14) * (t > 0.22)
    return (a + 0.7 * b) * 0.7


# ---------------------------------------------------------------- composição
PROG = [  # Lá menor épico: Am - F - C - G
    ["A2", "E3", "A3", "C4", "E4"],
    ["F2", "C3", "F3", "A3", "C4"],
    ["C3", "G3", "C4", "E4", "G4"],
    ["G2", "D3", "G3", "B3", "D4"],
]


def compor(total, ev):
    m = np.zeros(int((total + 4) * SR))
    sfx = np.zeros_like(m)
    c = ev["cenas"]  # início de cada cena (s)
    bpm = ev["bpm"]
    beat = 60 / bpm
    compasso = 4 * beat

    # Drone grave atmosférico em todo o vídeo, mais forte nas cenas 1–2
    t = tempo(total + 4)
    drone = (np.sin(2 * np.pi * 55 * t) * 0.5 + np.sin(2 * np.pi * 82.4 * t + 1) * 0.25
             + lp(rng.standard_normal(len(t)), 180) * 0.6)
    lfo = 0.6 + 0.4 * np.sin(2 * np.pi * 0.07 * t)
    curva = np.interp(t, [0, 1.0, c[3], c[3] + 4, c[4], c[5], c[6], total - 1, total + 4],
                      [0, 1.0, 0.8, 0.35, 0.5, 0.6, 0.55, 0.3, 0])
    m += drone * lfo * curva * 0.22

    # Cena 2: tique-taque de relógio + coração (sensação de ciclo)
    x = c[2]
    while x < c[3] - 0.2:
        somar(sfx, x, tique(), 0.9)
        x += beat / 2
    x = c[2] + 0.2
    while x < c[3]:
        somar(m, x, batida_coracao(), 0.5)
        x += beat * 2

    # Cenas 3 e 6/7: progressão com piano, pad e percussão
    def bloco_musical(ini, fim, intensidade, perc=True, arpejo=True):
        x = ini
        i = 0
        while x < fim:
            acorde = PROG[i % 4]
            dur = min(compasso, fim - x) + 2.5
            m_pad = pad([nota(n) for n in acorde[:4]], dur, ataque=0.8, liberar=2.4,
                        brilho=1200 + 1800 * intensidade)
            somar(m, x, m_pad, 0.55 + 0.35 * intensidade)
            if arpejo:
                padrao = [4, 2, 3, 2, 4, 3, 2, 3]
                for k in range(8):
                    if x + k * beat / 2 < fim:
                        somar(m, x + k * beat / 2, piano(nota(acorde[padrao[k]]) * 2, 2.2, 0.6 + 0.3 * (k == 0)))
            somar(m, x, piano(nota(acorde[0]), 3.5, 0.9))
            if perc:
                for k in range(4):
                    if x + k * beat < fim:
                        somar(m, x + k * beat, tambor(f0=70 if k % 2 == 0 else 110), 0.45 * intensidade)
                if intensidade > 0.8:
                    for k in range(8):
                        if x + k * beat / 2 < fim:
                            somar(m, x + (k + 0.5) * beat / 2, tique(0.05), 0.6)
            x += compasso
            i += 1

    bloco_musical(c[3], c[4] - 0.5, 0.55)
    # Cena 4: silêncio solene — só pad suave e piano esparso
    somar(m, c[4], pad([nota("A2"), nota("E3"), nota("C4")], c[5] - c[4] + 2, ataque=3, liberar=3, brilho=900), 0.7)
    for k, n in enumerate(["E4", "C4", "A3", "E4", "D4", "C4"]):
        somar(m, c[4] + 1.5 + k * (c[5] - c[4] - 2) / 6, piano(nota(n), 4, 0.55))
    # Cena 5: piano emocional + cordas crescendo
    bloco_musical(c[5], c[6], 0.45, perc=False)
    # Cena 6–7: épico
    bloco_musical(c[6], ev["clímax"], 1.0)
    # clímax sustentado e decrescendo final
    somar(m, ev["clímax"], pad([nota(n) for n in ["A2", "E3", "A3", "C4", "E4"]], total - ev["clímax"] + 3,
                               ataque=0.3, liberar=4, brilho=2600), 1.1)
    somar(m, ev["clímax"], piano(nota("A2"), 5, 1.0))

    # SFX vindos dos eventos visuais
    for e in ev["sfx"]:
        tipo, x = e["tipo"], e["t"]
        if tipo == "impacto":
            somar(sfx, x, sub_impacto(gan=e.get("g", 1.0)))
        elif tipo == "whoosh":
            somar(sfx, x - 0.3, whoosh(0.6), e.get("g", 0.8))
        elif tipo == "riser":
            d = e.get("d", 2.0)
            somar(sfx, x - d, riser(d), 0.8)
        elif tipo == "glitch":
            somar(sfx, x, glitch_sfx(), 1.0)
        elif tipo == "brilho":
            somar(sfx, x, brilho_sfx(), 1.0)
        elif tipo == "tambor":
            somar(sfx, x, tambor(f0=60), 0.8)
    return reverb(m, 3.5, 0.3), reverb(sfx, 1.8, 0.15)


def tratar_voz():
    ent = os.path.join(BUILD, "voz_bruta.wav")
    sai = os.path.join(BUILD, "voz.wav")
    # voz mais grave e encorpada: pitch -1,5 st, graves, compressão e ambiência curta
    filtro = ("rubberband=pitch=0.917:formant=preserved,"
              "highpass=f=70,equalizer=f=140:t=q:w=1:g=4,equalizer=f=3200:t=q:w=1.2:g=2.5,"
              "equalizer=f=7000:t=q:w=1:g=-3,"
              "acompressor=threshold=-20dB:ratio=3.5:attack=8:release=120:makeup=4,"
              "aecho=0.8:0.5:45|90:0.18|0.10,alimiter=limit=0.9")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", ent, "-af", filtro, "-ar", str(SR), sai], check=True)
    v, _ = sf.read(sai)
    return v if v.ndim == 1 else v.mean(1)


def main():
    tl = json.load(open(os.path.join(BUILD, "timeline.json")))
    ev = construir_eventos(tl)
    total = tl["total"]
    voz = tratar_voz()
    musica, sfx = compor(total, ev)
    n = int(total * SR)
    voz = np.pad(voz, (0, max(0, n - len(voz))))[:n]
    musica, sfx = musica[:n], sfx[:n]
    # ducking: música abaixa ~9 dB sob a voz
    env = lp(np.abs(voz), 6, 1)
    env = env / (env.max() + 1e-9)
    duck = 1 - 0.65 * np.clip(env * 4, 0, 1)
    musica /= np.abs(musica).max() + 1e-9
    sfx /= np.abs(sfx).max() + 1e-9
    voz /= np.abs(voz).max() + 1e-9
    fade = np.minimum(1, (total - np.arange(n) / SR) / 3.5).clip(0, 1)
    mix = voz * 0.92 + musica * duck * 0.42 * fade + sfx * 0.5
    mix = np.tanh(mix * 1.1) / np.tanh(1.1)
    # estéreo leve: música/sfx com pequena decorrelação
    esq = mix + lp(musica * duck * 0.04, 3000)
    dir_ = mix - lp(musica * duck * 0.04, 3000)
    est = np.stack([esq, dir_], 1)
    est /= np.abs(est).max() / 0.95
    sf.write(os.path.join(BUILD, "mix_pre.wav"), est.astype(np.float32), SR)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", os.path.join(BUILD, "mix_pre.wav"),
                    "-af", "loudnorm=I=-14:TP=-1.0:LRA=11", "-ar", str(SR),
                    os.path.join(BUILD, "mix.wav")], check=True)
    print("mix ok", total)


if __name__ == "__main__":
    main()
