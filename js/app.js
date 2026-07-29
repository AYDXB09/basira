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
    if (who === 'user') {
      document.getElementById('line-user').textContent = t;
    } else {
      document.getElementById('line-tutor').textContent = t;
      document.getElementById('line-user').textContent = '';
    }
  }

  function mic(s) { // waiting | on | blocked
    const dot = document.getElementById('micdot');
    dot.className = s;
    const label = { waiting: 'allow the mic…', on: 'listening', blocked: 'mic blocked' }[s];
    if (label) document.getElementById('statusText').textContent = label;
  }

  function hint() {} // kept for compatibility; the status chip replaced it

  let booted = false;
  async function tryBoot() {
    if (booted) return;
    booted = true;
    try { await ASSIST.boot(); }
    catch (e) { console.error('boot failed', e); booted = false; }
  }

  window.addEventListener('load', () => {
    state('off');

    // ZERO-TOUCH: attempt to boot immediately (START.bat launches Chrome with
    // --autoplay-policy=no-user-gesture-required). If blocked: first gesture.
    const probe = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=');
    probe.play().then(() => tryBoot()).catch(() => {
      document.getElementById('statusText').textContent = 'tap or press any key';
      caption('assistant', 'Tap anywhere or press any key once to wake me.');
      const wake = () => tryBoot();
      ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, wake));
    });

    // redundant visual controls (screen optional, never required)
    document.getElementById('btnCam').addEventListener('pointerdown', () => ASSIST.toggleCamera());
    document.getElementById('camClose').addEventListener('pointerdown', () => ASSIST.closeCamera());
    document.getElementById('btnUpload').addEventListener('pointerdown', () => {
      document.getElementById('fileInput').click();
    });
    document.getElementById('fileInput').addEventListener('change', (e) => ASSIST.onFiles(e.target.files));
  });

  window.APP = { state, caption, hint, mic };
})();
