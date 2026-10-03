"""LiveSubs backend: full-audio download -> local ffmpeg slice -> Qwen3-ASR + ForcedAligner -> local LLM translate -> Netflix-style cues.
Run: python server.py   (listens on 127.0.0.1:8765)
"""
import os, re, json, sys, time, wave, shutil, threading, tempfile, subprocess, textwrap, traceback
from pathlib import Path
import requests, uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

ROOT = Path(__file__).resolve().parent   # absolute: independent of working directory
CACHE = ROOT / "cache"; CACHE.mkdir(exist_ok=True)
GLOSSARY_DIR = ROOT / "glossary"   # drop any *.txt in here: "中文 = English" per line
DEVLOG = ROOT / "dev.log"           # local-only debug log (git-ignored, never pushed)

def dlog(msg):
    """timestamped line to both the console window and dev.log (rotated past 5 MB)"""
    line = time.strftime("%H:%M:%S") + " " + msg
    print(line, flush=True)
    try:
        if DEVLOG.exists() and DEVLOG.stat().st_size > 5_000_000:
            DEVLOG.replace(ROOT / "dev.old.log")
        with DEVLOG.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass

BLOCK = 60          # seconds per cached block (fixed grid -> cache reuse)
PAD = 3             # seconds of extra audio each side so edge sentences aren't cut
KEEP_DAYS = 7
PORT = 8765
LLM_URL = os.getenv("LLM_URL", "http://127.0.0.1:1234/v1/chat/completions")   # LM Studio default
LLM_MODEL = os.getenv("LLM_MODEL", "local-model")
ASR_ID = os.getenv("ASR_MODEL", "Qwen/Qwen3-ASR-1.7B")   # set to Qwen/Qwen3-ASR-0.6B if VRAM is tight
ALIGN_ID = "Qwen/Qwen3-ForcedAligner-0.6B"

# subtitle style (Netflix-ish)
MAXC, MIN_DUR, GAP = 42, 1.0, 0.05
CPS = float(os.getenv("CPS", "17"))

ASR = None
PUNCT = set("，。！？；：、,.!?;:…—-\"'""''（）() \n")
SENT = re.compile(r"[^。！？!?；;…]+[。！？!?；;…]*")

# ============================================================================
#  FULL-AUDIO DOWNLOAD MANAGER
#  Downloads the complete audio track once per video, then all blocks are
#  sliced locally with ffmpeg (sub-second, zero network).
# ============================================================================

class AudioNotReady(Exception):
    """Raised when block processing should wait for the full audio download."""
    pass

_downloads = {}        # vid -> {"status", "progress", "path", "error"}
_dl_lock = threading.Lock()

AUDIO_EXTS = ("webm", "m4a", "opus", "ogg", "mp4", "mp3", "wav")

def _find_full_audio(vid):
    """Return path to a completed full audio file, or None."""
    vdir = CACHE / vid
    if not vdir.is_dir():
        return None
    for ext in AUDIO_EXTS:
        p = vdir / f"full.{ext}"
        # .part file means download is still in progress
        if p.exists() and not p.with_suffix(f".{ext}.part").exists() and not (vdir / f"full.{ext}.part").exists():
            return p
    return None

def _download_audio(vid):
    """Background thread: download the complete audio track for a video."""
    vdir = CACHE / vid; vdir.mkdir(exist_ok=True)
    dlog(f"[DL] starting full audio download for {vid}")
    t0 = time.time()
    cmd = [sys.executable, "-m", "yt_dlp",
           "--no-playlist", "--newline",
           "-f", "ba[abr<=64]/ba/b",
           "-o", str(vdir / "full.%(ext)s"),
           f"https://www.youtube.com/watch?v={vid}"]
    try:
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             stdin=subprocess.DEVNULL, text=True)
        for line in p.stdout:
            line = line.strip()
            if not line:
                continue
            # Parse progress: "[download]  45.2% of ~163.40MiB at  1.50MiB/s ETA 01:30"
            m = re.search(r"(\d+\.?\d*)%", line)
            if m:
                pct = float(m.group(1))
                with _dl_lock:
                    _downloads[vid]["progress"] = pct
                if int(pct) % 10 == 0:   # log every ~10%
                    dlog(f"[DL] {vid}: {pct:.1f}%")
            elif "[download]" in line.lower() or "[error]" in line.lower() or "error" in line.lower():
                dlog(f"[DL] {vid}: {line[:200]}")
        p.wait()
        if p.returncode != 0:
            raise RuntimeError(f"yt-dlp exited with code {p.returncode}")
        full = _find_full_audio(vid)
        if not full:
            raise RuntimeError("yt-dlp produced no audio file")
        elapsed = time.time() - t0
        size_mb = full.stat().st_size / 1e6
        with _dl_lock:
            _downloads[vid]["status"] = "ready"
            _downloads[vid]["path"] = full
            _downloads[vid]["progress"] = 100.0
        dlog(f"[DL] {vid}: download complete -> {full.name} ({size_mb:.1f} MB) in {elapsed:.0f}s")
    except Exception as ex:
        dlog(f"[DL] {vid}: download FAILED: {ex}")
        with _dl_lock:
            _downloads[vid]["status"] = "error"
            _downloads[vid]["error"] = str(ex)
        try:
            with DEVLOG.open("a", encoding="utf-8") as f:
                f.write(traceback.format_exc() + "\n")
        except Exception:
            pass

def ensure_audio(vid):
    """Ensure the full audio for `vid` is being downloaded.
    Returns the Path if ready, or None if still downloading.
    Raises RuntimeError on download error (will be retried)."""
    # Fast path: file already on disk
    full = _find_full_audio(vid)
    if full:
        with _dl_lock:
            _downloads[vid] = {"status": "ready", "path": full, "progress": 100.0, "error": None}
        return full

    with _dl_lock:
        info = _downloads.get(vid)
        if info is None:
            # First request for this video — start download
            _downloads[vid] = {"status": "downloading", "path": None, "progress": 0.0, "error": None}
            threading.Thread(target=_download_audio, args=(vid,), daemon=True, name=f"dl-{vid}").start()
            return None
        if info["status"] == "ready":
            return info.get("path")
        if info["status"] == "error":
            # Reset and retry the download
            dlog(f"[DL] {vid}: retrying after previous error: {info.get('error','?')}")
            _downloads[vid] = {"status": "downloading", "path": None, "progress": 0.0, "error": None}
            threading.Thread(target=_download_audio, args=(vid,), daemon=True, name=f"dl-{vid}").start()
            return None
        # status == "downloading" — still in progress
        return None

def download_progress(vid):
    """Return (status, progress_pct) for the audio download."""
    with _dl_lock:
        info = _downloads.get(vid)
        if info is None:
            return ("none", 0.0)
        return (info["status"], info.get("progress", 0.0))

# ---------------- cache housekeeping ----------------
def cleanup():
    cutoff = time.time() - KEEP_DAYS * 86400
    for d in CACHE.iterdir():
        if not d.is_dir():
            continue
        for f in d.iterdir():
            if f.is_file() and f.stat().st_mtime < cutoff:
                f.unlink()
        if not any(d.iterdir()):
            d.rmdir()

def cpath(vid, i):
    d = CACHE / vid; d.mkdir(exist_ok=True)
    return d / f"{i}.json"

# ---------------- audio (local slicing from full download) ----------------
def grab(vid, a, b, outdir: Path):
    """Slice a section from the locally-cached full audio file.
    Raises AudioNotReady if the download hasn't completed yet."""
    full = ensure_audio(vid)
    if full is None:
        raise AudioNotReady(vid)

    t0 = time.time()
    wav = outdir / "a.wav"
    cmd = ["ffmpeg", "-nostdin", "-y", "-loglevel", "error",
           "-ss", f"{a:.2f}", "-t", f"{b - a:.2f}",
           "-i", str(full),
           "-ar", "16000", "-ac", "1",
           str(wav)]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=60,
                       stdin=subprocess.DEVNULL)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg slice failed: {r.stderr[-500:]}")
    if not wav.exists() or wav.stat().st_size < 100:
        raise RuntimeError("ffmpeg produced no usable wav output")
    dlog(f"audio slice {a:.0f}-{b:.0f}s from local file in {time.time()-t0:.1f}s")
    return wav

# ---------------- ASR ----------------
def load_asr():
    import torch
    from qwen_asr import Qwen3ASRModel
    return Qwen3ASRModel.from_pretrained(
        ASR_ID, dtype=torch.bfloat16, device_map="cuda:0", max_new_tokens=1024,
        forced_aligner=ALIGN_ID,
        forced_aligner_kwargs=dict(dtype=torch.bfloat16, device_map="cuda:0"))

def clause_split(s, limit=36):
    """split very long unpunctuated runs at commas"""
    if len(s) <= limit:
        return [s]
    out, cur = [], ""
    for p in re.split(r"(?<=[，、,])", s):
        if cur and len(cur) + len(p) > limit:
            out.append(cur); cur = p
        else:
            cur += p
    if cur:
        out.append(cur)
    return out

def asr_sentences(wav: Path, offset: float):
    r = ASR.transcribe(audio=str(wav), language="Chinese", return_time_stamps=True)[0]
    text = (r.text or "").strip()
    items = [(getattr(t, "text", ""), getattr(t, "start_time", 0.0), getattr(t, "end_time", 0.0))
             for t in (getattr(r, "time_stamps", None) or [])]
    if not items and text:   # fallback: spread evenly (worse sync, but never empty)
        dlog("ASR gave no timestamps, spreading evenly (sync will be rough)")
        with wave.open(str(wav)) as w:
            dur = w.getnframes() / w.getframerate()
        chars = [c for c in text if c not in PUNCT]
        step = dur / max(1, len(chars))
        items = [(c, j * step, (j + 1) * step) for j, c in enumerate(chars)]
    sents = []
    for m in SENT.finditer(text):
        s = m.group().strip()
        if any(c not in PUNCT for c in s):
            sents += clause_split(s)
    out, k = [], 0
    for s in sents:
        n = sum(c not in PUNCT for c in s)
        got, st, en = 0, None, None
        while got < n and k < len(items):
            t, a, b = items[k]; k += 1
            if st is None:
                st = a
            en = b
            got += sum(c not in PUNCT for c in t)
        if st is not None:
            out.append((s, offset + st, offset + en))
    return out

# ---------------- translation ----------------
SYS = """You are a professional subtitle translator for Chinese xianxia / cultivation / system-novel animation.
Translate each Chinese line into natural, concise English subtitle lines.
- Output exactly one English string per input line, same order. Never merge or split lines.
- Sound like a good fansub: punchy, natural dialogue, no filler, resolve dropped pronouns from context.
- Use glossary terms EXACTLY whenever the Chinese appears.
- Names in pinyin (Su Mu). Keep titles consistent.
- Output ONLY a JSON array of strings, same length as the input. No commentary."""

LAST = {}

def llm(msgs):
    r = requests.post(LLM_URL, json={"model": LLM_MODEL, "messages": msgs,
                                     "temperature": 0.2, "max_tokens": 4096}, timeout=300)
    r.raise_for_status()
    t = r.json()["choices"][0]["message"]["content"]
    return re.sub(r"<think>.*?</think>", "", t, flags=re.S).strip()

def parse_arr(t, n):
    m = re.search(r"\[.*\]", t, re.S)
    if m:
        try:
            a = json.loads(m.group())
            if isinstance(a, list) and len(a) == n:
                return [str(x).strip() for x in a]
        except Exception:
            pass
    return None

_GL = {"sig": None, "d": {}}

def load_glossary():
    """merge glossary/*.txt (later filenames override earlier); reloads automatically when files change"""
    files = sorted(GLOSSARY_DIR.glob("*.txt"))
    sig = tuple((f.name, f.stat().st_mtime) for f in files)
    if sig != _GL["sig"]:
        d = {}
        for f in files:
            for line in f.read_text("utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or " = " not in line:
                    continue
                k, v = line.split(" = ", 1)
                if len(k.strip()) >= 2:          # single characters would match everywhere
                    d[k.strip()] = v.strip()
        _GL["sig"], _GL["d"] = sig, d
    return _GL["d"]

def glossary_hits(text, cap=80):
    gl = load_glossary()
    hits = sorted((k for k in gl if k in text), key=len, reverse=True)[:cap]   # longest (most specific) first
    return {k: gl[k] for k in hits}

def translate(vid, lines):
    hits = glossary_hits("".join(lines))
    dlog(f"translate {vid}: {len(lines)} lines, {len(hits)} glossary hits")
    ctx = LAST.get(vid, [])[-3:]
    out = []
    for j in range(0, len(lines), 30):
        t1 = time.time()
        part = lines[j:j + 30]
        user = ""
        if hits:
            user += "Glossary:\n" + "\n".join(f"{k} = {v}" for k, v in hits.items()) + "\n\n"
        if ctx:
            user += "Previous lines (context only, do NOT translate):\n" + "\n".join(ctx) + "\n\n"
        user += "Translate these lines:\n" + json.dumps(part, ensure_ascii=False)
        res = parse_arr(llm([{"role": "system", "content": SYS}, {"role": "user", "content": user}]), len(part))
        if res is None:   # model broke the format -> go line by line
            res = []
            for l in part:
                one = parse_arr(llm([{"role": "system", "content": SYS},
                                     {"role": "user", "content": "Translate these lines:\n" + json.dumps([l], ensure_ascii=False)}]), 1)
                res.append(one[0] if one else l)
        out += res
        ctx = (ctx + res)[-3:]
        dlog(f"translate {vid} batch {j//30+1}: {len(part)} lines in {time.time()-t1:.0f}s")
    LAST[vid] = (LAST.get(vid, []) + out)[-6:]
    return out

# ---------------- cue shaping ----------------
def wrap(t):
    t = " ".join(t.split())
    if len(t) <= MAXC:
        return t
    mid = len(t) // 2
    sp = [m.start() for m in re.finditer(" ", t)]
    if not sp:
        return t
    b = min(sp, key=lambda p: abs(p - mid))
    return t[:b] + "\n" + t[b + 1:]

def split_text(t, limit=MAXC * 2):
    if len(t) <= limit:
        return [t]
    out, cur = [], ""
    for p in re.split(r"(?<=[,;:.!?])\s+", t):
        while len(p) > limit:
            cut = p.rfind(" ", 0, limit); cut = cut if cut > 0 else limit
            if cur:
                out.append(cur); cur = ""
            out.append(p[:cut].strip()); p = p[cut:].strip()
        if len(cur) + len(p) + 1 <= limit:
            cur = (cur + " " + p).strip()
        else:
            if cur:
                out.append(cur)
            cur = p
    if cur:
        out.append(cur)
    return out

def shape(sents):
    cues = []
    for text, s, e in sents:
        text = text.strip()
        if not text:
            continue
        parts = split_text(text)
        total = sum(len(p) for p in parts)
        t = s
        for p in parts:
            d = (e - s) * len(p) / total
            cues.append([t, t + d, p])
            t += d
    for i, c in enumerate(cues):
        need = max(MIN_DUR, len(c[2]) / CPS)
        if c[1] - c[0] < need:
            c[1] = c[0] + need
        if i + 1 < len(cues):
            c[1] = max(c[0] + 0.3, min(c[1], cues[i + 1][0] - GAP))
        c[0], c[1], c[2] = round(c[0], 2), round(c[1], 2), wrap(c[2])
    return cues

# ============================================================================
#  JOB QUEUE — sequential block priority (lowest missing block from playhead)
# ============================================================================
state, lastreq = {}, {}
cv = threading.Condition()

def process(key):
    vid, i = key
    s = i * BLOCK; e = s + BLOCK
    a = max(0, s - PAD)
    t0 = time.time()
    def stage(name):
        state[key] = "running:" + name
        dlog(f"block {vid}:{i} [{time.time()-t0:4.0f}s] {name}")
    stage("audio")
    with tempfile.TemporaryDirectory() as td:
        wav = grab(vid, a, e + PAD, Path(td))
        stage("asr")
        zh = asr_sentences(wav, a)
    zh = [x for x in zh if s <= (x[1] + x[2]) / 2 < e]   # block owns sentences whose midpoint is inside it
    cues = []
    if zh:
        stage(f"translate:{len(zh)}lines")
        en = translate(vid, [x[0] for x in zh])
        stage("shaping")
        cues = shape([(en[k], zh[k][1], zh[k][2]) for k in range(len(zh))])
    p = cpath(vid, i)
    dlog(f"block {vid}:{i} ASR: {len(zh)} sentences -> {len(cues)} cues, total {time.time()-t0:.0f}s")
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(cues, ensure_ascii=False), "utf-8")
    tmp.replace(p)

def worker():
    fails, cooldown_until = {}, {}
    while True:
        with cv:
            while True:
                now = time.time()
                # Drop stale queued blocks (user seeked away >60s ago)
                for k, t in list(lastreq.items()):
                    if state.get(k) == "queued" and now - t > 60:
                        state.pop(k, None); lastreq.pop(k, None)
                cand = [k for k in lastreq
                        if state.get(k) == "queued"
                        or (state.get(k) == "running:cooldown" and now >= cooldown_until.get(k, 0))]
                if cand:
                    # Sequential priority: lowest block index first (so playback flows)
                    # Among different videos, prefer the one with the most recent request
                    newest_vid = max(lastreq, key=lambda k: lastreq[k])[0]
                    vid_cand = [k for k in cand if k[0] == newest_vid]
                    pick = vid_cand if vid_cand else cand
                    key = min(pick, key=lambda k: k[1])   # lowest block number
                    state[key] = "running"; break
                cv.wait(timeout=2)
        try:
            process(key); state.pop(key, None); fails.pop(key, None)
        except AudioNotReady:
            # Audio is still downloading — retry soon, don't count as failure
            state[key] = "running:cooldown"
            cooldown_until[key] = time.time() + 3
        except Exception as ex:
            dlog(f"block failed {key} {ex}")
            try:
                with DEVLOG.open("a", encoding="utf-8") as f:
                    f.write(traceback.format_exc() + "\n")
            except Exception:
                pass
            n = fails.get(key, 0) + 1; fails[key] = n
            wait = min(300, 10 * 2 ** (n - 1))   # 10s, 20s, 40s ... max 5 min
            state[key] = "running:cooldown"
            cooldown_until[key] = time.time() + wait
            dlog(f"block {key} retry in {wait}s (fail #{n})")

# ============================================================================
#  API
# ============================================================================
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/health")
def health():
    return {"ok": True, "asr": ASR_ID, "llm": LLM_MODEL, "root": str(ROOT)}

@app.get("/block")
def block(v: str, i: int):
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", v) or i < 0:
        return {"state": "error", "msg": "bad args"}
    p = cpath(v, i)
    if p.exists():
        return {"state": "ready", "cues": json.loads(p.read_text("utf-8"))}
    key = (v, i)

    # Kick off the full-audio download if not started yet
    dl_status, dl_progress = download_progress(v)
    if dl_status == "none":
        ensure_audio(v)
        dl_status, dl_progress = download_progress(v)

    with cv:
        st = state.get(key)
        if st and st.startswith("error"):
            state.pop(key); lastreq.pop(key, None)
            return {"state": "error", "msg": st}
        if st is None:
            state[key] = "queued"
        lastreq[key] = time.time()
        cv.notify()

        # Return download progress while audio is still downloading
        if dl_status == "downloading":
            return {"state": "downloading", "progress": round(dl_progress, 1)}
        return {"state": state[key]}

def preflight():
    """Fail fast with a human-readable message when a required tool is missing."""
    problems = []
    if not shutil.which("ffmpeg"):
        problems.append("ffmpeg not found on PATH (winget install Gyan.FFmpeg, then reopen the terminal)")
    try:
        r = requests.get(LLM_URL.rsplit("/", 2)[0] + "/models", timeout=5)
        ids = [m.get("id", "") for m in r.json().get("data", [])]
        if LLM_MODEL not in ids:
            dlog(f"WARNING: LLM_MODEL={LLM_MODEL!r} is not loaded in LM Studio (loaded: {ids}). "
                 f"Translation will fail until you load it.")
    except Exception as ex:
        dlog(f"WARNING: LM Studio is not reachable at {LLM_URL} ({ex}). "
             f"Start it and load {LLM_MODEL!r} before watching.")
    if problems:
        raise SystemExit("Missing requirements:\n- " + "\n- ".join(problems))

if __name__ == "__main__":
    preflight()
    cleanup()
    dlog(f"LiveSubs start: ASR={ASR_ID} LLM={LLM_MODEL} CPS={CPS}")
    dlog("loading models (first run downloads them)...")
    ASR = load_asr()
    threading.Thread(target=worker, daemon=True).start()
    dlog(f"LiveSubs ready on http://127.0.0.1:{PORT}  (LLM: {LLM_URL})")
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
