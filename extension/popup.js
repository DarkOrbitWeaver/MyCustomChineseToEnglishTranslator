const on = document.getElementById("on"), ahead = document.getElementById("ahead"),
  size = document.getElementById("size"), bg = document.getElementById("bg"), edge = document.getElementById("edge"),
  color = document.getElementById("color"), preset = document.getElementById("preset");
const presets = {
  default: { f: 24, b: 75, e: 2, c: "#ffffff" },
  cinema: { f: 32, b: 85, e: 3, c: "#ffffff" },
  bright: { f: 24, b: 75, e: 2, c: "#ffe600" },
  minimal: { f: 20, b: 0, e: 1, c: "#ffffff" }
};
chrome.storage.local.get({ enabled: false, lookahead: 300, subFont: 24, subBg: 75, subEdge: 2, subColor: "#ffffff" }, s => {
  on.checked = s.enabled; ahead.value = String(s.lookahead);
  size.value = s.subFont; bg.value = s.subBg; edge.value = s.subEdge; color.value = s.subColor;
});
on.onchange = () => chrome.storage.local.set({ enabled: on.checked });
ahead.onchange = () => chrome.storage.local.set({ lookahead: Number(ahead.value) });
size.onchange = () => chrome.storage.local.set({ subFont: Number(size.value) });
bg.onchange = () => chrome.storage.local.set({ subBg: Number(bg.value) });
edge.onchange = () => chrome.storage.local.set({ subEdge: Number(edge.value) });
color.onchange = () => chrome.storage.local.set({ subColor: color.value });
preset.onchange = () => {
  const pr = presets[preset.value]; if (!pr) return;
  chrome.storage.local.set({ subFont: pr.f, subBg: pr.b, subEdge: pr.e, subColor: pr.c });
  size.value = pr.f; bg.value = pr.b; edge.value = pr.e; color.value = pr.c;
};
document.getElementById("retry").onclick = () => chrome.storage.local.set({ nonce: Date.now() });
