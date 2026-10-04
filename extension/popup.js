const on = document.getElementById('on');
const st = document.getElementById('st');
const stText = document.getElementById('st-text');
const btnConn = document.getElementById('btn-conn');

chrome.storage.local.get({ enabled: false }, s => { on.checked = s.enabled; });
on.onchange = () => chrome.storage.local.set({ enabled: on.checked });

function checkHealth() {
  stText.textContent = 'Checking…';
  chrome.runtime.sendMessage({ path: '/health' }, r => {
    if (r && r.ok) {
      st.className = 'dot ok';
      stText.textContent = 'Connected';
      st.title = 'ASR: ' + (r.asr || '?') + ', LLM: ' + (r.llm || '?');
      btnConn.style.display = 'none';
    } else {
      st.className = 'dot err';
      stText.textContent = 'Offline';
      st.title = 'Offline — start the server';
      btnConn.style.display = 'flex';
      btnConn.textContent = '⚡ Connect to Backend';
    }
  });
}

btnConn.onclick = () => {
  btnConn.textContent = 'Connecting…';
  checkHealth();
};

checkHealth();
