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

  const NAV = [
    { href: 'nfl/overview/', key: 'nfl',     label: 'Overview' },
    { href: 'nfl/slate/',    key: 'slate',    label: 'This week', sub: 'DK main slate in our numbers' },
    { href: 'nfl/projections/', key: 'projections', label: 'Projections', sub: 'every player, one sortable table' },
    { href: 'nfl/classic/',  key: 'classic',  label: 'Classic', sub: 'DK main-slate playbook' },
    // Showdown = a dropdown trigger with NO href (10/29): Chill (5-min primetime read) + Grind (the full playbook)
    { key: 'showdown', label: 'Showdown', sub: 'DK captain-mode playbook', menu: [
      { href: 'nfl/showdown/chill/', key: 'chill', label: 'Chill', sub: '5-min read' },
      { href: 'nfl/showdown/',       key: 'grind', label: 'Grind', sub: 'full playbook' }
    ] },
    { href: 'nfl/showdown/#step4', key: 'lab', label: 'Lineup Lab', sub: 'score a lineup with the rules engine' },
    { href: 'nfl/articles/', key: 'articles', label: 'Articles' },
    { href: 'nfl/results/',  key: 'results',  label: 'Results' }
  ];

  // Dropdown (disclosure pattern): <button aria-expanded> + a menu of links. The menu is position:fixed and placed from the
  // button's rect, so the phone tab row's overflow-x scroller never clips it; it stays in DOM order right after the button
  // (Tab goes button -> Chill -> Grind -> next tab). Click / Enter / Space toggle; ArrowDown opens on the first item;
  // Esc, an outside click, a resize or scrolling the tab row closes it.
  const ddHtml = (n, top, sub) => {
    const on = n.key === top;
    const items = n.menu.map(m => {
      const cur = on && m.key === sub;
      return `<a class="nfl-dd-item ${cur ? 'active' : ''}" href="${m.href}" ${cur ? 'aria-current="page"' : ''}><span class="nfl-dd-label">${m.label}</span><span class="nfl-dd-sub">${m.sub}</span></a>`;
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

  // activeKey: a NAV key ('slate', 'showdown', ...) or 'parent:child' for a dropdown page ('showdown:chill').
  // Plain 'showdown' (the Grind page's existing call) = Showdown highlighted + Grind marked current in the menu.
  window.BBI.renderNflHeader = (activeKey) => {
    const mount = document.getElementById('site-header');
    if (!mount) return;
    const [top, subKey] = String(activeKey || '').split(':');
    const topItem = NAV.find(n => n.key === top);
    const here = location.pathname.replace(/^\/+/, '').replace(/index\.html$/, '');
    const sub = subKey || (topItem && topItem.menu ? (topItem.menu.find(m => m.href === here) || {}).key || '' : '');
    document.body.dataset.section = 'nfl';
    mount.innerHTML = `
      <nav class="nfl-nav" aria-label="NFL">
        <div class="nfl-nav-inner">
          <a href="nfl/" class="brand nfl-brand">
            <img class="brand-mark-img" src="assets/img/mark-gold.svg" alt="" width="52" height="26" />
            <span class="brand-lockup">BirdieBuddy</span>
            <span class="nfl-tag">NFL</span>
          </a>
          <div class="nfl-links">
            ${NAV.map(n => n.menu ? ddHtml(n, top, sub) : `<a class="nfl-link ${n.key === top ? 'active' : ''}" href="${n.href}" ${n.key === top ? 'aria-current="page"' : ''}>${n.label}</a>`).join('')}
          </div>
          <div class="nfl-right">
            <a class="nfl-link nfl-link-golf" href="golf/" title="Back to the golf model">Golf ↗</a>
            <span id="authControl" class="bbi-auth-ctl"></span>
          </div>
        </div>
      </nav>`;

    wireDropdowns(mount);

    // phones: the tab row scrolls sideways; bring the current page's tab into view (Results / Articles sit past the edge)
    const links = mount.querySelector('.nfl-links');
    const act = links && links.querySelector('.nfl-link.active');
    if (act && links.scrollWidth > links.clientWidth) {
      const x = act.getBoundingClientRect().left - links.getBoundingClientRect().left + links.scrollLeft;
      if (x + act.offsetWidth > links.clientWidth) links.scrollLeft = Math.max(0, x - (links.clientWidth - act.offsetWidth) / 2);
    }

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
            <div class="footer-heading">NFL</div>
            ${NAV.map(n => n.menu ? n.menu.map(m => `<a class="footer-link" href="${m.href}">${n.label} ${m.label}</a>`).join('') : `<a class="footer-link" href="${n.href}">${n.label}</a>`).join('')}
          </div>
          <div class="nfl-footer-links">
            <div class="footer-heading">BirdieBuddy</div>
            <a class="footer-link" href="golf/">Golf model</a>
            <a class="footer-link" href="pricing.html">Membership</a>
            <a class="footer-link" href="account.html">My account</a>
          </div>
        </div>
        <div class="footer-credit"><span>© 2026 BirdieBuddy</span><span>${note ? note : 'NFL'}</span></div>
      </footer>`;
  };
})();
