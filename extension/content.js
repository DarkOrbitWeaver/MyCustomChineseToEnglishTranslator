(() => {
  'use strict';
  const BLOCK = 60;                       // must match server.py
  const cfg = { enabled: false, lookahead: 300, cooldown: 5, batchSize: 12, subFont: 24, subBg: 75, subEdge: 2, subColor: '#ffffff' };
  let vid = null, blocks = new Map(), queuedBlocks = new Map(), online = false, busy = false, nextTry = 0, dlPct = -1;
  let lastHb = 0, lastHbCur = -1;

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
  #ls-panel{position:absolute;right:12px;bottom:64px;width:300px;max-height:82%;overflow-y:auto;overflow-x:hidden;z-index:80;
    background:rgba(18,18,18,.95);color:#eee;font:13px Roboto,Arial,sans-serif;border-radius:12px;
    padding:14px;display:none;box-shadow:0 8px 32px rgba(0,0,0,0.6);backdrop-filter:blur(10px);
    border:1px solid rgba(255,255,255,0.08);transition:opacity .15s ease}
  #ls-panel.open{display:block}
  #ls-panel .ls-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
  #ls-panel .ls-hdr-left{display:flex;align-items:center;gap:8px}
  #ls-panel .ls-hdr-right{display:flex;align-items:center;gap:8px}
  #ls-panel .ls-title{font-weight:700;font-size:15px;color:#fff}
  .ls-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;padding:2px 8px;border-radius:10px;
    background:#252525;color:#bbb;font-weight:500}
  .ls-dot{width:7px;height:7px;border-radius:50%;display:inline-block;background:#555;flex-shrink:0}
  .ls-dot.green{background:#4CAF50;box-shadow:0 0 6px #4CAF50}
  .ls-dot.amber{background:#FFC107;animation:ls-pulse 1s infinite alternate}
  .ls-dot.red{background:#F44336}
  @keyframes ls-pulse{from{opacity:.5}to{opacity:1}}
  .ls-btn-connect{background:linear-gradient(135deg,#FFB300,#FF8F00);color:#111;font-weight:700;font-size:11px;
    border:none;border-radius:6px;padding:3px 8px;cursor:pointer;display:none;align-items:center;gap:3px;transition:transform .1s}
  .ls-btn-connect:active{transform:scale(0.96)}
  .ls-toggle{appearance:none;width:36px;height:20px;background:#444;border-radius:10px;position:relative;cursor:pointer;outline:none;flex-shrink:0}
  .ls-toggle:checked{background:#FFB300}
  .ls-toggle::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;background:#fff;border-radius:50%;transition:.15s}
  .ls-toggle:checked::after{left:18px}
  #ls-dl-wrap{width:100%;margin-bottom:10px;display:none}
  #ls-dl-label{font-size:11px;color:#aaa;margin-bottom:3px}
  #ls-dl-track{width:100%;height:4px;background:#333;border-radius:2px;overflow:hidden}
  #ls-dl-bar{height:100%;background:linear-gradient(90deg,#FFB300,#FF8F00);width:0%;transition:width .3s}
  #ls-top-dl{position:absolute;top:0;left:0;right:0;height:3px;background:rgba(0,0,0,0.3);z-index:70;pointer-events:none;display:none;transition:opacity .4s ease}
  #ls-top-dl-bar{height:100%;width:0%;background:linear-gradient(90deg,#FFB300,#FF8F00);box-shadow:0 0 8px #FFB300;transition:width .25s ease}
  #ls-preview-box{margin:8px 0;padding:6px 10px;background:#111;border:1px dashed #444;border-radius:6px;
    text-align:center;min-height:32px;display:flex;align-items:center;justify-content:center;
    overflow:hidden;max-width:100%;box-sizing:border-box}
  #ls-preview-sample{display:inline-block;padding:2px 8px;border-radius:4px;
    font-family:'YouTube Noto',Roboto,Arial,sans-serif;white-space:nowrap;line-height:1.3;
    font-size:15px;max-width:100%;overflow:hidden;text-overflow:ellipsis}
  #ls-panel .ls-sep{border:none;border-top:1px solid #333;margin:10px 0}
  #ls-panel label{display:flex;justify-content:space-between;align-items:center;margin:6px 0;gap:8px;font-size:12px}
  .ls-slider-row{display:flex;align-items:center;gap:8px}
  .ls-val{font-size:11px;color:#FFB300;min-width:32px;text-align:right;font-variant-numeric:tabular-nums}
  #ls-panel select{width:140px;background:#222;color:#eee;border:1px solid #444;border-radius:4px;padding:3px 6px;font-size:12px}
  #ls-panel input[type=range]{width:100px;accent-color:#FFB300}
  #ls-panel input[type=color]{width:36px;height:22px;padding:0;border:1px solid #444;border-radius:4px;background:#222;cursor:pointer}
  #ls-btn svg{padding:8px;box-sizing:border-box}
  #ls-win{visibility:visible!important;text-align:center;width:100%}
  #ls-sub{display:inline-block;padding:3px 12px;border-radius:4px;font-family:'YouTube Noto',Roboto,Arial,sans-serif;
    white-space:nowrap;line-height:1.4;max-width:92%;box-sizing:border-box;overflow:hidden;text-overflow:ellipsis}
  .ls-adv-hdr{display:flex;justify-content:space-between;align-items:center;cursor:pointer;color:#aaa;font-size:12px;user-select:none;padding:6px 0}
  .ls-adv-hdr:hover{color:#fff}
  #ls-adv-body{padding-top:6px;display:none}
  .ls-btn-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px}
  .ls-act-btn{background:#252525;color:#ddd;border:1px solid #444;border-radius:6px;padding:6px 8px;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;transition:background .15s}
  .ls-act-btn:hover{background:#353535;color:#fff}
  .ls-act-btn:active{transform:scale(0.97)}
  `;

  // ---- Inline SVG for the player-bar button ----
  const BTN_SVG = `<svg viewBox="0 0 128 128" width="100%" height="100%">
    <rect width="128" height="128" rx="28" fill="#FFB300"/>
    <path d="M30 35h45v35H60l-10 10V70H30z" fill="#fff"/>
    <text x="52" y="58" font-family="sans-serif" font-weight="bold" font-size="22" fill="#333" text-anchor="middle">字</text>
    <path d="M50 60h48v35H83l-10 10V95H50z" fill="#222"/>
    <text x="74" y="83" font-family="sans-serif" font-weight="bold" font-size="20" fill="#fff" text-anchor="middle">A</text>
  </svg>`;

  const el = {};

  function styleSub(span) {
    if (!span) return;
    span.style.fontSize = cfg.subFont + 'px';
    span.style.color = cfg.subColor || '#fff';
    span.style.background = 'rgba(0,0,0,' + (cfg.subBg / 100).toFixed(2) + ')';
    const e = Number(cfg.subEdge) || 0;
    if (e > 0) {
      span.style.webkitTextStroke = `${e * 1.5}px #000`;
      span.style.paintOrder = 'stroke fill';
      span.style.textShadow = '0 2px 4px rgba(0,0,0,0.85)';
    } else {
      span.style.webkitTextStroke = '0px transparent';
      span.style.paintOrder = 'normal';
      span.style.textShadow = 'none';
    }
  }

  function updatePreview() {
    if (!el.panel) return;
    const sample = el.panel.querySelector('#ls-preview-sample');
    if (sample) {
      sample.style.color = cfg.subColor || '#fff';
      sample.style.background = 'rgba(0,0,0,' + (cfg.subBg / 100).toFixed(2) + ')';
      const e = Number(cfg.subEdge) || 0;
      if (e > 0) {
        sample.style.webkitTextStroke = `${e}px #000`;
        sample.style.paintOrder = 'stroke fill';
        sample.style.textShadow = '0 2px 4px rgba(0,0,0,0.85)';
      } else {
        sample.style.webkitTextStroke = '0px transparent';
        sample.style.paintOrder = 'normal';
        sample.style.textShadow = 'none';
      }
    }
    const vSize = el.panel.querySelector('#ls-val-size');
    const vBg = el.panel.querySelector('#ls-val-bg');
    const vEdge = el.panel.querySelector('#ls-val-edge');
    if (vSize) vSize.textContent = cfg.subFont + 'px';
    if (vBg) vBg.textContent = cfg.subBg + '%';
    if (vEdge) vEdge.textContent = cfg.subEdge ? cfg.subEdge + 'px' : 'Off';
  }

  // ---- UI creation ----
  function createUI() {
    const p = player();
    if (!p) return;

    // Inject global style
    if (!document.getElementById('ls-css')) {
      const s = document.createElement('style');
      s.id = 'ls-css'; s.textContent = CSS;
      document.head.appendChild(s);
    }

    // Top-of-player ambient download line
    if (!p.querySelector('#ls-top-dl')) {
      const topDl = document.createElement('div');
      topDl.id = 'ls-top-dl';
      topDl.innerHTML = '<div id="ls-top-dl-bar"></div>';
      p.appendChild(topDl);
    }

    // Panel
    if (!el.panel || !p.contains(el.panel)) {
      el.panel = document.createElement('div');
      el.panel.id = 'ls-panel';
      el.panel.innerHTML = `
        <div class="ls-hdr">
          <div class="ls-hdr-left">
            <span class="ls-title">LiveSubs</span>
            <span class="ls-chip"><span class="ls-dot" id="ls-dot"></span> <span id="ls-chip-text">Offline</span></span>
          </div>
          <div class="ls-hdr-right">
            <button id="ls-btn-connect" class="ls-btn-connect" title="Connect now">⚡ Connect</button>
            <input type="checkbox" class="ls-toggle" id="ls-en">
          </div>
        </div>

        <div id="ls-dl-wrap">
          <div id="ls-dl-label">Downloading audio…</div>
          <div id="ls-dl-track"><div id="ls-dl-bar"></div></div>
        </div>

        <div id="ls-preview-box">
          <span id="ls-preview-sample">LiveSubs Preview</span>
        </div>

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
        <label>Size <div class="ls-slider-row"><input type="range" id="ls-size" min="14" max="48" step="1"><span id="ls-val-size" class="ls-val">24px</span></div></label>
        <label>Background <div class="ls-slider-row"><input type="range" id="ls-bg" min="0" max="90" step="5"><span id="ls-val-bg" class="ls-val">75%</span></div></label>
        <label>Text edge <div class="ls-slider-row"><input type="range" id="ls-edge" min="0" max="3" step="1"><span id="ls-val-edge" class="ls-val">2px</span></div></label>

        <hr class="ls-sep">
        <div class="ls-adv-hdr" id="ls-adv-toggle">
          <span>Advanced Tools</span> <span id="ls-adv-arrow">▸</span>
        </div>
        <div id="ls-adv-body">
          <div class="ls-btn-grid">
            <button id="ls-btn-refresh-sub" class="ls-act-btn" title="Re-fetch subtitles for current minute">🔄 Retry Subs</button>
            <button id="ls-btn-export" class="ls-act-btn" title="Download all subtitles as .SRT">🎬 Export .SRT</button>
          </div>
          <label>Ahead buffer <select id="ls-lookahead">
            <option value="180">3 min (minimum)</option>
            <option value="300">5 min (default)</option>
            <option value="480">8 min</option>
            <option value="600">10 min</option>
            <option value="900">15 min (maximum)</option>
          </select></label>
          <label>GPU cooldown <select id="ls-cooldown">
            <option value="0">0s (max speed)</option>
            <option value="5">5s (balanced, default)</option>
            <option value="10">10s (cool GPU)</option>
          </select></label>
          <label>Batch size <select id="ls-batch">
            <option value="8">8 lines (accurate)</option>
            <option value="12">12 lines (default)</option>
            <option value="16">16 lines</option>
          </select></label>
        </div>
      `;

      // Stop events from reaching YouTube player
      ['click','dblclick','mousedown','keydown','keyup','wheel','contextmenu'].forEach(ev =>
        el.panel.addEventListener(ev, e => e.stopPropagation()));

      // Bind controls
      const $ = id => el.panel.querySelector('#' + id);
      const enCb = $('ls-en');
      const presetSel = $('ls-preset');
      const sizeSl = $('ls-size');
      const bgSl = $('ls-bg');
      const edgeSl = $('ls-edge');
      const colorSel = $('ls-color');
      const lookaheadSel = $('ls-lookahead');
      const cooldownSel = $('ls-cooldown');
      const batchSel = $('ls-batch');
      const btnConnect = $('ls-btn-connect');
      const advToggle = $('ls-adv-toggle');
      const advBody = $('ls-adv-body');
      const advArrow = $('ls-adv-arrow');
      const btnRefresh = $('ls-btn-refresh-sub');
      const btnExport = $('ls-btn-export');

      enCb.checked = cfg.enabled;
      sizeSl.value = cfg.subFont;
      bgSl.value = cfg.subBg;
      edgeSl.value = cfg.subEdge;
      colorSel.value = cfg.subColor;
      if (lookaheadSel) lookaheadSel.value = String(cfg.lookahead || 300);
      if (cooldownSel) cooldownSel.value = String(cfg.cooldown !== undefined ? cfg.cooldown : 5);
      if (batchSel) batchSel.value = String(cfg.batchSize || 12);

      updatePreview();

      enCb.onchange = () => {
        cfg.enabled = enCb.checked;
        chrome.storage.local.set({ enabled: cfg.enabled });
        if (cfg.enabled && !online) connect();
        if (!cfg.enabled) { online = false; hideSub(); }
      };

      if (btnConnect) {
        btnConnect.onclick = () => {
          btnConnect.textContent = 'Connecting…';
          connect();
        };
      }

      presetSel.onchange = () => {
        const pr = PRESETS[presetSel.value]; if (!pr) return;
        cfg.subFont = pr.f; cfg.subBg = pr.b; cfg.subEdge = pr.e; cfg.subColor = pr.c;
        sizeSl.value = pr.f; bgSl.value = pr.b; edgeSl.value = pr.e; colorSel.value = pr.c;
        updatePreview();
        chrome.storage.local.set({ subFont: pr.f, subBg: pr.b, subEdge: pr.e, subColor: pr.c });
      };

      const bind = (key, input, parse) => {
        input.oninput = () => {
          cfg[key] = parse(input.value);
          presetSel.value = '';
          updatePreview();
        };
        input.onchange = () => chrome.storage.local.set({ [key]: cfg[key] });
      };
      bind('subFont', sizeSl, Number);
      bind('subBg', bgSl, Number);
      bind('subEdge', edgeSl, Number);
      bind('subColor', colorSel, String);

      if (lookaheadSel) {
        lookaheadSel.onchange = () => {
          cfg.lookahead = Number(lookaheadSel.value);
          chrome.storage.local.set({ lookahead: cfg.lookahead });
        };
      }

      if (cooldownSel) {
        cooldownSel.onchange = () => {
          cfg.cooldown = Number(cooldownSel.value);
          chrome.storage.local.set({ cooldown: cfg.cooldown });
          api('/config?cooldown=' + cfg.cooldown);
        };
      }

      if (batchSel) {
        batchSel.onchange = () => {
          cfg.batchSize = Number(batchSel.value);
          chrome.storage.local.set({ batchSize: cfg.batchSize });
          api('/config?batch_size=' + cfg.batchSize);
        };
      }

      // Advanced collapsible toggle
      let advOpen = false;
      advToggle.onclick = () => {
        advOpen = !advOpen;
        advBody.style.display = advOpen ? 'block' : 'none';
        advArrow.textContent = advOpen ? '▾' : '▸';
      };

      // One-click retry current minute's subs
      if (btnRefresh) {
        btnRefresh.onclick = async () => {
          const v = video(); if (!v || !vid) return;
          const cur = Math.floor(v.currentTime / BLOCK);
          blocks.delete(cur);
          btnRefresh.textContent = 'Resetting…';
          await api('/retry?v=' + vid + '&i=' + cur);
          nextTry = 0;
          setTimeout(() => { btnRefresh.textContent = '🔄 Retry Subs'; }, 800);
        };
      }

      // One-click export subtitles (.srt)
      if (btnExport) {
        btnExport.onclick = () => {
          if (!vid) return;
          const cleanTitle = encodeURIComponent(document.title.replace(/ - YouTube$/, '').trim());
          const a = document.createElement('a');
          a.href = 'http://127.0.0.1:8765/export?v=' + vid + '&title=' + cleanTitle;
          document.body.appendChild(a);
          a.click();
          a.remove();
        };
      }

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

    ensureSub();
  }

  // ---- Subtitle DOM element ----
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
    if (!p.querySelector('#ls-win')) ensureSub();
  }

  // ---- Backend connection ----
  let lastConnectTry = 0;
  async function connect() {
    lastConnectTry = Date.now();
    const r = await api('/health');
    online = !r.error && r.ok === true;
    if (online) {
      nextTry = 0;
      elog('backend connected');
      if (cfg.cooldown !== undefined || cfg.batchSize !== undefined) {
        api(`/config?cooldown=${cfg.cooldown !== undefined ? cfg.cooldown : 5}&batch_size=${cfg.batchSize || 12}`);
      }
    } else {
      elog('backend unreachable');
    }
    updateStatus();
  }

  // ---- Status chip & progress indicators ----
  function updateStatus() {
    if (!el.panel) return;
    const dot = el.panel.querySelector('#ls-dot');
    const chipText = el.panel.querySelector('#ls-chip-text');
    const btnConnect = el.panel.querySelector('#ls-btn-connect');
    let cls = '', txt = '';

    if (!online) {
      cls = 'ls-dot red';
      txt = 'Offline';
      if (btnConnect) {
        btnConnect.style.display = 'inline-flex';
        btnConnect.textContent = '⚡ Connect';
      }
    } else if (dlPct >= 0 && dlPct < 100) {
      cls = 'ls-dot amber';
      txt = 'Audio ' + Math.round(dlPct) + '%';
      if (btnConnect) btnConnect.style.display = 'none';
    } else {
      if (btnConnect) btnConnect.style.display = 'none';
      const v = video();
      if (v) {
        const cur = Math.floor(v.currentTime / BLOCK);
        const allReady = [cur, cur + 1].every(i => blocks.has(i));
        cls = allReady ? 'ls-dot green' : 'ls-dot amber';
        txt = allReady ? 'Ready' : `Buffering min ${cur + 1}`;
      } else {
        cls = 'ls-dot green';
        txt = 'Connected';
      }
    }
    if (dot) dot.className = cls;
    if (chipText) chipText.textContent = txt;

    // Panel download bar
    const wrap = el.panel.querySelector('#ls-dl-wrap');
    const bar = el.panel.querySelector('#ls-dl-bar');
    const lbl = el.panel.querySelector('#ls-dl-label');
    if (wrap && bar) {
      if (dlPct >= 0 && dlPct < 100) {
        wrap.style.display = 'block';
        bar.style.width = dlPct.toFixed(1) + '%';
        if (lbl) lbl.textContent = 'Downloading audio… ' + Math.round(dlPct) + '%';
      } else {
        wrap.style.display = 'none';
      }
    }

    // Top-of-player ambient download bar
    const p = player();
    const topWrap = p && p.querySelector('#ls-top-dl');
    const topBar = topWrap && topWrap.querySelector('#ls-top-dl-bar');
    if (topWrap && topBar) {
      if (dlPct >= 0 && dlPct < 100) {
        topWrap.style.display = 'block';
        topWrap.style.opacity = '1';
        topBar.style.width = dlPct.toFixed(1) + '%';
      } else {
        topWrap.style.opacity = '0';
        setTimeout(() => { if (dlPct < 0 || dlPct >= 100) topWrap.style.display = 'none'; }, 400);
      }
    }
  }

  // ---- Polling for blocks & active heartbeat ----
  async function tick() {
    const v = video();
    if (!cfg.enabled || !online || !v || !vid || busy || !isFinite(v.duration)) return;

    const t = v.currentTime, cur = Math.floor(t / BLOCK);

    // Detect seek jump: clear queue tracking so new playhead position takes immediate priority
    const seeked = lastHbCur >= 0 && Math.abs(cur - lastHbCur) >= 2;
    if (seeked) {
      queuedBlocks.clear();
    }

    // Send active heartbeat with current playhead every 6s, or immediately on seek
    if ((!v.paused && Date.now() - lastHb > 6000) || seeked) {
      lastHb = Date.now();
      lastHbCur = cur;
      api('/heartbeat?v=' + vid + '&cur=' + cur);
    }

    const last = Math.min(Math.floor(v.duration / BLOCK), Math.floor((t + (cfg.lookahead || 300)) / BLOCK));

    // Find all missing blocks in the lookahead buffer window
    const missing = [];
    for (let i = cur; i <= last; i++) {
      if (!blocks.has(i)) missing.push(i);
    }
    if (!missing.length) return;

    // STEP 1: URGENT PRIORITY — Request & poll the current watching block FIRST!
    const want = missing[0];
    if (Date.now() < nextTry) return;
    busy = true;
    const forVid = vid;
    const r = await api('/block?v=' + vid + '&i=' + want + '&cur=' + cur);
    busy = false;
    if (forVid !== vid) return;
    if (r.error) { online = false; elog('block ' + forVid + ':' + want + ' error: ' + r.error); return; }
    if (r.state === 'ready') {
      blocks.set(want, r.cues);
      queuedBlocks.delete(want);
      dlPct = -1;
      elog('block ' + want + ' ready (' + r.cues.length + ' cues)');
    }
    else if (r.state === 'downloading') { dlPct = r.progress || 0; nextTry = Date.now() + 2000; }
    else if (r.state === 'error') { nextTry = Date.now() + 10000; elog('block ' + forVid + ':' + want + ' failed: ' + (r.msg || '')); }
    else { nextTry = Date.now() + 600; }

    // STEP 2: LOOKAHEAD BUFFER — Pre-queue future missing blocks in sequential order (cur+1, cur+2...)
    // Automatically re-ping every 35s if a block has been waiting so the queue never goes cold
    const nowMs = Date.now();
    for (let j = 1; j < missing.length; j++) {
      const fb = missing[j];
      const lastSent = queuedBlocks.get(fb) || 0;
      if (nowMs - lastSent > 35000) {
        queuedBlocks.set(fb, nowMs);
        api('/block?v=' + vid + '&i=' + fb + '&cur=' + cur);
      }
    }
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
    // Show subtitle: strictly single clean line
    span.replaceChildren();
    const singleLineText = text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
    span.appendChild(document.createTextNode(singleLineText));
    styleSub(span);
    span.parentElement.style.display = 'block';
  }

  function hideSub() {
    const p = player(); if (!p) return;
    const win = p.querySelector('#ls-win');
    if (win) win.style.display = 'none';
    lastShownText = '';
  }

  // ---- Yellow seek-bar markers ----
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

  // ---- Update chrome ----
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
    queuedBlocks.clear();
    busy = false;
    nextTry = 0;
    dlPct = -1;
    lastHb = 0;
    lastShownText = '';
    elog('nav: vid=' + vid);
  }

  function applyCfg(s) {
    const was = cfg.enabled;
    cfg.enabled = s.enabled;
    cfg.lookahead = s.lookahead || 300;
    cfg.cooldown = s.cooldown !== undefined ? s.cooldown : 5;
    cfg.batchSize = s.batchSize || 12;
    cfg.subFont = s.subFont; cfg.subBg = s.subBg; cfg.subEdge = s.subEdge; cfg.subColor = s.subColor;
    if (el.panel) {
      const enCb = el.panel.querySelector('#ls-en');
      if (enCb) enCb.checked = cfg.enabled;
      updatePreview();
    }
    if (cfg.enabled && !was) { elog('enabled'); connect(); }
    if (!cfg.enabled && was) { online = false; hideSub(); }
  }

  // ---- Init ----
  chrome.storage.local.get({ enabled: false, lookahead: 300, cooldown: 5, batchSize: 12, subFont: 24, subBg: 75, subEdge: 2, subColor: '#ffffff' }, s => {
    elog('init: enabled=' + s.enabled);
    applyCfg(s);
    onNav();
  });
  chrome.storage.onChanged.addListener(() => {
    chrome.storage.local.get({ enabled: false, lookahead: 300, cooldown: 5, batchSize: 12, subFont: 24, subBg: 75, subEdge: 2, subColor: '#ffffff' }, s => applyCfg(s));
  });

  document.addEventListener('yt-navigate-finish', onNav);
  setInterval(tick, 500);
  setInterval(render, 100);
  setInterval(paintChrome, 250);
  setInterval(ensureUI, 1000);
})();
