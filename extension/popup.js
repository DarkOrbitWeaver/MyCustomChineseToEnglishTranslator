const on = document.getElementById("on"), ahead = document.getElementById("ahead");
chrome.storage.local.get({ enabled: false, lookahead: 300 }, s => {
  on.checked = s.enabled; ahead.value = String(s.lookahead);
});
on.onchange = () => chrome.storage.local.set({ enabled: on.checked });
ahead.onchange = () => chrome.storage.local.set({ lookahead: Number(ahead.value) });
document.getElementById("retry").onclick = () => chrome.storage.local.set({ nonce: Date.now() });
