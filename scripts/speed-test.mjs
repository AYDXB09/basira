import fs from 'fs';
import https from 'https';
import http from 'http';

const key = fs.readFileSync('js/config.local.js', 'utf8').match(/openRouterKey\s*=\s*'([^']+)'/)[1];
const results = [];

function chatStream(model, messages, maxTokens = 200, timeoutMs = 30000) {
  const body = JSON.stringify({ model, messages, max_tokens: maxTokens, stream: true, temperature: 0.4 });
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    let firstByteMs = null, fullText = '', chunkCount = 0;
    const req = https.request({
      hostname: 'openrouter.ai', path: '/api/v1/chat/completions', method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: timeoutMs
    }, (res) => {
      let buf = '';
      res.on('data', (c) => {
        if (firstByteMs === null) firstByteMs = performance.now() - t0;
        chunkCount++;
        buf += c.toString();
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const p = line.slice(6).trim();
          if (!p || p === '[DONE]') continue;
          try {
            const j = JSON.parse(p);
            const delta = j.choices?.[0]?.delta || j.choices?.[0]?.message;
            const tr = delta?.content || delta?.audio?.transcript || '';
            if (tr) fullText += tr;
          } catch (_) {}
        }
      });
      res.on('end', () => resolve({
        status: res.statusCode,
        totalMs: performance.now() - t0,
        firstByteMs: firstByteMs ?? (performance.now() - t0),
        text: fullText,
        chunks: chunkCount
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function gptAudioStream(messages, maxTokens = 200, timeoutMs = 35000) {
  const body = JSON.stringify({
    model: 'openai/gpt-audio-mini', stream: true,
    modalities: ['text', 'audio'],
    audio: { voice: 'nova', format: 'pcm16' },
    messages, max_tokens: maxTokens
  });
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    let firstByteMs = null, firstAudioMs = null, fullText = '', chunkCount = 0;
    const req = https.request({
      hostname: 'openrouter.ai', path: '/api/v1/chat/completions', method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: timeoutMs
    }, (res) => {
      let buf = '';
      res.on('data', (c) => {
        if (firstByteMs === null) firstByteMs = performance.now() - t0;
        chunkCount++;
        buf += c.toString();
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const p = line.slice(6).trim();
          if (!p || p === '[DONE]') continue;
          try {
            const j = JSON.parse(p);
            const delta = j.choices?.[0]?.delta || j.choices?.[0]?.message;
            if (delta?.audio?.data && firstAudioMs === null) firstAudioMs = performance.now() - t0;
            const tr = delta?.audio?.transcript || delta?.content || '';
            if (tr) fullText += tr;
          } catch (_) {}
        }
      });
      res.on('end', () => resolve({
        status: res.statusCode,
        totalMs: performance.now() - t0,
        firstByteMs: firstByteMs ?? (performance.now() - t0),
        firstAudioMs: firstAudioMs ?? null,
        text: fullText,
        chunks: chunkCount
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function edgeTts(text, voice = 'en-US-EmmaMultilingualNeural') {
  const url = 'http://127.0.0.1:8790/tts?voice=' + encodeURIComponent(voice) + '&text=' + encodeURIComponent(text);
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    http.get(url, { timeout: 15000 }, (res) => {
      let n = 0;
      res.on('data', (c) => n += c.length);
      res.on('end', () => resolve({ ms: performance.now() - t0, bytes: n, status: res.statusCode }));
    }).on('error', reject);
  });
}

const sys = (lang, extra = '') =>
  `You are a warm tutor by VOICE. Reply in ${lang} ONLY. 1-2 short sentences. Never discuss blindness. ${extra}`;

const scenarios = [
  { id: 'EN-short', lang: 'English', user: 'What is gravity in one sentence?', expectScript: /[A-Za-z]{4,}/ },
  { id: 'EN-medium', lang: 'English', user: 'Explain why the sky is blue simply.', expectScript: /[A-Za-z]{4,}/ },
  { id: 'AR-short', lang: 'Arabic', user: 'ما هي الجاذبية؟', expectScript: /[\u0600-\u06FF]{4,}/ },
  { id: 'AR-teach', lang: 'Arabic', user: 'اشرح التمثيل الضوئي ببساطة', expectScript: /[\u0600-\u06FF]{4,}/ },
  { id: 'HI-short', lang: 'Hindi', user: 'गुरुत्वाकर्षण क्या है?', expectScript: /[\u0900-\u097F]{4,}/ },
  { id: 'FR-short', lang: 'French', user: 'Qu\'est-ce que la gravité?', expectScript: /[A-Za-zé]{4,}/ },
  { id: 'ES-short', lang: 'Spanish', user: '¿Qué es la gravedad?', expectScript: /[A-Za-zñ]{4,}/ },
  { id: 'DE-short', lang: 'German', user: 'Was ist Schwerkraft?', expectScript: /[A-Za-zä]{4,}/ },
  { id: 'UR-short', lang: 'Urdu', user: 'ثقالت کیا ہے؟', expectScript: /[\u0600-\u06FF]{4,}/ }
];

console.log('=== SPEED + LANGUAGE SUITE ===\n');
console.log('1) CHAT MODELS (stream) — latency vs language');
const chatModels = [
  'openai/gpt-4o-mini',
  'qwen/qwen3.7-plus',
  'google/gemini-2.0-flash-001',
  'anthropic/claude-3.5-haiku'
];
for (const m of chatModels) {
  console.log('\n  Model:', m);
  for (const s of scenarios.slice(0, 4)) {
    try {
      const r = await chatStream(m, [
        { role: 'system', content: sys(s.lang) },
        { role: 'user', content: s.user }
      ], 180);
      const okScript = s.expectScript.test(r.text);
      const row = {
        model: m, test: s.id, status: r.status,
        firstByteMs: Math.round(r.firstByteMs), totalMs: Math.round(r.totalMs),
        chunks: r.chunks, okScript, textPreview: r.text.slice(0, 60)
      };
      results.push(row);
      console.log(`    ${s.id.padEnd(10)} 1st:${String(row.firstByteMs).padStart(5)}ms total:${String(row.totalMs).padStart(5)}ms script:${okScript ? 'OK' : 'FAIL'}  ${row.textPreview}`);
    } catch (e) {
      results.push({ model: m, test: s.id, error: e.message });
      console.log(`    ${s.id.padEnd(10)} ERROR ${e.message}`);
    }
  }
}

console.log('\n2) GPT LIVE (gpt-audio-mini stream) — time to first audio + transcript');
for (const s of scenarios) {
  try {
    const r = await gptAudioStream([
      { role: 'system', content: sys(s.lang) },
      { role: 'user', content: s.user }
    ], 200);
    const okScript = s.expectScript.test(r.text);
    const row = {
      model: 'gpt-audio-mini', test: s.id, status: r.status,
      firstByteMs: Math.round(r.firstByteMs),
      firstAudioMs: r.firstAudioMs ? Math.round(r.firstAudioMs) : null,
      totalMs: Math.round(r.totalMs), chunks: r.chunks, okScript,
      textPreview: r.text.slice(0, 60)
    };
    results.push(row);
    console.log(`  ${s.id.padEnd(10)} 1st:${String(row.firstByteMs).padStart(5)}ms audio:${String(row.firstAudioMs ?? '-').padStart(6)}ms total:${String(row.totalMs).padStart(5)}ms script:${okScript ? 'OK' : 'FAIL'}`);
  } catch (e) {
    results.push({ model: 'gpt-audio-mini', test: s.id, error: e.message });
    console.log(`  ${s.id.padEnd(10)} ERROR ${e.message}`);
  }
}

console.log('\n3) EDGE-TTS bridge — full turn estimate');
for (const [lang, voice, text] of [
  ['en', 'en-US-EmmaMultilingualNeural', 'Gravity is a pull between objects.'],
  ['ar', 'ar-SA-ZariyahNeural', 'الجاذبية قوة تجذب الأشياء.'],
  ['hi', 'hi-IN-SwaraNeural', 'गुरुत्वाकर्षण वस्तुओं को खींचता है।']
]) {
  try {
    const r = await edgeTts(text, voice);
    results.push({ model: 'edge-tts', test: 'edge-' + lang, totalMs: Math.round(r.ms), bytes: r.bytes });
    console.log(`  edge-${lang}  ${Math.round(r.ms)}ms  ${r.bytes}B`);
  } catch (e) { console.log('  edge-' + lang + ' ERROR ' + e.message); }
}

console.log('\n4) END-TO-END TURN ESTIMATES (chat text + TTS)');
// E2E: fastest chat model by first-byte + edge tts
const fastest = results
  .filter(r => !r.error && r.model && r.test === 'EN-short' && r.firstByteMs)
  .sort((a, b) => a.firstByteMs - b.firstByteMs);
if (fastest.length) {
  const best = fastest[0];
  const t0 = performance.now();
  const r = await chatStream(best.model, [
    { role: 'system', content: sys('English') },
    { role: 'user', content: 'What is gravity in one sentence?' }
  ], 150);
  const chatMs = performance.now() - t0;
  const tts = await edgeTts(r.text || 'Gravity pulls things together.');
  results.push({ model: 'e2e', test: 'en-chat+tts', totalMs: Math.round(chatMs + tts.ms) });
  console.log(`  best chat model: ${best.model} (${Math.round(chatMs)}ms) + edge ${Math.round(tts.ms)}ms = ~${Math.round(chatMs + tts.ms)}ms`);
}

console.log('\n=== RAW JSON → scripts/speed-report.json ===');
fs.writeFileSync('scripts/speed-report.json', JSON.stringify({ when: new Date().toISOString(), results }, null, 2));

// Summary recommendations
const byModel = {};
for (const r of results.filter(x => !x.error && x.firstByteMs)) {
  (byModel[r.model] = byModel[r.model] || []).push(r.firstByteMs);
}
console.log('\n=== RECOMMENDATION (avg first-byte ms) ===');
for (const [m, arr] of Object.entries(byModel)) {
  const avg = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  console.log(`  ${m}: ${avg}ms avg first-byte (${arr.length} samples)`);
}
