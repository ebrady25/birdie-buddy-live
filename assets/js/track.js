/* =====================================================================
   BIRDIEBUDDY — FIRST-PARTY EVENT TRACKING  (BBI.track)
   ---------------------------------------------------------------------
   BBI.track(event, props) queues a small row and batches it into the
   Supabase table public.nfl_events through the auth.js client
   (migration: supabase/migrations/20260922_nfl_events.sql).

     • no third parties, no cookies, no fingerprinting
     • no PII: props are short primitives (never names, emails, file
       names or free text); the row carries a random per-tab session id,
       a viewport bucket and the path. user_id is filled server-side
       (default auth.uid()) only when the visitor is signed in.
     • Do-Not-Track / Global Privacy Control / localStorage
       'bbi_track_off' = '1' → nothing is queued or sent.
     • silent: if auth.js / the client is missing it switches itself off
       for the tab; if an insert is refused (table not created yet, RLS)
       it stays off on this device for 24 h, so an unapplied migration
       costs one failed request per visitor per day.
     • sends only from birdiebuddy.io; anywhere else (local preview,
       headless checks) events land in BBI.track.log and nowhere else.
   ===================================================================== */
window.BBI = window.BBI || {};

(() => {
  'use strict';
  if (window.BBI.track) return;   // idempotent

  const TABLE = 'nfl_events';
  const EVENTS = new Set(['page_view', 'preset_select', 'slider_commit', 'lab_player_add', 'lab_lineup_complete', 'celebrate',
    'file_load', 'batch_score', 'book_pick', 'build_for_me', 'share_link_copy', 'review_load', 'gate_view', 'attack_toggle']);
  const SEND_HOST = /(^|\.)birdiebuddy\.io$/i;
  const FLUSH_MS = 5000, BATCH = 25, MAX_QUEUE = 200, MAX_PER_PAGE = 400, AUTH_WAIT_MS = 20000;
  const LS_OFF = 'bbi_track_off', LS_PAUSE = 'bbi_track_refused_until', SS_OFF = 'bbi_track_dead', SS_SID = 'bbi_track_sid';
  const PAUSE_MS = 24 * 3600 * 1000;   // a refused insert (table not created yet, RLS) → retry tomorrow, not every tab

  /* ---------------- pure helpers (node-testable) ---------------- */
  const KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;
  // Props → at most 12 short primitives. Strings are cut to 48 chars; objects/arrays are dropped.
  const clean = props => {
    const out = {};
    if (!props || typeof props !== 'object') return out;
    let n = 0;
    for (const k of Object.keys(props)) {
      if (n >= 12) break;
      if (!KEY_RE.test(k)) continue;
      const v = props[k];
      if (typeof v === 'boolean') out[k] = v;
      else if (typeof v === 'number') { if (Number.isFinite(v)) out[k] = Math.round(v * 1000) / 1000; else continue; }
      else if (typeof v === 'string') out[k] = v.slice(0, 48);
      else continue;
      n++;
    }
    // the table caps props at 1 KB; drop trailing keys rather than lose the row
    const keys = Object.keys(out);
    while (keys.length && JSON.stringify(out).length > 900) delete out[keys.pop()];
    return out;
  };
  const dntOn = (nav, win) => !!(nav && (nav.doNotTrack === '1' || nav.doNotTrack === 'yes' || nav.msDoNotTrack === '1' || nav.globalPrivacyControl === true)) || !!(win && win.doNotTrack === '1');
  // Size buckets for counts (batch sizes, entries, contest entries).
  const size = n => { n = +n || 0; return n <= 0 ? '0' : n <= 1 ? '1' : n <= 4 ? '2-4' : n <= 10 ? '5-10' : n <= 20 ? '11-20' : n <= 50 ? '21-50' : n <= 150 ? '51-150' : n <= 1000 ? '151-1k' : n <= 10000 ? '1k-10k' : n <= 100000 ? '10k-100k' : '100k+'; };
  // Codex score band (the Lab's verdict tiers).
  const band = (score, legal) => legal === false ? 'illegal' : score == null ? 'none' : score >= 85 ? '85+' : score >= 70 ? '70-84' : score >= 50 ? '50-69' : '<50';
  const vpBucket = w => w < 400 ? 'xs' : w < 768 ? 'sm' : w < 1100 ? 'md' : 'lg';
  const pageOf = p => String(p || '/').replace(/index\.html$/, '').replace(/^\/+|\/+$/g, '').slice(0, 64) || 'home';

  const api = (event, props) => { try { push(event, props); } catch {} };
  Object.assign(api, { clean, dntOn, size, band, vpBucket, pageOf, EVENTS, log: [], enabled: false, sending: false });
  window.BBI.track = api;

  const doc = window.document;
  if (!doc || !doc.addEventListener) return;   // node / non-browser: helpers only

  /* ---------------- state ---------------- */
  const ls = { get: k => { try { return window.localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { window.localStorage.setItem(k, v); } catch {} } };
  const ss = { get: k => { try { return window.sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { window.sessionStorage.setItem(k, v); } catch {} } };
  const off = dntOn(window.navigator, window) || ls.get(LS_OFF) === '1' || ss.get(SS_OFF) === '1' || +ls.get(LS_PAUSE) > Date.now();
  const send = !off && SEND_HOST.test(window.location.hostname);
  api.enabled = !off; api.sending = send;
  const rnd = () => { try { const a = new Uint8Array(8); window.crypto.getRandomValues(a); return [...a].map(b => b.toString(16).padStart(2, '0')).join(''); } catch { return Math.random().toString(16).slice(2, 18); } };
  let sid = ss.get(SS_SID); if (!sid || !/^[0-9a-f]{8,16}$/.test(sid)) { sid = rnd(); ss.set(SS_SID, sid); }
  const page = pageOf(window.location.pathname);
  const mobile = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  let queue = [], count = 0, dead = off, fails = 0, timer = 0, token = null, cfg = null;

  function push(event, props) {
    if (dead || !EVENTS.has(event) || count >= MAX_PER_PAGE) return;
    count++;
    const row = { event, props: clean(props), page, sid, vp: vpBucket(window.innerWidth || 0), mobile, client_ts: new Date().toISOString() };
    api.log.push(row); if (api.log.length > 200) api.log.shift();
    if (!send) return;
    queue.push(row); if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    if (!timer) timer = setTimeout(flush, FLUSH_MS);
  }
  const kill = pause => { dead = true; queue = []; api.enabled = false; ss.set(SS_OFF, '1'); if (pause) ls.set(LS_PAUSE, String(Date.now() + PAUSE_MS)); };

  /* ---------------- transport ---------------- */
  // auth.js loads async (nfl.js / data.js inject it); wait for it, then use its Supabase client.
  let authReady = null;
  const waitAuth = () => authReady || (authReady = new Promise(res => {
    const t0 = Date.now();
    const poll = () => { const a = window.BBI.auth; if (a && a.client) return res(a); if (Date.now() - t0 > AUTH_WAIT_MS) return res(null); setTimeout(poll, 250); };
    poll();
  }));
  const refused = (err, status) => {
    const code = err && (err.code || '');
    return status === 401 || status === 403 || status === 404 || /^(42P01|42501|PGRST20[45]|PGRST301)$/.test(code) || /relation .* does not exist|permission denied|row-level security/i.test((err && err.message) || '');
  };
  async function flush() {
    timer = 0;
    if (dead || !queue.length) return;
    const a = await waitAuth();
    if (!a) { kill(); return; }
    let sb;
    try { sb = await a.client(); cfg = a.supabaseConfig || cfg; } catch { kill(); return; }
    try { token = a.backend && a.backend.accessToken ? await a.backend.accessToken() : null; } catch { token = null; }
    const rows = queue.splice(0, BATCH);
    try {
      const { error, status } = await sb.from(TABLE).insert(rows);
      if (error) { if (refused(error, status)) { kill(true); return; } throw error; }
      fails = 0;
    } catch (e) {
      if (++fails >= 3) { kill(); return; }
      queue = rows.concat(queue).slice(-MAX_QUEUE);
    }
    if (queue.length && !timer) timer = setTimeout(flush, FLUSH_MS);
  }
  // Leaving the page: one keepalive POST straight to PostgREST so the last events aren't lost.
  const beacon = () => {
    if (dead || !queue.length || !cfg || !window.fetch) return;
    const rows = queue.splice(0, BATCH);
    const headers = { 'Content-Type': 'application/json', apikey: cfg.key, Prefer: 'return=minimal' };
    if (token) headers.Authorization = `Bearer ${token}`;
    try { window.fetch(`${cfg.url}/rest/v1/${TABLE}`, { method: 'POST', keepalive: true, headers, body: JSON.stringify(rows) }).catch(() => {}); } catch {}
  };
  if (send) {
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') beacon(); });
    window.addEventListener('pagehide', beacon);
  }

  /* ---------------- automatic events ---------------- */
  // page_view: the step a deep link lands on, and whether it came from a shared link.
  const q = window.location.search || '';
  push('page_view', { step: (/^#(step[1-5]|sdLabPro)$/.exec(window.location.hash || '') || [])[1] || '', shared: /[?&](slate|lu|spread|total)=/.test(q) });

  // gate_view: a locked [data-gate] region (auth.js adds .bbi-locked) scrolled into view, once per region.
  // Inert while the NFL pages are in open preview (their gates are data-gate-paused).
  const seenGates = new WeakSet();
  let io = null;
  const scanGates = () => {
    if (dead) return;
    const locked = doc.querySelectorAll('[data-gate].bbi-locked');
    if (!locked.length) return;
    if (!io && 'IntersectionObserver' in window) io = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting || seenGates.has(e.target)) return;
      seenGates.add(e.target); io.unobserve(e.target);
      const sec = e.target.closest('section[id]');
      push('gate_view', { tier: e.target.getAttribute('data-gate') || '', section: sec ? sec.id : '' });
    }), { threshold: 0.25 });
    locked.forEach(el => { if (io && !seenGates.has(el)) io.observe(el); });
  };
  waitAuth().then(a => {
    if (!a) { if (send) kill(); return; }
    cfg = a.supabaseConfig || null;
    if (send && a.backend && a.backend.accessToken) a.backend.accessToken().then(t => { token = t || null; }, () => {});
    scanGates();
    if (a.onChange) a.onChange(() => setTimeout(scanGates, 0));
  });
})();
