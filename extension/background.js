/* Basira Classroom Bridge — runs in YOUR Chrome, keeps your tabs & login */
const BRIDGE = 'http://127.0.0.1:8790';

let looping = false;
let lastStatus = 'starting';

chrome.runtime.onInstalled.addListener(() => startLoop());
chrome.runtime.onStartup.addListener(() => startLoop());
// wake when user clicks the extension icon
chrome.action.onClicked.addListener(() => startLoop());

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
        lastStatus = 'working:' + job.id;
        const result = await handleJob(job);
        await fetch(BRIDGE + '/extension/result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: job.id, ...result })
        });
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
    return scrapeClassroom();
  }
  return { ok: false, reason: 'unknown-action' };
}

async function scrapeClassroom() {
  // Reuse an existing Classroom tab if you already have one open
  const tabs = await chrome.tabs.query({ url: ['https://classroom.google.com/*'] });
  let tab = tabs[0];
  let created = false;
  if (!tab) {
    tab = await chrome.tabs.create({ url: 'https://classroom.google.com/', active: true });
    created = true;
    await waitTabComplete(tab.id, 45000);
    await sleep(2000);
  } else {
    // refresh home so we see current classes
    await chrome.tabs.update(tab.id, { active: true, url: 'https://classroom.google.com/' });
    await waitTabComplete(tab.id, 45000);
    await sleep(1500);
  }

  // First pass: home page courses
  let data = await injectScrape(tab.id);
  if (data.loginRequired) {
    return {
      ok: false,
      reason: 'login-required',
      mode: 'extension',
      hint: 'Sign in to Google Classroom in this browser, then ask again.',
      courses: [],
      materials: [],
      courseWork: []
    };
  }

  const courses = data.courses || [];
  let assignmentBits = data.lines || [];
  let courseName = courses[0]?.title || '';

  // Open first/only course Classwork if we found a course link
  if (courses[0]?.href) {
    let href = courses[0].href;
    if (href.startsWith('/')) href = 'https://classroom.google.com' + href;
    // Prefer classwork view
    if (!/\/c\/w\//.test(href) && /\/c\//.test(href)) {
      // leave as course stream; try classwork tab via injection later
    }
    await chrome.tabs.update(tab.id, { url: href });
    await waitTabComplete(tab.id, 45000);
    await sleep(2000);
    // try click Classwork
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const els = [...document.querySelectorAll('a,button,[role="tab"]')];
        const hit = els.find(e => /classwork/i.test((e.textContent || '').trim()));
        if (hit) hit.click();
      }
    }).catch(() => {});
    await sleep(1800);
    const coursePage = await injectScrape(tab.id);
    courseName = courseName || coursePage.title || '';
    if (coursePage.lines?.length) assignmentBits = coursePage.lines;
  }

  assignmentBits = uniq(assignmentBits).slice(0, 40);
  const materials = assignmentBits.length ? [{
    title: 'Pulled from Google Classroom',
    type: 'extension-scrape',
    text: assignmentBits.slice(0, 30).join('\n')
  }] : [];
  const courseWork = assignmentBits.length ? [{
    title: assignmentBits[0].slice(0, 80),
    due: assignmentBits.find(b => /due/i.test(b)) || '',
    questions: assignmentBits.slice(0, 12)
  }] : [];

  return {
    ok: true,
    mode: 'extension',
    course: { name: courseName || (courses[0]?.title || 'Google Classroom'), teacher: '' },
    courses,
    materials,
    courseWork,
    announcements: [],
    rawPreview: (assignmentBits.join('\n') || data.textPreview || '').slice(0, 1500),
    createdTab: created
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
      for (const a of document.querySelectorAll('a')) {
        const href = a.getAttribute('href') || '';
        const title = (a.innerText || '').replace(/\s+/g, ' ').trim();
        if (!title || title.length > 80) continue;
        if (href.includes('/c/') || href.includes('classroom.google.com/c/')) {
          courses.push({ title, href });
        }
      }
      // de-dupe
      const seen = new Set();
      const uniqCourses = [];
      for (const c of courses) {
        const k = c.title.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        uniqCourses.push(c);
      }

      const lines = text.split(/\n+/)
        .map(l => l.trim())
        .filter(l => l.length >= 8 && l.length <= 140);

      return {
        loginRequired,
        title: document.title || '',
        url: location.href,
        courses: uniqCourses.slice(0, 12),
        lines,
        textPreview: text.slice(0, 2000)
      };
    }
  }).then(res => (res && res[0] && res[0].result) || { loginRequired: false, courses: [], lines: [] });
}

function waitTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    function check(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(check);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(check);
    chrome.tabs.get(tabId, (tab) => {
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
    const k = x.toLowerCase();
    if (s.has(k)) continue;
    s.add(k);
    out.push(x);
  }
  return out;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// popup status
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg === 'status') {
    sendResponse({ status: lastStatus, bridge: BRIDGE });
    return true;
  }
});
