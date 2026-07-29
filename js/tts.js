/* ============================================================================
 * tts.js — the voice.
 *
 * PRIMARY  speakLLM(messages)  — "GPT Live": openai/gpt-audio-mini via
 *   OpenRouter. The model ITSELF answers with audio + an aligned transcript
 *   stream, so audio and captions can never disagree (same generation).
 *   pcm16 @24kHz streamed into WebAudio with a small prebuffer.
 *
 * FALLBACK speak(text) — edge-tts bridge (exact words) else system voice.
 * ========================================================================== */
(function () {
  const C = window.B_CONFIG;
  const BRIDGE = C.bridge || 'http://127.0.0.1:8790';
  const SRATE = 24000;

  let generation = 0;
  let voiceIdx = 0;
  let currentText = '';
  let speakingUntil = 0;
  let player = null;
  let sysActive = false;
  let audioCtx = null;
  let sources = [];
  let activeReader = null;
  const cache = new Map();

  function actx() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SRATE }); }
      catch (_) { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  /* ================= GPT LIVE: stream audio answer ================= */
  /**
   * speakLLM(messages, {voice, onTranscript, maxTokens})
   * Returns { transcript } after playback finishes (or is interrupted).
   * Throws on any failure → caller falls back to text model + speak().
   */
  async function speakLLM(messages, opts = {}) {
    if (!C.openRouterKey) throw new Error('no-key');
    const gen = ++generation;
    speakingUntil = Infinity;

    const body = {
      model: C.models.tts || 'openai/gpt-audio-mini',
      stream: true,
      modalities: ['text', 'audio'],
      audio: { voice: opts.voice || C.ttsVoice || 'nova', format: 'pcm16' },
      messages,
      max_tokens: opts.maxTokens || 900
    };

    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + C.openRouterKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error('http-' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 160));

    const a = actx();
    const reader = r.body.getReader();
    activeReader = reader;
    const dec = new TextDecoder();
    let buf = '';
    let transcript = '';
    let nextTime = 0;
    let gotAudio = false;

    const playChunk = (b64) => {
      if (gen !== generation || !b64) return;
      const bin = atob(b64);
      const n = bin.length >> 1;
      if (!n) return;
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const f32 = new Float32Array(n);
      const dv = new DataView(bytes.buffer);
      for (let i = 0; i < n; i++) f32[i] = dv.getInt16(i * 2, true) / 32768;
      const buffer = a.createBuffer(1, n, SRATE);
      buffer.copyToChannel(f32, 0);
      const src = a.createBufferSource();
      src.buffer = buffer;
      src.connect(a.destination);
      const startAt = Math.max(a.currentTime + 0.03, nextTime);
      src.start(startAt);
      nextTime = startAt + buffer.duration;
      sources.push(src);
      gotAudio = true;
      src.onended = () => { sources = sources.filter(s => s !== src); };
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done || gen !== generation) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const j = JSON.parse(payload);
          const delta = j.choices?.[0]?.delta || j.choices?.[0]?.message;
          if (delta?.audio?.data) playChunk(delta.audio.data);
          const tr = delta?.audio?.transcript || delta?.content;
          if (tr) {
            transcript += tr;
            currentText = transcript;
            if (opts.onTranscript) opts.onTranscript(transcript);
          }
        } catch (_) {}
      }
    }
    activeReader = null;
    if (!gotAudio && !transcript) throw new Error('no-audio');

    // wait for scheduled audio to finish
    await new Promise((res) => {
      const tick = () => {
        if (gen !== generation) return res();
        if (sources.length === 0 && nextTime <= a.currentTime + 0.05) return res();
        setTimeout(tick, 60);
      };
      tick();
    });
    if (gen === generation) speakingUntil = Date.now() + 350;
    return { transcript };
  }

  /* ================= fallback: edge-tts / system voice ================= */
  function speakSystem(text, gen) {
    return new Promise((res) => {
      if (gen !== generation) return res();
      const synth = window.speechSynthesis;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US'; u.rate = 1.08; u.pitch = 1.0;
      const vs = synth.getVoices();
      u.voice =
        vs.find(v => /Samantha/i.test(v.name)) ||
        vs.find(v => /Alex/i.test(v.name)) ||
        vs.find(v => /Google US English/i.test(v.name)) ||
        vs.find(v => /Microsoft .*(Aria|Jenny|Guy).*Natural/i.test(v.name)) ||
        vs.find(v => (v.lang || '').toLowerCase().startsWith('en')) || null;
      sysActive = true;
      u.onend = () => { sysActive = false; res(); };
      u.onerror = () => { sysActive = false; res(); };
      synth.speak(u);
    });
  }

  async function fetchEdge(text) {
    const voice = (C.voices && C.voices[voiceIdx % C.voices.length]) || 'en-US-EmmaMultilingualNeural';
    const key = voiceIdx + '|' + text;
    if (cache.has(key)) return cache.get(key);
    const url = BRIDGE + '/tts?voice=' + encodeURIComponent(voice) + '&text=' + encodeURIComponent(text);
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('edge-' + r.status);
    const obj = URL.createObjectURL(await r.blob());
    cache.set(key, obj);
    return obj;
  }

  function playUrl(url, gen) {
    return new Promise((res) => {
      if (gen !== generation) return res();
      try { if (player) { player.pause(); player.src = ''; } } catch (_) {}
      player = new Audio(url);
      player.onended = () => res();
      player.onerror = () => res();
      player.play().catch(() => res());
    });
  }

  async function speak(text) {
    if (!text || !text.trim()) return;
    stop();
    const gen = ++generation;
    currentText = text;
    speakingUntil = Infinity;
    const edgePromise = fetchEdge(text).catch(() => null);
    const winner = await Promise.race([
      edgePromise.then(u => u ? { u } : null),
      new Promise(r => setTimeout(() => r(null), 3000))
    ]);
    if (gen !== generation) return;
    if (winner) {
      await playUrl(winner.u || winner, gen);
      if (gen === generation) speakingUntil = Date.now() + 300;
      return;
    }
    await speakSystem(text, gen);
    if (gen === generation) speakingUntil = Date.now() + 400;
  }

  function prewarm() {
    try { actx(); } catch (_) {}
    try { window.speechSynthesis.getVoices(); } catch (_) {}
    fetch(BRIDGE + '/ping', { signal: AbortSignal.timeout(800) }).catch(() => {});
  }

  function stop() {
    generation++;
    try { if (activeReader) activeReader.cancel(); } catch (_) {}
    activeReader = null;
    sources.forEach(s => { try { s.stop(); } catch (_) {} });
    sources = [];
    try { if (player) { player.pause(); player.src = ''; } } catch (_) {}
    player = null;
    window.speechSynthesis.cancel();
    sysActive = false;
    speakingUntil = Date.now() + 250;
  }

  function cycleVoice() {
    const list = C.voices || ['en-US-EmmaMultilingualNeural'];
    voiceIdx = (voiceIdx + 1) % list.length;
    const orVoices = ['nova', 'alloy', 'shimmer', 'echo', 'fable', 'onyx', 'coral'];
    const i = orVoices.indexOf(C.ttsVoice || 'nova');
    C.ttsVoice = orVoices[(i + 1) % orVoices.length];
    return list[voiceIdx].replace(/en-US-|MultilingualNeural|Neural/g, '') + ' / ' + C.ttsVoice;
  }

  window.TTS = {
    speak, speakLLM, stop, prewarm, cycleVoice,
    get currentText() { return currentText; },
    get speaking() {
      return sources.length > 0 || !!(player && !player.paused) || sysActive || Date.now() < speakingUntil;
    }
  };
})();
