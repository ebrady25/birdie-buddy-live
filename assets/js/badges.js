/* =====================================================================
   BIRDIEBUDDY — BADGES v1 (BBI.badges)
   Spec: Projects/NFL/DFS/automation/BADGES_SPEC_2026-11-05.md
   Catalog: badges/catalog.json (36 badges). Trophy Room: badges/.

   Two kinds of badge:
   - self:     earned by what you do in this browser (reading, the Lab,
               DFS DNA, visits). Kept in localStorage (bbi_badges_v1) and,
               when signed in, copied to public.user_badges (source 'self',
               verified false). The browser can't fake the other kind.
   - verified: quizzes (graded by grade_quiz on the server) and account
               badges (claim_account_badges). Written ONLY by the
               database's SECURITY DEFINER functions; this file only reads
               them back. Verified-only ids are never sent from here.

   Local first: everything works signed out and with the badges tables
   not created yet. If PostgREST says the table or function is missing
   (42P01 / 42883 / PGRST202 / PGRST205 / 404) the account side switches
   itself off for 30 minutes on this device (one console.info), so it
   starts working on its own once the migration is applied.

   Privacy: counters store only keys (article slugs, ISO weeks, glossary
   terms, sport codes, short lineup hashes) and counts. No names, money,
   contest keys or file contents, here or in meta.

   API:  earn(id, meta) · count(counter, key) · seen(el, fn | counter, key)
         sync() · quiz(quizId, answers) · state() · progress(counter)
         catalog() · medalSvg(badge, opts) · drawMedal(ctx, x, y, size, badge, opts)
         onChange(fn) · fromDna(analysis) · watchTerms(el)
   Hooks on pages without badges.js loaded yet call BBI.badgeQ(method, ...args)
   (defined in nfl.js); the queue is drained here on load.
   Self-tests (?selftest=... on any page): nothing is saved, nothing is sent.
   ===================================================================== */
window.BBI = window.BBI || {};

(() => {
  'use strict';
  const BBI = window.BBI;
  if (BBI.badges) return;   // idempotent

  const VER = '20261105d';
  const CATALOG_URL = `badges/catalog.json?v=${VER}`;
  const LS_KEY = 'bbi_badges_v1', LS_DNA = 'bbi_dna_badges', LS_OFF = 'bbi_badges_remote_off_until';
  const TABLE = 'user_badges';
  const OFF_MS = 30 * 60 * 1000;
  const ID_RE = /^[a-z0-9_]{2,40}$/;
  const KEY_RE = /^[A-Za-z0-9_:.-]{1,32}$/;

  const RARITY = {
    legendary: { label: 'Legendary', color: '#D4A843', rank: 4 },
    epic:      { label: 'Epic',      color: '#B98CFF', rank: 3 },
    rare:      { label: 'Rare',      color: '#4FB8FF', rank: 2 },
    uncommon:  { label: 'Uncommon',  color: '#3DD68C', rank: 1 },
    common:    { label: 'Common',    color: '#8A8A98', rank: 0 }
  };
  // Only the server can award these (the insert policy refuses them too).
  const SERVER_ONLY = new Set(['film_study', 'day_one', 'member', 'founding_member', 'discord_linked', 'challenge_entered', 'challenge_top10', 'challenge_winner']);
  const serverOnly = id => /^quiz_/.test(id) || SERVER_ONLY.has(id);

  // progress badges: counter -> [threshold, badge id]
  const PROGRESS = {
    articles:    [[5, 'bookworm'], [20, 'scholar']],
    graded:      [[1, 'first_build'], [25, 'lab_rat']],
    weeks:       [[4, 'regular'], [10, 'iron_man']],
    glossary:    [[10, 'glossary_grad']],
    chalk_weeks: [[3, 'chalk_watcher']],
    dna_sports:  [[2, 'two_sport']]
  };
  const KEEP = { articles: 40, graded: 40, weeks: 20, glossary: 40, chalk_weeks: 12, dna_sports: 8 };

  const Q = new URLSearchParams(window.location.search);
  const SELFTEST = Q.get('selftest');
  const memory = !!SELFTEST;          // any page self-test: in memory only, no account calls, no toasts
  let toastsOn = !memory;

  /* ---------------- small helpers ---------------- */
  const lsGet = k => { try { return window.localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { if (memory) return; try { window.localStorage.setItem(k, v); } catch {} };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  // short, non-reversible key for anything long (a lineup): djb2 -> base36
  const hashKey = s => { let h = 5381; s = String(s); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return 'h' + (h >>> 0).toString(36); };
  const keyOf = k => { k = String(k ?? ''); return KEY_RE.test(k) ? k : hashKey(k); };

  // Eastern time: date parts and the ISO week key ("2026-w45")
  const etParts = (d = new Date()) => {
    try {
      const p = {};
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
        .formatToParts(d).forEach(x => { p[x.type] = x.value; });
      return { y: +p.year, m: +p.month, d: +p.day, wd: p.weekday };
    } catch { return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] }; }
  };
  const isoWeek = (p = etParts()) => {
    const t = new Date(Date.UTC(p.y, p.m - 1, p.d)), day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return `${t.getUTCFullYear()}-w${String(Math.ceil(((t - y0) / 864e5 + 1) / 7)).padStart(2, '0')}`;
  };

  /* ---------------- state (localStorage, or memory in a self-test) ---------------- */
  const blank = () => ({ v: 1, earned: {}, counters: {}, migrated: {} });
  const tidy = s => {
    const o = blank();
    if (!s || typeof s !== 'object') return o;
    for (const [id, e] of Object.entries(s.earned || {})) {
      if (!ID_RE.test(id) || !e || typeof e !== 'object') continue;
      o.earned[id] = { at: String(e.at || '').slice(0, 30), verified: !!e.verified, source: e.source === 'server' ? 'server' : 'self', ...(e.acct ? { acct: true } : {}) };
    }
    for (const [c, list] of Object.entries(s.counters || {})) if (PROGRESS[c] && Array.isArray(list)) o.counters[c] = list.filter(k => KEY_RE.test(String(k))).slice(-KEEP[c]);
    o.migrated = s.migrated && typeof s.migrated === 'object' ? { ...s.migrated } : {};
    return o;
  };
  let mem = memory ? blank() : null;
  const read = () => { if (mem) return mem; try { return tidy(JSON.parse(lsGet(LS_KEY))); } catch { return blank(); } };
  const write = st => { if (mem) { mem = st; return; } lsSet(LS_KEY, JSON.stringify(st)); };

  const listeners = new Set();
  const emit = () => listeners.forEach(fn => { try { fn(read()); } catch {} });
  window.addEventListener('storage', e => { if (e.key === LS_KEY) emit(); });   // another tab earned one

  /* ---------------- catalog ---------------- */
  let catP = null, CAT = null;
  const catalog = () => catP || (catP = fetch(CATALOG_URL, { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : null))
    .then(d => { if (!d || !Array.isArray(d.badges)) throw new Error('catalog'); CAT = d; CAT.byId = Object.fromEntries(d.badges.map(b => [b.id, b])); return CAT; })
    .catch(() => { catP = null; return null; }));
  const badgeOf = id => (CAT && CAT.byId[id]) || null;

  /* ---------------- earning ---------------- */
  // meta: small primitives only (a count, a sport code). Never money, names or file contents.
  const cleanMeta = m => {
    const o = {};
    if (!m || typeof m !== 'object') return o;
    for (const [k, v] of Object.entries(m).slice(0, 6)) {
      if (!/^[a-z_]{1,16}$/.test(k)) continue;
      if (typeof v === 'number' && Number.isFinite(v)) o[k] = Math.round(v * 100) / 100;
      else if (typeof v === 'boolean') o[k] = v;
      else if (typeof v === 'string' && /^[A-Za-z0-9_ -]{1,16}$/.test(v)) o[k] = v;
    }
    return o;
  };

  // opts.server: a verified badge the server just awarded (quiz pass) · opts.silent: no toast (migration)
  const earn = (id, meta, opts = {}) => {
    if (!ID_RE.test(String(id))) return false;
    if (serverOnly(id) && !opts.server) return false;
    if (CAT && !CAT.byId[id]) return false;
    const st = read(), had = st.earned[id];
    if (had && (had.verified || !opts.server)) return false;
    st.earned[id] = { at: had ? had.at : new Date().toISOString(), verified: !!opts.server, source: opts.server ? 'server' : 'self', ...(opts.acct ? { acct: true } : {}) };
    write(st);
    emit();
    if (!had && !opts.silent) { toast(id); trackEarn(id); }
    if (!opts.server) pushOne(id, meta);
    return true;
  };

  const count = (counter, key) => {
    if (!PROGRESS[counter] || key == null || key === '') return 0;
    const k = keyOf(key), st = read();
    const list = Array.isArray(st.counters[counter]) ? st.counters[counter] : [];
    if (!list.includes(k)) { list.push(k); st.counters[counter] = list.slice(-KEEP[counter]); write(st); emit(); }
    const n = list.length;
    PROGRESS[counter].forEach(([at, id]) => { if (n >= at) earn(id, { n }); });
    return n;
  };
  const progress = counter => {
    const n = ((read().counters || {})[counter] || []).length;
    return { n, steps: (PROGRESS[counter] || []).map(([at, id]) => ({ at, id })) };
  };
  // the counter + threshold behind a progress badge ('bookworm' -> {counter:'articles', at:5})
  const progressFor = id => { for (const [c, steps] of Object.entries(PROGRESS)) for (const [at, b] of steps) if (b === id) return { counter: c, at, n: progress(c).n }; return null; };

  // run fn once el has been on screen (25% visible) for `ms`
  const seen = (el, fnOrCounter, key, ms = 600) => {
    if (!el) return;
    const fn = typeof fnOrCounter === 'function' ? fnOrCounter : () => count(fnOrCounter, key);
    if (!('IntersectionObserver' in window)) { setTimeout(fn, ms); return; }
    let t = 0;
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { if (!t) t = setTimeout(() => { io.disconnect(); fn(); }, ms); }
      else if (t) { clearTimeout(t); t = 0; }
    }), { threshold: 0.25 });
    io.observe(el);
  };

  // Glossary terms (<dt> in a <dl>): a term counts once it's been read (on screen ~1.5 s) or hovered, focused or tapped.
  const watchTerms = el => {
    if (!el) return;
    const term = dt => (dt.textContent || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
    el.querySelectorAll('dt').forEach(dt => {
      let done = false;
      const hit = () => { if (done) return; done = true; const k = term(dt); if (k) count('glossary', k); };
      seen(dt, hit, null, 1500);
      ['pointerenter', 'focusin', 'click'].forEach(ev => dt.addEventListener(ev, hit, { once: true }));
      const dd = dt.nextElementSibling; if (dd && dd.tagName === 'DD') ['pointerenter', 'click'].forEach(ev => dd.addEventListener(ev, hit, { once: true }));
    });
  };

  // DFS DNA -> catalog badges (one call from dna.js after each read)
  const TIER_RANK = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
  const finishBadges = tier => { const r = TIER_RANK[tier] || 0; return [r >= 2 && 'finish_rare', r >= 3 && 'finish_epic', r >= 4 && 'finish_legendary'].filter(Boolean); };
  const fromDna = a => {
    if (!a || a.tooFew) return;
    earn('dna_taken');
    if (a.sport && a.sport !== 'ALL') count('dna_sports', String(a.sport).toUpperCase().slice(0, 8));
    if (a.rarity) finishBadges(a.rarity.id).forEach(id => earn(id));
    if (a.facts && a.facts.sniperHit) earn('sniper');
    if (a.facts && a.facts.satWon) earn('ticket_punched');
  };
  // one-time: the DNA page's old device badges (bbi_dna_badges) -> catalog ids. volume / primetime stay DNA-page flair.
  const migrateDna = () => {
    const st = read(); if (st.migrated.dna) return;
    let old = null; try { old = JSON.parse(lsGet(LS_DNA)); } catch {}
    st.migrated.dna = 1; write(st);
    if (!old || typeof old !== 'object') return;
    const ids = [];
    if (old.dna) ids.push('dna_taken');
    if (old.finish && old.finish.v) ids.push(...finishBadges(old.finish.v));
    if (old.sniper) ids.push('sniper');
    if (old.ticket) ids.push('ticket_punched');
    ids.forEach(id => earn(id, null, { silent: true }));
  };

  /* ---------------- the account (Supabase), when signed in ---------------- */
  let remoteOff = false, noted = false;
  const missing = (err, status) => status === 404 || /^(42P01|42883|PGRST202|PGRST205)$/.test((err && err.code) || '') || /does not exist|schema cache/i.test((err && err.message) || '');
  const goLocal = () => {
    remoteOff = true; lsSet(LS_OFF, String(Date.now() + OFF_MS));
    if (!noted) { noted = true; console.info('[badges] account sync is not switched on yet: badges stay on this device for now.'); }
  };
  const authApi = () => { const a = BBI.auth; return a && a.client && a.isLoggedIn ? a : null; };
  // -> {sb, uid} for a signed-in live session, else null. Signed out: nothing here touches Supabase.
  const session = async ({ force = false } = {}) => {
    if (memory) return null;
    if (!force && (remoteOff || +lsGet(LS_OFF) > Date.now())) return null;
    const a = authApi(); if (!a || !a.isLoggedIn() || (a.backend && a.backend.mode !== 'live')) return null;
    try {
      const sb = await a.client();
      const { data } = await sb.auth.getSession();
      const u = data && data.session && data.session.user;
      return u && u.id ? { sb, uid: u.id } : null;
    } catch { return null; }
  };
  const rowFor = (uid, id, meta, at) => ({ user_id: uid, badge_id: id, source: 'self', verified: false, meta: cleanMeta(meta), ...(at ? { earned_at: at } : {}) });
  // insert … on conflict do nothing; self badges only
  const upsertRows = async (s, rows) => {
    rows = rows.filter(r => ID_RE.test(r.badge_id) && !serverOnly(r.badge_id));
    if (!rows.length) return true;
    try {
      const { error, status } = await s.sb.from(TABLE).upsert(rows, { onConflict: 'user_id,badge_id', ignoreDuplicates: true });
      if (error) { if (missing(error, status)) goLocal(); return false; }
      return true;
    } catch { return false; }
  };
  const pushOne = async (id, meta) => { const s = await session(); if (s) await upsertRows(s, [rowFor(s.uid, id, meta)]); };
  const metaFor = (id, st) => { const p = progressFor(id); return p ? { n: ((st.counters || {})[p.counter] || []).length } : {}; };

  let syncing = null, lastSync = 0;
  const sync = () => syncing || (syncing = (async () => {
    lastSync = Date.now();
    migrateDna();
    const s = await session(); if (!s) return false;
    const st = read();
    const mine = Object.entries(st.earned).filter(([id, e]) => !e.verified && !e.acct && !serverOnly(id)).map(([id, e]) => rowFor(s.uid, id, metaFor(id, st), e.at));
    await upsertRows(s, mine);
    if (remoteOff) return false;
    try { const { error, status } = await s.sb.rpc('claim_account_badges'); if (error && missing(error, status)) { goLocal(); return false; } } catch {}
    let rows;
    try {
      const { data, error, status } = await s.sb.from(TABLE).select('badge_id, earned_at, source, verified').eq('user_id', s.uid);
      if (error) { if (missing(error, status)) goLocal(); return false; }
      rows = Array.isArray(data) ? data : [];
    } catch { return false; }
    // merge: the account's rows come down; verified wins; anything new and recent gets a toast
    const st2 = read(), fresh = [];
    for (const r of rows) {
      const id = r && r.badge_id; if (!ID_RE.test(String(id))) continue;
      const had = st2.earned[id], ver = !!r.verified;
      if (!had) {
        st2.earned[id] = { at: r.earned_at || new Date().toISOString(), verified: ver, source: ver ? 'server' : 'self', acct: true };
        if (ver && Date.now() - Date.parse(r.earned_at || 0) < 15 * 60 * 1000) fresh.push(id);
      } else if (ver && !had.verified) { had.verified = true; had.source = 'server'; }
    }
    write(st2); emit();
    fresh.slice(0, 3).forEach(id => { toast(id); trackEarn(id); });
    return true;
  })().finally(() => { syncing = null; }));

  // signing out: the account's badges leave this device; badges earned here stay
  const dropAccount = () => {
    const st = read(); let n = 0;
    for (const [id, e] of Object.entries(st.earned)) if (e.acct || e.source === 'server') { delete st.earned[id]; n++; }
    if (n) { write(st); emit(); }
  };

  const quiz = async (quizId, answers) => {
    if (!/^quiz_[a-z0-9_]{2,30}$/.test(String(quizId)) || !Array.isArray(answers)) return { error: 'bad_input' };
    const a = authApi();
    if (!a || !a.isLoggedIn()) return { needsSignIn: true };
    if (memory) return { unavailable: true };
    const s = await session({ force: true }); if (!s) return { needsSignIn: true };
    try {
      const { data, error, status } = await s.sb.rpc('grade_quiz', { p_quiz_id: quizId, p_answers: answers.map(x => (Number.isInteger(x) ? x : -1)) });
      if (error) {
        if (error.code === '28000') return { needsSignIn: true };
        if (missing(error, status)) { goLocal(); return { unavailable: true }; }
        if (error.code === '22023') return { unavailable: true };   // the key isn't loaded yet
        return { error: 'failed' };
      }
      const r = typeof data === 'string' ? JSON.parse(data) : (data || {});
      const out = { passed: !!r.passed, correct: r.correct == null ? null : +r.correct, total: +r.total || answers.length, limited: !!r.limited,
                    whys: Array.isArray(r.whys) ? r.whys.map(String) : [] };
      if (out.passed) { remoteOff = false; earn(quizId, null, { server: true, acct: true }); sync(); }   // film_study comes down with the sync
      return out;
    } catch { return { error: 'failed' }; }
  };

  // auth.js loads async (nfl.js / brand.js inject it): sync when it lands, on every sign-in, and drop the account's badges on sign-out
  const watchAuth = () => {
    if (memory) return;
    const t0 = Date.now();
    const poll = () => {
      const a = BBI.auth;
      if (a && a.onChange) {
        let wasIn = !!(a.isLoggedIn && a.isLoggedIn());
        // a fresh sign-in always syncs; repeat emits from auth.js (tier refresh, promo check) at most once a minute
        a.onChange(u => { if (u) { if (!wasIn || Date.now() - lastSync > 60000) sync(); } else if (wasIn) dropAccount(); wasIn = !!u; });
        if (wasIn) sync();
        return;
      }
      if (Date.now() - t0 < 20000) setTimeout(poll, 300);
    };
    poll();
  };

  const trackEarn = id => {
    if (memory) return;
    const go = () => { const b = badgeOf(id); try { if (BBI.track) BBI.track('badge_earned', { badge: id, rarity: b ? b.rarity : '' }); } catch {} };
    if (CAT) go(); else catalog().then(go);
  };

  /* =================================================================
     MEDALLIONS
     One geometry in a 100×100 box, drawn as SVG (page, toast) or onto a
     canvas (share card) from the same path strings: a hexagon with a
     rarity ring, an inner hex from uncommon up, vertex studs from epic
     up, a gold gradient ring for legendary, the category glyph inside
     and a small gold check for verified badges. Locked = grey.
     ================================================================= */
  const GLYPH = {
    learn:     'M50 39c-6-4-13-5-20-3v28c7-2 14-1 20 3 6-4 13-5 20-3V36c-7-2-14-1-20 3zM50 39v28',
    build:     'M43 31h14M46.5 31v12.5L35 62.5a4.5 4.5 0 0 0 4 6.5h22a4.5 4.5 0 0 0 4-6.5L53.5 43.5V31M39.5 56h21',
    win:       'M39 32h22v11a11 11 0 0 1-22 0zM39 36h-5a6.5 6.5 0 0 0 6.5 8M61 36h5a6.5 6.5 0 0 1-6.5 8M50 54v8M43 68h14M45.5 62h9',
    community: 'M31 35h23a4 4 0 0 1 4 4v11a4 4 0 0 1-4 4H42l-7 6v-6h-4a4 4 0 0 1-4-4V39a4 4 0 0 1 4-4zM63 44h6a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4h-3v5l-6-5h-9',
    habit:     'M33 37h34a3 3 0 0 1 3 3v26a3 3 0 0 1-3 3H33a3 3 0 0 1-3-3V40a3 3 0 0 1 3-3zM30 46h40M41 32v9M59 32v9M42 57.5l5 5 10-10',
    member:    'M50 31l5.6 11.4 12.6 1.8-9.1 8.9 2.1 12.5L50 59.7l-11.2 5.9 2.1-12.5-9.1-8.9 12.6-1.8z',
    compete:   'M38 69V31M38 33h25l-6 9 6 9H38'
  };
  const hexPath = (r, cx = 50, cy = 50) => Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 180) * (60 * i - 90); return `${i ? 'L' : 'M'}${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`; }).join('') + 'Z';
  const hexPts = (r, cx = 50, cy = 50) => Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 180) * (60 * i - 90); return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
  const HEX_O = hexPath(45), HEX_I = hexPath(36.5);
  const CHECK_C = [80, 80, 11.5], CHECK_P = 'M74.5 80.2l3.8 3.8 7.2-7.6';
  const LOCK = { ring: '#3a3a46', glyph: '#5a5a68', fill: '#141419' };
  let gid = 0;
  const rarityOf = b => RARITY[(b && b.rarity) || 'common'] || RARITY.common;

  // -> an <svg> string. opts: {earned, size, verified (default b.verified), cls}
  const medalSvg = (b, o = {}) => {
    const r = rarityOf(b), on = !!o.earned, rk = r.rank, id = `bm${++gid}`;
    const ring = on ? (rk === 4 ? `url(#${id}g)` : r.color) : LOCK.ring;
    const gl = on ? (rk === 4 ? '#F2D688' : r.color) : LOCK.glyph;
    const glyph = GLYPH[(b && b.category) || 'learn'] || GLYPH.learn;
    const isStar = b && b.category === 'member';
    const size = o.size || 64;
    const ver = (o.verified != null ? o.verified : b && b.verified) && on;
    return `<svg class="bbi-medal ${o.cls || ''}" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="${id}f" cx="50%" cy="30%" r="75%"><stop offset="0" stop-color="${on ? '#2a2a36' : '#1a1a21'}"/><stop offset="1" stop-color="${on ? '#101016' : LOCK.fill}"/></radialGradient>
        ${rk === 4 && on ? `<linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F9E9A8"/><stop offset=".5" stop-color="#D4A843"/><stop offset="1" stop-color="#8A6E2A"/></linearGradient>` : ''}
      </defs>
      <path d="${HEX_O}" fill="url(#${id}f)" stroke="${ring}" stroke-width="${on ? 5 : 3.5}" stroke-linejoin="round"/>
      ${on && rk >= 1 ? `<path d="${HEX_I}" fill="${r.color}" fill-opacity=".10" stroke="${r.color}" stroke-opacity=".45" stroke-width="1.6" stroke-linejoin="round"/>` : ''}
      ${on && rk >= 3 ? hexPts(45).map(([x, y]) => `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.4" fill="${rk === 4 ? '#F9E9A8' : r.color}"/>`).join('') : ''}
      ${on && rk >= 2 ? `<path d="M50 9.5l3 4.2h-6z" fill="${rk === 4 ? '#F9E9A8' : r.color}" opacity=".9"/>` : ''}
      <path d="${glyph}" fill="${isStar ? gl : 'none'}" fill-opacity="${isStar ? 0.22 : 0}" stroke="${gl}" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>
      ${ver ? `<circle cx="${CHECK_C[0]}" cy="${CHECK_C[1]}" r="${CHECK_C[2]}" fill="#D4A843" stroke="#0a0a0f" stroke-width="2.5"/><path d="${CHECK_P}" fill="none" stroke="#17130a" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    </svg>`;
  };

  // the same medallion on a canvas: (x, y) = top-left, s = size in px
  const drawMedal = (g, x, y, s, b, o = {}) => {
    if (typeof Path2D === 'undefined') return;
    const r = rarityOf(b), on = !!o.earned, rk = r.rank, k = s / 100;
    g.save(); g.translate(x, y); g.scale(k, k);
    g.lineJoin = 'round'; g.lineCap = 'round';
    const outer = new Path2D(HEX_O);
    if (on && o.glow !== false) { g.save(); g.shadowColor = r.color; g.shadowBlur = (rk >= 3 ? 26 : 14) * (o.glowScale || 1); g.fillStyle = 'rgba(0,0,0,0.01)'; g.fill(outer); g.restore(); }
    const f = g.createRadialGradient(50, 30, 0, 50, 30, 75); f.addColorStop(0, on ? '#2a2a36' : '#1a1a21'); f.addColorStop(1, on ? '#101016' : LOCK.fill);
    g.fillStyle = f; g.fill(outer);
    let ring = on ? r.color : LOCK.ring;
    if (on && rk === 4) { const lg = g.createLinearGradient(0, 0, 100, 100); lg.addColorStop(0, '#F9E9A8'); lg.addColorStop(0.5, '#D4A843'); lg.addColorStop(1, '#8A6E2A'); ring = lg; }
    g.strokeStyle = ring; g.lineWidth = on ? 5 : 3.5; g.stroke(outer);
    if (on && rk >= 1) { const inner = new Path2D(HEX_I); g.globalAlpha = 0.10; g.fillStyle = r.color; g.fill(inner); g.globalAlpha = 0.45; g.strokeStyle = r.color; g.lineWidth = 1.6; g.stroke(inner); g.globalAlpha = 1; }
    if (on && rk >= 3) { g.fillStyle = rk === 4 ? '#F9E9A8' : r.color; hexPts(45).forEach(([px, py]) => { g.beginPath(); g.arc(px, py, 3.4, 0, Math.PI * 2); g.fill(); }); }
    if (on && rk >= 2) { g.globalAlpha = 0.9; g.fillStyle = rk === 4 ? '#F9E9A8' : r.color; g.fill(new Path2D('M50 9.5l3 4.2h-6z')); g.globalAlpha = 1; }
    const gp = new Path2D(GLYPH[(b && b.category) || 'learn'] || GLYPH.learn), gl = on ? (rk === 4 ? '#F2D688' : r.color) : LOCK.glyph;
    if (b && b.category === 'member') { g.globalAlpha = 0.22; g.fillStyle = gl; g.fill(gp); g.globalAlpha = 1; }
    g.strokeStyle = gl; g.lineWidth = 4.6; g.stroke(gp);
    if (on && (o.verified != null ? o.verified : b && b.verified)) {
      g.beginPath(); g.arc(CHECK_C[0], CHECK_C[1], CHECK_C[2], 0, Math.PI * 2); g.fillStyle = '#D4A843'; g.fill(); g.strokeStyle = '#0a0a0f'; g.lineWidth = 2.5; g.stroke();
      g.strokeStyle = '#17130a'; g.lineWidth = 3.2; g.stroke(new Path2D(CHECK_P));
    }
    g.restore();
  };

  /* =================================================================
     UNLOCK TOAST: one on screen at a time, the rest queue. aria-live
     polite; pauses on hover/focus; no slide under reduced motion.
     ================================================================= */
  const CSS = `
  .bbi-bt{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:9000;width:min(440px,calc(100vw - 32px));
    transform:translate(-50%,24px);opacity:0;pointer-events:none;transition:transform .34s cubic-bezier(.2,.8,.2,1),opacity .34s ease}
  .bbi-bt.on{transform:translate(-50%,0);opacity:1;pointer-events:auto}
  .bbi-bt[popover]{margin:0;inset:auto auto calc(16px + env(safe-area-inset-bottom,0px)) 50%;border:0;padding:0;background:transparent;color:inherit;overflow:visible}
  .bbi-bt-card{display:flex;align-items:center;gap:14px;padding:12px 12px 12px 12px;border-radius:16px;color:#f4f4f8;
    background:linear-gradient(135deg,color-mix(in srgb,var(--bt-c) 16%,transparent),transparent 62%),#141419;
    border:1px solid color-mix(in srgb,var(--bt-c) 55%,transparent);
    box-shadow:0 18px 50px -12px rgba(0,0,0,.8),0 0 30px -8px color-mix(in srgb,var(--bt-c) 70%,transparent)}
  .bbi-bt-medal{flex:none;filter:drop-shadow(0 0 12px color-mix(in srgb,var(--bt-c) 55%,transparent))}
  .bbi-bt-t{display:grid;gap:2px;min-width:0;flex:1}
  .bbi-bt-k{font:600 10px/1.2 var(--font-mono,'JetBrains Mono',monospace);letter-spacing:.1em;text-transform:uppercase;color:var(--bt-c)}
  .bbi-bt-n{font:700 15px/1.3 var(--font-body,Inter,system-ui,sans-serif);color:#f4f4f8}
  .bbi-bt-n span{color:var(--bt-c);font-weight:600}
  .bbi-bt-a{font:600 13px/1.3 var(--font-body,Inter,system-ui,sans-serif);color:#e8c878;text-decoration:underline;text-underline-offset:2px;justify-self:start}
  .bbi-bt-x{flex:none;align-self:flex-start;width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:#8a8a98;font-size:18px;line-height:1;cursor:pointer}
  .bbi-bt-x:hover{background:rgba(255,255,255,.06);color:#f4f4f8}
  .bbi-bt a:focus-visible,.bbi-bt-x:focus-visible{outline:2px solid #e8c878;outline-offset:2px}
  @media (max-width:767px){body.nfl-has-mbar .bbi-bt{bottom:calc(86px + env(safe-area-inset-bottom,0px))}}
  @media (prefers-reduced-motion:reduce){.bbi-bt{transition:opacity .01s;transform:translate(-50%,0)}}`;
  let tq = [], tEl = null, tBusy = false, tTimer = 0, tLeft = 0, tStart = 0, tHold = false;
  const toastEl = () => {
    if (tEl) return tEl;
    if (!document.getElementById('bbi-badges-css')) { const st = document.createElement('style'); st.id = 'bbi-badges-css'; st.textContent = CSS; document.head.appendChild(st); }
    tEl = document.createElement('div');
    tEl.className = 'bbi-bt'; tEl.id = 'bbiBadgeToast';
    tEl.setAttribute('role', 'status'); tEl.setAttribute('aria-live', 'polite'); tEl.setAttribute('aria-atomic', 'true');
    // core.js's page-enter animation leaves a transform on <body>, which would pin a position:fixed toast to the end of the
    // page. A manual popover sits in the top layer (immune to that); older browsers get it as a child of <html> instead.
    if ('popover' in HTMLElement.prototype) { tEl.setAttribute('popover', 'manual'); document.body.appendChild(tEl); }
    else document.documentElement.appendChild(tEl);
    const hold = on => { if (!tBusy) return; if (on && !tHold) { tHold = true; clearTimeout(tTimer); tLeft -= Date.now() - tStart; } else if (!on && tHold) { tHold = false; arm(Math.max(1800, tLeft)); } };
    tEl.addEventListener('pointerenter', () => hold(true)); tEl.addEventListener('pointerleave', () => hold(false));
    tEl.addEventListener('focusin', () => hold(true)); tEl.addEventListener('focusout', e => { if (!tEl.contains(e.relatedTarget)) hold(false); });
    tEl.addEventListener('click', e => { if (e.target.closest('.bbi-bt-x')) hideToast(); });
    tEl.addEventListener('keydown', e => { if (e.key === 'Escape') hideToast(); });
    return tEl;
  };
  const arm = ms => { tStart = Date.now(); tLeft = ms; clearTimeout(tTimer); tTimer = setTimeout(hideToast, ms); };
  const hideToast = () => {
    clearTimeout(tTimer); tHold = false;
    if (!tEl || !tBusy) return;
    tEl.classList.remove('on');
    setTimeout(() => { try { if (tEl.hidePopover && tEl.matches(':popover-open')) tEl.hidePopover(); } catch {} tBusy = false; tEl.innerHTML = ''; nextToast(); }, reduced() ? 60 : 380);
  };
  const nextToast = async () => {
    if (tBusy || !tq.length) return;
    tBusy = true;
    const id = tq.shift();
    await catalog();
    const b = badgeOf(id);
    if (!b) { tBusy = false; nextToast(); return; }
    const r = rarityOf(b), el = toastEl();
    const onCase = /^\/badges(\/|\/index\.html)?$/.test(window.location.pathname);
    el.style.setProperty('--bt-c', r.color);
    el.innerHTML = `<div class="bbi-bt-card">
      <span class="bbi-bt-medal">${medalSvg(b, { earned: true, size: 56 })}</span>
      <span class="bbi-bt-t"><span class="bbi-bt-k">Badge unlocked</span>
        <span class="bbi-bt-n">${esc(b.name)} <span>· ${esc(r.label)}</span></span>
        ${onCase ? '' : '<a class="bbi-bt-a" href="badges/">See your Trophy Room</a>'}</span>
      <button type="button" class="bbi-bt-x" aria-label="Dismiss">×</button></div>`;
    try { if (el.showPopover && !el.matches(':popover-open')) el.showPopover(); } catch {}
    void el.offsetWidth;
    el.classList.add('on');
    arm(6000);
  };
  const toast = id => {
    if (!toastsOn || !document.body) return;
    if (tq.includes(id)) return;
    tq.push(id);
    nextToast();
  };

  /* ---------------- automatic hooks (no page edits needed) ---------------- */
  const autoHooks = () => {
    if (memory) return;
    const path = window.location.pathname;
    if (/^\/nfl(\/|$)/.test(path)) count('weeks', isoWeek());                               // regular / iron_man
    if (/^\/nfl\/lock(\/|$)/.test(path) && etParts().wd === 'Sun') earn('sunday_ritual');   // Before You Lock on a Sunday ET
    // article pages: a read = 60% scrolled or 45 s on screen (bookworm / scholar)
    const data = document.getElementById('article-data');
    if (data && !/test_preview/.test(path)) {
      let slug = ''; try { slug = String(JSON.parse(data.textContent).slug || ''); } catch {}
      slug = slug.replace(/[^a-z0-9-]/gi, '').slice(0, 32);
      if (!slug) return;
      const art = document.querySelector('article') || document.querySelector('main') || document.body;
      let done = false, secs = 0;
      const markRead = () => { if (done) return; done = true; window.removeEventListener('scroll', onScroll); clearInterval(tick); count('articles', slug); };
      const onScroll = () => { const r = art.getBoundingClientRect(); if (r.height > 0 && (window.innerHeight - r.top) / r.height >= 0.6) markRead(); };
      const tick = setInterval(() => { if (document.visibilityState === 'visible' && ++secs >= 45) markRead(); }, 1000);
      window.addEventListener('scroll', onScroll, { passive: true });
      setTimeout(onScroll, 1500);
    }
  };

  /* ---------------- public ---------------- */
  const api = {
    VER, RARITY, PROGRESS, earn, count, seen, progress, progressFor, sync, quiz, catalog, fromDna, watchTerms, medalSvg, drawMedal, isoWeek,
    serverOnly, rarityOf,
    state: () => read(),
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    signedIn: () => { const a = authApi(); return !!(a && a.isLoggedIn()); },
    memory,
    // queue entry point (BBI.badgeQ in nfl.js): ('earn', id, meta) · ('count', counter, key) · ('seen', el, counter, key)
    call(method, ...args) { const f = { earn, count, seen }[method]; return f ? f(...args) : undefined; },
    // ?selftest=badges only: swap in a fake state (in memory, never saved) and optionally allow the toast
    _seed(st, { toasts = false } = {}) { if (!memory) return false; mem = tidy(st); toastsOn = !!toasts; emit(); return true; },
    _toast: id => toast(id)
  };
  BBI.badges = api;
  BBI.badgeQ = BBI.badgeQ || ((...a) => api.call(...a));

  const boot = () => {
    catalog();
    migrateDna();
    const q = BBI._badgeQ || []; BBI._badgeQ = [];
    q.forEach(a => { try { api.call(...a); } catch {} });
    autoHooks();
    watchAuth();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
