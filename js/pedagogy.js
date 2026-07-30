/* ============================================================================
 * pedagogy.js — silent teaching engine for blind learners + multi-language.
 * The student should NEVER hear a lecture about blindness or disability.
 * They should hear the SUBJECT taught in a form that works without vision.
 * ========================================================================== */
(function () {

  /*
   * Sources (teacher-side only; never recited to the student):
   * Lowenfeld 1973; Millar 1994; Fraiberg 1977; Bedny et al. 2011 PNAS;
   * Kim/Elli/Bedny 2019 PNAS; Hollins 1989; BANA tactile graphics; O&M practice.
   * Full list: data/SOURCES.md
   */

  const CORE_RULES = `TEACHING METHOD (apply silently — never name or explain these rules out loud):

1. CONCRETENESS: explain with touch, sound, body feeling, sequence, and function — not with "look/see/picture this".
2. PART-TO-WHOLE: name pieces one by one, then how they connect, then the whole.
3. SHORT AUDIO CHUNKS: one idea per short sentence; light recap; invite "shall I continue?" only when useful.
4. SPATIAL WITHOUT SIGHT: clock positions, left/right of the body, before/after in a sequence — never "here/this/that" without naming the thing.
5. MEANING OVER COLOR: if color is only a label, replace with the functional label (first line, taller bar, warmer side).
6. TEACH THE SUBJECT: charts, space, plants, math — the goal is understanding the content, not describing disability.
7. CHECK UNDERSTANDING with a tiny question when teaching something new.`;

  const LANGS = [
    { id: 'en', name: 'English',  tts: 'en-US', stt: 'en-US', edge: 'en-US-EmmaMultilingualNeural', gptHint: 'English' },
    { id: 'ar', name: 'العربية',  tts: 'ar-SA', stt: 'ar-SA', edge: 'ar-SA-ZariyahNeural', gptHint: 'Arabic (clear modern standard, natural spoken)' },
    { id: 'hi', name: 'हिन्दी',   tts: 'hi-IN', stt: 'hi-IN', edge: 'hi-IN-SwaraNeural', gptHint: 'Hindi' },
    { id: 'fr', name: 'Français', tts: 'fr-FR', stt: 'fr-FR', edge: 'fr-FR-DeniseNeural', gptHint: 'French' },
    { id: 'es', name: 'Español',  tts: 'es-ES', stt: 'es-ES', edge: 'es-ES-ElviraNeural', gptHint: 'Spanish' },
    { id: 'ur', name: 'اردو',     tts: 'ur-PK', stt: 'ur-PK', edge: 'ur-PK-UzmaNeural', gptHint: 'Urdu' },
    { id: 'de', name: 'Deutsch',  tts: 'de-DE', stt: 'de-DE', edge: 'de-DE-KatjaNeural', gptHint: 'German' },
    { id: 'pt', name: 'Português', tts: 'pt-BR', stt: 'pt-BR', edge: 'pt-BR-FranciscaNeural', gptHint: 'Portuguese' }
  ];

  const DEFAULTS = { vision: 'congenital', lang: 'en', level: 'high' };
  let profile = load() || Object.assign({}, DEFAULTS);
  let customTemplate = loadCustom();

  function load() {
    try { return JSON.parse(localStorage.getItem('basira.profile')); }
    catch (_) { return null; }
  }
  function loadCustom() {
    try { return localStorage.getItem('basira.systemPrompt') || ''; }
    catch (_) { return ''; }
  }
  function saveProfile(p) {
    profile = Object.assign({}, profile, p || {});
    try { localStorage.setItem('basira.profile', JSON.stringify(profile)); } catch (_) {}
    return profile;
  }
  function langMeta() {
    return LANGS.find(l => l.id === (profile.lang || 'en')) || LANGS[0];
  }

  function defaultTemplate() {
    return `You are a warm, skilled private tutor speaking by VOICE. You teach school subjects clearly.

IMPORTANT — WHAT YOU MUST NEVER DO:
- NEVER lecture about blindness, disability, accessibility theory, or "how blind people learn".
- NEVER say "as a blind student", "because you can't see", "people who are visually impaired", unless the student explicitly asks about disability.
- NEVER moralize or pity. Teach the math/science/history subject itself.

IMPORTANT — HOW YOU TEACH (do this quietly through your wording):
${CORE_RULES}

VOICE STYLE:
- Phone-call style. Usually 1-3 short sentences unless they ask you to go deeper.
- No markdown, bullets, emojis, stage directions, or "great question".
- Use the student's name only if memory provides one.

LANGUAGE (critical):
- Reply in {{LANG}} ONLY, matching the student's language.
- If they switch language, switch with them.

If course materials are in the context, prefer them. If none, answer generally without inventing fake homework.`;
  }

  function getTemplate() {
    return (customTemplate && customTemplate.trim()) ? customTemplate : defaultTemplate();
  }

  function setCustomTemplate(text) {
    customTemplate = String(text || '');
    try {
      if (customTemplate.trim()) localStorage.setItem('basira.systemPrompt', customTemplate);
      else localStorage.removeItem('basira.systemPrompt');
    } catch (_) {}
    return getTemplate();
  }

  function resetCustomTemplate() {
    customTemplate = '';
    try { localStorage.removeItem('basira.systemPrompt'); } catch (_) {}
    return defaultTemplate();
  }

  function systemPrompt(extra = '') {
    const L = langMeta();
    let base = getTemplate().replace(/\{\{LANG\}\}/g, L.gptHint);
    // If editor removed the language placeholder, still inject language line
    if (!/Reply in .+ ONLY/i.test(base) && !/\{\{LANG\}\}/.test(getTemplate())) {
      base += `\n\nLANGUAGE: Reply in ${L.gptHint} ONLY. If they switch language, switch with them.`;
    }
    return base + (extra ? '\n\n' + extra : '');
  }

  /** Lightweight script/keyword detection from free text.
   *  Only switches language when there is a confident signal so mid-conversation
   *  short replies ("ok", "yes", "next") do not yank the student out of Arabic/etc. */
  function detectLangId(text) {
    const s = String(text || '').trim();
    if (!s) return profile.lang || 'en';
    const cur = profile.lang || 'en';

    // Strong script signals always win
    if (/[\u0600-\u06FF]/.test(s)) {
      if (/[\u0679\u0688\u0691\u06BE\u06C1\u06D2\u06AF\u06A9]/.test(s)) return 'ur';
      return 'ar';
    }
    if (/[\u0900-\u097F]/.test(s)) return 'hi';

    const lower = s.toLowerCase();
    if (/\b(bonjour|salut|merci|comment|quoi|explique|je veux|parle français)\b/.test(lower)) return 'fr';
    if (/\b(hola|gracias|por favor|qué|como estás|explica|habla español)\b/.test(lower)) return 'es';
    if (/\b(hallo|danke|bitte|was ist|wie|erkl[äa]r|sprich deutsch)\b/.test(lower)) return 'de';
    if (/\b(olá|obrigad|por favor|como|o que|fale português|fala português)\b/.test(lower)) return 'pt';

    if (/\b(speak|talk|switch|change).{0,12}\b(english|arabi[bc]|hindi|french|spanish|urdu|german|portuguese)\b/.test(lower)
      || /\b(in english|in arabic|in hindi|in french|in spanish|in urdu|in german|in portuguese)\b/.test(lower)) {
      if (/\benglish\b/.test(lower)) return 'en';
      if (/\barabi/.test(lower)) return 'ar';
      if (/\bhindi\b/.test(lower)) return 'hi';
      if (/\bfrench\b/.test(lower)) return 'fr';
      if (/\bspanish\b/.test(lower)) return 'es';
      if (/\burdu\b/.test(lower)) return 'ur';
      if (/\bgerman\b/.test(lower)) return 'de';
      if (/\bportuguese\b/.test(lower)) return 'pt';
    }

    if (cur !== 'en' && /^[A-Za-z0-9\s',.?!-]{1,24}$/.test(s)
      && /\b(ok|okay|yes|no|yeah|yep|nope|sure|next|stop|repeat|help|continue|thanks|thank you|hi|hello)\b/i.test(s)
      && s.split(/\s+/).length <= 4) {
      return cur;
    }

    if (/[A-Za-z]{3,}/.test(s) && cur === 'en') return 'en';
    if (/[A-Za-z]{12,}/.test(s) && !/[\u0600-\u06FF\u0900-\u097F]/.test(s)) {
      if (cur === 'fr' || cur === 'es' || cur === 'de' || cur === 'pt') return cur;
      return 'en';
    }
    return cur;
  }

  function setLangFromText(text) {
    const id = detectLangId(text);
    if (id && id !== profile.lang) saveProfile({ lang: id });
    return langMeta();
  }

  window.PED = {
    systemPrompt,
    defaultTemplate,
    getTemplate,
    setCustomTemplate,
    resetCustomTemplate,
    get profile() { return profile; },
    saveProfile,
    LANGS,
    langMeta,
    detectLangId,
    setLangFromText,
    get hasCustomPrompt() { return !!(customTemplate && customTemplate.trim()); }
  };
})();
