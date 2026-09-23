/* =====================================================================
   BIRDIEBUDDY — SHOWDOWN FX
   Motion for a page that re-renders with innerHTML:
     • morph: any element tagged data-m="key" animates from its previous
       render to the new one — inline style (bar widths, donut dashes,
       marker positions) via CSS transitions, and numbers (data-n) by a
       count-up tween with a brief gold flash when the value changed.
     • reveal: cards fade/slide in the first time they scroll into view.
     • confetti: a short gold burst for a codex-grade lineup.
   Everything is skipped under prefers-reduced-motion.
   ===================================================================== */
window.BBI = window.BBI || {};
(() => {
  'use strict';
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const reduced = () => mq.matches;
  const ease = t => 1 - Math.pow(1 - t, 3);
  const running = new WeakMap();

  const fmt = (el, v) => {
    const d = +(el.dataset.d || 0);
    const s = el.dataset.sep ? Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : Math.abs(v).toFixed(d);
    return (v < 0 && +s !== 0 ? '−' : '') + s;
  };
  // Tween the numeric part of el's text from `from` to its data-n.
  const tween = (el, from, dur = 520) => {
    const to = +el.dataset.n; if (!isFinite(from) || !isFinite(to) || from === to) return;
    const final = el.textContent, target = fmt(el, to), at = final.indexOf(target);
    if (at < 0) return;
    const pre = final.slice(0, at), post = final.slice(at + target.length);
    const t0 = performance.now(); const id = {}; running.set(el, id);
    const step = now => {
      if (running.get(el) !== id) return;
      const t = Math.min(1, (now - t0) / dur), v = from + (to - from) * ease(t);
      el.textContent = pre + fmt(el, t < 1 ? v : to) + post;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const snapshot = (root = document) => {
    const m = new Map();
    root.querySelectorAll('[data-m]').forEach(el => m.set(el.dataset.m, { style: el.getAttribute('style') || '', n: el.dataset.n }));
    return m;
  };
  const morph = (prev, root = document) => {
    if (!prev || reduced()) return;
    const els = [...root.querySelectorAll('[data-m]')];
    const styled = [];
    for (const el of els) {
      const p = prev.get(el.dataset.m), style = el.getAttribute('style') || '';
      if (el.dataset.n != null) {
        const from = p && p.n != null ? +p.n : (el.dataset.from != null ? +el.dataset.from : NaN);
        if (isFinite(from) && from !== +el.dataset.n) {
          tween(el, from);
          if (p) { el.classList.remove('fx-flash'); void el.offsetWidth; el.classList.add('fx-flash'); }
        }
      }
      const fromStyle = p ? p.style : el.dataset.fromStyle;
      if (fromStyle != null && fromStyle !== style) { el.setAttribute('style', fromStyle); styled.push([el, style]); }
    }
    if (!styled.length) return;
    void document.body.offsetWidth;                     // commit the "from" styles
    requestAnimationFrame(() => styled.forEach(([el, s]) => el.setAttribute('style', s)));
  };

  // Reveal-on-scroll. Elements get .fx-in once; new renders keep it.
  let io = null; const seen = new Set();
  const reveal = (sel = '.fx-reveal') => {
    if (reduced() || !('IntersectionObserver' in window)) { document.querySelectorAll(sel).forEach(el => el.classList.add('fx-in')); return; }
    document.documentElement.classList.add('fx-on');
    io = io || new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return;
      const el = e.target; seen.add(el.id || el); el.classList.add('fx-in'); io.unobserve(el);
    }), { rootMargin: '0px 0px -8% 0px', threshold: 0.04 });
    document.querySelectorAll(sel).forEach((el, i) => {
      if (el.classList.contains('fx-in')) return;
      if (el.id && seen.has(el.id)) { el.classList.add('fx-in'); return; }
      el.style.setProperty('--fx-delay', `${(i % 4) * 60}ms`);
      io.observe(el);
    });
  };

  // Gold confetti burst from a point (viewport coords).
  const confetti = (x, y, n = 90) => {
    if (reduced()) return;
    const cv = document.createElement('canvas'), dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.className = 'fx-confetti'; cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    Object.assign(cv.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 3000 });
    document.body.appendChild(cv);
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const cols = ['#fdf6dd', '#f4d97a', '#f4c863', '#d4a843', '#b08828', '#f4f4f8'];
    const P = Array.from({ length: n }, () => { const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1, v = 5 + Math.random() * 8;
      return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 2 + Math.random() * 3.5, c: cols[(Math.random() * cols.length) | 0], s: Math.random() * 6, w: 0.2 + Math.random() * 0.3, rect: Math.random() > 0.4 }; });
    const t0 = performance.now();
    const step = now => {
      const t = (now - t0) / 1000; g.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of P) { p.vy += 0.28; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.s += p.w;
        g.globalAlpha = Math.max(0, 1 - t / 1.6); g.fillStyle = p.c; g.save(); g.translate(p.x, p.y); g.rotate(p.s);
        if (p.rect) g.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); else { g.beginPath(); g.arc(0, 0, p.r / 1.3, 0, 7); g.fill(); } g.restore(); }
      if (t < 1.7) requestAnimationFrame(step); else cv.remove();
    };
    requestAnimationFrame(step);
  };

  // <span data-m data-n> helper for renderers.
  const num = (key, v, d = 0, opts = {}) => {
    const s = opts.sep ? Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : Math.abs(+v).toFixed(d);
    const txt = (opts.pre || '') + (v < 0 && +Math.abs(v).toFixed(d) !== 0 ? '−' : '') + s + (opts.post || '');
    return `<span class="fx-num${opts.cls ? ' ' + opts.cls : ''}" data-m="${key}" data-n="${v}" data-d="${d}"${opts.sep ? ' data-sep="1"' : ''}${opts.from != null ? ` data-from="${opts.from}"` : ''}>${txt}</span>`;
  };

  /* ---------- keyboard + focus (a11y) ----------
     The page re-renders regions with innerHTML, which drops the focused
     control. keepFocus() is called before a render and returns a restore()
     to call after it: it re-focuses the control with the same data-*
     attributes inside the same #id host (or, failing that, the first
     control of the same kind there), so keyboard focus survives renders. */
  const SKIP_ATTR = /^data-(m|n|d|from|sep|from-style)$/;
  const keepFocus = () => {
    const a = document.activeElement;
    if (!a || a === document.body || !a.closest) return () => {};
    const host = a.parentElement && a.parentElement.closest('[id]');
    const attrs = [...a.attributes].filter(x => x.name.startsWith('data-') && !SKIP_ATTR.test(x.name)).map(x => [x.name, x.value]);
    const tag = a.tagName;
    return () => {
      if (a.isConnected) return;
      if (a.id) { const same = document.getElementById(a.id); if (same) { same.focus({ preventScroll: true }); return; } }
      if (!host || !attrs.length) return;
      const h = document.getElementById(host.id); if (!h) return;
      const q = sel => { try { return [...h.querySelectorAll(sel)].find(el => el.tagName === tag && el.getClientRects().length); } catch { return null; } };
      const el = q(attrs.map(([k, v]) => `[${k}="${CSS.escape(v)}"]`).join('')) || q(attrs.map(([k]) => `[${k}]`).join(''));
      if (el) el.focus({ preventScroll: true });
    };
  };
  // Roving tabindex for [role=radiogroup]: one tab stop per group (the checked radio,
  // or the first when none is checked); the arrow keys move and select (keydown below).
  const rove = (root = document) => {
    root.querySelectorAll('[role=radiogroup]').forEach(g => {
      const rs = [...g.querySelectorAll('[role=radio]')]; if (!rs.length) return;
      const on = rs.find(r => r.getAttribute('aria-checked') === 'true') || rs[0];
      rs.forEach(r => r.setAttribute('tabindex', r === on ? '0' : '-1'));
    });
  };
  document.addEventListener('keydown', e => {
    const r = e.target && e.target.closest && e.target.closest('[role=radio]');
    const g = r && r.closest('[role=radiogroup]');
    if (!g || e.altKey || e.ctrlKey || e.metaKey) return;
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: -1e3, End: 1e3 }[e.key]; if (!d) return;
    e.preventDefault();
    const rs = [...g.querySelectorAll('[role=radio]')], i = rs.indexOf(r);
    const n = Math.abs(d) > 1 ? (d < 0 ? 0 : rs.length - 1) : (i + d + rs.length) % rs.length;
    const hostId = g.id, key = rs[n].dataset.key;
    rs[n].click();                                           // selects → the page re-renders the group
    const g2 = (hostId && document.getElementById(hostId)) || g;
    const t = [...g2.querySelectorAll('[role=radio]')].find(x => x.dataset.key === key) || [...g2.querySelectorAll('[role=radio]')][n];
    if (t) t.focus({ preventScroll: false });
  });

  window.BBI.fx = { reduced, snapshot, morph, reveal, confetti, tween, num, keepFocus, rove };
})();
