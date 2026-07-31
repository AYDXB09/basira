/* ============================================================================
 * stt.js — resilient always-on Web Speech recognition for Chrome/Edge.
 * ========================================================================== */
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let want = false;
  let handlers = null;
  let lang = 'en-US';
  let heardAnything = false;
  let lastError = null;
  let errCount = 0;
  let restartTimer = null;
  let generation = 0;
  let finalForSpeech = false;
  let hints = [];

  function supported() { return !!SR; }

  function clearRestart() {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
  }

  function closeRecognizer() {
    generation++;
    if (!rec) return;
    try {
      rec.onend = null;
      rec.onerror = null;
      rec.onresult = null;
      rec.abort();
    } catch (_) {}
    rec = null;
  }

  function restart(delay) {
    clearRestart();
    closeRecognizer();
    if (!want) return;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      spin();
    }, delay);
  }

  function setLang(code) {
    const next = code || 'en-US';
    if (lang === next) return;
    lang = next;
    if (want) restart(400);
  }

  function setHints(values) {
    hints = [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))].slice(0, 30);
    if (want) restart(250);
  }

  function spin() {
    if (!want || !SR) return;
    clearRestart();
    closeRecognizer();
    const token = generation;
    const next = new SR();
    rec = next;
    next.lang = lang;
    next.continuous = true;
    next.interimResults = true;
    next.maxAlternatives = 5;
    const GrammarList = window.SpeechGrammarList || window.webkitSpeechGrammarList;
    if (GrammarList && hints.length) {
      try {
        const grammar = new GrammarList();
        const terms = hints.map(value => value.replace(/[;|=]/g, ' ')).join(' | ');
        grammar.addFromString(`#JSGF V1.0; grammar answers; public <answer> = ${terms};`, 1);
        next.grammars = grammar;
      } catch (_) {}
    }

    next.onaudiostart = () => {
      if (token !== generation) return;
      errCount = 0;
      lastError = null;
      if (handlers?.onStatus) handlers.onStatus('listening');
    };
    next.onspeechstart = () => {
      if (token !== generation) return;
      heardAnything = true;
      finalForSpeech = false;
    };
    next.onspeechend = () => {
      if (token !== generation || finalForSpeech) return;
      setTimeout(() => {
        if (token === generation && !finalForSpeech && handlers?.onNoMatch) handlers.onNoMatch();
      }, 350);
    };
    next.onresult = (e) => {
      if (token !== generation) return;
      heardAnything = true;
      errCount = 0;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          const finalText = text.trim();
          finalForSpeech = !!finalText;
          const alternatives = [...e.results[i]].map(result => result.transcript.trim()).filter(Boolean);
          if (finalText && handlers?.onUtterance) handlers.onUtterance(finalText, alternatives);
        } else {
          interim += text;
        }
      }
      if (interim.trim() && handlers?.onInterim) handlers.onInterim(interim.trim());
    };
    next.onend = () => {
      if (token !== generation) return;
      rec = null;
      const wait = Math.min(200 * Math.pow(2, errCount), 2500);
      if (want) {
        clearRestart();
        restartTimer = setTimeout(spin, wait);
      }
    };
    next.onerror = (e) => {
      if (token !== generation) return;
      lastError = e.error;
      if (e.error === 'network') errCount++;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        want = false;
        clearRestart();
        if (handlers?.onError) handlers.onError('mic-denied');
      } else if (e.error === 'network') {
        if (handlers?.onStatus) handlers.onStatus('reconnecting');
        if (handlers?.onError) handlers.onError('network');
      }
    };
    try { next.start(); }
    catch (_) { restart(500); }
  }

  function startAlways(nextHandlers, opts = {}) {
    handlers = nextHandlers;
    if (opts.lang) lang = opts.lang;
    if (want) return true;
    if (!SR) return false;
    want = true;
    spin();
    return true;
  }

  function stopAlways() {
    want = false;
    clearRestart();
    closeRecognizer();
  }

  window.STT = {
    supported, startAlways, stopAlways, setLang, setHints,
    get running() { return want; },
    get heardAnything() { return heardAnything; },
    get lastError() { return lastError; },
    get lang() { return lang; }
  };
})();
