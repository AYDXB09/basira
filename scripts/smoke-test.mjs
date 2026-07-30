/**
 * smoke-test.mjs — headless checks for Basira conversation stack.
 * Run: node scripts/smoke-test.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
import http from 'http';
import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
let failed = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log('  PASS', name, detail ? '— ' + detail : '');
  else { failed++; console.log('  FAIL', name, detail ? '— ' + detail : ''); }
}

console.log('\n=== 1. Syntax ===');
for (const f of fs.readdirSync(path.join(root, 'js')).filter(x => x.endsWith('.js'))) {
  try {
    new vm.Script(fs.readFileSync(path.join(root, 'js', f), 'utf8'), { filename: f });
    ok('syntax ' + f, true);
  } catch (e) {
    ok('syntax ' + f, false, e.message);
  }
}

console.log('\n=== 2. ASSIST exports (setLanguage must exist) ===');
{
  const code = fs.readFileSync(path.join(root, 'js/assistant.js'), 'utf8');
  ok('defines setLanguage fn', /function setLanguage\s*\(/.test(code));
  ok('defines injectText fn', /function injectText\s*\(/.test(code));
  ok('exports setLanguage', /setLanguage/.test(code) && /window\.ASSIST\s*=/.test(code));
  // evaluate IIFE in sandbox
  const sandbox = {
    console,
    window: {},
    document: {
      getElementById: () => ({
        textContent: '', classList: { add() {}, remove() {} },
        hidden: true, srcObject: null, play: async () => {}, videoWidth: 0,
        style: {}, addEventListener() {}
      }),
      createElement: () => ({ click() {}, href: '', download: '' })
    },
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
    location: { origin: 'http://localhost:8124' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async () => ({ ok: false, status: 500, text: async () => '', json: async () => ({}) }),
    URL, Blob, setTimeout, clearTimeout, AbortSignal: { timeout: () => ({}) },
    SpeechSynthesisUtterance: function () {},
    performance: { now: () => Date.now() }
  };
  sandbox.window = sandbox;
  sandbox.B_CONFIG = { openRouterKey: 'sk-test', models: { chat: 'x', tts: 'y' }, bridge: 'http://127.0.0.1:8790', voices: [] };
  sandbox.PED = {
    systemPrompt: () => 'sys',
    profile: { lang: 'en' },
    LANGS: [
      { id: 'en', name: 'English', stt: 'en-US', gptHint: 'English' },
      { id: 'ar', name: 'Arabic', stt: 'ar-SA', gptHint: 'Arabic' }
    ],
    langMeta: () => ({ stt: 'en-US', gptHint: 'English', edge: 'en-US-EmmaMultilingualNeural', tts: 'en-US' }),
    setLangFromText: () => ({ id: 'en', stt: 'en-US' }),
    saveProfile: (p) => Object.assign(sandbox.PED.profile, p)
  };
  sandbox.APP = { state() {}, caption() {}, mic() {}, setLanguage() {} };
  sandbox.EARCON = { unlock() {}, listen() {}, done() {}, error() {}, _ctx: null };
  sandbox.TTS = {
    speak: async () => {},
    speakLLM: async () => ({ transcript: 'hi' }),
    stop() {}, prewarm() {}, speaking: false, currentText: '', cycleVoice: () => 'v'
  };
  sandbox.STT = { supported: () => false, startAlways() {}, setLang() {}, running: false };
  sandbox.LLM = {
    chat: async () => 'hello from model',
    chatJSON: async () => ({ correct: true, feedback: 'ok' }),
    extractText: (x) => typeof x === 'string' ? x : '',
    explainError: () => 'err'
  };
  sandbox.MEM = { get: () => null, add() {}, absorbFromUtterance() {} };
  sandbox.TELEM = { logEvent() {}, beginTurn() {}, endTurn() {}, markAudioFirstByte() {}, download() {} };
  sandbox.DEMO = { activate: () => null, saveAnswers() {} };
  sandbox.DEMO_PACK = null;
  sandbox.INGEST = { collect: async () => ({ texts: [], images: [] }) };
  sandbox.BROWSER = null;
  try {
    vm.runInNewContext(code, sandbox, { filename: 'assistant.js' });
    ok('ASSIST created', !!sandbox.ASSIST);
    ok('ASSIST.setLanguage is function', typeof sandbox.ASSIST.setLanguage === 'function');
    ok('ASSIST.injectText is function', typeof sandbox.ASSIST.injectText === 'function');
    ok('ASSIST.route is function', typeof sandbox.ASSIST.route === 'function');
    ok('ASSIST.boot is function', typeof sandbox.ASSIST.boot === 'function');
  } catch (e) {
    ok('ASSIST evaluate', false, e.message);
  }
}

console.log('\n=== 3. Language detection stickiness ===');
{
  const code = fs.readFileSync(path.join(root, 'js/pedagogy.js'), 'utf8');
  const sandbox = {
    console,
    window: {},
    localStorage: {
      _d: {},
      getItem(k) { return this._d[k] || null; },
      setItem(k, v) { this._d[k] = String(v); }
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(code, sandbox, { filename: 'pedagogy.js' });
  const PED = sandbox.PED;
  ok('PED loaded', !!PED);
  PED.saveProfile({ lang: 'ar' });
  ok('stays ar on ok', PED.detectLangId('ok') === 'ar', PED.detectLangId('ok'));
  ok('stays ar on yes', PED.detectLangId('yes please') === 'ar');
  ok('switches on Arabic script', PED.detectLangId('مرحبا كيف حالك') === 'ar');
  PED.saveProfile({ lang: 'en' });
  ok('detects Hindi script', PED.detectLangId('नमस्ते') === 'hi');
  ok('detects French keyword', PED.detectLangId('bonjour comment ça va') === 'fr');
  ok('explicit switch to Spanish', PED.detectLangId('please speak spanish') === 'es');
  PED.saveProfile({ lang: 'fr' });
  ok('stays fr on short english ack', PED.detectLangId('thanks') === 'fr');
}

console.log('\n=== 4. Live OpenRouter text model ===');
await new Promise((resolve) => {
  let key = '';
  try {
    const loc = fs.readFileSync(path.join(root, 'js/config.local.js'), 'utf8');
    const m = loc.match(/openRouterKey\s*=\s*'([^']+)'/);
    if (m) key = m[1];
  } catch (_) {}
  if (!key) { ok('has key', false); return resolve(); }
  ok('has key', key.startsWith('sk-'));
  const body = JSON.stringify({
    model: 'openai/gpt-4o-mini',
    messages: [
      { role: 'system', content: 'Reply in one short sentence.' },
      { role: 'user', content: 'What is 2+2? Say the number only.' }
    ],
    max_tokens: 20
  });
  const req = https.request({
    hostname: 'openrouter.ai',
    path: '/api/v1/chat/completions',
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:8124',
      'Content-Length': Buffer.byteLength(body)
    },
    timeout: 45000
  }, (res) => {
    let data = '';
    res.on('data', (c) => data += c);
    res.on('end', () => {
      ok('LLM HTTP ' + res.statusCode, res.statusCode === 200, data.slice(0, 120));
      try {
        const j = JSON.parse(data);
        const txt = j.choices?.[0]?.message?.content || '';
        ok('LLM content', /4/.test(txt), JSON.stringify(txt));
      } catch (e) { ok('LLM parse', false, e.message); }
      resolve();
    });
  });
  req.on('error', (e) => { ok('LLM network', false, e.message); resolve(); });
  req.write(body);
  req.end();
});

console.log('\n=== 5. Bridge TTS ===');
await new Promise((resolve) => {
  const url = 'http://127.0.0.1:8790/tts?voice=en-US-EmmaMultilingualNeural&text=' + encodeURIComponent('Basira smoke test');
  http.get(url, { timeout: 12000 }, (res) => {
    let n = 0;
    res.on('data', (c) => { n += c.length; });
    res.on('end', () => {
      ok('TTS status', res.statusCode === 200, String(res.statusCode));
      ok('TTS bytes', n > 500, String(n));
      resolve();
    });
  }).on('error', (e) => { ok('TTS bridge', false, e.message); resolve(); });
});

console.log('\n=== 6. Multi-lang prompt embedding ===');
{
  // re-run pedagogy with profile ar and check systemPrompt
  const code = fs.readFileSync(path.join(root, 'js/pedagogy.js'), 'utf8');
  const sandbox = { console, window: {}, localStorage: { getItem: () => null, setItem() {} } };
  sandbox.window = sandbox;
  vm.runInNewContext(code, sandbox);
  sandbox.PED.saveProfile({ lang: 'ar' });
  const p = sandbox.PED.systemPrompt();
  ok('systemPrompt mentions Arabic', /Arabic/i.test(p));
  sandbox.PED.saveProfile({ lang: 'hi' });
  ok('systemPrompt mentions Hindi', /Hindi/i.test(sandbox.PED.systemPrompt()));
}

console.log('\n==============================');
console.log(failed ? `FAILED: ${failed} check(s)` : 'ALL CHECKS PASSED');
console.log('==============================\n');
process.exit(failed ? 1 : 0);
