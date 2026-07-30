/* ============================================================================
 * demo-flow.js — 2-min live demo switches + revision/class helpers
 * ========================================================================== */
(function () {
  let demoOn = false;
  let memoryBeforeDemo = null;
  let profileBeforeDemo = null;

  function isOn() { return demoOn; }

  function activate() {
    if (!demoOn) {
      try { memoryBeforeDemo = window.MEM ? MEM.all() : null; } catch (_) { memoryBeforeDemo = null; }
      try { profileBeforeDemo = window.PED ? Object.assign({}, PED.profile) : null; } catch (_) { profileBeforeDemo = null; }
    }
    demoOn = true;
    const P = window.DEMO_PACK;
    if (!P) return null;

    if (window.MEM) {
      MEM.clear();
      MEM.seed(P.memoriesSeed || []);
    }
    if (window.PED && PED.saveProfile) {
      PED.saveProfile({ vision: 'congenital', level: 'primary' });
    }

    const pack = {
      course: P.classroom.course,
      teacher: P.classroom.teacher,
      materialCount: (P.classroom.materials || []).length,
      materials: (P.classroom.materials || []).map(m => m.title),
      courseworkCount: (P.classroom.courseWork || []).length,
      coursework: (P.classroom.courseWork || []).map(w => ({ title: w.title, due: w.due || '' })),
      announcements: P.classroom.announcements || [],
      materialsFull: P.classroom.materials || [],
      works: P.classroom.courseWork || [],
      lastWeek: P.lastWeek,
      student: P.student,
      source: 'demo'
    };

    // Brand panel as "browser"
    if (window.BPANEL) {
      BPANEL.show();
      BPANEL.setTitle('Demo · Grade 5 Science');
      BPANEL.setStatus('Demo profile loaded · Maya · Space unit + last week biology');
      BPANEL.setBodyHtml(
        '<div style="font-size:13px;line-height:1.5">' +
        '<b>Student</b> Maya (Grade 5, blind from birth)<br>' +
        '<b>Class</b> ' + pack.course + ' · ' + pack.teacher + '<br>' +
        '<b>Assignment</b> Space Quiz<br>' +
        '<b>Memory</b> Last week: plant parts<br>' +
        '</div>'
      );
    }
    return pack;
  }

  function deactivate() {
    demoOn = false;
    try { if (window.MEM && memoryBeforeDemo) MEM.save(memoryBeforeDemo); } catch (_) {}
    try { if (window.PED && profileBeforeDemo) PED.saveProfile(profileBeforeDemo); } catch (_) {}
    memoryBeforeDemo = null;
    profileBeforeDemo = null;
    if (window.BPANEL) BPANEL.hide();
  }

  /** Fake in-panel "browser crawl" for demo while live GC also runs */
  async function animateClassroomCrawl(statusLines) {
    if (!window.BPANEL) return;
    BPANEL.show();
    BPANEL.setTitle('Google Classroom');
    for (const line of (statusLines || [])) {
      BPANEL.setStatus(line);
      await new Promise(r => setTimeout(r, 350));
    }
  }

  function lastWeekLessonText() {
    const lw = window.DEMO_PACK && DEMO_PACK.lastWeek;
    if (!lw) return '';
    return lw.title + '\n' + lw.teach.map(s => s.title + ': ' + s.teach).join('\n');
  }

  // Simple save: download answers as text file (stand-in for "new Google Doc")
  function saveAnswers(filename, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'basira-answers.txt';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  // Lightweight "search image" for class mode solar-system style asks
  async function fetchTopicImage(query) {
    // Use Wikipedia REST summary originalimage when possible (no key)
    try {
      const q = encodeURIComponent(query);
      const r = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + q, {
        headers: { 'Accept': 'application/json' }
      });
      if (!r.ok) return null;
      const j = await r.json();
      const url = j.originalimage?.source || j.thumbnail?.source;
      return url ? { url, title: j.title || query, extract: j.extract || '' } : null;
    } catch (_) {
      return null;
    }
  }

  window.DEMO = {
    isOn, activate, deactivate, animateClassroomCrawl,
    lastWeekLessonText, saveAnswers, fetchTopicImage
  };
})();
