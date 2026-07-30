/* ============================================================================
 * llm.js — OpenRouter client. Robust against empty content, array content,
 * missing key, and transient provider failures (auto-fallback model).
 * ========================================================================== */
(function () {
  const C = window.B_CONFIG;
  const FALLBACKS = [
    null, // first try primary (config.models.chat)
    'openai/gpt-4o',
    'qwen/qwen3-8b'
  ];

  function extractText(content) {
    if (content == null) return '';
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
      return content.map(p => {
        if (typeof p === 'string') return p;
        if (p && typeof p.text === 'string') return p.text;
        if (p && p.type === 'text' && p.text) return p.text;
        return '';
      }).filter(Boolean).join('\n').trim();
    }
    if (typeof content === 'object' && content.text) return String(content.text).trim();
    return String(content).trim();
  }

  /** Drop giant base64 images from history — keep short text only (API size/timeout killer). */
  function sanitizeMessages(messages) {
    return messages.map(m => {
      const role = m.role || 'user';
      const t = extractText(m.content);
      // if multimodal user turn, keep a short stub so context isn't blank
      if (Array.isArray(m.content) && m.content.some(p => p && (p.type === 'image_url' || p.image_url))) {
        return { role, content: t || '[student shared an image]' };
      }
      // cap insanely long strings
      return { role, content: t.length > 12000 ? t.slice(0, 12000) + '…' : t };
    }).filter(m => m.content);
  }

  async function chatOnce(messages, opts, model) {
    const key = C.openRouterKey;
    if (!key) {
      const err = new Error('no-key');
      err.code = 'no-key';
      throw err;
    }
    const body = {
      model: model || C.models.chat,
      messages: sanitizeMessages(messages),
      temperature: opts.temperature ?? 0.5,
      max_tokens: opts.maxTokens ?? 800
    };
    // only attach reasoning flag for qwen3* family
    if (/qwen3/i.test(body.model)) body.reasoning = { enabled: false };
    if (opts.json) body.response_format = { type: 'json_object' };

    const ctrl = new AbortController();
    const ms = opts.timeoutMs || C.timeoutMs || 60000;
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + key,
          'Content-Type': 'application/json',
          'HTTP-Referer': location.origin || 'http://localhost',
          'X-Title': 'Basira Voice Tutor'
        },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      const raw = await r.text();
      let data;
      try { data = JSON.parse(raw); } catch (_) {
        const err = new Error('bad-json-body');
        err.code = 'http-' + r.status;
        throw err;
      }
      if (!r.ok) {
        const msg = data?.error?.message || raw.slice(0, 180);
        const err = new Error('http-' + r.status + ': ' + msg);
        err.code = 'http-' + r.status;
        err.detail = msg;
        throw err;
      }
      const message = data?.choices?.[0]?.message || {};
      let txt = extractText(message.content);
      // some models put everything in reasoning / refusal
      if (!txt && message.reasoning) txt = extractText(message.reasoning);
      if (!txt && message.refusal) txt = extractText(message.refusal);
      if (!txt) {
        const err = new Error('empty');
        err.code = 'empty';
        err.detail = JSON.stringify(message).slice(0, 200);
        throw err;
      }
      return txt;
    } catch (e) {
      if (e.name === 'AbortError') {
        const err = new Error('timeout');
        err.code = 'timeout';
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(t);
    }
  }

  async function chat(messages, opts = {}) {
    let lastErr;
    for (const fb of FALLBACKS) {
      const model = fb || C.models.chat;
      try {
        return await chatOnce(messages, opts, model);
      } catch (e) {
        lastErr = e;
        console.warn('[llm]', model, e.code || e.message, e.detail || '');
        // don't burn fallbacks on missing key
        if (e.code === 'no-key') throw e;
      }
    }
    throw lastErr || new Error('llm-failed');
  }

  async function chatJSON(messages, opts = {}) {
    const raw = await chat(messages, Object.assign({ json: true }, opts));
    try { return JSON.parse(raw); } catch (_) {}
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) { try { return JSON.parse(fence[1]); } catch (_) {} }
    const s = raw.search(/[{[]/);
    if (s >= 0) {
      for (let e = raw.length; e > s; e--) {
        try { return JSON.parse(raw.slice(s, e)); } catch (_) {}
      }
    }
    throw new Error('bad-json');
  }

  function explainError(e) {
    const c = e && e.code;
    if (c === 'no-key') return 'I need an OpenRouter API key. Paste it once in the browser console with localStorage setItem basira.openRouterKey, then reload.';
    if (c === 'timeout') return 'The tutor brain timed out. Say that again, shorter if you can.';
    if (c && String(c).startsWith('http-401')) return 'The API key was rejected. Check the key and try again.';
    if (c && String(c).startsWith('http-402')) return 'OpenRouter says the account is out of credits.';
    if (c && String(c).startsWith('http-429')) return 'Too many requests. Wait a moment and ask again.';
    if (c === 'empty') return 'The model returned an empty answer. Trying again in a second usually works.';
    return 'I lost the connection for a second. Say that again?';
  }

  window.LLM = { chat, chatJSON, explainError, sanitizeMessages, extractText };
})();
