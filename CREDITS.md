# Credits

## Sound effects — Pixabay
Used under the [Pixabay Content License](https://pixabay.com/service/license-summary/). Trimmed, faded and normalized for the game (`tools/audio_build.py`).

| file | title | author | page |
|---|---|---|---|
| knock | Wooden Door Knock | freesound_community | https://pixabay.com/sound-effects/household-wooden-door-knock-102902/ |
| bang | Wood Door Slam | freesound_community | https://pixabay.com/sound-effects/household-wood-door-slam-46791/ |
| creak | Door Creak 02 | freesound_community | https://pixabay.com/sound-effects/household-door-creak-02-79920/ |
| drawer | Desk Slide Drawer Open and Close | freesound_community | https://pixabay.com/sound-effects/film-special-effects-desk-slide-drawer-open-and-close-100535/ |
| unlock | Key Twist in lock | freesound_community | https://pixabay.com/sound-effects/household-key-twist-in-lock-47832/ |
| pop | Exploding Light Bulb | Alex_Jauk | https://pixabay.com/sound-effects/film-special-effects-exploding-light-bulb-199063/ |
| buzz | Room with Buzz Incandescent light bulb | freesound_community | https://pixabay.com/sound-effects/household-room-with-buzz-incandescent-light-bulb-23892/ |
| static | TV glitch | freesound_community | https://pixabay.com/sound-effects/technology-tv-glitch-6245/ |
| tvloop | CRT TV - Low Buzzing - Static | ArtificiallyInspired | https://pixabay.com/sound-effects/film-special-effects-crt-tv-low-buzzing-static-577992/ |
| steps | Footsteps with floor creak | freesound_community | https://pixabay.com/sound-effects/household-footsteps-with-floor-creak-81239/ |
| chime | Old Clock Chimes | freesound_community | https://pixabay.com/sound-effects/household-old-clock-chimes-74624/ |
| giggle | creepy distant laughter | freesound_community | https://pixabay.com/sound-effects/horror-creepy-distant-laughter-104680/ |
| giggle2 | LittleEvilLaugh | freesound_community | https://pixabay.com/sound-effects/film-special-effects-littleevillaugh-102851/ |
| whisper | Creepy Female Ghost Whispers | FadingEmbersAudio | https://pixabay.com/sound-effects/horror-creepy-female-ghost-whispers-430175/ |
| whisper2 | Ghost Whisper | DRAGON-STUDIO | https://pixabay.com/sound-effects/horror-ghost-whisper-351569/ |
| scare | Scream (with echo) | freesound_community | https://pixabay.com/sound-effects/horror-scream-with-echo-46585/ |
| scare2 | Scary Scream | DRAGON-STUDIO | https://pixabay.com/sound-effects/film-special-effects-scary-scream-401725/ |
| curtain | Curtain opening | freesound_community | https://pixabay.com/sound-effects/household-curtain-opening-46261/ |

## Music
`music_room`, `music_chase`, `song` (the children's song on TV channel 3) — generated with **MiniMax Music 3** (ComfyUI). Captions, seeds and workflows in `audio-source/music/`. Loop crossfades placed inside the files.

## Voices
Generated with **ElevenLabs Eleven v3**. The girl: Voice Library kid character voice "Piku"; the mother: "Park Hyun-mi"; the news anchor: "JasonK" (Korean Voice Library voices). Script in `assets/voice/lines.json`.

## Images
Textures, key art, documents and the jump-scare face: AI image generation. 3D models: Blender scripts in `blender/`.

## Ghost models
The ghost girl (standing and crawling) was reconstructed from AI-generated concept images with **Tencent Hunyuan3D 2.1** (run in ComfyUI; Tencent Hunyuan 3D 2.1 Community License), then cleaned, decimated, UV-projected and AO-baked in Blender (`blender/ghost_hy.py`). The concept images are also used as the textures. Look-and-feel references (not downloaded or reused): J-horror ghost designs such as Sadako (*Ring*) and Kayako (*Ju-on*).

## Game design references
*Observation Duty* (anomaly spotting), *Exit 8* (noticing what changed in a familiar space) — referenced for the loop only; no assets used.
