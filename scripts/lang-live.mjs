import fs from 'fs';
import https from 'https';

const key = fs.readFileSync('js/config.local.js', 'utf8').match(/openRouterKey\s*=\s*'([^']+)'/)[1];
function chat(messages, model = 'openai/gpt-4o-mini') {
  const body = JSON.stringify({ model, messages, max_tokens: 90 });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'openrouter.ai', path: '/api/v1/chat/completions', method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d).choices[0].message.content); }
        catch (e) { reject(new Error(d.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const sysEn = 'You are a warm tutor. Reply in English ONLY. 1-2 short sentences. Never discuss blindness.';
const sysAr = 'You are a warm tutor. Reply in Arabic ONLY. 1-2 short sentences. Never discuss blindness.';
const sysHi = 'You are a warm tutor. Reply in Hindi ONLY. 1-2 short sentences.';

const r1 = await chat([{ role: 'system', content: sysEn }, { role: 'user', content: 'What is gravity in one sentence?' }]);
const r2 = await chat([{ role: 'system', content: sysAr }, { role: 'user', content: 'ما هي الجاذبية؟' }]);
const r3 = await chat([{ role: 'system', content: sysHi }, { role: 'user', content: 'गुरुत्वाकर्षण क्या है?' }]);
console.log('EN:', r1);
console.log('AR:', r2);
console.log('HI:', r3);
const enOk = /[A-Za-z]{4,}/.test(r1);
const arOk = /[\u0600-\u06FF]/.test(r2);
const hiOk = /[\u0900-\u097F]/.test(r3);
console.log(enOk && arOk && hiOk ? 'MULTI-LANG LIVE PASS' : 'MULTI-LANG LIVE FAIL', { enOk, arOk, hiOk });
if (!(enOk && arOk && hiOk)) process.exit(1);
