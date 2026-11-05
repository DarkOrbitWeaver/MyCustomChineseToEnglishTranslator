# LiveSubs — Live English Subtitles for Chinese YouTube Videos

LiveSubs transcribes and translates Chinese cultivation / xianxia / system-novel videos on YouTube in real time with Netflix-style cues, powered by local ASR and LLM translation (via NVIDIA NIM API or local LM Studio).

---

## ⚡ What's New: NVIDIA Nemotron API Integration

You can now translate subtitles using NVIDIA's cloud models (such as `nvidia/nemotron-3.5-bolt-e4b` or `nvidia/nemotron-3.5-lightning-30b-a3b`):
- **Zero VRAM Contention:** Your local GPU (e.g. RTX 3050 8 GB) is 100% dedicated to ASR speech transcription.
- **Ultra-Fast & Accurate:** Nemotron 3.5 Bolt (effective 4B active) and Nemotron 3.5 Lightning (30B MoE with 3B active) offer punchy fansub translations and handle complex cultivation lore with ease.
- **Automatic Throttling & Backoff:** Built-in sliding-window rate limiter respects NVIDIA's 40 RPM free tier cap, with exponential backoff on HTTP 429.
- **Local Fallback:** You can still use local LM Studio anytime without changing code.

---

## How It Works (The 3 Pieces)

1. **Backend (`server/`)**:
   - Downloads video audio once via `yt-dlp` into `server/cache/<videoId>/`.
   - Slices audio into 60-second blocks using `ffmpeg`.
   - Transcribes speech and generates word-level timestamps using `Qwen3-ASR` + `ForcedAligner`.
   - Translates lines to English via NVIDIA Nemotron API or local LM Studio.
   - Shapes subtitle lines into natural 1-line clauses and serves cues on `http://127.0.0.1:8765`.
2. **Translation Engine**:
   - **NVIDIA NIM API (Recommended):** `nvidia/nemotron-3.5-bolt-e4b` or `nvidia/nemotron-3.5-lightning-30b-a3b`.
   - **LM Studio (Local Fallback):** Any local instruct model (e.g. `qwen3-4b-instruct-2507`).
3. **Chrome Extension (`extension/`)**:
   - In-player panel on YouTube with subtitle controls, styling presets, export to `.srt`, and visual timeline indicators.

---

## Hardware & System Requirements

- **GPU:** NVIDIA GPU with 6+ GB VRAM (RTX 3050 tested and recommended).
- **Python:** Python 3.12 or 3.13 (with PATH enabled).
- **ffmpeg:** `winget install Gyan.FFmpeg`
- **Node.js LTS:** Required by yt-dlp to extract YouTube streams.
- **Browser:** Chrome, Brave, Edge, or any Chromium browser.

---

## Setup (First Time Only)

### 1. Install Dependencies & Pre-Download Models
Double-click `setup.bat`. This will:
- Create `server/.venv`
- Install PyTorch with CUDA 12.4
- Install Python requirements (`fastapi`, `uvicorn`, `requests`, `yt-dlp`, `qwen-asr`, `huggingface_hub`)
- Automatically pre-download the ASR speech models (`Qwen/Qwen3-ASR-0.6B` and `Qwen/Qwen3-ForcedAligner-0.6B`)

### 2. Configure Translation (NVIDIA API or Local LM Studio)

LiveSubs creates a local, git-ignored configuration file at `server/config.json`:

```json
{
  "provider": "nvidia",
  "nvidia_api_key": "nvapi-YOUR-KEY-HERE",
  "nvidia_model": "nvidia/nemotron-3.5-bolt-e4b",
  "enable_thinking": false,
  "rate_limit_rpm": 30,
  "local_llm_url": "http://127.0.0.1:1234/v1/chat/completions",
  "local_model": "qwen3-4b-instruct-2507",
  "asr_model": "Qwen/Qwen3-ASR-0.6B",
  "align_model": "Qwen/Qwen3-ForcedAligner-0.6B",
  "cps": 17.0,
  "block_cooldown": 5.0,
  "batch_size": 12
}
```

- **To use NVIDIA API:** Paste your NVIDIA API key into `"nvidia_api_key"`. (Alternatively, leave it blank and `start.bat` will prompt you on launch and save it locally for you!)
- **To switch to Local LM Studio:** Set `"provider": "local"` in `server/config.json` and start your LM Studio local server on port 1234.

### 3. Start the Backend
Double-click `start.bat`.
Wait for `LiveSubs ready on http://127.0.0.1:8765`.

### 4. Load the Chrome Extension
1. Open `chrome://extensions`.
2. Toggle on **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension/` folder in this repo.
4. Pin the LiveSubs icon (amber 字→A bubble).
5. Open any Chinese video on YouTube, click the LiveSubs icon or the in-player button, and check **Enable**.

---

## Tuning & Customization

- **Cultivation Glossary:** `server/glossary/*.txt` contains ~960 xianxia/cultivation terms. Format: `中文 = English`. Edits reload automatically without restarting the server.
- **Reading Speed:** Default `CPS` (characters per second) is 17. If you watch at 2x speed, set `cps: 10` in `config.json` so lines stay up longer.
- **Subtitle Cache:** Subtitles and full audio are cached in `server/cache/<videoId>/`. Cached blocks reload instantly on re-watch.
- **Exporting Subtitles:** Click **Export .SRT** inside the YouTube player panel to download the complete English subtitles.

---

## Project Structure

```
start.bat                  Daily launcher (Windows)
setup.bat                  One-time setup script
server/server.py           Main backend server (FastAPI, ASR, LLM, Cue shaping)
server/download_models.py  Standalone script to pre-cache ASR models
server/config.example.json Template config file
server/config.json         Your local config (git-ignored, holds your API key)
server/glossary/           Domain glossaries (cultivation terms, realms, techniques)
server/cache/              Local audio and subtitle cache (auto-created)
extension/                 Chrome extension (V3 manifest, content script, player panel)
```
