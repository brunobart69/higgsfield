"""Gera a narração (Piper TTS offline) e a linha do tempo de palavras.

Saída: build/voz.wav (48 kHz, mono) e build/timeline.json
"""
import json
import os
import re
import sys

import numpy as np
from piper import PiperVoice, SynthesisConfig
from scipy.signal import resample_poly

from roteiro import FALAS

SR = 48000
NASAIS = set("mnŋɲ")
BUILD = os.path.join(os.path.dirname(__file__), "build")


def fonemas(voz, texto):
    """Fonemiza e troca a vogal nasal (til combinante, ausente no modelo) por vogal + ŋ."""
    saida = []
    for frase in voz.phonemize(texto):
        res = []
        i = 0
        while i < len(frase):
            p = frase[i]
            if p == "̃":
                # fim do grupo nasal: se o próximo não for nasal/til, acrescenta ŋ
                prox = next((q for q in frase[i + 1:i + 3] if q != "̃"), " ")
                seguinte_til = i + 2 < len(frase) and frase[i + 2] == "̃"
                if prox not in NASAIS and not seguinte_til:
                    res.append("ŋ")
            else:
                res.append(p)
            i += 1
        saida.append(res)
    return saida


def sintetizar(voz, texto, cfg):
    partes = []
    for fr in fonemas(voz, texto):
        ids = voz.phonemes_to_ids(fr)
        partes.append(voz.phoneme_ids_to_audio(ids, cfg))
        partes.append(np.zeros(int(voz.config.sample_rate * 0.08), np.float32))
    audio = np.concatenate(partes).astype(np.float32)
    audio = resample_poly(audio, SR, voz.config.sample_rate).astype(np.float32)
    # corta silêncio nas pontas
    env = np.abs(audio) > 0.02 * np.abs(audio).max()
    idx = np.flatnonzero(env)
    audio = audio[max(idx[0] - 800, 0): idx[-1] + 2400]
    return audio


# referências exibidas como número, mas narradas por extenso (sílabas faladas)
PESO_ESPECIAL = {"5:37,": 13, "12:2,": 10}


def pesos_palavras(palavras):
    """Peso aproximado de duração por palavra (grupos vocálicos ~ sílabas)."""
    pesos = []
    for w in palavras:
        sil = PESO_ESPECIAL.get(w) or max(1, len(re.findall(r"[aeiouáéíóúâêôãõà]+", w.lower())))
        pesos.append(sil + 0.6)
    return np.array(pesos, float)


def ilhas_de_fala(audio, min_pausa=0.11):
    """Trechos com voz separados por pausas (vírgulas/pontos geram pausas reais)."""
    jan = int(0.01 * SR)
    n = len(audio) // jan
    rms = np.sqrt((audio[:n * jan].reshape(n, jan) ** 2).mean(1))
    voz = rms > 0.06 * rms.max()
    ilhas, ini, sil = [], None, 0
    for i, v in enumerate(voz):
        if v:
            if ini is None:
                ini = i
            sil = 0
        elif ini is not None:
            sil += 1
            if sil * 0.01 >= min_pausa:
                ilhas.append((ini * 0.01, (i - sil + 1) * 0.01))
                ini, sil = None, 0
    if ini is not None:
        ilhas.append((ini * 0.01, (n - sil) * 0.01))
    return ilhas


def tempos_palavras(audio, palavras):
    """Distribui as palavras nas ilhas de fala quando batem com a pontuação."""
    grupos, atual = [], []
    for w in palavras:
        atual.append(w)
        if re.search(r"[,.?!]$", w) and not w.endswith(":"):
            grupos.append(atual)
            atual = []
    if atual:
        grupos.append(atual)
    ilhas = ilhas_de_fala(audio)
    if len(ilhas) != len(grupos):
        # junta ilhas mais próximas até casar com o número de grupos
        while len(ilhas) > len(grupos):
            gaps = [ilhas[i + 1][0] - ilhas[i][1] for i in range(len(ilhas) - 1)]
            k = int(np.argmin(gaps))
            ilhas[k:k + 2] = [(ilhas[k][0], ilhas[k + 1][1])]
        if len(ilhas) < len(grupos):
            ilhas = [(ilhas[0][0], ilhas[-1][1])]
            grupos = [palavras]
    res = []
    for (a, b), g in zip(ilhas, grupos):
        p = pesos_palavras(g)
        cs = np.concatenate([[0], np.cumsum(p)]) / p.sum() * (b - a) + a
        res += [(w, cs[i], cs[i + 1]) for i, w in enumerate(g)]
    return res


def main(modelo):
    os.makedirs(BUILD, exist_ok=True)
    voz = PiperVoice.load(modelo)
    cfg = SynthesisConfig(length_scale=0.9, noise_scale=0.55, noise_w_scale=0.7)
    t = 0.0
    trilha = []
    timeline = []
    for n, fala in enumerate(FALAS):
        t += fala.get("pre", 0.0)
        audio = sintetizar(voz, fala["texto"], cfg)
        dur = len(audio) / SR
        legenda = fala.get("legenda", fala["texto"])
        palavras = legenda.split()
        timeline.append(dict(
            id=n, cena=fala["cena"], inicio=t, fim=t + dur, texto=legenda,
            chave=fala.get("chave", []), palavra=fala.get("palavra"),
            final=fala.get("final", False),
            palavras=[dict(w=w, ini=t + a, fim=t + b) for w, a, b in tempos_palavras(audio, palavras)],
        ))
        trilha.append((t, audio))
        t += dur + fala["pausa"] * 0.75
    total = t + 5.5  # fecho: fade para preto + assinatura
    voz_mix = np.zeros(int(total * SR) + SR, np.float32)
    for ini, a in trilha:
        i = int(ini * SR)
        voz_mix[i:i + len(a)] += a
    voz_mix /= np.abs(voz_mix).max() + 1e-9
    import soundfile as sf
    sf.write(os.path.join(BUILD, "voz_bruta.wav"), voz_mix, SR)
    with open(os.path.join(BUILD, "timeline.json"), "w") as f:
        json.dump(dict(total=total, falas=timeline), f, ensure_ascii=False, indent=1)
    print(f"duração total: {total:.1f}s")
    for fl in timeline:
        print(f"{fl['inicio']:6.2f}-{fl['fim']:6.2f} c{fl['cena']} {fl['texto'][:60]}")


if __name__ == "__main__":
    main(sys.argv[1])
