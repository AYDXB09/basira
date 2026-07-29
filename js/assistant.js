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
  const NAME = C.studentName;

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

    // 1. TALK FIRST. Never gate speech behind anything.
    const greeting = `Hi ${NAME}, I'm here. Say connect my classroom, classroom mode, quiz mode, assignment mode — or just talk to me.`;
    TTS.prewarm([greeting]);
    const greetDone = say(greeting);

    // 2. Mic warm-up IN PARALLEL. If the Allow prompt sits unclicked,
    //    remind out loud instead of hanging silently.
    APP.mic('waiting');
    let granted = false;
    const reminder = setTimeout(() => {
      if (!granted) say('One thing — there is a microphone prompt on screen. Click Allow, once, and then I can hear you.');
    }, 6000);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      s.getTracks().forEach(t => t.stop());   // we only needed the grant
      granted = true;
      clearTimeout(reminder);
    } catch (_) {
      clearTimeout(reminder);
      APP.mic('blocked');
      await greetDone;
      say('The microphone is blocked. Click the mic icon in the address bar, choose allow, and reload me.');
      return;
    }

    // 3. Ears on.
    startEars();
    APP.mic('on');

    // 4. SELF-TEST: if the recognizer never hears ANYTHING, say so out loud.
    setTimeout(() => {
      if (!STT.heardAnything) {
        say(`Quick check — I have not heard any sound yet. If you spoke, your microphone may be muted or set to the wrong device.`);
      }
    }, 10000);
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

    APP.caption('user', text);

    /* ------------------- global commands ------------------- */
    if (/\bend class\b|\bstop class\b/.test(t)) return endClassroom();
    if (/classroom mode|start class\b|class mode/.test(t)) return startClassroom();
    if (/connect.*(classroom|google)|pull.*classroom/.test(t)) return connectClassroom();
    if (/quiz mode|quiz me|knowledge check|test me/.test(t)) return startQuiz();
    if (/assignment mode|assignments?\b|homework/.test(t) && mode !== 'assignment') return startAssignments();
    if (/change (the )?voice|different voice/.test(t)) {
      const v = TTS.cycleVoice();
      return say(`This is ${v}. Say change voice again for the next one.`);
    }
    if (/\brepeat\b|say (that|it) again/.test(t)) return say(lastSaid || 'Nothing to repeat yet.');
    if (/\b(stop|pause|be quiet|silence|shut up)\b/.test(t)) { TTS.stop(); APP.state('listening'); return; }
    if (/what can you do|\bhelp\b|commands/.test(t))
      return say(`I can connect to your Google Classroom and pull files and homework. In classroom mode I listen to the teacher, watch the screen through the camera, and explain every visual for you. Quiz mode checks your retention after class. Assignment mode walks you through your homework. Or just ask me anything, any time — and interrupt me whenever you want.`);
    if (/camera (on|off)|look at (the )?(screen|board)/.test(t)) {
      if (/off/.test(t)) { closeCamera(); return say('Camera off.'); }
      await openCamera();
      return snapAndExplain('The student asked me to look at the screen or board.');
    }
    if (/upload|add (a )?file/.test(t)) {
      document.getElementById('fileInput').click();
      return say('File picker is open. If you have sighted help nearby they can pick the files, or drop them in from Classroom with: connect my classroom.');
    }

    /* ------------------- mode-specific ------------------- */
    if (mode === 'quiz') return quizAnswer(text);
    if (mode === 'assignment') return assignmentTurn(text);

    /* ------------------- free conversation ------------------- */
    return converse(text);
  }

  /* ==================== GOOGLE CLASSROOM ==================== */
  async function loadClassroomBundle() {
    // Prefer local bridge (live brain + TTS). Fall back to static JSON (GitHub Pages).
    try {
      const r = await fetch(C.bridge + '/classroom/summary', { signal: AbortSignal.timeout(1500) });
      if (r.ok) {
        const summary = await r.json();
        const mats = await fetch(C.bridge + '/classroom/materials').then(x => x.json());
        const works = await fetch(C.bridge + '/classroom/coursework').then(x => x.json());
        return { summary, materialsFull: mats, works, source: 'bridge' };
      }
    } catch (_) { /* offline / Pages */ }
    const full = await fetch('data/classroom.json', { cache: 'no-store' }).then(x => x.json());
    return {
      summary: {
        course: full.course.name,
        teacher: full.course.teacher,
        materialCount: full.materials.length,
        materials: full.materials.map(m => m.title),
        courseworkCount: full.courseWork.length,
        coursework: full.courseWork.map(w => ({ title: w.title, due: w.due })),
        announcements: full.announcements
      },
      materialsFull: full.materials,
      works: full.courseWork,
      source: 'static'
    };
  }

  async function connectClassroom() {
    APP.state('thinking');
    try {
      const pack = await loadClassroomBundle();
      classroom = pack.summary;
      classroom.materialsFull = pack.materialsFull;
      classroom.works = pack.works;
      const hw = classroom.coursework.map(w => `${w.title}, due ${w.due}`).join('; ');
      await say(`Connected. ${classroom.course} with ${classroom.teacher}. ` +
        `${classroom.materialCount} class files: ${classroom.materials.join(', ')}. ` +
        `${classroom.courseworkCount} assignments: ${hw}. ` +
        `Latest announcement: ${classroom.announcements[0]} ` +
        `Say classroom mode when class starts, or assignment mode to work on homework.`);
    } catch (_) {
      EARCON.error();
      await say('I could not load classroom data. Check that data/classroom.json is available, or run the local bridge.');
    }
  }

  function materialsContext() {
    if (!classroom?.materialsFull) return CONTENT.lesson.title + '\n' +
      CONTENT.lesson.segments.map(s => s.title + ': ' + s.teach).join('\n');
    return classroom.materialsFull.map(m => `FILE "${m.title}":\n${m.text}`).join('\n\n');
  }

  /* ==================== CLASSROOM MODE ==================== */
  async function startClassroom() {
    mode = 'classroom';
    classTranscript = '';
    await openCamera().catch(() => {});
    if (!classroom) {
      await say(`Classroom mode on. Quick thing first — say connect my classroom if you want me to pull today's files, or we can just start. I am listening to the teacher now, and watching the screen through the camera. Any files you want to add, just tell me. When you need me, start with the word tutor. Say end class when it's over.`);
    } else {
      await say(`Classroom mode on. I have today's files from ${classroom.course}. I'm listening to ${classroom.teacher} and watching the screen. Start with the word tutor when you need me. Say end class when it's over.`);
    }
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
        { role: 'user', content: 'CLASS TRANSCRIPT:\n' + classTranscript.slice(-8000) + '\n\nCLASS FILES:\n' + materialsContext().slice(0, 4000) }
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
        { role: 'user', content: (classTranscript ? 'CLASS TRANSCRIPT:\n' + classTranscript.slice(-6000) + '\n\n' : '') + 'CLASS MATERIALS:\n' + materialsContext().slice(0, 4000) }
      ], { maxTokens: 1200 });
      quiz = data.questions;
      if (!quiz?.length) throw new Error('bad');
    } catch (_) {
      quiz = [
        { q: 'What does Newton\'s second law connect, in your own words?', level: 'easy', answer: 'force equals mass times acceleration', why: 'F = m a is the law itself.' },
        { q: 'Same push, heavier trolley — what happens to the acceleration and why?', level: 'medium', answer: 'it decreases because acceleration is force divided by mass', why: 'More mass, same force, less acceleration.' },
        { q: 'On a velocity-time graph, what physical quantity is the steepness, and what does a flat line mean?', level: 'medium', answer: 'steepness is acceleration; flat means constant speed', why: 'Slope of velocity-time IS acceleration.' },
        { q: 'A box slides at constant velocity. What is the net force, and what does that say about friction?', level: 'hard', answer: 'net force is zero, friction exactly balances the push', why: 'Constant velocity means balanced forces.' }
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
    if (!classroom) {
      await connectClassroom();
      if (!classroom) return;
    }
    APP.state('thinking');
    try {
      const works = classroom.works || (await loadClassroomBundle()).works;
      classroom.works = works;
      assignment = works[0]; aqi = 0;
      mode = 'assignment';
      await say(`Assignment mode. ${assignment.title}, due ${assignment.due}, ${assignment.questions.length} questions. I coach, I don't just hand answers. ${assignment.questions[0]} Take your time — think out loud if it helps.`);
    } catch (_) {
      await say('I could not pull your coursework.');
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
        { role: 'system', content: PED.systemPrompt(`You are coaching homework, question ${aqi + 1}: "${assignment.questions[aqi]}". The student just responded. If their reasoning is right, confirm and sharpen it, then suggest saying "next question". If wrong or stuck, do NOT give the answer — give the next small step or a guiding question, under your teaching rules. 30-70 words.`) + '\n\nCLASS MATERIALS:\n' + materialsContext().slice(0, 3000) },
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
      // don't drop the user on the floor — queue one turn
      console.warn('[converse] busy, retrying in 400ms');
      setTimeout(() => { if (!busy) converse(text); }, 400);
      return;
    }
    busy = true;
    APP.state('thinking');
    const tick = setInterval(() => EARCON.think(), 1700);
    try {
      // history stays text-only so later turns never re-ship camera base64
      history.push({ role: 'user', content: String(text) });
      const slimHistory = history.slice(-10).map(m => ({
        role: m.role,
        content: LLM.extractText(m.content) || '[image]'
      }));
      const out = await LLM.chat([
        { role: 'system', content: PED.systemPrompt('Live voice conversation. Answer directly, then stop. 20-80 words.') + '\n\nSTUDENT\'S CLASS MATERIALS:\n' + materialsContext().slice(0, 3500) },
        ...slimHistory
      ], { maxTokens: 350, timeoutMs: 45000 });
      history.push({ role: 'assistant', content: out });
      clearInterval(tick); busy = false;
      await say(out);
    } catch (e) {
      clearInterval(tick); busy = false;
      EARCON.error();
      console.error('[converse]', e);
      await say(LLM.explainError(e));
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
