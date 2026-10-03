(() => {
  const BLOCK = 60;                       // must match server.py
  const cfg = { enabled: false, lookahead: 300 };
  let vid = null, blocks = new Map(), busy = false, nextTry = 0, online = false;

  const $ = s => document.querySelector(s);
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
      badge.style.cssText = "position:absolute;top:10px;left:10px;z-index:60;font:12px Roboto,Arial,sans-serif;color:#fff;background:rgba(0,0,0,.65);padding:3px 8px;border-radius:4px;cursor:pointer;display:none;";
      badge.onclick = () => { if (!online) connect(); };
      p.appendChild(badge);
    }
    return { cap, badge };
  }

  function setStatus(s) {
    const u = ui(); if (!u) return;
    u.badge.textContent = "LiveSubs: " + s;
    u.badge.style.display = cfg.enabled && s !== "ready" ? "block" : "none";
  }

  async function connect() {
    setStatus("connecting...");
    const r = await api("/health");
    online = !r.error && r.ok === true;
    if (online) { blocks.clear(); nextTry = 0; setStatus("connected"); }
    else setStatus("backend offline - click to retry");
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
    if (r.error) { online = false; setStatus("backend offline - click to retry"); return; }
    if (r.state === "ready") blocks.set(want, r.cues);
    else if (r.state === "error") { nextTry = Date.now() + 10000; setStatus("block failed, retrying..."); }
    else { const detail = (r.state && r.state.includes(":")) ? " " + r.state.split(":")[1] : "..."; setStatus((want === cur ? "building subs" : "preparing ahead") + detail); nextTry = Date.now() + 800; }
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
      host.style.display = "block";   // YT hides the layer when its own CC track is off; ours doesn't need one
      if (!win) {
        win = document.createElement("div");
        win.id = "ls-win";
        win.className = "caption-window ytp-caption-window-bottom";
        win.setAttribute("dir", "ltr");
        const t = document.createElement("span");
        t.className = "captions-text";
        win.appendChild(t);
        host.appendChild(win);
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
      }
      win.style.display = "block";
      const old = p.querySelector("#ls-cap"); if (old) old.style.display = "none";
      return;
    }
    // Fallback: our own overlay (e.g. embeds) with a readable default edge.
    const u = ui(); if (!u) return;
    if (u.cap.dataset.t === text) return;
    u.cap.dataset.t = text; u.cap.replaceChildren();
    if (!text || !cfg.enabled) return;
    const wrap = document.createElement("span");
    wrap.className = "captions-text";
    wrap.style.fontSize = Math.max(14, Math.round(p.clientHeight * 0.045)) + "px";
    wrap.style.textShadow = "-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000";
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
    if (cfg.enabled && !was) connect();
    if (!cfg.enabled) { online = false; setStatus("off"); }
  }

  chrome.storage.local.get({ enabled: false, lookahead: 300 }, s => { applyCfg(s); onNav(); });
  chrome.storage.onChanged.addListener((ch) => {
    chrome.storage.local.get({ enabled: false, lookahead: 300 }, s => {
      applyCfg(s);
      if (ch.nonce && cfg.enabled) connect();
    });
  });
  document.addEventListener("yt-navigate-finish", onNav);
  setInterval(tick, 500);
  setInterval(render, 100);
})();
