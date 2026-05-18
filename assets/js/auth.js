/* =====================================================================
   BIRDIEBUDDY — AUTH + TIERED ENTITLEMENTS
   ---------------------------------------------------------------------
   Complete client-side user/login system with three paid tiers
   (Pro · All-Access · Sharp) plus Free. Provides:

     • account model + session (localStorage)
     • signup / login / logout, SHA-256 password hashing
     • header auth control (Sign in  ↔  account chip + menu)
     • login/signup modal (injected once, global)
     • declarative content gating via [data-gate="pro|all_access|sharp"]
     • a clean BACKEND SEAM so a real auth API + Stripe Checkout can be
       dropped in without touching pages (see BBI.auth.backend below)

   ⚠️  SECURITY — READ THIS
   This is a front-end entitlement layer. localStorage tier flags are
   PRESENTATIONAL and trivially editable by the user — they are NOT a
   security boundary. Real enforcement must live behind the backend
   (signed session + server-side entitlement checks + Stripe webhooks).
   The whole module is written against BBI.auth.backend so flipping to
   production = implement those 5 async methods. Until then it runs in
   "demo mode" and says so in the UI.
   ===================================================================== */

window.BBI = window.BBI || {};

(() => {
  'use strict';
  if (window.BBI.auth) return; // idempotent

  /* ---------------- TIER MODEL ---------------- */
  // rank is the entitlement ordering used by hasTier()/gating.
  const TIERS = {
    free: {
      key: 'free', rank: 0, name: 'Free', tagline: 'The honest scorecard',
      priceM: 0, priceY: 0, accent: 'var(--text-muted)',
      features: [
        'Public BBI Scorecard (full track record)',
        '3 sample DFS lineups each week',
        'Top-20 rankings preview',
        'Weekly email'
      ]
    },
    pro: {
      key: 'pro', rank: 1, name: 'Pro', tagline: 'One sport, fully coached',
      priceM: 29, priceY: 199, accent: 'var(--info)',
      features: [
        'Everything in Free',
        'Full field rankings + factor decomposition',
        'All 12 DFS lineups + the "why" on every pick',
        'NIKE bankroll & contest plan',
        'Member community'
      ]
    },
    all_access: {
      key: 'all_access', rank: 2, name: 'All-Access', tagline: 'PGA + NFL, every tool',
      priceM: 39, priceY: 399, accent: 'var(--gold-500)', popular: true,
      features: [
        'Everything in Pro',
        'Both sports: PGA + NFL DFS',
        'Lineup optimizer + late-swap assistant',
        'THEMIS simulator access',
        'VIP community room'
      ]
    },
    sharp: {
      key: 'sharp', rank: 3, name: 'Sharp', tagline: 'The edge, unfiltered',
      priceM: 79, priceY: 699, accent: 'var(--positive)',
      features: [
        'Everything in All-Access',
        'Earliest model release (Mon AM)',
        'Calibrated-leverage tools + raw model/data exports',
        'Private Sharp room + priority support',
        'Founding-member pricing locked for life'
      ]
    }
  };
  const PAID = ['pro', 'all_access', 'sharp'];
  const tierOf = k => TIERS[k] || TIERS.free;

  /* ---------------- STORAGE ---------------- */
  const LS_USERS = 'bbi_auth_users_v1';
  const LS_SESSION = 'bbi_auth_session_v1';
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k)    { try { localStorage.removeItem(k); } catch {} }
  };

  async function sha256(str) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('bbi::' + str));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fallback if SubtleCrypto unavailable (e.g. file:// on some browsers).
      let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
      return 'weak:' + (h >>> 0).toString(16);
    }
  }

  /* ---------------- BACKEND SEAM ----------------
     Replace these 5 methods with real API calls to go to production.
     Each returns/throws the same shapes the demo does. Pages never call
     storage directly — they only call BBI.auth.* which calls backend.* */
  const demoBackend = {
    mode: 'demo',
    async signup({ email, password, name }) {
      const users = store.get(LS_USERS, {});
      email = email.trim().toLowerCase();
      if (!email || !password) throw new Error('Email and password are required.');
      if (users[email]) throw new Error('An account with that email already exists.');
      users[email] = { name: name || email.split('@')[0], hash: await sha256(password),
                        tier: 'free', created: new Date().toISOString() };
      store.set(LS_USERS, users);
      return { email, name: users[email].name, tier: 'free' };
    },
    async login({ email, password }) {
      const users = store.get(LS_USERS, {});
      email = email.trim().toLowerCase();
      const u = users[email];
      if (!u || u.hash !== await sha256(password)) throw new Error('Invalid email or password.');
      return { email, name: u.name, tier: u.tier || 'free' };
    },
    async checkout({ email, tier, cycle }) {
      // PRODUCTION: redirect to Stripe Checkout for {tier, cycle}; entitlement
      // is set by the Stripe webhook server-side. DEMO: grant immediately.
      const users = store.get(LS_USERS, {});
      if (users[email]) { users[email].tier = tier; store.set(LS_USERS, users); }
      return { email, tier, cycle, simulated: true };
    },
    async portal({ email }) {            // PRODUCTION: Stripe billing portal URL
      return { url: null, simulated: true };
    },
    async session() {                    // PRODUCTION: verify signed cookie/JWT
      return store.get(LS_SESSION, null);
    }
  };

  /* ---------------- CORE STATE ---------------- */
  const listeners = new Set();
  let current = null; // {email,name,tier}

  const emit = () => { listeners.forEach(fn => { try { fn(current); } catch {} });
                       applyGates(); renderHeaderControl(); };

  const auth = {
    TIERS, PAID, backend: demoBackend,
    user: () => current,
    tier: () => tierOf(current?.tier).key,
    isLoggedIn: () => !!current,
    hasTier(min) { return tierOf(current?.tier).rank >= tierOf(min).rank; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async init() {
      const s = await this.backend.session();
      if (s && s.email) {
        // refresh tier from the user record so demo upgrades persist
        const users = store.get(LS_USERS, {});
        current = { email: s.email, name: s.name || s.email,
                    tier: users[s.email]?.tier || s.tier || 'free' };
      }
      emit();
      return current;
    },
    async signup(data) {
      const u = await this.backend.signup(data);
      current = u; store.set(LS_SESSION, u); emit(); return u;
    },
    async login(data) {
      const u = await this.backend.login(data);
      current = u; store.set(LS_SESSION, u); emit(); return u;
    },
    logout() { current = null; store.del(LS_SESSION); emit(); },

    /** Start checkout for a tier. Demo grants immediately; prod → Stripe. */
    async subscribe(tier, cycle = 'year') {
      if (!current) { openModal('signup', { intentTier: tier, intentCycle: cycle }); return; }
      const r = await this.backend.checkout({ email: current.email, tier, cycle });
      current = { ...current, tier: r.tier }; store.set(LS_SESSION, current);
      emit(); toast(`You're on ${tierOf(r.tier).name}${r.simulated ? ' (demo)' : ''}.`);
      return r;
    },
    async manageBilling() {
      const r = await this.backend.portal({ email: current?.email });
      if (r.url) location.href = r.url;
      else toast('Billing portal is available once the payment backend is connected.');
    },
    openModal, openLogin: () => openModal('login'), openSignup: () => openModal('signup'),
    mountHeaderControl: renderHeaderControl,
    applyGates
  };
  window.BBI.auth = auth;

  /* ---------------- STYLES (self-injected, Pantheon tokens) ---------------- */
  function injectCSS() {
    if (document.getElementById('bbi-auth-css')) return;
    // Every var() carries a Pantheon fallback so the module is fully
    // self-contained: identical on pages with design-system.css, correct
    // on standalone vault pages without it. Fallbacks never override a
    // page's own token (they only apply when the var is undefined).
    const G5='var(--gold-500,#d4a843)', G4='var(--gold-400,#e6b94e)',
          G3='var(--gold-300,#f4c863)', G6='var(--gold-600,#b08828)',
          BG='var(--border-gold,rgba(212,168,67,.30))',
          BGS='var(--border-gold-strong,rgba(212,168,67,.55))',
          BB='var(--border-base,rgba(255,255,255,.08))',
          BST='var(--border-strong,rgba(255,255,255,.12))',
          BSF='var(--border-soft,rgba(255,255,255,.06))',
          S1='var(--surface-1,#0a0a0f)', S3='var(--surface-3,#141419)',
          S4='var(--surface-4,#1a1a22)', S5='var(--surface-5,#222230)',
          TP='var(--text-primary,#f4f4f8)', TB='var(--text-body,#c0c0cc)',
          TM='var(--text-muted,#8a8a98)', TD='var(--text-dimmed,#5a5a68)',
          TOG='var(--text-on-gold,#1a1408)', NEG='var(--negative,#f87171)',
          RMD='var(--radius-md,6px)', RLG='var(--radius-lg,8px)',
          RXL='var(--radius-xl,12px)', R2='var(--radius-2xl,16px)',
          RF='var(--radius-full,999px)',
          SXL='var(--shadow-xl,0 24px 50px -12px rgba(0,0,0,.7))',
          SLG='var(--shadow-lg,0 14px 30px -8px rgba(0,0,0,.6))',
          SGM='var(--shadow-gold-md,0 8px 22px -6px rgba(212,168,67,.3))',
          DF='var(--dur-fast,150ms)', DB='var(--dur-base,220ms)',
          EO='var(--ease-out,cubic-bezier(.16,1,.3,1))',
          ES='var(--ease-spring,cubic-bezier(.34,1.56,.64,1))',
          TW='var(--tracking-wide,.02em)',
          S2='var(--space-2,.5rem)', S3P='var(--space-3,.75rem)',
          S4P='var(--space-4,1rem)', S5P='var(--space-5,1.25rem)',
          S6P='var(--space-6,1.5rem)',
          F3X='var(--fs-3xs,.625rem)', F2X='var(--fs-2xs,.6875rem)',
          FXS='var(--fs-xs,.75rem)', FSM='var(--fs-sm,.8125rem)',
          FLG='var(--fs-lg,1.125rem)', FXL='var(--fs-xl,1.25rem)',
          ZM='var(--z-modal,1000)', ZT='var(--z-tooltip,2000)';
    const css = `
    @keyframes bbiFadeIn{from{opacity:0}to{opacity:1}}
    @keyframes bbiFadeDown{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
    @keyframes bbiScaleIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}
    @keyframes bbiFadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
    .bbi-auth-ctl{display:flex;align-items:center;gap:${S2}}
    .bbi-auth-btn{display:inline-flex;align-items:center;gap:6px;font-size:${F2X};
      font-weight:600;padding:6px 12px;border-radius:${RF};
      border:1px solid ${BG};color:${G5};
      background:rgba(212,168,67,.06);transition:all ${DF} ${EO}}
    .bbi-auth-btn:hover{background:rgba(212,168,67,.14);border-color:${BGS}}
    .bbi-auth-btn.ghost{border-color:${BB};color:${TB};background:transparent}
    .bbi-auth-btn.ghost:hover{color:${TP};border-color:${BST}}
    .bbi-chip{display:inline-flex;align-items:center;gap:8px;cursor:pointer;
      padding:5px 10px 5px 6px;border-radius:${RF};
      border:1px solid ${BB};background:${S3}}
    .bbi-chip:hover{border-color:${BG}}
    .bbi-ava{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;
      font-size:${F3X};font-weight:700;color:${TOG};
      background:linear-gradient(135deg,${G3},${G6})}
    .bbi-chip-tier{font-size:${F3X};font-weight:700;text-transform:uppercase;
      letter-spacing:${TW}}
    .bbi-menu{position:absolute;top:calc(100% + 8px);right:0;min-width:220px;
      background:${S4};border:1px solid ${BST};
      border-radius:${RLG};box-shadow:${SXL};padding:6px;
      z-index:${ZM};animation:bbiFadeDown ${DF} ${EO}}
    .bbi-menu[hidden]{display:none}
    .bbi-menu a,.bbi-menu button{display:flex;width:100%;align-items:center;gap:8px;
      justify-content:flex-start;padding:9px 10px;border-radius:${RMD};
      font-size:${FXS};color:${TB};text-align:left}
    .bbi-menu a:hover,.bbi-menu button:hover{background:${S5};color:${TP}}
    .bbi-menu-head{padding:10px;border-bottom:1px solid ${BSF};margin-bottom:4px}
    .bbi-menu-head b{display:block;color:${TP};font-size:${FSM}}
    .bbi-menu-head span{font-size:${F3X};color:${TM}}
    .bbi-ovl{position:fixed;inset:0;background:rgba(4,4,8,.78);backdrop-filter:blur(4px);
      z-index:${ZM};display:grid;place-items:center;padding:${S4P};
      animation:bbiFadeIn ${DF} ${EO}}
    .bbi-ovl[hidden]{display:none}
    .bbi-modal{width:100%;max-width:420px;background:${S3};
      border:1px solid ${BST};border-radius:${R2};
      box-shadow:${SXL};overflow:hidden;animation:bbiScaleIn ${DB} ${ES}}
    .bbi-modal-h{padding:${S6P} ${S6P} ${S4P}}
    .bbi-modal-h .eyebrow{margin-bottom:6px;font-size:${F2X};font-weight:600;
      text-transform:uppercase;letter-spacing:.14em;color:${G5}}
    .bbi-modal-h h3{font-size:${FXL};font-weight:700;color:${TP}}
    .bbi-tabs{display:flex;gap:4px;padding:0 ${S6P}}
    .bbi-tab{flex:1;padding:9px;font-size:${FXS};font-weight:600;
      color:${TM};border-bottom:2px solid transparent}
    .bbi-tab.on{color:${G5};border-color:${G5}}
    .bbi-form{padding:${S5P} ${S6P} ${S6P};display:grid;gap:${S3P}}
    .bbi-field label{display:block;font-size:${F3X};font-weight:600;
      text-transform:uppercase;letter-spacing:${TW};
      color:${TM};margin-bottom:5px}
    .bbi-field input{width:100%;padding:10px 12px;background:${S1};
      border:1px solid ${BB};border-radius:${RMD};
      color:${TP};font-size:${FSM}}
    .bbi-field input:focus{outline:none;border-color:${G5}}
    .bbi-submit{margin-top:4px;padding:11px;border-radius:${RMD};
      background:linear-gradient(135deg,${G4},${G6});
      color:${TOG};font-weight:700;font-size:${FSM};
      transition:filter ${DF}}
    .bbi-submit:hover{filter:brightness(1.08)}
    .bbi-submit[disabled]{opacity:.6;cursor:wait}
    .bbi-err{color:${NEG};font-size:${FXS};min-height:1em}
    .bbi-demo-note{font-size:${F3X};color:${TD};
      padding:0 ${S6P} ${S5P};line-height:1.5}
    .bbi-x{position:absolute;top:14px;right:14px;width:28px;height:28px;
      display:grid;place-items:center;border-radius:${RMD};
      color:${TM}}
    .bbi-x:hover{background:${S5};color:${TP}}
    .bbi-locked{position:relative}
    .bbi-locked > .bbi-lock-content{filter:blur(7px);pointer-events:none;user-select:none}
    .bbi-lock-ovl{position:absolute;inset:0;display:grid;place-items:center;
      text-align:center;padding:${S6P};z-index:2}
    .bbi-lock-card{max-width:340px;background:${S4};
      border:1px solid ${BG};border-radius:${RXL};
      padding:${S6P};box-shadow:${SGM}}
    .bbi-lock-card .eyebrow{margin-bottom:8px;font-size:${F2X};font-weight:600;
      text-transform:uppercase;letter-spacing:.14em;color:${G5}}
    .bbi-lock-card h4{font-size:${FLG};color:${TP};margin-bottom:6px}
    .bbi-lock-card p{font-size:${FXS};color:${TM};margin-bottom:${S4P}}
    .bbi-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
      background:${S5};border:1px solid ${BG};
      color:${TP};font-size:${FXS};padding:10px 18px;
      border-radius:${RF};box-shadow:${SLG};
      z-index:${ZT};animation:bbiFadeUp ${DB} ${EO}}
    .bbi-toast[hidden]{display:none}
    `;
    const s = document.createElement('style');
    s.id = 'bbi-auth-css'; s.textContent = css;
    document.head.appendChild(s);
  }

  /* ---------------- MODAL ---------------- */
  let modalEl, modalIntent = {};
  function buildModal() {
    if (modalEl) return;
    modalEl = document.createElement('div');
    modalEl.className = 'bbi-ovl'; modalEl.hidden = true;
    modalEl.innerHTML = `
      <div class="bbi-modal" role="dialog" aria-modal="true" aria-label="Account">
        <button class="bbi-x" data-act="close" aria-label="Close">✕</button>
        <div class="bbi-modal-h">
          <div class="eyebrow">BirdieBuddy</div>
          <h3 data-el="title">Sign in</h3>
        </div>
        <div class="bbi-tabs">
          <button class="bbi-tab" data-tab="login">Sign in</button>
          <button class="bbi-tab" data-tab="signup">Create account</button>
        </div>
        <form class="bbi-form" data-el="form" novalidate>
          <div class="bbi-field" data-el="nameField" hidden>
            <label>Name</label><input name="name" autocomplete="name" />
          </div>
          <div class="bbi-field">
            <label>Email</label>
            <input name="email" type="email" autocomplete="email" required />
          </div>
          <div class="bbi-field">
            <label>Password</label>
            <input name="password" type="password" autocomplete="current-password" required />
          </div>
          <div class="bbi-err" data-el="err" role="alert"></div>
          <button class="bbi-submit" type="submit" data-el="submit">Sign in</button>
        </form>
        <div class="bbi-demo-note" data-el="note"></div>
      </div>`;
    document.body.appendChild(modalEl);

    const q = s => modalEl.querySelector(s);
    const form = q('[data-el="form"]');
    let mode = 'login';

    const setMode = m => {
      mode = m;
      modalEl.querySelectorAll('.bbi-tab').forEach(t =>
        t.classList.toggle('on', t.dataset.tab === m));
      q('[data-el="title"]').textContent = m === 'login' ? 'Welcome back' : 'Create your account';
      q('[data-el="nameField"]').hidden = m === 'login';
      q('[data-el="submit"]').textContent = m === 'login' ? 'Sign in' : 'Create account';
      q('[data-el="err"]').textContent = '';
      q('[data-el="note"]').innerHTML = auth.backend.mode === 'demo'
        ? `Demo mode — accounts are stored only in this browser. No payment is taken; tier upgrades are simulated until the billing backend is connected.`
        : '';
    };
    modalEl.querySelectorAll('.bbi-tab').forEach(t =>
      t.addEventListener('click', () => setMode(t.dataset.tab)));
    modalEl.addEventListener('click', e => {
      if (e.target === modalEl || e.target.closest('[data-act="close"]')) closeModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !modalEl.hidden) closeModal();
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = q('[data-el="submit"]'), err = q('[data-el="err"]');
      const fd = new FormData(form);
      const data = { email: fd.get('email'), password: fd.get('password'),
                     name: fd.get('name') };
      btn.disabled = true; err.textContent = '';
      try {
        if (mode === 'signup') await auth.signup(data);
        else await auth.login(data);
        closeModal();
        if (modalIntent.intentTier) {
          await auth.subscribe(modalIntent.intentTier, modalIntent.intentCycle || 'year');
        }
        modalIntent = {};
      } catch (ex) {
        err.textContent = ex.message || 'Something went wrong.';
      } finally { btn.disabled = false; }
    });

    modalEl._setMode = setMode;
  }
  function openModal(mode = 'login', intent = {}) {
    injectCSS(); buildModal();
    modalIntent = intent;
    modalEl._setMode(mode);
    modalEl.hidden = false;
    setTimeout(() => modalEl.querySelector('input[name="email"]')?.focus(), 30);
  }
  function closeModal() { if (modalEl) modalEl.hidden = true; }

  /* ---------------- TOAST ---------------- */
  let toastTimer;
  function toast(msg) {
    injectCSS();
    let t = document.getElementById('bbi-toast');
    if (!t) { t = document.createElement('div'); t.id = 'bbi-toast';
              t.className = 'bbi-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  /* ---------------- HEADER CONTROL ---------------- */
  function renderHeaderControl() {
    const mount = document.getElementById('authControl');
    if (!mount) return;
    injectCSS();
    if (!current) {
      mount.innerHTML = `
        <div class="bbi-auth-ctl">
          <button class="bbi-auth-btn ghost" data-auth="login">Sign in</button>
          <a class="bbi-auth-btn" href="pricing.html">Get BirdieBuddy</a>
        </div>`;
      mount.querySelector('[data-auth="login"]')
           .addEventListener('click', () => openModal('login'));
      return;
    }
    const t = tierOf(current.tier);
    const initials = (current.name || current.email).trim()[0]?.toUpperCase() || 'B';
    mount.innerHTML = `
      <div class="bbi-auth-ctl" style="position:relative">
        <div class="bbi-chip" data-auth="menu" tabindex="0" role="button" aria-haspopup="true">
          <span class="bbi-ava">${initials}</span>
          <span class="bbi-chip-tier" style="color:${t.accent}">${t.name}</span>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
               stroke="currentColor" stroke-width="1.6" style="color:var(--text-muted)">
            <path d="M3 5l3 3 3-3" stroke-linecap="round"/></svg>
        </div>
        <div class="bbi-menu" data-el="menu" hidden>
          <div class="bbi-menu-head">
            <b>${escapeHtml(current.name || current.email)}</b>
            <span>${escapeHtml(current.email)} · ${t.name} plan</span>
          </div>
          <a href="account.html">⚙ Account &amp; billing</a>
          ${t.rank < 3 ? `<a href="pricing.html">★ Upgrade plan</a>` : ''}
          <button data-auth="logout">⎋ Sign out</button>
        </div>
      </div>`;
    const chip = mount.querySelector('[data-auth="menu"]');
    const menu = mount.querySelector('[data-el="menu"]');
    const toggle = () => { menu.hidden = !menu.hidden; };
    chip.addEventListener('click', toggle);
    chip.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    mount.querySelector('[data-auth="logout"]')
         .addEventListener('click', () => { auth.logout();
           toast('Signed out.'); });
    document.addEventListener('click', e => {
      if (!e.target.closest('#authControl')) menu.hidden = true;
    });
  }

  /* ---------------- CONTENT GATING ----------------
     Any element: <section data-gate="all_access"> … </section>
     If the user's tier rank < required, the content is blurred and an
     upgrade card is overlaid. Idempotent + re-applied on auth change. */
  function applyGates() {
    injectCSS();
    document.querySelectorAll('[data-gate]').forEach(node => {
      const need = node.getAttribute('data-gate');
      const ok = auth.hasTier(need);
      const already = node.classList.contains('bbi-locked');
      if (ok) {
        if (already) { // unlock
          node.classList.remove('bbi-locked');
          node.querySelector(':scope > .bbi-lock-ovl')?.remove();
          const c = node.querySelector(':scope > .bbi-lock-content');
          if (c) { while (c.firstChild) node.appendChild(c.firstChild); c.remove(); }
        }
        return;
      }
      if (already) return;
      const t = tierOf(need);
      const wrap = document.createElement('div');
      wrap.className = 'bbi-lock-content';
      while (node.firstChild) wrap.appendChild(node.firstChild);
      node.appendChild(wrap);
      const ovl = document.createElement('div');
      ovl.className = 'bbi-lock-ovl';
      ovl.innerHTML = `
        <div class="bbi-lock-card">
          <div class="eyebrow">${t.name} feature</div>
          <h4>Unlock this with ${t.name}</h4>
          <p>${escapeHtml(node.getAttribute('data-gate-msg') ||
              (t.name + ' members get ' + t.tagline.toLowerCase() + '.'))}</p>
          <a class="bbi-auth-btn" href="pricing.html">See plans — from $${t.priceM}/mo</a>
        </div>`;
      node.classList.add('bbi-locked');
      node.appendChild(ovl);
    });
  }

  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* ---------------- BOOT ---------------- */
  function boot() { injectCSS(); auth.init(); }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
