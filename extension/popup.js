function renderStatus(res) {
  const dot = document.getElementById('dot');
  const status = document.getElementById('status');
  if (!res) {
    status.textContent = 'worker did not answer';
    dot.className = 'dot off';
    return;
  }
  const s = res.status || 'unknown';
  status.textContent = s;
  dot.className = 'dot ' + (s === 'bridge-offline' ? 'off' : 'on');
}

// Restart long-poll if worker was offline / suspended
chrome.runtime.sendMessage('start', (res) => {
  if (!chrome.runtime.lastError) renderStatus(res);
});

chrome.runtime.sendMessage('status', (res) => {
  if (chrome.runtime.lastError) return renderStatus(null);
  renderStatus(res);
});

document.getElementById('start').addEventListener('click', () => {
  chrome.runtime.sendMessage('start', (res) => renderStatus(res));
});

fetch('http://127.0.0.1:8790/ping').then(r => r.json()).then(() => {
  const status = document.getElementById('status');
  if (status.textContent === 'bridge-offline') status.textContent = 'bridge online — waiting for jobs';
  document.getElementById('dot').className = 'dot on';
}).catch(() => {
  document.getElementById('status').textContent = 'bridge offline — run basira bridge';
  document.getElementById('dot').className = 'dot off';
});
