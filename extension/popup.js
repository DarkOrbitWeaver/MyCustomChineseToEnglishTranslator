const on = document.getElementById("on"), ahead = document.getElementById("ahead"),
  size = document.getElementById("size"), bg = document.getElementById("bg"), edge = document.getElementById("edge");
chrome.storage.local.get({ enabled: false, lookahead: 300, subFont: 24, subBg: 75, subEdge: 2 }, s => {
  on.checked = s.enabled; ahead.value = String(s.lookahead);
  size.value = s.subFont; bg.value = s.subBg; edge.value = s.subEdge;
});
on.onchange = () => chrome.storage.local.set({ enabled: on.checked });
ahead.onchange = () => chrome.storage.local.set({ lookahead: Number(ahead.value) });
size.onchange = () => chrome.storage.local.set({ subFont: Number(size.value) });
bg.onchange = () => chrome.storage.local.set({ subBg: Number(bg.value) });
edge.onchange = () => chrome.storage.local.set({ subEdge: Number(edge.value) });
document.getElementById("retry").onclick = () => chrome.storage.local.set({ nonce: Date.now() });
