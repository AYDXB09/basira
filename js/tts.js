/* ============================================================================
 * tts.js — tutor voice.
 * Priority:
 *   1. OpenRouter openai/gpt-audio-mini STREAMING (pcm16) — real neural voice
 *   2. Local edge-tts bridge (127.0.0.1:8790) if running
 *   3. Web Speech system voice (never fails)
 *
 * OpenRouter requires: stream:true + audio.format:"pcm16" (only format when streaming)
 * ========================================================================== */
(function () {
  const C = window.B_CONFIG;
  const BRIDGE = C.bridge || 'http://127.0.0.1:8790';
  const SAMPLE_RATE = 24000; // OpenAI realtime / gpt-audio pcm16 rate

  let generation = 0;
  let voiceIdx = 0;
  let currentText = '';
  let speakingUntil = 0;
  let audioCtx = null;
  let activeSources = [];
  let bridgeAlive = null;
  const cache = new Map(); // key -> object URL (bridge only)

  function ctx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  /* ---------------- OpenRouter streaming gpt-audio (pcm16) ---------------- */
  async function streamPremium(text, gen) {
    if (!C.openRouterKey) throw new Error('no-key');
    const body = {
      model: C.models.tts || 'openai/gpt-audio-mini',
      stream: true,                          // REQUIRED
      modalities: ['text', 'audio'],
      audio: { voice: C.ttsVoice || 'nova', format: 'pcm16' }, // ONLY pcm16 when stream=true
      messages: [
        { role: 'system', content: 'You are a text-to-speech engine. Speak the user text EXACTLY as written, warmly and clearly. Do not add or remove words.' },
        { role: 'user', content: text }
      ],
      max_tokens: 4000
    };

    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + C.openRouterKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const err = await r.text().catch(() => '');
      throw new Error('tts-http-' + r.status + ' ' + err.slice(0, 200));
    }

    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let nextTime = 0;
    let played = false;
    const a = ctx();

    const playPcmChunk = (b64) => {
      if (gen !== generation || !b64) return;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      // pcm16 little-endian mono → float32
      const n = bytes.length >> 1;
      if (n < 1) return;
      const f32 = new Float32Array(n);
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < n; i++) f32[i] = view.getInt16(i * 2, true) / 32768;
      const buffer = a.createBuffer(1, n, SAMPLE_RATE);
      buffer.copyToChannel(f32, 0);
      const src = a.createBufferSource();
      src.buffer = buffer;
      src.connect(a.destination);
      const startAt = Math.max(a.currentTime + 0.02, nextTime || a.currentTime + 0.02);
      src.start(startAt);
      nextTime = startAt + buffer.duration;
      activeSources.push(src);
      played = true;
      src.onended = () => {
        activeSources = activeSources.filter(s => s !== src);
      };
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
          const data = delta?.audio?.data;
          if (data) playPcmChunk(data);
        } catch (_) { /* partial json */ }
      }
    }
    if (!played) throw new Error('no-audio-chunks');

    // wait until scheduled audio finishes
    await new Promise((res) => {
      const tick = () => {
        if (gen !== generation) return res();
        if (activeSources.length === 0 && nextTime <= a.currentTime + 0.05) return res();
        setTimeout(tick, 80);
      };
      tick();
    });
  }

  /* ---------------- local bridge (edge-tts) ---------------- */
  async function pingBridge() {
    try {
      const r = await fetch(BRIDGE + '/ping', { signal: AbortSignal.timeout(800) });
      bridgeAlive = r.ok;
    } catch (_) { bridgeAlive = false; }
    return bridgeAlive;
  }

  async function fetchBridge(text) {
    const voice = (C.voices && C.voices[voiceIdx % C.voices.length]) || 'en-US-EmmaMultilingualNeural';
    const url = BRIDGE + '/tts?voice=' + encodeURIComponent(voice) + '&text=' + encodeURIComponent(text);
    const r = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!r.ok) throw new Error('bridge-' + r.status);
    return URL.createObjectURL(await r.blob());
  }

  function playUrl(url, gen) {
    return new Promise((res) => {
      if (gen !== generation) return res();
      const a = new Audio(url);
      a.onended = () => res();
      a.onerror = () => res();
      activeSources.push(a);
      a.play().catch(() => res());
    });
  }

  /* ---------------- system voice fallback ---------------- */
  function chunkText(text) {
    const sentences = String(text).replace(/\s+/g, ' ').match(/[^.!?؟।]+[.!?؟।]*/g) || [String(text)];
    const chunks = []; let buf = '';
    for (const s of sentences) {
      if ((buf + ' ' + s).length > 240 && buf) { chunks.push(buf.trim()); buf = s; }
      else buf = buf ? buf + ' ' + s : s;
    }
    if (buf.trim()) chunks.push(buf.trim());
    return chunks;
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
        u.voice = vs.find(v => /Natural|Neural|Ava|Aria|Jenny|Emma/i.test(v.name)) ||
                  vs.find(v => /Google US English/i.test(v.name)) ||
                  vs.find(v => v.lang && v.lang.startsWith('en')) || null;
        u.onend = next; u.onerror = next;
        synth.speak(u);
      };
      next();
    });
  }

  /* ---------------- public ---------------- */
  async function speak(text) {
    if (!text || !text.trim()) return;
    stop();
    const gen = ++generation;
    currentText = text;
    speakingUntil = Infinity;

    try {
      // 1) OpenRouter GPT Audio streaming (works on GitHub Pages with a key)
      if (C.openRouterKey) {
        try {
          await streamPremium(text, gen);
          if (gen === generation) speakingUntil = Date.now() + 400;
          return;
        } catch (e) {
          console.warn('[tts] openrouter audio failed:', e.message || e);
        }
      }

      // 2) local neural bridge
      if (bridgeAlive !== false) {
        if (bridgeAlive === null) await pingBridge();
        if (bridgeAlive) {
          try {
            const chunks = chunkText(text);
            for (const c of chunks) {
              if (gen !== generation) return;
              const key = voiceIdx + '|' + c;
              let url = cache.get(key);
              if (!url) { url = await fetchBridge(c); cache.set(key, url); }
              await playUrl(url, gen);
            }
            if (gen === generation) speakingUntil = Date.now() + 400;
            return;
          } catch (_) { bridgeAlive = false; }
        }
      }

      // 3) system voice
      await speakSystem(text, gen);
    } finally {
      if (gen === generation) speakingUntil = Date.now() + 700;
    }
  }

  function prewarm(lines) {
    // kick AudioContext unlock + optional bridge ping; premium is streamed live
    try { ctx(); } catch (_) {}
    pingBridge();
    void lines;
  }

  function stop() {
    generation++;
    activeSources.forEach(s => {
      try { if (s.stop) s.stop(); } catch (_) {}
      try { if (s.pause) { s.pause(); s.src = ''; } } catch (_) {}
    });
    activeSources = [];
    window.speechSynthesis.cancel();
    speakingUntil = Date.now() + 400;
  }

  function cycleVoice() {
    const list = C.voices || ['nova', 'alloy', 'shimmer', 'echo'];
    // cycle OpenRouter voices when using premium; also cycle bridge names
    const orVoices = ['nova', 'alloy', 'shimmer', 'echo', 'fable', 'onyx', 'coral'];
    const i = orVoices.indexOf(C.ttsVoice || 'nova');
    C.ttsVoice = orVoices[(i + 1) % orVoices.length];
    voiceIdx = (voiceIdx + 1) % Math.max(list.length, 1);
    return C.ttsVoice;
  }

  window.TTS = {
    speak, stop, prewarm, cycleVoice,
    get currentText() { return currentText; },
    get speaking() {
      return activeSources.length > 0 || window.speechSynthesis.speaking || Date.now() < speakingUntil;
    }
  };
})();
