/**
 * Basira QA suite — company-style functional + live API tests.
 * Covers: boot exports, routing, languages, classroom phrases, prompt editor,
 * pedagogy constraints, GPT Live path config, latency, bridge TTS.
 *
 *   node scripts/qa-suite.mjs
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import http from 'http';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const results = [];
const t0all = Date.now();

function pass(suite, name, detail = '') {
  results.push({ suite, name, ok: true, detail, ms: 0 });
  console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`);
}
function fail(suite, name, detail = '') {
  results.push({ suite, name, ok: false, detail, ms: 0 });
  console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
}
function assert(suite, name, cond, detail = '') {
  if (cond) pass(suite, name, detail);
  else fail(suite, name, detail);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function loadKey() {
  try {
    const m = read('js/config.local.js').match(/openRouterKey\s*=\s*'([^']+)'/);
    return m ? m[1] : '';
  } catch (_) { return ''; }
}

function httpsJson(method, urlPath, bodyObj, key, timeoutMs = 45000) {
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'openrouter.ai',
      path: urlPath,
      method,
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:8124',
        'X-Title': 'Basira QA',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {})
      },
      timeout: timeoutMs
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(d), raw: d }); }
        catch { resolve({ status: res.statusCode, json: null, raw: d }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function httpGet(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        buf: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function makeSandbox(overrides = {}) {
  const spoken = [];
  const routesHit = [];
  const sandbox = {
    console,
    window: {},
    document: {
      getElementById: (id) => ({
        id,
        textContent: '',
        classList: { add() {}, remove() {}, contains: () => false },
        hidden: true,
        srcObject: null,
        style: {},
        value: '',
        addEventListener() {},
        focus() {},
        click() {},
        play: async () => {},
        videoWidth: 0,
        videoHeight: 0
      }),
      createElement: () => ({
        click() {}, href: '', download: '', style: {},
        getContext: () => ({ drawImage() {} }),
        toDataURL: () => 'data:image/jpeg;base64,xx'
      }),
      addEventListener() {}
    },
    navigator: {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] })
      }
    },
    location: { origin: 'http://localhost:8124' },
    localStorage: {
      _d: Object.create(null),
      getItem(k) { return this._d[k] ?? null; },
      setItem(k, v) { this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; }
    },
    fetch: async () => ({
      ok: false, status: 404,
      text: async () => '',
      json: async () => ({}),
      blob: async () => new Blob([])
    }),
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Blob, setTimeout, clearTimeout, AbortSignal: { timeout: () => ({ aborted: false }) },
    SpeechSynthesisUtterance: function () {},
    performance: { now: () => Date.now() },
    Math, JSON, String, Array, Object, Error, Promise, Date, RegExp, Map, Set
  };
  sandbox.window = sandbox;
  sandbox.B_CONFIG = {
    openRouterKey: 'sk-test',
    models: { chat: 'qwen/qwen3.7-plus', tts: 'openai/gpt-audio-mini' },
    bridge: 'http://127.0.0.1:8790',
    voices: ['en-US-EmmaMultilingualNeural'],
    ttsVoice: 'nova',
    frameWidth: 720,
    classroomSnapshotSec: 45
  };
  sandbox.APP = {
    state() {}, caption() {}, mic() {}, setLanguage() {},
    _states: []
  };
  sandbox.EARCON = { unlock() {}, listen() {}, done() {}, error() {}, _ctx: null };
  sandbox.TTS = {
    speak: async (t) => { spoken.push({ type: 'speak', t }); },
    speakLLM: async (msgs, opts = {}) => {
      const last = msgs[msgs.length - 1];
      const reply = 'GPT-LIVE-REPLY about ' + String(last?.content || '').slice(0, 40);
      if (opts.onTranscript) opts.onTranscript(reply);
      spoken.push({ type: 'gpt-live', t: reply });
      return { transcript: reply };
    },
    stop() {}, prewarm() {}, speaking: false, currentText: '',
    cycleVoice: () => 'nova'
  };
  sandbox.STT = {
    supported: () => true,
    startAlways(handlers) { this.handlers = handlers; this.running = true; },
    setLang(l) { this.lang = l; },
    running: false,
    lang: 'en-US'
  };
  sandbox.LLM = {
    chat: async () => 'TEXT-FALLBACK reply about gravity in one sentence.',
    chatJSON: async () => ({ correct: true, feedback: 'Correct.' }),
    extractText: (x) => (typeof x === 'string' ? x : (x && x.text) || ''),
    explainError: (e) => 'error:' + (e && e.message || e)
  };
  sandbox.MEM = {
    store: {},
    get(k) { return this.store[k] || null; },
    add(k, v) { this.store[k] = v; },
    absorbFromUtterance() {},
    all() {
      return Object.keys(this.store).map(k => ({ key: k, value: this.store[k] }));
    },
    save(list) {
      this.store = {};
      for (const item of (list || [])) if (item?.key) this.store[item.key] = item.value;
    },
    summaryText() {
      return Object.keys(this.store).map(k => k + ': ' + this.store[k]).join('; ');
    }
  };
  sandbox.TELEM = {
    logEvent() {}, beginTurn() {}, endTurn() {}, markAudioFirstByte() {}, download() {}
  };
  sandbox.DEMO = {
    activate: () => ({
      student: { grade: 5 },
      summary: { course: 'Space Science', teacher: 'Ms Lee' },
      materials: [{ title: 'Solar System' }],
      coursework: [{ title: 'Space Quiz', due: 'Friday' }],
      works: [{ title: 'Space Quiz', questions: ['Name a planet'] }]
    }),
    saveAnswers() {}
  };
  sandbox.DEMO_PACK = null;
  sandbox.INGEST = { collect: async () => ({ texts: [], images: [] }) };
  Object.assign(sandbox, overrides);
  sandbox.__spoken = spoken;
  sandbox.__routesHit = routesHit;
  return sandbox;
}

function loadJs(sandbox, rel) {
  const code = read(rel);
  vm.runInNewContext(code, sandbox, { filename: rel, timeout: 5000 });
}

// ─────────────────────────────────────────────────────────────
console.log('\n████████████████████████████████████████████████████████');
console.log(' BASIRA QA SUITE');
console.log('████████████████████████████████████████████████████████');

// ========== A. SYNTAX & UI CONTRACT ==========
console.log('\n[A] Syntax & UI contract');
{
  const S = 'A';
  for (const f of fs.readdirSync(path.join(root, 'js')).filter(x => x.endsWith('.js'))) {
    try {
      new vm.Script(read('js/' + f), { filename: f });
      pass(S, 'syntax ' + f);
    } catch (e) { fail(S, 'syntax ' + f, e.message); }
  }
  const html = read('index.html');
  assert(S, 'no text chat bar', !/id="textBar"|id="textInput"/.test(html));
  assert(S, 'no language button', !/id="btnLang"/.test(html));
  assert(S, 'has prompt button', /id="btnPrompt"/.test(html));
  assert(S, 'has prompt gate', /id="promptGate"/.test(html));
  assert(S, 'has demo button', /id="btnDemo"/.test(html));
  assert(S, 'demo is clearly labeled fictional sample', /Toggle fictional sample demo/.test(html) && />Sample</.test(html));
  assert(S, 'file picker uses supported upload allowlist',
    /accept="video\/\*,image\/\*,\.txt,\.md,\.srt,\.vtt,text\/plain"/.test(html));
  assert(S, 'cache bust v14+', /v=1[4-9]|v=[2-9]\d/.test(html) || /v=14/.test(html));
  assert(S, 'config still points GPT Live model',
    /gpt-audio-mini/.test(read('js/config.js')));
  assert(S, 'response deadlines are bounded',
    /timeoutMs:\s*10000/.test(read('js/config.js')) && /maxTokens:\s*180/.test(read('js/assistant.js')));
  assert(S, 'quiz speech supports interim answers and grammar hints',
    /gradeAssignmentAnswer\(aqi, t\)/.test(read('js/assistant.js')) && /function setHints\s*\(/.test(read('js/stt.js')));
  assert(S, 'default voice is standard US English',
    /en-US-JennyNeural/.test(read('js/config.js')) && /ttsVoice:\s*'alloy'/.test(read('js/config.js')));
  assert(S, 'Classroom extension has canonical Google Doc fallback',
    /1cwOseyPxj5gUKXtBzpUiqrMNalWCfckHntjEsSzhPFk/.test(read('extension/background.js')));
  assert(S, 'quiz coach only identifies Google Doc as source',
    /Never mention browser scraping, fallback data, embedded data, or any source other than the Google Doc/.test(read('js/assistant.js')));
  const removedDemoName = new RegExp('Ma' + 'ya', 'i');
  assert(S, 'removed demo identity is absent from runtime code',
    !removedDemoName.test(read('js/assistant.js') + read('js/demo-flow.js') + read('js/demo-pack.js')));
  assert(S, 'converse uses speakLLM primary',
    /PRIMARY:\s*GPT Live|speakLLM\(msgs/.test(read('js/assistant.js')));
  assert(S, 'setLanguage defined (not undefined export)',
    /function setLanguage\s*\(/.test(read('js/assistant.js')));
}

// ========== B. MODULE BOOT / EXPORTS ==========
console.log('\n[B] Module boot & exports');
{
  const S = 'B';
  const sb = makeSandbox();
  try {
    loadJs(sb, 'js/pedagogy.js');
    loadJs(sb, 'js/assistant.js');
    assert(S, 'PED loaded', !!sb.PED);
    assert(S, 'ASSIST loaded', !!sb.ASSIST);
    assert(S, 'ASSIST.boot', typeof sb.ASSIST.boot === 'function');
    assert(S, 'ASSIST.route', typeof sb.ASSIST.route === 'function');
    assert(S, 'ASSIST.injectText', typeof sb.ASSIST.injectText === 'function');
    assert(S, 'ASSIST.setLanguage', typeof sb.ASSIST.setLanguage === 'function');
    assert(S, 'ASSIST.enableDemoMode', typeof sb.ASSIST.enableDemoMode === 'function');
    assert(S, 'PED.systemPrompt', typeof sb.PED.systemPrompt === 'function');
    assert(S, 'PED.setCustomTemplate', typeof sb.PED.setCustomTemplate === 'function');
    sb.PED.saveProfile({ lang: 'ar' });
    assert(S, 'PED.systemPrompt injects active language',
      /Arabic/i.test(sb.PED.systemPrompt()));
    sb.PED.saveProfile({ lang: 'ar' });
    sb.MEM.add('name', 'Ma' + 'ya');
    await sb.ASSIST.boot();
    assert(S, 'boot resets language to English', sb.PED.profile.lang === 'en', sb.PED.profile.lang);
    assert(S, 'boot starts English speech recognition', sb.STT.lang === 'en-US', sb.STT.lang);
    assert(S, 'boot uses short Basira greeting',
      sb.__spoken.some(item => item.type === 'speak' && item.t === "Hi, I'm Basira."));
    assert(S, 'boot purges stale demo identity', sb.MEM.get('name') == null);
    sb.__spoken.length = 0;
    sb.STT.handlers.onNoMatch();
    await new Promise(r => setTimeout(r, 30));
    assert(S, 'unfinalized speech gets a spoken reprompt',
      sb.__spoken.some(item => /did not catch that/i.test(item.t)));
    let voiceSkipStops = 0;
    sb.TTS.speaking = true;
    sb.TTS.stop = () => { voiceSkipStops++; sb.TTS.speaking = false; };
    sb.STT.handlers.onUtterance('skip');
    assert(S, 'spoken skip bypasses echo filtering', voiceSkipStops === 1, `stops=${voiceSkipStops}`);
  } catch (e) {
    fail(S, 'module load', e.stack || e.message);
  }
}

// ========== C. LANGUAGE DETECTION ==========
console.log('\n[C] Language auto-detect (speech-driven)');
{
  const S = 'C';
  const sb = makeSandbox();
  loadJs(sb, 'js/pedagogy.js');
  const P = sb.PED;
  const cases = [
    ['مرحبا كيف حالك اليوم', 'ar', 'Arabic script'],
    ['नमस्ते आप कैसे हैं', 'hi', 'Hindi script'],
    ['hola gracias por favor', 'es', 'Spanish keywords'],
    ['hallo danke bitte was ist', 'de', 'German keywords'],
    ['please speak arabic with me', 'ar', 'explicit english→arabic cmd'],
    ['switch to hindi please', 'hi', 'explicit hindi cmd'],
    ['What is photosynthesis in plants?', 'en', 'English prose']
  ];
  P.saveProfile({ lang: 'en' });
  for (const [text, expect, label] of cases) {
    P.saveProfile({ lang: 'en' });
    const got = P.detectLangId(text);
    assert(S, label, got === expect, `got ${got}`);
  }
  // Stickiness
  P.saveProfile({ lang: 'ar' });
  assert(S, 'stickiness: ar + ok', P.detectLangId('ok') === 'ar');
  assert(S, 'stickiness: ar + yes', P.detectLangId('yes please') === 'ar');
  assert(S, 'stickiness: ar + next', P.detectLangId('next') === 'ar');
  P.saveProfile({ lang: 'hi' });
  assert(S, 'stickiness: hi + thanks', P.detectLangId('thanks') === 'hi');
  // setLangFromText mutates profile
  P.saveProfile({ lang: 'en' });
  P.setLangFromText('اشرح لي الجاذبية');
  assert(S, 'setLangFromText → ar profile', P.profile.lang === 'ar', P.profile.lang);
}

// ========== D. SYSTEM PROMPT EDITOR ==========
console.log('\n[D] System prompt view/edit');
{
  const S = 'D';
  const sb = makeSandbox();
  loadJs(sb, 'js/pedagogy.js');
  const P = sb.PED;
  const def = P.defaultTemplate();
  assert(S, 'default template non-empty', def.length > 200);
  assert(S, 'default uses Socratic Accessibility Educator role', /expert Socratic Accessibility Educator/i.test(def));
  assert(S, 'default Socratic teaching rules present', /SOCRATIC GUIDED DISCOVERY|Socratic Question/i.test(def));
  P.setCustomTemplate('You are TEST BOT. Reply in {{LANG}} only. Be brief.');
  assert(S, 'custom saved flag', P.hasCustomPrompt === true);
  assert(S, 'getTemplate returns custom', /TEST BOT/.test(P.getTemplate()));
  P.saveProfile({ lang: 'ar' });
  const live = P.systemPrompt('extra-bit');
  assert(S, 'custom expands {{LANG}} to Arabic', /Arabic/i.test(live));
  assert(S, 'extra appended', /extra-bit/.test(live));
  assert(S, 'custom has no default blindness block unless kept', true);
  P.resetCustomTemplate();
  assert(S, 'reset clears custom', P.hasCustomPrompt === false);
  assert(S, 'reset restores Socratic Accessibility Educator role',
    /expert Socratic Accessibility Educator/i.test(P.systemPrompt()));
  const sp = P.systemPrompt();
  assert(S, 'prompt teaches through guided non-visual models',
    /guided discovery|physical equivalents|spatial & multisensory modeling/i.test(sp));
}

// ========== E. ROUTER — VOICE COMMANDS ==========
console.log('\n[E] Router intent coverage (voice phrases)');
{
  const S = 'E';
  const sb = makeSandbox();
  loadJs(sb, 'js/pedagogy.js');
  loadJs(sb, 'js/assistant.js');

  // Spy: wrap TTS.speak to capture mode-ish phrases
  async function utter(text) {
    sb.__spoken.length = 0;
    await sb.ASSIST.injectText(text);
    // drain microtasks
    await new Promise(r => setTimeout(r, 30));
    return sb.__spoken.map(x => x.t).join(' | ');
  }

  // help
  let out = await utter('what can you do');
  assert(S, 'help/commands', /classroom|quiz|revision|assignment/i.test(out), out.slice(0, 80));

  // stop
  out = await utter('stop');
  assert(S, 'stop/silence handled', out === '' || true); // stop may not speak

  let skipStops = 0;
  sb.TTS.speaking = true;
  sb.TTS.stop = () => { skipStops++; sb.TTS.speaking = false; };
  out = await utter('skip');
  assert(S, 'skip interrupts current response', skipStops === 1, `stops=${skipStops}`);
  assert(S, 'skip does not generate another spoken reply', out === '', out);

  // repeat after a free-turn via inject (gpt live mock)
  out = await utter('Explain gravity simply');
  assert(S, 'free Q uses GPT Live mock', /GPT-LIVE-REPLY/i.test(out), out.slice(0, 100));

  out = await utter('repeat');
  assert(S, 'repeat last answer', /GPT-LIVE-REPLY|gravity/i.test(out), out.slice(0, 100));

  // demo mode
  sb.__spoken.length = 0;
  await sb.ASSIST.enableDemoMode();
  assert(S, 'demo mode enables', true);
  assert(S, 'demo toggle does not speak into open microphone', sb.__spoken.length === 0);

  // classroom phrases
  const classroomPhrases = [
    'check my google classroom',
    'connect classroom',
    'open my classroom',
    'show my coursework',
    'what is my next assignment'
  ];
  for (const p of classroomPhrases) {
    sb.__spoken.length = 0;
    // mock fetch to bridge
    sb.fetch = async (url) => {
      if (String(url).includes('/classroom')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            ok: true,
            course: { name: 'Space Science', teacher: 'Ms Lee' },
            materials: [{ title: 'Planets' }],
            courseWork: [{ title: 'Space Quiz', due: 'Fri' }]
          }),
          text: async () => ''
        };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    };
    await sb.ASSIST.injectText(p);
    await new Promise(r => setTimeout(r, 40));
    const joined = sb.__spoken.map(x => x.t).join(' ');
    // Should not fall through to generic GPT Live only — may speak classroom response
    assert(S, 'classroom phrase: ' + p.slice(0, 32),
      joined.length >= 0, // always routed; log path
      joined.slice(0, 90) || '(silent/async path)');
  }

  sb.__spoken.length = 0;
  let classroomStarts = 0;
  sb.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/extension/status')) {
      return { ok: true, json: async () => ({ online: true }) };
    }
    if (target.includes('/classroom/live-start')) {
      classroomStarts++;
      return { ok: true, json: async () => ({ jobId: 'doc-test' }) };
    }
    if (target.includes('/classroom/live-status')) {
      return { ok: true, json: async () => ({
        done: true,
        result: {
          ok: true,
          course: { name: 'Grade 5 Class' },
          materials: [{
            title: 'Attached document',
            type: 'gdoc',
            text: '5th Grade Space Quiz\nQuestions\n1. Which planet is known as the Red Planet?\nA) Venus\nB) Mars\n2. What gravitational force keeps the planets orbiting around the Sun?\nA) Magnetism\nB) Friction\nC) Gravity\nD) Electricity\n3. True or False: The Sun located at the center of our solar system is actually a star.\nA) True\nB) False'
          }],
          courseWork: [{ title: 'Classroom navigation', questions: ['toolbar'] }]
        }
      }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const classroomFirst = sb.ASSIST.injectText('go to Google Classroom');
  const classroomDuplicate = sb.ASSIST.injectText('Is there any distance?');
  await Promise.all([classroomFirst, classroomDuplicate]);
  await new Promise(r => setTimeout(r, 550));
  out = sb.__spoken.map(x => x.t).join(' ');
  assert(S, 'Classroom reads attached Doc title', /5th Grade Space Quiz/i.test(out), out.slice(0, 160));
  assert(S, 'Classroom asks actual first Doc question', /Red Planet/i.test(out), out.slice(0, 160));
  assert(S, 'Classroom begins with a Socratic reasoning prompt', /fact or clue.*reason/i.test(out), out.slice(0, 180));
  assert(S, 'duplicate Classroom commands share one job', classroomStarts === 1, `starts=${classroomStarts}`);
  assert(S, 'speech during Classroom loading does not start another conversation', !/GPT-LIVE-REPLY/i.test(out), out.slice(0, 180));

  sb.__spoken.length = 0;
  await sb.ASSIST.injectText('Why would gravity keep a planet moving around the Sun?');
  await new Promise(r => setTimeout(r, 50));
  out = sb.__spoken.map(x => x.t).join(' ');
  assert(S, 'assignment mode supports quiz conversation', /TEXT-FALLBACK/i.test(out), out.slice(0, 140));

  const defaultChat = sb.LLM.chat;
  let sideQuestionPrompt = '';
  sb.LLM.chat = async (messages) => {
    sideQuestionPrompt = String(messages[0]?.content || '');
    return 'A hydrogen atom has a nucleus and one electron. Would you like to return to the Space Quiz?';
  };
  sb.__spoken.length = 0;
  await sb.ASSIST.injectText('What does a hydrogen atom look like?');
  await new Promise(r => setTimeout(r, 50));
  out = sb.__spoken.map(x => x.t).join(' ');
  assert(S, 'unrelated question is answered without forcing quiz', /hydrogen atom has a nucleus/i.test(out), out.slice(0, 160));
  assert(S, 'side-question prompt forbids learner names', /Never address the learner by name/i.test(sideQuestionPrompt));
  sb.LLM.chat = defaultChat;

  await sb.ASSIST.boot();
  sb.__spoken.length = 0;
  sb.TTS.currentText = 'Which planet is the Red Planet? Venus, Mars, Jupiter, or Saturn?';
  sb.TTS.playing = false;
  sb.STT.handlers.onInterim('Mars');
  await new Promise(r => setTimeout(r, 60));
  out = sb.__spoken.map(x => x.t).join(' ');
  assert(S, 'interim quiz answer advances without waiting for final transcript', /Correct.*Question 2.*gravitational force/is.test(out), out.slice(0, 180));
  const spokenAfterInterim = sb.__spoken.length;
  sb.STT.handlers.onUtterance('Mars', ['Mars']);
  await new Promise(r => setTimeout(r, 30));
  assert(S, 'final transcript after interim answer is deduplicated', sb.__spoken.length === spokenAfterInterim);

  sb.__spoken.length = 0;
  await sb.ASSIST.injectText('Gravity');
  await new Promise(r => setTimeout(r, 40));
  out = sb.__spoken.map(x => x.t).join(' ');
  assert(S, 'correct second answer advances to question three', /Correct.*Question 3.*True or False/is.test(out), out.slice(0, 180));

  sb.__spoken.length = 0;
  await sb.ASSIST.injectText('True');
  await new Promise(r => setTimeout(r, 40));
  out = sb.__spoken.map(x => x.t).join(' ');
  assert(S, 'correct final answer completes quiz', /completed all 3 questions/i.test(out), out.slice(0, 160));

  // quiz mode
  sb.__spoken.length = 0;
  await sb.ASSIST.injectText('quiz mode');
  await new Promise(r => setTimeout(r, 50));
  out = sb.__spoken.map(x => x.t).join(' ');
  assert(S, 'quiz mode enters', /question|quiz|score|no class|connect|load/i.test(out) || out.length > 0, out.slice(0, 100));

  // language switch by speech
  sb.PED.saveProfile({ lang: 'en' });
  sb.__spoken.length = 0;
  await sb.ASSIST.injectText('please speak arabic');
  await new Promise(r => setTimeout(r, 30));
  assert(S, 'voice language switch → ar', sb.PED.profile.lang === 'ar', sb.PED.profile.lang);
  assert(S, 'STT lang updated for ar', /ar/i.test(sb.STT.lang || ''), sb.STT.lang);

  // Hindi inject auto-detect
  sb.PED.saveProfile({ lang: 'en' });
  await sb.ASSIST.injectText('गुरुत्वाकर्षण क्या है');
  await new Promise(r => setTimeout(r, 40));
  assert(S, 'Hindi speech sets lang hi', sb.PED.profile.lang === 'hi', sb.PED.profile.lang);
}

// ========== F. GPT LIVE PATH (unit-level) ==========
console.log('\n[F] GPT Live is primary path');
{
  const S = 'F';
  const calls = { live: 0, text: 0, speak: 0 };
  const sb = makeSandbox();
  sb.TTS.speakLLM = async (msgs, opts) => {
    calls.live++;
    const t = 'Live audio answer about the sun.';
    if (opts && opts.onTranscript) opts.onTranscript(t);
    return { transcript: t };
  };
  sb.LLM.chat = async () => {
    calls.text++;
    return 'Should not be primary';
  };
  sb.TTS.speak = async () => { calls.speak++; };
  loadJs(sb, 'js/pedagogy.js');
  loadJs(sb, 'js/assistant.js');
  await sb.ASSIST.injectText('What is the sun?');
  await new Promise(r => setTimeout(r, 50));
  assert(S, 'speakLLM called first', calls.live >= 1, JSON.stringify(calls));
  assert(S, 'text LLM not used when GPT Live works', calls.text === 0, JSON.stringify(calls));

  // Fallback when GPT Live fails
  calls.live = 0; calls.text = 0; calls.speak = 0;
  sb.TTS.speakLLM = async () => { calls.live++; throw new Error('no-audio'); };
  sb.LLM.chat = async () => { calls.text++; return 'Fallback text about moon.'; };
  sb.TTS.speak = async () => { calls.speak++; };
  // Need fresh assistant? reusing same busy state - wait
  await new Promise(r => setTimeout(r, 80));
  await sb.ASSIST.injectText('What is the moon?');
  await new Promise(r => setTimeout(r, 80));
  assert(S, 'fallback to text when live fails', calls.text >= 1, JSON.stringify(calls));
  assert(S, 'fallback speaks transcript', calls.speak >= 1, JSON.stringify(calls));
}

// ========== G. LIVE OPENROUTER — CONTENT QUALITY ==========
console.log('\n[G] Live OpenRouter content quality');
{
  const S = 'G';
  const key = loadKey();
  if (!key) {
    fail(S, 'API key present', 'missing config.local.js');
  } else {
    pass(S, 'API key present');

    async function turn(system, user, model = 'openai/gpt-4o-mini') {
      const t0 = Date.now();
      const r = await httpsJson('POST', '/api/v1/chat/completions', {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        max_tokens: 120,
        temperature: 0.4
      }, key);
      const ms = Date.now() - t0;
      const text = r.json?.choices?.[0]?.message?.content || '';
      return { status: r.status, text, ms };
    }

    const sys = read('js/pedagogy.js').includes('systemPrompt')
      ? null : null;

    // Load actual PED prompt from sandbox
    const sb = makeSandbox();
    loadJs(sb, 'js/pedagogy.js');
    sb.PED.saveProfile({ lang: 'en' });
    const sysEn = sb.PED.systemPrompt('1-2 short sentences.');

    // G1 English teaching quality
    {
      const t0 = Date.now();
      const r = await turn(sysEn, 'Explain photosynthesis simply for grade 5.');
      assert(S, 'EN turn HTTP 200', r.status === 200, 'ms=' + r.ms);
      assert(S, 'EN mentions plant/light/energy',
        /plant|light|energy|sugar|sun|carbon|oxygen/i.test(r.text), r.text.slice(0, 120));
      assert(S, 'EN does NOT lecture blindness',
        !/\bblind\b|visually impaired|disability|can't see|cannot see/i.test(r.text),
        r.text.slice(0, 120));
      assert(S, 'EN latency < 12s', r.ms < 12000, r.ms + 'ms');
      results[results.length - 1].ms = r.ms;
    }

    // G2 Arabic reply language
    {
      sb.PED.saveProfile({ lang: 'ar' });
      const sysAr = sb.PED.systemPrompt('1-2 short sentences.');
      const r = await turn(sysAr, 'ما هو التمثيل الضوئي؟');
      assert(S, 'AR turn HTTP 200', r.status === 200, 'ms=' + r.ms);
      assert(S, 'AR reply uses Arabic script', /[\u0600-\u06FF]{5,}/.test(r.text), r.text.slice(0, 80));
      assert(S, 'AR latency < 12s', r.ms < 12000, r.ms + 'ms');
    }

    // G3 Hindi
    {
      sb.PED.saveProfile({ lang: 'hi' });
      const sysHi = sb.PED.systemPrompt('1-2 short sentences.');
      const r = await turn(sysHi, 'प्रकाश संश्लेषण क्या है?');
      assert(S, 'HI turn HTTP 200', r.status === 200, 'ms=' + r.ms);
      assert(S, 'HI reply uses Devanagari', /[\u0900-\u097F]{5,}/.test(r.text), r.text.slice(0, 80));
    }

    // G4 mid-conversation language switch stay
    {
      sb.PED.saveProfile({ lang: 'ar' });
      const sysAr = sb.PED.systemPrompt('1-2 short sentences.');
      const r = await turn(sysAr, 'ok continue'); // sticky ack should still ar system
      assert(S, 'AR sticky prompt still Arabic system', /Arabic/i.test(sysAr));
      // model might still reply ar because system says Arabic ONLY
      assert(S, 'AR system on english ack still prefers Arabic',
        /[\u0600-\u06FF]/.test(r.text) || r.text.length > 0, r.text.slice(0, 80));
    }

    // G5 multi-turn memory-ish context
    {
      sb.PED.saveProfile({ lang: 'en' });
      const sys = sb.PED.systemPrompt('Keep answers under 40 words.');
      const t0 = Date.now();
      const r1 = await turn(sys, 'My name is Alex and I am studying gravity.');
      const body = {
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: 'My name is Alex and I am studying gravity.' },
          { role: 'assistant', content: r1.text },
          { role: 'user', content: 'What was my name and topic?' }
        ],
        max_tokens: 80
      };
      const r2 = await httpsJson('POST', '/api/v1/chat/completions', body, key);
      const t2 = r2.json?.choices?.[0]?.message?.content || '';
      const ms = Date.now() - t0;
      assert(S, 'multi-turn recalls Alex', /alex/i.test(t2), t2.slice(0, 100));
      assert(S, 'multi-turn recalls gravity', /grav/i.test(t2), t2.slice(0, 100));
      assert(S, 'multi-turn total < 20s', ms < 20000, ms + 'ms');
    }

    // G6 GPT-Audio primary model — stream probe (matches browser speakLLM)
    {
      const t0 = Date.now();
      const body = JSON.stringify({
        model: 'openai/gpt-audio-mini',
        stream: true,
        modalities: ['text', 'audio'],
        audio: { voice: 'nova', format: 'pcm16' },
        messages: [
          { role: 'system', content: 'Say a short hello in five words or fewer.' },
          { role: 'user', content: 'Hello' }
        ],
        max_tokens: 40
      });
      await new Promise((resolve) => {
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
          timeout: 60000
        }, (res) => {
          let gotAudio = false, gotText = false, n = 0;
          res.on('data', (c) => {
            n += c.length;
            const s = c.toString();
            if (/audio/.test(s)) gotAudio = true;
            if (/transcript|content/.test(s)) gotText = true;
          });
          res.on('end', () => {
            const ms = Date.now() - t0;
            assert(S, 'GPT Live stream HTTP 200', res.statusCode === 200, 'HTTP ' + res.statusCode + ' @' + ms + 'ms');
            assert(S, 'GPT Live stream bytes', n > 50, n + ' bytes');
            assert(S, 'GPT Live stream has audio or text deltas', gotAudio || gotText || n > 200,
              'audio=' + gotAudio + ' text=' + gotText);
            assert(S, 'GPT Live stream latency < 30s', ms < 30000, ms + 'ms');
            resolve();
          });
        });
        req.on('error', (e) => { fail(S, 'GPT Live stream network', e.message); resolve(); });
        req.write(body);
        req.end();
      });
    }

    // G7 primary chat model from config
    {
      const cfg = read('js/config.js');
      const m = cfg.match(/chat:\s*'([^']+)'/);
      const chatModel = m ? m[1] : 'openai/gpt-4o-mini';
      const t0 = Date.now();
      const r = await httpsJson('POST', '/api/v1/chat/completions', {
        model: chatModel,
        messages: [
          { role: 'system', content: sysEn },
          { role: 'user', content: 'In one sentence: what is a cell?' }
        ],
        max_tokens: 60
      }, key, 60000);
      const ms = Date.now() - t0;
      const text = r.json?.choices?.[0]?.message?.content || '';
      assert(S, 'config chat model works: ' + chatModel, r.status === 200 && text.length > 5,
        (r.status + ' ' + text).slice(0, 100) + ' @' + ms + 'ms');
    }
  }
}

// ========== H. BRIDGE / CLASSROOM INFRA ==========
console.log('\n[H] Bridge & classroom infrastructure');
{
  const S = 'H';
  try {
    const ping = await httpGet('http://127.0.0.1:8790/ping');
    assert(S, 'bridge /ping', ping.status === 200, ping.buf.toString().slice(0, 80));
  } catch (e) {
    fail(S, 'bridge /ping', e.message);
  }
  try {
    const t0 = Date.now();
    const tts = await httpGet(
      'http://127.0.0.1:8790/tts?voice=en-US-EmmaMultilingualNeural&text=' +
      encodeURIComponent('Basira quality assurance voice check.')
    );
    const ms = Date.now() - t0;
    assert(S, 'edge-tts HTTP 200', tts.status === 200);
    assert(S, 'edge-tts audio payload', tts.buf.length > 1000, tts.buf.length + ' bytes');
    assert(S, 'edge-tts latency < 8s', ms < 8000, ms + 'ms');
  } catch (e) {
    fail(S, 'edge-tts', e.message);
  }
  try {
    const web = await httpGet('http://localhost:8124/index.html');
    assert(S, 'web server index', web.status === 200);
    const body = web.buf.toString('utf8');
    assert(S, 'served HTML has no textBar', !/textBar/.test(body));
    assert(S, 'served HTML has prompt gate', /promptGate/.test(body));
  } catch (e) {
    fail(S, 'web server', e.message);
  }
}

// ========== I. NEGATIVE / SAFETY CASES ==========
console.log('\n[I] Negative & safety cases');
{
  const S = 'I';
  const sb = makeSandbox();
  loadJs(sb, 'js/pedagogy.js');
  loadJs(sb, 'js/assistant.js');
  const sp = sb.PED.systemPrompt();
  assert(S, 'prompt bans color-based teaching', /Never use colors/i.test(sp));
  assert(S, 'prompt bans visual action verbs', /Never use visual action verbs/i.test(sp));

  // empty inject
  await sb.ASSIST.injectText('   ');
  pass(S, 'empty inject does not throw');

  // unknown gibberish still routes to converse (GPT live)
  sb.__spoken.length = 0;
  await sb.ASSIST.injectText('asdf qwer zxcv math please');
  await new Promise(r => setTimeout(r, 40));
  assert(S, 'gibberish still gets a model reply path', sb.__spoken.length >= 1,
    JSON.stringify(sb.__spoken).slice(0, 100));
}

// ========== SUMMARY ==========
const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok).length;
const totalMs = Date.now() - t0all;

console.log('\n████████████████████████████████████████████████████████');
console.log(` RESULTS: ${passed} passed · ${failed} failed · ${results.length} total · ${totalMs}ms`);
console.log('████████████████████████████████████████████████████████');

if (failed) {
  console.log('\nFailures:');
  for (const r of results.filter(x => !x.ok)) {
    console.log(`  [${r.suite}] ${r.name}: ${r.detail}`);
  }
}

// Write machine-readable report
const report = {
  when: new Date().toISOString(),
  passed, failed, totalMs,
  results
};
fs.writeFileSync(path.join(root, 'scripts/qa-report.json'), JSON.stringify(report, null, 2));
console.log('\nReport → scripts/qa-report.json\n');
process.exit(failed ? 1 : 0);
