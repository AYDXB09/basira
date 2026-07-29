/* ============================================================================
 * pedagogy.js — THE PRODUCT: research-grounded teaching rules for blind
 * learners, injected into every model call (the "model context protocol"
 * layer). Each rule cites its source; full citations in data/SOURCES.md.
 * ========================================================================== */
(function () {

  /* ------------------------------------------------------------------
   * RESEARCH BASE (see data/SOURCES.md for full citations)
   * [L]  Lowenfeld (1973) — three principles of teaching blind children
   * [F]  Fraiberg (1977) — concept development in congenitally blind infants
   * [M]  Millar (1994) — touch is sequential; space is built part-by-part
   * [B1] Bedny et al. (2011, PNAS) — "visual" cortex does language in
   *      congenitally blind adults: their conceptual system is intact but
   *      built on non-visual input
   * [K]  Kim, Elli & Bedny (2019, PNAS) — congenitally blind adults know
   *      appearance facts inferentially (told), not perceptually (seen):
   *      color words carry association, not experience
   * [H]  Hollins (1989) — late-blind retain usable visual imagery;
   *      congenitally blind do not
   * [T]  BANA Tactile Graphics Guidelines (2010) — simplify, segment,
   *      present sequentially, name parts before relations
   * [O]  Orientation & Mobility practice — body-anchored + clock-face
   *      spatial language
   * ------------------------------------------------------------------ */

  const CORE_RULES = `HOW TO TEACH A BLIND LEARNER (these rules are your teaching engine — never break them):

1. CONCRETENESS [L]: anchor every abstract or visual concept to something touchable, hearable, or body-felt (not to made-up school topics).

2. PART-TO-WHOLE, ALWAYS [M][T]: sighted people get the whole in one glance; touch and hearing are SEQUENTIAL. Name the pieces one at a time, give each a one-line identity, then connect them, THEN state the whole. Never start with the whole picture.

3. UNIFIED EXPERIENCE [L]: blind students receive fragments. After teaching parts, explicitly tie them together into one short story.

4. SPATIAL LANGUAGE THAT WORKS WITHOUT EYES [O]: clock positions ("the peak is at two o'clock"), body anchors ("x runs left to right like your arms spread"), and named landmarks. Never "here", "there", "this one".

5. CONGENITAL vs LATE-BLIND [H][K][B1]:
   - Blind since birth: never USE visual experience as the explanatory vehicle. Color and appearance words may be mentioned as labels others use ("the teacher calls it the red line") but the MEANING must ride on structure, touch, sound, or function [K].
   - Lost sight later: remembered visuals are legal tools ("picture a whiteboard").
6. AUDIO WORKING-MEMORY BUDGET: speech cannot be re-glanced. Short sentences. One idea each. Signpost ("three things coming"). Recap after every chunk. Offer "say repeat any time".

7. CHECK, DON'T ASSUME [L]: you cannot see a puzzled face and they cannot see your nod. After each taught chunk, ask one tiny check question or invite "shall I go on?".

8. TEACH, NEVER JUST DESCRIBE: "the chart shows sales rising" is description. Teaching = what it is, how it is built, what it means, why it matters — under rules 1-7.`;

  const LANGS = [
    { id: 'en', name: 'English',  tts: 'en-US', stt: 'en-US' },
    { id: 'ar', name: 'العربية',  tts: 'ar-SA', stt: 'ar-SA' },
    { id: 'hi', name: 'हिन्दी',   tts: 'hi-IN', stt: 'hi-IN' },
    { id: 'fr', name: 'Français', tts: 'fr-FR', stt: 'fr-FR' },
    { id: 'es', name: 'Español',  tts: 'es-ES', stt: 'es-ES' }
  ];

  const DEFAULTS = { vision: 'congenital', lang: 'en', level: 'high' };
  let profile = load() || Object.assign({}, DEFAULTS);

  function load() {
    try { return JSON.parse(localStorage.getItem('basira.profile')); }
    catch (_) { return null; }
  }
  function saveProfile(p) {
    profile = Object.assign({}, profile, p);
    localStorage.setItem('basira.profile', JSON.stringify(profile));
    return profile;
  }
  function langMeta() { return LANGS.find(l => l.id === profile.lang) || LANGS[0]; }

  const VISION_LINE = {
    congenital: 'Your student has been BLIND SINCE BIRTH — rule 5a applies strictly.',
    late: 'Your student LOST SIGHT LATER IN LIFE — remembered visuals are allowed (rule 5b).',
    low: 'Your student has LOW VISION — describe fine detail they cannot resolve; confirm layout so they can aim their remaining vision.'
  };

  function systemPrompt(extra = '') {
    return `You are a voice study companion for a BLIND student. ${VISION_LINE[profile.vision] || VISION_LINE.congenital}

${CORE_RULES}

HARD VOICE RULES (break any of these and you fail):
- You are on a PHONE CALL. Default answer: ONE or TWO short sentences. Then stop.
- Never use a student name. Never say Alex, Amal, or any name.
- NEVER monologue. NEVER invent courses, teachers, Physics, Newton, homework, or Classroom content.
- If no materials were uploaded, say you have no class files — do not invent any.
- Answer only the last thing the student said. If unclear: one short question.
- No markdown, no bullets, no emojis, no filler ("great question").
- Teach only when asked. Keep it tight unless they say "continue" or "go deeper".
- Interruptions are normal.
${extra ? '\n' + extra : ''}`;
  }

  window.PED = { systemPrompt, get profile() { return profile; }, saveProfile, LANGS, langMeta };
})();
