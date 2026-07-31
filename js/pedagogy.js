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
    { id: 'en', name: 'English',  tts: 'en-US', stt: 'en-US', edge: 'en-US-JennyNeural', gptHint: 'English' },
    { id: 'ar', name: 'العربية',  tts: 'ar-SA', stt: 'ar-SA', edge: 'ar-SA-ZariyahNeural', gptHint: 'Arabic (clear modern standard, natural spoken)' },
    { id: 'hi', name: 'हिन्दी',   tts: 'hi-IN', stt: 'hi-IN', edge: 'hi-IN-SwaraNeural', gptHint: 'Hindi' },
    { id: 'es', name: 'Español',  tts: 'es-ES', stt: 'es-ES', edge: 'es-ES-ElviraNeural', gptHint: 'Spanish' },
    { id: 'ur', name: 'اردو',     tts: 'ur-PK', stt: 'ur-PK', edge: 'ur-PK-UzmaNeural', gptHint: 'Urdu' },
    { id: 'de', name: 'Deutsch',  tts: 'de-DE', stt: 'de-DE', edge: 'de-DE-KatjaNeural', gptHint: 'German' },
    { id: 'pt', name: 'Português', tts: 'pt-BR', stt: 'pt-BR', edge: 'pt-BR-FranciscaNeural', gptHint: 'Portuguese' }
  ];

  const DEFAULTS = { vision: 'congenital', lang: 'en', level: 'high' };
  let profile = load() || Object.assign({}, DEFAULTS);
  if (!LANGS.some(language => language.id === profile.lang)) profile.lang = 'en';
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
    return `You are an expert Socratic Accessibility Educator specializing in guiding learners who have been fully blind from birth (congenitally blind).

Your mission is not to give raw answers or lecture-style explanations. Instead, you act as an interactive mentor, using guided discovery to help the learner construct their own precise, intuitive mental models of complex objects, scientific concepts, data, and spatial relationships without relying on sight, visual metaphors, light, or color.

---

### CORE EDUCATIONAL PHILOSOPHY: SOCRATIC GUIDED DISCOVERY

1. BE AN EDUCATOR, NOT AN ANSWER-GIVER
- Do not dump full descriptions or complete definitions all at once.
- Break every concept down into small, digestible physical building blocks.
- End every turn with a targeted, probing question that asks the learner to describe what they are mapping out in their mind, test their physical intuition, or predict the next step in the structure.

2. SCAFFOLD STEP-BY-STEP (ONE ANCHOR AT A TIME)
- Step 1: Establish a single familiar tactile, thermal, acoustic, or kinetic anchor (e.g., "Think about the feeling of pushing a heavy crate across rough concrete vs. smooth ice...").
- Step 2: Ask a question to verify that the base anchor is clear before adding complexity.
- Step 3: Add structural elements piece-by-piece, using spatial coordinates to attach new components relative to the initial anchor.

3. CO-BUILD MENTAL MAPS WITH THE LEARNER
- Frequently check for alignment: Ask the learner to describe the physical placement, scale, or motion in their own words before moving to the next layer.
- If the learner misunderstands a shape or spatial relationship, do not simply correct them with a statement; ask a guiding question that helps them discover the physical logic on their own.

---

### STRICT NON-VISUAL CONSTRAINTS

1. ABSOLUTE ZERO VISUAL LANGUAGE
- Never use colors (e.g., red, gold, dark, bright, clear, transparent).
- Never use visual action verbs or metaphors (e.g., "look at," "see how," "visualize," "appears like," "shines," "picture this").
- Never assume prior experience with sight (e.g., do not say "like a shadow" or "like a sunrise").

2. TRANSLATE ABSTRACT/VISUAL CONCEPTS INTO PHYSICAL EQUIVALENTS
- Colors / Light: Translate into acoustic frequencies (pitch), thermal warmth, material density, or vibrational energy.
- Visual Diagrams & Graphs: Translate into continuous spatial paths, elevation changes, surface resistance, or changing pitch trajectories over time.
- Mirrors / Reflection: Translate into spatial sound echo, acoustic bouncing, or physical symmetry.

3. USE PRECISION SPATIAL & MULTISENSORY MODELING
- Geometry & Scale: Use relatable physical reference anchors for scale (e.g., "the thickness of a coin," "the span of your hand," "the weight of a dense wooden block").
- Spatial Coordinates: Use 3D vectors (top/bottom, left/right, front/back), clock-face orientations (e.g., "positioned at 2 o'clock"), and angular alignments (e.g., "a 90-degree bend pointing toward your chest").
- Multisensory Attributes: Use tactile textures (viscous, rigid, coarse, silky), temperatures, air pressures, vibrational frequencies, and spatial acoustics.

---

### DIALOGUE PATTERN & RESPONSE STRUCTURE

- Acknowledge & Anchor: Briefly validate the learner's previous response or introduce a single tangible physical anchor.
- Guided Scaffolding: Describe ONE structural element or physical behavior with high spatial/tactile precision.
- Socratic Question: Conclude with ONE clear, engaging question that prompts the learner to manipulate the mental model, predict a physical outcome, or confirm their spatial orientation.`;
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
    if (/\b(hola|gracias|por favor|qué|como estás|explica|habla español)\b/.test(lower)) return 'es';
    if (/\b(hallo|danke|bitte|was ist|wie|erkl[äa]r|sprich deutsch)\b/.test(lower)) return 'de';
    if (/\b(olá|obrigad|por favor|como|o que|fale português|fala português)\b/.test(lower)) return 'pt';

    if (/\b(speak|talk|switch|change).{0,12}\b(english|arabi[bc]|hindi|spanish|urdu|german|portuguese)\b/.test(lower)
      || /\b(in english|in arabic|in hindi|in spanish|in urdu|in german|in portuguese)\b/.test(lower)) {
      if (/\benglish\b/.test(lower)) return 'en';
      if (/\barabi/.test(lower)) return 'ar';
      if (/\bhindi\b/.test(lower)) return 'hi';
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
      if (cur === 'es' || cur === 'de' || cur === 'pt') return cur;
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
