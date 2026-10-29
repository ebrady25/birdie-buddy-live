/* =====================================================================
   BIRDIEBUDDY — BRAND CHROME (site root /)
   Header + footer for brand-level pages that sit above both products.
   Wears the NFL header's classes (nfl.css .nfl-nav / .nfl-footer) so the
   look matches, with brand links instead of the NFL menu. auth.js loads
   lazily, same pattern as nfl.js, for the account control.
   Also: BBI.brandHome() fills the live NFL week on the brand home from
   nfl/slate/slate.json (Eastern-time lock math as in nfl_home.js).
   Pages set <base href="/">.
   ===================================================================== */

window.BBI = window.BBI || {};

(() => {
  'use strict';

  const LINKS = [
    { href: 'nfl/', label: 'NFL' },
    { href: 'golf/', label: 'Golf' },
    { href: 'pricing.html', label: 'Membership' }
  ];
  const MARK = '<img class="brand-mark-img" src="assets/img/mark-gold.svg" alt="" width="52" height="26" />';

  window.BBI.renderBrandHeader = () => {
    const mount = document.getElementById('site-header');
    if (!mount) return;
    document.body.dataset.section = 'brand';
    mount.innerHTML = `
      <nav class="nfl-nav brand-nav" aria-label="BirdieBuddy">
        <div class="nfl-nav-inner">
          <a href="./" class="brand nfl-brand" aria-label="BirdieBuddy home">${MARK}<span class="brand-lockup">BirdieBuddy</span></a>
          <div class="nfl-links">
            ${LINKS.map(l => `<a class="nfl-link" href="${l.href}">${l.label}</a>`).join('')}
          </div>
          <div class="nfl-right"><span id="authControl" class="bbi-auth-ctl"></span></div>
        </div>
      </nav>`;

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

  window.BBI.renderBrandFooter = () => {
    const mount = document.getElementById('site-footer');
    if (!mount) return;
    mount.innerHTML = `
      <footer class="nfl-footer brand-footer">
        <div class="nfl-footer-inner">
          <div class="nfl-footer-brand">
            <a href="./" class="brand">${MARK}<span class="brand-lockup">BirdieBuddy</span></a>
            <p class="muted">DFS made simple: projections, ownership and playbooks in plain English. Not wagering advice.</p>
          </div>
          <div class="nfl-footer-links">
            <div class="footer-heading">NFL</div>
            <a class="footer-link" href="nfl/">NFL home</a>
            <a class="footer-link" href="nfl/slate/">This week</a>
            <a class="footer-link" href="nfl/projections/">Projections</a>
            <a class="footer-link" href="nfl/showdown/chill/">Showdown Chill</a>
            <a class="footer-link" href="nfl/results/">Results</a>
          </div>
          <div class="nfl-footer-links">
            <div class="footer-heading">BirdieBuddy</div>
            <a class="footer-link" href="golf/">Golf model</a>
            <a class="footer-link" href="pricing.html">Membership</a>
            <a class="footer-link" href="account.html">My account</a>
            <a class="footer-link" href="login.html">Sign in</a>
          </div>
        </div>
        <div class="footer-credit"><span>© 2026 BirdieBuddy</span><span>NFL · Golf</span></div>
        <div class="footer-legal"><nav class="footer-legal-links" aria-label="Legal"><a href="terms.html">Terms</a><span aria-hidden="true">·</span><a href="privacy.html">Privacy</a><span aria-hidden="true">·</span><a href="responsible-play.html">Responsible play</a></nav><p class="footer-legal-note">18+ (21+ where required). For information and entertainment only; not wagering advice. Not affiliated with DraftKings, the NFL or the PGA TOUR. Gambling problem? Call <a href="tel:+18004262537">1-800-GAMBLER</a>.</p></div>
      </footer>`;
  };

  /* ---------------- brand home: live NFL week + sign-in ---------------- */
  const STAGE = {
    tue: 'Early numbers', wed: 'Wednesday numbers', thu: 'Thursday numbers', fri: 'Friday final numbers',
    sat: 'Saturday numbers', sun_am: 'Sunday AM update', sun_check: 'Inactives update', sun_late: 'Sunday late update'
  };
  const H = 3600e3;
  // Eastern wall-clock time held in a Date's UTC fields (as in nfl_home.js)
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
  // Sunday 1 PM ET lock of the slate's week
  const lockOf = d => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + (7 - d.getUTCDay()) % 7, 13, 0));
  const setText = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };

  window.BBI.brandHome = () => {
    // Sign in opens the account modal when auth.js is up; the link to login.html is the fallback
    document.querySelectorAll('[data-brand-signin]').forEach(a => a.addEventListener('click', e => {
      if (window.BBI.auth && window.BBI.auth.openLogin) { e.preventDefault(); window.BBI.auth.openLogin(); }
    }));

    if (!window.fetch) return;
    fetch('nfl/slate/slate.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).then(slate => {
      const W = slate && +slate.week;
      if (!W) return;
      const asof = parseET(slate.as_of), now = etNow();
      const lock = asof ? lockOf(asof) : null;
      const phase = !lock || !now ? 'live' : now < lock ? 'live' : now < new Date(lock.getTime() + 12 * H) ? 'in_play' : 'final';
      const card = phase === 'live' ? `Week ${W} · ${STAGE[slate.stage] || 'New numbers'}`
        : phase === 'in_play' ? `Week ${W} · Locked · Results Monday`
        : `Week ${W + 1} numbers Wednesday`;
      setText('heroBadgeText', phase === 'live' ? `Live · NFL Week ${W} · DraftKings` : `NFL ${card}`);
      setText('nflBadgeText', card);
    }).catch(() => {});
  };
})();
