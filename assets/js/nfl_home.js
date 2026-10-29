/* =====================================================================
   BIRDIEBUDDY NFL HOMEPAGE (nfl/)
   1) The golf homepage's motion, mirrored from site/index.html (which keeps
      it inline, so it cannot be referenced): split headline, hero tracer
      field, final-block tracer field, scroll reveal + count-ups, card tilt,
      hero parallax, cursor light. Canvas code is unchanged.
   2) This week's numbers, read client-side from nfl/slate/slate.json,
      nfl/articles/articles.json and the results weeks that exist (same
      fetch pattern + Eastern-time lock math as assets/js/nfl_week.js).
      If a file is missing, the static copy in the page stays as it is.
   No external scripts.
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

  /* =================== THIS WEEK'S NUMBERS =================== */
  if (!window.fetch) return;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const getJSON = url => fetch(url, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const STAGE = {
    tue: 'Early numbers', wed: 'Wednesday numbers', thu: 'Thursday numbers', fri: 'Friday final numbers',
    sat: 'Saturday numbers', sun_am: 'Sunday AM update', sun_check: 'Inactives update', sun_late: 'Sunday late update'
  };
  const ART_NAME = { wed: 'First look', thu: 'Thursday update', fri: 'Final call', sat: 'Final read', sun: 'Sunday update', sun_am: 'Sunday update' };
  const H = 3600e3;
  // Eastern wall-clock time held in a Date's UTC fields (as in nfl_week.js)
  const parseET = s => {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ''));
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : null;
  };
  const etNow = () => {
    if (!window.Intl) return null;
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
    return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute));
  };
  // Sunday 1 PM ET lock of the slate's week (the as-of day itself when it is a Sunday)
  const lockOf = asof => new Date(Date.UTC(asof.getUTCFullYear(), asof.getUTCMonth(), asof.getUTCDate() + (7 - asof.getUTCDay()) % 7, 13, 0));
  const shortDate = t => `${DAY[t.getUTCDay()]} ${MON[t.getUTCMonth()]} ${t.getUTCDate()}`;
  const last = name => {
    const parts = String(name || '').replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i, '').trim().split(/\s+/);
    return parts[parts.length - 1] || String(name || '');
  };
  const row = (a, b, cls) => `<div class="data-row${cls ? ' ' + cls : ''}"><span>${a}</span><span>${b}</span></div>`;

  function renderSlate(slate) {
    const S = +slate.season, W = +slate.week;
    if (!S || !W) return;
    const asof = parseET(slate.as_of), now = etNow();
    const lock = asof ? lockOf(asof) : null;
    const phase = !lock || !now ? 'live' : now < lock ? 'live' : now < new Date(lock.getTime() + 12 * H) ? 'in_play' : 'final';

    // hero badge
    const badge = document.getElementById('weekBadgeText');
    if (badge) {
      badge.textContent = phase === 'live'
        ? `Live · Week ${W} · ${STAGE[slate.stage] || 'New numbers'}`
        : phase === 'in_play' ? `Week ${W} · Locked · Results Monday`
        : `Week ${W} final · Week ${W + 1} on Wednesday`;
    }

    // final block line
    const cd = document.getElementById('countdown');
    if (cd && lock) {
      cd.textContent = phase === 'live' ? `Week ${W} locks ${shortDate(lock)} · 1 PM ET`
        : phase === 'in_play' ? `Week ${W} is underway · We grade it Monday`
        : `Week ${W + 1} numbers land Wednesday evening`;
    }

    // This week card: best stack per QB, by how often it clears the stack line
    const line = +slate.stack_line || 0;
    const seen = new Set();
    const stacks = (slate.stacks || []).filter(s => s && s.qb && s.p_line != null)
      .sort((a, b) => b.p_line - a.p_line)
      .filter(s => (seen.has(s.qb) ? false : (seen.add(s.qb), true)))
      .slice(0, 3);
    const sp = document.getElementById('stackPreview');
    if (sp && stacks.length && line) {
      sp.innerHTML = row(`Week ${W} top stacks`, `Sims ${line}+ pts`, 'data-head')
        + stacks.map((s, i) => row(`${i + 1}. ${esc([s.qb].concat(s.catchers || []).map(last).join(' + '))}`, `${Math.round(s.p_line)}%`)).join('');
    }

    // Projections card: top projection at QB / RB / WR
    const players = slate.players || {};
    const pp = document.getElementById('projPreview');
    const tops = ['QB', 'RB', 'WR'].map(pos => {
      const list = (players[pos] || []).filter(p => p && p.player && p.proj != null);
      return list.length ? { pos, p: list.reduce((a, b) => (b.proj > a.proj ? b : a)) } : null;
    }).filter(Boolean);
    if (pp && tops.length) {
      pp.innerHTML = row(`Week ${W} top projections`, 'DK pts', 'data-head')
        + tops.map(x => row(`${x.pos} · ${esc(x.p.player)}`, (+x.p.proj).toFixed(1))).join('');
    }

    // proof strip
    setCount('numGames', (slate.games || []).length);
    setCount('numPlayers', Object.values(players).reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0));
    setCount('numStacks', (slate.stacks || []).length);
    setCount('numChalk', ((slate.ownership || {}).chalk || []).length);

    return { S, W };
  }

  function renderArticle(artsJson) {
    const arts = ((artsJson && artsJson.articles) || []).filter(a => a && a.href && a.title)
      .sort((a, b) => String(b.published_utc || b.date || '').localeCompare(String(a.published_utc || a.date || '')));
    const a = arts[0];
    const box = document.getElementById('articlePreview');
    if (!a || !box) return;
    const card = document.getElementById('articleCard');
    if (card) card.setAttribute('href', 'nfl/articles/' + a.href);
    const d = parseET((a.date || '') + ' 12:00');
    box.innerHTML = row('Latest article', d ? shortDate(d) : '', 'data-head')
      + row(esc(a.title), '→', 'wrap')
      + row(`Week ${esc(a.week)} · ${esc(ART_NAME[a.slot] || 'Article')}`, 'Read');
  }

  function renderResults(found) {
    if (!found) return;
    const v = document.getElementById('resultsValue'), l = document.getElementById('resultsLabel'), c = document.getElementById('resultsCard');
    if (v) v.textContent = `Week ${found.week}`;
    if (l) l.textContent = 'latest week graded';
    if (c) c.setAttribute('href', found.href);
  }

  Promise.all([getJSON('nfl/slate/slate.json'), getJSON('nfl/articles/articles.json')]).then(([slate, arts]) => {
    renderArticle(arts);
    const sw = slate ? renderSlate(slate) : null;
    if (!sw) return;
    // newest results week that exists: this week, then last week
    const weeks = [sw.W, sw.W - 1].filter(n => n > 0);
    return Promise.all(weeks.map(n => getJSON(`nfl/results/${sw.S}-w${n}/results.json`).then(j => (j ? { week: n, href: `nfl/results/${sw.S}-w${n}/` } : null))))
      .then(res => renderResults(res.find(Boolean)));
  }).catch(() => {});
})();
