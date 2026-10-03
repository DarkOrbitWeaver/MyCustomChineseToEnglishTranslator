"""LiveSubs backend: yt-dlp (audio slice) -> Qwen3-ASR + ForcedAligner -> local LLM translate -> Netflix-style cues.
Run: python server.py   (listens on 127.0.0.1:8765)
"""
import os, re, json, sys, time, wave, shutil, threading, tempfile, subprocess, textwrap
from pathlib import Path
import requests, uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

ROOT = Path(__file__).parent
CACHE = ROOT / "cache"; CACHE.mkdir(exist_ok=True)
GLOSSARY_DIR = ROOT / "glossary"   # drop any *.txt in here: "中文 = English" per line

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
PUNCT = set("，。！？；：、,.!?;:…—-\"'“”‘’（）() \n")
SENT = re.compile(r"[^。！？!?；;…]+[。！？!?；;…]*")

# ---------------- cache housekeeping ----------------
def cleanup():
    cutoff = time.time() - KEEP_DAYS * 86400
    for d in CACHE.iterdir():
        if not d.is_dir():
            continue
        for f in d.glob("*.json"):
            if f.stat().st_mtime < cutoff:
                f.unlink()
        if not any(d.iterdir()):
            d.rmdir()

def cpath(vid, i):
    d = CACHE / vid; d.mkdir(exist_ok=True)
    return d / f"{i}.json"

# ---------------- audio ----------------
def grab(vid, a, b, outdir: Path):
    t0 = time.time()
    cmd = [sys.executable, "-m", "yt_dlp", "--no-playlist", "-q", "-f", "ba[abr<=64]/ba/b",
           "--js-runtimes", "node",
           "--download-sections", f"*{a:.2f}-{b:.2f}",
           "-x", "--audio-format", "wav",
           "--postprocessor-args", "ExtractAudio:-ar 16000 -ac 1",
           "-o", str(outdir / "a.%(ext)s"),
           f"https://www.youtube.com/watch?v={vid}"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired:
        raise RuntimeError("yt-dlp: audio download timed out after 5 min (slow network or YouTube throttle)")
    if r.returncode != 0:
        raise RuntimeError("yt-dlp: " + (r.stderr or r.stdout)[-1500:])
    print(f"audio slice {a:.0f}-{b:.0f}s fetched in {time.time()-t0:.0f}s", flush=True)
    wavs = list(outdir.glob("a.wav")) or list(outdir.glob("a.*"))
    if not wavs:
        raise RuntimeError("yt-dlp produced no audio")
    return wavs[0]

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
    ctx = LAST.get(vid, [])[-3:]
    out = []
    for j in range(0, len(lines), 30):
        print(f"translate {vid} lines {min(j+30,len(lines))}/{len(lines)}", flush=True)
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

# ---------------- job queue (newest request wins, so seeking feels instant) ----------------
state, lastreq = {}, {}
cv = threading.Condition()

def process(key):
    vid, i = key
    s = i * BLOCK; e = s + BLOCK
    a = max(0, s - PAD)
    t0 = time.time()
    def stage(name):
        state[key] = "running:" + name
        print(f"block {vid}:{i} [{time.time()-t0:4.0f}s] {name}", flush=True)
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
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(cues, ensure_ascii=False), "utf-8")
    tmp.replace(p)

def worker():
    while True:
        with cv:
            while True:
                now = time.time()
                for k, t in list(lastreq.items()):      # drop stale queued blocks (user seeked away)
                    if state.get(k) == "queued" and now - t > 20:
                        state.pop(k, None); lastreq.pop(k, None)
                cand = [k for k in lastreq if state.get(k) == "queued"]
                if cand:
                    key = max(cand, key=lambda k: lastreq[k]); state[key] = "running"; break
                cv.wait(timeout=2)
        try:
            process(key); state.pop(key, None)
        except Exception as ex:
            print("block failed", key, ex)
            state[key] = "error:" + str(ex)[:200]

# ---------------- API ----------------
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/health")
def health():
    return {"ok": True, "asr": ASR_ID, "llm": LLM_MODEL}

@app.get("/block")
def block(v: str, i: int):
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", v) or i < 0:
        return {"state": "error", "msg": "bad args"}
    p = cpath(v, i)
    if p.exists():
        return {"state": "ready", "cues": json.loads(p.read_text("utf-8"))}
    key = (v, i)
    with cv:
        st = state.get(key)
        if st and st.startswith("error"):
            state.pop(key); lastreq.pop(key, None)
            return {"state": "error", "msg": st}
        if st is None:
            state[key] = "queued"
        lastreq[key] = time.time()
        cv.notify()
        return {"state": state[key]}

def preflight():
    """Fail fast with a human-readable message when a required tool is missing."""
    problems = []
    if not shutil.which("ffmpeg"):
        problems.append("ffmpeg not found on PATH (winget install Gyan.FFmpeg, then reopen the terminal)")
    if not any(shutil.which(r) for r in ("node", "deno", "bun")):
        problems.append("no JS runtime found (install Node.js LTS so yt-dlp can read YouTube pages)")
    try:
        r = requests.get(LLM_URL.rsplit("/", 2)[0] + "/models", timeout=5)
        ids = [m.get("id", "") for m in r.json().get("data", [])]
        if LLM_MODEL not in ids:
            print(f"WARNING: LLM_MODEL={LLM_MODEL!r} is not loaded in LM Studio (loaded: {ids}). "
                  f"Translation will fail until you load it.", flush=True)
    except Exception as ex:
        print(f"WARNING: LM Studio is not reachable at {LLM_URL} ({ex}). "
              f"Start it and load {LLM_MODEL!r} before watching.", flush=True)
    if problems:
        raise SystemExit("Missing requirements:\n- " + "\n- ".join(problems))

if __name__ == "__main__":
    preflight()
    cleanup()
    print("loading models (first run downloads them)...")
    ASR = load_asr()
    threading.Thread(target=worker, daemon=True).start()
    print(f"LiveSubs ready on http://127.0.0.1:{PORT}  (LLM: {LLM_URL})")
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
