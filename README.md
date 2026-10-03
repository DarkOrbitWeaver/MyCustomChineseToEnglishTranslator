# LiveSubs — live English subtitles for Chinese YouTube videos

I made this so I can watch Chinese cultivation / xianxia / system-novel
animation on YouTube with readable English subtitles, generated live on my
own PC. No paid APIs, everything runs locally.

## How it works (the 3 pieces)

1. **Backend (`server/`)** — downloads the full audio track once per video
   (background, ~1 min), then slices it locally per 60-second block. Each
   block is transcribed (Qwen3-ASR), translated to English with a local LLM,
   and served as Netflix-style subtitle cues on `http://127.0.0.1:8765`.
2. **Translator brain (LM Studio)** — any small non-thinking instruct model.
   It only translates text, it never touches audio.
3. **Chrome extension (`extension/`)** — in-player dark panel with subtitle
   controls, download progress bar, and style presets. Yellow marks on the
   seek bar show which minutes are already translated.

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
  - `Qwen3-4B-Instruct-2507` Q4_K_M (~2.5 GB) — fits easily next to the audio models. (recommended!!)
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
`extension` folder. Pin the LiveSubs icon (amber 字→A bubble). Open a
Chinese video, click the LiveSubs button in the player bar or the toolbar
icon, and tick **Enable**.

## Daily use

1. LM Studio → load model → Start Server.
2. Double-click `start.bat`, wait for `LiveSubs ready`.
3. YouTube → click the LiveSubs button in the player bar → Enable.
4. The audio downloads in the background (progress bar in the panel, ~1–2 min
   for a 2-hour video). Once done, blocks start processing (~30s each).
5. Yellow marks on the seek bar show translated minutes. Subs appear
   automatically as you watch.
6. Style the subs in the panel: size, color, background, text edge, presets.

## Tuning

- **Word list**: `server/glossary/*.txt`, one `中文 = English` per line
  (~960 cultivation terms included). Only terms that appear in a block of
  audio get sent to the translator. Edit the files any time — they reload
  automatically, no restart needed.
- **Reading speed**: default is Netflix timing. If you watch at 2x, run
  `set CPS=10` before `start.bat` so lines stay up longer, and delete that
  video's folder in `server/cache/` so old timings rebuild.
- **Subtitle cache**: `server/cache/<videoId>/` — `full.webm` (downloaded
  audio) + `<block>.json` (translated cues). Kept for 30 days, cleaned on
  launch. Re-opening a video you watched last week = instant subs.

## If something breaks

- `offline — click to retry`: backend or LM Studio isn't running. Start both.
- First block takes ~30s after audio download: normal (ASR + translation).
- `yt-dlp` / `ffmpeg` errors: update yt-dlp (`pip install -U yt-dlp`) and make
  sure ffmpeg + Node.js are installed.
- Out of VRAM / CUDA errors: smaller translator (3–4B), and
  `ASR_MODEL=Qwen/Qwen3-ASR-0.6B`.
- Weird English for a name/term: add it to the right `server/glossary/` file.
- LM Studio context too high: set to **4096** (not higher — wastes VRAM).

## Project layout

```
setup.bat / start.bat   one-time setup + daily launcher (Windows)
server/server.py        backend: audio → transcribe → translate → cues (:8765)
server/requirements.txt python deps (torch with CUDA first, see setup.bat)
server/glossary/        Chinese → English term lists (*.txt)
server/cache/           per-video audio + translated blocks (auto-created)
extension/              Chrome extension (in-player panel + popup)
extension/icons/        Extension icon set (SVG source + PNGs)
```

Made for late-night cultivation binges. 欢迎来到修仙世界.
