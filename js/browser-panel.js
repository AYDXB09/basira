/* ==========================================================================
 * browser-panel.js — mac-style live browser window inside Basira
 * Hidden until a real screenshot feed exists.
 * ========================================================================== */
(function () {
  let root = null;
  let card = null;
  let titleEl = null;
  let urlEl = null;
  let statusEl = null;
  let imgEl = null;
  let viewEl = null;
  let cursorEl = null;
  let pulseEl = null;
  let hasFeed = false;
  let pulseTimer = null;

  const CURSOR_SVG =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">' +
        '<path d="M4 3 L4 22 L9.5 16.5 L13.5 25.5 L16.5 24.2 L12.2 15.5 L19 15.5 Z" ' +
        'fill="#fff9c4" stroke="#1a1a1a" stroke-width="1.4" stroke-linejoin="round"/>' +
      '</svg>'
    );

  function injectCss() {
    if (document.getElementById('basira-bpanel-css')) return;
    const s = document.createElement('style');
    s.id = 'basira-bpanel-css';
    s.textContent = [
      '#browserPanel{position:fixed;inset:0;display:none;align-items:center;justify-content:center;',
      'z-index:9990;pointer-events:none;padding:20px;background:rgba(0,0,0,.32)}',
      '#browserPanel.is-on{display:flex}',
      '#browserPanel .bwin{pointer-events:none;width:min(920px,94vw);height:min(72vh,640px);',
      'display:flex;flex-direction:column;background:#1a1d27;border-radius:14px;',
      'border:1px solid rgba(255,255,255,.12);box-shadow:0 30px 80px rgba(0,0,0,.55);',
      'overflow:hidden;color:#e8eaf0;font-family:system-ui,Segoe UI,sans-serif}',
      '#browserPanel .bwin-titlebar{display:flex;align-items:center;gap:10px;padding:10px 12px;',
      'background:#12141c;border-bottom:1px solid rgba(255,255,255,.06);flex-shrink:0}',
      '#browserPanel .bwin-dots{display:flex;gap:6px}',
      '#browserPanel .bwin-dots i{display:block;width:11px;height:11px;border-radius:50%}',
      '#browserPanel .bwin-dots i:nth-child(1){background:#ff5f57}',
      '#browserPanel .bwin-dots i:nth-child(2){background:#febc2e}',
      '#browserPanel .bwin-dots i:nth-child(3){background:#28c840}',
      '#browserPanel .bwin-title{flex:1;text-align:center;font-size:12px;opacity:.75;font-weight:600}',
      '#browserPanel .bwin-x{pointer-events:auto;background:transparent;border:none;color:#aaa;',
      'font-size:20px;cursor:pointer;line-height:1;padding:0 4px}',
      '#browserPanel .bwin-x:hover{color:#fff}',
      '#browserPanel .bwin-urlbar{display:flex;align-items:center;gap:8px;margin:8px 12px;',
      'padding:8px 12px;background:#0c0e14;border-radius:20px;',
      'border:1px solid rgba(255,255,255,.08);flex-shrink:0}',
      '#browserPanel .bwin-lock{font-size:11px;opacity:.7}',
      '#browserPanel .bwin-url{flex:1;font-size:12px;opacity:.85;white-space:nowrap;',
      'overflow:hidden;text-overflow:ellipsis;font-family:ui-monospace,Consolas,monospace}',
      '#browserPanel .bwin-status{font-size:11px;opacity:.55;padding:0 14px 6px;flex-shrink:0}',
      '#browserPanel .bwin-view{flex:1;position:relative;background:#0a0b10;min-height:0;overflow:hidden}',
      '#browserPanel .bwin-img{display:block;width:100%;height:100%;object-fit:contain;background:#000}',
      '#browserPanel .bwin-cursor{position:absolute;left:0;top:0;width:28px;height:28px;',
      'pointer-events:none;z-index:5;transform:translate(-2px,-2px);',
      'transition:transform .12s cubic-bezier(.2,.8,.2,1);will-change:transform;',
      'filter:drop-shadow(0 1px 2px rgba(0,0,0,.55))}',
      '#browserPanel .bwin-pulse{position:absolute;left:0;top:0;width:18px;height:18px;',
      'margin:-9px 0 0 -9px;border-radius:50%;pointer-events:none;z-index:4;',
      'border:2px solid rgba(255,236,120,.95);box-shadow:0 0 0 0 rgba(255,236,120,.55);',
      'opacity:0;transform:translate(0,0) scale(.4)}',
      '#browserPanel .bwin-pulse.on{animation:bpanel-ripple .55s ease-out forwards}',
      '@keyframes bpanel-ripple{0%{opacity:.95;transform:translate(var(--px),var(--py)) scale(.35);',
      'box-shadow:0 0 0 0 rgba(255,236,120,.5)}100%{opacity:0;',
      'transform:translate(var(--px),var(--py)) scale(2.4);box-shadow:0 0 0 14px rgba(255,236,120,0)}}'
    ].join('');
    document.head.appendChild(s);
  }

  function ensureDom() {
    injectCss();
    if (root && document.body.contains(root)) return root;
    root = document.getElementById('browserPanel');
    if (!root) {
      root = document.createElement('div');
      root.id = 'browserPanel';
      document.body.appendChild(root);
    }
    root.innerHTML =
      '<div class="bwin" tabindex="-1">' +
        '<div class="bwin-titlebar">' +
          '<div class="bwin-dots"><i></i><i></i><i></i></div>' +
          '<div class="bwin-title" id="bpanelTitle">Browser</div>' +
          '<button type="button" class="bwin-x" id="bpanelClose" aria-label="Close">×</button>' +
        '</div>' +
        '<div class="bwin-urlbar">' +
          '<span class="bwin-lock">🔒</span>' +
          '<div class="bwin-url" id="bpanelUrl">https://classroom.google.com/</div>' +
        '</div>' +
        '<div class="bwin-status" id="bpanelStatus">Ready</div>' +
        '<div class="bwin-view" id="bpanelView">' +
          '<img class="bwin-img" id="bpanelImg" alt="Live page view" />' +
          '<img class="bwin-cursor" id="bpanelCursor" alt="" draggable="false" />' +
          '<div class="bwin-pulse" id="bpanelPulse"></div>' +
        '</div>' +
      '</div>';

    card = root.querySelector('.bwin');
    titleEl = root.querySelector('#bpanelTitle');
    urlEl = root.querySelector('#bpanelUrl');
    statusEl = root.querySelector('#bpanelStatus');
    viewEl = root.querySelector('#bpanelView');
    imgEl = root.querySelector('#bpanelImg');
    cursorEl = root.querySelector('#bpanelCursor');
    pulseEl = root.querySelector('#bpanelPulse');
    cursorEl.src = CURSOR_SVG;

    root.querySelector('#bpanelClose').onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      hide();
    };

    hasFeed = false;
    root.classList.remove('is-on');
    root.style.display = 'none';
    root.hidden = true;
    return root;
  }

  function revealIfFeed(force) {
    ensureDom();
    if (!hasFeed && !force) {
      root.classList.remove('is-on');
      root.style.display = 'none';
      root.hidden = true;
      return;
    }
    root.classList.add('is-on');
    root.style.display = 'flex';
    root.hidden = false;
  }

  /** show() alone does not open an empty black box — needs feed or forceShow */
  function show(opts) {
    ensureDom();
    if (opts && opts.forceShow) {
      revealIfFeed(true);
      return;
    }
    revealIfFeed(false);
  }

  function hide() {
    if (!root) return;
    hasFeed = false;
    root.classList.remove('is-on');
    root.style.display = 'none';
    root.hidden = true;
    hideClickPulse();
    if (imgEl) {
      imgEl.removeAttribute('src');
    }
  }

  function setStatus(t, opts) {
    ensureDom();
    statusEl.textContent = t == null ? '' : String(t);
    if (opts && opts.forceShow) revealIfFeed(true);
    else if (!hasFeed) revealIfFeed(false);
  }

  function setTitle(t) {
    ensureDom();
    titleEl.textContent = t == null || t === '' ? 'Browser' : String(t);
  }

  function setUrl(u, opts) {
    ensureDom();
    urlEl.textContent = u || 'https://classroom.google.com/';
    if (opts && opts.forceShow) revealIfFeed(true);
    else if (!hasFeed) revealIfFeed(false);
  }

  function setLoading() {
    /* no-op: never show empty spinner shell without a feed */
  }

  function setScreenshot(dataUrl) {
    if (dataUrl) showFeed(dataUrl, {});
    else {
      hasFeed = false;
      if (imgEl) imgEl.removeAttribute('src');
      revealIfFeed(false);
    }
  }

  function setBodyHtml() {
    /* body strip removed — live image is the feed */
  }

  function showImage(url, caption) {
    if (!url) return;
    showFeed(url, { title: caption || undefined, status: caption || undefined });
  }

  /**
   * Only shows the panel when dataUrl exists.
   * @param {string} dataUrl
   * @param {{url?:string,title?:string,status?:string}} meta
   */
  function showFeed(dataUrl, meta) {
    meta = meta || {};
    if (!dataUrl) {
      hasFeed = false;
      ensureDom();
      revealIfFeed(false);
      return;
    }
    ensureDom();
    hasFeed = true;
    imgEl.src = dataUrl;
    if (meta.url != null) urlEl.textContent = String(meta.url);
    if (meta.title != null) titleEl.textContent = String(meta.title) || 'Browser';
    if (meta.status != null) statusEl.textContent = String(meta.status);
    revealIfFeed(true);
  }

  /** x,y in 0–1 relative to the image/view area */
  function updateCursor(x, y) {
    ensureDom();
    if (!viewEl || !cursorEl) return;
    const w = viewEl.clientWidth || 1;
    const h = viewEl.clientHeight || 1;
    const px = Math.max(0, Math.min(1, Number(x) || 0)) * w;
    const py = Math.max(0, Math.min(1, Number(y) || 0)) * h;
    cursorEl.style.transform = 'translate(' + px + 'px,' + py + 'px)';
  }

  function hideClickPulse() {
    if (pulseTimer) {
      clearTimeout(pulseTimer);
      pulseTimer = null;
    }
    if (pulseEl) {
      pulseEl.classList.remove('on');
      pulseEl.style.opacity = '0';
    }
  }

  function clickAt(x, y) {
    ensureDom();
    if (!viewEl || !pulseEl) return;
    updateCursor(x, y);
    const w = viewEl.clientWidth || 1;
    const h = viewEl.clientHeight || 1;
    const px = Math.max(0, Math.min(1, Number(x) || 0)) * w;
    const py = Math.max(0, Math.min(1, Number(y) || 0)) * h;
    hideClickPulse();
    pulseEl.style.setProperty('--px', px + 'px');
    pulseEl.style.setProperty('--py', py + 'px');
    pulseEl.style.transform = 'translate(' + px + 'px,' + py + 'px) scale(.4)';
    // force reflow so animation restarts
    void pulseEl.offsetWidth;
    pulseEl.classList.add('on');
    pulseTimer = setTimeout(hideClickPulse, 560);
  }

  window.BPANEL = {
    show,
    hide,
    showFeed,
    updateCursor,
    clickAt,
    hideClickPulse,
    setStatus,
    setTitle,
    setUrl,
    setLoading,
    setScreenshot,
    setBodyHtml,
    showImage
  };
})();
