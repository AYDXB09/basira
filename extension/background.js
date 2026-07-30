/* Basira Classroom Bridge — follows the Classroom/Docs tab the agent uses and
   leaves the browser on the final working tab when the task completes. */
const BRIDGE = 'http://127.0.0.1:8790';

let polling = false;
let lastStatus = 'starting';
let shotCount = 0;
const MAX_SHOTS = 8;

chrome.runtime.onInstalled.addListener(() => startPolling());
chrome.runtime.onStartup.addListener(() => startPolling());
chrome.alarms.create('basira-wake', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'basira-wake') pollOnce();
});
startPolling();

function startPolling() {
  chrome.alarms.create('basira-wake', { periodInMinutes: 0.5 });
  pollOnce();
}

async function pollOnce() {
  if (polling) return;
  polling = true;
  try {
    lastStatus = 'waiting';
    const r = await fetch(BRIDGE + '/extension/wait?timeout=25', { cache: 'no-store' });
    if (!r.ok) throw new Error('http-' + r.status);
    const job = await r.json();
    if (job && job.id) {
      lastStatus = 'working';
      let result;
      try { result = await handleJob(job); }
      catch (e) { result = { ok: false, reason: 'extension-error', hint: String(e).slice(0, 300) }; }
      await postResult(job.id, result);
      lastStatus = result.ok ? 'done' : (result.reason || 'failed');
    } else {
      lastStatus = 'waiting';
    }
  } catch (e) {
    lastStatus = 'bridge-offline';
  } finally {
    polling = false;
    setTimeout(pollOnce, 250);
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

async function focusTab(tabId) {
  if (tabId == null) return null;
  const tab = await chrome.tabs.update(tabId, { active: true });
  if (tab?.windowId != null) {
    try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (_) {}
  }
  return tab;
}

/**
 * captureVisibleTab only works on the active tab.
 * Keep the target selected so the user follows the agent's current page.
 */
async function captureBackground(tabId, _basiraTabId) {
  if (tabId == null || shotCount >= MAX_SHOTS) return null;
  try {
    const tab = await focusTab(tabId);
    await sleep(150);
    const shot = await chrome.tabs.captureVisibleTab(tab?.windowId, { format: 'jpeg', quality: 45 });
    shotCount += 1;
    return shot;
  } catch (_) {
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

function classroomTabScore(tab) {
  let score = tab.active ? 10 : 0;
  if (/\/a\/|\/details/i.test(tab.url || '')) score += 100;
  if (tab.title && !/^(classes|google classroom)$/i.test(tab.title.trim())) score += 30;
  return score;
}

function isClassroomHome(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return /^\/(?:u\/\d+\/)?h?\/?$/i.test(url.pathname);
  } catch (_) { return false; }
}

function isAssignmentPage(rawUrl) {
  try { return /\/a\/|\/details/i.test(new URL(rawUrl).pathname); }
  catch (_) { return false; }
}

function googleDocId(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const match = url.pathname.match(/^\/document\/d\/([^/]+)/i);
    return url.hostname === 'docs.google.com' && match ? match[1] : '';
  } catch (_) { return ''; }
}

async function readGoogleDoc(doc, tabId) {
  const id = googleDocId(doc.href);
  if (id) {
    try {
      const response = await fetch(`https://docs.google.com/document/d/${id}/export?format=txt`, {
        credentials: 'include', redirect: 'follow'
      });
      const contentType = response.headers.get('content-type') || '';
      if (response.ok && !/text\/html/i.test(contentType)) {
        const text = (await response.text()).trim();
        if (text) return text.slice(0, 12000);
      }
    } catch (_) {}
  }
  return chrome.scripting.executeScript({
    target: { tabId },
    func: () => (document.body && document.body.innerText || '').slice(0, 12000)
  }).then(r => (r && r[0] && r[0].result) || '').catch(() => '');
}

async function scrapeClassroom(jobId) {
  shotCount = 0;
  const basiraTabId = await getActiveTabId();

  let tabs = await chrome.tabs.query({ url: ['https://classroom.google.com/*'] });
  let tab = [...tabs].sort((a, b) =>
    classroomTabScore(b) - classroomTabScore(a) || (b.lastAccessed || 0) - (a.lastAccessed || 0)
  )[0];
  let created = false;
  const preserveCurrent = !!tab && !isClassroomHome(tab.url);
  let assignmentScoped = !!tab && isAssignmentPage(tab.url);

  await postProgress(
    jobId, 'Opening Google Classroom…', 'https://classroom.google.com/',
    tab && tab.id, basiraTabId, 'home', false
  );

  if (!tab) {
    tab = await chrome.tabs.create({ url: 'https://classroom.google.com/', active: true });
    created = true;
    await focusTab(tab.id);
    await waitTabComplete(tab.id, 45000);
    await sleep(1500);
  } else if (!preserveCurrent) {
    await chrome.tabs.update(tab.id, { url: 'https://classroom.google.com/', active: true });
    await focusTab(tab.id);
    await waitTabComplete(tab.id, 45000);
    await sleep(1200);
  } else {
    await focusTab(tab.id);
    // Refresh the selected page so removed/changed attachments cannot survive
    // as stale DOM from an earlier assignment state.
    await chrome.tabs.reload(tab.id);
    await waitTabComplete(tab.id, 45000);
    await sleep(900);
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
  let assignmentTitle = data.assignmentTitle || '';
  let materials = [];
  let docLinks = data.docLinks || [];
  let finalTabId = tab.id;
  let finalUrl = tab.url || data.url || 'https://classroom.google.com/';

  if (courses[0]?.href) {
    let href = courses[0].href;
    if (href.startsWith('/')) href = 'https://classroom.google.com' + href;
    await postProgress(
      jobId, 'Opening ' + (courseName || 'class') + '…', href,
      tab.id, basiraTabId, 'course', true
    );
    await chrome.tabs.update(tab.id, { url: href, active: true });
    await focusTab(tab.id);
    await waitTabComplete(tab.id, 45000);
    await sleep(1400);
    await postProgress(
      jobId, 'Opening Classwork…', href,
      tab.id, basiraTabId, 'classwork', true
    );

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const els = [...document.querySelectorAll('a,button,[role="tab"]')];
        const hit = els.find(e => /classwork|course work|الواجب الدراسي|الواجبات|أعمال الصف/i.test((e.textContent || '').trim()));
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
    if (coursePage.assignmentTitle) assignmentTitle = coursePage.assignmentTitle;
    if (coursePage.docLinks?.length) docLinks = coursePage.docLinks;

    const assignmentLink = coursePage.assignmentLinks?.[0];
    if (assignmentLink?.href) {
      await postProgress(
        jobId, 'Opening assignment…', assignmentLink.href,
        tab.id, basiraTabId, 'assignments', false
      );
      await chrome.tabs.update(tab.id, { url: assignmentLink.href, active: true });
      await focusTab(tab.id);
      await waitTabComplete(tab.id, 45000);
      await sleep(1200);
      const assignmentPage = await injectScrape(tab.id);
      if (assignmentPage.lines?.length) assignmentBits = assignmentPage.lines;
      if (assignmentPage.assignmentTitle) assignmentTitle = assignmentPage.assignmentTitle;
      // Once a specific assignment is open, only its own visible Docs count.
      docLinks = assignmentPage.docLinks || [];
      assignmentScoped = true;
      finalUrl = assignmentPage.url || assignmentLink.href;
    }
  }

  if (!assignmentScoped) docLinks = [];

  // Open up to 2 Docs and follow the tab currently being processed.
  for (const doc of docLinks.slice(0, 2)) {
    await postProgress(
      jobId, 'Opening Doc: ' + (doc.title || 'document'), doc.href,
      tab.id, basiraTabId, 'docOpen', false
    );
    const id = googleDocId(doc.href);
    const existingDocs = await chrome.tabs.query({ url: ['https://docs.google.com/*'] });
    let docTab = existingDocs.find(candidate => id && googleDocId(candidate.url) === id);
    if (!docTab) docTab = await chrome.tabs.create({ url: doc.href, active: true });
    await focusTab(docTab.id);
    await waitTabComplete(docTab.id, 45000);
    await sleep(1200);
    await postProgress(
      jobId, 'Reading Google Doc…', doc.href,
      docTab.id, basiraTabId, 'docRead', true
    );
    const body = await readGoogleDoc(doc, docTab.id);
    materials.push({ title: doc.title || 'Google Doc', type: 'gdoc', text: body, url: doc.href });
    finalTabId = docTab.id;
    finalUrl = doc.href;
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
    title: (assignmentTitle || assignmentBits[0]).slice(0, 80),
    due: assignmentBits.find(b => /due/i.test(b)) || '',
    questions: assignmentBits.slice(0, 12)
  }] : [];

  const finalShot = await captureBackground(finalTabId, basiraTabId);
  await postProgress(
    jobId, 'Done', finalUrl,
    finalTabId, basiraTabId, 'done', false
  );

  // Stay on the last Classroom/Docs tab the agent worked on.
  const focusedTab = await focusTab(finalTabId);
  const activeTabs = focusedTab?.windowId != null
    ? await chrome.tabs.query({ active: true, windowId: focusedTab.windowId })
    : [];
  const focusVerified = activeTabs.some(activeTab => activeTab.id === finalTabId);

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
    cursor: cursorFor('done'),
    focusedTabId: finalTabId,
    focusedUrl: focusedTab?.url || finalUrl,
    focusVerified
  };
}

function injectScrape(tabId) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const bodyText = (document.body && document.body.innerText) || '';
      const visible = el => !!el && el.getClientRects().length > 0;
      const accessibleParts = [];
      for (const el of document.querySelectorAll('[aria-label],h1,h2,h3,[role="heading"]')) {
        if (!visible(el)) continue;
        const value = (el.innerText || el.textContent || el.getAttribute('aria-label') || '')
          .replace(/\s+/g, ' ').trim();
        if (value && value.length <= 300) accessibleParts.push(value);
      }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode()) && accessibleParts.length < 700) {
        const parent = node.parentElement;
        const value = String(node.nodeValue || '').replace(/\s+/g, ' ').trim();
        if (value && value.length <= 180 && visible(parent)) accessibleParts.push(value);
      }
      const text = [bodyText, ...accessibleParts].filter(Boolean).join('\n');
      const lower = (text + ' ' + location.href + ' ' + document.title).toLowerCase();
      const loginRequired = /sign in|accounts\.google\.com|choose an account|to continue to google/.test(lower)
        && !/classroom\.google\.com\/[uhc]/.test(location.href);

      const courses = [];
      const docLinks = [];
      const assignmentLinks = [];
      const ignoredHeading = /^(assignment|classwork|google classroom|help and feedback|your work|class comments|private comments|screen reader support enabled\.?)$/i;
      const assignmentTitle = [...document.querySelectorAll('h1,h2,[role="heading"]')]
        .filter(visible)
        .map(el => (el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim())
        .find(value => value && value.length <= 120 && !ignoredHeading.test(value)) || '';
      const addDoc = (href, title) => {
        try {
          const url = new URL(href, location.href);
          if (url.hostname !== 'docs.google.com' || !/^\/document\/d\//i.test(url.pathname)) return;
          docLinks.push({ title: title || 'Google Doc', href: url.href });
        } catch (_) {}
      };
      for (const a of document.querySelectorAll('a')) {
        const href = a.href || a.getAttribute('href') || '';
        const title = (a.innerText || a.textContent || a.getAttribute('aria-label') || a.title || '')
          .replace(/\s+/g, ' ').trim();
        if (a.getClientRects().length) addDoc(href, title);
        try {
          const target = new URL(href, location.href);
          if (target.hostname === 'classroom.google.com' && /\/a\/[^/]+\/details/i.test(target.pathname)) {
            assignmentLinks.push({ title: title || 'Assignment', href: target.href });
          }
        } catch (_) {}
        if (!title || title.length > 80) continue;
        if (href.includes('/c/') || href.includes('classroom.google.com/c/')) {
          courses.push({ title, href });
        }
      }
      // Only visible page text is eligible. Serialized markup can retain links
      // from other assignments and must never trigger an unrelated Doc.
      const rawSources = [text];
      for (const source of rawSources) {
        const matches = source.match(/https?:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]+[^\s<>"']*/gi) || [];
        for (const raw of matches) addDoc(raw.replace(/&amp;/g, '&').replace(/[),.;]+$/, ''), 'Google Doc');
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
      const aseen = new Set();
      const uniqAssignments = [];
      for (const assignment of assignmentLinks) {
        if (aseen.has(assignment.href)) continue;
        aseen.add(assignment.href);
        uniqAssignments.push(assignment);
      }
      const ignoredLine = /^(skip to main content|main menu|google apps|help|help and feedback|settings|your work|assigned|mark as done|class comments|private comments|screen reader support enabled\.?)$/i;
      const lines = text.split(/\n+/).map(l => l.trim())
        .filter(l => l.length >= 8 && l.length <= 140 && !ignoredLine.test(l));
      const resolvedAssignmentTitle = assignmentTitle || lines.find(line => !/^\d+\s+points?$/i.test(line)) || '';
      return {
        loginRequired,
        title: document.title || '',
        assignmentTitle: resolvedAssignmentTitle,
        url: location.href,
        courses: uniqCourses.slice(0, 12),
        docLinks: uniqDocs.slice(0, 5),
        assignmentLinks: uniqAssignments.slice(0, 10),
        lines,
        textPreview: text.slice(0, 2000)
      };
    }
  }).then(res => (res && res[0] && res[0].result) || {
    loginRequired: false, courses: [], lines: [], docLinks: [], assignmentLinks: []
  });
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
    startPolling();
    sendResponse({ ok: true, status: lastStatus });
    return true;
  }
  if (msg === 'status') {
    sendResponse({ status: lastStatus, bridge: BRIDGE });
    return true;
  }
});
