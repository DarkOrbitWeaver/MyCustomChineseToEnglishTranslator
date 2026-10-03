const on = document.getElementById('on');
const st = document.getElementById('st');

chrome.storage.local.get({ enabled: false }, s => { on.checked = s.enabled; });
on.onchange = () => chrome.storage.local.set({ enabled: on.checked });

// Check backend health
chrome.runtime.sendMessage({ path: '/health' }, r => {
  if (r && r.ok) {
    st.className = 'dot ok';
    st.title = 'Connected — ASR: ' + (r.asr || '?') + ', LLM: ' + (r.llm || '?');
  } else {
    st.className = 'dot err';
    st.title = 'Offline — start the server';
  }
});
