/* =====================================================================
   BIRDIEBUDDY — CORE
   Shared nav, formatting, clipboard, keyboard, small utilities.
   Load BEFORE components.js / animations.js / data.js.
   ===================================================================== */

(() => {
  // ---------- tiny DOM helpers ----------
  window.$  = (sel, root = document) => root.querySelector(sel);
  window.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  window.el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class' || k === 'className') node.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k.startsWith('data-') || k === 'aria-pressed' || k === 'aria-selected' || k === 'role') node.setAttribute(k, v);
      else if (v != null) node[k] = v;
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return node;
  };

  // ---------- number / text formatters ----------
  const fmt = {
    int:   v => (v == null || isNaN(v)) ? '—' : Math.round(v).toLocaleString(),
    num:   (v, d = 2) => (v == null || isNaN(v)) ? '—' : (+v).toFixed(d),
    pct:   (v, d = 1) => (v == null || isNaN(v)) ? '—' : `${(+v).toFixed(d)}%`,
    pctProb: (v, d = 1) => (v == null || isNaN(v)) ? '—' : `${(+v * (v < 1 ? 100 : 1)).toFixed(d)}%`,
    pp:    (v, d = 2) => (v == null || isNaN(v)) ? '—' : `${(v >= 0 ? '+' : '')}${(+v).toFixed(d)}pp`,
    money: v => (v == null || isNaN(v)) ? '—' : `$${(+v).toLocaleString()}`,
    decimal: v => (v == null || isNaN(v)) ? '—' : (+v).toFixed(2),
    abbrevName: raw => {
      if (!raw) return '';
      // accepts "Last, First" or "First Last"
      if (raw.includes(',')) {
        const [last, first] = raw.split(',').map(s => s.trim());
        const initial = first ? first[0] : '';
        return `${initial}. ${last}`;
      }
      const parts = raw.split(/\s+/);
      if (parts.length < 2) return raw;
      return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
    },
    ago: ts => {
      if (!ts) return '—';
      const d = new Date(ts);
      const diff = (Date.now() - d.getTime()) / 1000;
      if (diff < 60) return 'just now';
      if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
      return `${Math.round(diff / 86400)}d ago`;
    },
    date: ts => ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—',
    datetime: ts => ts ? new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
  };
  window.fmt = fmt;

  // ---------- clamp / math utils ----------
  window.clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  window.lerp = (a, b, t) => a + (b - a) * t;
  window.normalize = (arr, key) => {
    if (!arr.length) return arr;
    const vals = arr.map(x => key ? x[key] : x).filter(v => v != null && !isNaN(v));
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const span = hi - lo || 1;
    return arr.map(x => {
      const v = key ? x[key] : x;
      return (v == null || isNaN(v)) ? 0 : (v - lo) / span;
    });
  };

  // ---------- bookmarks (localStorage) ----------
  const BM_KEY = 'bbi.bookmarks.v1';
  const bookmarks = {
    load: () => { try { return new Set(JSON.parse(localStorage.getItem(BM_KEY) || '[]')); } catch { return new Set(); } },
    save: s => { try { localStorage.setItem(BM_KEY, JSON.stringify([...s])); } catch {} },
    has: id => bookmarks.load().has(String(id)),
    toggle: id => { const s = bookmarks.load(); const k = String(id); s.has(k) ? s.delete(k) : s.add(k); bookmarks.save(s); return s.has(k); }
  };
  window.bbiBookmarks = bookmarks;

  // ---------- nav active-state ----------
  const initNav = () => {
    const path = location.pathname.split('/').pop() || 'index.html';
    $$('.nav-link').forEach(link => {
      const href = link.getAttribute('href') || '';
      if (href === path || (path === 'index.html' && href === './') || (path === '' && href === 'index.html')) {
        link.classList.add('active');
      }
    });
  };

  // ---------- keyboard: Cmd/Ctrl+K focuses any global search ----------
  const initKeyboard = () => {
    window.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        const input = $('[data-search]');
        if (input) { e.preventDefault(); input.focus(); input.select(); }
      }
      if (e.key === 'Escape') {
        const input = $('[data-search]');
        if (input && document.activeElement === input) { input.value = ''; input.dispatchEvent(new Event('input')); input.blur(); }
      }
    });
  };

  // ---------- small UI: ticker / marquee data binding ----------
  window.renderTicker = (items, container) => {
    if (!container) return;
    container.innerHTML = '';
    const track = el('div', { class: 'marquee-track' });
    const build = () => items.forEach(i => track.append(el('span', { class: 'marquee-item', html: i })));
    build(); build(); // double for seamless loop
    container.append(track);
  };

  // ---------- tier helper ----------
  window.tierClass = t => {
    const map = {
      SPECIALIST: 'tier tier-specialist',
      COMFORTABLE: 'tier tier-comfortable',
      NEUTRAL: 'tier tier-neutral',
      STRUGGLE: 'tier tier-struggle'
    };
    return map[t] || 'tier tier-neutral';
  };

  // ---------- player link helper ----------
  window.playerLink = (idOrObj, displayName) => {
    // Accept either a player object ({dg_id, name, slug?}) or (id, name) args
    let id, name, slug;

    if (typeof idOrObj === 'object' && idOrObj !== null) {
      // Object form: {dg_id, name, slug?}
      id = idOrObj.dg_id;
      name = idOrObj.name || displayName;
      slug = idOrObj.slug;
    } else {
      // (id, name) form
      id = idOrObj;
      name = displayName;
      slug = undefined;
    }

    // If no id, return just the name text
    if (id == null) return String(name || '');

    // Build URL with id or slug
    const url = slug ? `player.html?slug=${encodeURIComponent(slug)}` : `player.html?id=${encodeURIComponent(id)}`;

    return `<a href="${url}" class="player-link">${name}</a>`;
  };

  // ---------- boot ----------
  document.addEventListener('DOMContentLoaded', () => {
    initNav();
    initKeyboard();
    document.body.classList.add('page-enter');
  });
})();
