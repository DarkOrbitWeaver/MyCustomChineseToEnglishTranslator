// Content scripts can't reliably hit localhost from an https page, so we proxy through here.
chrome.runtime.onMessage.addListener((m, _sender, send) => {
  fetch("http://127.0.0.1:8765" + m.path, { signal: AbortSignal.timeout(15000) })
    .then(r => r.json())
    .then(send)
    .catch(e => { console.warn("[LiveSubs] backend request failed:", String(e)); send({ error: String(e) }); });
  return true;
});
