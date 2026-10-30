/* =====================================================================
   BIRDIEBUDDY — LINEUP LAB PAGE (/nfl/lab/)
   Two tabs on one page:
   - Showdown: showdown.js runs headless (BBI.sdHeadless: data, slates,
     state and the link's slate / lu= built exactly as on Grind, no Grind
     DOM), then the existing Lab (showdown_lab.js) mounts on #sdLab and
     #sdLabPro. The slate picker here drives showdown.js state.
   - Classic: classic_engine.js check() + classic.js parseLineup /
     slotOrder / rolesFor (BBI.classicHeadless: the playbook renderer
     never starts) on this week's pool (nfl/classic/pools/latest.json).
   Each tab draws one plain-English grade line and a DK upload export.
   Links: ?mode=showdown&slate=<id>&lu=<tokens> (Grind's token format)
          ?mode=classic&lu=<9 name slugs or DK ids, '-'-joined>
   Files are read in the browser only; nothing is uploaded.
   ===================================================================== */
(() => {
  'use strict';
  const BBI = window.BBI = window.BBI || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = v => '$' + Math.round(+v || 0).toLocaleString('en-US');
  const pct0 = v => `${Math.round(+v || 0)}%`;
  const nameSlug = n => String(n ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const LS_TAB = 'bbi_lab_tab', LS_CL = 'bbi_lab_classic';

  /* ---------------- tab + flags (before any engine script loads) ---------------- */
  const Q = new URLSearchParams(location.search);
  const modeQ = Q.get('mode');
  let tab = modeQ === 'showdown' || modeQ === 'classic' ? modeQ : (Q.get('slate') || Q.get('lu')) ? 'showdown' : (lsGet(LS_TAB) === 'showdown' ? 'showdown' : 'classic');
  BBI.sdHeadless = { urlPrefix: 'mode=showdown', urlActive: () => tab === 'showdown' };
  BBI.classicHeadless = true;

  /* ---------------- script loading (each file once, in order) ---------------- */
  const SRC = {
    engine: 'assets/js/showdown_engine.js?v=0.6.5',
    fx: 'assets/js/showdown_fx.js?v=0.6.3',
    sd: 'assets/js/showdown.js?v=r2a',
    build: 'assets/js/showdown_build.js?v=0.6.3',
    lab: 'assets/js/showdown_lab.js?v=r2b',
    clEngine: 'assets/js/classic_engine.js?v=0.6.5',
    classic: 'assets/js/classic.js?v=r2a'
  };
  const SETS = { showdown: ['fx', 'sd', 'engine', 'build', 'lab'], classic: ['engine', 'clEngine', 'classic'] };
  const asked = new Map();
  const loadSrc = key => {
    if (asked.has(key)) return asked.get(key);
    const p = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = SRC[key]; s.async = false;
      s.onload = () => res(); s.onerror = () => rej(new Error(`${SRC[key].split('?')[0]} did not load`));
      document.body.appendChild(s);
    });
    asked.set(key, p); return p;
  };
  const loadSet = name => Promise.all(SETS[name].map(loadSrc));
  const SD = () => BBI.showdown, SL = () => BBI.showdownLab;

  /* ---------------- toast (shared #sdToast) ---------------- */
  let toastT = 0;
  const toast = (msg, kind = '') => { const t = $('sdToast'); if (!t) return; t.className = `sd-toast show ${kind}`; t.innerHTML = msg; clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'sd-toast'; }, 2600); };
  const copyText = async (text, okMsg) => {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {}
    if (!ok) { try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch {} }
    toast(ok ? okMsg : 'Copy failed: your browser blocked the clipboard', ok ? '' : 'warn');
  };
  const download = (csv, name) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const gradeHtml = (tone, parts, sub, acts) => `<div class="lb-grade-k">Grade</div>
    <p class="lb-grade-line">${parts.filter(Boolean).map(p => `<span class="${p.c || ''}">${p.b ? `<b>${esc(p.t)}</b>` : esc(p.t)}</span>`).join('<span class="lb-sep" aria-hidden="true">·</span>')}</p>
    ${sub ? `<p class="lb-grade-sub">${sub}</p>` : ''}${acts ? `<div class="lb-grade-acts">${acts}</div>` : ''}`;
  const setGrade = (el, tone, html) => { if (!el) return; el.className = `lb-grade ${tone || ''}`; if (el.dataset.drawn !== html) { el.innerHTML = html; el.dataset.drawn = html; } };
  const media = q => { try { return matchMedia(q).matches; } catch { return false; } };
  const phone = () => media('(max-width: 600px)');
  // After a lineup fills (a paste or the last tap), bring its grade into view; a no-op when it's already on screen.
  const showGrade = id => {
    const el = $(id); if (!el || !el.getBoundingClientRect) return;
    const r = el.getBoundingClientRect(), top = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    if (r.top >= top && r.bottom <= innerHeight) return;
    try { el.scrollIntoView({ behavior: media('(prefers-reduced-motion: reduce)') ? 'auto' : 'smooth', block: 'start' }); } catch {}
  };

  /* ---------------- forgiving paste match ----------------
     The engines' resolve() stays strict (the parity tests pin it); pasted names go through this instead.
     Same matcher as showdown_lab.js looseMatcher: accents, case and . ' ’ - ignored; Jr./Sr./II/III/IV
     dropped; a DST by team code, city, full name or nickname ("CIN", "CIN DST", "Cincinnati Bengals",
     "Bengals D/ST"); a few common nicknames; then a unique last name (first initial when given), then a
     unique word or substring. */
  const NFL_TEAMS = { ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills', CAR: 'Carolina Panthers', CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns', DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers', HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars', KC: 'Kansas City Chiefs', LV: 'Las Vegas Raiders', LAC: 'Los Angeles Chargers', LAR: 'Los Angeles Rams', MIA: 'Miami Dolphins', MIN: 'Minnesota Vikings', NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants', NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers', SF: 'San Francisco 49ers', SEA: 'Seattle Seahawks', TB: 'Tampa Bay Buccaneers', TEN: 'Tennessee Titans', WAS: 'Washington Commanders' };
  const TEAM_ALIAS = { jac: 'JAX', jags: 'JAX', wsh: 'WAS', lvr: 'LV', niners: 'SF', bucs: 'TB', pats: 'NE', bolts: 'LAC' };
  const NICKNAMES = { cmc: 'christian mccaffrey', arsb: 'amon ra st brown', 'amon ra': 'amon ra st brown', puka: 'puka nacua', bijan: 'bijan robinson', jsn: 'jaxon smith njigba', jj: 'justin jefferson', jjettas: 'justin jefferson', mhj: 'marvin harrison', btj: 'brian thomas', kw3: 'kenneth walker', 'ken walker': 'kenneth walker', 'kenny walker': 'kenneth walker', jt: 'jonathan taylor', jamo: 'jameson williams', tlaw: 'trevor lawrence', ajb: 'aj brown', dk: 'dk metcalf', cd: 'ceedee lamb', 'hollywood brown': 'marquise brown', 'tank dell': 'nathaniel dell', jjm: 'jj mccarthy' };
  const SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
  const foldName = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.'’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(w => w && !SUFFIX.has(w)).join(' ');
  const TEAM_KEYS = (() => {
    const m = new Map(), city = new Map();
    for (const [c, full] of Object.entries(NFL_TEAMS)) {
      const w = foldName(full).split(' '), nick = w.pop(), ct = w.join(' ');
      m.set(c.toLowerCase(), c); m.set(`${ct} ${nick}`, c); m.set(nick, c); city.set(ct, city.has(ct) ? null : c);
    }
    for (const [ct, c] of city) if (c && !m.has(ct)) m.set(ct, c);   // "new york" / "los angeles" stay ambiguous
    for (const [a, c] of Object.entries(TEAM_ALIAS)) m.set(a, c);
    return m;
  })();
  const looseMatcher = (P, strict) => {
    const rows = [...P.keys()].map(n => { const k = foldName(n), w = k.split(' '); return { n, k, t: k.replace(/ /g, ''), first: w[0] || '', last: w[w.length - 1] || '' }; });
    const one = a => (a.length === 1 ? a[0].n : null);
    const dstOf = code => { const d = [...P].filter(([, p]) => p && p.pos === 'DST' && p.team === code); return d.length === 1 ? d[0][0] : null; };
    return cell => {
      const hit = strict(cell); if (hit) return hit;
      const raw = String(cell ?? '').trim().replace(/^"+|"+$/g, '').replace(/\s*\((\d+|cpt|captain)\)\s*$/i, '').replace(/^(CPT|CAPTAIN|FLEX|UTIL|QB|RB|WR|TE|DST|DEF|D\/ST)\s*[:\-–]?\s+(?=\S)/i, '');
      if (raw !== String(cell ?? '').trim()) { const h = strict(raw); if (h) return h; }
      const q = foldName(raw); if (!q) return null;
      const qt = q.replace(/ /g, ''), qw = q.split(' ');
      // a defense: team code, city, nickname or full name, with or without DST / D/ST / Defense
      const code = TEAM_KEYS.get(q.replace(/\b(dst|d st|def|defen[cs]e)\b/g, ' ').replace(/\s+d$/, '').replace(/\s+/g, ' ').trim());
      let m = code && dstOf(code); if (m) return m;
      if ((m = one(rows.filter(r => r.t === qt)))) return m;
      const nk = NICKNAMES[q] || NICKNAMES[qt]; if (nk && (m = one(rows.filter(r => r.k === nk)))) return m;
      const last = qw[qw.length - 1];
      if ((m = one(rows.filter(r => r.last === last && (qw.length === 1 || r.first[0] === qw[0][0]))))) return m;
      if ((m = one(rows.filter(r => ` ${r.k} `.includes(` ${q} `))))) return m;
      return qt.length >= 3 ? one(rows.filter(r => r.t.includes(qt))) : null;
    };
  };

  /* =================================================================
     TABS
     ================================================================= */
  const started = { showdown: false, classic: false };
  const setTab = (t, focus) => {
    tab = t; lsSet(LS_TAB, t);
    for (const k of ['classic', 'showdown']) {
      const b = $(k === 'classic' ? 'lbTabClassic' : 'lbTabShowdown'), p = $(k === 'classic' ? 'lbClassic' : 'lbShowdown');
      const on = k === t; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; p.hidden = !on;
      if (on && focus) b.focus();
    }
    if (t === 'showdown') startShowdown(); else startClassic();
    syncTabUrl();
  };
  const syncTabUrl = () => {
    if (tab === 'classic') return clUrl();
    if (SL() && SL().urlInfo && SL().urlInfo()) { SD().syncUrl(); return; }
    const q = new URLSearchParams(location.search); if (q.get('mode') === 'showdown') return;
    const keep = ['slate', 's', 't', 'env', 'c', 'n', 'lu'].filter(k => q.get(k) != null).map(k => `${k}=${encodeURIComponent(q.get(k))}`);
    try { history.replaceState(history.state, '', `${location.pathname}?${['mode=showdown', ...keep].join('&')}`); } catch {}
  };
  const bindTabs = () => {
    const tl = document.querySelector('.lb-tabs');
    tl.addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b && b.dataset.tab !== tab) setTab(b.dataset.tab); });
    tl.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); setTab(tab === 'classic' ? 'showdown' : 'classic', true);
    });
  };

  /* =================================================================
     SHOWDOWN TAB
     ================================================================= */
  const startShowdown = () => {
    if (started.showdown) return; started.showdown = true;
    // Same prefetch Grind does in <head>: showdown.js takes each response once.
    window.__sdPrefetch = window.__sdPrefetch || {};
    ['nfl/showdown/showdown_playbook.json', 'nfl/showdown/showdown_slates.json'].forEach(u => { try { const p = fetch(u, { cache: 'no-cache' }); p.catch(() => {}); window.__sdPrefetch[u] = p; } catch {} });
    document.addEventListener('sd:ready', onSdReady, { once: true });
    loadSet('showdown').catch(e => { $('lbSdBar').innerHTML = `<p class="lb-muted">The Showdown Lab didn't load (${esc(e.message)}). Refresh, or open the <a href="nfl/showdown/">Showdown playbook</a>.</p>`; });
  };
  const onSdReady = () => {
    drawSdBar(); drawSdGrade();
    document.addEventListener('sd:render', () => { drawSdBar(); drawSdGrade(); });
    document.addEventListener('sd:labscore', drawSdGrade);
    $('lbSdBar').addEventListener('change', onSdBar);
    $('lbSdBar').addEventListener('click', onSdBar);
    $('lbShowdown').addEventListener('click', onSdClick);
    $('lbShowdown').addEventListener('keydown', onSdKey);
    // A tap or key inside the Lab (or the paste box) counts as the reader's own edit: only those scroll to the grade.
    ['click', 'keydown'].forEach(ev => $('sdLab').addEventListener(ev, () => { sdUserAt = Date.now(); }, true));
    if (phone() && !(SL() && SL().filled())) $('lbSdQuick').open = true;
  };
  // Plain contest-size labels (Grind's pills say SE <5k / 5k–25k / 25k+).
  const SD_CONTEST = { se_small: 'Under 5k entries', mid: '5k–25k entries', large: '25k+ entries' };
  const ENVW = { dome: 'dome', outdoor_mild: 'outdoors', cold_le32: 'cold', wind_10_14: 'windy', wind_15_plus: 'very windy' };
  const drawSdBar = () => {
    const S = SD(); if (!S || !S.data) return;
    const st = S.state, sl = S.slates || [];
    const opt = x => `<option value="${esc(x.id)}"${x.id === st.preset ? ' selected' : ''}>${esc(x.label)} · ${esc(x.fav)} −${x.spread} · ${x.total}</option>`;
    const prime = sl.filter(x => !x.replay && S.slateTier(x) === 'primetime'), sun = sl.filter(x => !x.replay && S.slateTier(x) !== 'primetime'), rep = sl.filter(x => x.replay);
    const pre = sl.find(x => x.id === st.preset);
    const html = `
      <label class="lb-field lb-field-wide"><span>Game</span>
        <select class="lb-select" id="lbSdSlate" aria-label="Pick the showdown game">
          ${pre ? '' : `<option value="" selected>Custom line: ${esc(String(st.spread))} / ${esc(String(st.total))}</option>`}
          ${prime.length ? `<optgroup label="Primetime this week">${prime.map(opt).join('')}</optgroup>` : ''}
          ${sun.length ? `<optgroup label="Sunday games">${sun.map(opt).join('')}</optgroup>` : ''}
          ${rep.length ? `<optgroup label="Replays (past games)">${rep.map(opt).join('')}</optgroup>` : ''}
        </select></label>
      <div class="lb-field"><span>Contest size</span><span class="seg" role="group" aria-label="Contest size (entries)">${S.data.inputs.contest_types.map(c => `<button type="button" class="${c.key === st.contest ? 'active' : ''}" aria-pressed="${c.key === st.contest}" data-sd-contest="${esc(c.key)}">${esc(SD_CONTEST[c.key] || S.CONTEST_SHORT[c.key] || c.label)}</button>`).join('')}</span></div>
      <label class="lb-field"><span>Lineups</span><input class="lb-num" id="lbSdN" type="number" min="1" max="150" step="1" value="${st.entries}" aria-label="How many lineups you are building"></label>
      <div class="lb-bar-note">${pre ? `${esc(pre.label)}: ${esc(pre.fav)} favored by ${pre.spread}, total ${pre.total}, ${esc(ENVW[pre.env] || pre.env)}${pre.replay ? ' (a past game, for practice)' : ''}.` : 'A custom line from a shared link or Grind.'} Pick a captain and five more players below, or paste a lineup; the grade updates as you go.</div>`;
    const host = $('lbSdBar');
    if (host.dataset.drawn === html) return;
    const n = $('lbSdN'), typing = n && document.activeElement === n;
    if (typing) { const sel = $('lbSdSlate'); if (sel) sel.value = st.preset || ''; return; }
    host.innerHTML = html; host.dataset.drawn = html;
  };
  const onSdBar = e => {
    const S = SD(); if (!S || !S.data) return;
    if (e.type === 'change' && e.target.id === 'lbSdSlate') {
      const s = (S.slates || []).find(x => x.id === e.target.value); if (!s) return;
      if (S.slateTier(s) !== 'primetime') S.state.attack = true;   // a Sunday game: let the Lab's pool chips show it
      Object.assign(S.state, { spread: s.spread, total: s.total, env: s.env, preset: s.id, realized: null });
      S.render(); return;
    }
    if (e.type === 'change' && e.target.id === 'lbSdN') {
      const v = Math.max(1, Math.min(150, Math.round(+e.target.value || 1))); S.state.entries = v; e.target.value = v; S.render(); return;
    }
    const c = e.type === 'click' && e.target.closest('[data-sd-contest]');
    if (c) { S.state.contest = c.dataset.sdContest; S.state.cutKey = null; SL() && (SL().lab.field = null); S.render(); }
  };
  // Grind's page handlers (data-jump / copy link / share card) don't run headless: the same actions, here.
  const onSdClick = e => {
    const S = SD(); if (!S || !S.data) return;
    const j = e.target.closest('[data-jump]');
    if (j) { const el = $(j.dataset.jump); if (el) { e.preventDefault(); const f = el.closest('details'); if (f) f.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } return; }
    const cl = e.target.closest('[data-copy-link]'); if (cl) { e.preventDefault(); S.copyLink('', cl); return; }
    const sh = e.target.closest('[data-share]'); if (sh) { e.preventDefault(); S.sharePng(sh.dataset.share, sh); return; }
    const a = e.target.closest('[data-lb-sd]'); if (!a) return;
    const L = SL(); if (!L) return;
    if (a.dataset.lbSd === 'csv') { const csv = L.dkCsv(); if (csv) download(csv, `DK_upload_showdown_${(L.curPool() || {}).id || 'lineup'}.csv`); else toast('This game has no DraftKings player IDs yet: add your DraftKings salary file under Grade your own files', 'warn'); return; }
    if (a.dataset.lbSd === 'paste-go') { sdQuickPaste(); return; }
    if (a.dataset.lbSd === 'paste') {
      if (phone()) { const q = $('lbSdQuick'); q.open = true; $('lbSdQuickText').focus({ preventScroll: true }); q.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
      const p = $('sdPaste'); if (p) { p.hidden = false; $('sdPasteIn').focus(); p.scrollIntoView({ block: 'center', behavior: 'smooth' }); } return;
    }
  };
  const onSdKey = e => { if (e.target.id === 'lbSdQuickText' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sdQuickPaste(); } };
  // The phone paste box (#lbSdQuick) hands its text to the Lab's own paste (#sdPasteIn + paste-go), so matching,
  // captain-first and the warnings stay in showdown_lab.js; the text clears once a lineup lands.
  let sdUserAt = 0, sdPrevN = null;
  const sdKey = L => [L.lab.cpt, ...L.lab.flex].join('|');
  const sdQuickPaste = () => {
    const L = SL(), ta = $('lbSdQuickText'), inp = $('sdPasteIn'), go = $('sdLab').querySelector('[data-lab-act="paste-go"]');
    if (!L || !L.engine || !inp || !go) { toast('The player pool is still loading: try again in a second', 'warn'); return; }
    const text = ta.value.split(/[\n,\t;]+/).map(x => x.trim()).filter(Boolean).join(', ');
    if (!text) { toast('Paste 6 names first, captain first', 'warn'); ta.focus(); return; }
    const before = sdKey(L), q = $('lbSdQuick'); sdUserAt = Date.now();
    q.open = false;   // collapsed before the Lab re-renders, so a 6th player scrolls to the grade's final spot
    inp.value = text; go.click();
    if (L.filled() && sdKey(L) !== before) { ta.value = ''; showGrade('lbSdGrade'); } else q.open = true;
  };

  // The plain-English grade: verdict · ownership · dupes · one thing to consider.
  const SIDE = { own: "the captain's team", opp: 'the other team' };
  const featText = (k, L) => {
    const m = /^(own|opp)_(QB|RB|WR|TE|K|DST)$/.exec(k);
    if (m) return `${{ QB: 'a QB', RB: 'an RB', WR: 'a WR', TE: 'a TE', K: 'a kicker', DST: 'a defense' }[m[2]]} from ${SIDE[m[1]]}`;
    return { own_second_catcher: "a second pass-catcher from the captain's team", own_second_rb: "a second RB from the captain's team", own_second_te: "a second TE from the captain's team", both_qbs: 'both QBs' }[k] || (L.FEAT_LABEL[k] || k.replace(/_/g, ' '));
  };
  const VERDICT_WORD = { elite: ['Built like past winners', 'lb-pos'], good: ['Strong build', 'lb-pos'], ok: ['Playable', 'lb-warn'], low: ["Doesn't look like past winners", 'lb-warn'], bad: ['Breaks a rule', 'lb-neg'], part: ['On track', ''] };
  const sdGrade = () => {
    const L = SL(), S = SD();
    if (!L || !S || !S.data || !L.engine) return { tone: '', html: gradeHtml('', [{ t: 'Loading the player pool…' }]) };
    const n = L.filled(), r = n ? L.scoreCurrent() : null;
    const acts = `<button type="button" class="btn btn-sm" data-lb-sd="paste">Paste a lineup</button>${n === 6 ? `<button type="button" class="btn btn-sm btn-primary" data-lb-sd="csv" ${L.hasIds() ? '' : 'disabled'} title="${L.hasIds() ? 'A file you can upload straight to DraftKings (captain + 5 player IDs)' : 'This game has no DraftKings player IDs yet'}">Download DraftKings upload file</button><button type="button" class="btn btn-sm" data-copy-link="">Copy link</button>` : ''}`;
    if (!r) return { tone: '', html: gradeHtml('', [{ t: n ? 'Pick a captain to get a grade' : 'Pick a captain and five more players', b: true }], 'Tap a player below to add him; the C button makes him captain. Captain scores 1.5× points and costs 1.5× salary.', acts) };
    const v = L.verdictFor(r, n), X = r.X, parts = [];
    let tone = v.cls === 'elite' || v.cls === 'good' ? 'good' : v.cls === 'bad' ? 'bad' : 'ok';
    if (r.hard.length) parts.push({ t: `Breaks ${r.hard.length} rule${r.hard.length > 1 ? 's' : ''}`, b: true, c: 'lb-neg' });
    else { const w = VERDICT_WORD[v.cls] || [v.title, '']; parts.push({ t: n < 6 ? `${n} of 6 · ${w[0].toLowerCase()}` : w[0], b: true, c: w[1] }); }
    const ct = S.data.inputs.contest_types.find(c => c.key === S.state.contest), tgt = ct && /(\d+)\D+(\d+)/.exec(ct.own_target);
    const has = L.engine.has || {};
    if (n === 6 && has.own) {
      const lo = tgt ? +tgt[1] : 110, hi = tgt ? +tgt[2] : 160;
      parts.push(X.cum > hi + 40 ? { t: 'lots of people will have these players', c: 'lb-warn' } : X.cum > hi ? { t: 'a lot of people will have these players', c: 'lb-warn' } : X.cum < lo - 30 ? { t: 'very few people will have these players' } : X.cum < lo ? { t: 'fewer people will have these players' } : { t: 'player popularity in the winning range', c: 'lb-pos' });
      const dp = X.est_dupes, gate = r.dupes ? r.dupes.gate : 2, dn = dp < 10 ? dp.toFixed(1) : Math.round(dp).toLocaleString('en-US');
      parts.push(dp > gate ? { t: `same lineup as ~${dn} others`, c: 'lb-warn' } : dp < 0.5 ? { t: 'probably no one else has this exact lineup', c: 'lb-pos' } : { t: `maybe ~${dn} others with this exact lineup` });
      if (dp > gate && tone === 'good') tone = 'ok';
    }
    // one thing to consider
    let con = null;
    const fail = r.rules.find(x => x.status === 'fail');
    const t = r.template;
    if (fail) con = `fix: ${fail.label}${fail.msg ? ` (${fail.msg})` : ''}`;
    else if (n < 6) con = `${6 - n} more to go`;
    else if (t && t.include.some(k => !X.feats[k])) con = `consider adding ${featText(t.include.find(k => !X.feats[k]), L)}`;
    else if (t && t.avoid.some(k => X.feats[k])) con = `consider dropping ${featText(t.avoid.find(k => X.feats[k]), L)}`;
    else if (has.own && tgt && X.cum > +tgt[2]) { const top = [...X.fl].sort((a, b) => b.own - a.own)[0]; if (top) con = `consider swapping ${top.name} (picked by ${pct0(top.own)}) for someone less popular`; }
    else { const p = r.pen.filter(x => x[1] > 0).sort((a, b) => b[1] - a[1])[0]; con = p ? `watch: ${p[0]}` : 'nothing to change'; }
    if (con) parts.push({ t: con, c: 'lb-con' });
    const sp = /^(\d+)-(\d+)$/.exec(X.split || '');
    const sub = n === 6 ? `${esc(X.cpt.name)} captain · ${sp ? `${sp[1]} from his team, ${sp[2]} from the other` : esc(X.split)} · our score ${L.codexScore(r)}/100${has.own ? ` · pick rates add up to ${pct0(X.cum)} (past winners: ${esc(ct ? ct.own_target : '')} in contests of ${esc((SD_CONTEST[S.state.contest] || S.CONTEST_SHORT[S.state.contest] || '').toLowerCase())})` : ''} · <a href="nfl/lab/#sdLabReport" data-jump="sdLabReport" class="sd-link">full report</a>` : '';
    return { tone, html: gradeHtml(tone, parts, sub, acts) };
  };
  const drawSdGrade = () => {
    const g = sdGrade(); setGrade($('lbSdGrade'), g.tone, g.html);
    const L = SL(); if (!L || !L.engine) return;
    const n = L.filled(), qt = $('lbSdQuickT'); if (qt) qt.textContent = n ? 'Paste a different lineup' : 'Paste your lineup';
    // The lineup just reached 6 from the reader's own tap or paste (not a link or a game switch restoring one).
    if (sdPrevN != null && sdPrevN < 6 && n === 6 && Date.now() - sdUserAt < 2000) showGrade('lbSdGrade');
    sdPrevN = n;
  };

  /* =================================================================
     CLASSIC TAB
     ================================================================= */
  const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'DST'];
  const FLEXABLE = new Set(['RB', 'WR', 'TE']);
  const CAP = 50000;
  const C = { pb: null, pool: null, dk: null, dkName: '', err: '', lines: null, preset: null, ownCol: 'own', slots: Array(9).fill(null), pos: 'ALL', q: '', eng: null, pl: null, res: null, pasteOpen: false, prevN: null };
  const CE = () => BBI.classicEngine, CL = () => BBI.classic;

  const startClassic = () => {
    if (started.classic) return; started.classic = true;
    Promise.all([loadSet('classic'), loadClassicData()]).then(() => {
      clBuild(); clRestore(); clBind(); clDraw();
      if (phone() && !lineupNames().length) $('lbClQuick').open = true;   // phone: paste first
    }).catch(e => { $('lbClBar').innerHTML = `<p class="lb-muted">The Classic Lab didn't load (${esc(e.message || e)}). Refresh, or open the <a href="nfl/classic/">Classic playbook</a>.</p>`; });
  };
  const getJSON = async u => { const r = await fetch(u, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); };
  const loadClassicData = async () => {
    const [pb, ptr] = await Promise.all([getJSON('nfl/classic/classic_playbook.json'), getJSON('nfl/classic/pools/latest.json')]);
    C.pb = pb; C.pool = await getJSON(`nfl/classic/pools/${ptr.file}`);
    // Lines: the playbook preset for this pool's week; else this week's slate file.
    C.preset = (pb.presets.slates || []).find(s => s.id === C.pool.id) || null;
    let games = C.preset ? C.preset.games : null;
    if (!games) {
      try { const sj = await getJSON('nfl/slate/slate.json'); if (+sj.week === +C.pool.week) games = (sj.games || []).map(g => ({ away: g.away, home: g.home, fav: g.fav, spread: Math.round((+g.fav_by || 0) * 2) / 2, total: +g.total })); } catch {}
    }
    C.games = games || [];
  };
  // Pool → engine players; ownership column per contest type; a DK salary file adds IDs (and any player we don't list).
  const clBuild = () => {
    const ce = CE(), col = C.ownCol;
    const ours = ce.playersFromList(C.pool.players.map(p => ({ ...p, own: col === 'own_se' ? (p.own_se ?? p.own ?? 0) : (p.own ?? 0) })));
    ours.has = { ...ours.has, own: !!(C.pool.has && C.pool.has.own) };
    C.pl = C.dk ? ce.mergePlayers(C.dk, ours) : ours;
    const L = ce.linesFromGames(C.games), oppOf = new Map();
    for (const p of C.pl.P.values()) if (p.opp && !oppOf.has(p.team)) oppOf.set(p.team, p.opp);
    for (const [t, l] of L) if (oppOf.has(t) && oppOf.get(t) !== l.opp) L.delete(t);
    C.eng = ce.createEngine(C.pb.rules, C.pl, L);
    C.slots = C.slots.map(n => n && C.pl.P.has(n) ? n : null);
  };
  const lineupNames = () => C.slots.filter(Boolean);
  const slotFor = (pos, slots = C.slots) => {
    let i = SLOTS.findIndex((k, j) => k === pos && !slots[j]);
    if (i < 0 && FLEXABLE.has(pos) && !slots[7]) i = 7;
    return i;
  };
  const clAdd = name => {
    const at = C.slots.indexOf(name); if (at >= 0) { C.slots[at] = null; return true; }
    const p = C.pl.P.get(name); if (!p) return false;
    const i = slotFor(p.pos); if (i < 0) { toast(`No open ${esc(p.pos)} slot: remove one first`, 'warn'); return false; }
    C.slots[i] = name; return true;
  };
  const clFill = names => { C.slots = Array(9).fill(null); const left = []; for (const n of names) if (!clAdd(n)) left.push(n); return left; };

  // Grade: rules (classic_engine check) + cum own + one suggestion, in plain English.
  const clGrade = () => {
    const n = lineupNames().length, acts = clActs(n);
    if (!n) return { tone: '', html: gradeHtml('', [{ t: 'Build or paste 9 players', b: true }], `This week's ${esc(C.pool.label)} pool, ${C.pool.players.length} players. Tap a player to add him, or paste a lineup (one name per line, or a DraftKings upload row).`, acts) };
    const res = C.res;
    if (!res || !res.roster.ok) {
      const sal = lineupNames().reduce((a, x) => a + (C.pl.P.get(x)?.sal || 0), 0), open = 9 - n;
      return { tone: '', html: gradeHtml('', [{ t: `${n} of 9 picked`, b: true }, { t: open ? `${money(CAP - sal)} left for ${open} spot${open > 1 ? 's' : ''}${open ? ` (${money((CAP - sal) / open)} each)` : ''}` : 'check the roster' }, ...(n === 9 && res ? res.roster.issues : []).slice(0, 1).map(i => ({ t: i, c: 'lb-neg' }))], '', acts) };
    }
    const X = res.X, R = C.pb.rules, parts = [];
    const fails = res.hard.filter(h => h.status === 'fail'), flags = res.soft.filter(s => s.status === 'flag');
    let tone = fails.length ? 'bad' : flags.length > 2 ? 'ok' : 'good';
    // stack
    const bbPos = X.bb.map(p => p.pos).join(' + '), bb = X.bb.length ? ` + ${/^RB/.test(bbPos) ? 'an' : 'a'} ${bbPos} from the other team` : '';
    if (fails.length) parts.push({ t: `Breaks ${fails.length} rule${fails.length > 1 ? 's' : ''}`, b: true, c: 'lb-neg' });
    parts.push(X.n_catch >= 2 ? { t: `Good pairing: QB + ${X.n_catch} of his pass-catchers${bb}`, b: !fails.length, c: fails.length ? '' : 'lb-pos' } : X.n_catch === 1 ? { t: `Thin pairing: QB + 1 of his pass-catchers${bb}`, b: !fails.length, c: fails.length ? '' : 'lb-warn' } : { t: 'QB with none of his pass-catchers', b: !fails.length, c: 'lb-neg' });
    // ownership
    const hasOwn = C.pl.has.own, tgt = R.soft.cum_own_target || [100, 160], chalkN = X.ps.filter(p => p.own >= (R.hard.chalk_own_threshold || 20)).length;
    if (hasOwn) parts.push(X.cum > tgt[1] + 40 ? { t: 'lots of people will have these players', c: 'lb-warn' } : X.cum > tgt[1] ? { t: 'a lot of people will have these players', c: 'lb-warn' } : X.cum < tgt[0] ? { t: 'fewer people will have these players' } : { t: 'player popularity in the winning range', c: 'lb-pos' });
    if (hasOwn && X.cum > tgt[1] && tone === 'good') tone = 'ok';
    // one thing to consider
    parts.push({ t: clConsider(X, res, fails, flags, chalkN), c: 'lb-con' });
    const left = CAP - X.sal;
    const sub = `Built around ${esc(X.qb.name)} · players from ${X.games} games · ${money(X.sal)} used${left > 0 ? ` (${money(left)} left)` : ''}${hasOwn ? ` · pick rates add up to ${pct0(X.cum)} (past winners: ${tgt[0]}–${tgt[1]}%) · ${chalkN} player${chalkN === 1 ? '' : 's'} picked by ${R.hard.chalk_own_threshold || 20}%+ of lineups` : ''} · ${res.hard.length - fails.length - res.hard.filter(h => h.status === 'unknown').length} of ${res.hard.length} must-follow rules pass${flags.length ? ` · ${flags.length} habit${flags.length > 1 ? 's' : ''} of past winners missed` : ''} · pick rates for ${C.ownCol === 'own_se' ? 'one-entry' : 'big'} contests`;
    return { tone, html: gradeHtml(tone, parts, sub, acts) };
  };
  const ruleTitle = (tier, key) => {
    const k = key === 'bring_back' ? 'bring_back_lean' : key, card = C.pb.rule_cards.find(c => c.path === `${tier}.${k}`);
    return card && CL() ? CL().cardText(card, C.pb.rules).title : key.replace(/_/g, ' ');
  };
  // The best candidate not in the lineup: pos/team filter, salary that still fits, sorted by a key.
  const pick = (ok, X, outSal, by) => [...C.pl.P.values()].filter(p => !X.ps.includes(p) && ok(p) && p.sal <= CAP - X.sal + outSal).sort(by)[0] || null;
  const clConsider = (X, res, fails, flags, chalkN) => {
    if (fails.length) return `fix: ${ruleTitle('hard', fails[0].key)} (${fails[0].msg})`;
    const fl = new Set(flags.map(f => f.key)), skill = X.ps.filter(p => FLEXABLE.has(p.pos));
    const oneOff = skill.filter(p => p.team !== X.qb.team && p.team !== X.qb.opp).sort((a, b) => a.sal - b.sal)[0];
    if (fl.has('qb_catchers_default') && X.n_catch < 2 && oneOff) {
      const c = pick(p => p.team === X.qb.team && (p.pos === 'WR' || p.pos === 'TE') && (oneOff.pos === p.pos || C.slots[7] === oneOff.name), X, oneOff.sal, (a, b) => b.sal - a.sal);
      if (c) return `consider ${c.name} (${X.qb.team} ${c.pos}, ${money(c.sal)}) for ${oneOff.name}: most winners pair the QB with 2 of his pass-catchers`;
    }
    if ((fl.has('bring_back') || fl.has('bring_back_lean')) && !X.bb.some(p => p.pos === 'RB')) {
      const out = skill.filter(p => p.pos === 'RB' && p.team !== X.qb.team && p.team !== X.qb.opp).sort((a, b) => a.sal - b.sal)[0];
      const c = out && pick(p => p.team === X.qb.opp && p.pos === 'RB', X, out.sal, (a, b) => b.sal - a.sal);
      if (c) return `consider ${c.name} (${X.qb.opp} RB, ${money(c.sal)}) for ${out.name}: an RB from the other team in your QB's game`;
    }
    if (C.pl.has.own && X.cum > (C.pb.rules.soft.cum_own_target || [0, 160])[1]) {
      const top = X.ps.filter(p => p !== X.qb).sort((a, b) => b.own - a.own)[0];
      const c = top && pick(p => p.pos === top.pos && p.own < top.own / 2 && p.sal >= top.sal - 1200, X, top.sal, (a, b) => b.sal - a.sal);
      if (c) return `consider ${c.name} (picked by ${pct0(c.own)}) over ${top.name} (${pct0(top.own)}) so fewer people share your lineup`;
      if (top) return `consider a less popular ${top.pos} than ${top.name} (picked by ${pct0(top.own)})`;
    }
    if (flags.length) return `consider: ${ruleTitle('soft', flags[0].key)} (${flags[0].msg})`;
    if (CAP - X.sal > 1000) return `${money(CAP - X.sal)} unspent: winners use nearly all the salary`;
    return 'nothing to change: built like past winners';
  };
  const hasIds = () => C.dk && lineupNames().length === 9 && lineupNames().every(n => C.pl.ids.get(n));
  const clActs = n => `<button type="button" class="btn btn-sm" data-cl="paste">${C.pasteOpen ? 'Hide paste box' : 'Paste a lineup'}</button>${n === 9 && C.res && C.res.roster.ok ? `${hasIds() ? '<button type="button" class="btn btn-sm btn-primary" data-cl="csv">Download DraftKings upload file</button>' : '<button type="button" class="btn btn-sm btn-primary" data-cl="ids">Get a DraftKings upload file</button>'}<button type="button" class="btn btn-sm" data-cl="names">Copy names</button><button type="button" class="btn btn-sm" data-cl="link">Copy link</button>` : ''}${n ? '<button type="button" class="btn btn-sm btn-ghost" data-cl="clear">Clear</button>' : ''}`;

  const clDraw = () => {
    const names = lineupNames();
    C.res = names.length ? C.eng.check(names) : null;
    drawClBar(); drawClLineup(); drawClPool(); drawClRules(); drawClFiles();
    const g = clGrade(); setGrade($('lbClGrade'), g.tone, g.html);
    const n = names.length, qt = $('lbClQuickT'); if (qt) qt.textContent = n ? 'Paste a different lineup' : 'Paste your lineup';
    if (C.prevN != null && C.prevN < 9 && n === 9) showGrade('lbClGrade');   // just filled (a paste or the last tap)
    C.prevN = n;
    lsSet(LS_CL, JSON.stringify({ week: C.pool.id, slots: C.slots, own: C.ownCol }));
    if (tab === 'classic') clUrl();
  };
  const drawClBar = () => {
    const html = `
      <div class="lb-field lb-field-wide"><span>Slate</span><b class="lb-bar-slate">${esc(C.pool.label)} · ${C.pool.n_games || C.games.length} games</b></div>
      <div class="lb-field"><span>Contest</span><span class="seg" role="group" aria-label="Ownership for">${[['own', 'Big contests'], ['own_se', 'One-entry contests']].map(([k, l]) => `<button type="button" class="${C.ownCol === k ? 'active' : ''}" aria-pressed="${C.ownCol === k}" data-cl-own="${k}"${k === 'own_se' && !(C.pool.has && C.pool.has.own_se) ? ' disabled' : ''}>${l}</button>`).join('')}</span></div>
      <div class="lb-bar-note">The share of lineups we expect to pick each player in ${C.ownCol === 'own_se' ? 'one-entry contests' : 'big contests (thousands of entries)'}${C.pool.as_of ? `, updated ${esc(C.pool.as_of)}` : ''}. Game lines from ${C.preset ? 'the Classic playbook' : 'this week\'s slate'}.${C.dk ? ` DraftKings IDs from ${esc(C.dkName)}.` : ''}</div>`;
    const h = $('lbClBar'); if (h.dataset.drawn !== html) { h.innerHTML = html; h.dataset.drawn = html; }
  };
  const drawClLineup = () => {
    const X = C.res && C.res.X, roles = X && CL() ? CL().rolesFor(X) : null;
    const sal = lineupNames().reduce((a, n) => a + (C.pl.P.get(n)?.sal || 0), 0), own = C.pl.has.own;
    $('lbClLineup').innerHTML = `
      <div class="lb-h">Your lineup <small>${lineupNames().length}/9</small></div>
      <ol class="lb-slots">${C.slots.map((n, i) => { const p = n && C.pl.P.get(n);
        return p ? `<li class="lb-slot"><span class="lb-slot-k">${SLOTS[i]}</span><span class="lb-slot-n">${esc(p.name)}<small>${esc(p.pos)} · ${esc(p.team)} vs ${esc(p.opp)} · ${money(p.sal)}${own ? ` · ${pct0(p.own)}` : ''}</small>${roles && roles.get(p.name) ? `<span class="lb-tags">${roles.get(p.name).map(([c, l]) => `<em class="cl-tag ${c}">${esc(l)}</em>`).join('')}</span>` : ''}</span><button type="button" class="lb-x" data-cl-rm="${i}" aria-label="Remove ${esc(p.name)}">×</button></li>`
          : `<li class="lb-slot empty"><span class="lb-slot-k">${SLOTS[i]}</span><span class="lb-slot-n">${SLOTS[i] === 'FLEX' ? 'RB, WR or TE' : `Add a ${SLOTS[i]}`}</span><span></span></li>`; }).join('')}</ol>
      <div class="lb-sal"><span>Salary <b>${money(sal)}</b> of $50,000</span><span class="${sal > CAP ? 'neg' : ''}">${sal > CAP ? `over by ${money(sal - CAP)}` : `${money(CAP - sal)} left`}</span></div>
      <div class="lb-salbar${sal > CAP ? ' over' : ''}"><i style="width:${Math.min(100, sal / CAP * 100).toFixed(1)}%"></i></div>
      <div class="lb-paste" id="lbClPaste"${C.pasteOpen ? '' : ' hidden'}>
        <label class="sd-lab-k" for="lbClText">Paste 9 players <small>one per line, comma-separated, or a DraftKings upload row</small></label>
        <textarea class="lb-text" id="lbClText" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" placeholder="Josh Allen&#10;Bijan Robinson&#10;…"></textarea>
        <div class="lb-acts"><button type="button" class="btn btn-sm btn-primary" data-cl="paste-go">Grade it</button></div>
      </div>`;
  };
  const drawClPool = () => {
    const host = $('lbClPool'), inL = new Set(lineupNames()), q = C.q.trim().toLowerCase(), own = C.pl.has.own;
    let ps = [...C.pl.P.values()].filter(p => (C.pos === 'ALL' || p.pos === C.pos) && (!q || p.name.toLowerCase().includes(q) || p.team.toLowerCase() === q));
    ps.sort((a, b) => b.sal - a.sal || a.name.localeCompare(b.name));
    const total = ps.length; ps = ps.slice(0, 80);
    const stat = C.pool.players.reduce((m, p) => (p.status ? m.set(p.name, p.status) : m), new Map());
    const list = ps.map(p => `<li><button type="button" class="lb-row${inL.has(p.name) ? ' in' : ''}" data-cl-add="${esc(p.name)}" aria-pressed="${inL.has(p.name)}"><span class="lb-row-pos">${esc(p.pos)}</span><span class="lb-row-n"><span>${esc(p.name)}${stat.get(p.name) ? `<span class="lb-q" title="Injury status: questionable">${esc(stat.get(p.name))}</span>` : ''}</span><small>${esc(p.team)} vs ${esc(p.opp)}${own ? ` · ${pct0(p.own)} owned` : ''}</small></span>${own ? `<span class="lb-row-own">${pct0(p.own)}</span>` : ''}<span class="lb-row-sal">${money(p.sal)}</span></button></li>`).join('');
    if (!host.dataset.shell) {
      host.innerHTML = `<div class="lb-h">Player pool <small id="lbClPoolN"></small></div>
        <div class="lb-pool-filters"><input class="lb-search" id="lbClQ" type="search" placeholder="Search a name or team" aria-label="Search players" autocomplete="off">
          <div class="lb-posf" role="group" aria-label="Position" id="lbClPos"></div></div>
        <ul class="lb-list" id="lbClList" aria-label="Player pool"></ul><p class="lb-list-note" id="lbClListNote"></p>`;
      host.dataset.shell = '1';
      $('lbClQ').addEventListener('input', e => { C.q = e.target.value; drawClPool(); });
    }
    $('lbClPos').innerHTML = ['ALL', 'QB', 'RB', 'WR', 'TE', 'DST'].map(k => `<button type="button" class="${C.pos === k ? 'on' : ''}" aria-pressed="${C.pos === k}" data-cl-pos="${k}">${k === 'ALL' ? 'All' : k}</button>`).join('');
    $('lbClPoolN').textContent = `${C.pl.P.size} players`;
    $('lbClList').innerHTML = list || '<li class="lb-list-note">No player matches.</li>';
    $('lbClListNote').textContent = total > ps.length ? `Showing the top ${ps.length} of ${total} by salary: search or pick a position to narrow it.` : 'Tap a player to add or remove him.';
  };
  const drawClRules = () => {
    const res = C.res, body = $('lbClRulesBody'), ans = $('lbClRulesAns');
    if (!res || !res.X) { ans.textContent = 'fill all 9 slots'; body.innerHTML = `<p class="lb-muted">Once the lineup has all nine, every rule shows here: ${Object.keys(C.pb.rules.hard).length - 1} must-follow rules a winning lineup almost never breaks, and ${Object.keys(C.pb.rules.soft).filter(k => !k.startsWith('_')).length} habits that describe how most winners were built.</p>`; return; }
    const H = C.pb.winner_checks.hard, SW = C.pb.winner_checks.soft, ICON = { pass: '✓', fail: '✗', unknown: '?', flag: '!', bonus: '+' };
    const fails = res.hard.filter(h => h.status === 'fail').length, flags = res.soft.filter(s => s.status === 'flag').length;
    ans.textContent = `${fails ? `${fails} must-follow rule${fails > 1 ? 's' : ''} broken` : 'every must-follow rule passes'} · ${flags} habit${flags === 1 ? '' : 's'} of past winners missed`;
    body.innerHTML = `<div class="lb-rules">
      <div><h3>Must-follow rules <small class="lb-muted">· share of past winners that pass</small></h3><div class="sd-rules">${res.hard.map(h => { const w = H[h.key]; return `<div class="sd-rule ${h.status}"><i>${ICON[h.status]}</i><span>${esc(ruleTitle('hard', h.key))}${w ? ` <em class="cl-w">${w.pct}%</em>` : ''}<small>${esc(h.msg)}</small></span></div>`; }).join('')}</div></div>
      <div><h3>Habits of past winners <small class="lb-muted">· how most winners were built</small></h3><div class="sd-rules">${res.soft.map(s => { const w = SW[s.key === 'bring_back' ? 'bring_back_lean' : s.key], st = s.status === 'flag' ? 'cl-flag' : s.status === 'bonus' ? 'pass' : s.status; return `<div class="sd-rule ${st}"><i>${ICON[s.status]}</i><span>${s.key === 'rb_own_dst' ? 'RB + own DST (bonus)' : esc(ruleTitle('soft', s.key))}${w ? ` <em class="cl-w">${w.pct}%</em>` : ''}<small>${esc(s.msg)}</small></span></div>`; }).join('')}</div></div>
    </div><p class="lb-files-note">Rules from ${C.pb.winner_checks.n} DraftKings Milly Maker winners and our Classic playbook. <a href="nfl/classic/" class="sd-link">Read the playbook</a>.</p>`;
  };
  const drawClFiles = () => {
    const body = $('lbClFilesBody'), ans = $('lbClFilesAns');
    ans.textContent = C.dk ? `${C.dkName} loaded · ${C.dk.ids.size} IDs` : 'needs your DraftKings salary file';
    if (body.dataset.shell) { $('lbClFilesNote').innerHTML = filesNote(); return; }
    body.dataset.shell = '1';
    body.innerHTML = `<div class="lb-drop" id="lbClDrop" tabindex="0" role="button" aria-label="Load your DraftKings classic salary file">
        <input type="file" id="lbClFile" accept=".csv,.txt" hidden>
        <b>Add your DraftKings salary file (DKSalaries.csv)</b><span>On DraftKings, open the contest and use Export to CSV. That file has the player IDs DraftKings needs to accept an upload.</span>
        <small>Read in your browser; nothing is uploaded.</small></div>
      <p class="lb-files-note" id="lbClFilesNote">${filesNote()}</p>`;
    const inp = $('lbClFile'), drop = $('lbClDrop');
    drop.addEventListener('click', () => inp.click());
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
    inp.addEventListener('change', () => { if (inp.files[0]) readDk(inp.files[0]); inp.value = ''; });
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) readDk(f); });
  };
  const filesNote = () => C.err ? `<span class="neg">${esc(C.err)}</span>` : C.dk ? `Loaded ${esc(C.dkName)}: ${C.dk.P.size} players with IDs. Download DraftKings upload file now builds a file you can upload straight to DraftKings.` : 'Without it you can still copy the names and enter them on DraftKings by hand.';
  const readDk = async f => {
    C.err = '';
    try {
      const pl = CE().readPlayers(await f.text());
      if (pl.source !== 'draftkings') throw new Error('that is not a DraftKings salary file (DKSalaries.csv)');
      if (!pl.ids.size) throw new Error('no ID column in that file');
      C.dk = pl; C.dkName = f.name; clBuild();
      toast(`<b>${esc(f.name)}</b> loaded · DraftKings IDs ready`, 'good');
    } catch (e) { C.err = `${f.name}: ${e.message || e}`; }
    clDraw();
  };
  const clCsv = () => {
    const ids = C.slots.map(n => C.pl.ids.get(n));
    return `${SLOTS.join(',')}\n${ids.join(',')}\n`;
  };
  const clUrl = () => {
    if (!C.pool) return;
    const t = C.slots.map(n => n ? (C.pl.ids.get(n) || nameSlug(n)) : '');
    const lu = t.some(Boolean) ? `&lu=${t.join('-')}` : '';
    try { history.replaceState(history.state, '', `${location.pathname}?mode=classic${lu}`); } catch {}
  };
  const clFromTokens = tokens => {
    const bySlug = new Map(), byId = new Map();
    for (const n of C.pl.P.keys()) { const s = nameSlug(n); bySlug.set(s, bySlug.has(s) ? null : n); }
    for (const [n, id] of C.pl.ids) if (id) byId.set(String(id), n);
    C.slots = Array(9).fill(null);
    const pos = new Map(SLOTS.map((k, i) => [i, k]));
    const bad = [];
    tokens.forEach((t, i) => { if (!t) return; const n = (/^\d+$/.test(t) && byId.get(t)) || bySlug.get(t.toLowerCase()); if (!n) { bad.push(t); return; } const p = C.pl.P.get(n);
      if (i < 9 && !C.slots[i] && (pos.get(i) === p.pos || (pos.get(i) === 'FLEX' && FLEXABLE.has(p.pos))) && !C.slots.includes(n)) C.slots[i] = n; else if (!C.slots.includes(n)) clAdd(n); });
    if (bad.length) toast(`Linked lineup loaded · ${bad.length} player${bad.length > 1 ? 's' : ''} not in this week's pool`, 'warn');
  };
  const clRestore = () => {
    const q = new URLSearchParams(location.search);
    if (q.get('mode') === 'classic' && q.get('lu')) { const t = q.get('lu').split('-').slice(0, 9); if (t.every(x => /^[a-z0-9_]{0,60}$/i.test(x))) { clFromTokens(t); return; } }
    try { const s = JSON.parse(lsGet(LS_CL)); if (s && s.week === C.pool.id && Array.isArray(s.slots)) { if (s.own === 'own_se' && C.pool.has && C.pool.has.own_se) { C.ownCol = 'own_se'; clBuild(); } C.slots = SLOTS.map((_, i) => s.slots[i] && C.pl.P.has(s.slots[i]) ? s.slots[i] : null); } } catch {}
  };
  const clBind = () => {
    const panel = $('lbClassic');
    panel.addEventListener('click', e => {
      const t = e.target;
      const add = t.closest('[data-cl-add]'); if (add) { clAdd(add.dataset.clAdd); clDraw(); const r = $('lbClList').querySelector(`[data-cl-add="${CSS.escape(add.dataset.clAdd)}"]`); if (r) r.focus({ preventScroll: true }); return; }
      const rm = t.closest('[data-cl-rm]'); if (rm) { C.slots[+rm.dataset.clRm] = null; clDraw(); return; }
      const ps = t.closest('[data-cl-pos]'); if (ps) { C.pos = ps.dataset.clPos; drawClPool(); return; }
      const ow = t.closest('[data-cl-own]'); if (ow && !ow.disabled) { C.ownCol = ow.dataset.clOwn; clBuild(); clDraw(); return; }
      const a = t.closest('[data-cl]'); if (!a) return;
      const act = a.dataset.cl;
      if (act === 'paste') {
        if (phone()) { const q = $('lbClQuick'); q.open = true; $('lbClQuickText').focus({ preventScroll: true }); q.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
        C.pasteOpen = !C.pasteOpen; clDraw(); if (C.pasteOpen) $('lbClText').focus(); return;
      }
      if (act === 'paste-go') {
        // Two paste boxes: #lbClQuick (phone, first in the panel) and #lbClPaste (in the lineup card).
        const quick = !!a.closest('#lbClQuick'), box = () => $(quick ? 'lbClQuickText' : 'lbClText');
        const P = CL().parseLineup(box().value, { resolve: looseMatcher(C.pl.P, C.eng.resolve) });
        if (!P.cells.length) { toast('Paste 9 names first', 'warn'); box().focus(); return; }
        const left = clFill([...new Set(P.names)]);
        const miss = [...P.unresolved, ...left];
        if (!quick) C.pasteOpen = !!miss.length;
        else if (!miss.length) $('lbClQuick').open = false;   // collapse before the grade scrolls into view
        clDraw();
        if (miss.length) { box().value = miss.join('\n'); toast(`Couldn't place: ${esc(miss.slice(0, 3).join(', '))}${miss.length > 3 ? '…' : ''}: not in this week's pool or no open slot`, 'warn'); }
        else { box().value = ''; if (lineupNames().length < 9) showGrade('lbClGrade'); toast(`<b>Lineup loaded</b> · ${lineupNames().length} of 9`, 'good'); }
        return;
      }
      if (act === 'clear') { C.slots = Array(9).fill(null); clDraw(); return; }
      if (act === 'csv') { if (hasIds()) download(clCsv(), `DK_upload_classic_${C.pool.id}.csv`); return; }
      if (act === 'ids') { const f = $('lbClFiles'); f.open = true; f.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      if (act === 'names') { copyText(C.slots.map((n, i) => `${SLOTS[i]} ${n}`).join('\n'), 'Lineup copied: enter it on DraftKings'); return; }
      if (act === 'link') { clUrl(); copyText(location.href, 'Link copied: it opens this lineup in the Lab'); return; }
    });
    panel.addEventListener('keydown', e => { if ((e.target.id === 'lbClText' || e.target.id === 'lbClQuickText') && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.target.closest('.lb-paste').querySelector('[data-cl="paste-go"]').click(); } });
  };

  /* =================================================================
     BOOT
     ================================================================= */
  const boot = () => {
    bindTabs();
    setTab(tab);
    // Warm the other tab's scripts once the page is idle so switching is quick.
    const other = tab === 'classic' ? 'showdown' : 'classic';
    (window.requestIdleCallback || (f => setTimeout(f, 1500)))(() => { if (other === 'classic') loadSet('classic').catch(() => {}); });
  };
  BBI.lab = { get tab() { return tab; }, setTab, sdGrade, clGrade: () => clGrade(), C, clFill, clDraw, clCsv, nameSlug };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
