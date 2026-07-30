/* ==========================================================================
 * memory.js — student facts in localStorage for tutor system prompt
 * ========================================================================== */
(function () {
  const KEY = 'basira.memories';
  const MAX_SUMMARY = 800;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function save(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list || []));
    } catch {
      /* ignore quota / private mode */
    }
  }

  function all() {
    return load();
  }

  function get(key) {
    if (!key) return null;
    const k = String(key).toLowerCase();
    const list = load();
    for (let i = list.length - 1; i >= 0; i--) {
      if (String(list[i].key || '').toLowerCase() === k) return list[i].value;
    }
    return null;
  }

  function add(key, value) {
    if (!key || value == null || value === '') return;
    const k = String(key).trim();
    const v = String(value).trim();
    if (!k || !v) return;
    const list = load().filter((m) => String(m.key || '').toLowerCase() !== k.toLowerCase());
    list.push({ key: k, value: v, at: Date.now() });
    save(list);
  }

  function clear() {
    save([]);
  }

  function seed(arr) {
    if (!Array.isArray(arr)) return;
    const list = load();
    const byKey = {};
    list.forEach((m) => {
      if (m && m.key) byKey[String(m.key).toLowerCase()] = m;
    });
    arr.forEach((item) => {
      if (!item || !item.key) return;
      const k = String(item.key).trim();
      const v = String(item.value == null ? '' : item.value).trim();
      if (!k || !v) return;
      byKey[k.toLowerCase()] = { key: k, value: v, at: Date.now() };
    });
    save(Object.values(byKey));
  }

  function summaryText() {
    const list = load();
    if (!list.length) return '';
    const lines = list.map((m) => {
      const k = String(m.key || '').trim();
      const v = String(m.value || '').trim();
      return k && v ? k + ': ' + v : '';
    }).filter(Boolean);
    let out = lines.join('; ');
    if (out.length > MAX_SUMMARY) out = out.slice(0, MAX_SUMMARY - 1) + '…';
    return out;
  }

  function absorbFromUtterance(text) {
    if (!text || typeof text !== 'string') return;
    const t = text.trim();
    if (!t) return;

    let m = t.match(/\bmy name is\s+([A-Za-z][A-Za-z' -]{0,40})/i);
    if (m) {
      const name = m[1].replace(/[.,!?]+$/, '').trim();
      if (name) add('name', name);
    }

    m = t.match(/\bcall me\s+([A-Za-z][A-Za-z' -]{0,40})/i);
    if (m) {
      const name = m[1].replace(/[.,!?]+$/, '').trim();
      if (name) add('name', name);
    }
  }

  window.MEM = {
    load,
    save,
    add,
    get,
    all,
    clear,
    seed,
    summaryText,
    absorbFromUtterance
  };
})();
