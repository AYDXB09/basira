/* ============================================================================
 * config.js — loads FIRST. No secrets in this file (safe for GitHub Pages).
 * Set your OpenRouter key once in DevTools (HTTPS/localhost):
 *   localStorage.setItem('basira.openRouterKey', 'sk-or-v1-...'); location.reload();
 * Or drop a gitignored js/config.local.js that sets window.B_CONFIG.openRouterKey.
 * ========================================================================== */
window.B_CONFIG = {
  openRouterKey: (function () {
    try { return localStorage.getItem('basira.openRouterKey') || ''; } catch (_) { return ''; }
  })(),
  models: {
    chat: 'qwen/qwen3.7-plus',
    tts:  'openai/gpt-audio-mini'   // OpenRouter streaming neural voice (pcm16)
  },
  bridge: 'http://127.0.0.1:8790',
  voices: [
    'en-US-EmmaMultilingualNeural',
    'en-US-AndrewMultilingualNeural',
    'en-US-AvaMultilingualNeural'
  ],
  ttsVoice: 'nova',                   // gpt-audio voice: nova|alloy|shimmer|echo|fable|onyx|coral
  timeoutMs: 90000,
  maxFramesPerVideo: 6,
  frameWidth: 720,
  classroomSnapshotSec: 45,
  studentName: 'Alex'
};
