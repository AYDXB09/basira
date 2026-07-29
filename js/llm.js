/* ============================================================================
 * llm.js — OpenRouter client. One multimodal model (qwen3.7-plus) does all.
 * ========================================================================== */
(function () {
  const C = window.B_CONFIG;

  async function chat(messages, opts = {}) {
    if (!C.openRouterKey) throw new Error('no-key');
    const body = {
      model: C.models.chat,
      messages,
      temperature: opts.temperature ?? 0.5,
      max_tokens: opts.maxTokens ?? 800,
      reasoning: { enabled: false }
    };
    if (opts.json) body.response_format = { type: 'json_object' };

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), C.timeoutMs);
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + C.openRouterKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      if (!r.ok) throw new Error('http-' + r.status);
      const data = await r.json();
      const txt = data?.choices?.[0]?.message?.content || '';
      if (!txt.trim()) throw new Error('empty');
      return txt.trim();
    } finally {
      clearTimeout(t);
    }
  }

  /** chat + robust JSON extraction */
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

  window.LLM = { chat, chatJSON };
})();
