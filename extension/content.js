(() => {
  const BLOCK = 60;                       // must match server.py
  const cfg = { enabled: false, lookahead: 300, subFont: 24, subBg: 75, subEdge: 2, subColor: "#ffffff" };
  let vid = null, blocks = new Map(), busy = false, nextTry = 0, online = false;

  const $ = s => document.querySelector(s);
  const elog = (m) => console.log("[LiveSubs]", m);
  const api = path => new Promise(res => chrome.runtime.sendMessage({ path }, r => res(r || { error: "no response" })));
  const video = () => $("video.html5-main-video") || $("video");
  const player = () => $("#movie_player");
  const videoId = () => new URLSearchParams(location.search).get("v");

  function ui() {
    const p = player(); if (!p) return null;
    let cap = p.querySelector("#ls-cap");
    if (!cap) {
      cap = document.createElement("div"); cap.id = "ls-cap";
      cap.style.cssText = "position:absolute;left:0;right:0;bottom:11%;text-align:center;pointer-events:none;z-index:59;";
      p.appendChild(cap);
    }
    let badge = p.querySelector("#ls-badge");
    if (!badge) {
      badge = document.createElement("div"); badge.id = "ls-badge";
      badge.style.cssText = "position:absolute;top:10px;right:10px;z-index:60;font:12px Roboto,Arial,sans-serif;color:#fff;background:rgba(0,0,0,.65);padding:3px 8px;border-radius:4px;cursor:pointer;display:none;";
      badge.onclick = () => { if (!online) connect(); };
      p.appendChild(badge);
    }
    return { cap, badge };
  }

  let lastStatus = "off";
  function isErrorStatus(s) { return /offline|failed|error/i.test(s); }

  function setStatus(s) {
    lastStatus = s;
    const u = ui(); if (!u) return;
    u.badge.textContent = "LiveSubs: " + s;
  }

  async function connect() {
    setStatus("connecting…");
    const r = await api("/health");
    online = !r.error && r.ok === true;
    if (online) { blocks.clear(); nextTry = 0; setStatus("connected"); elog("backend connected"); }
    else { setStatus("offline — click to retry"); elog("backend unreachable"); }
  }

  async function tick() {
    const v = video();
    if (!cfg.enabled || !online || !v || !vid || busy || !isFinite(v.duration)) return;
    const t = v.currentTime, cur = Math.floor(t / BLOCK);
    const last = Math.min(Math.floor(v.duration / BLOCK), Math.floor((t + cfg.lookahead) / BLOCK));
    let want = null;
    for (let i = cur; i <= last; i++) if (!blocks.has(i)) { want = i; break; }
    if (want === null) { setStatus("ready"); return; }
    if (Date.now() < nextTry) return;
    busy = true;
    const forVid = vid;
    const r = await api(`/block?v=${vid}&i=${want}`);
    busy = false;
    if (forVid !== vid) return;
    if (r.error) { online = false; setStatus("offline — click to retry"); elog(`block ${forVid}:${want} request failed: ${r.error}`); return; }
    if (r.state === "ready") blocks.set(want, r.cues);
    else if (r.state === "error") { nextTry = Date.now() + 10000; setStatus("having trouble — retrying…"); elog(`block ${forVid}:${want} failed: ${r.msg || ""}`); }
    else { setStatus("preparing ahead…"); nextTry = Date.now() + 800; }
  }

  function styleSubs(t) {
    t.style.fontSize = cfg.subFont + "px";
    t.style.color = cfg.subColor || "#fff";
    t.style.background = "rgba(0,0,0," + (cfg.subBg / 100).toFixed(2) + ")";
    t.style.padding = "2px 10px";
    t.style.borderRadius = "4px";
    const e = cfg.subEdge;
    t.style.textShadow = e > 0
      ? `-${e}px -${e}px 0 #000,${e}px -${e}px 0 #000,-${e}px ${e}px 0 #000,${e}px ${e}px 0 #000,0 0 ${e * 3}px rgba(0,0,0,.9)`
      : "none";
  }

  function render() {
    const v = video(), p = player(); if (!v || !p) return;
    let text = "";
    if (cfg.enabled && online) {
      const t = v.currentTime, k = Math.floor(t / BLOCK);
      for (const j of [k, k - 1, k + 1]) {
        const a = blocks.get(j); if (!a) continue;
        const c = a.find(c => t >= c[0] && t < c[1]);
        if (c) { text = c[2]; break; }
      }
    }
    // Prefer YouTube's own caption layer so the user's CC styles (size/color/edge/background) apply.
    const host = p.querySelector(".ytp-caption-window-container");
    if (host) {
      let win = host.querySelector("#ls-win");
      if (!cfg.enabled || !text) { if (win) win.style.display = "none"; return; }
      const ss = cfg.subFont + "/" + cfg.subBg + "/" + cfg.subEdge + "/" + cfg.subColor;
      host.style.display = "block";   // YT hides the layer when its own CC track is off; ours doesn't need one
      if (!win) {
        win = document.createElement("div");
        win.id = "ls-win";
        win.className = "caption-window ytp-caption-window-bottom";
        win.setAttribute("dir", "ltr");
        win.dataset.ss = ss;
        const t = document.createElement("span");
        t.className = "captions-text";
        win.appendChild(t);
        host.appendChild(win);
      } else if (win.dataset.ss !== ss) {
        win.dataset.ss = ss;
        const tt = win.querySelector(".captions-text"); if (tt) tt.dataset.t = "";
      }
      const t = win.querySelector(".captions-text");
      if (t.dataset.t !== text) {
        t.dataset.t = text; t.replaceChildren();
        text.split("\n").forEach((line, i) => {
          if (i) t.appendChild(document.createElement("br"));
          const s = document.createElement("span");
          s.className = "ytp-caption-segment";
          s.textContent = line;
          t.appendChild(s);
        });
        styleSubs(t);
      }
      win.style.display = "block";
      const old = p.querySelector("#ls-cap"); if (old) old.style.display = "none";
      return;
    }
    // Fallback: our own overlay (e.g. embeds), styled from the panel like the main path.
    const u = ui(); if (!u) return;
    const ss2 = cfg.subFont + "/" + cfg.subBg + "/" + cfg.subEdge + "/" + cfg.subColor;
    if (u.cap.dataset.ss !== ss2) { u.cap.dataset.ss = ss2; u.cap.dataset.t = ""; }
    if (u.cap.dataset.t === text) return;
    u.cap.dataset.t = text; u.cap.replaceChildren();
    if (!text || !cfg.enabled) return;
    const wrap = document.createElement("span");
    wrap.className = "captions-text";
    styleSubs(wrap);
    text.split("\n").forEach((line, i) => {
      if (i) wrap.appendChild(document.createElement("br"));
      const s = document.createElement("span");
      s.className = "ytp-caption-segment";
      s.style.fontFamily = "'YouTube Noto',Roboto,Arial,sans-serif";
      s.textContent = line;
      wrap.appendChild(s);
    });
    u.cap.appendChild(wrap);
  }

  function onNav() { vid = videoId(); blocks.clear(); busy = false; nextTry = 0; }

  function applyCfg(s) {
    const was = cfg.enabled;
    cfg.enabled = s.enabled; cfg.lookahead = s.lookahead;
    cfg.subFont = s.subFont; cfg.subBg = s.subBg; cfg.subEdge = s.subEdge; cfg.subColor = s.subColor;
    if (cfg.enabled && !was) { elog("enabled"); connect(); }
    if (!cfg.enabled) { online = false; setStatus("off"); elog("disabled"); }
  }

  chrome.storage.local.get({ enabled: false, lookahead: 300, subFont: 24, subBg: 75, subEdge: 2, subColor: "#ffffff" }, s => { applyCfg(s); onNav(); });
  chrome.storage.onChanged.addListener((ch) => {
    chrome.storage.local.get({ enabled: false, lookahead: 300, subFont: 24, subBg: 75, subEdge: 2, subColor: "#ffffff" }, s => {
      applyCfg(s);
      if (ch.nonce && cfg.enabled) connect();
    });
  });
  function paintChrome() {
    const p = player(), v = video();
    const u = ui(); if (!u || !p) return;
    // badge follows YouTube's control auto-hide; errors stay visible since they need action
    const show = cfg.enabled && lastStatus !== "ready" && lastStatus !== "off";
    u.badge.style.display = (!show || (!isErrorStatus(lastStatus) && p.classList.contains("ytp-autohide"))) ? "none" : "block";
    // translated-chunks markers on the seek bar (yellow = block ready in cache)
    if (!v || !isFinite(v.duration) || !vid) return;
    const bar = p.querySelector(".ytp-progress-bar-container");
    if (!bar) return;
    let strip = bar.querySelector("#ls-progress");
    if (!strip) {
      strip = document.createElement("div"); strip.id = "ls-progress";
      strip.style.cssText = "position:absolute;left:0;right:0;bottom:0;height:3px;pointer-events:none;z-index:30;";
      if (!bar.style.position) bar.style.position = "relative";
      bar.appendChild(strip);
    }
    const sig = vid + ":" + blocks.size + ":" + Math.round(v.duration);
    if (strip.dataset.sig !== sig) {
      strip.dataset.sig = sig; strip.replaceChildren();
      const D = v.duration;
      for (const k of [...blocks.keys()].sort((a, b) => a - b)) {
        const m = document.createElement("div");
        m.style.cssText = "position:absolute;top:0;height:100%;background:rgba(255,235,59,.85);"
          + `left:${(k * BLOCK / D * 100).toFixed(2)}%;width:${Math.max(0.3, Math.min(BLOCK / D * 100, 100 - k * BLOCK / D * 100)).toFixed(2)}%;`;
        strip.appendChild(m);
      }
    }
  }

  document.addEventListener("yt-navigate-finish", onNav);
  setInterval(tick, 500);
  setInterval(render, 100);
  setInterval(paintChrome, 250);
})();
