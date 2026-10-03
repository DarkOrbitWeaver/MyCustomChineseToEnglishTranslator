# LiveSubs

## 1. Backend (Windows)
```
winget install ffmpeg
cd server
python -m venv .venv
.venv\Scripts\activate
pip install torch --index-url https://download.pytorch.org/whl/cu124
pip install -r requirements.txt
```
In LM Studio: load a NON-thinking instruct model, start the local server (port 1234), then:
```
set LLM_MODEL=<model id shown in LM Studio>
python server.py
```
Tight on VRAM? `set ASR_MODEL=Qwen/Qwen3-ASR-0.6B` first.
First run downloads the ASR + aligner models. Old cache (>7 days) is deleted on every launch.

## 2. Extension
chrome://extensions -> Developer mode -> Load unpacked -> pick the `extension` folder.
Click the "L" icon -> Enable. Badge on the video shows status; click it to retry if backend is offline.

## Tuning
- `server/glossary/*.txt`: ~960 terms (realms, titles, techniques, items, system-novel phrases, names). One `中文 = English` per line; add your own file (e.g. `12_myseries.txt`), later filenames override earlier. Reloads automatically, no restart. Only entries that appear in a block go to the LLM (max 80, longest first).
- Old cached blocks keep their old translations. After editing the glossary, delete `server/cache/<videoId>/` to redo a video.
- `MAXC / MIN_DUR / CPS` at the top of server.py control line length and reading speed.
- Cache: `server/cache/<videoId>/<block>.json`, one file per 60 s block.
