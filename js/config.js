/* ============================================================================
 * config.js — loads FIRST. No secrets in this file (safe for GitHub Pages).
 * Set your OpenRouter key once:
 *   - Paste in the on-screen key box, or
 *   - localStorage.setItem('basira.openRouterKey', 'sk-or-...'); location.reload();
 *   - Or gitignored js/config.local.js → window.B_CONFIG.openRouterKey = '...'
 * ========================================================================== */
window.B_CONFIG = {
  openRouterKey: (function () {
    try { return localStorage.getItem('basira.openRouterKey') || ''; }
    catch (_) { return ''; }
  })(),
  models: {
    chat: 'openai/gpt-4o-mini',   // fast fallback brain (~1s vs qwen 10-20s)
    tts:  'openai/gpt-audio-mini' // GPT Live — primary voice path
  },
  bridge: 'http://127.0.0.1:8790',
  voices: [
    'en-US-EmmaMultilingualNeural',
    'en-US-AndrewMultilingualNeural',
    'en-US-AvaMultilingualNeural'
  ],
  ttsVoice: 'nova',
  timeoutMs: 90000,
  maxFramesPerVideo: 6,
  frameWidth: 720,
  classroomSnapshotSec: 45,
  studentName: ''
};
