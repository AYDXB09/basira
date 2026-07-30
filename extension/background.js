/* Basira Classroom Bridge — scrapes YOUR signed-in Classroom and streams
   live screenshots to the Basira in-page browser window via the local bridge.
   NEVER steals focus long-term: Classroom/Docs tabs open inactive; Basira stays selected. */
const BRIDGE = 'http://127.0.0.1:8790';

let looping = false;
let lastStatus = 'starting';
let shotCount = 0;
const MAX_SHOTS = 8;

chrome.runtime.onInstalled.addListener(() => startLoop());
chrome.runtime.onStartup.addListener(() => startLoop());
chrome.alarms.create('basira-wake', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'basira-wake') startLoop();
});
startLoop();

function startLoop() {
  if (looping) return;
  looping = true;
  loop();
}

async function loop() {
  while (true) {
    try {
      lastStatus = 'waiting';
      const r = await fetch(BRIDGE + '/extension/wait?timeout=25', { cache: 'no-store' });
      if (!r.ok) throw new Error('http-' + r.status);
      const job = await r.json();
      if (job && job.id) {
        lastStatus = 'working';
        const result = await handleJob(job);
        await postResult(job.id, result);
        lastStatus = 'done';
      } else {
        lastStatus = 'idle';
      }
    } catch (e) {
      lastStatus = 'bridge-offline';
      await sleep(2000);
    }
  }
}

async function handleJob(job) {
  if (job.action === 'scrape-classroom' || job.action === 'classroom') {
    return scrapeClassroom(job.id);
  }
  return { ok: false, reason: 'unknown-action', id: job.id };
}

/** Cursor path through the agent flow (normalized 0–1). */
function cursorFor(step) {
  const path = {
    home: { x: 0.28, y: 0.32 },
    cards: { x: 0.35, y: 0.48 },
    course: { x: 0.42, y: 0.55 },
    classwork: { x: 0.38, y: 0.12 },
    assignments: { x: 0.45, y: 0.42 },
    docOpen: { x: 0.52, y: 0.58 },
    docRead: { x: 0.5, y: 0.45 },
    done: { x: 0.5, y: 0.5 }
  };
  return path[step] || { x: 0.5, y: 0.5 };
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] && tabs[0].id;
}

/**
 * captureVisibleTab only works on the active tab.
 * Briefly activate target, capture, restore Basira (focus owner) immediately.
 */
async function captureBackground(tabId, basiraTabId) {
  if (tabId == null || shotCount >= MAX_SHOTS) return null;
  try {
    await chrome.tabs.update(tabId, { active: true });
    await sleep(150);
    const shot = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 45 });
    shotCount += 1;
    if (basiraTabId != null) {
      try { await chrome.tabs.update(basiraTabId, { active: true }); } catch (_) {}
    }
    return shot;
  } catch (_) {
    if (basiraTabId != null) {
      try { await chrome.tabs.update(basiraTabId, { active: true }); } catch (_) {}
    }
    return null;
  }
}

async function postProgress(id, status, url, tabId, basiraTabId, cursorStep, withShot) {
  let screenshot = null;
  if (withShot && tabId != null) {
    screenshot = await captureBackground(tabId, basiraTabId);
  }
  const cursor = cursorFor(cursorStep || 'home');
  try {
    await fetch(BRIDGE + '/extension/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status, url, screenshot, cursor })
    });
  } catch (_) {}
}

async function postResult(id, result) {
  await fetch(BRIDGE + '/extension/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...result })
  });
}

async function scrapeClassroom(jobId) {
  shotCount = 0;
  const basiraTabId = await getActiveTabId();

  let tabs = await chrome.tabs.query({ url: ['https://classroom.google.com/*'] });
  let tab = tabs[0];
  let created = false;

  await postProgress(
    jobId, 'Opening Google Classroom…', 'https://classroom.google.com/',
    tab && tab.id, basiraTabId, 'home', false
  );

  if (!tab) {
    tab = await chrome.tabs.create({ url: 'https://classroom.google.com/', active: false });
    created = true;
    await waitTabComplete(tab.id, 45000);
    await sleep(1500);
  } else {
    await chrome.tabs.update(tab.id, { url: 'https://classroom.google.com/', active: false });
    await waitTabComplete(tab.id, 45000);
    await sleep(1200);
  }

  // Ensure Basira still focused after open/nav
  if (basiraTabId != null) {
    try { await chrome.tabs.update(basiraTabId, { active: true }); } catch (_) {}
  }

  await postProgress(
    jobId, 'Reading your classes…', 'https://classroom.google.com/',
    tab.id, basiraTabId, 'cards', true
  );

  let data = await injectScrape(tab.id);
  if (data.loginRequired) {
    const shot = await captureBackground(tab.id, basiraTabId);
    return {
      ok: false,
      reason: 'login-required',
      mode: 'extension',
      hint: 'Sign in to Google Classroom, then ask again.',
      screenshot: shot,
      url: data.url || 'https://classroom.google.com/',
      courses: [],
      materials: [],
      courseWork: [],
      cursor: cursorFor('home')
    };
  }

  const courses = data.courses || [];
  let assignmentBits = data.lines || [];
  let courseName = courses[0]?.title || '';
  let materials = [];

  if (courses[0]?.href) {
    let href = courses[0].href;
    if (href.startsWith('/')) href = 'https://classroom.google.com' + href;
    await postProgress(
      jobId, 'Opening ' + (courseName || 'class') + '…', href,
      tab.id, basiraTabId, 'course', true
    );
    await chrome.tabs.update(tab.id, { url: href, active: false });
    await waitTabComplete(tab.id, 45000);
    await sleep(1400);
    if (basiraTabId != null) {
      try { await chrome.tabs.update(basiraTabId, { active: true }); } catch (_) {}
    }

    await postProgress(
      jobId, 'Opening Classwork…', href,
      tab.id, basiraTabId, 'classwork', true
    );

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const els = [...document.querySelectorAll('a,button,[role="tab"]')];
        const hit = els.find(e => /classwork/i.test((e.textContent || '').trim()));
        if (hit) hit.click();
      }
    }).catch(() => {});
    await sleep(1600);

    await postProgress(
      jobId, 'Scanning assignments…', href,
      tab.id, basiraTabId, 'assignments', true
    );

    const coursePage = await injectScrape(tab.id);
    courseName = courseName || coursePage.title || '';
    if (coursePage.lines?.length) assignmentBits = coursePage.lines;

    // Open up to 2 Google Docs in background tabs, scrape, screenshot, close
    const docLinks = (coursePage.docLinks || []).slice(0, 2);
    for (const doc of docLinks) {
      await postProgress(
        jobId, 'Opening Doc: ' + (doc.title || 'document'), doc.href,
        tab.id, basiraTabId, 'docOpen', false
      );
      const docTab = await chrome.tabs.create({ url: doc.href, active: false });
      await waitTabComplete(docTab.id, 45000);
      await sleep(2000);
      if (basiraTabId != null) {
        try { await chrome.tabs.update(basiraTabId, { active: true }); } catch (_) {}
      }

      await postProgress(
        jobId, 'Reading Google Doc…', doc.href,
        docTab.id, basiraTabId, 'docRead', true
      );

      const body = await chrome.scripting.executeScript({
        target: { tabId: docTab.id },
        func: () => (document.body && document.body.innerText || '').slice(0, 8000)
      }).then(r => (r && r[0] && r[0].result) || '').catch(() => '');
      materials.push({
        title: doc.title || 'Google Doc',
        type: 'gdoc',
        text: body
      });
      try { await chrome.tabs.remove(docTab.id); } catch (_) {}
    }
  }

  assignmentBits = uniq(assignmentBits).slice(0, 40);
  if (assignmentBits.length) {
    materials.unshift({
      title: 'Pulled from Google Classroom',
      type: 'extension-scrape',
      text: assignmentBits.slice(0, 30).join('\n')
    });
  }
  const courseWork = assignmentBits.length ? [{
    title: assignmentBits[0].slice(0, 80),
    due: assignmentBits.find(b => /due/i.test(b)) || '',
    questions: assignmentBits.slice(0, 12)
  }] : [];

  const finalShot = await captureBackground(tab.id, basiraTabId);
  const finalUrl = data.url || 'https://classroom.google.com/';
  await postProgress(
    jobId, 'Done', finalUrl,
    tab.id, basiraTabId, 'done', false
  );

  // Basira tab stays selected
  if (basiraTabId != null) {
    try { await chrome.tabs.update(basiraTabId, { active: true }); } catch (_) {}
  }

  return {
    ok: true,
    mode: 'extension',
    course: { name: courseName || (courses[0]?.title || 'Google Classroom'), teacher: '' },
    courses,
    materials,
    courseWork,
    announcements: [],
    rawPreview: (assignmentBits.join('\n') || data.textPreview || '').slice(0, 1500),
    screenshot: finalShot,
    url: finalUrl,
    createdTab: created,
    cursor: cursorFor('done')
  };
}

function injectScrape(tabId) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const text = (document.body && document.body.innerText) || '';
      const lower = (text + ' ' + location.href + ' ' + document.title).toLowerCase();
      const loginRequired = /sign in|accounts\.google\.com|choose an account|to continue to google/.test(lower)
        && !/classroom\.google\.com\/[uhc]/.test(location.href);

      const courses = [];
      const docLinks = [];
      for (const a of document.querySelectorAll('a')) {
        const href = a.getAttribute('href') || '';
        const title = (a.innerText || '').replace(/\s+/g, ' ').trim();
        if (href.includes('docs.google.com/document')) {
          const full = href.startsWith('http') ? href : (location.origin + href);
          docLinks.push({ title: title || 'Google Doc', href: full });
        }
        if (!title || title.length > 80) continue;
        if (href.includes('/c/') || href.includes('classroom.google.com/c/')) {
          courses.push({ title, href });
        }
      }
      const seen = new Set();
      const uniqCourses = [];
      for (const c of courses) {
        const k = c.title.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        uniqCourses.push(c);
      }
      const dseen = new Set();
      const uniqDocs = [];
      for (const d of docLinks) {
        if (dseen.has(d.href)) continue;
        dseen.add(d.href);
        uniqDocs.push(d);
      }
      const lines = text.split(/\n+/).map(l => l.trim()).filter(l => l.length >= 8 && l.length <= 140);
      return {
        loginRequired,
        title: document.title || '',
        url: location.href,
        courses: uniqCourses.slice(0, 12),
        docLinks: uniqDocs.slice(0, 5),
        lines,
        textPreview: text.slice(0, 2000)
      };
    }
  }).then(res => (res && res[0] && res[0].result) || { loginRequired: false, courses: [], lines: [], docLinks: [] });
}

function waitTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    function check(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(check);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(check);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return resolve();
      if (tab && tab.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(check);
        resolve();
      }
    });
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(check);
      resolve();
    }, timeoutMs);
  });
}

function uniq(arr) {
  const s = new Set();
  const out = [];
  for (const x of arr) {
    const k = String(x).toLowerCase();
    if (s.has(k)) continue;
    s.add(k);
    out.push(x);
  }
  return out;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg === 'start') {
    looping = false;
    startLoop();
    sendResponse({ ok: true, status: lastStatus });
    return true;
  }
  if (msg === 'status') {
    sendResponse({ status: lastStatus, bridge: BRIDGE });
    return true;
  }
});
