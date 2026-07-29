/* ============================================================================
 * earcons.js — the audio cues blind-first products live on (WebAudio, no files)
 *   listen  — rising two-tone: "I'm listening to you now"
 *   done    — soft chime: action finished
 *   think   — muted tick: "working on it"
 *   error   — low buzz
 * Modeled on Seeing AI / VoiceOver conventions: every state change is audible.
 * ========================================================================== */
(function () {
  let ctx = null;
  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, t0, dur, type = 'sine', gain = 0.12) {
    const a = ac();
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, a.currentTime + t0);
    g.gain.linearRampToValueAtTime(gain, a.currentTime + t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(a.currentTime + t0);
    o.stop(a.currentTime + t0 + dur + 0.05);
  }
  window.EARCON = {
    listen() { tone(520, 0, 0.09); tone(760, 0.1, 0.12); },          // up = your turn
    done()   { tone(880, 0, 0.08); tone(1175, 0.09, 0.16, 'sine', 0.09); },
    think()  { tone(340, 0, 0.06, 'triangle', 0.06); },
    error()  { tone(180, 0, 0.25, 'sawtooth', 0.07); },
    unlock() { ac(); }                                                // call on first user gesture
  };
})();
