# Vídeo motivacional cristão: "Uma nova vida exige uma nova mentalidade"

Vídeo vertical 9:16 (1080×1920, 30 fps) para Shorts, Reels e TikTok, gerado
inteiramente por código: narração, trilha, efeitos, legendas cinéticas e títulos.

**Saída:** `saida/video_motivacional_cristao.mp4` e `saida/legendas.srt`

## Pipeline
| Arquivo | Função |
|---|---|
| `roteiro.py` | Texto da narração por cena, palavras-chave (em dourado) e pausas |
| `narracao.py` | Voz TTS offline (Piper) e tempos de cada palavra, com alinhamento pelas pausas reais da fala |
| `eventos.py` | Linha do tempo de edição (planos, flashes, glitches, whip pans, títulos, SFX) derivada dos tempos da voz |
| `trilha.py` | Trilha sintetizada (drones, piano, cordas, percussão épica), SFX (impactos, risers, whooshes, glitch) e ducking sob a voz, com loudness em −14 LUFS |
| `visuais.py` | Planos pintados proceduralmente em camadas 2.5D com paralaxe |
| `render.py` | Composição: raios volumétricos, bloom, lens flare, partículas, gradação, grão, glitch, shake, zoom punch, whip pan, rasgo, speed ramp, congelamento, legendas palavra a palavra, letras explodindo e letras formadas por partículas |
| `legendas_srt.py` | Exporta as legendas em SRT |
| `PROMPTS_IA.md` | Prompts por plano para a versão fotorrealista, notas de duração e textos bíblicos |

## Como gerar
```bash
pip install piper-tts scipy soundfile numpy pillow
curl -LO https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-pt-br-edresson-low.tar.gz
tar xzf voice-pt-br-edresson-low.tar.gz
python3 narracao.py pt-br-edresson-low.onnx   # voz + timeline
python3 trilha.py                              # música + SFX + mix
python3 render.py                              # vídeo final (paralelo)
python3 legendas_srt.py
# conferência rápida de quadros: python3 render.py --quadros 4.2 25.8 126.5
```
Fontes (OFL, em `fontes/`): Anton, Montserrat, Cinzel e Playfair Display.
