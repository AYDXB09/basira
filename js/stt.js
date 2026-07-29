/* ============================================================================
 * stt.js — ALWAYS-ON listening (Web Speech API, Chrome).
 * One continuous recognizer that never sleeps:
 *   STT.startAlways({ onUtterance(text), onInterim(text) })
 * Auto-restarts when Chrome kills the session. The assistant layer decides
 * what is user speech vs. the tutor's own echo vs. classroom audio.
 * ========================================================================== */
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let want = false;
  let handlers = null;
  let lang = 'en-US';
  let heardAnything = false;    // did ANY speech event ever fire?
  let lastError = null;

  function supported() { return !!SR; }

  function spin() {
    if (!want) return;
    rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onaudiostart = () => { console.log('[stt] audio start'); };
    rec.onspeechstart = () => { heardAnything = true; console.log('[stt] speech detected'); };

    rec.onresult = (e) => {
      heardAnything = true;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          const fin = t.trim();
          console.log('[stt] final:', fin);
          if (fin && handlers?.onUtterance) handlers.onUtterance(fin);
        } else interim += t;
      }
      if (interim.trim() && handlers?.onInterim) handlers.onInterim(interim.trim());
    };
    rec.onend = () => { if (want) setTimeout(spin, 200); };
    rec.onerror = (e) => {
      lastError = e.error;
      if (e.error !== 'no-speech') console.warn('[stt] error:', e.error);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        want = false;
        if (handlers?.onError) handlers.onError('mic-denied');
      }
      if (e.error === 'network' && handlers?.onError) handlers.onError('network');
      // everything else: onend fires next and we restart
    };
    try { rec.start(); } catch (_) { /* already running */ }
  }

  function startAlways(h, opts = {}) {
    handlers = h;
    lang = opts.lang || 'en-US';
    if (want) return true;
    if (!SR) return false;
    want = true;
    spin();
    return true;
  }

  function stopAlways() {
    want = false;
    if (rec) { try { rec.onend = null; rec.stop(); } catch (_) {} rec = null; }
  }

  window.STT = { supported, startAlways, stopAlways,
    get running() { return want; },
    get heardAnything() { return heardAnything; },
    get lastError() { return lastError; } };
})();
