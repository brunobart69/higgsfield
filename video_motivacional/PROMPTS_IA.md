# Planos para a versão com imagens realistas (geradores de vídeo por IA)

O vídeo em `saida/` é renderizado proceduralmente (silhuetas, luz, partículas),
porque este ambiente não tem acesso a geradores de imagem e vídeo por IA nem a bancos
de imagem. Para a versão **fotorrealista**, gere cada plano abaixo (Higgsfield, Kling,
Veo, Runway, Sora…) em **9:16, 1080×1920 ou mais** e substitua os planos pela mesma
linha do tempo. Os tempos de corte vêm de `build/timeline.json` e de `eventos.py`.

**Sufixo de estilo para TODOS os prompts:**
`cinematic, photorealistic, dramatic low-key lighting, high contrast, dark tones with warm gold highlights, anamorphic lens, shallow depth of field, subtle film grain, volumetric light, 35mm, vertical 9:16, no text, no watermark, natural anatomy, consistent face`

Use **o mesmo personagem** em todos os planos (homem de 30–35 anos, barba curta, casaco escuro);
nas ferramentas com "character reference", gere primeiro um retrato de referência.

| # | Tempo (s) | Plano | Prompt (inglês) | Câmera / efeito na edição |
|---|---|---|---|---|
| 1 | 0,5–5,9 | Rua à noite | A lone man walking slowly down an empty wet city street at night, blurred urban lights and dark buildings behind him, light drizzle, reflective asphalt, contemplative and restless mood | Push-in lento até o rosto; congelar + glitch em "MENTE VELHA" (≈4,1 s) |
| 2 | 5,9–8,0 | Abismo | A man standing at the edge of a vast dark chasm, an intense golden light rising on the far horizon, floating golden particles, epic scale | Whip pan de entrada; expansão de luz + impacto em "SALTO QUÂNTICO" |
| 3 | 8,0–24,4 | Rotina (cortes de 0,6–1,2 s, repetir) | (a) Close-up of an old alarm clock ringing on a nightstand in a dark bluish bedroom · (b) Man in bed at night scrolling his phone, face lit only by blue screen light · (c) Messy cluttered bedroom, scattered clothes and papers, dim sickly light · (d) Busy street, crowd rushing past in motion blur, one man standing still in the middle, head down | Cortes secos nas palavras, zooms rápidos, telas pretas de 1–2 quadros |
| 4 | 24,4–25,5 | Congelamento | (reaproveitar d) | Congelar em "O MESMO ROTEIRO", distorção, rasgo revelando o plano 5 |
| 5 | 25,5–27,7 | Amanhecer revelado | Layered mountain ridges at sunrise, mist in the valleys, golden sun rays | Pan vertical; riser + whoosh |
| 6 | 27,7–29,1 | Cortinas | Man opening heavy curtains at dawn, golden sunlight flooding a dark room, dust in the air, silhouette | Flash de entrada; luz progressiva |
| 7 | 29,1–30,7 | Hábitos | Man reading a Bible at a wooden desk by a window at early morning, warm lamp light | Texto cinético "HÁBITOS" |
| 8 | 30,7–32,9 | Ambientes | Man walking alone on an empty country road at sunrise, long shadow, wide shot from behind | Whip pan; "AMBIENTES" |
| 9 | 32,9–35,5 | Influências | Man walking out of a dark room with purple and red party lights through a doorway into bright daylight, silhouette | Flash; "INFLUÊNCIAS" |
| 10 | 35,5–43,0 | Escolhas | A group of people standing in shadow on the left while one man walks away to the right into golden light | Paralaxe; "ESCOLHAS" |
| 11 | 43,0–56,4 | Bíblia | An open Bible on an old wooden table, a single beam of sunlight from a window, dust floating, deep shadows, slow push-in on the pages | Música baixa; "LUCAS 5:37" |
| 12 | 56,4–63,5 | Odres (simbólico) | Symbolic: red wine poured into an old cracked leather wineskin, wine leaking through the cracks; then the same wine poured into a new supple leather wineskin glowing warmly | Dissolve; "VINHO NOVO NÃO COMBINA COM ODRES VELHOS." |
| 13 | 63,5–77,7 | Espelho | Man in a dark bathroom in front of a mirror, head down; as he slowly raises his head, warm light fills the room | Luz expande em "RENOVAÇÃO" (≈73,5 s) |
| 14 | 77,7–83,8 | Reflexão | Man studying and writing notes at a desk by a sunlit window, calm and focused | Dissolve |
| 15 | 83,8–87,0 | Montanhas | Majestic mountain range at sunrise, layers of mist, golden light | Speed ramp (rápido → câmera lenta) |
| 16 | 87,0–91,8 | Estrada | Empty straight road to the horizon at sunrise, low camera | Whip pan, avanço |
| 17 | 91,8–96,7 | Rumo à luz | Man walking toward a blinding golden light through mist, god rays | Glitch de entrada |
| 18 | 96,7–103,5 | Desafio | Man climbing a steep rock face at sunrise, hand reaching the top edge | Whip pan, sobe |
| 19 | 103,5–106,9 | Sol nascente | Sun rising above a sea of clouds, intense golden rays | Flash |
| 20 | 106,9–fim | Cume | Man reaching the summit of a mountain at sunrise, arms raised, camera slowly pulling back to reveal a monumental landscape, sun rays through clouds | Afastamento longo; frase final; fade para preto |

## Narração profissional
A voz do arquivo atual é uma voz neural offline (Piper, "edresson"), única voz pt-BR
masculina acessível neste ambiente, e soa sintética. Para a versão final, regrave
o texto de `roteiro.py` com voz grave masculina (locutor humano ou ElevenLabs/Azure
"pt-BR-AntonioNeural") e rode de novo o pipeline: os tempos das legendas e dos cortes
são recalculados a partir do novo áudio.

## Duração
O roteiro completo, numa leitura grave e pausada, tem cerca de **2 min 10 s** (YouTube
Shorts aceita até 3 min; Reels e TikTok também). Para chegar perto de **90 s**, os cortes
que menos afetam a mensagem são:
- Cena 2: a frase "Cercado pelas mesmas influências…" (≈8 s)
- Cena 4: "Isso não é apenas uma ideia de desenvolvimento pessoal." (≈4 s)
- Cena 6: as frases 2 e 4 (≈12 s)
- Cena 7: "Mude seus hábitos. Reavalie suas escolhas. Transforme suas atitudes." (≈5 s)
- Ler as referências como "Lucas 5:37" e "Romanos 12:2", sem "capítulo/versículo" (≈5 s)

## Textos bíblicos
- **Romanos 12:2 (NVI):** "Não se amoldem ao padrão deste mundo, mas transformem-se pela
  renovação da sua mente…" (a narração inclui o "sua" do texto da NVI).
- **Lucas 5:37:** a narração parafraseia o ensino. Na tela aparece o trecho da ARC,
  "E ninguém deita vinho novo em odres velhos…". A frase "VINHO NOVO NÃO COMBINA COM
  ODRES VELHOS" aparece como destaque e não como citação literal.
- As frases da Cena 6 são reflexões autorais e não aparecem atribuídas à Bíblia.
