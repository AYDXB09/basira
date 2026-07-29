/* ============================================================================
 * app.js — orb states, two-line conversation, mic status, zero-touch boot.
 * Loads LAST. The app SPEAKS FIRST on load; if autoplay is blocked, the
 * first key/tap wakes it.
 * ========================================================================== */
(function () {

  const STATUS_LABEL = {
    off: 'asleep', idle: 'ready', listening: 'listening',
    thinking: 'thinking', speaking: 'speaking'
  };

  function state(s) {
    ORB.setState(s);
    const el = document.getElementById('statusText');
    if (el && STATUS_LABEL[s]) el.textContent = STATUS_LABEL[s];
  }

  function caption(who, text) {
    const t = String(text);
    const u = document.getElementById('line-user');
    const a = document.getElementById('line-tutor');
    if (!u || !a) return;
    if (who === 'user') {
      u.textContent = t;
    } else {
      a.textContent = t;
    }
  }

  function mic(s) { // waiting | on | blocked
    const dot = document.getElementById('micdot');
    if (dot) dot.className = s;
    const label = { waiting: 'allow the mic…', on: 'listening', blocked: 'mic blocked' }[s];
    if (label) {
      const st = document.getElementById('statusText');
      if (st) st.textContent = label;
    }
  }

  function hint() {}

  function showKeyGate(msg) {
    const gate = document.getElementById('keygate');
    gate.hidden = false;
    gate.classList.add('open');
    const err = document.getElementById('kgErr');
    if (msg && err) { err.hidden = false; err.textContent = msg; }
    document.getElementById('statusText').textContent = 'needs API key';
  }

  function hideKeyGate() {
    const gate = document.getElementById('keygate');
    gate.hidden = true;
    gate.classList.remove('open');
  }

  let booted = false;
  async function tryBoot() {
    if (booted) return;

    // refresh key from localStorage every boot attempt
    try {
      const k = localStorage.getItem('basira.openRouterKey');
      if (k) window.B_CONFIG.openRouterKey = k;
    } catch (_) {}

    if (!window.B_CONFIG.openRouterKey) {
      // never re-show / re-speak the gate while it's already open
      const gate = document.getElementById('keygate');
      if (gate && gate.classList.contains('open')) return;
      showKeyGate('');
      caption('assistant', 'Paste your OpenRouter API key, then press Save & start.');
      try { TTS.speak('Paste your Open Router key, then press Save and start.'); } catch (_) {}
      setTimeout(() => { try { document.getElementById('kgInput').focus(); } catch (_) {} }, 50);
      return;
    }

    hideKeyGate();
    booted = true;
    try { await ASSIST.boot(); }
    catch (e) { console.error('boot failed', e); booted = false; }
  }

  function saveKey() {
    const input = document.getElementById('kgInput');
    const err = document.getElementById('kgErr');
    let v = (input.value || '').trim();
    // strip quotes / Bearer prefix people paste by accident
    v = v.replace(/^["']|["']$/g, '').replace(/^Bearer\s+/i, '').trim();

    if (!v) {
      err.hidden = false;
      err.textContent = 'Paste a key first.';
      input.focus();
      return;
    }
    if (v.length < 20) {
      err.hidden = false;
      err.textContent = 'That looks too short for an OpenRouter key.';
      return;
    }
    // accept sk-or-… or any plausible openrouter-style key
    if (!/^sk[-_]/i.test(v)) {
      err.hidden = false;
      err.textContent = 'Key should start with sk- (OpenRouter keys look like sk-or-v1-…).';
      return;
    }

    try {
      localStorage.setItem('basira.openRouterKey', v);
    } catch (e) {
      err.hidden = false;
      err.textContent = 'Browser blocked saving (private mode?). Allow site data and try again.';
      return;
    }

    window.B_CONFIG.openRouterKey = v;
    err.hidden = false;
    err.style.color = '#34d399';
    err.textContent = 'Saved. Starting…';
    hideKeyGate();
    // boot immediately — no reload required
    booted = false;
    tryBoot();
  }

  window.addEventListener('load', () => {
    state('off');

    // If no key yet, show the paste box immediately (critical for GitHub Pages teammates)
    try {
      const k = localStorage.getItem('basira.openRouterKey');
      if (k) window.B_CONFIG.openRouterKey = k;
    } catch (_) {}
    if (!window.B_CONFIG.openRouterKey) {
      showKeyGate('');
      caption('assistant', 'Paste your OpenRouter API key, then press Save & start.');
    }

    // wire Save FIRST so it always works even if boot path is slow
    const saveBtn = document.getElementById('kgSave');
    const input = document.getElementById('kgInput');
    saveBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); saveKey(); });
    saveBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveKey(); }
    });
    document.getElementById('keygate').addEventListener('pointerdown', (e) => e.stopPropagation());

    const clearBtn = document.getElementById('kgClear');
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        try { localStorage.removeItem('basira.openRouterKey'); } catch (_) {}
        window.B_CONFIG.openRouterKey = '';
        booted = false;
        input.value = '';
        showKeyGate('Key cleared. Paste a new one.');
      });
    }

    // Key button in the bar — always open the paste box
    const btnKey = document.getElementById('btnKey');
    if (btnKey) {
      btnKey.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        booted = false;
        try {
          const k = localStorage.getItem('basira.openRouterKey') || '';
          input.value = k;
        } catch (_) {}
        showKeyGate('');
        setTimeout(() => input.focus(), 50);
      });
    }

    // ZERO-TOUCH boot (only when a key already exists)
    const probe = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=');
    probe.play().then(() => tryBoot()).catch(() => {
      if (window.B_CONFIG.openRouterKey) {
        document.getElementById('statusText').textContent = 'tap or press any key';
        caption('assistant', 'Tap anywhere or press any key once to wake me.');
      }
      const wake = (e) => {
        if (e && e.target && e.target.closest && e.target.closest('#keygate')) return;
        tryBoot();
      };
      document.addEventListener('pointerdown', wake);
      document.addEventListener('keydown', wake);
    });

    document.getElementById('btnCam').addEventListener('pointerdown', () => ASSIST.toggleCamera());
    document.getElementById('camClose').addEventListener('pointerdown', () => ASSIST.closeCamera());
    document.getElementById('btnUpload').addEventListener('pointerdown', () => {
      document.getElementById('fileInput').click();
    });
    document.getElementById('fileInput').addEventListener('change', (e) => ASSIST.onFiles(e.target.files));

    // telemetry export: button + D key
    const btnData = document.getElementById('btnData');
    if (btnData) btnData.addEventListener('pointerdown', () => TELEM.download());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'd' || e.key === 'D') {
        if (!/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) TELEM.download();
      }
    });
  });

  window.APP = { state, caption, hint, mic, tryBoot, saveKey };
})();
