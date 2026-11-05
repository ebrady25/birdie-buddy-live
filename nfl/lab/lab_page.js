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
  // Share card (the SHARE CARD section below): each tab's last complete grade, and the button the grade line carries.
  const lastCard = { showdown: null, classic: null };
  const CARD_BTN = mode => `<button type="button" class="btn btn-sm" data-lb-card="${mode}" aria-haspopup="dialog" title="A picture of this grade to post or send: made in your browser, nothing is uploaded">Share card</button>`;

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
    new MutationObserver(placeSdGrade).observe($('sdLab'), { childList: true });
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
    const sh = e.target.closest('[data-share]');
    if (sh) { e.preventDefault(); if (sh.dataset.share === 'lineup') openCard('showdown', sh); else S.sharePng(sh.dataset.share, sh); return; }   // the Lab's own lineup card = the share card
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
    const acts = `${n === 6 ? `<button type="button" class="btn btn-sm btn-primary" data-lb-sd="csv" ${L.hasIds() ? '' : 'disabled'} title="${L.hasIds() ? 'A file you can upload straight to DraftKings (captain + 5 player IDs)' : 'This game has no DraftKings player IDs yet'}">Download DraftKings upload file</button><button type="button" class="btn btn-sm" data-copy-link="">Copy link</button>` : ''}`;
    if (!r) return { tone: '', html: gradeHtml('', [{ t: n ? 'Pick a captain to get a grade' : 'Pick a captain and five more players', b: true }], 'Tap a player in the pool to add him; the C button makes him captain. Captain scores 1.5× points and costs 1.5× salary.', acts) };
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
    // The share card carries the same headline numbers (a complete lineup only).
    const cd = n === 6 && L.cardData ? L.cardData() : null;
    let card = null;
    if (cd) {
      const pre = (S.slates || []).find(x => x.id === S.state.preset), dp = X.est_dupes;
      const tiles = [['BirdieBuild score', String(cd.score), 'out of 100'], ['Salary', money(cd.salary), 'of $50,000']];
      if (has.own) tiles.push(['Pick rates', pct0(X.cum), `past winners ${ct ? ct.own_target : ''}`], ['Same lineup', dp < 0.5 ? '~0' : `~${dp < 10 ? dp.toFixed(1) : Math.round(dp).toLocaleString('en-US')}`, 'others, estimated']);
      else tiles.push(['Captain', X.cpt.name, `${X.cpt.pos} · 1.5× points`], ['Split', sp ? `${sp[1]}–${sp[2]}` : String(X.split || ''), "his team – the other"]);
      card = { mode: 'showdown', tone, kind: 'Showdown', title: parts[0].t, lines: n === 6 && has.own ? [parts[1].t] : [],
        slate: pre ? pre.label : (cd.pool ? `${cd.pool} · custom line` : 'Custom line'), slateSub: `${pre ? `${pre.fav} −${pre.spread}` : `spread ${S.state.spread}`} · total ${pre ? pre.total : S.state.total} · ${SD_CONTEST[S.state.contest] || S.CONTEST_SHORT[S.state.contest] || ''}`,
        tiles, salary: cd.salary, file: pre ? pre.id : 'custom',
        slots: cd.slots.map(p => ({ k: p.cpt ? 'CPT' : 'FLEX', name: p.name, pos: p.pos, sub: `${p.team} · ${p.side}`, sal: p.sal, hi: p.cpt })) };
    }
    return { tone, html: gradeHtml(tone, parts, sub, acts + (card ? CARD_BTN('showdown') : '')), card };
  };
  let sdGradeEl = null;
  const placeSdGrade = () => {
    sdGradeEl = sdGradeEl || $('lbSdGrade'); const lu = $('sdLabLineup');
    if (sdGradeEl && lu && sdGradeEl.previousElementSibling !== lu) lu.after(sdGradeEl);
  };
  const drawSdGrade = () => {
    placeSdGrade();
    const g = sdGrade(); setGrade(sdGradeEl || $('lbSdGrade'), g.tone, g.html); lastCard.showdown = g.card || null;
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
  const C = { pb: null, pool: null, dk: null, dkName: '', err: '', lines: null, preset: null, ownCol: 'own', slots: Array(9).fill(null), pos: 'ALL', q: '', eng: null, pl: null, res: null, pasteOpen: false, prevN: null,
    proj: new Map(), sort: 'proj', dir: 1, game: 'ALL', afford: false, f: {}, filtOpen: false, saved: [], editing: null };
  // Our public projections (nfl/projections/projections.json, same week): proj, ceiling, value, optimal %, leverage, status.
  const PJ = p => (p && C.proj.get(`${p.name}|${p.team}`)) || null;
  const LS_CL_UI = 'bbi_lab_classic_ui', LS_CL_SAVED = 'bbi_lab_classic_saved';
  const saveUi = () => lsSet(LS_CL_UI, JSON.stringify({ sort: C.sort, dir: C.dir, afford: C.afford }));
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
    try {
      const pj = await getJSON('nfl/projections/projections.json');
      if (+pj.week === +C.pool.week) for (const r of pj.players || []) C.proj.set(`${r.player}|${r.team}`, r);
    } catch {}   // the builder still works without projections (salary / ownership only)
    try { const u = JSON.parse(lsGet(LS_CL_UI)); if (u) { if (u.sort) C.sort = u.sort; if (u.dir === -1) C.dir = -1; C.afford = !!u.afford; } } catch {}
    if (!C.proj.size && C.sort !== 'sal' && C.sort !== 'own' && C.sort !== 'name') C.sort = 'sal';
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
    const n = lineupNames().length, acts = '';
    if (!n) return { tone: '', html: gradeHtml('', [{ t: 'Build or paste 9 players', b: true }], `This week's ${esc(C.pool.label)} pool, ${C.pool.players.length} players. Tap a player in the pool to add him, or paste a lineup. The grade updates with every pick.`, acts) };
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
    const nPass = res.hard.length - fails.length - res.hard.filter(h => h.status === 'unknown').length;
    const sub = `Built around ${esc(X.qb.name)} · players from ${X.games} games · ${money(X.sal)} used${left > 0 ? ` (${money(left)} left)` : ''}${hasOwn ? ` · pick rates add up to ${pct0(X.cum)} (past winners: ${tgt[0]}–${tgt[1]}%) · ${chalkN} player${chalkN === 1 ? '' : 's'} picked by ${R.hard.chalk_own_threshold || 20}%+ of lineups` : ''} · ${nPass} of ${res.hard.length} must-follow rules pass${flags.length ? ` · ${flags.length} habit${flags.length > 1 ? 's' : ''} of past winners missed` : ''} · pick rates for ${C.ownCol === 'own_se' ? 'one-entry' : 'big'} contests`;
    // The share card: the same headline numbers, the 9 slots and their salaries.
    const tiles = [['Must-follow rules', `${nPass} of ${res.hard.length}`, 'pass'], ['Salary', money(X.sal), left > 0 ? `${money(left)} left` : 'of $50,000']];
    if (hasOwn) tiles.push(['Pick rates', pct0(X.cum), `past winners ${tgt[0]}–${tgt[1]}%`]);
    tiles.push(['Built around', X.qb.name, `QB + ${X.n_catch} of his pass-catchers`]);
    if (!hasOwn) tiles.push(['Games', String(X.games), 'players from']);
    const card = { mode: 'classic', tone, kind: 'Classic', title: parts[0].t, lines: parts.slice(1, fails.length ? 3 : 2).filter(p => p.c !== 'lb-con').map(p => p.t),
      slate: `${C.pool.label} · ${C.pool.n_games || C.games.length} games`, slateSub: `pick rates for ${C.ownCol === 'own_se' ? 'one-entry' : 'big'} contests`,
      tiles, salary: X.sal, file: C.pool.id,
      slots: C.slots.map((nm, i) => { const p = C.pl.P.get(nm) || {}; return { k: SLOTS[i], name: p.name || nm, pos: p.pos || '', sub: p.team || '', sal: p.sal || 0, hi: i === 0 }; }) };
    return { tone, html: gradeHtml(tone, parts, sub, CARD_BTN('classic')), card };
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

  const clDraw = () => {
    const names = lineupNames();
    C.res = names.length ? C.eng.check(names) : null;
    drawClBar(); drawClLineup(); drawClPool(); drawClSaved(); drawClRules(); drawClFiles();
    const g = clGrade(); setGrade($('lbClGrade'), g.tone, g.html); lastCard.classic = g.card || null;
    const n = names.length, qt = $('lbClQuickT'); if (qt) qt.textContent = n ? 'Paste a different lineup' : 'Paste your lineup';
    if (C.prevN != null && C.prevN < 9 && n === 9) showGrade('lbClGrade');   // just filled (a paste or the last tap)
    C.prevN = n;
    lsSet(LS_CL, JSON.stringify({ week: C.pool.id, slots: C.slots, own: C.ownCol }));
    if (tab === 'classic') clUrl();
  };
  const drawClBar = () => {
    const html = `
      <div class="lb-field lb-field-wide"><span>Slate</span><b class="lb-bar-slate">${esc(C.pool.label)} · ${C.pool.n_games || C.games.length} games</b></div>
      <div class="lb-field"><span>Contest</span><span class="seg" role="group" aria-label="Ownership for">${[['own', 'Big contests'], ['own_se', 'One-entry contests']].map(([k, l]) => `<button type="button" class="${C.ownCol === k ? 'active' : ''}" aria-pressed="${C.ownCol === k}" data-cl-own="${k}"${k === 'own_se' && !(C.pool.has && C.pool.has.own_se) ? ' disabled' : ''}>${l}</button>`).join('')}</span></div>`;
    const h = $('lbClBar'); if (h.dataset.drawn !== html) { h.innerHTML = html; h.dataset.drawn = html; }
  };
  // The pool's ⓘ: how to read the rows + where the numbers come from.
  const clInfoHtml = () => `<p>Tap a player to add or remove him. Tap a column name to sort by it; tap again to flip. Faded = no open slot, or he doesn't leave room to fill the rest; <b>Affordable only</b> hides them.</p>
    ${C.proj.size ? '<p><b>Proj</b> = our mean DraftKings points · <b>Ceil</b> = 90th percentile · <b>Own</b> = expected pick rate · <b>lev</b> = how often he is in our optimal lineups minus how often the field picks him · <b>x</b> = points per $1,000.</p>' : ''}
    <p>Pick rates are for ${C.ownCol === 'own_se' ? 'one-entry contests' : 'big contests (thousands of entries)'}${C.pool.as_of ? `, updated ${esc(C.pool.as_of)}` : ''}. Game lines from ${C.preset ? 'the Classic playbook' : 'this week\'s slate'}.${C.dk ? ` DraftKings IDs from ${esc(C.dkName)}.` : ''}</p>
    <p><b>Fill lineup</b> completes your open slots with the most projected points (tilted a little toward ceiling) that pass every must-follow rule in our <a href="nfl/classic/" class="sd-link">Classic playbook</a> and follow its habits where it can.</p>`;
  const salUsed = () => lineupNames().reduce((a, n) => a + (C.pl.P.get(n)?.sal || 0), 0);
  const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
  const sgn1 = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${f1(Math.abs(v))}`;
  // Cheapest way to fill the open slots other than the one a player would take: keeps "fits" honest, not just "under the cap".
  const minFill = (except = -1) => {
    const inL = new Set(lineupNames()), cheap = {};
    for (const p of C.pl.P.values()) if (!inL.has(p.name)) { const k = p.pos; (cheap[k] = cheap[k] || []).push(p.sal); }
    for (const k in cheap) cheap[k].sort((a, b) => a - b);
    const take = {}, need = C.slots.map((n, i) => (!n && i !== except ? SLOTS[i] : null)).filter(Boolean);
    let s = 0;
    for (const k of need) {
      const pools = k === 'FLEX' ? ['RB', 'WR', 'TE'] : [k];
      let best = null; for (const q of pools) { const v = (cheap[q] || [])[take[q] || 0]; if (v != null && (best == null || v < best[1])) best = [q, v]; }
      if (best) { s += best[1]; take[best[0]] = (take[best[0]] || 0) + 1; }
    }
    return s;
  };
  const fits = p => { const i = slotFor(p.pos); return i >= 0 && salUsed() + p.sal + minFill(i) <= CAP; };
  /* ---------------- Fill lineup: our optimizer ----------------
     Completes the open slots: most projected points (with a small ceiling tilt) that pass every must-follow rule,
     minus the playbook's habit penalties (the engine's own hard() / soft()). Greedy starts + 1- and 2-player swaps
     over each position's top candidates; the players you picked stay locked. */
  const OUT_RE = /^(o|out|ir|d|doubtful|sus)/i;
  const pv = p => { const r = PJ(p); return r ? +r.proj + 0.15 * (+r.p90 - +r.proj) : 0; };
  const optScore = names => {
    const H = C.pb.rules.hard, X = C.eng.classify(names);
    // chalk with negative leverage needs Optimal %, which lives in our projections, not the pool: count it here
    const chalkNeg = X.ps.filter(p => (+p.own || 0) >= (H.chalk_own_threshold || 20) && PJ(p) && PJ(p).opt != null && +PJ(p).opt < +p.own).length;
    const nHard = C.eng.hard(X).filter(h => !/negative-leverage/.test(h)).length + Math.max(0, chalkNeg - (H.max_negative_leverage_chalk_per_lineup ?? 1));
    const pen = C.eng.soft(X).reduce((a, p) => a + p[1], 0);
    return { v: X.ps.reduce((a, p) => a + pv(p), 0) - 4 * pen - 30 * nHard, nHard, pen };
  };
  const optCands = () => {
    const by = {}, stat = C.pool.players.reduce((m, p) => (p.status ? m.set(p.name, p.status) : m), new Map());
    for (const p of C.pl.P.values()) { const r = PJ(p); if (!r || !(+r.proj > 0) || OUT_RE.test(stat.get(p.name) || r.status || '')) continue; (by[p.pos] = by[p.pos] || []).push(p); }
    const N = { QB: 10, RB: 14, WR: 18, TE: 8, DST: 8 };
    for (const k in by) { const a = by[k]; by[k] = [...new Set([...a.slice().sort((x, y) => pv(y) - pv(x)).slice(0, N[k] || 10), ...a.slice().sort((x, y) => pv(y) / y.sal - pv(x) / x.sal).slice(0, Math.ceil((N[k] || 10) / 2))])]; }
    return by;
  };
  const optFill = (slots = C.slots) => {
    const t0 = performance.now(), by = optCands(), open = slots.map((n, i) => n ? -1 : i).filter(i => i >= 0);
    if (!open.length) return { F: slots.slice(), s: optScore(slots) };
    const flex = [...(by.RB || []).slice(0, 10), ...(by.WR || []).slice(0, 12), ...(by.TE || []).slice(0, 4)];
    const cands = open.map(i => SLOTS[i] === 'FLEX' ? flex : (by[SLOTS[i]] || []));
    if (cands.some(c => !c.length)) return null;
    const salOf = n => C.pl.P.get(n).sal, sal = t => t.reduce((a, n) => a + (n ? salOf(n) : 0), 0);
    const minSal = cands.map(c => Math.min(...c.map(p => p.sal)));
    const greedy = (key, seed) => {
      const t = slots.slice();
      if (seed) { const k = open.findIndex(i => SLOTS[i] === seed.pos); if (k < 0) return null; t[open[k]] = seed.name; }
      for (let k = 0; k < open.length; k++) {
        const i = open[k]; if (t[i]) continue;
        const rest = open.slice(k + 1).reduce((a, j, m) => a + (t[j] ? 0 : minSal[k + 1 + m]), 0), room = CAP - sal(t) - rest;
        const ok = cands[k].filter(p => !t.includes(p.name) && p.sal <= room);
        const pick = ok.sort((x, y) => key(y) - key(x))[0] || cands[k].filter(p => !t.includes(p.name)).sort((x, y) => x.sal - y.sal)[0];
        if (!pick) return null; t[i] = pick.name;
      }
      return t;
    };
    const climb = t => {
      let cur = optScore(t);
      for (let pass = 0; pass < 8 && performance.now() - t0 < 700; pass++) {
        let moved = false;
        for (let a = 0; a < open.length; a++) for (const p of cands[a]) {   // one-player swaps
          if (t.includes(p.name)) continue;
          const u = t.slice(); u[open[a]] = p.name; if (sal(u) > CAP) continue;
          const sc = optScore(u); if (sc.v > cur.v + 1e-9) { t = u; cur = sc; moved = true; }
        }
        if (moved) continue;
        for (let a = 0; a < open.length && !moved; a++) for (let b = a + 1; b < open.length && !moved; b++) {   // two-player swaps move salary between slots
          const ia = open[a], ib = open[b], others = t.filter((n, j) => j !== ia && j !== ib), base = sal(t) - salOf(t[ia]) - salOf(t[ib]);
          const pvOld = pv(C.pl.P.get(t[ia])) + pv(C.pl.P.get(t[ib])), slack = cur.nHard ? Infinity : 4 * cur.pen;
          for (const p of cands[a]) { if (others.includes(p.name)) continue;
            for (const q of cands[b]) {
              if (q === p || others.includes(q.name) || base + p.sal + q.sal > CAP) continue;
              if (pv(p) + pv(q) - pvOld + slack <= 1e-9) continue;   // can't beat the current lineup even with every habit fixed
              const u = t.slice(); u[ia] = p.name; u[ib] = q.name;
              const sc = optScore(u); if (sc.v > cur.v + 1e-9) { t = u; cur = sc; moved = true; break; }
            }
            if (moved) break;
          }
        }
        if (!moved) break;
      }
      return { F: t, s: cur };
    };
    const starts = [greedy(p => pv(p)), greedy(p => pv(p) / p.sal)];
    if (!slots[0]) for (const q of (by.QB || []).slice().sort((x, y) => pv(y) - pv(x)).slice(0, 4)) starts.push(greedy(p => pv(p), q));
    let best = null;
    for (const t of starts.filter(Boolean)) { if (performance.now() - t0 > 900) break; const r = climb(t); if (!best || r.s.v > best.s.v) best = r; }
    return best;
  };
  // Cached per lineup: still valid while every pick so far matches the fill (taking our suggestion keeps it).
  const optFor = () => {
    const key = `${C.pool.id}|${C.ownCol}`, o = C.opt;
    if (o && o.key === key && (o.F ? C.slots.every((n, i) => !n || o.F[i] === n) : o.at === C.slots.join('|'))) return o;
    return null;
  };
  // The next open slot's best options: our fill's pick, then the players who fit best in its place with the rest of the fill.
  const bestAdds = () => {
    if (!C.proj.size) return [];
    const i = C.slots.findIndex(n => !n); if (i < 0) return [];
    const o = optFor(); if (!o) return null;   // null = still working
    if (!o.F) return [];
    const k = SLOTS[i], pool = optCands(), cands = k === 'FLEX' ? [...(pool.RB || []), ...(pool.WR || []), ...(pool.TE || [])] : (pool[k] || []);
    const rest = o.F.filter((n, j) => j !== i), restSal = rest.reduce((a, n) => a + C.pl.P.get(n).sal, 0);
    const alts = cands.filter(p => p.name !== o.F[i] && !rest.includes(p.name) && restSal + p.sal <= CAP)
      .map(p => { const u = o.F.slice(); u[i] = p.name; return { p, v: optScore(u).v }; }).sort((a, b) => b.v - a.v);
    return [{ p: C.pl.P.get(o.F[i]), slot: k }, ...alts.slice(0, 2).map(a => ({ p: a.p, slot: k }))];
  };
  let optT = 0;
  const optSchedule = () => {   // fill in the background after a pick, then redraw the lineup card
    clearTimeout(optT);
    optT = setTimeout(() => { if (optFor() || !C.slots.some(n => !n)) return; const r = optFill(); C.opt = { key: `${C.pool.id}|${C.ownCol}`, F: r ? r.F : null, at: C.slots.join('|') }; drawClLineup(); }, 60);
  };
  const clFillLineup = () => {
    let o = optFor();
    if (!o) { const r = optFill(); if (r) { C.opt = { key: `${C.pool.id}|${C.ownCol}`, F: r.F }; o = C.opt; } }
    if (!o || !o.F) { toast("Couldn't find a lineup that fits these picks: try removing one", 'warn'); return; }
    const n0 = C.slots.filter(n => !n).length;
    C.undo = { slots: C.slots.slice(), editing: C.editing }; C.slots = o.F.slice(); C.undoKey = luKey(C.slots);
    clDraw(); showGrade('lbClGrade');
    toast(`<b>Filled ${n0} slot${n0 === 1 ? '' : 's'}</b> · swap anyone you don't like`, 'good');
  };
  const clActs = n => {
    const done = n === 9 && C.res && C.res.roster.ok;
    const fill = n < 9 ? `<button type="button" class="btn btn-sm btn-primary" data-cl="fill"${C.proj.size ? '' : ' disabled title="Needs this week\'s projections"'}>${n ? 'Fill lineup' : 'Build me a lineup'}</button>` : '';
    const undo = C.undo && C.undoKey === luKey(C.slots) ? '<button type="button" class="btn btn-sm" data-cl="undo-fill">Undo fill</button>' : '';
    const at = n === 9 ? svFind(C.slots) : -1, ed = svIdx(C.editing), dis = done ? '' : 'disabled';
    const save = at >= 0 ? `<button type="button" class="btn btn-sm" disabled>Saved as #${at + 1} ✓</button>`
      : ed >= 0 ? `<button type="button" class="btn btn-sm btn-primary" data-cl="save" ${dis}>Update #${ed + 1}</button><button type="button" class="btn btn-sm" data-cl="save-new" ${dis}>Save as new</button>`
      : `<button type="button" class="btn btn-sm btn-primary" data-cl="save" ${dis}>Save lineup</button>`;
    return `${n < 9 ? fill : save}${undo}
      <button type="button" class="btn btn-sm" data-cl="paste">${C.pasteOpen ? 'Hide paste box' : 'Paste a lineup'}</button>
      <button type="button" class="btn btn-sm" data-cl="names" ${n === 9 ? '' : 'disabled'}>Copy lineup</button>
      ${done && hasIds() ? '<button type="button" class="btn btn-sm" data-cl="csv">Download DraftKings file</button>' : `<button type="button" class="btn btn-sm" data-cl="ids" ${done ? '' : 'disabled'} title="Needs your DraftKings salary file for the player IDs">Get a DraftKings file</button>`}
      <button type="button" class="btn btn-sm" data-cl="link" ${n ? '' : 'disabled'}>Copy link</button>
      <button type="button" class="btn btn-sm btn-ghost" data-cl="clear" ${n ? '' : 'disabled'}>Clear</button>`;
  };
  const drawClLineup = () => {
    const X = C.res && C.res.X, roles = X && CL() ? CL().rolesFor(X) : null;
    const names = lineupNames(), n = names.length, sal = salUsed(), own = C.pl.has.own, open = 9 - n;
    const ps = names.map(nm => C.pl.P.get(nm)), pj = ps.map(PJ);
    const proj = pj.reduce((a, r) => a + (r ? +r.proj : 0), 0), ceil = pj.reduce((a, r) => a + (r ? +r.p90 : 0), 0);
    const cum = ps.reduce((a, p) => a + (own ? +p.own || 0 : 0), 0);
    const sug = bestAdds();
    $('lbClLineup').innerHTML = `
      <div class="lb-h">Your lineup <small>${svIdx(C.editing) >= 0 ? `editing #${svIdx(C.editing) + 1} · ` : ''}${n}/9</small></div>
      ${C.proj.size || own ? `<div class="lb-tot">${C.proj.size ? `<span><em>Projection</em><b>${n ? f1(proj) : '—'}</b><small>pts</small></span><span><em>Ceiling</em><b>${n ? f1(ceil) : '—'}</b><small>90th pct</small></span>` : ''}${own ? `<span><em>Picked by</em><b>${n ? pct0(cum) : '—'}</b><small>added up</small></span>` : ''}</div>` : ''}
      <ol class="lb-slots">${C.slots.map((nm, i) => { const p = nm && C.pl.P.get(nm), r = PJ(p);
        return p ? `<li class="lb-slot"><span class="lb-slot-k">${SLOTS[i]}</span><span class="lb-slot-n"><b>${esc(p.name)}</b><small>${SLOTS[i] === 'FLEX' ? `${esc(p.pos)} · ` : ''}${esc(p.team)} vs ${esc(p.opp)} · ${money(p.sal)}${own ? ` · ${pct0(p.own)}` : ''}</small></span><span class="lb-tags">${roles && roles.get(p.name) ? roles.get(p.name).map(([c, l]) => `<em class="cl-tag ${c}">${esc(l)}</em>`).join('') : ''}</span><span class="lb-slot-pj">${r ? f1(r.proj) : ''}</span><button type="button" class="lb-x" data-cl-rm="${i}" aria-label="Remove ${esc(p.name)}">×</button></li>`
          : `<li class="lb-slot empty"><span class="lb-slot-k">${SLOTS[i]}</span><span class="lb-slot-n">${SLOTS[i] === 'FLEX' ? 'RB, WR or TE' : `Add a ${SLOTS[i]}`}</span><span></span><span></span><span></span></li>`; }).join('')}</ol>
      <div class="lb-sal"><span>Salary <b>${money(sal)}</b> of $50,000</span><span class="${sal > CAP ? 'neg' : ''}">${sal > CAP ? `over by ${money(sal - CAP)}` : `${money(CAP - sal)} left${open ? ` · ${money((CAP - sal) / open)} a slot` : ''}`}</span></div>
      <div class="lb-salbar${sal > CAP ? ' over' : ''}"><i style="width:${Math.min(100, sal / CAP * 100).toFixed(1)}%"></i></div>
      ${sug === null ? '<div class="lb-sug"><span class="lb-sug-k">Finding the best fits…</span></div>' : sug.length ? `<div class="lb-sug"><span class="lb-sug-k">Best ${esc(sug[0].slot)} for the rest of this lineup</span><div class="lb-sug-row">${sug.map(({ p }) => `<button type="button" class="lb-sug-btn" data-cl-add="${esc(p.name)}"><span class="sd-pos pos-${esc(p.pos)}">${esc(p.pos)}</span>${esc(p.name)}<em>${f1(PJ(p).proj)} · ${money(p.sal)}</em></button>`).join('')}</div></div>` : ''}
      <div class="lb-acts lb-cl-acts">${clActs(n)}</div>
      <div class="lb-paste" id="lbClPaste"${C.pasteOpen ? '' : ' hidden'}>
        <label class="sd-lab-k" for="lbClText">Paste 9 players <small>one per line, comma-separated, or a DraftKings upload row</small></label>
        <textarea class="lb-text" id="lbClText" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" placeholder="Josh Allen&#10;Bijan Robinson&#10;…"></textarea>
        <div class="lb-acts"><button type="button" class="btn btn-sm btn-primary" data-cl="paste-go">Grade it</button></div>
      </div>`;
    drawClMini(n, sal, proj);
    if (sug === null) optSchedule();
  };
  // Phone: a pinned one-liner while the lineup card is off screen; tap jumps back to it.
  const drawClMini = (n, sal, proj) => {
    const m = $('lbClMini'); if (!m) return;
    const tone = C.res && C.res.roster.ok ? (C.res.hard.some(h => h.status === 'fail') ? 'bad' : 'good') : '';
    m.className = `lb-mini ${tone}`;
    m.innerHTML = `<b>${n}/9</b><span>${money(CAP - sal)} left</span>${C.proj.size && n ? `<span>${f1(proj)} pts</span>` : ''}<em>${n === 9 ? 'See grade' : 'Lineup'} ↑</em>`;
  };
  const POOL_SORT = [['proj', 'Projection'], ['value', 'Pts per $1k'], ['ceil', 'Ceiling'], ['lev', 'Leverage'], ['own', 'Ownership'], ['sal', 'Salary'], ['name', 'Name']];
  // The 4th stat column follows the sort: Ceiling unless you sort by Pts per $1k or Leverage.
  const XCOL = { ceil: ['Ceil', r => f1(r.p90)], value: ['Pts/$1k', r => `${(+r.value).toFixed(2)}x`], lev: ['Lev', r => sgn1(r.lev)] };
  const PF = [['sal', 'Salary', '$k'], ['own', 'Ownership', '%'], ['proj', 'Projection', 'pts']];
  const fNum = k => { const v = parseFloat(C.f[k]); return Number.isFinite(v) ? v : null; };
  const salK = v => v != null && v < 100 ? v * 1000 : v;   // "5.5" = $5,500; "5500" also works
  const inRng = (x, lo, hi) => (lo == null || x >= lo) && (hi == null || x <= hi);
  const drawClPool = () => {
    const host = $('lbClPool'), inL = new Set(lineupNames()), q = C.q.trim().toLowerCase(), own = C.pl.has.own, hasPj = C.proj.size > 0;
    const games = [...new Set([...C.pl.P.values()].filter(p => p.team && p.opp).map(p => [p.team, p.opp].sort().join(' / ')))].sort();
    if (C.game !== 'ALL' && !games.includes(C.game)) C.game = 'ALL';
    if (!host.dataset.shell) {
      const pf = PF.filter(([k]) => (k !== 'own' || own) && (k !== 'proj' || hasPj));
      host.innerHTML = `<div class="lb-h">Player pool <span class="lb-h-r"><small id="lbClPoolN"></small><button type="button" class="lb-info-btn" data-cl="info" aria-expanded="false" aria-controls="lbClInfo" aria-label="How to read the player pool">i</button></span></div>
        <div class="lb-info" id="lbClInfo" role="note" hidden></div>
        <div class="sd-pool-head"><input class="sd-pool-q" id="lbClQ" type="search" placeholder="Search a name or team  /" aria-label="Search players" autocomplete="off">
          <select class="sd-pool-sort" id="lbClSort" aria-label="Sort players"></select></div>
        <div class="sd-pool-filters"><div class="sd-pool-pos" role="group" aria-label="Position" id="lbClPos"></div>
          <div class="lb-pf-row"><select class="sd-pool-sort lb-gamef" id="lbClGame" aria-label="Game"></select>
            <label class="lb-tgl"><input type="checkbox" id="lbClAfford"><span>Affordable only</span></label>
            <button type="button" class="lb-tgl" id="lbClFiltBtn" data-cl="filt" aria-expanded="false" aria-controls="lbClFilt">Filters</button></div>
          <div class="lb-pf" id="lbClFilt" hidden>
            ${pf.map(([k, l, u]) => `<div class="lb-pf-f"><span>${l} <small>(${u})</small></span><input type="number" inputmode="decimal" step="any" min="0" id="lbClF_${k}_min" placeholder="min" aria-label="${l} at least"><i>to</i><input type="number" inputmode="decimal" step="any" min="0" id="lbClF_${k}_max" placeholder="max" aria-label="${l} at most"></div>`).join('')}
            <div class="lb-pf-foot"><small>Salary in thousands: 5.5 = $5,500.</small><button type="button" class="btn btn-sm btn-ghost" data-cl="filt-reset">Reset filters</button></div>
          </div></div>
        <div class="lb-pcols" id="lbClCols"></div>
        <div class="lb-plist" id="lbClList" role="list" aria-label="Player pool"></div>`;
      host.dataset.shell = '1';
      $('lbClQ').addEventListener('input', e => { C.q = e.target.value; drawClPool(); });
      $('lbClSort').addEventListener('change', e => { C.sort = e.target.value; C.dir = 1; saveUi(); drawClPool(); });
      $('lbClGame').addEventListener('change', e => { C.game = e.target.value; drawClPool(); });
      $('lbClAfford').addEventListener('change', e => { C.afford = e.target.checked; saveUi(); drawClPool(); });
      $('lbClFilt').addEventListener('input', e => { const m = /^lbClF_(\w+_(?:min|max))$/.exec(e.target.id); if (m) { C.f[m[1]] = e.target.value; drawClPool(); } });
    }
    $('lbClSort').innerHTML = POOL_SORT.filter(([k]) => hasPj || !['proj', 'value', 'ceil', 'lev'].includes(k)).filter(([k]) => own || k !== 'own').map(([k, l]) => `<option value="${k}"${C.sort === k ? ' selected' : ''}>${l}</option>`).join('');
    $('lbClGame').innerHTML = `<option value="ALL">All games</option>${games.map(g => `<option value="${esc(g)}"${C.game === g ? ' selected' : ''}>${esc(g.replace(' / ', ' – '))}</option>`).join('')}`;
    $('lbClPos').innerHTML = ['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'DST'].map(k => `<button type="button" class="${C.pos === k ? 'on' : ''}" aria-pressed="${C.pos === k}" data-cl-pos="${k}">${k === 'ALL' ? 'All' : k}</button>`).join('');
    $('lbClAfford').checked = C.afford;
    // filters
    const sLo = salK(fNum('sal_min')), sHi = salK(fNum('sal_max')), oLo = fNum('own_min'), oHi = fNum('own_max'), pLo = fNum('proj_min'), pHi = fNum('proj_max');
    const nF = [sLo, sHi, oLo, oHi, pLo, pHi].filter(v => v != null).length, pjOn = pLo != null || pHi != null;
    const fb = $('lbClFiltBtn'); fb.textContent = nF ? `Filters · ${nF}` : 'Filters'; fb.classList.toggle('on', !!nF || C.filtOpen); fb.setAttribute('aria-expanded', C.filtOpen); $('lbClFilt').hidden = !C.filtOpen;
    let ps = [...C.pl.P.values()].filter(p => (C.pos === 'ALL' || (C.pos === 'FLEX' ? FLEXABLE.has(p.pos) : p.pos === C.pos))
      && (C.game === 'ALL' || [p.team, p.opp].sort().join(' / ') === C.game) && (!q || p.name.toLowerCase().includes(q) || p.team.toLowerCase() === q)
      && inRng(p.sal, sLo, sHi) && (!own || inRng(+p.own || 0, oLo, oHi)) && (!pjOn || (PJ(p) && inRng(+PJ(p).proj, pLo, pHi))));
    const ok = new Map(ps.map(p => [p.name, inL.has(p.name) || fits(p)]));
    const nHid = C.afford ? ps.filter(p => !ok.get(p.name)).length : 0;
    if (C.afford) ps = ps.filter(p => ok.get(p.name));
    const v = p => PJ(p) || {}, key = { proj: p => -(v(p).proj ?? -1), value: p => -(v(p).value ?? -1), ceil: p => -(v(p).p90 ?? -1), lev: p => -(v(p).lev ?? -99), own: p => -(+p.own || 0), sal: p => -p.sal, name: p => p.name }[C.sort] || (p => -p.sal);
    ps.sort((a, b) => { const x = key(a), y = key(b); return C.dir * (typeof x === 'string' ? x.localeCompare(y) : x - y) || b.sal - a.sal; });
    // column heads sort too: tap to sort by it, tap again to flip
    const xk = XCOL[C.sort] ? C.sort : 'ceil', XC = XCOL[xk];
    const head = (k, l) => `<button type="button" class="${C.sort === k ? 'on' : ''}" data-cl-sort="${k}" aria-label="Sort by ${l}${C.sort === k ? (C.dir > 0 ? ', sorted' : ', reversed') : ''}">${l}${C.sort === k ? (C.dir > 0 ? ' ↓' : ' ↑') : ''}</button>`;
    const cols = $('lbClCols'); cols.className = `lb-pcols${hasPj ? '' : ' nopj'}`;
    cols.innerHTML = `${head('name', 'Player')}${hasPj ? head('proj', 'Proj') + head(xk, XC[0]) : ''}${own ? head('own', 'Own') : '<span></span>'}${head('sal', 'Salary')}<span></span>`;
    const stat = C.pool.players.reduce((m, p) => (p.status ? m.set(p.name, p.status) : m), new Map());
    const list = $('lbClList'), top = list.scrollTop, ae = document.activeElement, focusName = ae && list.contains(ae) ? ae.closest('[data-cl-add]')?.dataset.clAdd : null;
    list.innerHTML = ps.map(p => {
      const r = PJ(p), inl = inL.has(p.name), st = stat.get(p.name) || (r && r.status) || '', fit = ok.get(p.name);
      return `<div class="lb-p${inl ? ' in' : ''}${fit ? '' : ' over'}${hasPj ? '' : ' nopj'}" role="listitem" tabindex="0" data-cl-add="${esc(p.name)}" aria-label="${esc(p.name)}, ${esc(p.pos)} ${esc(p.team)}, ${money(p.sal)}${r ? `, projected ${f1(r.proj)}` : ''}${inl ? ', in lineup' : fit ? '' : ', does not fit'}">
        <span class="sd-pos pos-${esc(p.pos)}">${esc(p.pos)}</span>
        <span class="lb-p-n">${esc(p.name)}${st ? `<span class="lb-q" title="Injury status">${esc(st)}</span>` : ''}<small>${esc(p.team)} vs ${esc(p.opp)}${r && r.opt != null ? `<span class="lb-p-opt"> · optimal ${f1(r.opt)}%</span>` : ''}</small></span>
        ${hasPj ? `<span class="lb-p-pj">${r ? f1(r.proj) : '—'}<small${xk === 'ceil' ? ' class="lb-dup"' : ''}>${r ? `ceil ${f1(r.p90)}` : ''}</small></span>
        <span class="lb-p-x">${r && r[xk === 'ceil' ? 'p90' : xk] != null ? XC[1](r) : '—'}</span>` : ''}
        <span class="lb-p-own">${own ? pct0(p.own) : ''}<small${xk === 'lev' ? ' class="lb-dup"' : ''}>${r && r.lev != null ? `lev ${sgn1(r.lev)}` : ''}</small></span>
        <span class="lb-p-sal">${money(p.sal)}<small${xk === 'value' ? ' class="lb-dup"' : ''}>${r && r.value != null ? `${(+r.value).toFixed(2)}x` : ''}</small></span>
        <span class="lb-p-btn${inl ? ' on' : ''}" aria-hidden="true">${inl ? '−' : '+'}</span>
      </div>`;
    }).join('') || `<div class="sd-pool-empty">No player matches${nF ? ' these filters' : ''}${C.afford ? ' that you can still afford' : ''}.</div>`;
    list.scrollTop = top;
    if (focusName) { const el = [...list.querySelectorAll('[data-cl-add]')].find(x => x.dataset.clAdd === focusName); if (el) el.focus({ preventScroll: true }); }
    $('lbClPoolN').textContent = `${ps.length} of ${C.pl.P.size}${nHid ? ` · ${nHid} you can't afford hidden` : ''}`;
    list.dataset.sort = C.sort === 'ceil' || C.sort === 'value' || C.sort === 'lev' ? 'x' : C.sort;
    if (!$('lbClInfo').hidden) $('lbClInfo').innerHTML = clInfoHtml();
  };
  /* ---------------- saved lineups (this browser, per week's pool) ---------------- */
  const luKey = slots => slots.filter(Boolean).slice().sort().join('|');
  const svFind = slots => { const k = luKey(slots); return C.saved.findIndex(s => luKey(s.slots) === k); };
  const svIdx = id => id == null ? -1 : C.saved.findIndex(s => s.id === id);
  const svRead = () => { try { const s = JSON.parse(lsGet(LS_CL_SAVED)); return s && typeof s === 'object' && !Array.isArray(s) ? s : {}; } catch { return {}; } };
  const svLoad = () => { const l = svRead()[C.pool.id]; C.saved = Array.isArray(l) ? l.filter(x => x && Array.isArray(x.slots) && x.slots.length === 9 && x.id != null) : []; };
  const svStore = () => {
    const s = svRead(); s[C.pool.id] = C.saved;
    const wk = Object.keys(s).sort((a, b) => Math.max(0, ...(s[b] || []).map(x => x.t || 0)) - Math.max(0, ...(s[a] || []).map(x => x.t || 0)));
    for (const k of wk.slice(4)) if (k !== C.pool.id) delete s[k];   // keep the last few slates
    lsSet(LS_CL_SAVED, JSON.stringify(s));
  };
  const svSave = asNew => {
    if (lineupNames().length !== 9 || !C.res || !C.res.roster.ok) return;
    const dup = svFind(C.slots); if (dup >= 0) { toast(`Already saved as #${dup + 1}`, 'warn'); return; }
    const ed = svIdx(C.editing);
    if (ed >= 0 && !asNew) { C.saved[ed] = { ...C.saved[ed], slots: C.slots.slice(), t: Date.now() }; C.editing = null; svStore(); clDraw(); toast(`<b>Lineup #${ed + 1} updated</b>`, 'good'); return; }
    if (C.saved.length >= 150) { toast('150 lineups is the DraftKings limit per contest', 'warn'); return; }
    C.saved.push({ id: Math.max(0, ...C.saved.map(s => +s.id || 0)) + 1, slots: C.slots.slice(), t: Date.now() });
    C.editing = null; svStore(); clDraw();
    toast(`<b>Saved as #${C.saved.length}</b> · swap a player or two to build the next one`, 'good');
  };
  const shortName = p => p.pos === 'DST' ? p.name : (p.name.split(' ').slice(1).join(' ') || p.name);
  // Import (2026-11-04): a DraftKings entries export (contest columns, then QB, RB, RB, WR, WR, WR, TE, FLEX, DST) or a DK upload file. Every lineup
  // whose 9 players are in this week's pool is added to Saved lineups, where each gets its grade. Read in the browser only.
  const csvCells = line => { const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) { const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; }
    out.push(cur); return out.map(x => x.trim()); };
  const importLineups = text => {
    const rows = String(text || '').split(/\r?\n/).map(csvCells);
    const hi = rows.findIndex(r => r.includes('QB') && r.includes('DST') && r.filter(x => x === 'WR').length >= 3);
    if (hi < 0) { toast('That file has no QB … DST columns. Use your DraftKings entries export or a DraftKings upload file.', 'warn'); return; }
    const H = rows[hi], start = H.indexOf('QB'), cols = H.slice(start, start + 9);
    if (cols.join() !== SLOTS.join()) { toast('Those columns are not a Classic lineup (QB, RB, RB, WR, WR, WR, TE, FLEX, DST).', 'warn'); return; }
    let added = 0, dup = 0, miss = 0, full = 0;
    for (const r of rows.slice(hi + 1)) {
      const names = r.slice(start, start + 9).map(x => x.replace(/\s*\(\d+\)\s*$/, '').trim());
      if (names.length < 9 || names.some(n => !n)) continue;
      if (names.some(n => !C.pl.P.has(n))) { miss++; continue; }
      if (svFind(names) >= 0) { dup++; continue; }
      if (C.saved.length >= 150) { full++; continue; }
      C.saved.push({ id: Math.max(0, ...C.saved.map(s => +s.id || 0)) + 1, slots: names.slice(), t: Date.now() }); added++;
    }
    svStore(); clDraw();
    const bits = [dup && `${dup} already saved`, miss && `${miss} with players not in this week's pool`, full && `${full} over the 150 limit`].filter(Boolean);
    toast(added ? `<b>Imported ${added} lineup${added > 1 ? 's' : ''}</b>${bits.length ? ' · ' + bits.join(' · ') : ''}. Each one is graded in Saved lineups.` :
      `Nothing new to import${bits.length ? ': ' + bits.join(' · ') : ''}.`, added ? 'good' : 'warn');
  };
  document.addEventListener('change', e => {
    if (!e.target || e.target.id !== 'lbClImport' || !e.target.files || !e.target.files[0]) return;
    const fr = new FileReader(); fr.onload = () => importLineups(fr.result); fr.readAsText(e.target.files[0]);
  });
  const drawClSaved = () => {
    const host = $('lbClSaved'); if (!host) return;
    const N = C.saved.length, own = C.pl.has.own;
    if (!N) { host.innerHTML = `<div class="lb-h">Saved lineups <small>0</small></div><p class="lb-muted">Save as many lineups as you want. They stay in this browser for this week's slate, and you can download them all in one DraftKings upload file. Already built them on DraftKings? Import the file and every lineup gets graded.</p><div class="lb-acts lb-sv-acts"><button type="button" class="btn btn-sm" data-cl="sv-import" title="Your DraftKings entries export or a DraftKings upload file: every lineup in it gets graded here. Read in your browser only.">Import my DraftKings lineups</button><input type="file" id="lbClImport" accept=".csv,.txt" hidden></div>`; return; }
    const cur = lineupNames().length === 9 ? luKey(C.slots) : '', expo = new Map();
    let allIds = !!C.dk;
    const rows = C.saved.map((s, i) => {
      const ps = s.slots.map(n => n && C.pl.P.get(n)).filter(Boolean), miss = 9 - ps.length;
      for (const p of ps) expo.set(p.name, (expo.get(p.name) || 0) + 1);
      if (miss || !ps.every(p => C.pl.ids.get(p.name))) allIds = false;
      const sal = ps.reduce((a, p) => a + p.sal, 0), proj = ps.reduce((a, p) => a + (PJ(p) ? +PJ(p).proj : 0), 0), cum = ps.reduce((a, p) => a + (+p.own || 0), 0);
      let tone = 'good', why = '';
      if (miss) { tone = 'bad'; why = `${miss} player${miss > 1 ? 's' : ''} not in this week's pool`; }
      else { const r = C.eng.check(s.slots); const f = r.hard.filter(h => h.status === 'fail').length; if (!r.roster.ok) { tone = 'bad'; why = 'roster problem'; } else if (f) { tone = 'bad'; why = `breaks ${f} rule${f > 1 ? 's' : ''}`; } }
      const qb = ps.find(p => p.pos === 'QB'), stack = qb ? ps.filter(p => p !== qb && p.team === qb.team && p.pos !== 'DST') : [];
      return `<li class="lb-sv ${tone}${s.id === C.editing ? ' on' : ''}${luKey(s.slots) === cur ? ' cur' : ''}">
        <button type="button" class="lb-sv-main" data-cl-sv-load="${s.id}" aria-label="Lineup ${i + 1}: load it into the builder to edit">
          <span class="lb-sv-k">#${i + 1}</span>
          <span class="lb-sv-n"><b>${qb ? esc(qb.name) : 'No QB'}${stack.length ? ` + ${esc(stack.map(shortName).join(', '))}` : ''}</b><small>${ps.map(p => esc(shortName(p))).join(' · ')}</small>${why ? `<em>${esc(why)}</em>` : ''}</span>
          <span class="lb-sv-st">${C.proj.size ? `${f1(proj)}<small>pts</small>` : ''}<small>${money(sal)}${own ? ` · ${pct0(cum)}` : ''}</small></span>
        </button>
        <button type="button" class="lb-x" data-cl-sv-rm="${s.id}" aria-label="Delete lineup ${i + 1}">×</button></li>`;
    }).join('');
    const ex = [...expo].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 14);
    host.innerHTML = `<div class="lb-h">Saved lineups <small>${N} · tap one to edit it</small></div>
      <ol class="lb-svs">${rows}</ol>
      ${N >= 2 ? `<div class="lb-exp"><span class="lb-sug-k">Exposure · share of your saved lineups</span><div class="lb-exp-row">${ex.map(([n, c]) => `<span>${esc(shortName(C.pl.P.get(n) || { name: n, pos: '' }))} <b>${pct0(c / N * 100)}</b></span>`).join('')}</div></div>` : ''}
      <div class="lb-acts lb-sv-acts">
        ${allIds ? `<button type="button" class="btn btn-sm btn-primary" data-cl="sv-csv">Download all ${N} for DraftKings</button>` : '<button type="button" class="btn btn-sm btn-primary" data-cl="ids" title="Needs your DraftKings salary file for the player IDs">Get a DraftKings file for all</button>'}
        <button type="button" class="btn btn-sm" data-cl="sv-copy">Copy all</button>
        <button type="button" class="btn btn-sm" data-cl="sv-import" title="Your DraftKings entries export or a DraftKings upload file: every lineup in it gets graded here. Read in your browser only.">Import my DraftKings lineups</button><input type="file" id="lbClImport" accept=".csv,.txt" hidden>
        <button type="button" class="btn btn-sm btn-ghost" data-cl="sv-clear">Delete all</button>
      </div>`;
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
    svLoad();
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
      const so = t.closest('[data-cl-sort]'); if (so) { const k = so.dataset.clSort; if (C.sort === k) C.dir = -C.dir; else { C.sort = k; C.dir = 1; } saveUi(); drawClPool(); return; }
      const ld = t.closest('[data-cl-sv-load]'); if (ld) {
        const s = C.saved[svIdx(+ld.dataset.clSvLoad)]; if (!s) return;
        C.slots = s.slots.map(n => n && C.pl.P.has(n) ? n : null); C.editing = s.id; clDraw();
        $('lbClLineup').scrollIntoView({ behavior: media('(prefers-reduced-motion: reduce)') ? 'auto' : 'smooth', block: 'nearest' });
        toast(`Editing <b>#${svIdx(s.id) + 1}</b>: swap players, then Update or Save as new`); return;
      }
      const sr = t.closest('[data-cl-sv-rm]'); if (sr) { const i = svIdx(+sr.dataset.clSvRm); if (i < 0) return; if (C.saved[i].id === C.editing) C.editing = null; C.saved.splice(i, 1); svStore(); clDraw(); toast(`Lineup #${i + 1} deleted`); return; }
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
      if (act === 'clear') { C.slots = Array(9).fill(null); C.editing = null; clDraw(); return; }
      if (act === 'fill') { clFillLineup(); return; }
      if (act === 'undo-fill') { if (C.undo) { C.slots = C.undo.slots; C.editing = C.undo.editing; C.undo = null; clDraw(); } return; }
      if (act === 'info') { const box = $('lbClInfo'), open = box.hidden; box.innerHTML = clInfoHtml(); box.hidden = !open; a.setAttribute('aria-expanded', open); return; }
      if (act === 'filt') { C.filtOpen = !C.filtOpen; drawClPool(); if (C.filtOpen) $('lbClFilt').querySelector('input')?.focus({ preventScroll: true }); return; }
      if (act === 'filt-reset') { C.f = {}; $('lbClFilt').querySelectorAll('input').forEach(i => { i.value = ''; }); drawClPool(); return; }
      if (act === 'save' || act === 'save-new') { svSave(act === 'save-new'); return; }
      if (act === 'sv-import') { const f = $('lbClImport'); if (f) { f.value = ''; f.click(); } return; }
      if (act === 'sv-copy') { copyText(C.saved.map((s, i) => `#${i + 1}: ${s.slots.map((n, j) => `${SLOTS[j]} ${n}`).join(', ')}`).join('\n'), `${C.saved.length} lineups copied`); return; }
      if (act === 'sv-csv') { const rows = C.saved.map(s => s.slots.map(n => C.pl.ids.get(n))).filter(r => r.every(Boolean)); if (rows.length) download(`${SLOTS.join(',')}\n${rows.map(r => r.join(',')).join('\n')}\n`, `DK_upload_classic_${C.pool.id}_${rows.length}.csv`); if (rows.length < C.saved.length) toast(`${C.saved.length - rows.length} lineup(s) left out: players without DraftKings IDs`, 'warn'); return; }
      if (act === 'sv-clear') { if (!confirm(`Delete all ${C.saved.length} saved lineups?`)) return; C.saved = []; C.editing = null; svStore(); clDraw(); return; }
      if (act === 'csv') { if (hasIds()) download(clCsv(), `DK_upload_classic_${C.pool.id}.csv`); return; }
      if (act === 'ids') { const f = $('lbClFiles'); f.open = true; f.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      if (act === 'names') { copyText(C.slots.map((n, i) => `${SLOTS[i]} ${n}`).join('\n'), 'Lineup copied: enter it on DraftKings'); return; }
      if (act === 'link') { clUrl(); copyText(location.href, 'Link copied: it opens this lineup in the Lab'); return; }
    });
    panel.addEventListener('keydown', e => {   // pool rows are divs: Enter / Space add or remove, like a button
      const row = e.target.classList && e.target.classList.contains('lb-p') ? e.target : null;
      if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); row.click(); return; }
      if (row && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); const nx = e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling; if (nx) nx.focus(); return; }
    });
    const infoClose = () => { const box = $('lbClInfo'); if (box && !box.hidden) { box.hidden = true; document.querySelector('[data-cl="info"]')?.setAttribute('aria-expanded', 'false'); } };
    document.addEventListener('click', e => { if (!e.target.closest('#lbClInfo, [data-cl="info"]')) infoClose(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') infoClose(); });
    // Phone: the pinned summary shows while the lineup card is scrolled away.
    const mini = $('lbClMini'), card = $('lbClLineup');
    if (mini && card && 'IntersectionObserver' in window) {
      new IntersectionObserver(([en]) => { mini.hidden = en.isIntersecting || tab !== 'classic' || !media('(max-width: 899px)'); }).observe(card);
      mini.addEventListener('click', () => { const el = lineupNames().length === 9 ? $('lbClGrade') : card; el.scrollIntoView({ behavior: media('(prefers-reduced-motion: reduce)') ? 'auto' : 'smooth', block: 'start' }); });
    }
    panel.addEventListener('keydown', e => { if ((e.target.id === 'lbClText' || e.target.id === 'lbClQuickText') && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.target.closest('.lb-paste').querySelector('[data-cl="paste-go"]').click(); } });
  };

  /* =================================================================
     SHARE CARD
     A 1200×630 PNG of the grade the Lab just showed (showdown: CPT + 5,
     classic: the 9 slots), drawn on an offscreen canvas in the browser:
     nothing is uploaded and nothing is fetched beyond the site's own mark.
     The dialog offers Download, Share (Web Share with a file) and Copy
     image, each only where the browser can do it.
     ================================================================= */
  const CARD_W = 1200, CARD_H = 630;
  const CK = { bg: '#0a0a0f', card: '#141419', sunk: '#101017', chip: '#1c1c24', gold: '#d4a843', ink: '#f4f4f8', body: '#c0c0cc', muted: '#8a8a98', dim: '#5a5a68', good: '#4ade80', bad: '#f87171' };
  const C_SANS = "'Inter', -apple-system, 'Segoe UI', Helvetica, sans-serif", C_MONO = "'JetBrains Mono', Menlo, monospace";
  const CARD_FONTS = ['800 38px Inter', '700 20px Inter', '500 18px Inter', '600 13px "JetBrains Mono"', '400 12px "JetBrains Mono"'];
  let markP = null;
  // The brand mark is the site's own file (assets/img/mark-gold.svg), never redrawn; no mark if it can't load.
  const cardMark = () => markP || (markP = new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = 'assets/img/mark-gold.svg'; }));
  const drawCard = async d => {
    try { await Promise.all(CARD_FONTS.map(f => document.fonts.load(f))); } catch {}
    try { await document.fonts.ready; } catch {}
    const mark = await cardMark();
    const cv = document.createElement('canvas'); cv.width = CARD_W; cv.height = CARD_H;
    const g = cv.getContext('2d');
    const font = (o = {}) => `${o.weight || 400} ${o.size || 14}px ${o.mono ? C_MONO : C_SANS}`;
    const fit = (t, maxW, o) => { t = String(t ?? ''); g.font = font(o); if (g.measureText(t).width <= maxW) return t; while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; };
    const txt = (t, x, y, o = {}) => { g.font = font(o); g.fillStyle = o.color || CK.ink; g.textAlign = o.align || 'left'; g.textBaseline = 'alphabetic'; g.fillText(o.maxW ? fit(t, o.maxW, o) : String(t ?? ''), x, y); };
    const wrap = (t, x, y, maxW, lh, o = {}) => {   // -> the y after the last line drawn; the last allowed line ends in … when cut
      g.font = font(o); const words = String(t ?? '').split(' ').filter(Boolean); let line = '', n = 0;
      for (let i = 0; i < words.length; i++) {
        const test = line ? `${line} ${words[i]}` : words[i];
        if (g.measureText(test).width <= maxW || !line) { line = test; continue; }
        if (o.max && n === o.max - 1) { txt(words.slice(i).reduce((a, w) => `${a} ${w}`, line), x, y, { ...o, maxW }); return y + lh; }
        txt(line, x, y, o); line = words[i]; y += lh; n++; g.font = font(o);
      }
      if (line) txt(line, x, y, { ...o, maxW }); return y + lh;
    };
    const rr = (x, y, w, h, r, fill, stroke) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); } };
    const toneC = d.tone === 'good' ? CK.good : d.tone === 'bad' ? CK.bad : CK.gold;
    // background: the site's page color, a soft gold glow, a gold rule on top
    g.fillStyle = CK.bg; g.fillRect(0, 0, CARD_W, CARD_H);
    const glow = g.createRadialGradient(140, 0, 0, 140, 0, 760); glow.addColorStop(0, 'rgba(212,168,67,0.13)'); glow.addColorStop(1, 'rgba(212,168,67,0)');
    g.fillStyle = glow; g.fillRect(0, 0, CARD_W, CARD_H);
    g.fillStyle = CK.gold; g.fillRect(0, 0, CARD_W, 6);
    // header: mark + name (left), contest + slate (right)
    const pad = 56; let bx = pad;
    if (mark && mark.naturalWidth) { const h = 40, w = h * mark.naturalWidth / mark.naturalHeight; g.drawImage(mark, pad, 38, w, h); bx = pad + w + 14; }
    txt('BirdieBuddy', bx, 68, { size: 30, weight: 800 });
    txt('NFL · LINEUP LAB', bx, 92, { mono: true, size: 13, weight: 600, color: CK.gold });
    txt(d.kind.toUpperCase(), CARD_W - pad, 56, { mono: true, size: 13, weight: 600, color: CK.gold, align: 'right' });
    txt(d.slate, CARD_W - pad, 84, { size: 22, weight: 700, align: 'right', maxW: 560 });
    txt(d.slateSub, CARD_W - pad, 108, { mono: true, size: 13, color: CK.muted, align: 'right', maxW: 560 });
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(pad, 130, CARD_W - pad * 2, 1);
    // left: the grade line's headline, then the numbers
    const LW = 480;
    txt('GRADE', pad, 170, { mono: true, size: 12, weight: 600, color: CK.dim });
    const long = String(d.title).length > 34, ts = long ? 30 : 38;   // a long headline gets a third line at a smaller size
    let y = wrap(d.title, pad, 212, LW, ts + 6, { size: ts, weight: 800, color: toneC, max: long ? 3 : 2 });
    for (const l of d.lines || []) { if (y > 330) break; y = wrap(l, pad, y + 2, LW, 26, { size: 19, weight: 500, color: CK.body, max: 2 }); }
    const tw = (LW - 14) / 2, th = 92;
    d.tiles.slice(0, 4).forEach((t, i) => {
      const x = pad + (i % 2) * (tw + 14), ty = 362 + Math.floor(i / 2) * (th + 14);
      rr(x, ty, tw, th, 12, CK.card, 'rgba(212,168,67,0.28)');
      txt(t[0].toUpperCase(), x + 16, ty + 26, { mono: true, size: 11, weight: 600, color: CK.dim, maxW: tw - 32 });
      txt(t[1], x + 16, ty + 62, { size: t[1].length > 9 ? 22 : 30, weight: 800, maxW: tw - 32 });
      txt(t[2], x + 16, ty + 81, { mono: true, size: 11.5, color: CK.muted, maxW: tw - 32 });
    });
    // right: the lineup with salaries
    const RX = 580, RW = CARD_W - pad - RX, n = d.slots.length;
    txt('LINEUP', RX, 170, { mono: true, size: 12, weight: 600, color: CK.dim });
    txt(`${money(d.salary)} of $50,000`, RX + RW, 170, { mono: true, size: 12, color: CK.muted, align: 'right' });
    const top = 186, avail = 558 - top, gap = n > 6 ? 6 : 8, rh = Math.floor((avail - gap * (n - 1)) / n), big = rh >= 50;
    d.slots.forEach((p, i) => {
      const ry = top + i * (rh + gap), mid = ry + rh / 2;
      rr(RX, ry, RW, rh, 10, CK.sunk, p.hi && d.mode === 'showdown' ? 'rgba(212,168,67,0.6)' : 'rgba(255,255,255,0.07)');
      txt(p.k, RX + 16, mid + 4.5, { mono: true, size: 12, weight: 600, color: p.k === 'FLEX' && d.mode === 'showdown' ? CK.dim : CK.gold });
      if (p.pos && p.pos !== p.k) { rr(RX + 70, mid - 10, 42, 20, 5, CK.chip); txt(p.pos, RX + 91, mid + 4, { mono: true, size: 11, weight: 600, color: CK.muted, align: 'center' }); }   // classic QB/RB/... slots already say it
      const nx = RX + 126, nw = RW - 126 - 120;
      if (big) { txt(p.name, nx, mid - 2, { size: 19, weight: 700, maxW: nw }); txt(p.sub, nx, mid + 17, { mono: true, size: 11, color: CK.dim, maxW: nw }); }
      else { txt(p.name, nx, mid + 5.5, { size: 16, weight: 700, maxW: nw - 54 }); txt(p.sub, RX + RW - 112, mid + 4.5, { mono: true, size: 11, color: CK.dim, align: 'right' }); }
      txt(money(p.sal), RX + RW - 16, mid + (big && p.hi && d.mode === 'showdown' ? 0 : 5), { mono: true, size: 15, weight: 600, color: p.hi && d.mode === 'showdown' ? CK.gold : CK.ink, align: 'right' });
      if (big && p.hi && d.mode === 'showdown') txt('1.5×', RX + RW - 16, mid + 17, { mono: true, size: 10.5, color: CK.dim, align: 'right' });
    });
    // footer
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(pad, 580, CARD_W - pad * 2, 1);
    txt('Graded at birdiebuddy.io/nfl/lab', pad, 610, { mono: true, size: 15, weight: 600, color: CK.gold });
    txt(new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), CARD_W - pad, 610, { mono: true, size: 13, color: CK.dim, align: 'right' });
    return cv;
  };
  const cardBlob = cv => new Promise(res => { try { cv.toBlob(res, 'image/png'); } catch { res(null); } });
  const canCopyImg = () => !!(navigator.clipboard && navigator.clipboard.write && window.ClipboardItem);
  const canShareFile = f => { try { return !!(f && navigator.share && navigator.canShare && navigator.canShare({ files: [f] })); } catch { return false; } };

  let cardDlg = null, cardCur = null, cardUrl = '', cardOpener = null;
  const cardDialog = () => {
    if (cardDlg) return cardDlg;
    const d = document.createElement('dialog');
    d.className = 'lb-card-dlg'; d.id = 'lbCardDlg'; d.setAttribute('aria-labelledby', 'lbCardDlgT');
    d.innerHTML = `<div class="lb-card-in"><div class="lb-card-head"><h2 id="lbCardDlgT">Share card</h2><button type="button" class="lb-card-x" data-card-act="close" aria-label="Close">×</button></div>
      <div class="lb-card-prev"><img id="lbCardImg" alt="" width="1200" height="630" hidden><p class="lb-card-wait" id="lbCardWait">Drawing the card…</p></div>
      <div class="lb-card-acts">
        <button type="button" class="btn btn-primary" data-card-act="download" disabled>Download PNG</button>
        <button type="button" class="btn" data-card-act="share" hidden>Share</button>
        <button type="button" class="btn" data-card-act="copy" hidden>Copy image</button>
      </div>
      <p class="lb-card-note">Made in your browser from this grade; nothing is uploaded.</p>
      <p class="lb-card-st" id="lbCardSt" role="status" aria-live="polite"></p></div>`;
    document.body.appendChild(d);
    d.addEventListener('click', e => {
      if (e.target === d) { closeCard(); return; }   // a click on the backdrop (the content sits in .lb-card-in)
      const b = e.target.closest('[data-card-act]'); if (b) cardAct(b.dataset.cardAct);
    });
    d.addEventListener('close', () => { if (cardOpener && document.contains(cardOpener)) try { cardOpener.focus({ preventScroll: true }); } catch {} });
    d.addEventListener('keydown', e => { if (e.key === 'Escape' && !d.showModal) closeCard(); });
    return (cardDlg = d);
  };
  const cardStatus = t => { const s = $('lbCardSt'); if (s) s.textContent = t; };
  const closeCard = () => { const d = cardDlg; if (!d) return; if (d.close) d.close(); else { d.removeAttribute('open'); d.dispatchEvent(new Event('close')); } };
  // -> {canvas, blob, file} for a tab's last grade, or null when that tab has no complete grade yet.
  const renderCard = async mode => {
    const d = lastCard[mode]; if (!d) return null;
    const canvas = await drawCard(d), blob = await cardBlob(canvas);
    const name = `birdiebuddy-lab-${mode}-${String(d.file || 'lineup').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()}.png`;
    let file = null; try { file = blob ? new File([blob], name, { type: 'image/png' }) : null; } catch {}
    return { canvas, blob, file, name, alt: `Lineup Lab grade: ${d.title}. ${d.slots.map(p => `${p.k} ${p.name}`).join(', ')}.` };
  };
  const openCard = async (mode, opener) => {
    if (!lastCard[mode]) { toast(mode === 'classic' ? 'Fill all 9 slots to get a share card' : 'Pick a captain and five more to get a share card', 'warn'); return; }
    const d = cardDialog(); cardOpener = opener || document.activeElement;
    const img = $('lbCardImg'), wait = $('lbCardWait');
    img.hidden = true; wait.hidden = false; wait.textContent = 'Drawing the card…'; cardStatus('');
    d.querySelectorAll('[data-card-act="download"], [data-card-act="share"], [data-card-act="copy"]').forEach(b => { b.disabled = true; });
    if (!d.open) { if (d.showModal) d.showModal(); else { d.setAttribute('open', ''); d.classList.add('lb-card-fb'); } }
    const want = mode + '|' + JSON.stringify(lastCard[mode]);
    cardCur = { want };
    const r = await renderCard(mode);
    if (!cardCur || cardCur.want !== want) return;   // closed or reopened while drawing
    if (!r || !r.blob) { wait.textContent = "Your browser couldn't draw the card."; return; }
    if (cardUrl) URL.revokeObjectURL(cardUrl);
    cardUrl = URL.createObjectURL(r.blob);
    Object.assign(cardCur, r);
    img.src = cardUrl; img.alt = r.alt; img.hidden = false; wait.hidden = true;
    const share = d.querySelector('[data-card-act="share"]'), copy = d.querySelector('[data-card-act="copy"]'), dl = d.querySelector('[data-card-act="download"]');
    share.hidden = !canShareFile(r.file); copy.hidden = !canCopyImg();
    [dl, share, copy].forEach(b => { b.disabled = false; });
    const fo = document.activeElement; if (!d.contains(fo) || fo === d || fo.dataset.cardAct === 'close') dl.focus();   // ready: Download takes focus unless the reader moved it
  };
  const cardAct = async act => {
    if (act === 'close') { closeCard(); return; }
    const c = cardCur; if (!c || !c.blob) return;
    if (act === 'download') {
      const a = document.createElement('a'); a.href = URL.createObjectURL(c.blob); a.download = c.name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      cardStatus('Downloaded.'); return;
    }
    if (act === 'copy') {
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': c.blob })]); cardStatus('Image copied: paste it into a post or a message.'); }
      catch { cardStatus("Your browser blocked the copy: use Download PNG instead."); }
      return;
    }
    if (act === 'share') {
      try { await navigator.share({ files: [c.file], title: 'My Lineup Lab grade', text: 'Graded at birdiebuddy.io/nfl/lab' }); cardStatus('Shared.'); }
      catch (e) { cardStatus(e && e.name === 'AbortError' ? '' : "Sharing didn't work here: use Download PNG instead."); }
    }
  };
  const bindCard = () => {
    document.addEventListener('click', e => { const b = e.target.closest('[data-lb-card]'); if (b) { e.preventDefault(); openCard(b.dataset.lbCard, b); } });
  };

  /* ?selftest=card (a check, not a feature): grades a sample lineup on each tab, draws both cards and writes
     {classic, showdown: PNG data-URL lengths, button: {classic, showdown}} to <html data-card-selftest>, then
     opens the dialog (?card=classic|showdown) for a screenshot. The visitor's saved Lab state is put back. */
  const cardSelfTest = async () => {
    const out = { classic: 0, showdown: 0, button: {}, size: {} };
    const keep = {}; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^bbi_/.test(k)) keep[k] = localStorage.getItem(k); } } catch {}
    const wait = async (f, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = f(); if (v) return v; } catch {} await new Promise(r => setTimeout(r, 100)); } return null; };
    const measure = async mode => {   // the PNG itself goes on <html data-card-png-classic|showdown> so a headless check can save it
      const r = await renderCard(mode); if (!r) return;
      const url = r.canvas.toDataURL('image/png'); out[mode] = url.length; out.size[mode] = `${r.canvas.width}x${r.canvas.height}`;
      document.documentElement.setAttribute(`data-card-png-${mode}`, url);
    };
    try {
      setTab('classic');
      if (await wait(() => C.eng)) {
        const o = C.proj.size ? optFill(Array(9).fill(null)) : null;
        let t = o && o.F && o.F.every(Boolean) ? o.F : null;
        if (!t) { const ps = [...C.pl.P.values()].filter(p => p.sal > 0).sort((a, b) => a.sal - b.sal); t = []; for (const k of SLOTS) { const p = ps.find(q => !t.includes(q.name) && (k === 'FLEX' ? FLEXABLE.has(q.pos) : q.pos === k)); t.push(p ? p.name : null); } }
        C.slots = t.slice(); clDraw();
        out.button.classic = !!$('lbClGrade').querySelector('[data-lb-card="classic"]');
        await measure('classic');
      }
      setTab('showdown');
      const L = await wait(() => SL() && SL().engine && SD() && SD().data && SL());
      if (L) {
        const ps = [...L.engine.P.values()].filter(p => p.sal > 0).sort((a, b) => b.sal - a.sal), cheap = ps.slice().reverse(), t = [];
        let used = 0;
        for (let i = 0; i < 6; i++) {
          const m = i ? 1 : 1.5, rest = q => cheap.filter(x => x !== q && !t.includes(x.name)).slice(0, 5 - i).reduce((a, x) => a + x.sal, 0);
          const p = ps.find(q => !t.includes(q.name) && used + q.sal * m + rest(q) <= CAP); if (!p) break; t.push(p.name); used += p.sal * m;
        }
        if (t.length === 6) { L.lab.cpt = t[0]; L.lab.flex = t.slice(1); L.render(); drawSdGrade(); }
        out.button.showdown = !!$('lbShowdown').querySelector('[data-lb-card="showdown"]');
        await measure('showdown');
      }
    } catch (e) { out.error = String(e && e.message || e); }
    try {
      const now = []; for (let i = 0; i < localStorage.length; i++) now.push(localStorage.key(i));
      for (const k of now) if (/^bbi_/.test(k) && !(k in keep)) localStorage.removeItem(k);
      for (const k of Object.keys(keep)) localStorage.setItem(k, keep[k]);
    } catch {}
    document.documentElement.dataset.cardSelftest = JSON.stringify(out);
    const show = Q.get('card') === 'classic' ? 'classic' : 'showdown';
    if (show !== tab) setTab(show);
    await openCard(show);
  };

  /* =================================================================
     BOOT
     ================================================================= */
  const boot = () => {
    bindTabs();
    bindCard();
    if (Q.get('selftest') === 'card') { cardSelfTest(); return; }
    setTab(tab);
    // Warm the other tab's scripts once the page is idle so switching is quick.
    const other = tab === 'classic' ? 'showdown' : 'classic';
    (window.requestIdleCallback || (f => setTimeout(f, 1500)))(() => { if (other === 'classic') loadSet('classic').catch(() => {}); });
  };
  BBI.lab = { get tab() { return tab; }, setTab, sdGrade, clGrade: () => clGrade(), C, clFill, clDraw, clCsv, nameSlug, svSave, optFill, optScore };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
