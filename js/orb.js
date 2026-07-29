/* ============================================================================
 * orb.js — the REPLICATE orb, driven by requestAnimationFrame.
 * Solid glossy balls (cyan / purple / amber / deep-blue backdrop) orbiting
 * softly inside a dark glass shell. JS drives phase & speed so state changes
 * GLIDE (no CSS animation restarts, no jank): speed and scale ease toward
 * per-state targets every frame.
 *   ORB.setState('off'|'idle'|'listening'|'thinking'|'speaking')
 * ========================================================================== */
(function () {
  const TAU = Math.PI * 2;

  /* per-state motion targets: orbit speed (rad/s), cluster scale, pulse amp */
  const STATES = {
    off:       { speed: 0.10, scale: 0.86, pulse: 0.000, glow: 0.5 },
    idle:      { speed: 0.22, scale: 1.00, pulse: 0.012, glow: 0.8 },
    listening: { speed: 0.55, scale: 1.16, pulse: 0.030, glow: 1.15 },
    thinking:  { speed: 1.10, scale: 0.94, pulse: 0.015, glow: 0.9 },
    speaking:  { speed: 0.45, scale: 1.06, pulse: 0.075, glow: 1.1 }
  };

  /* balls: orbit radii (fraction of orb size), base offset, size, z via DOM order */
  const BALLS = [
    { sel: '.ball-blue',   rx: 0.06, ry: 0.05, w: 0.62, ph: 0.0, sp: 0.7 },
    { sel: '.ball-purple', rx: 0.10, ry: 0.07, w: 0.44, ph: 2.1, sp: 1.0 },
    { sel: '.ball-cyan',   rx: 0.09, ry: 0.08, w: 0.40, ph: 4.2, sp: 1.25 },
    { sel: '.ball-amber',  rx: 0.11, ry: 0.09, w: 0.34, ph: 1.1, sp: 0.85 }
  ];

  let els = null, cluster = null, shell = null;
  let cur = { speed: 0.1, scale: 0.86, pulse: 0, glow: 0.5 };
  let target = STATES.off;
  let phase = Math.random() * TAU;
  let tPulse = 0;
  let last = performance.now();

  function setState(name) { target = STATES[name] || STATES.idle; }

  function ease(a, b, k) { return a + (b - a) * k; }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // glide every parameter toward its target — this is what kills the jank
    const k = 1 - Math.pow(0.002, dt);          // ~snappy but smooth
    cur.speed = ease(cur.speed, target.speed, k);
    cur.scale = ease(cur.scale, target.scale, k);
    cur.pulse = ease(cur.pulse, target.pulse, k);
    cur.glow  = ease(cur.glow,  target.glow,  k * 0.7);

    phase += cur.speed * dt * TAU * 0.16;
    tPulse += dt;

    const breathe = 1 + Math.sin(tPulse * 1.05) * 0.012;              // always alive
    const pulse   = 1 + Math.sin(tPulse * (TAU / 0.62)) * cur.pulse;  // speech rhythm
    const s = cur.scale * breathe * pulse;

    if (cluster) cluster.style.transform =
      `translate(-50%,-50%) scale(${s}) rotate(${(phase * 12).toFixed(2)}deg)`;

    els.forEach((el, i) => {
      const b = BALLS[i];
      const p = phase * b.sp + b.ph;
      const x = Math.cos(p) * b.rx * 100;
      const y = Math.sin(p * 0.9 + Math.sin(phase * 0.5) * 0.6) * b.ry * 100;
      const squish = 1 + Math.sin(p * 1.7) * 0.06;
      el.style.transform =
        `translate(calc(-50% + ${x.toFixed(2)}cqw), calc(-50% + ${y.toFixed(2)}cqw))` +
        ` scale(${squish.toFixed(3)}, ${(2 - squish).toFixed(3)})`;
    });

    if (shell) shell.style.setProperty('--glow', cur.glow.toFixed(3));

    requestAnimationFrame(frame);
  }

  window.addEventListener('load', () => {
    shell = document.getElementById('orb');
    cluster = document.querySelector('#orb .cluster');
    els = BALLS.map(b => document.querySelector('#orb ' + b.sel));
    requestAnimationFrame(frame);
  });

  window.ORB = { setState };
})();
