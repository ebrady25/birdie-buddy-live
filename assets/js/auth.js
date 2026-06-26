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

  /* ---------------- DISCOUNT / COMP CODES ----------------
     Codes match case- and whitespace-insensitively ("Lock City" == "LOCKCITY");
     `label` is the canonical display form. A code with `grantsTier` is a 100%-off
     comp that unlocks that tier permanently at signup — granted server-side by the
     redeem_promo() Supabase function (the client can't set its own tier). A code
     without grantsTier is a percentage/Stripe discount applied at checkout (billing
     not live yet). The grant map is mirrored server-side in redeem_promo; keep them
     in sync when adding codes. */
  const PROMO_CODES = {
    LOCKCITY: { label: 'LockCity', kind: 'Friends & Family', grantsTier: 'sharp',
                note: "Full access unlocked — free, forever. Welcome in." }
  };
  const normalizePromo = c => (c || '').trim().toUpperCase().replace(/\s+/g, '');
  const lookupPromo = c => PROMO_CODES[normalizePromo(c)] || null;

  /* ---------------- PAGE ENTITLEMENTS ----------------
     SINGLE SOURCE OF TRUTH for which pages require which tier. The router
     (applyPageGate) reads this and gates the page's [data-gate-region] —
     or its <main> if no region is marked — by stamping data-gate, which
     applyGates() then renders (blur + upgrade overlay). Pages NOT listed
     are free. simulator.html is Pro-gated at the page level; paid tiers also get
     the in-page contest-bucket gating (Large/Mass=All-Access). */
  const PAGE_TIERS = {
    'rankings.html': 'pro',
    'lineups.html':  'pro',
    'live.html':     'pro',
    'compare.html':  'pro',
    'simulator.html':'pro',
    'market.html':   'all_access'
  };
  const PAGE_GATE_MSG = {
    'lineups.html': 'The 12 optimized DFS lineups — with the reasoning on every pick — are a Pro feature.',
    'live.html':    'Live Thursday–Sunday pivots and late-swap calls are a Pro feature.',
    'compare.html': 'Head-to-head player comparison is a Pro feature.',
    'simulator.html': 'The THEMIS DFS simulator — build leverage-tilted lineup portfolios against live projections — is a Pro feature.',
    'market.html':  'Market edges, devig, and Kelly staking are an All-Access feature.'
  };
  const currentPageName = () => (location.pathname.split('/').pop() || '') || 'index.html';

  /* ---------------- STORAGE ---------------- */
  const LS_USERS = 'bbi_auth_users_v1';
  const LS_SESSION = 'bbi_auth_session_v1';
  const LS_PROMO = 'bbi_auth_promo_v1';   // last applied promo code (drives applyPromoGrant)
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

  /* ---------------- SUPABASE BACKEND (LIVE) ----------------
     Real auth against Supabase. Implements the same 5-method seam the demo
     does, so flipping `backend` below is the only switch. Identity + tier are
     server-truth: tier lives in public.profiles (RLS: a user reads only their
     own row) and is set by the Stripe webhook, never by the client.
     Public config only — the anon/publishable key is safe in the browser;
     the service-role key lives ONLY in the Vercel /api functions.            */
  const SUPABASE_URL      = 'https://mooqbndhgsuatxlkmlrq.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_zVvQoQNxnStWCeRgqg9Dlg_LhTcengq';
  const API_BASE          = 'https://vercel-app-beige-psi.vercel.app';
  const SUPABASE_JS_CDN   = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  const VALID_TIERS       = ['free', 'pro', 'all_access', 'sharp'];

  // Lazy-load supabase-js once and memoize a single client (avoids the
  // multiple-GoTrueClient warning). Resolves to the client.
  let _sbPromise = null;
  function getSupabase() {
    if (_sbPromise) return _sbPromise;
    _sbPromise = new Promise((resolve, reject) => {
      const make = () => {
        if (window.supabase?.createClient)
          resolve(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
        else reject(new Error('Auth library failed to initialize.'));
      };
      if (window.supabase?.createClient) return make();
      const s = document.createElement('script');
      s.src = SUPABASE_JS_CDN; s.async = true;
      s.onload = make;
      s.onerror = () => reject(new Error('Could not load the auth library.'));
      document.head.appendChild(s);
    });
    return _sbPromise;
  }

  async function fetchTier(sb, userId) {
    const { data } = await sb.from('profiles').select('tier').eq('id', userId).single();
    return VALID_TIERS.includes(data?.tier) ? data.tier : 'free';
  }
  const friendlyAuthErr = m =>
    /invalid login credentials/i.test(m) ? 'Invalid email or password.' : m;

  const supabaseBackend = {
    mode: 'live',
    async signup({ email, password, name, promo }) {
      email = (email || '').trim().toLowerCase();
      if (!email || !password) throw new Error('Email and password are required.');
      const sb = await getSupabase();
      const fallbackName = name || email.split('@')[0];
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { name: fallbackName, ...(promo ? { promo } : {}) } }
      });
      if (error) throw new Error(error.message);
      // With email confirmation ON, no session is returned until the user
      // confirms. Signal that so the UI prompts "check your email".
      if (!data.session) return { email, name: fallbackName, tier: 'free', needsConfirmation: true };
      return { email, name: fallbackName, tier: await fetchTier(sb, data.user.id) };
    },
    async login({ email, password }) {
      email = (email || '').trim().toLowerCase();
      const sb = await getSupabase();
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(friendlyAuthErr(error.message));
      const name = data.user.user_metadata?.name || email.split('@')[0];
      return { email, name, tier: await fetchTier(sb, data.user.id) };
    },
    async checkout() {
      // Stripe is not wired yet — never grant a paid tier without payment.
      const e = new Error("Checkout isn't live yet — payments are coming soon.");
      e.code = 'billing_unavailable';
      throw e;
    },
    async portal() { return { url: null }; },          // Stripe billing portal (later)
    async session() {
      const sb = await getSupabase();
      const { data: { session } } = await sb.auth.getSession();
      if (!session?.user) return null;
      const email = session.user.email;
      const name = session.user.user_metadata?.name || email?.split('@')[0] || email;
      let tier = 'free';
      try { tier = await fetchTier(sb, session.user.id); }
      catch { tier = store.get(LS_SESSION, {})?.tier || 'free'; } // keep last-known on transient failure
      return { email, name, tier };
    },
    async signOut() { try { (await getSupabase()).auth.signOut(); } catch {} },
    // Redeem a comp code server-side (SECURITY DEFINER fn). Returns the granted
    // tier (e.g. 'sharp') or null for a non-granting/unknown code. Requires a session.
    async redeemPromo(code) {
      const sb = await getSupabase();
      const { data, error } = await sb.rpc('redeem_promo', { p_code: code });
      if (error) throw new Error(error.message);
      return data || null;
    },
    async accessToken() {
      const sb = await getSupabase();
      const { data: { session } } = await sb.auth.getSession();
      return session?.access_token || null;
    }
  };

  /* ---------------- BACKEND SEAM ----------------
     Replace these 5 methods with real API calls to go to production.
     Each returns/throws the same shapes the demo does. Pages never call
     storage directly — they only call BBI.auth.* which calls backend.* */
  const demoBackend = {
    mode: 'demo',
    async signup({ email, password, name, promo }) {
      const users = store.get(LS_USERS, {});
      email = email.trim().toLowerCase();
      if (!email || !password) throw new Error('Email and password are required.');
      if (users[email]) throw new Error('An account with that email already exists.');
      users[email] = { name: name || email.split('@')[0], hash: await sha256(password),
                        tier: 'free', promo: promo || null, created: new Date().toISOString() };
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
    },
    async redeemPromo(code) {            // DEMO: grant the comp tier locally
      const p = lookupPromo(code);
      if (!p?.grantsTier) return null;
      const email = (current?.email || '').trim().toLowerCase();
      const users = store.get(LS_USERS, {});
      if (users[email]) { users[email].tier = p.grantsTier; store.set(LS_USERS, users); }
      return p.grantsTier;
    }
  };

  /* ---------------- CORE STATE ---------------- */
  const listeners = new Set();
  let current = null; // {email,name,tier}

  const emit = () => { listeners.forEach(fn => { try { fn(current); } catch {} });
                       applyPageGate(); applyGates(); renderHeaderControl(); };

  const auth = {
    TIERS, PAID, PROMO_CODES, backend: supabaseBackend, API_BASE,
    validatePromo: lookupPromo,
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
        store.set(LS_SESSION, current);
      } else {
        // No valid backend session — drop any stale synchronously-seeded state.
        current = null; store.del(LS_SESSION);
      }
      emit();
      await this.applyPromoGrant();   // self-heal a pending comp-code grant
      return current;
    },
    async signup(data) {
      const raw = (data.promo || '').trim();
      const promo = lookupPromo(raw);
      if (raw && !promo) throw new Error("That discount code isn't valid — leave it blank if you don't have one.");
      const u = await this.backend.signup({ ...data, promo: promo?.label });
      if (promo) { store.set(LS_PROMO, { code: normalizePromo(raw), label: promo.label, kind: promo.kind }); u.promo = promo.label; }
      if (u && u.needsConfirmation) return u;  // grant applied on first login (see init)
      current = u; store.set(LS_SESSION, u); emit();
      await this.applyPromoGrant();            // 100%-off comp codes unlock their tier now
      return current;
    },
    // Redeem a comp code that grants a tier, if it would upgrade the user.
    // Idempotent + self-healing; the grant is server-enforced (redeem_promo) so it
    // persists across devices and sessions. Uses the code stored on THIS browser
    // (LS_PROMO) when present; on explicit login (useMetadata) a free user also lets
    // the server check the code saved in their signup metadata — covers the case of
    // confirming/logging in on a different device than they signed up on.
    async applyPromoGrant({ useMetadata = false } = {}) {
      if (!current) return;
      const stored = store.get(LS_PROMO, null);
      const localCode = (stored && lookupPromo(stored.code)?.grantsTier) ? stored.code : null;
      const code = localCode != null ? localCode
                 : (useMetadata && tierOf(current.tier).key === 'free') ? '' : null;
      if (code === null) return;
      try {
        const granted = await this.backend.redeemPromo(code);
        if (granted && tierOf(granted).rank > tierOf(current.tier).rank) {
          current = { ...current, tier: granted };
          store.set(LS_SESSION, current); emit();
        }
      } catch (e) { /* keep LS_PROMO and retry next session; never block auth */ }
    },
    async login(data) {
      const u = await this.backend.login(data);
      current = u; store.set(LS_SESSION, u); emit();
      await this.applyPromoGrant({ useMetadata: true });   // unlock a pending comp grant on login
      return current;
    },
    logout() {
      this.backend.signOut?.();
      current = null; store.del(LS_SESSION); emit();
    },

    /** Start checkout for a tier. Demo grants immediately; prod → Stripe. */
    async subscribe(tier, cycle = 'year') {
      if (!current) { openModal('signup', { intentTier: tier, intentCycle: cycle }); return; }
      try {
        const r = await this.backend.checkout({ email: current.email, tier, cycle });
        if (r?.url) { location.href = r.url; return r; }          // real Stripe redirect (later)
        if (r?.tier) {                                            // demo immediate grant
          current = { ...current, tier: r.tier }; store.set(LS_SESSION, current);
          emit(); toast(`You're on ${tierOf(r.tier).name}${r.simulated ? ' (demo)' : ''}.`);
        }
        return r;
      } catch (e) {
        if (e.code === 'billing_unavailable') { toast(e.message); return; }
        throw e;
      }
    },

    /** Authenticated read of the gated rankings backend. Sends the user's
        Supabase token so Pro+ callers get full_json; free/anon get the teaser.
        Returns the /api/rankings JSON envelope { event, tier, gated, data }. */
    async fetchRankings(eventSlug) {
      const token = await this.backend.accessToken?.();
      const res = await fetch(
        `${API_BASE}/api/rankings?event=${encodeURIComponent(eventSlug)}`,
        token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
      );
      if (!res.ok) throw new Error(`Rankings unavailable (${res.status}).`);
      return res.json();
    },

    /** Normalize the /api/rankings `data` payload into a uniform rankings
        object { players:[], rankings:[], ...meta }. Resilient to a stringified
        payload or a bare array (tolerates pre-contract-fix snapshots; stays
        correct once the snapshot is a native object per SNAPSHOT_CONTRACT). */
    normalizeRankings(data) {
      if (data == null) return null;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { return null; } }
      if (Array.isArray(data)) data = { players: data.slice(), rankings: data.slice(), teaser: true };
      if (!data.players  && data.rankings) data.players  = data.rankings;
      if (!data.rankings && data.players)  data.rankings = data.players;
      return data;
    },

    /** High-level loader the rankings pages call: fetch + normalize.
        Returns { event, week, year, tier, gated, rank } where `rank` is the
        uniform object the pages already expect (rank.players / rank.rankings). */
    async loadRankings(eventSlug) {
      const env = await this.fetchRankings(eventSlug);
      return {
        event: env.event, week: env.week, year: env.year,
        tier: env.tier, gated: env.gated,
        rank: this.normalizeRankings(env.data)
      };
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
    const css = `
    .bbi-auth-ctl{display:flex;align-items:center;gap:var(--space-2)}
    .bbi-auth-btn{display:inline-flex;align-items:center;gap:6px;font-size:var(--fs-2xs,11px);
      font-weight:700;padding:7px 14px;border-radius:var(--radius-full,999px);
      border:1px solid transparent;color:#15100a;white-space:nowrap;
      background:var(--gold-500,#d4a843);transition:all var(--dur-fast,.16s) var(--ease-out,ease);text-decoration:none;cursor:pointer}
    .bbi-auth-btn:hover{background:var(--gold-300,#e8c878);filter:brightness(1.03)}
    .bbi-auth-btn.ghost{border:1px solid var(--border-base,rgba(243,238,223,.14));color:var(--text-body,#cfc8b6);background:transparent;font-weight:600}
    .bbi-auth-btn.ghost:hover{color:var(--gold-300,#e8c878);border-color:var(--gold-500,#d4a843);background:rgba(212,168,67,.06)}
    .bbi-chip{display:inline-flex;align-items:center;gap:8px;cursor:pointer;
      padding:5px 10px 5px 6px;border-radius:var(--radius-full);
      border:1px solid var(--border-base);background:var(--surface-3)}
    .bbi-chip:hover{border-color:var(--border-gold)}
    .bbi-ava{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;
      font-size:var(--fs-3xs);font-weight:700;color:var(--text-on-gold);
      background:linear-gradient(135deg,var(--gold-300),var(--gold-600))}
    .bbi-chip-tier{font-size:var(--fs-3xs);font-weight:700;text-transform:uppercase;
      letter-spacing:var(--tracking-wide)}
    .bbi-menu{position:absolute;top:calc(100% + 8px);right:0;min-width:220px;
      background:var(--surface-4);border:1px solid var(--border-strong);
      border-radius:var(--radius-lg);box-shadow:var(--shadow-xl);padding:6px;
      z-index:var(--z-modal,1000);animation:fadeDown var(--dur-fast) var(--ease-out)}
    .bbi-menu[hidden]{display:none}
    .bbi-menu a,.bbi-menu button{display:flex;width:100%;align-items:center;gap:8px;
      justify-content:flex-start;padding:9px 10px;border-radius:var(--radius-md);
      font-size:var(--fs-xs);color:var(--text-body);text-align:left}
    .bbi-menu a:hover,.bbi-menu button:hover{background:var(--surface-5);color:var(--text-primary)}
    .bbi-menu-head{padding:10px;border-bottom:1px solid var(--border-soft);margin-bottom:4px}
    .bbi-menu-head b{display:block;color:var(--text-primary);font-size:var(--fs-sm)}
    .bbi-menu-head span{font-size:var(--fs-3xs);color:var(--text-muted)}
    .bbi-ovl{position:fixed;inset:0;background:rgba(4,4,8,.78);backdrop-filter:blur(4px);
      z-index:var(--z-modal,1000);display:grid;place-items:center;padding:var(--space-4);
      animation:fadeIn var(--dur-fast) var(--ease-out)}
    .bbi-ovl[hidden]{display:none}
    .bbi-modal{width:100%;max-width:420px;background:var(--surface-3);
      border:1px solid var(--border-strong);border-radius:var(--radius-2xl);
      box-shadow:var(--shadow-xl);overflow:hidden;animation:scaleIn var(--dur-base) var(--ease-spring)}
    .bbi-modal-h{padding:var(--space-6) var(--space-6) var(--space-4)}
    .bbi-modal-h .eyebrow{margin-bottom:6px}
    .bbi-modal-h h3{font-size:var(--fs-xl);font-weight:700;color:var(--text-primary)}
    .bbi-tabs{display:flex;gap:4px;padding:0 var(--space-6)}
    .bbi-tab{flex:1;padding:9px;font-size:var(--fs-xs);font-weight:600;
      color:var(--text-muted);border-bottom:2px solid transparent}
    .bbi-tab.on{color:var(--gold-500);border-color:var(--gold-500)}
    .bbi-form{padding:var(--space-5) var(--space-6) var(--space-6);display:grid;gap:var(--space-3)}
    .bbi-field label{display:block;font-size:var(--fs-3xs);font-weight:600;
      text-transform:uppercase;letter-spacing:var(--tracking-wide);
      color:var(--text-muted);margin-bottom:5px}
    .bbi-field input{width:100%;padding:10px 12px;background:var(--surface-1);
      border:1px solid var(--border-base);border-radius:var(--radius-md);
      color:var(--text-primary);font-size:var(--fs-sm)}
    .bbi-field input:focus{outline:none;border-color:var(--gold-500)}
    .bbi-submit{margin-top:4px;padding:11px;border-radius:var(--radius-md);
      background:linear-gradient(135deg,var(--gold-400),var(--gold-600));
      color:var(--text-on-gold);font-weight:700;font-size:var(--fs-sm);
      transition:filter var(--dur-fast)}
    .bbi-submit:hover{filter:brightness(1.08)}
    .bbi-submit[disabled]{opacity:.6;cursor:wait}
    .bbi-err{color:var(--negative);font-size:var(--fs-xs);min-height:1em}
    .bbi-demo-note{font-size:var(--fs-3xs);color:var(--text-dimmed);
      padding:0 var(--space-6) var(--space-5);line-height:1.5}
    .bbi-x{position:absolute;top:14px;right:14px;width:28px;height:28px;
      display:grid;place-items:center;border-radius:var(--radius-md);
      color:var(--text-muted)}
    .bbi-x:hover{background:var(--surface-5);color:var(--text-primary)}
    .bbi-locked{position:relative}
    .bbi-locked > .bbi-lock-content{filter:blur(7px);pointer-events:none;user-select:none}
    /* Overlay spans the whole gated region; the card sticks just below the
       nav so the upgrade CTA stays in view on tall, async-loading regions. */
    .bbi-lock-ovl{position:absolute;inset:0;display:flex;justify-content:center;
      align-items:flex-start;text-align:center;padding:var(--space-8) var(--space-6);
      pointer-events:none;z-index:2}
    .bbi-lock-card{position:sticky;top:calc(var(--nav-h, 64px) + 24px);
      pointer-events:auto;max-width:340px;background:var(--surface-4);
      border:1px solid var(--border-gold);border-radius:var(--radius-xl);
      padding:var(--space-6);box-shadow:var(--shadow-gold-md)}
    .bbi-lock-card .eyebrow{margin-bottom:8px}
    .bbi-lock-card h4{font-size:var(--fs-lg);color:var(--text-primary);margin-bottom:6px}
    .bbi-lock-card p{font-size:var(--fs-xs);color:var(--text-muted);margin-bottom:var(--space-4)}
    .bbi-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
      background:var(--surface-5);border:1px solid var(--border-gold);
      color:var(--text-primary);font-size:var(--fs-xs);padding:10px 18px;
      border-radius:var(--radius-full);box-shadow:var(--shadow-lg);
      z-index:var(--z-tooltip,2000);animation:fadeUp var(--dur-base) var(--ease-out)}
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
          <div class="bbi-field" data-el="promoField" hidden>
            <label>Discount code <span class="muted" style="font-weight:400">(optional)</span></label>
            <input name="promo" autocomplete="off" style="text-transform:uppercase" />
            <div data-el="promoHint" style="font-size:var(--fs-xs);margin-top:4px;min-height:1em"></div>
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
      q('[data-el="promoField"]').hidden = m === 'login';
      q('[data-el="submit"]').textContent = m === 'login' ? 'Sign in' : 'Create account';
      q('[data-el="err"]').textContent = '';
      q('[data-el="note"]').innerHTML = auth.backend.mode === 'demo'
        ? `Demo mode — accounts are stored only in this browser. No payment is taken; tier upgrades are simulated until the billing backend is connected.`
        : '';
    };
    modalEl.querySelectorAll('.bbi-tab').forEach(t =>
      t.addEventListener('click', () => setMode(t.dataset.tab)));

    // Live feedback as a discount code is typed.
    const promoInput = q('[name="promo"]'), promoHint = q('[data-el="promoHint"]');
    if (promoInput) promoInput.addEventListener('input', () => {
      const raw = promoInput.value.trim();
      if (!raw) { promoHint.textContent = ''; return; }
      const p = auth.validatePromo(raw);
      promoHint.textContent = p ? `✓ ${p.label} — ${p.kind}` : 'Code not recognized';
      promoHint.style.color = p ? 'var(--positive)' : 'var(--text-muted)';
    });
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
                     name: fd.get('name'), promo: fd.get('promo') };
      btn.disabled = true; err.textContent = ''; err.style.color = '';
      try {
        if (mode === 'signup') {
          const r = await auth.signup(data);
          if (r && r.needsConfirmation) {                 // email confirmation is on
            err.style.color = 'var(--text-muted)';
            err.textContent = 'Almost there — check your email to confirm, then sign in.';
            setMode('login');
            return;
          }
        } else {
          await auth.login(data);
        }
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

  /* ---------------- PAGE ROUTER ----------------
     Stamps data-gate on the current page's gated region straight from the
     PAGE_TIERS map, so all gating flows through one config instead of
     hand-placed attributes. Region = [data-gate-region] if marked, else
     <main>. Idempotent; the visual is handled by applyGates(). */
  function applyPageGate() {
    const page = currentPageName();
    const need = PAGE_TIERS[page];
    if (!need) return;
    const region = document.querySelector('[data-gate-region]') || document.querySelector('main');
    if (!region) return;
    if (!region.getAttribute('data-gate')) region.setAttribute('data-gate', need);
    if (!region.getAttribute('data-gate-msg') && PAGE_GATE_MSG[page])
      region.setAttribute('data-gate-msg', PAGE_GATE_MSG[page]);
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

  /* ---------------- BOOT ----------------
     Resolve-window: seed tier synchronously from the stored session BEFORE
     the async init() confirms it, then gate immediately. This gates-by-
     default for free/logged-out users (no content flash) while preventing
     the paywall from flashing to an already-entitled member. */
  function boot() {
    injectCSS();
    try { current = store.get(LS_SESSION, null) || null; } catch {}
    applyPageGate(); applyGates();
    auth.init();
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
