/* =====================================================================
   BIRDIEBUDDY — NFL SECTION CHROME (/nfl/*)
   Shared header/footer for the NFL pages. Separate from the golf shell
   (data.js renderHeader / renderMobileShell) on purpose: its own menu,
   no golf ticker or tab bar. Pages under /nfl/ set <base href="/"> so
   every relative path here and in auth.js resolves from the site root.
   ===================================================================== */

window.BBI = window.BBI || {};

(() => {
  'use strict';

  // Round 2 (10/30): 9 tabs -> 5. Results, Before You Lock and the player search live in the right-hand area + footer;
  // Overview is gone (its URL 301s to nfl/). Phones get a bottom bar (renderNflMobileBar) instead of the sideways tab row.
  const NAV = [
    { href: 'nfl/slate/',       key: 'slate',       label: 'This Week',   sub: 'DK main slate in our numbers' },
    { href: 'nfl/projections/', key: 'projections', label: 'Projections', sub: 'every player, one sortable table' },
    // Playbooks = a dropdown trigger with NO href: the two 5-minute reads + the two full playbooks
    { key: 'playbooks', label: 'Playbooks', sub: 'what to play and why', menu: [
      { href: 'nfl/classic/chill/',  key: 'classic-chill',  label: 'Classic Chill',  sub: '5-min read', group: 'Classic · Sunday main slate' },
      { href: 'nfl/classic/',        key: 'classic-grind',  label: 'Classic Grind',  sub: 'full playbook', group: 'Classic · Sunday main slate' },
      { href: 'nfl/showdown/chill/', key: 'showdown-chill', label: 'Showdown Chill', sub: '5-min read', group: 'Showdown · one game' },
      { href: 'nfl/showdown/',       key: 'showdown-grind', label: 'Showdown Grind', sub: 'full playbook', group: 'Showdown · one game' }
    ] },
    { href: 'nfl/lab/',      key: 'lab',      label: 'Lab',      sub: 'build or check a lineup' },
    { href: 'nfl/articles/', key: 'articles', label: 'Articles', sub: 'the week in plain English' }
  ];
  const EXTRA = {
    results: { href: 'nfl/results/', label: 'Results', sub: 'how our numbers did' },
    lock:    { href: 'nfl/lock/',    label: 'Before You Lock', sub: 'Sunday outs + late news' },
    players: { href: 'nfl/players/', label: 'Find a player', sub: 'search any name' }
  };
  // older page keys (generated pages, archives) -> the new ones, so nothing needs regenerating to highlight right
  const ALIAS = {
    nfl: 'home', classic: 'playbooks:classic-grind', 'classic:grind': 'playbooks:classic-grind', 'classic:chill': 'playbooks:classic-chill',
    showdown: 'playbooks:showdown-grind', 'showdown:grind': 'playbooks:showdown-grind', 'showdown:chill': 'playbooks:showdown-chill'
  };
  const normKey = (k) => { k = String(k || ''); return ALIAS[k] || k; };

  // Sunday in New York (the page shows the Before You Lock chip all day Sunday ET)
  const isSundayET = () => {
    try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date()) === 'Sun'; }
    catch (e) { return new Date().getDay() === 0; }
  };

  const ICON = {
    week: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    proj: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1.3"/><circle cx="4" cy="12" r="1.3"/><circle cx="4" cy="18" r="1.3"/></svg>',
    book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5A2.5 2.5 0 017.5 3H19v15H7.5A2.5 2.5 0 005 20.5z"/><path d="M5 20.5A2.5 2.5 0 017.5 18H19v3H7.5"/></svg>',
    lab:  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6M10 3v6.5L4.6 18.4A1.8 1.8 0 006.1 21h11.8a1.8 1.8 0 001.5-2.6L14 9.5V3"/><path d="M7.4 14.5h9.2"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
    search: '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M13 13l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
  };

  // Dropdown (disclosure pattern): <button aria-expanded> + a menu of links. The menu is position:fixed and placed from the
  // button's rect, so the phone tab row's overflow-x scroller never clips it; it stays in DOM order right after the button
  // (Tab goes button -> each playbook -> next tab). Click / Enter / Space toggle; ArrowDown opens on the first item;
  // Esc, an outside click, a resize or scrolling the tab row closes it.
  const ddHtml = (n, top, sub) => {
    const on = n.key === top;
    let grp = '';
    const items = n.menu.map(m => {
      const cur = on && m.key === sub;
      const head = m.group && m.group !== grp ? `<div class="nfl-dd-group" aria-hidden="true">${(grp = m.group)}</div>` : '';
      return head + `<a class="nfl-dd-item ${cur ? 'active' : ''}" href="${m.href}" ${cur ? 'aria-current="page"' : ''}><span class="nfl-dd-label">${m.label}</span><span class="nfl-dd-sub">${m.sub}</span></a>`;
    }).join('');
    return `<div class="nfl-dd" data-dd="${n.key}">` +
      `<button type="button" class="nfl-link nfl-dd-btn ${on ? 'active' : ''}" aria-expanded="false" aria-controls="nfl-dd-${n.key}">${n.label}<svg class="nfl-dd-caret" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` +
      `<div class="nfl-dd-menu" id="nfl-dd-${n.key}" hidden>${items}</div></div>`;
  };

  const wireDropdowns = (mount) => {
    mount.querySelectorAll('.nfl-dd').forEach(dd => {
      const btn = dd.querySelector('.nfl-dd-btn'), menu = dd.querySelector('.nfl-dd-menu');
      if (!btn || !menu) return;
      const items = () => Array.from(menu.querySelectorAll('.nfl-dd-item'));
      const place = () => {
        // the containing block of a fixed box can be the nav (backdrop-filter) or the viewport: measure its origin first
        menu.style.top = '0px'; menu.style.left = '0px';
        const o = menu.getBoundingClientRect(), b = btn.getBoundingClientRect(), w = menu.offsetWidth;
        const vw = document.documentElement.clientWidth || window.innerWidth;
        const x = Math.max(8, Math.min(b.left, vw - w - 8));
        menu.style.top = Math.round(b.bottom + 6 - o.top) + 'px';
        menu.style.left = Math.round(x - o.left) + 'px';
      };
      const isOpen = () => btn.getAttribute('aria-expanded') === 'true';
      const open = (focusFirst) => {
        if (isOpen()) { if (focusFirst) items()[0]?.focus(); return; }
        btn.setAttribute('aria-expanded', 'true'); dd.classList.add('open'); menu.hidden = false; place();
        if (focusFirst) items()[0]?.focus();
      };
      const close = (refocus) => {
        if (!isOpen()) return;
        btn.setAttribute('aria-expanded', 'false'); dd.classList.remove('open'); menu.hidden = true;
        if (refocus) btn.focus();
      };
      btn.addEventListener('click', (e) => { e.preventDefault(); isOpen() ? close(false) : open(e.detail === 0); });
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); open(true); }
        else if (e.key === 'Escape') close(true);
      });
      menu.addEventListener('keydown', (e) => {
        const list = items(), i = list.indexOf(document.activeElement);
        if (e.key === 'Escape') { e.preventDefault(); close(true); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); i <= 0 ? btn.focus() : list[i - 1].focus(); }
        else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
        else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
      });
      dd.addEventListener('focusout', (e) => { if (isOpen() && !dd.contains(e.relatedTarget)) close(false); });
      document.addEventListener('click', (e) => { if (isOpen() && !dd.contains(e.target)) close(false); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(dd.contains(document.activeElement)); });
      window.addEventListener('resize', () => close(false));
      window.addEventListener('scroll', () => { if (isOpen()) place(); }, { passive: true });
      mount.querySelector('.nfl-links')?.addEventListener('scroll', () => close(false), { passive: true });
    });
  };

  // activeKey: a NAV key ('slate', 'lab', ...), 'parent:child' for a dropdown page ('playbooks:classic-chill'), or an
  // EXTRA key ('results', 'lock', 'players'). Old keys ('showdown', 'classic:chill', ...) still work through ALIAS.
  window.BBI.renderNflHeader = (activeKey) => {
    const mount = document.getElementById('site-header');
    if (!mount) return;
    const key = normKey(activeKey);
    const [top, subKey] = key.split(':');
    const topItem = NAV.find(n => n.key === top);
    const here = location.pathname.replace(/^\/+/, '').replace(/index\.html$/, '');
    const sub = subKey || (topItem && topItem.menu ? (topItem.menu.find(m => m.href === here) || {}).key || '' : '');
    const sunday = isSundayET();
    const lockOn = top === 'lock';
    const showLock = sunday || lockOn;
    document.body.dataset.section = 'nfl';
    document.body.classList.add('nfl-has-mbar');
    const cur = (on) => on ? 'aria-current="page"' : '';
    mount.innerHTML = `
      <nav class="nfl-nav nfl-nav-main ${showLock ? 'has-lock' : ''}" aria-label="NFL">
        <div class="nfl-nav-inner">
          <a href="nfl/" class="brand nfl-brand">
            <img class="brand-mark-img" src="assets/img/mark-gold.svg" alt="" width="52" height="26" />
            <span class="brand-lockup">BirdieBuddy</span>
            <span class="nfl-tag">NFL</span>
          </a>
          <div class="nfl-links">
            ${NAV.map(n => n.menu ? ddHtml(n, top, sub) : `<a class="nfl-link ${n.key === top ? 'active' : ''}" href="${n.href}" ${cur(n.key === top)}>${n.label}</a>`).join('')}
          </div>
          <div class="nfl-right">
            <button type="button" class="nfl-search-btn" data-nfl-search-open aria-label="Search players" title="Search players (press /)">${ICON.search}<span class="nfl-search-lbl">Players</span></button>
            ${showLock ? `<a class="nfl-lock-chip ${lockOn ? 'active' : ''}" href="${EXTRA.lock.href}" ${cur(lockOn)} title="Sunday outs, late news and swaps"><span class="nfl-lock-dot" aria-hidden="true"></span>Before You Lock</a>` : ''}
            <a class="nfl-link nfl-link-sm ${top === 'results' ? 'active' : ''}" href="${EXTRA.results.href}" ${cur(top === 'results')}>Results</a>
            <a class="nfl-link nfl-link-golf" href="golf/" title="Back to the golf model">Golf ↗</a>
            <span id="authControl" class="bbi-auth-ctl"></span>
          </div>
        </div>
        ${showLock && !lockOn ? `<a class="nfl-lockbar" href="${EXTRA.lock.href}"><span class="nfl-lock-dot" aria-hidden="true"></span><span><b>It's Sunday.</b> Before You Lock: outs, late news, who gains</span><span aria-hidden="true">→</span></a>` : ''}
      </nav>`;

    wireDropdowns(mount);

    // player search (round 2): nfl_search.js + players.json load on first use only; once loaded, nfl_search.js
    // handles [data-nfl-search-open] clicks and the "/" key itself
    const SEARCH_JS = 'assets/js/nfl_search.js?v=3';
    const loadSearch = () => window.BBI.nflSearch ? Promise.resolve() : (window.BBI._nflSearchP = window.BBI._nflSearchP || new Promise((ok, no) => {
      const s = document.createElement('script'); s.src = SEARCH_JS; s.async = true;
      s.onload = ok; s.onerror = () => { window.BBI._nflSearchP = null; no(); }; document.head.appendChild(s);
    }));
    const sbtn = mount.querySelector('.nfl-search-btn');
    if (sbtn) {
      sbtn.addEventListener('click', (e) => { if (window.BBI.nflSearch) return; e.preventDefault(); loadSearch().then(() => window.BBI.nflSearch.openPalette(sbtn)).catch(() => { location.href = 'nfl/players/'; }); });
      sbtn.addEventListener('pointerenter', () => { loadSearch().catch(() => {}); }, { once: true });
    }
    if (!window.BBI._nflSlash) {
      window.BBI._nflSlash = 1;
      document.addEventListener('keydown', (e) => {
        if (e.key !== '/' || window.BBI.nflSearch || e.metaKey || e.ctrlKey || e.altKey) return;
        const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        e.preventDefault(); loadSearch().then(() => window.BBI.nflSearch.openPalette(document.activeElement)).catch(() => {});
      });
    }

    // tablets: the tab row wraps under the brand and scrolls sideways; bring the current tab into view
    const links = mount.querySelector('.nfl-links');
    const act = links && links.querySelector('.nfl-link.active');
    if (act && links.scrollWidth > links.clientWidth) {
      const x = act.getBoundingClientRect().left - links.getBoundingClientRect().left + links.scrollLeft;
      if (x + act.offsetWidth > links.clientWidth) links.scrollLeft = Math.max(0, x - (links.clientWidth - act.offsetWidth) / 2);
    }

    window.BBI.renderNflMobileBar(key, { sunday });

    // auth.js: same lazy-load pattern as data.js so the account control,
    // login modal and [data-gate] gating work here without a golf header.
    const mountControl = () => { try { window.BBI.auth?.mountHeaderControl(); } catch (e) {} };
    if (window.BBI.auth) { mountControl(); return; }
    let s = document.getElementById('bbi-auth-js');
    if (!s) {
      s = document.createElement('script');
      s.id = 'bbi-auth-js'; s.src = 'assets/js/auth.js'; s.async = true;
      s.addEventListener('error', () => console.warn('[auth] failed to load auth.js'));
      document.head.appendChild(s);
    }
    s.addEventListener('load', mountControl);
  };

  // ---------- PHONES (<=767px): bottom tab bar + one bottom sheet ----------
  // Same idea as golf's renderMobileShell (data.js), kept separate: its own classes (nfl-mbar / nfl-msheet), so golf's
  // mobile.css never applies here. 5 tabs: This Week · Projections · Playbooks (opens the sheet with the 4 playbooks) ·
  // Lab · More (Articles, Results, Before You Lock, Players, Golf). CSS hides all of it at 768px and up.
  window.BBI.renderNflMobileBar = (activeKey, opts) => {
    if (document.getElementById('nflMbar')) return;
    const key = normKey(activeKey);
    const [top, sub] = key.split(':');
    const sunday = opts && 'sunday' in opts ? opts.sunday : isSundayET();
    const moreKeys = ['articles', 'results', 'lock', 'players'];
    const tab = (href, k, label, icon, on) =>
      `<a class="nfl-mtab ${on ? 'active' : ''}" href="${href}" ${on ? 'aria-current="page"' : ''}>${icon}<span>${label}</span></a>`;
    const btn = (k, label, icon, on, dot) =>
      `<button type="button" class="nfl-mtab ${on ? 'active' : ''}" data-msheet="${k}" aria-haspopup="dialog" aria-expanded="false" aria-controls="nflMsheet">${icon}<span>${label}</span>${dot ? '<i class="nfl-mtab-dot" aria-hidden="true"></i>' : ''}</button>`;
    const bar = document.createElement('nav');
    bar.className = 'nfl-mbar'; bar.id = 'nflMbar';
    bar.setAttribute('aria-label', 'NFL sections');
    bar.innerHTML =
      tab('nfl/slate/', 'slate', 'This Week', ICON.week, top === 'slate') +
      tab('nfl/projections/', 'projections', 'Projections', ICON.proj, top === 'projections') +
      btn('playbooks', 'Playbooks', ICON.book, top === 'playbooks', false) +
      tab('nfl/lab/', 'lab', 'Lab', ICON.lab, top === 'lab') +
      btn('more', 'More', ICON.more, moreKeys.includes(top), sunday && top !== 'lock');

    const link = (href, label, small, on, hot) =>
      `<a class="nfl-msheet-link ${on ? 'active' : ''} ${hot ? 'hot' : ''}" href="${href}" ${on ? 'aria-current="page"' : ''}>${label}${small ? `<small>${small}</small>` : ''}</a>`;
    const pb = NAV.find(n => n.key === 'playbooks');
    const SHEETS = {
      playbooks: () => {
        const groups = [];
        pb.menu.forEach(m => { let g = groups.find(x => x.name === m.group); if (!g) groups.push(g = { name: m.group, items: [] }); g.items.push(m); });
        return `<h2 class="nfl-msheet-title" id="nflMsheetTitle">Playbooks</h2>` + groups.map(g =>
          `<div class="nfl-msheet-label">${g.name}</div><div class="nfl-msheet-grid">${g.items.map(m =>
            link(m.href, m.label.replace(/^(Classic|Showdown) /, ''), m.sub === '5-min read' ? '5-minute read' : 'Full playbook', top === 'playbooks' && sub === m.key)).join('')}</div>`).join('');
      },
      more: () => `<h2 class="nfl-msheet-title" id="nflMsheetTitle">More</h2><div class="nfl-msheet-grid">` +
        link(EXTRA.lock.href, EXTRA.lock.label, sunday ? 'Live today' : 'Updates Sunday 9 AM ET', top === 'lock', sunday) +
        link('nfl/articles/', 'Articles', 'The week in plain English', top === 'articles') +
        link(EXTRA.results.href, EXTRA.results.label, 'How our numbers did', top === 'results') +
        link(EXTRA.players.href, EXTRA.players.label, 'Search any name', top === 'players') +
        link('golf/', 'Golf', 'The golf model') +
        link('nfl/', 'NFL home', '') + `</div>` +
        `<div class="nfl-msheet-label">Account</div><div class="nfl-msheet-grid">` +
        link('pricing.html', 'Membership', 'One membership, everything') +
        link('account.html', 'My account', '') + `</div>`
    };
    const backdrop = document.createElement('div');
    backdrop.className = 'nfl-msheet-backdrop'; backdrop.id = 'nflMsheetBackdrop';
    const sheet = document.createElement('div');
    sheet.className = 'nfl-msheet'; sheet.id = 'nflMsheet';
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-labelledby', 'nflMsheetTitle');
    sheet.hidden = true;
    document.body.append(bar, backdrop, sheet);

    let opener = null, which = '';
    const close = (refocus) => {
      if (sheet.hidden) return;
      document.body.classList.remove('nfl-msheet-open');
      bar.querySelectorAll('[data-msheet]').forEach(b => b.setAttribute('aria-expanded', 'false'));
      sheet.hidden = true; which = '';
      if (refocus && opener) opener.focus();
    };
    const open = (k, b) => {
      if (!sheet.hidden && which === k) { close(true); return; }
      opener = b; which = k;
      sheet.innerHTML = `<div class="nfl-msheet-grab" aria-hidden="true"></div>` + SHEETS[k]() +
        `<button type="button" class="nfl-msheet-close">Close</button>`;
      bar.querySelectorAll('[data-msheet]').forEach(x => x.setAttribute('aria-expanded', String(x === b)));
      sheet.hidden = false;
      void sheet.offsetWidth;                      // let the slide-up transition run
      document.body.classList.add('nfl-msheet-open');
      (sheet.querySelector('.nfl-msheet-link.active') || sheet.querySelector('.nfl-msheet-link'))?.focus({ preventScroll: true });
    };
    bar.addEventListener('click', (e) => { const b = e.target.closest('[data-msheet]'); if (b) { e.preventDefault(); open(b.dataset.msheet, b); } });
    backdrop.addEventListener('click', () => close(false));
    sheet.addEventListener('click', (e) => { if (e.target.closest('.nfl-msheet-close')) close(true); else if (e.target.closest('a')) close(false); });
    sheet.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
      if (e.key !== 'Tab') return;
      const f = Array.from(sheet.querySelectorAll('a, button'));
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
    window.addEventListener('resize', () => { if (window.innerWidth >= 768) close(false); });
  };

  window.BBI.renderNflFooter = (note) => {
    const mount = document.getElementById('site-footer');
    if (!mount) return;
    mount.innerHTML = `
      <footer class="nfl-footer">
        <div class="nfl-footer-inner">
          <div class="nfl-footer-brand">
            <a href="nfl/" class="brand"><img class="brand-mark-img" src="assets/img/mark-gold.svg" alt="" width="52" height="26" /><span class="brand-lockup">BirdieBuddy</span><span class="nfl-tag">NFL</span></a>
            <p class="muted">Every number is a winner rate with an n. Not an opinion, not wagering advice.</p>
          </div>
          <div class="nfl-footer-links">
            <div class="footer-heading">This week</div>
            <a class="footer-link" href="nfl/slate/">This Week</a>
            <a class="footer-link" href="nfl/projections/">Projections</a>
            <a class="footer-link" href="nfl/lab/">Lineup Lab</a>
            <a class="footer-link" href="${EXTRA.players.href}">Find a player</a>
            <a class="footer-link" href="${EXTRA.lock.href}">Before You Lock</a>
          </div>
          <div class="nfl-footer-links">
            <div class="footer-heading">Playbooks</div>
            ${NAV.find(n => n.key === 'playbooks').menu.map(m => `<a class="footer-link" href="${m.href}">${m.label}</a>`).join('')}
          </div>
          <div class="nfl-footer-links">
            <div class="footer-heading">More</div>
            <a class="footer-link" href="nfl/articles/">Articles</a>
            <a class="footer-link" href="${EXTRA.results.href}">Results</a>
            <a class="footer-link" href="golf/">Golf model</a>
            <a class="footer-link" href="pricing.html">Membership</a>
            <a class="footer-link" href="account.html">My account</a>
          </div>
        </div>
        <div class="footer-credit"><span>© 2026 BirdieBuddy</span><span>${note ? note : 'NFL'}</span></div>
        <div class="footer-legal"><nav class="footer-legal-links" aria-label="Legal"><a href="terms.html">Terms</a><span aria-hidden="true">·</span><a href="privacy.html">Privacy</a><span aria-hidden="true">·</span><a href="responsible-play.html">Responsible play</a></nav><p class="footer-legal-note">18+ (21+ where required). For information and entertainment only; not wagering advice. Not affiliated with DraftKings, the NFL or the PGA TOUR. Gambling problem? Call <a href="tel:+18004262537">1-800-GAMBLER</a>.</p></div>
      </footer>`;
  };
})();
