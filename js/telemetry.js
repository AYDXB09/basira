/* ============================================================================
 * telemetry.js — session instrumentation for optimization.
 * Logs every turn: what you said, what it said, timings, model, voice path.
 * Auto-downloads a JSON report after the FIRST full response (per session)
 * + manual export with the ⤓ button or pressing D.
 * ========================================================================== */
(function () {
  const T0 = Date.now();
  let session = {
    startedAt: new Date(T0).toISOString(),
    userAgent: navigator.userAgent,
    turns: [],
    events: []
  };
  let autoExported = false;
  let currentTurn = null;

  function logEvent(type, data) {
    session.events.push({ t: Date.now() - T0, type, ...data });
  }

  function beginTurn(userText) {
    currentTurn = {
      user: userText,
      atMs: Date.now() - T0,
      sttDoneAt: Date.now() - T0,
      assistant: '',
      audioFirstByteMs: null,
      replyDoneMs: null,
      path: null,           // gpt-audio | fallback-text
      error: null
    };
    return currentTurn;
  }

  function markAudioFirstByte() {
    if (currentTurn && currentTurn.audioFirstByteMs == null) {
      currentTurn.audioFirstByteMs = Date.now() - T0;
    }
  }

  function endTurn(assistantText, path, err) {
    if (!currentTurn) return;
    currentTurn.assistant = assistantText || '';
    currentTurn.path = path;
    currentTurn.error = err ? String(err) : null;
    currentTurn.replyDoneMs = Date.now() - T0;
    currentTurn.turnLatencyMs = currentTurn.replyDoneMs - currentTurn.sttDoneAt;
    session.turns.push(currentTurn);
    currentTurn = null;

    if (!autoExported && session.turns.length >= 1) {
      autoExported = true;
      setTimeout(download, 500);
    }
  }

  function report() {
    return {
      ...session,
      exportedAt: new Date().toISOString(),
      summary: {
        turns: session.turns.length,
        avgTurnLatencyMs: session.turns.length
          ? Math.round(session.turns.reduce((a, t) => a + (t.turnLatencyMs || 0), 0) / session.turns.length)
          : null
      }
    };
  }

  function download() {
    const blob = new Blob([JSON.stringify(report(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'basira-session-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  window.TELEM = { logEvent, beginTurn, markAudioFirstByte, endTurn, download, report };
})();
