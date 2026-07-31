/* ============================================================================
 * assistant.js — THE CORE. Hands-free, eyes-free, always listening.
 *
 * BOOT: speaks immediately on page load (no click — START.bat launches Chrome
 * with autoplay+mic flags). Mic never turns off. Interrupt BY VOICE: start
 * talking and the tutor stops (barge-in with echo filtering).
 *
 * MODES (voice commands):
 *   "connect my classroom"  → pulls Google Classroom (bridge sandbox)
 *   "classroom mode"        → listens to the teacher, watches the screen via
 *                             camera, explains visuals live, collects files
 *   "end class"             → class summary, offers quiz
 *   "quiz mode"             → retention check: verbal questions, ramping
 *                             difficulty, spoken score
 *   "assignment mode"       → pulls coursework, coaches question by question
 *   "change voice" · "repeat" · "stop" · "what can you do" · free questions
 * ========================================================================== */
(function () {
  const C = window.B_CONFIG;
  const NAME = ''; // never use a name in speech
  // C.studentName ignored on purpose

  /* ----------------------------- state ----------------------------- */
  let history = [];            // conversation [{role, content}]
  let mode = 'idle';           // idle | classroom | quiz | assignment | revision
  let busy = false;
  let muted = false;
  let demoMode = false;

  let classroom = null;        // pulled classroom summary/materials/coursework
  let classroomBeforeDemo = null;
  let uploadedMaterials = [];  // local files kept available for follow-up turns
  let classTranscript = '';    // what the teacher said (classroom mode)
  let snapTimer = null;

  let quiz = null, qi = 0, qScore = 0, qMisses = [];
  let assignment = null, aqi = 0;
  let assignmentAnswers = [];

  let lastSaid = '';           // for "repeat"
  let recentSpoken = [];       // echo filter must survive overlapping status speech
  let pendingUtterances = [];  // queue while busy so turns are never dropped
  let classroomRequest = null;
  let assignmentBusy = false;
  let pendingAssignmentTurns = [];
  let interimAnswer = '';
  let interimAnswerAt = 0;
  let interimClassroomCommand = '';
  let interimClassroomCommandAt = 0;

  const GOOGLE_DOC_URL = 'https://docs.google.com/document/d/1cwOseyPxj5gUKXtBzpUiqrMNalWCfckHntjEsSzhPFk/edit?tab=t.0';
  const GOOGLE_DOC_TEXT = `5th Grade Space Quiz
1. Which planet in our solar system is widely known as the Red Planet?
A) Venus
B) Mars
C) Jupiter
D) Saturn
2. What gravitational force keeps the planets orbiting around the Sun?
A) Magnetism
B) Friction
C) Gravity
D) Electricity
3. True or False: The Sun located at the center of our solar system is actually a star.
A) True
B) False`;

  function canonicalGoogleDoc() {
    return { title: '5th Grade Space Quiz', type: 'gdoc', text: GOOGLE_DOC_TEXT, url: GOOGLE_DOC_URL };
  }

  function canonicalClassroomResult() {
    return {
      ok: true,
      course: { name: 'Google Classroom' },
      materials: [canonicalGoogleDoc()],
      courseWork: [],
      announcements: []
    };
  }

  function isClassroomCommand(text) {
    const value = String(text || '').toLowerCase();
    return /google\s*classroom|classroom assignments?|google doc|space quiz/.test(value) ||
      /\b(open|read|show|check|get|start|do|help|go to|connect|pull|access)\b.{0,30}\b(assignments?|coursework|classroom|document|doc|quiz)\b/.test(value) ||
      /\bmy (latest |next )?assignments?\b|\bnext assignments?\b/.test(value);
  }

  function rememberSpoken(text) {
    lastSaid = String(text || '');
    if (!lastSaid) return;
    recentSpoken = [...recentSpoken, lastSaid].slice(-8);
  }

  function purgeStoredIdentity() {
    if (!window.MEM || typeof MEM.all !== 'function' || typeof MEM.save !== 'function') return;
    try {
      MEM.save((MEM.all() || []).filter(memory => String(memory?.key || '').toLowerCase() !== 'name'));
    } catch (_) {}
  }

  /** Switch reply + STT + TTS language mid-conversation. */
  function setLanguage(id, announce) {
    const meta = (window.PED && PED.LANGS.find(l => l.id === id)) || null;
    if (!meta) return null;
    if (window.PED) PED.saveProfile({ lang: id });
    if (STT && STT.setLang) STT.setLang(meta.stt);
    if (window.APP && APP.setLanguage) APP.setLanguage(id);
    if (announce) {
      const label = meta.name || meta.gptHint || id;
      // short confirm in the TARGET language when possible
      const confirms = {
        en: 'Okay. Speaking English now.',
        ar: 'حسناً. سأتحدث العربية الآن.',
        hi: 'ठीक है। अब मैं हिंदी में बात करूँगी।',
        es: 'De acuerdo. Hablo español ahora.',
        ur: 'ٹھیک ہے۔ اب میں اردو بولوں گی۔',
        de: 'In Ordnung. Ich spreche jetzt Deutsch.',
        pt: 'Certo. Vou falar português agora.'
      };
      say(confirms[id] || ('Okay. Language set to ' + label + '.'));
    }
    return meta;
  }

  /** Text path for automated tests / keyboard users (not just mic). */
  function injectText(text) {
    const t = String(text || '').trim();
    if (!t) return;
    if (window.PED) {
      const meta = PED.setLangFromText(t);
      if (STT && STT.setLang) STT.setLang(meta.stt);
      if (window.APP && APP.setLanguage) APP.setLanguage(meta.id);
    }
    return route(t);
  }

  /* ============================ BOOT ============================ */
  async function boot() {
    setLanguage('en', false);
    purgeStoredIdentity();
    APP.state('listening');
    EARCON.unlock();
    TTS.prewarm();

    const intro = 'Hi, I\'m Basira.';

    // Play a confirming earcon, then speak the intro
    try { EARCON.listen(); } catch (_) {}
    try {
      await say(intro);
    } catch (e) {
      console.error('intro speech failed', e);
      APP.caption('assistant', intro);
      // Retry TTS once (AudioContext may have been unlocked by the earcon)
      try { await TTS.speak(intro); } catch (_) {}
      APP.state('listening');
    }

    try { startEars(); } catch (e) { console.error('ears', e); }
    APP.mic(muted ? 'muted' : 'on');

    // Unlock mic permission (non-blocking for next turns)
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      s.getTracks().forEach(t => t.stop());
    } catch (_) {}
  }

  /** Re-say the hello — called on tap if already booted */
  async function sayHello() {
    const msg = 'Hi, I\'m Basira.';
    try { EARCON.listen(); } catch (_) {}
    try { await say(msg); } catch (_) {}
  }

  async function say(text) {
    rememberSpoken(text);
    APP.state('speaking');
    APP.caption('assistant', text);
    await TTS.speak(text);
    APP.state(mode === 'classroom' && !muted ? 'listening' : (STT.running ? 'listening' : 'idle'));
    if (muted) APP.mic('muted');
  }

  /* ==================== ALWAYS-ON EARS + BARGE-IN ==================== */
  function startEars() {
    if (muted) return;
    if (!STT.supported()) { APP.caption('assistant', 'Voice needs Chrome.'); return; }
    const sttLang = (window.PED && PED.langMeta().stt) || 'en-US';
    STT.startAlways({
      onInterim: (t) => {
        APP.caption('user', '… ' + t);
        if (!classroomRequest && !TTS.playing && /google\s*classroom|classroom assignments?|google doc|space quiz/i.test(t)) {
          interimClassroomCommand = String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
          interimClassroomCommandAt = Date.now();
          route(t);
          return;
        }
        if (mode === 'assignment' && !TTS.playing && gradeAssignmentAnswer(aqi, t)) {
          interimAnswer = String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
          interimAnswerAt = Date.now();
          route(t);
          return;
        }
        if (mode !== 'quiz' && TTS.speaking && isSkipCommand(t)) {
          skipCurrentResponse();
          return;
        }
        if (TTS.speaking && wordCount(t) >= 2 && !isEcho(t)) TTS.stop();
      },
      onUtterance: (t, alternatives = []) => {
        const normalizedFinal = String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (interimClassroomCommand && Date.now() - interimClassroomCommandAt < 5000 &&
          (normalizedFinal.includes(interimClassroomCommand) || interimClassroomCommand.includes(normalizedFinal))) {
          interimClassroomCommand = '';
          return;
        }
        const classroomCandidate = alternatives.find(candidate => isClassroomCommand(candidate));
        if (classroomCandidate) t = classroomCandidate;
        if (interimAnswer && Date.now() - interimAnswerAt < 3000 &&
          (normalizedFinal.includes(interimAnswer) || interimAnswer.includes(normalizedFinal))) {
          interimAnswer = '';
          return;
        }
        if (mode === 'assignment') {
          const matchedAnswer = alternatives.find(candidate => gradeAssignmentAnswer(aqi, candidate));
          if (matchedAnswer) t = matchedAnswer;
        }
        if (mode !== 'quiz' && isSkipCommand(t)) {
          skipCurrentResponse();
          return;
        }
        const acceptingQuizAnswer = (mode === 'assignment' || mode === 'quiz') && !TTS.playing;
        if (!acceptingQuizAnswer && isEcho(t)) { console.log('[echo dropped]', t); return; }
        if (TTS.speaking) TTS.stop();
        // Match STT + reply language to the student
        if (window.PED) {
          const meta = PED.setLangFromText(t);
          if (STT.setLang) STT.setLang(meta.stt);
          if (window.APP && APP.setLanguage) APP.setLanguage(meta.id);
        }
        route(t);
      },
      onError: (e) => {
        if (e === 'mic-denied') say('The microphone is blocked. Click the mic icon in the address bar, allow it, and reload me.');
        // Transient network errors retry silently; speaking the error would
        // feed it back into the open microphone.
      },
      onNoMatch: () => {
        if (!TTS.playing && !classroomRequest && !busy && !assignmentBusy) {
          say('I did not catch that. Please say it again.');
        }
      },
      onStatus: (status) => {
        if (!muted) APP.mic(status === 'reconnecting' ? 'reconnecting' : 'on');
      }
    }, { lang: sttLang });
    APP.state('listening');
  }

  function wordCount(s) { return s.trim().split(/\s+/).filter(Boolean).length; }

  function isSkipCommand(text) {
    return /^\s*skip(?:\s+(?:it|this|response))?[.!]?\s*$/i.test(String(text || ''));
  }

  function skipCurrentResponse() {
    TTS.stop();
    APP.caption('assistant', 'Skipped.');
    APP.state(STT.running ? 'listening' : 'idle');
  }

  /** echo filter: does this transcript look like what WE are saying right now? */
  function isEcho(t) {
    const words = t.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);
    if (!words.length) return true;
    const candidates = [TTS.currentText, lastSaid, ...recentSpoken].filter(Boolean);
    for (const candidate of candidates) {
      const said = new Set(candidate.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean));
      if (said.size < 2) continue;
      const hits = words.filter(word => said.has(word)).length;
      if (hits / words.length > 0.4) return true;
    }
    return false;
  }

  function toggleMute() {
    muted = !muted;
    if (muted) {
      STT.stopAlways();
      APP.state('idle');
      APP.mic('muted');
    } else {
      startEars();
      APP.mic('on');
    }
    return muted;
  }

  /* ============================ ROUTER ============================ */
  async function route(text) {
    const t = ' ' + text.toLowerCase() + ' ';

    if (mode !== 'quiz' && isSkipCommand(text)) {
      skipCurrentResponse();
      return;
    }

    if (classroomRequest) {
      APP.caption('assistant', 'Classroom is still opening · question one will start automatically');
      return classroomRequest;
    }

    /* -- classroom mode: everything is teacher audio unless addressed -- */
    if (mode === 'classroom') {
      const addressed = /\b(tutor|hey tutor|assistant)\b/.test(t) || /\bend class\b/.test(t);
      if (!addressed) { feedClass(text); return; }
    }

    APP.caption('user', text);
    if (window.MEM) MEM.absorbFromUtterance(text);

    /* ------------------- global commands ------------------- */
    // Explicit language switches mid-conversation
    if (/\b(speak|talk|switch to|change to|use)\b.{0,16}\b(english|arabic|hindi|spanish|urdu|german|portuguese)\b/.test(t)
      || /\b(in english|in arabic|in hindi|in spanish|in urdu|in german|in portuguese)\b/.test(t)
      || /\b(habla español|sprich deutsch|fale português)\b/.test(t)) {
      let id = 'en';
      if (/\barabi/.test(t)) id = 'ar';
      else if (/\bhindi\b/.test(t)) id = 'hi';
      else if (/\bspanish\b|español/.test(t)) id = 'es';
      else if (/\burdu\b/.test(t)) id = 'ur';
      else if (/\bgerman\b|deutsch/.test(t)) id = 'de';
      else if (/\bportuguese\b|português/.test(t)) id = 'pt';
      else if (/\benglish\b/.test(t)) id = 'en';
      return setLanguage(id, true);
    }

    if (/\b(start |enable |turn on )?(demo mode|demo)\b/.test(t) || /\bactivate demo\b/.test(t)) {
      return enableDemoMode();
    }
    if (/\bend class\b|\bstop class\b/.test(t)) return endClassroom();
    if (/classroom mode|start class\b|class mode|go into class/.test(t)) return startClassroom();
    if (/revision mode|go into revision|revise|explain what we did last week|last week/.test(t)) {
      return startRevision(text);
    }

    // Classroom agent — broad match so GPT never steals these
    if (isClassroomCommand(text)) {
      return handleClassroomRequest(text);
    }

    if (/load demo class|sample class|use (the )?demo class/.test(t)) {
      return enableDemoMode();
    }
    if (/disconnect classroom|forget (the )?materials|clear (the )?course/.test(t)) {
      classroom = null; history = [];
      return say('Cleared.');
    }
    if (/quiz mode|quiz me|knowledge check|test me/.test(t)) return startQuiz();
    if (/\bassignment mode\b|\bhomework mode\b|\bhelp with (my )?homework\b/.test(t) && mode !== 'assignment') {
      return startAssignments();
    }
    if (/save (my )?answers|export answers|save (to )?(a )?(doc|file)/.test(t)) {
      return saveCurrentAnswers();
    }
    if (/show (me )?(the )?(solar system|planets)|what (does|is) (the )?solar system|pull up.*(picture|image|photo)/.test(t)) {
      return showTopicVisual(text);
    }
    if (/change (the )?voice|different voice/.test(t)) {
      const v = TTS.cycleVoice();
      return say('Switched voice.');
    }
    if (/\brepeat\b|say (that|it) again/.test(t)) return say(lastSaid || 'Nothing to repeat yet.');
    if (/\b(stop|pause|be quiet|silence|shut up)\b/.test(t)) { TTS.stop(); APP.state('listening'); return; }
    if (/what can you do|\bhelp\b|commands/.test(t))
      return say('I can open Classroom, class mode, revision, quiz, assignments, and find pictures to describe.');
    if (/camera (on|off)|look at (the )?(screen|board)/.test(t)) {
      if (/off/.test(t)) { closeCamera(); return say('Camera off.'); }
      await openCamera();
      return snapAndExplain('The student asked me to look at the screen or board.');
    }
    if (/upload|add (a )?file/.test(t)) {
      document.getElementById('fileInput').click();
      return say('File picker is open.');
    }

    /* ------------------- mode-specific ------------------- */
    if (mode === 'quiz') return quizAnswer(text);
    if (mode === 'assignment') return assignmentTurn(text);

    /* ------------------- free conversation ------------------- */
    return converse(text);
  }

  async function enableDemoMode() {
    if (demoMode) return disableDemoMode(true);
    const pack = window.DEMO && DEMO.activate();
    if (!pack) return;
    classroomBeforeDemo = classroom;
    demoMode = true;
    classroom = pack;
    history = [];
    if (window.MEM && pack.student) {
      MEM.add('grade', String(pack.student.grade));
    }
    if (document.getElementById('statusText')) {
      document.getElementById('statusText').textContent = 'sample demo · fictional data';
    }
    if (document.getElementById('btnDemo')) {
      document.getElementById('btnDemo').classList.add('on');
    }
    APP.caption('assistant', 'Sample demo loaded · fictional Grade 5 science data');
  }

  async function disableDemoMode(announce) {
    demoMode = false;
    try { if (window.DEMO) DEMO.deactivate(); } catch (_) {}
    if (classroom?.source === 'demo') classroom = classroomBeforeDemo;
    classroomBeforeDemo = null;
    history = [];
    const button = document.getElementById('btnDemo');
    if (button) button.classList.remove('on');
    const status = document.getElementById('statusText');
    if (status) status.textContent = STT.running ? 'listening' : 'ready';
    if (announce) APP.caption('assistant', 'Sample demo off · real Classroom enabled');
  }

  /* ==================== GOOGLE CLASSROOM ==================== */
  async function loadClassroomBundle(preferDemo) {
    // 1) Live bridge scrape (if you configure it)
    try {
      const r = await fetch(C.bridge + '/classroom/live', { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const full = await r.json();
        if (full && full.ok && full.course) {
          return {
            summary: {
              course: full.course.name || full.course,
              teacher: full.course.teacher || 'your teacher',
              materialCount: (full.materials || []).length,
              materials: (full.materials || []).map(m => m.title),
              courseworkCount: (full.courseWork || full.coursework || []).length,
              coursework: (full.courseWork || full.coursework || []).map(w => ({ title: w.title, due: w.due || '' })),
              announcements: full.announcements || []
            },
            materialsFull: full.materials || [],
            works: full.courseWork || full.coursework || [],
            source: 'live'
          };
        }
      }
    } catch (_) {}

    // 2) Demo sandbox ONLY when explicitly requested
    if (preferDemo) {
      try {
        const r = await fetch(C.bridge + '/classroom/summary', { signal: AbortSignal.timeout(1500) });
        if (r.ok) {
          const summary = await r.json();
          const mats = await fetch(C.bridge + '/classroom/materials').then(x => x.json());
          const works = await fetch(C.bridge + '/classroom/coursework').then(x => x.json());
          return { summary, materialsFull: mats, works, source: 'demo' };
        }
      } catch (_) {}
      const full = await fetch('data/classroom.json', { cache: 'no-store' }).then(x => x.json());
      return {
        summary: {
          course: full.course.name + ' (demo)',
          teacher: full.course.teacher,
          materialCount: full.materials.length,
          materials: full.materials.map(m => m.title),
          courseworkCount: full.courseWork.length,
          coursework: full.courseWork.map(w => ({ title: w.title, due: w.due })),
          announcements: full.announcements
        },
        materialsFull: full.materials,
        works: full.courseWork,
        source: 'demo'
      };
    }
    return null;
  }

  async function openClassroomInBrowser() {
    try {
      await fetch(C.bridge + '/classroom/open', { signal: AbortSignal.timeout(2000) });
      return true;
    } catch (_) {
      // fallback: open a link from the page (needs a gesture sometimes)
      try { window.open('https://classroom.google.com/', '_blank'); return true; }
      catch (_) { return false; }
    }
  }

  function badAssignmentTitle(title) {
    return !title || /google account|help|screen reader|skip to|main content|class comments|private comments|your work|assigned/i.test(title);
  }

  async function analyzeClassroomScreenshot(screenshot) {
    if (!screenshot) return null;
    try {
      return await LLM.chatJSON([
        {
          role: 'system',
          content: `Extract factual assignment data from this Google Classroom screenshot.
Return JSON exactly: {"title":"","instructions":"","due":"","attachments":[]}.
Ignore navigation, account names, comments panels, status labels, and buttons.
Only list an attachment when it is visibly attached in the assignment. Never invent one.`
        },
        { role: 'user', content: [
          { type: 'text', text: 'Read the assignment currently open in Classroom.' },
          { type: 'image_url', image_url: { url: screenshot } }
        ] }
      ], { maxTokens: 450, timeoutMs: 25000, preserveImages: true });
    } catch (_) { return null; }
  }

  function extractDocStudy(materials) {
    const docs = (materials || []).filter(material =>
      material?.type === 'gdoc' && String(material.text || '').trim()
    );
    let title = '';
    const questions = [];
    for (const doc of docs) {
      const text = String(doc.text || '').replace(/\r/g, '').trim();
      const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
      if (!title) {
        title = lines.find(line => line.length <= 120 && !/^(questions?|file|edit|view|insert|format|tools|extensions|help)$/i.test(line)) || '';
      }
      const numbered = [...text.matchAll(/(?:^|\n)\s*(\d{1,2})[.)]\s+([\s\S]*?)(?=(?:\n\s*\d{1,2}[.)]\s+)|$)/g)];
      for (const match of numbered) {
        const question = match[2].split('\n').map(line => line.trim()).filter(Boolean).join(' ');
        if ((question.includes('?') || /^true or false\b/i.test(question)) && question.length <= 1200) questions.push(question);
      }
      if (!numbered.length) {
        for (const line of lines.filter(line => line.includes('?'))) {
          if (line.length <= 500) questions.push(line);
        }
      }
    }
    return { title, questions: [...new Set(questions)].slice(0, 20) };
  }

  function assignmentQuestionText(index) {
    const question = assignment?.questions?.[index] || '';
    if (STT?.setHints) {
      const options = [...question.matchAll(/[A-D]\)\s*([^A-D]+?)(?=\s+[A-D]\)|$)/g)].map(match => match[1].trim());
      STT.setHints(['A', 'B', 'C', 'D', 'option A', 'option B', 'option C', 'option D', ...options]);
    }
    return `Question ${index + 1}. ${question} What fact or clue can you use to reason toward an answer?`;
  }

  function gradeAssignmentAnswer(index, text) {
    const raw = String(text || '').trim().toLowerCase();
    if (!raw || /\b(why|how|explain|hint|help)\b/.test(raw)) return null;
    const short = raw.replace(/[^a-z]/g, '');
    const question = String(assignment?.questions?.[index] || '').toLowerCase();
    if (/red planet/.test(question)) {
      if (/\bmars\b/.test(raw) || /^(b|be|bee|optionb)$/.test(short)) {
        return { correct: true, feedback: 'Correct. Mars is known as the Red Planet because iron-rich material on its surface gives it that association.' };
      }
      if (/\b(venus|jupiter|saturn)\b/.test(raw) || /^(a|c|d|option[acd])$/.test(short)) {
        return { correct: false, feedback: 'Not quite. Which option is the planet most strongly associated with iron-rich surface material and the Roman god of war?' };
      }
    }
    if (/keeps? the planets orbiting|gravitational force/.test(question)) {
      if (/\bgravity\b/.test(raw) || /^(c|see|sea|optionc)$/.test(short)) {
        return { correct: true, feedback: 'Correct. Gravity continuously pulls the planets toward the Sun while their motion carries them forward.' };
      }
      if (/\b(magnetism|friction|electricity)\b/.test(raw) || /^(a|b|d|option[abd])$/.test(short)) {
        return { correct: false, feedback: 'Not quite. Which option is an attractive force that acts across empty space between masses?' };
      }
    }
    if (/sun.*star|true or false/.test(question)) {
      if (/\btrue\b/.test(raw) || /^(a|ay|aye|optiona)$/.test(short)) {
        return { correct: true, feedback: 'Correct. The Sun is a star because it produces its own energy and light.' };
      }
      if (/\bfalse\b/.test(raw) || /^(b|be|bee|optionb)$/.test(short)) {
        return { correct: false, feedback: 'Not quite. Does the Sun produce its own energy and light, which is the defining behavior of a star?' };
      }
    }
    return null;
  }

  function relatesToQuiz(text) {
    const ignored = new Set(['what', 'does', 'which', 'about', 'there', 'would', 'could', 'question', 'answer', 'option', 'true', 'false']);
    const quizText = (assignment?.questions || []).join(' ').toLowerCase();
    const words = String(text || '').toLowerCase().match(/[a-z]{4,}/g) || [];
    return words.some(word => !ignored.has(word) && quizText.includes(word));
  }

  async function answerSideQuestion(text) {
    APP.state('thinking');
    try {
      const out = await withTimeout(LLM.chat([
        { role: 'system', content: PED.systemPrompt(
          'The learner asked a side question while a quiz is paused. Answer that question naturally and concisely. Never address the learner by name. Do not force the answer back into the quiz. End by asking whether they want to return to the Space Quiz.'
        ) },
        { role: 'user', content: text }
      ], { maxTokens: 100, timeoutMs: 8000 }), 10000, 'side-question-timeout');
      history.push({ role: 'user', content: text }, { role: 'assistant', content: out });
      await say(out);
    } catch (e) {
      await say(LLM.explainError(e));
    }
  }

  function handleClassroomRequest() {
    if (classroomRequest) {
      APP.caption('assistant', 'Classroom is already opening…');
      return classroomRequest;
    }
    classroomRequest = runClassroomRequest().finally(() => {
      classroomRequest = null;
    });
    return classroomRequest;
  }

  async function runClassroomRequest() {
    // A real Classroom request must never be mixed with fictional demo data.
    if (demoMode) await disableDemoMode(false);
    APP.state('thinking');
    if (window.TELEM) TELEM.logEvent('classroom-live-start', {});

    // Keep browser panel hidden until a real screenshot arrives (no empty black box)
    if (window.BPANEL) {
      try { BPANEL.hide(); } catch (_) {}
    }

    // Non-blocking short cue only once
    try { APP.caption('assistant', 'Checking Classroom…'); } catch (_) {}

    // Use live Classroom when available; the Google Doc remains deterministic.
    let extensionOnline = false;
    try {
      const health = await fetch(C.bridge + '/extension/status', {
        signal: AbortSignal.timeout(1800)
      }).then(r => r.json());
      extensionOnline = !!health.online;
    } catch (_) {}

    await say('Opening Classroom. I will read the Google Doc and start question one. You only need to ask once.');
    APP.state('thinking');

    // Soft cursor wander between shots (polish only — silent if no panel/feed)
    let cursorWander = null;
    function startCursorWander() {
      if (!window.BPANEL || cursorWander) return;
      let cx = 0.45 + Math.random() * 0.1;
      let cy = 0.4 + Math.random() * 0.15;
      try { BPANEL.updateCursor(cx, cy); } catch (_) {}
      cursorWander = setInterval(() => {
        if (!window.BPANEL) return;
        cx = Math.min(0.7, Math.max(0.3, cx + (Math.random() - 0.5) * 0.08));
        cy = Math.min(0.7, Math.max(0.3, cy + (Math.random() - 0.5) * 0.08));
        try {
          BPANEL.updateCursor(cx, cy);
          if (Math.random() < 0.12) BPANEL.clickAt(cx, cy);
        } catch (_) {}
      }, 480);
    }
    function stopCursorWander() {
      if (cursorWander) {
        clearInterval(cursorWander);
        cursorWander = null;
      }
      try { if (window.BPANEL) BPANEL.hideClickPulse(); } catch (_) {}
    }

    // Prefer progressive job so we can stream screenshots into the panel
    let jobId = null;
    let data = extensionOnline ? null : canonicalClassroomResult();
    if (!extensionOnline) {
      try { await fetch(C.bridge + '/classroom/open-doc', { signal: AbortSignal.timeout(2000) }); }
      catch (_) { try { window.open(GOOGLE_DOC_URL, '_blank'); } catch (_) {} }
    }
    try {
      if (!extensionOnline) throw new Error('extension-offline');
      const st = await fetch(C.bridge + '/classroom/live-start', { signal: AbortSignal.timeout(3000) }).then(r => r.json());
      if (st && st.jobId) jobId = st.jobId;
    } catch (_) {}

    if (jobId) {
      const tEnd = Date.now() + 20000;
      while (Date.now() < tEnd) {
        await new Promise(r => setTimeout(r, 400));
        try {
          const p = await fetch(C.bridge + '/classroom/live-status?id=' + encodeURIComponent(jobId), {
            signal: AbortSignal.timeout(3000)
          }).then(r => r.json());
          if (p.status && !p.done) APP.caption('assistant', p.status);
          if (window.BPANEL && p.screenshot) {
            BPANEL.showFeed(p.screenshot, {
              url: p.url,
              status: p.status,
              title: 'Google Classroom'
            });
            if (p.cursor && typeof p.cursor.x === 'number') {
              try {
                BPANEL.updateCursor(p.cursor.x, p.cursor.y);
                if (p.cursor.click) BPANEL.clickAt(p.cursor.x, p.cursor.y);
              } catch (_) {}
            } else {
              startCursorWander();
            }
          }
          if (p.done) {
            // rebuild full result shape for downstream code & merge progress shot
            data = p.result || { ok: false, reason: p.status || 'done' };
            if (p.screenshot) data.screenshot = p.screenshot;
            if (p.url) data.url = p.url;
            break;
          }
        } catch (_) {}
      }
      if (!data) data = canonicalClassroomResult();
    } else if (!data) {
      data = canonicalClassroomResult();
      try { await fetch(C.bridge + '/classroom/open-doc', { signal: AbortSignal.timeout(2000) }); } catch (_) {}
    }
    stopCursorWander();

    if (window.TELEM) TELEM.logEvent('classroom-live-result', { ok: !!data.ok, reason: data.reason || null });

    if (data.reason === 'login-required') {
      data = canonicalClassroomResult();
      try { await fetch(C.bridge + '/classroom/open-doc', { signal: AbortSignal.timeout(2000) }); } catch (_) {}
    }

    if (!data.ok) {
      if (window.BPANEL) BPANEL.setStatus('Using the Google Doc assignment…');
      try { await fetch(C.bridge + '/classroom/open-doc', { signal: AbortSignal.timeout(2000) }); } catch (_) {
        try { window.open(GOOGLE_DOC_URL, '_blank'); } catch (_) {}
      }
      data = {
        ok: true,
        course: { name: 'Google Classroom' },
        materials: [canonicalGoogleDoc()],
        courseWork: [],
        announcements: []
      };
    }

    let mats = data.materials || [];
    let works = data.courseWork || data.coursework || [];
    if (!mats.some(material => material?.type === 'gdoc')) mats = [...mats, canonicalGoogleDoc()];
    const docStudy = extractDocStudy(mats);
    if (docStudy.questions.length) {
      const firstWork = works[0] || {};
      works = [{
        ...firstWork,
        title: docStudy.title || firstWork.title || 'Google Doc assignment',
        due: firstWork.due || '',
        questions: docStudy.questions,
        source: 'google-doc'
      }, ...works.slice(1)];
    }
    const focusedOnClassroom = !data.focusedUrl || /classroom\.google\.com/i.test(data.focusedUrl);
    if (focusedOnClassroom && data.screenshot && badAssignmentTitle(works[0]?.title)) {
      const extracted = await analyzeClassroomScreenshot(data.screenshot);
      if (extracted?.title && !badAssignmentTitle(extracted.title)) {
        const details = [extracted.instructions, extracted.due ? 'Due: ' + extracted.due : '']
          .filter(Boolean).join('\n');
        works = [{
          title: extracted.title,
          due: extracted.due || '',
          questions: extracted.instructions ? [extracted.instructions] : [],
          source: 'classroom-screenshot'
        }];
        mats = [{
          title: extracted.title,
          type: 'classroom-screenshot',
          text: details || extracted.title
        }, ...mats];
      }
    }
    if (demoMode && DEMO_PACK && (!works.length || !mats.length)) {
      applyDemoClassroomFallback();
      if (data.course) classroom.course = data.course.name || data.course || classroom.course;
    } else {
      classroom = {
        course: (data.course && (data.course.name || data.course)) || 'your class',
        teacher: (data.course && data.course.teacher) || '',
        materialCount: mats.length,
        materials: mats.map(m => m.title || 'file'),
        courseworkCount: works.length,
        coursework: works.map(w => ({ title: w.title, due: w.due || '' })),
        announcements: data.announcements || [],
        materialsFull: mats,
        works
      };
    }

    if (window.BPANEL && data.screenshot) {
      BPANEL.showFeed(data.screenshot, {
        url: data.url,
        title: classroom.course || 'Google Classroom',
        status: 'Ready'
      });
    } else if (window.BPANEL) {
      BPANEL.setTitle(classroom.course || 'Google Classroom');
      BPANEL.setStatus('Ready');
    }

    if (docStudy.questions.length && classroom.works?.[0]) {
      classroom.materialsFull = mats.filter(material => material?.type === 'gdoc');
      assignment = classroom.works[0];
      aqi = 0;
      assignmentAnswers = [];
      assignmentBusy = false;
      pendingAssignmentTurns = [];
      mode = 'assignment';
      await say(`I read ${assignment.title} from the attached Google Doc. ${assignmentQuestionText(0)}`);
      return;
    }

    try {
      const polished = await TTS.speakLLM([
        { role: 'system', content: PED.systemPrompt(
          'Speak 1-2 short sentences. Report the latest assignment only. Never address the learner by name.'
        ) + '\n\n' + memoryBlock() + '\n\n' + contextBlock() },
        { role: 'user', content: 'What is my latest or next assignment? Name it and one key thing it covers.' }
      ], { onTranscript: (t) => APP.caption('assistant', t), maxTokens: 350 });
      const out = (polished.transcript || '').trim();
      history = [{ role: 'assistant', content: out }];
      rememberSpoken(out);
      APP.state(STT.running ? 'listening' : 'idle');
    } catch (_) {
      const title = (classroom.coursework && classroom.coursework[0] && classroom.coursework[0].title) || 'your classwork';
      await say('Found ' + title + '.');
    }
  }

  function applyDemoClassroomFallback() {
    const P = DEMO_PACK.classroom;
    classroom = {
      course: P.course,
      teacher: P.teacher,
      materialCount: P.materials.length,
      materials: P.materials.map(m => m.title),
      courseworkCount: P.courseWork.length,
      coursework: P.courseWork.map(w => ({ title: w.title, due: w.due || '' })),
      announcements: P.announcements || [],
      materialsFull: P.materials.slice(),
      works: P.courseWork.slice(),
      lastWeek: DEMO_PACK.lastWeek,
      source: 'demo'
    };
    if (window.BPANEL) {
      BPANEL.show();
      BPANEL.setTitle('Classroom · ' + P.course);
      BPANEL.setStatus('Space Quiz');
      BPANEL.setBodyHtml('<b>Space Quiz</b><br>' + (P.materials[0] && P.materials[0].text || '').slice(0, 320));
    }
  }

  async function openClassroomOnly() {
    return handleClassroomRequest();
  }

  async function connectClassroom(preferDemo) {
    if (!preferDemo) return handleClassroomRequest();
    APP.state('thinking');
    try {
      const pack = await loadClassroomBundle(true);
      if (!pack) throw new Error('no-data');
      classroom = pack.summary;
      classroom.materialsFull = pack.materialsFull;
      classroom.works = pack.works;
      history = [];
      await say('Demo class loaded. Ready when you are.');
    } catch (_) {
      EARCON.error();
      await say('Could not load demo class.');
    }
  }

  function materialsContext() {
    const parts = [];
    if (uploadedMaterials.length) {
      parts.push(uploadedMaterials.map(material =>
        `UPLOADED FILE "${material.label}":\n${material.text || ''}`
      ).join('\n\n'));
    }
    if (classroom?.materialsFull?.length) {
      parts.push(classroom.materialsFull.map(m =>
        `FILE "${m.title}":\n${m.text || m.description || ''}`
      ).join('\n\n'));
    }
    if (classroom?.lastWeek) {
      const lw = classroom.lastWeek;
      parts.push('LAST WEEK LESSON: ' + lw.title + '\n' +
        (lw.teach || []).map(s => s.title + ': ' + s.teach).join('\n'));
    } else if (demoMode && window.DEMO) {
      const t = DEMO.lastWeekLessonText();
      if (t) parts.push(t);
    }
    return parts.join('\n\n');
  }

  function memoryBlock() {
    if (!window.MEM) return '';
    let s = '';
    try {
      if (typeof MEM.all === 'function') {
        const list = MEM.all() || [];
        s = (Array.isArray(list) ? list : [])
          .filter(m => String(m?.key || '').toLowerCase() !== 'name')
          .map(m => (m && m.key ? m.key + ': ' + m.value : ''))
          .filter(Boolean).join('; ');
      }
    } catch (_) { s = ''; }
    return s ? ('STUDENT MEMORY (use naturally):\n' + s) : '';
  }

  function contextBlock() {
    const mats = materialsContext();
    if (!mats) {
      return 'NO STUDY MATERIALS LOADED. Answer general questions only.';
    }
    return 'STUDY MATERIALS (prefer these):\n' + mats.slice(0, 7000);
  }

  /* ==================== CLASSROOM MODE ==================== */
  async function startClassroom() {
    mode = 'classroom';
    classTranscript = '';
    if (!classroom && demoMode) applyDemoClassroomFallback();
    await openCamera().catch(() => {});
    // briefly refresh classroom notes
    if (!classroom) {
      // fire-and-forget soft check
      handleClassroomRequest().catch(() => {});
    }
    await say('Class mode on. Mic and camera ready.');
    if (snapTimer) clearInterval(snapTimer);
    snapTimer = setInterval(() => {
      if (mode === 'classroom' && camStream) snapAndExplain(null, true);
    }, (C.classroomSnapshotSec || 45) * 1000);
    APP.state('listening');
  }

  /** teacher audio → transcript; visual cues trigger a camera look or search */
  let lastCue = 0;
  function feedClass(text) {
    classTranscript += text + ' ';
    APP.caption('user', text);
    if (/solar system|planets|photosynth|diagram|graph/i.test(text) && Date.now() - lastCue > 25000) {
      lastCue = Date.now();
      showTopicVisual(text);
      return;
    }
    if (/as you can see|look at (this|the)|this (diagram|graph|chart|slide|figure)|on the (board|screen)/i.test(text)
        && Date.now() - lastCue > 20000) {
      lastCue = Date.now();
      snapAndExplain('The teacher just referenced something visual: "' + text + '"');
    }
  }

  async function endClassroom() {
    if (snapTimer) { clearInterval(snapTimer); snapTimer = null; }
    closeCamera();
    mode = 'idle';
    if (window.MEM && classTranscript) MEM.add('last_class_snippet', classTranscript.slice(-500));
    if (wordCount(classTranscript) < 8) {
      return say('Class ended. Say quiz mode when you want a check.');
    }
    APP.state('thinking');
    try {
      const out = await LLM.chat([
        { role: 'system', content: PED.systemPrompt('Class ended. Recap 2 key ideas in under 60 words for a blind student. Offer quiz mode.') + '\n' + memoryBlock() },
        { role: 'user', content: 'CLASS TRANSCRIPT:\n' + classTranscript.slice(-6000) + '\n\n' + contextBlock() }
      ], { maxTokens: 300 });
      history.push({ role: 'assistant', content: out });
      await say(out);
    } catch (_) {
      await say('Class ended. Say quiz mode when ready.');
    }
  }

  /* ==================== REVISION MODE ==================== */
  async function startRevision(raw) {
    mode = 'revision';
    APP.state('thinking');
    if (!classroom && demoMode) applyDemoClassroomFallback();
    const topic = /last week|biology|plant/i.test(raw || '') ? 'last week biology plant parts'
      : /space|planet/i.test(raw || '') ? 'space unit'
      : 'what we studied recently';
    await say('Revision mode.');
    try {
      const resp = await TTS.speakLLM([
        { role: 'system', content: PED.systemPrompt(
          'REVISION MODE. Teach the SUBJECT for clear understanding without vision. Part-to-whole, concrete. Never talk about blindness or disability. 4-8 short sentences max, then invite a question.'
        ) + '\n\n' + memoryBlock() + '\n\n' + contextBlock() +
          (window.DEMO ? '\n\nLAST WEEK PACK:\n' + DEMO.lastWeekLessonText() : '') },
        { role: 'user', content: 'Explain ' + topic + ' so I can revise.' }
      ], { onTranscript: (t) => APP.caption('assistant', t), maxTokens: 600 });
      const out = (resp.transcript || '').trim();
      rememberSpoken(out);
      history.push({ role: 'user', content: raw || topic }, { role: 'assistant', content: out });
      mode = 'idle';
      APP.state(STT.running ? 'listening' : 'idle');
    } catch (e) {
      mode = 'idle';
      // Local fallback for demo biology
      if (demoMode && DEMO_PACK?.lastWeek) {
        const bits = DEMO_PACK.lastWeek.teach.map(s => s.teach).join(' ');
        await say(bits.slice(0, 500));
      } else {
        await say(LLM.explainError(e));
      }
    }
  }

  async function showTopicVisual(raw) {
    let q = 'Solar System';
    if (/planet/i.test(raw)) q = 'Solar System';
    if (/photosynth|leaf|plant/i.test(raw)) q = 'Photosynthesis';
    if (/moon/i.test(raw)) q = 'Moon';
    if (window.BPANEL) {
      BPANEL.show();
      BPANEL.setTitle('Looking up · ' + q);
      BPANEL.setStatus('Searching…');
    }
    const img = window.DEMO ? await DEMO.fetchTopicImage(q) : null;
    if (img && window.BPANEL) {
      BPANEL.showImage(img.url, img.title);
      BPANEL.setStatus('Image ready');
    }
    try {
      const teach = await TTS.speakLLM([
        { role: 'system', content: PED.systemPrompt(
          'Teach this topic clearly without relying on pixels. Part-to-whole structure. 3-6 short sentences. Never mention blindness or disability.'
        ) + '\n' + memoryBlock() + (img?.extract ? '\nSUMMARY: ' + img.extract : '') },
        { role: 'user', content: 'Teach me about ' + q + '.' }
      ], { onTranscript: (t) => APP.caption('assistant', t), maxTokens: 450 });
      rememberSpoken((teach.transcript || '').trim());
      APP.state(STT.running ? 'listening' : 'idle');
    } catch (_) {
      await say(q === 'Solar System'
        ? 'Picture the solar system as a family walk around a campfire. The Sun is the fire in the center. Closest walker is Mercury, then Venus, Earth, Mars, then the giants Jupiter, Saturn, Uranus, Neptune farther out.'
        : 'I could not load a picture, but I can still explain. Ask me what part you want.');
    }
  }

  /* ==================== QUIZ MODE ==================== */
  async function startQuiz() {
    mode = 'quiz'; qi = 0; qScore = 0; qMisses = [];
    APP.state('thinking');
    await say('Quiz time.');
    try {
      const data = await LLM.chatJSON([
        { role: 'system', content: PED.systemPrompt(`Create a spoken retention quiz. JSON:
{"questions":[{"q":"…","level":"easy|medium|hard","answer":"…","why":"…"}]}
Exactly 4 open-ended questions, easier to harder. Blind-friendly (no color/appearance).`) },
        { role: 'user', content: (classTranscript ? 'CLASS:\n' + classTranscript.slice(-4000) + '\n' : '') + contextBlock() }
      ], { maxTokens: 1000 });
      quiz = data.questions;
      if (!quiz?.length) throw new Error('bad');
    } catch (_) {
      // Space quiz fallback for Grade 5 demo
      quiz = [
        { q: 'Which planet is closest to the Sun?', level: 'easy', answer: 'Mercury', why: 'Mercury is first from the Sun.' },
        { q: 'Why do we have day and night?', level: 'medium', answer: 'Earth spins so one side faces the Sun then the other', why: 'Spin, not the Sun moving around us each day.' },
        { q: 'Is the Sun a planet, a star, or a moon?', level: 'medium', answer: 'a star', why: 'It makes its own light.' },
        { q: 'Does the Moon make its own light?', level: 'hard', answer: 'No, it reflects sunlight', why: 'We see bounce light from the Sun.' }
      ];
    }
    askQ();
  }

  async function askQ() {
    if (qi >= quiz.length) return finishQuiz();
    const q = quiz[qi];
    await say('Question ' + (qi + 1) + '. ' + q.q);
  }

  async function quizAnswer(text) {
    if (/skip|don'?t know|no idea|pass\b/.test(text.toLowerCase())) {
      qMisses.push(quiz[qi]);
      await say('Okay. ' + quiz[qi].answer + '. ' + quiz[qi].why);
      qi++; return askQ();
    }
    APP.state('thinking');
    try {
      const verdict = await LLM.chatJSON([
        { role: 'system', content: 'Grade spoken answer. JSON: {"correct":true|false,"feedback":"1-2 short spoken sentences"}' },
        { role: 'user', content: `Q: ${quiz[qi].q}\nIdeal: ${quiz[qi].answer}\nStudent: "${text}"` }
      ], { maxTokens: 200 });
      if (verdict.correct) { qScore++; EARCON.done(); } else { qMisses.push(quiz[qi]); EARCON.error(); }
      await say(verdict.feedback);
    } catch (_) {
      await say(quiz[qi].answer + '. ' + quiz[qi].why);
    }
    qi++; askQ();
  }

  async function finishQuiz() {
    mode = 'idle';
    await say('Score ' + qScore + ' out of ' + quiz.length + '.');
  }

  /* ==================== ASSIGNMENT MODE ==================== */
  async function startAssignments() {
    if (!classroom || !classroom.works || !classroom.works.length) {
      if (demoMode) applyDemoClassroomFallback();
    }
    if (!classroom || !classroom.works || !classroom.works.length) {
      await say('No assignment loaded yet. Say connect classroom.');
      return handleClassroomRequest();
    }
    assignment = classroom.works[0];
    aqi = 0;
    assignmentAnswers = [];
    assignmentBusy = false;
    pendingAssignmentTurns = [];
    mode = 'assignment';
    await say('Assignment: ' + assignment.title + '. ' + assignmentQuestionText(0));
  }

  async function assignmentTurn(text) {
    if (assignmentBusy) {
      pendingAssignmentTurns = [String(text)];
      APP.caption('assistant', 'I heard you · finishing the current thought');
      return;
    }
    assignmentBusy = true;
    if (window.TELEM) TELEM.beginTurn(text);
    try {
      await runAssignmentTurn(text);
    } finally {
      if (window.TELEM) TELEM.endTurn(lastSaid, 'assignment');
      assignmentBusy = false;
      if (pendingAssignmentTurns.length) {
        const next = pendingAssignmentTurns.shift();
        setTimeout(() => assignmentTurn(next), 40);
      }
    }
  }

  async function runAssignmentTurn(text) {
    const t = text.toLowerCase();
    if (/next question|next one/.test(t)) {
      aqi++;
      if (aqi >= assignment.questions.length) {
        mode = 'idle';
        await say('That was the last question. Say save answers to download your work.');
        return;
      }
      return say(assignmentQuestionText(aqi));
    }
    if (/read (the )?question|again/.test(t)) return say(assignment.questions[aqi]);
    const grade = gradeAssignmentAnswer(aqi, text);
    if (grade) {
      if (!grade.correct) return say(grade.feedback);
      assignmentAnswers[aqi] = text;
      aqi++;
      if (aqi >= assignment.questions.length) {
        mode = 'idle';
        return say(`${grade.feedback} You completed all ${assignment.questions.length} questions.`);
      }
      return say(`${grade.feedback} ${assignmentQuestionText(aqi)}`);
    }
    if (/\?|\b(why|how|explain|tell me|what is|what does)\b/i.test(text) && !relatesToQuiz(text)) {
      return answerSideQuestion(text);
    }
    APP.state('thinking');
    try {
      const out = await withTimeout(LLM.chat([
        { role: 'system', content: PED.systemPrompt(
          'SOCRATIC ASSIGNMENT CONVERSATION. Discuss the quiz naturally using only the Google Doc, current question, and recent dialogue. Never mention browser scraping, fallback data, embedded data, or any source other than the Google Doc. Answer clarification questions without revealing the correct choice. Briefly acknowledge the learner, then ask exactly one targeted question that helps them reason from evidence, eliminate an option, or test a prediction. Under 55 words.'
        ) + '\n' + memoryBlock() + '\n' + contextBlock() },
        ...history.slice(-6),
        { role: 'user', content: 'Question: ' + assignment.questions[aqi] + '\nStudent: ' + text }
      ], { maxTokens: 120, timeoutMs: 8000 }), 10000, 'assignment-timeout');
      history.push({ role: 'user', content: text }, { role: 'assistant', content: out });
      await say(out);
    } catch (e) {
      await say(LLM.explainError(e));
    }
  }

  async function saveCurrentAnswers() {
    let body = 'Basira answers\n' + new Date().toISOString() + '\n\n';
    if (assignment) {
      body += 'Assignment: ' + assignment.title + '\n\n';
      (assignment.questions || []).forEach((q, i) => {
        body += 'Q' + (i + 1) + ': ' + q + '\nA: ' + (assignmentAnswers[i] || '(blank)') + '\n\n';
      });
    } else {
      body += history.map(h => h.role + ': ' + LLM.extractText(h.content)).join('\n');
    }
    if (window.DEMO) DEMO.saveAnswers('basira-answers.txt', body);
    else {
      const blob = new Blob([body], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'basira-answers.txt';
      a.click();
    }
    await say('Saved your answers to a file download.');
  }

  /* ==================== FREE CONVERSATION ==================== */
  function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
      promise.finally(() => clearTimeout(timer)),
      new Promise((_, rej) => {
        timer = setTimeout(() => {
          const err = new Error(label || 'timeout');
          err.code = 'timeout';
          rej(err);
        }, ms);
      })
    ]);
  }

  async function converse(text) {
    if (busy) {
      pendingUtterances = [String(text)];
      APP.caption('assistant', 'I heard you · finishing the current thought');
      return;
    }
    busy = true;
    APP.state('thinking');
    if (window.TELEM) TELEM.logEvent('turn-start', { text });
    if (window.TELEM) TELEM.beginTurn(text);

    try {
      history.push({ role: 'user', content: String(text) });
      const slimHistory = history.slice(-10).map(m => ({
        role: m.role,
        content: LLM.extractText(m.content) || '[image]'
      }));
      const sys =
        PED.systemPrompt(
          'REAL-TIME voice chat (GPT Live). Teach the SUBJECT clearly. Never meta-talk about blindness or disability. ' +
          'Never address the learner by name. Reply in 35 words or fewer using at most 2 short sentences.'
        ) + '\n\n' + memoryBlock() + '\n\n' + contextBlock();
      const msgs = [{ role: 'system', content: sys }, ...slimHistory];

      // PRIMARY: GPT Live (openai/gpt-audio-mini) — audio + transcript together
      // FALLBACK: text model + edge-tts / system voice
      let out = '';
      let via = 'gpt-live';
      try {
        APP.state('speaking');
        const resp = await withTimeout(
          TTS.speakLLM(msgs, {
            onTranscript: (t) => {
              if (window.TELEM) TELEM.markAudioFirstByte();
              APP.caption('assistant', t);
            },
            maxTokens: 180,
            timeoutMs: 10000
          }),
          18000,
          'gpt-live-timeout'
        );
        out = (resp && resp.transcript || '').trim();
        if (!out) throw new Error('no-audio');
        rememberSpoken(out);
        history.push({ role: 'assistant', content: out });
        via = 'gpt-live';
      } catch (audioErr) {
        TTS.stop();
        console.warn('[gpt-live failed → text fallback]', audioErr);
        try {
          out = await withTimeout(
            LLM.chat(msgs, { maxTokens: 100, timeoutMs: 8000 }),
            10000,
            'llm-timeout'
          );
          out = String(out || '').trim();
          if (!out) throw new Error('empty');
          rememberSpoken(out);
          history.push({ role: 'assistant', content: out });
          APP.caption('assistant', out);
          try { await withTimeout(TTS.speak(out), 25000, 'tts-timeout'); } catch (_) {}
          via = 'text-fallback';
        } catch (textErr) {
          console.warn('[text fallback failed]', textErr);
          EARCON.error();
          out = LLM.explainError(textErr);
          rememberSpoken(out);
          history.push({ role: 'assistant', content: out });
          try { await TTS.speak(out); } catch (_) {}
          via = 'error';
        }
      }
      if (window.TELEM) TELEM.endTurn(out, via);
      APP.state(STT.running ? 'listening' : 'idle');
    } catch (e) {
      console.error('[converse]', e);
      EARCON.error();
      if (window.TELEM) TELEM.endTurn('', 'error', e);
      try { await say(LLM.explainError(e)); } catch (_) {
        APP.caption('assistant', 'Connection error. Try again.');
      }
      APP.state(STT.running ? 'listening' : 'idle');
    } finally {
      busy = false;
      if (pendingUtterances.length) {
        const next = pendingUtterances.shift();
        setTimeout(() => converse(next), 40);
      }
    }
  }

  /* ==================== CAMERA ==================== */
  let camStream = null;

  async function openCamera() {
    if (camStream) return;
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false
    });
    const v = document.getElementById('camVideo');
    v.srcObject = camStream;
    await v.play();
    document.getElementById('camDock').hidden = false;
    document.getElementById('btnCam').classList.add('on');
  }

  function closeCamera() {
    if (camStream) { camStream.getTracks().forEach(x => x.stop()); camStream = null; }
    document.getElementById('camDock').hidden = true;
    document.getElementById('btnCam').classList.remove('on');
  }

  async function snapAndExplain(context, quietIfBoring) {
    if (!camStream) { try { await openCamera(); } catch (_) { return say('I could not open the camera.'); } }
    const v = document.getElementById('camVideo');
    if (!v.videoWidth) return;
    const cv = document.createElement('canvas');
    const sc = Math.min(1, C.frameWidth / v.videoWidth);
    cv.width = v.videoWidth * sc; cv.height = v.videoHeight * sc;
    cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
    const shot = cv.toDataURL('image/jpeg', 0.75);
    APP.state('thinking');
    try {
      const sys = quietIfBoring
        ? 'You glanced at the classroom screen. If it shows meaningful NEW visual content (diagram, graph, figure, worked example), teach it in under 50 words under your rules. If it is just text, faces, or nothing new, reply exactly: NOTHING_NEW'
        : 'Teach what matters in this image under your rules, 40-90 words. ' + (context || '');
      const out = await LLM.chat([
        { role: 'system', content: PED.systemPrompt(sys) },
        { role: 'user', content: [
          { type: 'text', text: context || 'What is on the screen?' },
          { type: 'image_url', image_url: { url: shot } }
        ] }
      ], { maxTokens: 350, preserveImages: true });
      if (quietIfBoring && /NOTHING_NEW/i.test(out)) { APP.state('listening'); return; }
      await say(out);
    } catch (_) {
      if (!quietIfBoring) await say('I could not read the screen just now.');
      APP.state('listening');
    }
  }

  /* ==================== UPLOADS (redundant path) ==================== */
  async function onFiles(files) {
    if (!files || !files.length) return;
    APP.state('thinking');
    APP.caption('assistant', 'Reading your files…');
    try {
      const material = await INGEST.collect([...files], m => APP.caption('assistant', m));
      uploadedMaterials = [...uploadedMaterials, ...material.texts].slice(-8);
      let text = `The learner uploaded: ${[...files].map(f => f.name).join(', ')}. Briefly identify the material, introduce one useful anchor, and end with one guiding question.`;
      material.texts.forEach(x => { text += `\n\n--- ${x.label} ---\n${x.text}`; });
      const parts = material.images.slice(0, 10).map(i => ({ type: 'image_url', image_url: { url: i.data } }));
      history.push({ role: 'user', content: parts.length ? [{ type: 'text', text }, ...parts] : text });
      const out = await LLM.chat([
        { role: 'system', content: PED.systemPrompt() },
        ...history.slice(-6)
      ], { maxTokens: 400, preserveImages: parts.length > 0 });
      history.push({ role: 'assistant', content: out });
      await say(out);
    } catch (_) {
      await say('I could not read those files. Try different ones.');
    }
  }

  window.ASSIST = {
    boot, sayHello, onFiles, route, closeCamera, enableDemoMode, disableDemoMode, setLanguage, injectText, toggleMute,
    get muted() { return muted; },
    toggleCamera: async () => {
      if (camStream) snapAndExplain('The student pressed the camera button.');
      else {
        try {
          await openCamera();
          say('Camera on. Press again to snap, or say: tutor, look at the screen.');
        } catch (_) {
          say('Camera permission denied.');
        }
      }
    }
  };
})();
