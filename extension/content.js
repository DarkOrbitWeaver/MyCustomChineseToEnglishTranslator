(() => {
  'use strict';
  const BLOCK = 60;                       // must match server.py
  const cfg = { enabled: false, lookahead: 300, subFont: 24, subBg: 75, subEdge: 2, subColor: '#ffffff' };
  let vid = null, blocks = new Map(), online = false, busy = false, nextTry = 0, dlPct = -1;

  const elog = m => console.log('[LiveSubs]', m);
  const api = path => new Promise(res => chrome.runtime.sendMessage({ path }, r => res(r || { error: 'no response' })));
  const video = () => document.querySelector('video.html5-main-video') || document.querySelector('video');
  const player = () => document.getElementById('movie_player');
  const videoId = () => new URLSearchParams(location.search).get('v');

  const PRESETS = {
    default:  { f: 24, b: 75, e: 2, c: '#ffffff' },
    cinema:   { f: 32, b: 85, e: 3, c: '#ffffff' },
    bright:   { f: 24, b: 75, e: 2, c: '#ffe600' },
    minimal:  { f: 20, b:  0, e: 1, c: '#ffffff' },
  };

  // ---- CSS ----
  const CSS = `
  #ls-panel{position:absolute;right:12px;bottom:64px;width:280px;max-height:70%;overflow-y:auto;z-index:80;
    background:rgba(18,18,18,.94);color:#eee;font:13px Roboto,Arial,sans-serif;border-radius:10px;
    padding:14px;display:none;box-shadow:0 4px 24px rgba(0,0,0,0.5);backdrop-filter:blur(8px);
    transition:opacity .15s ease}
  #ls-panel.open{display:block}
  #ls-panel .ls-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
  #ls-panel .ls-title{font-weight:700;font-size:15px;display:flex;align-items:center;gap:6px}
  .ls-dot{width:8px;height:8px;border-radius:50%;display:inline-block;background:#555;flex-shrink:0}
  .ls-dot.green{background:#4CAF50;box-shadow:0 0 6px #4CAF50}
  .ls-dot.amber{background:#FFC107;animation:ls-pulse 1s infinite alternate}
  .ls-dot.red{background:#F44336}
  @keyframes ls-pulse{from{opacity:.5}to{opacity:1}}
  .ls-toggle{appearance:none;width:36px;height:20px;background:#444;border-radius:10px;position:relative;cursor:pointer;outline:none;flex-shrink:0}
  .ls-toggle:checked{background:#FFB300}
  .ls-toggle::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;background:#fff;border-radius:50%;transition:.15s}
  .ls-toggle:checked::after{left:18px}
  #ls-dl-wrap{width:100%;margin-bottom:10px;display:none}
  #ls-dl-label{font-size:11px;color:#aaa;margin-bottom:3px}
  #ls-dl-track{width:100%;height:4px;background:#333;border-radius:2px;overflow:hidden}
  #ls-dl-bar{height:100%;background:linear-gradient(90deg,#FFB300,#FF8F00);width:0%;transition:width .3s}
  #ls-panel .ls-sep{border:none;border-top:1px solid #333;margin:10px 0}
  #ls-panel label{display:flex;justify-content:space-between;align-items:center;margin:6px 0;gap:8px}
  #ls-panel select{width:140px;background:#222;color:#eee;border:1px solid #444;border-radius:4px;padding:3px 6px;font-size:12px}
  #ls-panel input[type=range]{width:140px;accent-color:#FFB300}
  #ls-panel input[type=color]{width:36px;height:22px;padding:0;border:1px solid #444;border-radius:4px;background:#222;cursor:pointer}
  #ls-btn svg{padding:8px;box-sizing:border-box}
  #ls-win{visibility:visible!important;text-align:center;width:100%}
  #ls-sub{display:inline-block;padding:3px 10px;border-radius:4px;font-family:'YouTube Noto',Roboto,Arial,sans-serif;
    white-space:pre-wrap;line-height:1.4;max-width:85%;box-sizing:border-box;overflow-wrap:break-word;word-break:break-word}
  `;

  // ---- Inline SVG for the player-bar button (tiny version of the icon) ----
  const BTN_SVG = `<svg viewBox="0 0 128 128" width="100%" height="100%">
    <rect width="128" height="128" rx="28" fill="#FFB300"/>
    <path d="M30 35h45v35H60l-10 10V70H30z" fill="#fff"/>
    <text x="52" y="58" font-family="sans-serif" font-weight="bold" font-size="22" fill="#333" text-anchor="middle">字</text>
    <path d="M50 60h48v35H83l-10 10V95H50z" fill="#222"/>
    <text x="74" y="83" font-family="sans-serif" font-weight="bold" font-size="20" fill="#fff" text-anchor="middle">A</text>
  </svg>`;

  // ---- Element references (re-discovered by ensureUI) ----
  const el = {};

  function styleSub(span) {
    if (!span) return;
    span.style.fontSize = cfg.subFont + 'px';
    span.style.color = cfg.subColor || '#fff';
    span.style.background = 'rgba(0,0,0,' + (cfg.subBg / 100).toFixed(2) + ')';
    const e = Number(cfg.subEdge) || 0;
    span.style.textShadow = e > 0
      ? `-${e}px -${e}px 0 #000,${e}px -${e}px 0 #000,-${e}px ${e}px 0 #000,${e}px ${e}px 0 #000,0 0 ${e*3}px rgba(0,0,0,.9)`
      : 'none';
  }

  // ---- UI creation (like DBLSUB: panel inside #movie_player, button in .ytp-right-controls) ----
  function createUI() {
    const p = player();
    if (!p) return;

    // Inject global style
    if (!document.getElementById('ls-css')) {
      const s = document.createElement('style');
      s.id = 'ls-css'; s.textContent = CSS;
      document.head.appendChild(s);
    }

    // Panel
    if (!el.panel || !p.contains(el.panel)) {
      el.panel = document.createElement('div');
      el.panel.id = 'ls-panel';
      el.panel.innerHTML = `
        <div class="ls-hdr">
          <span class="ls-title">LiveSubs <span class="ls-dot" id="ls-dot"></span></span>
          <input type="checkbox" class="ls-toggle" id="ls-en">
        </div>
        <div id="ls-dl-wrap">
          <div id="ls-dl-label">Downloading audio…</div>
          <div id="ls-dl-track"><div id="ls-dl-bar"></div></div>
        </div>
        <hr class="ls-sep">
        <label>Preset <select id="ls-preset">
          <option value="">Custom</option>
          <option value="default">Default</option>
          <option value="cinema">Cinema (big)</option>
          <option value="bright">Bright yellow</option>
          <option value="minimal">Minimal</option>
        </select></label>
        <label>Text color <select id="ls-color">
          <option value="#ffffff">White</option>
          <option value="#ffe600">Yellow</option>
          <option value="#8ef6ff">Cyan</option>
          <option value="#b9ff9e">Mint</option>
        </select></label>
        <label>Size <input type="range" id="ls-size" min="14" max="48" step="1"></label>
        <label>Background <input type="range" id="ls-bg" min="0" max="90" step="5"></label>
        <label>Text edge <input type="range" id="ls-edge" min="0" max="3" step="1"></label>
      `;

      // Stop events from reaching YouTube player
      ['click','dblclick','mousedown','keydown','keyup','wheel','contextmenu'].forEach(ev =>
        el.panel.addEventListener(ev, e => e.stopPropagation()));

      // Bind settings controls
      const $ = id => el.panel.querySelector('#' + id);
      const enCb = $('ls-en');
      const presetSel = $('ls-preset');
      const sizeSl = $('ls-size');
      const bgSl = $('ls-bg');
      const edgeSl = $('ls-edge');
      const colorSel = $('ls-color');

      enCb.checked = cfg.enabled;
      sizeSl.value = cfg.subFont;
      bgSl.value = cfg.subBg;
      edgeSl.value = cfg.subEdge;
      colorSel.value = cfg.subColor;

      enCb.onchange = () => {
        cfg.enabled = enCb.checked;
        chrome.storage.local.set({ enabled: cfg.enabled });
        if (cfg.enabled && !online) connect();
        if (!cfg.enabled) { online = false; hideSub(); }
      };
      presetSel.onchange = () => {
        const pr = PRESETS[presetSel.value]; if (!pr) return;
        cfg.subFont = pr.f; cfg.subBg = pr.b; cfg.subEdge = pr.e; cfg.subColor = pr.c;
        sizeSl.value = pr.f; bgSl.value = pr.b; edgeSl.value = pr.e; colorSel.value = pr.c;
        chrome.storage.local.set({ subFont: pr.f, subBg: pr.b, subEdge: pr.e, subColor: pr.c });
      };
      const bind = (key, input, parse) => {
        input.oninput = () => { cfg[key] = parse(input.value); presetSel.value = ''; };
        input.onchange = () => chrome.storage.local.set({ [key]: cfg[key] });
      };
      bind('subFont', sizeSl, Number);
      bind('subBg', bgSl, Number);
      bind('subEdge', edgeSl, Number);
      bind('subColor', colorSel, String);

      p.appendChild(el.panel);
    }

    // Player bar button
    const bar = p.querySelector('.ytp-right-controls');
    if (bar && (!el.btn || !bar.contains(el.btn))) {
      el.btn = document.createElement('button');
      el.btn.id = 'ls-btn';
      el.btn.className = 'ytp-button';
      el.btn.title = 'LiveSubs';
      el.btn.innerHTML = BTN_SVG;
      el.btn.addEventListener('click', e => { e.stopPropagation(); el.panel.classList.toggle('open'); });
      bar.insertBefore(el.btn, bar.firstChild);
    }

    // Ensure subtitle container exists
    ensureSub();
  }

  // ---- Subtitle DOM element (independent of YouTube's caption system) ----
  function ensureSub() {
    const p = player(); if (!p) return null;
    let wrap = p.querySelector('#ls-win');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'ls-win';
      wrap.style.cssText = 'position:absolute;left:0;right:0;bottom:12%;text-align:center;pointer-events:none;z-index:59;';
      const span = document.createElement('span');
      span.id = 'ls-sub';
      wrap.appendChild(span);
      p.appendChild(wrap);
      elog('subtitle element created');
    }
    return wrap.querySelector('#ls-sub');
  }

  function ensureUI() {
    const p = player();
    if (!p) return;
    if (!el.panel || !p.contains(el.panel) || !el.btn || !p.querySelector('#ls-btn')) createUI();
    // Also ensure subtitle element exists
    if (!p.querySelector('#ls-win')) ensureSub();
  }

  // ---- Backend connection ----
  let lastConnectTry = 0;
  async function connect() {
    lastConnectTry = Date.now();
    const r = await api('/health');
    online = !r.error && r.ok === true;
    if (online) { nextTry = 0; elog('backend connected'); }
    else elog('backend unreachable');
  }

  // ---- Status dot + download progress ----
  let lastDot = '';
  function updateStatus() {
    const dot = el.panel && el.panel.querySelector('#ls-dot');
    if (!dot) return;
    let cls = '';
    if (!online) cls = 'ls-dot red';
    else if (dlPct >= 0 && dlPct < 100) cls = 'ls-dot amber';
    else {
      // Check if all blocks near playhead are ready
      const v = video();
      if (v) {
        const cur = Math.floor(v.currentTime / BLOCK);
        const allReady = [cur, cur + 1].every(i => blocks.has(i));
        cls = allReady ? 'ls-dot green' : 'ls-dot amber';
      } else cls = 'ls-dot';
    }
    if (cls !== lastDot) { dot.className = cls; lastDot = cls; }

    // Download progress bar
    const wrap = el.panel && el.panel.querySelector('#ls-dl-wrap');
    const bar = el.panel && el.panel.querySelector('#ls-dl-bar');
    const lbl = el.panel && el.panel.querySelector('#ls-dl-label');
    if (wrap && bar) {
      if (dlPct >= 0 && dlPct < 100) {
        wrap.style.display = 'block';
        bar.style.width = dlPct.toFixed(1) + '%';
        if (lbl) lbl.textContent = 'Downloading audio… ' + Math.round(dlPct) + '%';
      } else {
        wrap.style.display = 'none';
      }
    }
  }

  // ---- Polling for blocks ----
  async function tick() {
    const v = video();
    if (!cfg.enabled || !online || !v || !vid || busy || !isFinite(v.duration)) return;
    const t = v.currentTime, cur = Math.floor(t / BLOCK);
    const last = Math.min(Math.floor(v.duration / BLOCK), Math.floor((t + cfg.lookahead) / BLOCK));
    let want = null;
    for (let i = cur; i <= last; i++) if (!blocks.has(i)) { want = i; break; }
    if (want === null) return;
    if (Date.now() < nextTry) return;
    busy = true;
    const forVid = vid;
    const r = await api('/block?v=' + vid + '&i=' + want);
    busy = false;
    if (forVid !== vid) return;
    if (r.error) { online = false; elog('block ' + forVid + ':' + want + ' error: ' + r.error); return; }
    if (r.state === 'ready') {
      blocks.set(want, r.cues);
      dlPct = -1;
      elog('block ' + want + ' ready (' + r.cues.length + ' cues)');
    }
    else if (r.state === 'downloading') { dlPct = r.progress || 0; nextTry = Date.now() + 2000; }
    else if (r.state === 'error') { nextTry = Date.now() + 10000; elog('block ' + forVid + ':' + want + ' failed: ' + (r.msg || '')); }
    else { nextTry = Date.now() + 800; }
  }

  // ---- Render subtitles ----
  let lastShownText = '';
  function render() {
    const v = video(); if (!v) return;
    let text = '';
    if (cfg.enabled && online) {
      const t = v.currentTime, k = Math.floor(t / BLOCK);
      for (const j of [k, k - 1, k + 1]) {
        if (j < 0) continue;
        const a = blocks.get(j); if (!a) continue;
        const c = a.find(c => t >= c[0] && t < c[1]);
        if (c) { text = c[2]; break; }
      }
    }

    if (text === lastShownText) return;
    lastShownText = text;

    const span = ensureSub();
    if (!span) return;

    if (!text) {
      span.parentElement.style.display = 'none';
      return;
    }
    // Show subtitle: prefer single long line, wrap naturally within container
    span.replaceChildren();
    const isMultiSpeaker = text.includes('\n') && text.split('\n').some(l => /^\s*[-—–]/.test(l));
    const displayText = isMultiSpeaker ? text : text.replace(/\s*\n\s*/g, ' ');
    displayText.split('\n').forEach((line, i) => {
      if (i) span.appendChild(document.createElement('br'));
      span.appendChild(document.createTextNode(line));
    });
    styleSub(span);
    span.parentElement.style.display = 'block';
  }

  function hideSub() {
    const p = player(); if (!p) return;
    const win = p.querySelector('#ls-win');
    if (win) win.style.display = 'none';
    lastShownText = '';
  }

  // ---- Yellow seek-bar markers for cached blocks ----
  function paintMarkers() {
    const p = player(), v = video();
    if (!v || !isFinite(v.duration) || !vid || !p) return;
    const bar = p.querySelector('.ytp-progress-bar-container');
    if (!bar) return;
    let strip = bar.querySelector('#ls-progress');
    if (!strip) {
      strip = document.createElement('div'); strip.id = 'ls-progress';
      strip.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:3px;pointer-events:none;z-index:30;';
      if (!bar.style.position) bar.style.position = 'relative';
      bar.appendChild(strip);
    }
    const sig = vid + ':' + blocks.size + ':' + Math.round(v.duration);
    if (strip.dataset.sig !== sig) {
      strip.dataset.sig = sig; strip.replaceChildren();
      const D = v.duration;
      for (const k of [...blocks.keys()].sort((a, b) => a - b)) {
        const m = document.createElement('div');
        m.style.cssText = 'position:absolute;top:0;height:100%;background:rgba(255,235,59,.85);'
          + 'left:' + (k * BLOCK / D * 100).toFixed(2) + '%;width:' + Math.max(0.3, Math.min(BLOCK / D * 100, 100 - k * BLOCK / D * 100)).toFixed(2) + '%;';
        strip.appendChild(m);
      }
    }
  }

  // ---- Update chrome (status, markers, auto-pause) ----
  function paintChrome() {
    updateStatus();
    paintMarkers();
    if (cfg.enabled && !online && Date.now() - lastConnectTry > 3000) {
      connect();
    }
  }

  // ---- Navigation & settings ----
  function onNav() {
    vid = videoId();
    blocks.clear();
    busy = false;
    nextTry = 0;
    dlPct = -1;
    lastShownText = '';
    elog('nav: vid=' + vid);
  }

  function applyCfg(s) {
    const was = cfg.enabled;
    cfg.enabled = s.enabled; cfg.lookahead = s.lookahead;
    cfg.subFont = s.subFont; cfg.subBg = s.subBg; cfg.subEdge = s.subEdge; cfg.subColor = s.subColor;
    // Update panel controls if they exist
    if (el.panel) {
      const enCb = el.panel.querySelector('#ls-en');
      if (enCb) enCb.checked = cfg.enabled;
    }
    if (cfg.enabled && !was) { elog('enabled'); connect(); }
    if (!cfg.enabled && was) { online = false; hideSub(); }
  }

  // ---- Init ----
  chrome.storage.local.get({ enabled: false, lookahead: 300, subFont: 24, subBg: 75, subEdge: 2, subColor: '#ffffff' }, s => {
    elog('init: enabled=' + s.enabled);
    applyCfg(s);
    onNav();
  });
  chrome.storage.onChanged.addListener(() => {
    chrome.storage.local.get({ enabled: false, lookahead: 300, subFont: 24, subBg: 75, subEdge: 2, subColor: '#ffffff' }, s => applyCfg(s));
  });

  document.addEventListener('yt-navigate-finish', onNav);
  setInterval(tick, 500);
  setInterval(render, 100);
  setInterval(paintChrome, 250);
  setInterval(ensureUI, 1000);
})();
