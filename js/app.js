/* ============================================================================
 * app.js — orb states, captions, zero-touch boot, prompt editor (demo).
 * No text chat UI. Language follows speech automatically.
 * ========================================================================== */
(function () {

  const STATUS_LABEL = {
    off: 'asleep', idle: 'ready', listening: 'listening',
    thinking: 'thinking', speaking: 'speaking'
  };

  function state(s) {
    if (window.ORB) ORB.setState(s);
    const el = document.getElementById('statusText');
    if (el && STATUS_LABEL[s]) el.textContent = STATUS_LABEL[s];
  }

  function caption(who, text) {
    const t = String(text);
    const u = document.getElementById('line-user');
    const a = document.getElementById('line-tutor');
    if (!u || !a) return;
    if (who === 'user') u.textContent = t;
    else a.textContent = t;
  }

  function mic(s) {
    const dot = document.getElementById('micdot');
    if (dot) dot.className = s;
    const label = {
      waiting: 'allow the mic…', reconnecting: 'reconnecting…',
      on: 'listening', muted: 'mic muted', blocked: 'mic blocked'
    }[s];
    if (label) {
      const st = document.getElementById('statusText');
      if (st) st.textContent = label;
    }
  }

  function hint() {}

  function setLanguage(id) {
    const meta = window.PED && PED.LANGS.find(l => l.id === id);
    if (!meta) return;
    document.documentElement.lang = id;
    const rtl = id === 'ar' || id === 'ur';
    const convo = document.getElementById('convo');
    if (convo) {
      convo.dir = rtl ? 'rtl' : 'ltr';
      convo.style.textAlign = rtl ? 'right' : 'center';
    }
  }

  function showKeyGate(msg) {
    const gate = document.getElementById('keygate');
    if (!gate) return;
    gate.hidden = false;
    gate.classList.add('open');
    const err = document.getElementById('kgErr');
    if (msg && err) { err.hidden = false; err.textContent = msg; }
    const st = document.getElementById('statusText');
    if (st) st.textContent = 'needs API key';
  }

  function hideKeyGate() {
    const gate = document.getElementById('keygate');
    if (!gate) return;
    gate.hidden = true;
    gate.classList.remove('open');
  }

  function openPromptEditor() {
    const gate = document.getElementById('promptGate');
    const ta = document.getElementById('pgInput');
    const note = document.getElementById('pgNote');
    if (!gate || !ta || !window.PED) return;
    ta.value = PED.getTemplate();
    note.textContent = PED.hasCustomPrompt
      ? 'Custom prompt is active (saved in this browser).'
      : 'Showing default prompt. Use {{LANG}} where the language name should go.';
    gate.hidden = false;
    gate.classList.add('open');
    setTimeout(() => ta.focus(), 50);
  }

  function closePromptEditor() {
    const gate = document.getElementById('promptGate');
    if (!gate) return;
    gate.hidden = true;
    gate.classList.remove('open');
  }

  function savePromptEditor() {
    const ta = document.getElementById('pgInput');
    const note = document.getElementById('pgNote');
    if (!ta || !window.PED) return;
    PED.setCustomTemplate(ta.value);
    note.textContent = 'Saved. Next reply will use this prompt.';
    note.style.color = '#34d399';
  }

  function resetPromptEditor() {
    const ta = document.getElementById('pgInput');
    const note = document.getElementById('pgNote');
    if (!ta || !window.PED) return;
    ta.value = PED.resetCustomTemplate();
    note.textContent = 'Reset to default prompt.';
    note.style.color = '#a78bfa';
  }

  let booted = false;
  let bootAttempts = 0;

  function keepResuming() {
    try {
      const ctx = window.EARCON && EARCON._ctx;
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().then(() => {
          if (ctx.state === 'suspended') setTimeout(keepResuming, 300);
        }).catch(() => setTimeout(keepResuming, 500));
      } else {
        setTimeout(keepResuming, 1500);
      }
    } catch (_) {
      setTimeout(keepResuming, 1500);
    }
  }
  keepResuming();

  async function tryBoot() {
    try {
      const k = localStorage.getItem('basira.openRouterKey');
      if (k) window.B_CONFIG.openRouterKey = k;
    } catch (_) {}

    if (!window.B_CONFIG || !window.B_CONFIG.openRouterKey) {
      const gate = document.getElementById('keygate');
      if (gate && gate.classList.contains('open')) return;
      showKeyGate('');
      caption('assistant', 'Paste your OpenRouter API key, then press Save & start.');
      try { if (window.TTS) TTS.speak('Paste your Open Router key, then press Save and start.'); } catch (_) {}
      setTimeout(() => { try { document.getElementById('kgInput').focus(); } catch (_) {} }, 50);
      return;
    }

    if (booted) return;
    if (!window.ASSIST || typeof ASSIST.boot !== 'function') {
      console.error('ASSIST not ready');
      caption('assistant', 'Loading…');
      if (bootAttempts < 8) {
        bootAttempts++;
        setTimeout(tryBoot, 250);
      }
      return;
    }

    hideKeyGate();
    booted = true;
    state('listening');
    bootAttempts++;
    try {
      await ASSIST.boot();
      state(window.STT && STT.running ? 'listening' : 'idle');
    } catch (e) {
      console.error('boot failed', e);
      booted = false;
      state('listening');
      if (bootAttempts < 4) setTimeout(() => { booted = false; tryBoot(); }, 800);
      else caption('assistant', 'Speak — I am listening.');
    }
  }

  function saveKey() {
    const input = document.getElementById('kgInput');
    const err = document.getElementById('kgErr');
    let v = (input && input.value || '').trim();
    v = v.replace(/^["']|["']$/g, '').replace(/^Bearer\s+/i, '').trim();

    if (!v) {
      if (err) { err.hidden = false; err.textContent = 'Paste a key first.'; }
      if (input) input.focus();
      return;
    }
    if (v.length < 20) {
      if (err) { err.hidden = false; err.textContent = 'That looks too short for an OpenRouter key.'; }
      return;
    }
    if (!/^sk[-_]/i.test(v)) {
      if (err) { err.hidden = false; err.textContent = 'Key should start with sk- (OpenRouter keys look like sk-or-v1-…).'; }
      return;
    }

    try { localStorage.setItem('basira.openRouterKey', v); }
    catch (e) {
      if (err) {
        err.hidden = false;
        err.textContent = 'Browser blocked saving (private mode?). Allow site data and try again.';
      }
      return;
    }

    window.B_CONFIG.openRouterKey = v;
    if (err) {
      err.hidden = false;
      err.style.color = '#34d399';
      err.textContent = 'Saved. Starting…';
    }
    hideKeyGate();
    booted = false;
    tryBoot();
  }

  window.addEventListener('load', () => {
    state('off');

    try {
      const k = localStorage.getItem('basira.openRouterKey');
      if (k) window.B_CONFIG.openRouterKey = k;
    } catch (_) {}
    if (!window.B_CONFIG.openRouterKey) {
      showKeyGate('');
      caption('assistant', 'Paste your OpenRouter API key, then press Save & start.');
    }

    const saveBtn = document.getElementById('kgSave');
    const input = document.getElementById('kgInput');
    if (saveBtn) {
      saveBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); saveKey(); });
      saveBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    }
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); saveKey(); }
      });
    }
    const kg = document.getElementById('keygate');
    if (kg) kg.addEventListener('pointerdown', (e) => e.stopPropagation());

    const clearBtn = document.getElementById('kgClear');
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        try { localStorage.removeItem('basira.openRouterKey'); } catch (_) {}
        window.B_CONFIG.openRouterKey = '';
        booted = false;
        if (input) input.value = '';
        showKeyGate('Key cleared. Paste a new one.');
      });
    }

    const btnKey = document.getElementById('btnKey');
    if (btnKey) {
      btnKey.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        booted = false;
        try {
          const k = localStorage.getItem('basira.openRouterKey') || '';
          if (input) input.value = k;
        } catch (_) {}
        showKeyGate('');
        setTimeout(() => { if (input) input.focus(); }, 50);
      });
    }

    const btnMute = document.getElementById('btnMute');
    const muteLabel = document.getElementById('muteLabel');
    if (btnMute && muteLabel) {
      btnMute.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const muted = ASSIST.toggleMute();
        btnMute.classList.toggle('muted', muted);
        btnMute.setAttribute('aria-pressed', String(muted));
        btnMute.setAttribute('aria-label', muted ? 'Unmute microphone' : 'Mute microphone');
        muteLabel.textContent = muted ? 'Unmute mic' : 'Mute mic';
      });
    }

    // Prompt editor (demo)
    const btnPrompt = document.getElementById('btnPrompt');
    if (btnPrompt) {
      btnPrompt.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openPromptEditor();
      });
    }
    const pgSave = document.getElementById('pgSave');
    const pgReset = document.getElementById('pgReset');
    const pgClose = document.getElementById('pgClose');
    const pgGate = document.getElementById('promptGate');
    if (pgSave) pgSave.addEventListener('click', (e) => { e.preventDefault(); savePromptEditor(); });
    if (pgReset) pgReset.addEventListener('click', (e) => { e.preventDefault(); resetPromptEditor(); });
    if (pgClose) pgClose.addEventListener('click', (e) => { e.preventDefault(); closePromptEditor(); });
    if (pgGate) {
      pgGate.addEventListener('pointerdown', (e) => {
        if (e.target === pgGate) closePromptEditor();
      });
    }
    const pgInput = document.getElementById('pgInput');
    if (pgInput) {
      pgInput.addEventListener('pointerdown', (e) => e.stopPropagation());
      pgInput.addEventListener('keydown', (e) => e.stopPropagation());
    }

    const isTypingTarget = (el) => {
      if (!el) return false;
      const tag = (el.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'SELECT') return true;
      if (el.isContentEditable) return true;
      if (el.closest && el.closest('#keygate, #promptGate, button, a')) return true;
      return false;
    };

    const wake = (e) => {
      if (isTypingTarget(e && e.target)) return;
      if (window.EARCON) EARCON.unlock();
      if (!booted) tryBoot();
    };
    document.addEventListener('pointerdown', wake);
    document.addEventListener('keydown', wake);

    const orb = document.getElementById('orb');
    if (orb) {
      orb.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (window.EARCON) EARCON.unlock();
        if (!booted) tryBoot();
        else if (ASSIST && ASSIST.sayHello) ASSIST.sayHello();
      });
    }

    setTimeout(() => {
      if (window.B_CONFIG.openRouterKey) tryBoot();
    }, 0);
    setTimeout(() => {
      if (!booted && window.B_CONFIG.openRouterKey) tryBoot();
    }, 600);

    const btnCam = document.getElementById('btnCam');
    if (btnCam) btnCam.addEventListener('pointerdown', () => ASSIST.toggleCamera());
    const camClose = document.getElementById('camClose');
    if (camClose) camClose.addEventListener('pointerdown', () => ASSIST.closeCamera());
    const btnUpload = document.getElementById('btnUpload');
    if (btnUpload) btnUpload.addEventListener('pointerdown', () => {
      document.getElementById('fileInput').click();
    });
    const fileInput = document.getElementById('fileInput');
    if (fileInput) fileInput.addEventListener('change', (e) => ASSIST.onFiles(e.target.files));

    const btnDemo = document.getElementById('btnDemo');
    if (btnDemo) {
      btnDemo.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (window.EARCON) EARCON.unlock();
        btnDemo.classList.add('on');
        if (ASSIST.enableDemoMode) ASSIST.enableDemoMode();
      });
    }

    // Language follows speech only — no UI language button

    const btnData = document.getElementById('btnData');
    if (btnData) btnData.addEventListener('pointerdown', () => TELEM.download());
    document.addEventListener('keydown', (e) => {
      if (isTypingTarget(e.target)) return;
      if ((e.key === 'd' || e.key === 'D') && window.TELEM) TELEM.download();
    });
  });

  window.APP = { state, caption, hint, mic, tryBoot, saveKey, setLanguage, openPromptEditor, closePromptEditor };
})();
