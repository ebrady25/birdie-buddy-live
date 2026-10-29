/* =====================================================================
   BIRDIEBUDDY — AUTH + ONE MEMBERSHIP
   ---------------------------------------------------------------------
   Client-side account system for one BirdieBuddy membership: you are a
   member or you are not. One price gets everything (NFL + golf). Provides:

     • account model + session (localStorage)
     • signup / login / logout, SHA-256 password hashing (demo backend)
     • header auth control (Sign in  ↔  account chip + menu)
     • login/signup modal (injected once, global)
     • page gating behind ONE switch, GATE_MODE (see below), plus
       declarative section gating via [data-gate]
     • a clean BACKEND SEAM so a real auth API + Stripe Checkout can be
       dropped in without touching pages (see BBI.auth.backend below)

   ⚠️  SECURITY — READ THIS
   This is a front-end layer. Anything it hides is still downloadable, and
   localStorage flags are trivially editable. The real lock is the
   Cloudflare Pages Functions middleware (GATE_MODE 'server'): it checks the
   Supabase JWT before serving members-only HTML and JSON.
   ===================================================================== */

window.BBI = window.BBI || {};

(() => {
  'use strict';
  if (window.BBI.auth) return; // idempotent

  /* ---------------- THE GATE SWITCH ----------------
     'legacy'  today's behaviour (default until the server gate ships). Only the
               six golf tool pages that already lock (LEGACY_PAGES) plus the
               in-page [data-gate] sections lock for non-members. Every NFL page,
               Results included, stays open to everyone.
     'client'  every page NOT in PUBLIC_PAGES locks for non-members (blur +
               upgrade card). Cosmetic only: the data files stay downloadable.
     'server'  the Cloudflare middleware already refused non-members before the
               page loaded, so the browser shows no locks of its own.
     Members (any paid tier in the database, a comp code, or member = true)
     see everything in every mode. */
  const GATE_MODE = 'legacy';

  // Open to everyone in 'client' and 'server' modes. Paths are normalized by
  // pagePath(): no ".html", directory indexes end in "/". Keep in sync with
  // PUBLIC_PAGES in cf_functions_draft/functions/_middleware.js.
  const PUBLIC_PAGES = [
    '/',                // brand homepage
    '/golf/',           // golf homepage
    '/nfl/',            // NFL homepage
    '/pricing', '/login', '/account', '/404',
    '/terms', '/privacy'   // legal (pages not built yet)
  ];
  // The pages that lock today. Used only in 'legacy' mode.
  const LEGACY_PAGES = ['/rankings', '/lineups', '/live', '/compare', '/simulator', '/market'];

  /* ---------------- THE MEMBERSHIP ----------------
     PRICES is the ONE place the price lives (set 2026-10-29: $29/month or $249/year,
     founding-member pricing). Every [data-price="month|year|both"] element on the
     site is filled from it at boot, and the upgrade card prints it.
     $249/year = $20.75/month, 28.4% under 12 × $29 ($348), so "about 28% off". */
  const PRICES = {
    month: { amount: 29,  label: '$29',  per: '/month', name: 'Monthly' },
    year:  { amount: 249, label: '$249', per: '/year',  name: 'Annual', perMonth: '$20.75', save: 'about 28% off monthly' }
  };
  const priceText = k => k === 'both'
    ? `${PRICES.month.label}${PRICES.month.per} or ${PRICES.year.label}${PRICES.year.per}`
    : `${PRICES[k].label}${PRICES[k].per}`;
  // Founding-member pricing: honest, open-ended (no end date set, no seat limit).
  const FOUNDING = {
    label: 'Founding member',
    note: 'Founding member pricing: join now and your rate is locked for as long as you stay a member.'
  };
  const MEMBERSHIP = {
    name: 'BirdieBuddy membership',
    nfl: [
      'This week’s slate in our numbers',
      'Projections for every player',
      'Projected ownership',
      'Classic Playbook',
      'Showdown Playbook: Chill and Grind',
      'Lineup Lab',
      'Weekly articles',
      'Weekly results'
    ],
    golf: [
      'Full-field rankings',
      'DFS lineups',
      'THEMIS simulator',
      'Market edges',
      'Live tournament pivots'
    ]
  };
  // Back-compat shape for pages that read TIERS[user.tier].name (login, account).
  const TIERS = {
    none:   { key: 'none',   rank: 0, name: 'Not a member yet', accent: 'var(--text-muted)' },
    member: { key: 'member', rank: 1, name: 'Member',           accent: 'var(--gold-500)' }
  };
  // Database tiers that count as a member until profiles.member replaces them.
  const MEMBER_TIERS = ['member', 'pro', 'all_access', 'sharp'];
  const toTier = t => (MEMBER_TIERS.includes(t) ? 'member' : 'none');
  const tierOf = k => TIERS[toTier(k)];

  /* ---------------- DISCOUNT / COMP CODES ----------------
     Codes match case- and whitespace-insensitively ("Lock City" == "LOCKCITY");
     `label` is the canonical display form. A code with `grantsMember` is a 100%-off
     comp that makes the account a member at signup — granted server-side by the
     redeem_promo() Supabase function (the client can't grant itself membership).
     A code without it would be a percentage discount applied at checkout (billing
     not live yet). Keep this map in sync with redeem_promo when adding codes. */
  const PROMO_CODES = {
    LOCKCITY: { label: 'LockCity', kind: 'Friends & Family', grantsMember: true,
                note: 'Full membership, on us. Welcome in.' }
  };
  const normalizePromo = c => (c || '').trim().toUpperCase().replace(/\s+/g, '');
  const lookupPromo = c => PROMO_CODES[normalizePromo(c)] || null;

  /* ---------------- PAGE GATING ----------------
     pagePath() turns the URL into the form PUBLIC_PAGES / LEGACY_PAGES use:
     /rankings.html → /rankings, /nfl/results/index.html → /nfl/results/.
     Clean URLs (Cloudflare Pages) already arrive without ".html". */
  const pagePath = (p = location.pathname) => {
    p = p.replace(/\/index(\.html)?$/, '/').replace(/\.html$/, '');
    return p || '/';
  };
  const pageNeedsMember = (p = pagePath()) => {
    if (GATE_MODE === 'legacy') return LEGACY_PAGES.includes(p);
    if (GATE_MODE === 'client') return !PUBLIC_PAGES.includes(p);
    return false;   // 'server': the middleware already decided
  };
  const GATE_MSG = 'One membership opens every page: NFL and golf, all season long.';

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
     does, so flipping `backend` below is the only switch. Identity + membership
     are server-truth: they live in public.profiles (RLS: a user reads only their
     own row) and are set by the Stripe webhook / redeem_promo, never by the client.
     Public config only — the anon/publishable key is safe in the browser;
     the service-role key lives ONLY in the Vercel /api functions.            */
  const SUPABASE_URL      = 'https://mooqbndhgsuatxlkmlrq.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_zVvQoQNxnStWCeRgqg9Dlg_LhTcengq';
  const API_BASE          = 'https://vercel-app-beige-psi.vercel.app';
  const SUPABASE_JS_CDN   = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

  // GATE_MODE 'server' only: mirror the Supabase access token into a first-party cookie so the
  // Cloudflare middleware can read it on page loads (supabase-js keeps the session in localStorage,
  // which the server never sees). Not HttpOnly (JS writes it): same exposure as localStorage.
  // The cookie lives exactly as long as the token; supabase-js refreshes it in the background.
  const GATE_COOKIE = 'bb-access';
  function syncGateCookie(session) {
    if (GATE_MODE !== 'server') return;
    try {
      const secure = location.protocol === 'https:' ? '; Secure' : '';
      const ttl = session?.expires_at ? Math.max(0, session.expires_at - Math.floor(Date.now() / 1000)) : 0;
      document.cookie = session?.access_token && ttl
        ? `${GATE_COOKIE}=${session.access_token}; Path=/; Max-Age=${ttl}; SameSite=Lax${secure}`
        : `${GATE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
    } catch {}
  }

  // Lazy-load supabase-js once and memoize a single client (avoids the
  // multiple-GoTrueClient warning). Resolves to the client.
  let _sbPromise = null;
  function getSupabase() {
    if (_sbPromise) return _sbPromise;
    _sbPromise = new Promise((resolve, reject) => {
      const make = () => {
        if (!window.supabase?.createClient) return reject(new Error('Auth library failed to initialize.'));
        const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        // Keep the server-gate cookie in step with every sign-in, refresh and sign-out.
        sb.auth.onAuthStateChange((_event, session) => syncGateCookie(session));
        resolve(sb);
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

  // 'member' | 'none'. Reads the whole own row so it works before AND after the
  // migration that adds profiles.member (draft: cf_functions_draft/supabase/).
  async function fetchTier(sb, userId) {
    const { data } = await sb.from('profiles').select('*').eq('id', userId).single();
    return data?.member === true ? 'member' : toTier(data?.tier);
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
      if (!data.session) return { email, name: fallbackName, tier: 'none', needsConfirmation: true };
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
      syncGateCookie(session);
      if (!session?.user) return null;
      const email = session.user.email;
      const name = session.user.user_metadata?.name || email?.split('@')[0] || email;
      let tier = 'none';
      try { tier = await fetchTier(sb, session.user.id); }
      catch { tier = toTier(store.get(LS_SESSION, {})?.tier); } // keep last-known on transient failure
      return { email, name, tier };
    },
    async signOut() { syncGateCookie(null); try { (await getSupabase()).auth.signOut(); } catch {} },
    // Redeem a comp code server-side (SECURITY DEFINER fn). Returns what it granted
    // (today 'sharp', which counts as member) or null for an unknown code. Needs a session.
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
                        tier: 'none', promo: promo || null, created: new Date().toISOString() };
      store.set(LS_USERS, users);
      return { email, name: users[email].name, tier: 'none' };
    },
    async login({ email, password }) {
      const users = store.get(LS_USERS, {});
      email = email.trim().toLowerCase();
      const u = users[email];
      if (!u || u.hash !== await sha256(password)) throw new Error('Invalid email or password.');
      return { email, name: u.name, tier: toTier(u.tier) };
    },
    async checkout({ email, cycle }) {
      // PRODUCTION: redirect to Stripe Checkout for the membership at the chosen cycle;
      // membership is set by the Stripe webhook server-side. DEMO: grant immediately.
      const users = store.get(LS_USERS, {});
      if (users[email]) { users[email].tier = 'member'; store.set(LS_USERS, users); }
      return { email, tier: 'member', cycle, simulated: true };
    },
    async portal({ email }) {            // PRODUCTION: Stripe billing portal URL
      return { url: null, simulated: true };
    },
    async session() {                    // PRODUCTION: verify signed cookie/JWT
      return store.get(LS_SESSION, null);
    },
    async redeemPromo(code) {            // DEMO: grant membership locally
      const p = lookupPromo(code);
      if (!p?.grantsMember) return null;
      const email = (current?.email || '').trim().toLowerCase();
      const users = store.get(LS_USERS, {});
      if (users[email]) { users[email].tier = 'member'; store.set(LS_USERS, users); }
      return 'member';
    }
  };

  /* ---------------- CORE STATE ---------------- */
  const listeners = new Set();
  let current = null; // {email,name,tier: 'member'|'none'}

  const emit = () => { listeners.forEach(fn => { try { fn(current); } catch {} });
                       applyPageGate(); applyGates(); renderHeaderControl(); };

  const auth = {
    GATE_MODE, PRICES, FOUNDING, priceText, MEMBERSHIP, TIERS, PROMO_CODES, backend: supabaseBackend, API_BASE,
    // The shared Supabase client + its public config (track.js batches events through it).
    client: getSupabase, supabaseConfig: { url: SUPABASE_URL, key: SUPABASE_ANON_KEY },
    validatePromo: lookupPromo,
    user: () => current,
    tier: () => tierOf(current?.tier).key,          // 'member' | 'none'
    isMember: () => tierOf(current?.tier).key === 'member',
    isLoggedIn: () => !!current,
    // One membership: any requirement ('member', or a legacy 'pro'/'all_access'/'sharp')
    // is met by being a member. Kept for data.js / index.html / full_rankings.html.
    hasTier() { return this.isMember(); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async init() {
      const s = await this.backend.session();
      if (s && s.email) {
        // refresh tier from the user record so demo upgrades persist
        const users = store.get(LS_USERS, {});
        current = { email: s.email, name: s.name || s.email,
                    tier: toTier(users[s.email]?.tier || s.tier) };
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
      await this.applyPromoGrant();            // 100%-off comp codes unlock membership now
      return current;
    },
    // Redeem a comp code that grants membership, if the user isn't a member yet.
    // Idempotent + self-healing; the grant is server-enforced (redeem_promo) so it
    // persists across devices and sessions. Uses the code stored on THIS browser
    // (LS_PROMO) when present; on explicit login (useMetadata) a non-member also lets
    // the server check the code saved in their signup metadata — covers the case of
    // confirming/logging in on a different device than they signed up on.
    async applyPromoGrant({ useMetadata = false } = {}) {
      if (!current) return;
      const stored = store.get(LS_PROMO, null);
      const localCode = (stored && lookupPromo(stored.code)?.grantsMember) ? stored.code : null;
      const code = localCode != null ? localCode
                 : (useMetadata && !this.isMember()) ? '' : null;
      if (code === null) return;
      try {
        const granted = await this.backend.redeemPromo(code);
        if (toTier(granted) === 'member' && !this.isMember()) {
          current = { ...current, tier: 'member' };
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

    /** Start checkout for the membership, billed 'month' or 'year'.
        Demo grants immediately; prod → Stripe. */
    async subscribe(cycle = 'month') {
      if (!PRICES[cycle]) cycle = 'month';
      if (!current) { openModal('signup', { intentTier: 'member', intentCycle: cycle }); return; }
      if (this.isMember()) { location.href = 'account.html'; return; }
      try {
        const r = await this.backend.checkout({ email: current.email, tier: 'member', cycle });
        if (r?.url) { location.href = r.url; return r; }          // real Stripe redirect (later)
        if (r?.tier) {                                            // demo immediate grant
          current = { ...current, tier: toTier(r.tier) }; store.set(LS_SESSION, current);
          emit(); toast(`Welcome to BirdieBuddy${r.simulated ? ' (demo)' : ''}.`);
        }
        return r;
      } catch (e) {
        if (e.code === 'billing_unavailable') { toast(e.message); return; }
        throw e;
      }
    },

    /** Authenticated read of the gated rankings backend. Sends the user's
        Supabase token so members get full_json; everyone else gets the teaser.
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
    applyGates, lockCard: lockCardHTML, fillPrices
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
    .bbi-lock-card p{font-size:var(--fs-xs);color:var(--text-muted);margin-bottom:var(--space-3)}
    .bbi-lock-price{font-size:var(--fs-xs);color:var(--text-muted);margin-bottom:var(--space-4)}
    .bbi-lock-price b{font-size:var(--fs-lg);color:var(--text-primary);font-weight:800}
    .bbi-lock-signin{display:block;margin:var(--space-3) auto 0;font-size:var(--fs-2xs,11px);
      color:var(--text-muted);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
    .bbi-lock-signin:hover{color:var(--gold-300,#e8c878)}
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
        ? `Demo mode — accounts are stored only in this browser. No payment is taken until the billing backend is connected.`
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
          await auth.subscribe(modalIntent.intentCycle);
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
    const member = auth.isMember();
    const initials = (current.name || current.email).trim()[0]?.toUpperCase() || 'B';
    mount.innerHTML = `
      <div class="bbi-auth-ctl" style="position:relative">
        <div class="bbi-chip" data-auth="menu" tabindex="0" role="button" aria-haspopup="true">
          <span class="bbi-ava">${initials}</span>
          <span class="bbi-chip-tier" style="color:${member ? 'var(--gold-500)' : 'var(--text-muted)'}">${member ? 'Member' : 'Account'}</span>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
               stroke="currentColor" stroke-width="1.6" style="color:var(--text-muted)">
            <path d="M3 5l3 3 3-3" stroke-linecap="round"/></svg>
        </div>
        <div class="bbi-menu" data-el="menu" hidden>
          <div class="bbi-menu-head">
            <b>${escapeHtml(current.name || current.email)}</b>
            <span>${escapeHtml(current.email)}${member ? ' · Member' : ''}</span>
          </div>
          <a href="account.html">⚙ Account${member ? ' &amp; billing' : ''}</a>
          ${member ? '' : `<a href="pricing.html">★ Get BirdieBuddy</a>`}
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
     Stamps data-gate="member" on the current page's gated region when
     pageNeedsMember() says so (GATE_MODE + PUBLIC_PAGES / LEGACY_PAGES), so all
     page gating flows through one config. Region = [data-gate-region] if
     marked, else <main>. Idempotent; the visual is handled by applyGates(). */
  function applyPageGate() {
    if (!pageNeedsMember()) return;
    const region = document.querySelector('[data-gate-region]') || document.querySelector('main');
    if (!region) return;
    if (!region.getAttribute('data-gate')) region.setAttribute('data-gate', 'member');
  }

  /* ---------------- CONTENT GATING ----------------
     Any element: <section data-gate="member"> … </section> (older values like
     "pro" mean the same thing now). For a non-member the content is blurred
     and the upgrade card is overlaid. Idempotent + re-applied on auth change.
     GATE_MODE 'server': no client locks at all (the server already decided). */
  function applyGates() {
    injectCSS();
    if (current) document.querySelectorAll('[data-auth="lock-login"]').forEach(b => b.remove());
    document.querySelectorAll('[data-gate]').forEach(node => {
      const need = node.getAttribute('data-gate');
      const ok = GATE_MODE === 'server' || auth.hasTier(need);
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
      if (node.parentElement?.closest('[data-gate]')) return;   // already inside a locked region
      const wrap = document.createElement('div');
      wrap.className = 'bbi-lock-content';
      while (node.firstChild) wrap.appendChild(node.firstChild);
      node.appendChild(wrap);
      const ovl = document.createElement('div');
      ovl.className = 'bbi-lock-ovl';
      ovl.innerHTML = lockCardHTML(need, node.getAttribute('data-gate-msg'));
      node.classList.add('bbi-locked');
      node.appendChild(ovl);
    });
  }

  // The upgrade card: one message for the whole site. applyGates overlays it on a locked [data-gate]
  // region; pages that gate server-side (showdown.js, GATING_MODE 'server') render it in place of the
  // sections they didn't receive. `need` is ignored (one membership); `msg` is the page's own line.
  function lockCardHTML(need, msg) {
    injectCSS();
    return `
        <div class="bbi-lock-card">
          <div class="eyebrow">Members only</div>
          <h4>This is part of BirdieBuddy</h4>
          <p>${escapeHtml(msg || GATE_MSG)}</p>
          <div class="bbi-lock-price"><b>${escapeHtml(PRICES.month.label)}</b>/month or <b>${escapeHtml(PRICES.year.label)}</b>/year · everything included</div>
          <a class="bbi-auth-btn" href="pricing.html">Get BirdieBuddy</a>
          ${current ? '' : `<button type="button" class="bbi-lock-signin" data-auth="lock-login">Already a member? Sign in</button>`}
        </div>`;
  }
  // Sign-in link on the upgrade card (delegated: cards are re-rendered by applyGates and showdown.js).
  document.addEventListener('click', e => {
    if (e.target.closest && e.target.closest('[data-auth="lock-login"]')) openModal('login');
  });

  // Every [data-price="month|year|both"] on the page shows the price from PRICES.
  function fillPrices() {
    document.querySelectorAll('[data-price]').forEach(el => {
      const k = el.getAttribute('data-price');
      const t = priceText(PRICES[k] || k === 'both' ? k : 'month');
      if (el.textContent !== t) el.textContent = t;
    });
  }

  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* ---------------- BOOT ----------------
     Resolve-window: seed membership synchronously from the stored session
     BEFORE the async init() confirms it, then gate immediately. This gates-by-
     default for non-members/logged-out users (no content flash) while
     preventing the paywall from flashing to an already-signed-in member. */
  function boot() {
    injectCSS();
    try { current = store.get(LS_SESSION, null) || null; } catch {}
    applyPageGate(); applyGates(); fillPrices();
    auth.init();
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
