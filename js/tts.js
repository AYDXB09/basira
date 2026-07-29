/* ============================================================================
 * tts.js — the tutor's voice. Three layers, best available wins:
 *   1. LOCAL NEURAL BRIDGE (edge-tts @ 127.0.0.1:8790) — Microsoft neural
 *      voices, free, no key, ~0.5s. Run: python bridge\tts_bridge.py
 *   2. OpenRouter gpt-audio-mini (if the account's privacy settings allow it)
 *   3. Web Speech system voice (instant, never fails)
 * Long text is split into sentence chunks; chunk N+1 is fetched while chunk N
 * plays, so speech starts fast and never gaps.
 * speak() resolves when playback finishes. stop() interrupts everything.
 * ========================================================================== */
(function () {
  const C = window.B_CONFIG;
  const BRIDGE = C.bridge || 'http://127.0.0.1:8790';

  let player = null;
  let generation = 0;
  let bridgeAlive = null;     // null = unknown, then true/false (re-pinged lazily)
  let premiumDead = false;
  let voiceIdx = 0;           // index into C.voices — "change voice" cycles
  let currentText = '';       // what the tutor is saying NOW (echo filtering)
  let speakingUntil = 0;      // ms timestamp: still "hot" shortly after speech
  const cache = new Map();    // voice|chunk → object URL

  /* ---------------- bridge (edge-tts neural) ---------------- */
  async function pingBridge() {
    try {
      const r = await fetch(BRIDGE + '/ping', { signal: AbortSignal.timeout(900) });
      bridgeAlive = r.ok;
    } catch (_) { bridgeAlive = false; }
    return bridgeAlive;
  }

  async function fetchBridge(text) {
    const voice = C.voices[voiceIdx % C.voices.length];
    const url = BRIDGE + '/tts?voice=' + encodeURIComponent(voice) +
      '&text=' + encodeURIComponent(text);
    const r = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!r.ok) throw new Error('bridge-' + r.status);
    return URL.createObjectURL(await r.blob());
  }

  /* ---------------- OpenRouter premium ---------------- */
  async function fetchPremium(text) {
    const body = {
      model: C.models.tts,
      modalities: ['text', 'audio'],
      audio: { voice: C.ttsVoice, format: 'mp3' },
      messages: [
        { role: 'system', content: 'You are a text-to-speech engine. Say the user text EXACTLY as written, warmly and clearly. Do not add, remove, or comment.' },
        { role: 'user', content: text }
      ],
      max_tokens: 3000
    };
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + C.openRouterKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error('tts-http-' + r.status);
    const data = await r.json();
    const b64 = data?.choices?.[0]?.message?.audio?.data;
    if (!b64) throw new Error('tts-no-audio');
    const bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
  }

  /* ---------------- shared helpers ---------------- */
  function chunkText(text) {
    const sentences = String(text).replace(/\s+/g, ' ')
      .match(/[^.!?؟।]+[.!?؟।]*/g) || [String(text)];
    const chunks = [];
    let buf = '';
    for (const s of sentences) {
      if ((buf + ' ' + s).length > 240 && buf) { chunks.push(buf.trim()); buf = s; }
      else buf = buf ? buf + ' ' + s : s;
    }
    if (buf.trim()) chunks.push(buf.trim());
    return chunks;
  }

  async function getAudio(chunk) {
    const key = voiceIdx + '|' + chunk;
    if (cache.has(key)) return cache.get(key);
    let url = null;
    if (bridgeAlive !== false) {
      if (bridgeAlive === null) await pingBridge();
      if (bridgeAlive) {
        try { url = await fetchBridge(chunk); }
        catch (_) { bridgeAlive = false; }
      }
    }
    if (!url && !premiumDead && C.openRouterKey) {
      try { url = await fetchPremium(chunk); }
      catch (_) { premiumDead = true; }
    }
    if (url) cache.set(key, url);
    return url;                    // null → caller uses system voice
  }

  function playUrl(url, gen) {
    return new Promise((res) => {
      if (gen !== generation) return res();
      player = new Audio(url);
      player.onended = () => res();
      player.onerror = () => res();
      player.play().catch(() => res());
    });
  }

  function speakSystem(text, gen) {
    return new Promise((res) => {
      if (gen !== generation) return res();
      const synth = window.speechSynthesis;
      const parts = chunkText(text);
      let i = 0;
      const next = () => {
        if (gen !== generation || i >= parts.length) return res();
        const u = new SpeechSynthesisUtterance(parts[i++]);
        u.lang = 'en-US'; u.rate = 1.02;
        const vs = synth.getVoices();
        u.voice = vs.find(v => /Natural|Neural|Ava|Aria|Jenny/i.test(v.name)) ||
                  vs.find(v => /Google US English/i.test(v.name)) ||
                  vs.find(v => v.lang.startsWith('en')) || null;
        u.onend = next; u.onerror = next;
        synth.speak(u);
      };
      next();
    });
  }

  /* ---------------- public: speak ---------------- */
  async function speak(text) {
    if (!text || !text.trim()) return;
    stop();
    const gen = ++generation;
    currentText = text;
    speakingUntil = Infinity;
    const chunks = chunkText(text);

    try {
      // kick off ALL chunk fetches now; play in order as they land
      const fetches = chunks.map(c => getAudio(c));

      // budget for the first chunk: 1.6s, else system voice takes the whole text
      const first = await Promise.race([
        fetches[0],
        new Promise(r => setTimeout(() => r('timeout'), 1600))
      ]);
      if (gen !== generation) return;

      if (first === 'timeout' || !first) {
        return await speakSystem(text, gen);
      }

      for (let i = 0; i < chunks.length; i++) {
        if (gen !== generation) return;
        const url = await fetches[i];
        if (gen !== generation) return;
        if (!url) return await speakSystem(chunks.slice(i).join(' '), gen);
        await playUrl(url, gen);
      }
    } finally {
      if (gen === generation) speakingUntil = Date.now() + 700; // echo tail window
    }
  }

  /** pre-generate audio for known lines (greeting etc.) */
  function prewarm(lines) {
    (async () => {
      for (const t of lines) for (const c of chunkText(t)) await getAudio(c);
    })();
  }

  function stop() {
    generation++;
    if (player) { try { player.pause(); } catch (_) {} player = null; }
    window.speechSynthesis.cancel();
    speakingUntil = Date.now() + 500;
  }

  /** cycle neural voices: Emma → Andrew → Ava */
  function cycleVoice() {
    voiceIdx = (voiceIdx + 1) % C.voices.length;
    return C.voices[voiceIdx].replace(/en-US-|MultilingualNeural/g, '');
  }

  window.TTS = {
    speak, stop, prewarm, cycleVoice,
    get currentText() { return currentText; },
    get speaking() {
      return (player && !player.paused) || window.speechSynthesis.speaking ||
             Date.now() < speakingUntil;
    }
  };
})();
