/* =========================================================================
   BIRDIEBUDDY — EMAIL SIGNUPS (founding list, free newsletter, MCP waitlist)
   Added 2026-11-04. Any element <form data-bb-signup="SOURCE"> with an
   <input type="email"> becomes a signup box: one insert into the Supabase
   table public.newsletter_signups (insert-only RLS: the browser can add an
   email, never read one). SQL: cf_functions_draft/supabase/newsletter_signups.sql.
   SIGNUP_LIVE stays false until that SQL has run; while false every signup
   form stays hidden and its [data-bb-signup-off] fallback shows instead.
   No third-party script, no cookie, no tracking: email + source + page only.
   ========================================================================= */
(function () {
  'use strict';
  const SIGNUP_LIVE = false;
  const URL_ = 'https://mooqbndhgsuatxlkmlrq.supabase.co/rest/v1/newsletter_signups';
  const KEY = 'sb_publishable_zVvQoQNxnStWCeRgqg9Dlg_LhTcengq';   // publishable key (public by design), same as auth.js
  const OK_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const SOURCES = ['founding', 'newsletter', 'mcp'];

  async function signup(email, source) {
    email = String(email || '').trim().toLowerCase();
    if (!OK_RX.test(email) || email.length > 254) return { ok: false, msg: 'That email doesn’t look right.' };
    if (!SOURCES.includes(source)) source = 'newsletter';
    try {
      const r = await fetch(URL_, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ email, source, page: location.pathname.slice(0, 200) })
      });
      if (r.ok || r.status === 409) return { ok: true, again: r.status === 409 };
      return { ok: false, msg: 'Couldn’t save that just now. Please try again in a minute.' };
    } catch (e) {
      return { ok: false, msg: 'Couldn’t reach our server. Check your connection and try again.' };
    }
  }

  const DONE = {
    founding: 'You’re on the founding list. We’ll email you when memberships open, with founding pricing locked in.',
    newsletter: 'You’re in. The next first look lands Wednesday evening.',
    mcp: 'You’re on the waitlist. We’ll email you when the BirdieBuddy connector opens.'
  };

  function wire(form) {
    const source = form.getAttribute('data-bb-signup');
    const input = form.querySelector('input[type="email"]');
    const btn = form.querySelector('button[type="submit"], button:not([type])');
    const msg = form.querySelector('[data-bb-signup-msg]');
    const trap = form.querySelector('input[name="website"]');        // honeypot: bots fill it, people never see it
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (trap && trap.value) return;
      if (btn) btn.disabled = true;
      const r = await signup(input && input.value, source);
      if (btn) btn.disabled = false;
      if (msg) { msg.textContent = r.ok ? (r.again ? 'You’re already on the list. Thanks!' : DONE[source] || DONE.newsletter) : r.msg; msg.dataset.state = r.ok ? 'ok' : 'err'; }
      if (r.ok) { form.classList.add('bb-signup-done'); if (input) input.value = ''; }
    });
  }

  function init() {
    document.querySelectorAll('[data-bb-signup]').forEach(f => { f.hidden = !SIGNUP_LIVE; if (SIGNUP_LIVE) wire(f); });
    document.querySelectorAll('[data-bb-signup-off]').forEach(el => { el.hidden = SIGNUP_LIVE; });
  }
  window.BBI = window.BBI || {};
  window.BBI.signup = { live: SIGNUP_LIVE, submit: signup, init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
