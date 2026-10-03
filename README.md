# LiveSubs — live English subtitles for Chinese YouTube videos

I made this so I can watch Chinese cultivation / xianxia / system-novel
animation on YouTube with readable English subtitles, generated live on my
own PC. No paid APIs, everything runs locally.

## How it works (the 3 pieces)

1. **Backend (`server/`)** — downloads 60-second audio slices of the video,
   transcribes the Chinese (Qwen3-ASR), translates it to English with a local
   LLM, and serves Netflix-style subtitle cues on `http://127.0.0.1:8765`.
2. **Translator brain (LM Studio)** — any small non-thinking instruct model.
   It only translates text, it never touches audio.
3. **Chrome extension (`extension/`)** — shows the English subs inside the
   YouTube player, in YouTube's own caption layer. Yellow marks on the video
   bar show which minutes are already translated.

## What you need (hardware / software)

- **Windows 10/11 PC with an NVIDIA GPU.** The transcriber + translator share
  VRAM: ~3 GB for audio + ~2.5 GB for a 4B translator fits an **8 GB card**
  (tested on an RTX 3050). 6 GB cards: use the 0.6B audio model and a 3B
  translator. No NVIDIA GPU = this will not run.
- **Python 3.12 or 3.13** (windows installer, tick "Add to PATH").
- **ffmpeg**: `winget install Gyan.FFmpeg`
- **Node.js LTS** (needed by yt-dlp to read YouTube pages).
- **LM Studio** (free) + one small instruct model (see below).
- **Chrome** (or any Chromium browser).

## Setup — first time only

**1. Download this folder and double-click `setup.bat`.**
It creates `server/.venv` and installs everything (~4 GB, 10–20 min).
First backend start also downloads the audio models (~5 GB) — once, then
they're cached.

**2. LM Studio — load the translator.**
- Download a small **non-thinking instruct** model. Good picks:
  - `Qwen3-4B-Instruct-2507` Q4_K_M (~2.5 GB) — fits easily next to the audio models.
  - `Qwen2.5-7B-Instruct` Q4_K_M (~4.7 GB) — better English, tight on 8 GB.
  - Skip anything with "Thinking" or "R1" in the name.
- Settings: port **1234**, context **4096**, full GPU offload for the 4B,
  flash attention on, just-in-time loading off.
- Press **Start Server**. Check `http://127.0.0.1:1234/v1/models` in a
  browser — you should see your model id, e.g. `qwen3-4b-instruct-2507`.

**3. Start the backend — double-click `start.bat`.**
Wait for `LiveSubs ready on http://127.0.0.1:8765`. If you picked a different
model than the default, set it first:
`set LLM_MODEL=your-model-id-here` then run `start.bat` from that window.
(Tight on VRAM? `set ASR_MODEL=Qwen/Qwen3-ASR-0.6B` — that's already the default.)

**4. Load the extension.**
`chrome://extensions` → Developer mode → Load unpacked → pick the
`extension` folder. Pin the **L** icon. Open a Chinese video, click **L**,
tick **Enable**.

## Daily use

1. LM Studio → load model → Start Server.
2. Double-click `start.bat`, wait for `LiveSubs ready`.
3. YouTube → **L** → Enable. Subs appear after 1–3 min for the first minute;
   later minutes preload ahead (yellow marks on the video bar).
4. Style the subs in the **L** panel: size, background darkness, text edge.
5. If the backend was off, the video corner says
   `LiveSubs: offline — click to retry`. Click it.

## Tuning

- **Word list**: `server/glossary/*.txt`, one `中文 = English` per line
  (~960 cultivation terms included). Only terms that appear in a minute of
  audio get sent to the translator. Edit the files any time — they reload
  automatically, no restart needed.
- **Reading speed**: default is Netflix timing. If you watch at 2x, run
  `set CPS=10` before `start.bat` so lines stay up longer, and delete that
  video's folder in `server/cache/` so old timings rebuild.
- **Subtitle cache**: `server/cache/<videoId>/<block>.json`, one file per
  60 seconds. Older than 7 days gets cleaned on launch.

## If something breaks

- `offline — click to retry`: backend or LM Studio isn't running. Start both.
- First minute takes minutes: normal (audio download + first translation).
- `yt-dlp` / `ffmpeg` errors: update yt-dlp (`pip install -U yt-dlp`) and make
  sure ffmpeg + Node.js are installed.
- Out of VRAM / CUDA errors: smaller translator (3–4B), and
  `ASR_MODEL=Qwen/Qwen3-ASR-0.6B`.
- Weird English for a name/term: add it to the right `server/glossary/` file.

## Project layout

```
setup.bat / start.bat   one-time setup + daily launcher (Windows)
server/server.py        backend: audio → transcribe → translate → cues (:8765)
server/requirements.txt python deps (torch with CUDA first, see setup.bat)
server/glossary/        Chinese → English term lists (*.txt)
server/cache/           per-video translated blocks (auto-created, not in git)
extension/              Chrome extension (player overlay + L popup panel)
```

Made for late-night cultivation binges. 欢迎来到修仙世界.
