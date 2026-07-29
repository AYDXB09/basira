chrome.runtime.sendMessage('status', (res) => {
  const dot = document.getElementById('dot');
  const status = document.getElementById('status');
  if (chrome.runtime.lastError || !res) {
    status.textContent = 'wake the worker — click the icon again';
    dot.className = 'dot off';
    return;
  }
  const s = res.status || 'unknown';
  status.textContent = s;
  dot.className = 'dot ' + (s === 'bridge-offline' ? 'off' : 'on');
});

// also poke bridge directly
fetch('http://127.0.0.1:8790/ping').then(r => r.json()).then(() => {
  const status = document.getElementById('status');
  if (status.textContent === 'bridge-offline') status.textContent = 'bridge online — waiting for jobs';
  document.getElementById('dot').className = 'dot on';
}).catch(() => {
  document.getElementById('status').textContent = 'bridge offline — run basira bridge';
  document.getElementById('dot').className = 'dot off';
});
