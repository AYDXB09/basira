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
  let mode = 'idle';           // idle | classroom | quiz | assignment
  let busy = false;

  let classroom = null;        // pulled classroom summary/materials/coursework
  let classTranscript = '';    // what the teacher said (classroom mode)
  let snapTimer = null;

  let quiz = null, qi = 0, qScore = 0, qMisses = [];
  let assignment = null, aqi = 0;

  let lastSaid = '';           // for "repeat"

  /* ============================ BOOT ============================ */
  async function boot() {
    APP.state('speaking');
    EARCON.unlock();

    // EARS FIRST — the user can interrupt the greeting if they want
    startEars();
    APP.mic('on');

    const greeting = 'Hi. I am listening.';
    TTS.prewarm();
    await say(greeting);

    // mic permission check in parallel (non-blocking for speech)
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      s.getTracks().forEach(t => t.stop());
    } catch (_) {
      say('Microphone may be blocked. Allow it in the address bar if I cannot hear you.');
    }
  }

  async function say(text) {
    lastSaid = text;
    APP.state('speaking');
    APP.caption('assistant', text);
    await TTS.speak(text);
    APP.state(mode === 'classroom' ? 'listening' : (STT.running ? 'listening' : 'idle'));
  }

  /* ==================== ALWAYS-ON EARS + BARGE-IN ==================== */
  function startEars() {
    if (!STT.supported()) { APP.caption('assistant', 'Voice needs Chrome.'); return; }
    STT.startAlways({
      onInterim: (t) => {
        APP.caption('user', '… ' + t);         // live proof it hears you
        // BARGE-IN: user starts talking while tutor speaks → tutor shuts up
        if (TTS.speaking && wordCount(t) >= 2 && !isEcho(t)) TTS.stop();
      },
      onUtterance: (t) => {
        if (isEcho(t)) { console.log('[echo dropped]', t); return; }
        // Only cut REAL audio; never mute the first word of the answer
        if (TTS.speaking && !window.speechSynthesis.speaking) TTS.stop();
        route(t);
      },
      onError: (e) => {
        if (e === 'mic-denied') say('The microphone is blocked. Click the mic icon in the address bar, allow it, and reload me.');
        if (e === 'network') say('Speech recognition lost its connection. Check the internet for a moment.');
      }
    });
    APP.state('listening');
  }

  function wordCount(s) { return s.trim().split(/\s+/).filter(Boolean).length; }

  /** echo filter: does this transcript look like what WE are saying right now? */
  function isEcho(t) {
    if (!TTS.speaking && !TTS.currentText) return false;
    if (!TTS.speaking) return false;
    const said = new Set(TTS.currentText.toLowerCase().replace(/[^\w\s']/g, '').split(/\s+/));
    const words = t.toLowerCase().replace(/[^\w\s']/g, '').split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const hits = words.filter(w => said.has(w)).length;
    return hits / words.length > 0.6;
  }

  /* ============================ ROUTER ============================ */
  async function route(text) {
    const t = ' ' + text.toLowerCase() + ' ';

    /* -- classroom mode: everything is teacher audio unless addressed -- */
    if (mode === 'classroom') {
      const addressed = /\b(tutor|hey tutor|assistant)\b/.test(t) || /\bend class\b/.test(t);
      if (!addressed) { feedClass(text); return; }
    }

    APP.caption('user', text); // no-op (captions off)

    /* ------------------- global commands ------------------- */
    if (/\bend class\b|\bstop class\b/.test(t)) return endClassroom();
    if (/classroom mode|start class\b|class mode/.test(t)) return startClassroom();

    // OPEN / CHECK real Classroom — never invent course data
    if (/open (google )?classroom|open (my )?classroom|check (my )?(latest )?assignment|check (my )?classroom|what('?s| is) (my )?(latest )?assignment/.test(t)) {
      return handleClassroomRequest(text);
    }

    // Demo pack ONLY when user explicitly asks (physics sample data)
    if (/load demo class|demo classroom|sample class|use (the )?demo/.test(t)) {
      return connectClassroom(true);
    }
    if (/disconnect classroom|forget (the )?materials|clear (the )?course/.test(t)) {
      classroom = null; history = [];
      return say('Cleared. No class materials loaded.');
    }
    if (/quiz mode|quiz me|knowledge check|test me/.test(t)) return startQuiz();
    // ONLY "assignment mode" — bare word "assignment" must NOT fire (that caused Newton demo)
    if (/\bassignment mode\b|\bhomework mode\b|\bhelp with (my )?homework\b/.test(t) && mode !== 'assignment') {
      return startAssignments();
    }
    if (/change (the )?voice|different voice/.test(t)) {
      const v = TTS.cycleVoice();
      return say(`This is ${v}. Say change voice again for the next one.`);
    }
    if (/\brepeat\b|say (that|it) again/.test(t)) return say(lastSaid || 'Nothing to repeat yet.');
    if (/\b(stop|pause|be quiet|silence|shut up)\b/.test(t)) { TTS.stop(); APP.state('listening'); return; }
    if (/what can you do|\bhelp\b|commands/.test(t))
      return say('I open Google Classroom in your browser, help with files you upload, listen in class, quiz you, and answer short questions. I never invent your homework.');
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

  async function handleClassroomRequest() {
    // REAL classroom request — open the site. Never invent Physics / fake homework.
    classroom = null;
    history = [];
    mode = 'idle';
    assignment = null;
    const opened = await openClassroomInBrowser();
    if (opened) {
      await say(
        'Opened Google Classroom. I cannot read your private assignments from here. ' +
        'Upload the file or paste the text and I will help. I will not invent classwork or a teacher.'
      );
    } else {
      await say(
        'Could not open the browser. Go to classroom.google.com, then upload or paste the assignment. I will not invent classwork.'
      );
    }
  }

  async function openClassroomOnly() {
    return handleClassroomRequest();
  }

  async function connectClassroom(preferDemo) {
    // Demo pack ONLY when preferDemo === true (explicit "load demo class")
    if (!preferDemo) return handleClassroomRequest();
    APP.state('thinking');
    try {
      const pack = await loadClassroomBundle(true);
      if (!pack) throw new Error('no-data');
      classroom = pack.summary;
      classroom.materialsFull = pack.materialsFull;
      classroom.works = pack.works;
      history = [];
      await say(
        'Loaded SAMPLE demo class only — not your real Google Classroom. ' +
        'Say assignment mode for sample homework, or open Google Classroom for your real one.'
      );
    } catch (_) {
      EARCON.error();
      await say('Could not load demo class data.');
    }
  }

  function materialsContext() {
    // ONLY real connected classroom / uploads. NEVER the old demo Physics stub.
    if (classroom?.materialsFull?.length) {
      return classroom.materialsFull.map(m =>
        `FILE "${m.title}":\n${m.text || m.description || ''}`
      ).join('\n\n');
    }
    return '';
  }

  function contextBlock() {
    const mats = materialsContext();
    if (!mats) {
      return `NO CLASS MATERIALS LOADED.
Do NOT invent a course, chapter, physics topic, Newton's laws, graphs, or any curriculum.
If the student has not connected Classroom or uploaded files, only answer what they ask.
If they ask about schoolwork and nothing is loaded, say: "Nothing is connected yet. Say connect my classroom, or upload a file."`;
    }
    return 'CLASS MATERIALS (use only these — do not invent extra topics):\n' + mats.slice(0, 4000);
  }

  /* ==================== CLASSROOM MODE ==================== */
  async function startClassroom() {
    mode = 'classroom';
    classTranscript = '';
    await openCamera().catch(() => {});
    await say('Classroom mode on. I am listening. Say tutor when you need me. Say end class when finished.');
    // periodic camera glance at the screen/board
    if (snapTimer) clearInterval(snapTimer);
    snapTimer = setInterval(() => {
      if (mode === 'classroom' && camStream) snapAndExplain(null, true);
    }, (C.classroomSnapshotSec || 45) * 1000);
    APP.state('listening');
  }

  /** teacher audio → transcript; visual cues trigger a camera look */
  let lastCue = 0;
  function feedClass(text) {
    classTranscript += text + ' ';
    APP.caption('user', '🎓 ' + text);
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
    if (wordCount(classTranscript) < 15) {
      return say(`Class ended. I did not catch much audio this time. Say quiz mode anyway to test yourself on the class files, or assignment mode for homework.`);
    }
    APP.state('thinking');
    try {
      const out = await LLM.chat([
        { role: 'system', content: PED.systemPrompt('Class just ended. From the transcript, give the student a tight spoken recap: the 2-3 core ideas, taught under your rules, 80-120 words. End by offering: quiz mode to check retention, or assignment mode.') },
        { role: 'user', content: 'CLASS TRANSCRIPT:\n' + classTranscript.slice(-8000) + '\n\n' + contextBlock() }
      ], { maxTokens: 500 });
      history.push({ role: 'assistant', content: out });
      await say(out);
    } catch (_) {
      await say('Class ended. I could not build the recap — network hiccup. Your transcript is saved; say quiz mode when ready.');
    }
  }

  /* ==================== QUIZ MODE (retention check) ==================== */
  async function startQuiz() {
    mode = 'quiz'; qi = 0; qScore = 0; qMisses = [];
    APP.state('thinking');
    await say('Quiz mode. Building your retention check from ' + (classTranscript ? 'today\'s class.' : 'your class files.'));
    try {
      const data = await LLM.chatJSON([
        { role: 'system', content: PED.systemPrompt(`Create a retention quiz. Return JSON exactly:
{"questions":[{"q":"spoken question","level":"easy|medium|hard","answer":"ideal short answer","why":"one-line explanation"}]}
Rules: exactly 4 questions, difficulty ramping easy → hard, all open-ended (no multiple choice — this is spoken), testing UNDERSTANDING of the taught ideas, never appearance or color.`) },
        { role: 'user', content: (classTranscript ? 'CLASS TRANSCRIPT:\n' + classTranscript.slice(-6000) + '\n\n' : '') + contextBlock() }
      ], { maxTokens: 1200 });
      quiz = data.questions;
      if (!quiz?.length) throw new Error('bad');
    } catch (_) {
      // Generic quiz — NO baked Newton / physics content
      quiz = [
        { q: 'In your own words, what was the main idea we just covered?', level: 'easy', answer: 'the main idea the student studied', why: 'Start from the big idea first.' },
        { q: 'Name one detail that supports that main idea.', level: 'medium', answer: 'a supporting detail from the material', why: 'Details carry the meaning.' },
        { q: 'Where might someone get confused about this?', level: 'medium', answer: 'a common confusion point', why: 'Spotting confusion is real understanding.' },
        { q: 'How would you explain this to a friend in one short sentence?', level: 'hard', answer: 'a plain-language one-liner', why: 'If you can teach it, you know it.' }
      ];
    }
    askQ();
  }

  async function askQ() {
    if (qi >= quiz.length) return finishQuiz();
    const q = quiz[qi];
    await say(`Question ${qi + 1}, ${q.level}. ${q.q}`);
  }

  async function quizAnswer(text) {
    if (/skip|don'?t know|no idea|pass\b/.test(text.toLowerCase())) {
      qMisses.push(quiz[qi]);
      await say(`No problem. The idea: ${quiz[qi].answer}. ${quiz[qi].why}`);
      qi++; return askQ();
    }
    APP.state('thinking');
    try {
      const verdict = await LLM.chatJSON([
        { role: 'system', content: PED.systemPrompt('Grade the student\'s spoken answer. Return JSON exactly: {"correct":true|false,"feedback":"1-2 spoken sentences: confirm what was right, fix what was wrong, warm but honest"}') },
        { role: 'user', content: `QUESTION: ${quiz[qi].q}\nIDEAL ANSWER: ${quiz[qi].answer}\nSTUDENT SAID: "${text}"` }
      ], { maxTokens: 250 });
      if (verdict.correct) { qScore++; EARCON.done(); } else { qMisses.push(quiz[qi]); EARCON.error(); }
      await say(verdict.feedback);
    } catch (_) {
      await say('I could not grade that one — we\'ll count it as a pass. ' + quiz[qi].why);
    }
    qi++; askQ();
  }

  async function finishQuiz() {
    mode = 'idle';
    const pct = Math.round(qScore / quiz.length * 100);
    let line = `Done. ${qScore} out of ${quiz.length} — about ${pct} percent retention from today. `;
    if (qMisses.length) line += `The gap to close: ${qMisses[0].why} Want me to re-teach that part? Just ask.`;
    else line += 'That is a full sweep. Genuinely strong.';
    await say(line);
  }

  /* ==================== ASSIGNMENT MODE ==================== */
  async function startAssignments() {
    if (!classroom || !classroom.works || !classroom.works.length) {
      await say(
        'No assignment loaded. Open Google Classroom and upload or paste the work here. ' +
        'Or say load demo class for sample homework only. I will not invent assignments.'
      );
      return handleClassroomRequest();
    }
    APP.state('thinking');
    try {
      const works = classroom.works;
      assignment = works[0]; aqi = 0;
      mode = 'assignment';
      await say(
        `Assignment mode. ${assignment.title}, due ${assignment.due || 'no due date'}. ` +
        `${assignment.questions.length} questions. ${assignment.questions[0]}`
      );
    } catch (_) {
      await say('I could not open that assignment.');
    }
  }

  async function assignmentTurn(text) {
    const t = text.toLowerCase();
    if (/next question|next one/.test(t)) {
      aqi++;
      if (aqi >= assignment.questions.length) { mode = 'idle'; return say('That was the last question. Nice work. Say quiz mode if you want a retention check, or just keep talking to me.'); }
      return say(assignment.questions[aqi]);
    }
    if (/read (the )?question|again/.test(t)) return say(assignment.questions[aqi]);
    APP.state('thinking');
    try {
      const out = await LLM.chat([
        { role: 'system', content: PED.systemPrompt(`You are coaching homework, question ${aqi + 1}: "${assignment.questions[aqi]}". The student just responded. If their reasoning is right, confirm and sharpen it, then suggest saying "next question". If wrong or stuck, do NOT give the answer — give the next small step or a guiding question, under your teaching rules. 30-70 words.`) + '\n\n' + contextBlock() },
        ...history.slice(-4),
        { role: 'user', content: text }
      ], { maxTokens: 350 });
      history.push({ role: 'user', content: text }, { role: 'assistant', content: out });
      await say(out);
    } catch (e) {
      await say(LLM.explainError(e));
    }
  }

  /* ==================== FREE CONVERSATION ==================== */
  async function converse(text) {
    if (busy) {
      setTimeout(() => { if (!busy) converse(text); }, 400);
      return;
    }
    busy = true;
    APP.state('thinking');
    TELEM.logEvent('turn-start', { text });
    const turn = TELEM.beginTurn(text);

    try {
      history.push({ role: 'user', content: String(text) });
      const slimHistory = history.slice(-10).map(m => ({
        role: m.role,
        content: LLM.extractText(m.content) || '[image]'
      }));

      const msgs = [
        { role: 'system', content:
            PED.systemPrompt('You are in a REAL-TIME voice conversation. Keep answers natural and conversational: usually 1-3 short sentences. Speak only — the transcript of your speech is shown as captions, so say exactly what you want displayed.') +
            '\n\n' + contextBlock() },
        ...slimHistory
      ];

      // GPT LIVE: one model hears the conversation and answers with voice.
      const t0 = performance.now();
      const resp = await TTS.speakLLM(msgs, {
        onTranscript: (t) => { TELEM.markAudioFirstByte(); APP.caption('assistant', t); },
        maxTokens: 700
      });
      const out = (resp.transcript || '').trim();
      history.push({ role: 'assistant', content: out });
      busy = false;
      TELEM.endTurn(out, 'gpt-audio');
      APP.state(STT.running ? 'listening' : 'idle');
    } catch (e) {
      console.warn('[gpt-live failed, falling back]', e);
      TELEM.logEvent('gpt-live-fail', { error: String(e) });
      try {
        const slimHistory = history.slice(-10).map(m => ({
          role: m.role, content: LLM.extractText(m.content) || '[image]'
        }));
        const out = await LLM.chat([
          { role: 'system', content: PED.systemPrompt('Live voice conversation. Answer ONLY what was asked. Maximum 2 short sentences.') + '\n\n' + contextBlock() },
          ...slimHistory
        ], { maxTokens: 160, timeoutMs: 20000 });
        history.push({ role: 'assistant', content: out });
        busy = false;
        await say(out);               // say() handles caption + edge/system voice
        TELEM.endTurn(out, 'fallback-text');
      } catch (e2) {
        busy = false;
        EARCON.error();
        TELEM.endTurn('', 'error', e2);
        await say(LLM.explainError(e2));
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
      ], { maxTokens: 350 });
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
      let text = `The student uploaded: ${[...files].map(f => f.name).join(', ')}. Say in one breath what they cover and offer to teach the most important visual part.`;
      material.texts.forEach(x => { text += `\n\n--- ${x.label} ---\n${x.text}`; });
      const parts = material.images.slice(0, 10).map(i => ({ type: 'image_url', image_url: { url: i.data } }));
      history.push({ role: 'user', content: parts.length ? [{ type: 'text', text }, ...parts] : text });
      const out = await LLM.chat([
        { role: 'system', content: PED.systemPrompt() },
        ...history.slice(-6)
      ], { maxTokens: 400 });
      history.push({ role: 'assistant', content: out });
      await say(out);
    } catch (_) {
      await say('I could not read those files. Try different ones.');
    }
  }

  window.ASSIST = { boot, onFiles, route, closeCamera, toggleCamera: async () => {
    if (camStream) snapAndExplain('The student pressed the camera button.');
    else { try { await openCamera(); say('Camera on. Press again to snap, or say: tutor, look at the screen.'); } catch (_) { say('Camera permission denied.'); } }
  } };
})();
