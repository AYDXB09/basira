/* ============================================================================
 * ingest.js — turns uploaded files into raw conversation material.
 *   videos → sampled frames · images → dataURLs · text files → text
 * Exposes window.INGEST = { collect }
 * ========================================================================== */
(function () {
  const C = window.B_CONFIG;

  function readAsDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result); r.onerror = rej;
      r.readAsDataURL(file);
    });
  }
  function readAsText(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result); r.onerror = rej;
      r.readAsText(file);
    });
  }

  function shrink(dataURL, maxW) {
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, maxW / img.width);
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * s);
        cv.height = Math.round(img.height * s);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        res(cv.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => res(dataURL);
      img.src = dataURL;
    });
  }

  function extractFrames(file, n) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.muted = true; v.preload = 'auto'; v.src = url;
      const frames = [];
      v.onloadedmetadata = async () => {
        const dur = (v.duration && isFinite(v.duration)) ? v.duration : 60;
        const cv = document.createElement('canvas');
        const s = Math.min(1, C.frameWidth / (v.videoWidth || C.frameWidth));
        cv.width = Math.round((v.videoWidth || 640) * s);
        cv.height = Math.round((v.videoHeight || 360) * s);
        const ctx = cv.getContext('2d');
        for (let i = 0; i < n; i++) {
          const t = dur * (i + 0.5) / n;
          await new Promise((res) => {
            const onSeek = () => { v.removeEventListener('seeked', onSeek); res(); };
            v.addEventListener('seeked', onSeek);
            v.currentTime = Math.min(t, dur - 0.1);
            setTimeout(res, 4000);
          });
          try {
            ctx.drawImage(v, 0, 0, cv.width, cv.height);
            frames.push({ label: `${file.name} @${Math.round(v.currentTime)}s`, data: cv.toDataURL('image/jpeg', 0.7) });
          } catch (_) {}
        }
        URL.revokeObjectURL(url); resolve(frames);
      };
      v.onerror = () => { URL.revokeObjectURL(url); resolve(frames); };
    });
  }

  /** files → { images:[{label,data}], texts:[{label,text}] } */
  async function collect(files, onProgress) {
    const say = (m) => onProgress && onProgress(m);
    const images = [], texts = [];
    for (const f of files) {
      if (f.type.startsWith('video/')) {
        say(`Watching ${f.name}…`);
        images.push(...await extractFrames(f, C.maxFramesPerVideo));
      } else if (f.type.startsWith('image/')) {
        say(`Reading ${f.name}…`);
        images.push({ label: f.name, data: await shrink(await readAsDataURL(f), C.frameWidth) });
      } else if (f.type.startsWith('text/') || /\.(txt|md|srt|vtt)$/i.test(f.name)) {
        say(`Reading ${f.name}…`);
        try { texts.push({ label: f.name, text: (await readAsText(f)).slice(0, 16000) }); } catch (_) {}
      }
    }
    if (!images.length && !texts.length) throw new Error('no-material');
    return { images, texts };
  }

  window.INGEST = { collect };
})();
