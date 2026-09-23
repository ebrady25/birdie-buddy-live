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
    { href: 'nfl/',          key: 'nfl',      label: 'Overview' },
    { href: 'nfl/showdown/', key: 'showdown', label: 'Showdown', sub: 'DK captain-mode playbook' },
    { href: 'nfl/showdown/#step4', key: 'lab', label: 'Lineup Lab', sub: 'score a lineup with the rules engine' },
    { href: 'nfl/classic/',  key: 'classic',  label: 'Classic', sub: 'DK main-slate playbook' }
  ];

  window.BBI.renderNflHeader = (activeKey) => {
    const mount = document.getElementById('site-header');
    if (!mount) return;
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
            ${NAV.map(n => `<a class="nfl-link ${n.key === activeKey ? 'active' : ''}" href="${n.href}" ${n.key === activeKey ? 'aria-current="page"' : ''}>${n.label}</a>`).join('')}
          </div>
          <div class="nfl-right">
            <a class="nfl-link nfl-link-golf" href="./" title="Back to the golf model">Golf ↗</a>
            <span id="authControl" class="bbi-auth-ctl"></span>
          </div>
        </div>
      </nav>`;

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
            ${NAV.map(n => `<a class="footer-link" href="${n.href}">${n.label}</a>`).join('')}
          </div>
          <div class="nfl-footer-links">
            <div class="footer-heading">BirdieBuddy</div>
            <a class="footer-link" href="./">Golf model</a>
            <a class="footer-link" href="pricing.html">Pricing &amp; plans</a>
            <a class="footer-link" href="account.html">My account</a>
          </div>
        </div>
        <div class="footer-credit"><span>© 2026 BirdieBuddy · Built by Ethan Brady</span><span>${note ? note : 'NFL · Private preview'}</span></div>
      </footer>`;
  };
})();
