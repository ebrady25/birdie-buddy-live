/* =====================================================================
   BIRDIEBUDDY HOME MOTION (shared include)
   The golf homepage's motion, used by the brand home (/) and the NFL home
   (nfl/): split headline (#heroTitle .word[data-word]), hero tracer field
   (#heroCanvas), final-block tracer field (#finalCanvas), scroll reveal +
   count-ups ([data-reveal], [data-count]), .edge-card tilt, hero parallax
   (#hero) and cursor light (#cursorGlow). Every block skips itself when
   its element is missing. Canvas code is unchanged from the golf page
   (golf/index.html keeps its own inline copy).
   Exposes BBI.homeFx.setCount(id, n) for numbers that arrive by fetch.
   Load at the end of <body>, before the page's own script. No external scripts.
   ===================================================================== */
(() => {
  'use strict';

  /* ---------------- split text for headline ---------------- */
  document.querySelectorAll('#heroTitle .word').forEach((wordEl, wi) => {
    const text = wordEl.getAttribute('data-word') || '';
    let html = '';
    const baseDelay = 0.35 + wi * 0.12;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const display = ch === ' ' ? '&nbsp;' : ch;
      const delay = baseDelay + i * 0.035;
      html += `<span class="char" style="animation-delay: ${delay}s">${display}</span>`;
    }
    wordEl.innerHTML = html;
    if (!wordEl.classList.contains('gold')) wordEl.insertAdjacentHTML('afterend', '&nbsp;');
  });

  /* ---------------- hero flow field (golf homepage, unchanged) ---------------- */
  (function heroFlowField() {
    const canvas = document.getElementById('heroCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, dpr = 1;
    let lines = [];
    let orbs = [];
    let t = 0;
    const mouse = { x: -9999, y: -9999, active: false };
    let lastFrame = performance.now();

    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = rect.width; H = rect.height;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      init();
    }
    function angleAt(x, y, time, dir) {
      const s = 0.0018;
      const vert =
        Math.sin(x * s + time * 0.45) * 0.30 +
        Math.cos(y * s * 0.9 - time * 0.30) * 0.22 +
        Math.sin((x + y) * s * 0.4 + time * 0.20) * 0.10;
      const base = dir > 0 ? 0 : Math.PI;
      return base + vert * dir;
    }
    function init() {
      lines = [];
      orbs = [];
      const count = Math.round(Math.min(60, Math.max(24, (W * H) / 32000)));
      for (let i = 0; i < count; i++) lines.push(makeLine(true));
      for (let i = 0; i < 3; i++) {
        orbs.push({
          x: Math.random() * W, y: Math.random() * H,
          r: 280 + Math.random() * 220,
          vx: (Math.random() - 0.5) * 0.16, vy: (Math.random() - 0.5) * 0.08,
        });
      }
      ctx.fillStyle = '#08080a';
      ctx.fillRect(0, 0, W, H);
    }
    function makeLine(randomLife) {
      const dir = Math.random() < 0.8 ? 1 : -1;
      const sx = dir > 0 ? -60 - Math.random() * 260 : W + 60 + Math.random() * 260;
      return {
        x: sx, y: Math.random() * H, history: [],
        maxLen: 90 + Math.random() * 110,
        life: randomLife ? Math.random() * 320 : 0,
        maxLife: 380 + Math.random() * 280,
        speed: 1.1 + Math.random() * 0.7,
        hue: 38 + Math.random() * 12,
        bright: 0.30 + Math.random() * 0.55,
        width: 0.6 + Math.random() * 0.9,
        dir,
      };
    }
    function frame(now) {
      const dt = Math.min(33, now - lastFrame) / 16.6667;
      lastFrame = now;
      t += 0.006 * dt;
      ctx.fillStyle = 'rgba(8, 8, 10, 0.22)';
      ctx.fillRect(0, 0, W, H);
      for (const o of orbs) {
        o.x += o.vx * dt; o.y += o.vy * dt;
        if (o.x < -o.r) o.x = W + o.r;
        if (o.x > W + o.r) o.x = -o.r;
        if (o.y < -o.r) o.y = H + o.r;
        if (o.y > H + o.r) o.y = -o.r;
        const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
        g.addColorStop(0, 'rgba(212, 168, 67, 0.018)');
        g.addColorStop(0.5, 'rgba(212, 168, 67, 0.007)');
        g.addColorStop(1, 'rgba(212, 168, 67, 0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < lines.length; i++) {
        const L = lines[i];
        L.life += dt;
        const offRight = L.x > W + 90;
        const offLeft = L.x < -90;
        if (L.life > L.maxLife || (L.dir > 0 && offRight) || (L.dir < 0 && offLeft) || L.y < -160 || L.y > H + 160) {
          Object.assign(L, makeLine(false));
          continue;
        }
        let ang = angleAt(L.x, L.y, t, L.dir);
        if (mouse.active) {
          const dx = L.x - mouse.x, dy = L.y - mouse.y;
          const d2 = dx * dx + dy * dy;
          const R = 200;
          if (d2 < R * R) {
            const d = Math.sqrt(d2) || 1;
            const f = (1 - d / R);
            const tangent = Math.atan2(dy, dx) + Math.PI / 2;
            const wx = Math.cos(ang) + Math.cos(tangent) * f * 1.2;
            const wy = Math.sin(ang) + Math.sin(tangent) * f * 1.2;
            ang = Math.atan2(wy, wx);
            L.speed = Math.min(2.6, L.speed + f * 0.04);
          }
        }
        L.x += Math.cos(ang) * L.speed * dt;
        L.y += Math.sin(ang) * L.speed * dt;
        L.history.push(L.x, L.y);
        if (L.history.length / 2 > L.maxLen) L.history.splice(0, 2);
        const hist = L.history;
        if (hist.length < 6) continue;
        const fadeIn = Math.min(1, L.life / 28);
        const fadeOut = Math.min(1, (L.maxLife - L.life) / 70);
        const headAlpha = L.bright * fadeIn * fadeOut;
        const segs = hist.length / 2 - 1;
        ctx.lineWidth = L.width;
        for (let k = 0; k < segs; k++) {
          const tp = k / segs;
          const a = headAlpha * Math.pow(tp, 1.6);
          if (a < 0.005) continue;
          const light = 52 + tp * 22;
          ctx.strokeStyle = `hsla(${L.hue}, 72%, ${light}%, ${a})`;
          ctx.beginPath();
          ctx.moveTo(hist[k * 2], hist[k * 2 + 1]);
          ctx.lineTo(hist[k * 2 + 2], hist[k * 2 + 3]);
          ctx.stroke();
        }
        const halo = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, 11);
        halo.addColorStop(0, `hsla(${L.hue + 6}, 95%, 78%, ${headAlpha * 0.55})`);
        halo.addColorStop(1, `hsla(${L.hue},     85%, 60%, 0)`);
        ctx.fillStyle = halo;
        ctx.beginPath(); ctx.arc(L.x, L.y, 11, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath();
        ctx.arc(L.x, L.y, 1.7, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${L.hue + 10}, 95%, 84%, ${Math.min(1, headAlpha * 1.6)})`;
        ctx.fill();
      }
      requestAnimationFrame(frame);
    }
    canvas.parentElement.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      mouse.active = true;
    });
    canvas.parentElement.addEventListener('pointerleave', () => { mouse.active = false; });
    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame((n) => { lastFrame = n; frame(n); });
  })();

  /* ---------------- final block canvas (golf homepage, unchanged) ---------------- */
  (function finalLockField() {
    const canvas = document.getElementById('finalCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, dpr = 1, lines = [], t = 0;
    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = rect.width; H = rect.height;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(dpr, dpr);
      lines = [];
      const count = Math.round(Math.min(40, Math.max(16, (W * H) / 38000)));
      for (let i = 0; i < count; i++) lines.push(make(true));
      ctx.fillStyle = '#08080a'; ctx.fillRect(0, 0, W, H);
    }
    function make(randomLife) {
      const dir = Math.random() < 0.8 ? 1 : -1;
      return {
        x: dir > 0 ? -60 - Math.random() * 260 : W + 60 + Math.random() * 260,
        y: Math.random() * H, history: [],
        maxLen: 90 + Math.random() * 100,
        life: randomLife ? Math.random() * 300 : 0,
        maxLife: 380 + Math.random() * 240,
        speed: 0.9 + Math.random() * 0.6,
        bright: 0.22 + Math.random() * 0.45,
        width: 0.55 + Math.random() * 0.7,
        hue: 38 + Math.random() * 12,
        dir,
      };
    }
    function ang(x, y, time, dir) {
      const s = 0.0018;
      const vert = Math.sin(x * s + time * 0.4) * 0.28 + Math.cos(y * s * 0.9 - time * 0.25) * 0.20;
      return (dir > 0 ? 0 : Math.PI) + vert * dir;
    }
    function step() {
      t += 0.005;
      ctx.fillStyle = 'rgba(8,8,10,0.22)';
      ctx.fillRect(0, 0, W, H);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const L of lines) {
        L.life++;
        const offR = L.x > W + 90, offL = L.x < -90;
        if (L.life > L.maxLife || (L.dir > 0 && offR) || (L.dir < 0 && offL) || L.y < -160 || L.y > H + 160) {
          Object.assign(L, make(false));
          continue;
        }
        const a = ang(L.x, L.y, t, L.dir);
        L.x += Math.cos(a) * L.speed; L.y += Math.sin(a) * L.speed;
        L.history.push(L.x, L.y);
        if (L.history.length / 2 > L.maxLen) L.history.splice(0, 2);
        const hist = L.history;
        if (hist.length < 6) continue;
        const fi = Math.min(1, L.life / 28), fo = Math.min(1, (L.maxLife - L.life) / 70);
        const headA = L.bright * fi * fo;
        const segs = hist.length / 2 - 1;
        ctx.lineWidth = L.width;
        for (let k = 0; k < segs; k++) {
          const tp = k / segs;
          const al = headA * Math.pow(tp, 1.6);
          if (al < 0.005) continue;
          ctx.strokeStyle = `hsla(${L.hue}, 70%, ${52 + tp * 20}%, ${al})`;
          ctx.beginPath();
          ctx.moveTo(hist[k * 2], hist[k * 2 + 1]);
          ctx.lineTo(hist[k * 2 + 2], hist[k * 2 + 3]);
          ctx.stroke();
        }
        const halo = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, 9);
        halo.addColorStop(0, `hsla(${L.hue + 6}, 95%, 78%, ${headA * 0.45})`);
        halo.addColorStop(1, `hsla(${L.hue}, 85%, 60%, 0)`);
        ctx.fillStyle = halo;
        ctx.beginPath(); ctx.arc(L.x, L.y, 9, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(L.x, L.y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${L.hue + 10}, 95%, 84%, ${Math.min(1, headA * 1.6)})`;
        ctx.fill();
      }
      requestAnimationFrame(step);
    }
    window.addEventListener('resize', resize);
    resize(); step();
  })();

  /* ---------------- scroll reveal + count-ups ---------------- */
  const easeOutQuint = (x) => 1 - Math.pow(1 - x, 5);
  const fmtCount = (v, d) => (d > 0 ? v.toFixed(d) : Math.round(v).toLocaleString('en-US'));
  function animateCount(el) {
    if (el.dataset.counted || el.dataset.count == null) return;
    el.dataset.counted = '1';
    const to = parseFloat(el.dataset.count), d = parseInt(el.dataset.decimals || '0', 10);
    const duration = 1600, start = performance.now();
    (function tick(now) {
      const p = Math.min(1, (now - start) / duration);
      el.textContent = fmtCount(to * easeOutQuint(p), d);
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = fmtCount(to, d);
    })(start);
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      el.classList.add('revealed');
      el.querySelectorAll('[data-count]').forEach(animateCount);
      observer.unobserve(el);
    });
  }, { threshold: 0.18, rootMargin: '0px 0px -10% 0px' });
  document.querySelectorAll('[data-reveal]').forEach(el => observer.observe(el));

  // live number arriving after (or before) its block is revealed
  function setCount(id, n) {
    const el = document.getElementById(id);
    if (!el || !(n >= 0)) return;
    el.dataset.count = String(n);
    el.dataset.decimals = '0';
    el.textContent = '0';
    const host = el.closest('[data-reveal]');
    if (!host || host.classList.contains('revealed')) animateCount(el);
  }

  /* ---------------- card 3D tilt + spot glow ---------------- */
  document.querySelectorAll('.edge-card').forEach(card => {
    let raf = null, tx = 0, ty = 0;
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      tx = (py - 0.5) * -6;
      ty = (px - 0.5) * 8;
      card.style.setProperty('--mx', (px * 100) + '%');
      card.style.setProperty('--my', (py * 100) + '%');
      if (!raf) {
        raf = requestAnimationFrame(() => {
          card.style.transform = `perspective(900px) rotateX(${tx}deg) rotateY(${ty}deg) translateY(-3px)`;
          raf = null;
        });
      }
    });
    card.addEventListener('pointerleave', () => { card.style.transform = ''; });
  });

  /* ---------------- hero parallax ---------------- */
  (function () {
    const hero = document.getElementById('hero');
    if (!hero) return;
    const heroEls = hero.querySelectorAll('h1, p, .badge, .lock-ring, .vault-form, .meta');
    const canvas = document.getElementById('heroCanvas');
    let ticking = false;
    function update() {
      const y = window.scrollY;
      const p = Math.min(1, y / window.innerHeight);
      heroEls.forEach((el, i) => {
        const speed = 0.25 + (i % 3) * 0.08;
        el.style.transform = `translateY(${-y * speed}px)`;
        el.style.opacity = String(Math.max(0, 1 - p * 1.3));
      });
      if (canvas) canvas.style.transform = `translateY(${y * 0.18}px)`;
      ticking = false;
    }
    window.addEventListener('scroll', () => {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
  })();

  /* ---------------- cursor light ---------------- */
  (function () {
    const glow = document.getElementById('cursorGlow');
    if (!glow) return;
    let tx = 0, ty = 0, x = 0, y = 0, raf = null;
    function loop() {
      x += (tx - x) * 0.18;
      y += (ty - y) * 0.18;
      glow.style.transform = `translate(${x}px, ${y}px) translate(-50%,-50%)`;
      raf = requestAnimationFrame(loop);
    }
    window.addEventListener('pointermove', (e) => {
      tx = e.clientX; ty = e.clientY;
      glow.style.opacity = '1';
      if (!raf) { x = tx; y = ty; loop(); }
    });
    window.addEventListener('pointerleave', () => { glow.style.opacity = '0'; });
  })();

  window.BBI = window.BBI || {};
  window.BBI.homeFx = { setCount, animateCount };
})();
