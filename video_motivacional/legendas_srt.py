"""Exporta as legendas sincronizadas (mesmos blocos do vídeo) em SRT."""
import json
import os

AQUI = os.path.dirname(os.path.abspath(__file__))


def ts(s):
    ms = int(round(s * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def main():
    tl = json.load(open(os.path.join(AQUI, "build", "timeline.json")))
    os.makedirs(os.path.join(AQUI, "saida"), exist_ok=True)
    with open(os.path.join(AQUI, "saida", "legendas.srt"), "w", encoding="utf-8") as f:
        n = 1
        for fl in tl["falas"]:
            ws = fl["palavras"]
            for i in range(0, len(ws), 4):
                bloco = ws[i:i + 4]
                fim = ws[i + 4]["ini"] if i + 4 < len(ws) else fl["fim"]
                f.write(f"{n}\n{ts(bloco[0]['ini'])} --> {ts(fim)}\n{' '.join(w['w'] for w in bloco).upper()}\n\n")
                n += 1


if __name__ == "__main__":
    main()
