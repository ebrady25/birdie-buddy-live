/* =====================================================================
   BIRDIEBUDDY — SHOWDOWN PLAYBOOK
   Pure functions (bucket → scripts → allocation → recipes → contest fit)
   + the page renderer for showdown.html. No framework, no chart library;
   charts are inline SVG. Every number rendered comes from
   assets/data/showdown_playbook.json — nothing is invented here.
   ===================================================================== */

window.BBI = window.BBI || {};

(() => {
  'use strict';

  const DATA_PATH   = 'nfl/showdown/showdown_playbook.json';
  // Server-side gating: BUILT, INACTIVE. 'open' (the open preview) loads the combined file above and every step
  // renders for everyone. 'server' loads the public part statically and asks the vercel-app route
  // /api/nfl/showdown-pro for the Pro part (recipes, laws, contest fit, cut ladder, lessons); that route checks the
  // Supabase JWT + tier the way /api/rankings does, and a caller who isn't entitled gets the upgrade card instead.
  // Go-live steps: docs/GATING_GO_LIVE.md.
  const GATING_MODE = 'open';
  const PUBLIC_PATH = 'nfl/showdown/showdown_playbook_public.json';
  const PRO_ROUTE   = '/api/nfl/showdown-pro';
  const SLATES_PATH = 'nfl/showdown/showdown_slates.json';
  const LS_KEY      = 'bbi_showdown_inputs';
  const SMALL_N     = 15;
  // Motion helpers (showdown_fx.js); plain fallbacks keep the pure logic loadable in node.
  const FX = window.BBI.fx || { num: (k, v, d = 0, o = {}) => `${o.pre || ''}${(+v).toFixed(d)}${o.post || ''}`, snapshot: () => null, morph() {}, reveal() {}, confetti() {}, reduced: () => true, keepFocus: () => () => {}, rove() {} };
  // First-party analytics (track.js); a no-op when it isn't loaded, opted out or offline.
  const track = (e, p) => { try { if (window.BBI.track) window.BBI.track(e, p); } catch {} };

  /* =================================================================
     1. PURE LOGIC
     ================================================================= */

  // Representative number a pill sets in the numeric field (mid-bucket).
  const SPREAD_REP = { pk_3: 2.5, '3.5_6.5': 5.5, '7_9.5': 8, '10_plus': 10.5 };
  const TOTAL_REP  = { grind: 40, low: 43.5, mid: 48, high: 51.5, shootout: 55 };
  const ENV_LABEL  = { dome: 'Dome', outdoor_mild: 'Outdoor mild', cold_le32: 'Cold ≤32°', wind_10_14: 'Wind 10–14', wind_15_plus: 'Wind 15+' };
  const ENV_SHORT  = { dome: 'Dome', outdoor_mild: 'Outdoor', cold_le32: 'Cold', wind_10_14: 'Wind 10–14', wind_15_plus: 'Wind 15+' };
  const CONTEST_SHORT = { se_small: 'SE <5k', mid: '5k–25k', large: '25k+' };
  const ENTRY_PILLS = [
    { key: '1',       label: '1',    min: 1,  max: 1,    rep: 1 },
    { key: '2_4',     label: '2–4',  min: 2,  max: 4,    rep: 3 },
    { key: '5_10',    label: '5–10', min: 5,  max: 10,   rep: 5 },
    { key: '20_plus', label: '20+',  min: 20, max: 9999, rep: 20 }
  ];
  const LEANS = [
    { key: 'none',     label: 'None' },
    { key: 'blowout',  label: 'Blowout',  script: 'A', from: ['C', 'D'] },
    { key: 'shootout', label: 'Shootout', script: 'C', from: ['A', 'B'] },
    { key: 'grind',    label: 'Grind',    script: 'B', from: ['C', 'D'] }
  ];
  const LEAN_PTS = 10;
  // Slider scales. Entries use a stepped scale so 1–20 gets most of the track.
  const SPREAD_RANGE = [0, 17], TOTAL_RANGE = [34, 62];
  const ENTRY_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 20, 25, 30, 40, 50, 60, 75, 90, 100, 110, 120, 135, 150];
  const nearestStep = n => ENTRY_STEPS.reduce((b, v, i) => Math.abs(v - n) < Math.abs(ENTRY_STEPS[b] - n) ? i : b, 0);
  const svgI = d => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ENV_ICON = {
    dome: svgI('<path d="M3 18h18"/><path d="M5 18a7 7 0 0 1 14 0"/><path d="M12 11v7"/><path d="M8.5 12.5 10 18M15.5 12.5 14 18"/>'),
    outdoor_mild: svgI('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    cold_le32: svgI('<path d="M12 2v20M4.2 7l15.6 10M4.2 17 19.8 7"/><path d="m9 4 3 2 3-2M9 20l3-2 3 2"/>'),
    wind_10_14: svgI('<path d="M3 9h11a3 3 0 1 0-3-3"/><path d="M3 15h14a3 3 0 1 1-3 3"/>'),
    wind_15_plus: svgI('<path d="M2 7h12a3 3 0 1 0-3-3"/><path d="M2 12h17a3 3 0 1 0-3-3"/><path d="M2 17h12a3 3 0 1 1-3 3"/>')
  };

  const bucketSpread = s => { s = Math.abs(+s || 0); if (s <= 3) return 'pk_3'; if (s < 7) return '3.5_6.5'; if (s < 10) return '7_9.5'; return '10_plus'; };
  const bucketTotal  = t => { t = +t || 0; if (t <= 41) return 'grind'; if (t < 46) return 'low'; if (t < 50) return 'mid'; if (t < 54) return 'high'; return 'shootout'; };
  const bucketEntries = n => (ENTRY_PILLS.find(p => n >= p.min && n <= p.max) || {}).key || null;

  // winners_by_expected_script row keys
  const expectedSpreadRow = b => ({ pk_3: 'spread_le3', '3.5_6.5': 'spread_3.5_6.5' }[b] || 'spread_ge7');
  const expectedTotalRow = (b, total) => {
    if (b === 'grind') return 'total_le42';
    if (b === 'low') return 'total_42.5_47.5';
    if (b === 'mid') return (+total < 48) ? 'total_42.5_47.5' : 'total_48_51.5';
    if (b === 'high') return 'total_48_51.5';
    return 'total_ge52';
  };
  // captain_by_spread_x_total cell
  const cheatCell = (sb, total) => ({
    row: ({ pk_3: 'le3', '3.5_6.5': '3.5_6.5' }[sb] || 'ge7'),
    col: (+total < 46) ? 'total_le45.5' : 'total_ge46'
  });
  const envRow  = total => (+total <= 42) ? 'grind_le42' : (+total <= 48.5) ? 'avg_42.5_48.5' : 'shootout_ge49';
  const roofRow = env => ({ dome: 'dome', outdoor_mild: 'outdoor_mild', cold_le32: 'cold_le35', wind_15_plus: 'wind_ge15' }[env] || null);
  const isWind  = env => env === 'wind_10_14' || env === 'wind_15_plus';

  // Overlays come from total + environment ONLY. The lean never touches them.
  const overlaysFor = (data, total, env) => {
    const o = data.overlays;
    return {
      shootout: +total >= o.shootout.trigger.total_min,
      grind:    +total <= o.grind.trigger.total_max || isWind(env),
      dome:     env === 'dome',
      wind:     env === 'wind_15_plus'
    };
  };

  // A/B/C/D allocation in points (sum 100). Lean moves LEAN_PTS into its
  // script from the two scripts furthest from it, then renormalizes.
  const allocationFor = (data, spreadBucket, leanKey) => {
    const base = data.allocation_by_spread[spreadBucket];
    const pts = {}; for (const k of ['A', 'B', 'C', 'D']) pts[k] = (base[k] || 0) * 100;
    const lean = LEANS.find(l => l.key === leanKey);
    if (lean && lean.script) {
      let moved = 0;
      for (const src of lean.from) { const take = Math.min(pts[src], LEAN_PTS / lean.from.length); pts[src] -= take; moved += take; }
      pts[lean.script] += moved;
    }
    const sum = Object.values(pts).reduce((a, b) => a + b, 0) || 1;
    for (const k in pts) pts[k] = pts[k] * 100 / sum;
    return pts;
  };

  // Largest-remainder rounding: counts always sum to n.
  const largestRemainder = (shares, n) => {
    const keys = Object.keys(shares);
    const total = keys.reduce((a, k) => a + shares[k], 0) || 1;
    const exact = keys.map(k => ({ k, x: shares[k] * n / total }));
    const out = {}; let used = 0;
    exact.forEach(e => { out[e.k] = Math.floor(e.x); used += out[e.k]; });
    exact.map(e => ({ k: e.k, r: e.x - Math.floor(e.x) }))
         .sort((a, b) => b.r - a.r || keys.indexOf(a.k) - keys.indexOf(b.k))
         .slice(0, Math.max(0, n - used))
         .forEach(e => { out[e.k] += 1; });
    return out;
  };

  const SEATS = [
    { seat: 'Fav WR1', pos: 'WR', side: 'fav', tmpl: 'WR_FAV', why: 'he ate the passing game' },
    { seat: 'Fav RB',  pos: 'RB', side: 'fav', tmpl: 'RB_FAV', why: 'his team controlled the game' },
    { seat: 'Fav QB',  pos: 'QB', side: 'fav', tmpl: 'QB_FAV', why: 'the whole offense ran through him' },
    { seat: 'Fav TE1', pos: 'TE', side: 'fav', tmpl: 'TE_FAV', why: 'target monopoly / red-zone' },
    { seat: 'Dog WR1', pos: 'WR', side: 'dog', tmpl: 'WR_DOG', why: 'the only dog captain that survives a laugher' },
    { seat: 'Dog RB',  pos: 'RB', side: 'dog', tmpl: 'RB_DOG', why: 'the upset ran through him on the ground' },
    { seat: 'Dog QB (rushing only)', pos: 'QB', side: 'dog', tmpl: 'QB_DOG', why: 'only if he runs — the pocket version is a graveyard' }
  ];
  // Seat weight = position share × side share from the active cheat-sheet cell.
  const shortlistFor = cell => SEATS.map(s => {
    const posShare = cell[s.pos] || 0;
    const sideShare = s.side === 'fav' ? cell.fav : 100 - cell.fav;
    return { ...s, posShare, sideShare, weight: posShare * sideShare / 100 };
  }).sort((a, b) => b.weight - a.weight || SEATS.indexOf(a) - SEATS.indexOf(b)).slice(0, 5);

  const SCRIPT_META = {
    A: { seat: 'Fav WR1', tmpl: 'WR_FAV', because: 'the favorite blows it out', bring: "the dog's single best pass-catcher — never the dog QB" },
    B: { seat: 'Fav RB',  tmpl: 'RB_FAV', because: 'the favorite controls a game that stays competitive', bring: "the opponent's RB or TE, and keep both-QB low" },
    C: { seat: 'Either WR1', tmpl: 'WR_FAV', because: 'it stays a coin flip to the end', bring: 'the other QB — both QBs (43%) and both WR1s is the shape' },
    D: { seat: 'Dog WR1', tmpl: 'WR_DOG', because: 'the dog wins outright', bring: 'the fav TE (57% with a dog-WR captain) or the fav QB (73% with a dog-RB captain)' }
  };

  // How often each script actually happens at this spread (base_rates.by_spread).
  const scriptOdds = b => ({ A: b.blowout14, B: b.fav_wins - b.blowout14, C: b.within3, D: b.dog_wins });
  // Flex construction text → chips: first clause of the archetype's flex string.
  const flexChips = flex => { const first = flex.split(';')[0].replace(/^[^:]*template:\s*/i, ''); return first.split(/\s*\+\s*|,\s*/).map(x => x.trim()).filter(Boolean); };
  const flexNotes = flex => flex.split(';').slice(1).map(x => x.trim()).filter(x => x && !/^bring/i.test(x));  // bring-back has its own row

  // Role → player name from the selected preset (v0.2 pipeline fills these).
  const nameFor = (preset, side, role) => preset && preset.players && preset.players[side] && preset.players[side][role] || null;
  const seatName = (preset, seat) => { const m = /^(Fav|Dog) (WR1|RB|QB|TE1)/.exec(seat); if (!m) return null; return nameFor(preset, m[1].toLowerCase(), m[2]); };
  // "fav WR1" / "dog QB" tokens inside codex text → "Adams (fav WR1)" when the name is known.
  const withNames = (preset, text) => !preset ? text : String(text).replace(/\b(fav|dog|own|opp)\s+(WR1|WR|RB|QB|TE1|TE|K|DST)\b/gi, (m0, side, role) => {
    const sd = side.toLowerCase(); if (sd !== 'fav' && sd !== 'dog') return m0;
    const r = role.toUpperCase() === 'WR' ? 'WR1' : role.toUpperCase() === 'TE' ? 'TE1' : role.toUpperCase();
    const n = nameFor(preset, sd, r); return n ? `${n} (${m0})` : m0; });

  const pinnedLawsFor = (spread, total) => {
    const set = new Set([1, 10]);
    if (+spread >= 7) { set.add(4); set.add(8); }
    if (+total >= 50) { set.add(9); set.add(7); }
    if (+total <= 41) { set.add(7); set.add(8); }
    return set;
  };

  const dupesFor = (data, contestKey) => {
    const ct = (data.inputs.contest_types || []).find(c => c.key === contestKey);
    return ct ? ct.dupe_cap : null;
  };

  // Portfolio dials with overlays applied (grind is the more conservative
  // physical constraint, so when shootout + grind both fire it wins).
  const dialsFor = (data, ov, spread, contestKey) => {
    const p = data.portfolio, o = data.overlays;
    const mode = ov.grind ? 'grind' : ov.shootout ? 'shootout' : 'default';
    const dstMode = (ov.grind || ov.wind) ? 'grind' : ov.shootout ? 'shootout' : 'default';
    let k = p.k_share[mode].slice();
    const notes = [];
    if (ov.dome) { k = k.map(x => Math.min(x + o.dome.k_share_bump, p.share_ceilings.k)); notes.push(`K +${pct(o.dome.k_share_bump)} (dome)`); }
    const bothQb = ov.grind ? o.grind.both_qbs_share_max : ov.shootout ? o.shootout.both_qbs_share_max : p.both_qbs_share_max;
    const rows = [
      { k: 'K share', v: range(k), bar: k, adj: mode !== 'default' || ov.dome, note: `${mode} · ceiling ${pct(p.share_ceilings.k)}` + (ov.dome ? ' · dome bump' : '') },
      { k: 'DST share', v: range(p.dst_share[dstMode]), bar: p.dst_share[dstMode], adj: dstMode !== 'default', note: `${dstMode}` + (ov.wind ? ' (wind ≥15 → grind)' : '') + ` · ceiling ${pct(p.share_ceilings.dst)}` },
      { k: 'Both-QB max', v: pct(bothQb), bar: [0, bothQb], adj: bothQb !== p.both_qbs_share_max, note: ov.grind ? 'grind overlay' : ov.shootout ? 'shootout overlay' : 'portfolio default' },
      { k: '5-1 fav minimum', v: +spread >= p.big_spread ? `${p.five_one_fav_min_count_big_spread} lineups` : +spread >= p.five_one_fav_min_spread ? `${p.five_one_fav_min_count} lineup` : '—',
        adj: +spread >= p.five_one_fav_min_spread, note: +spread >= p.five_one_fav_min_spread ? `spread ≥ ${+spread >= p.big_spread ? p.big_spread : p.five_one_fav_min_spread}` : `only when spread ≥ ${p.five_one_fav_min_spread}` },
      { k: 'Fav captain share min', v: +spread >= p.big_spread ? pct(p.fav_captain_share_min_big_spread) : '—', bar: +spread >= p.big_spread ? [p.fav_captain_share_min_big_spread, 1] : null, adj: +spread >= p.big_spread, note: `spread ≥ ${p.big_spread}` },
      { k: 'Per-captain share cap', v: `${pct(p.max_per_captain_share)} · max ${p.max_per_captain_abs}`, note: 'share of batch · absolute' },
      { k: 'Captain position cap', v: Object.entries(p.captain_position_share_max).map(([a, b]) => `${a} ${pct(b)}`).join(' · '), note: 'share of batch at captain', adj: false },
      { k: 'Max overlap between lineups', v: `${p.max_overlap_players} players`, note: 'any two lineups' },
      { k: 'Punt share max', v: pct(p.sub_1k_share_max), bar: [0, p.sub_1k_share_max], note: 'lineups with a sub-$1k player' },
      { k: 'Dupes max', v: `${dupesFor(data, contestKey)}`, note: `for ${CONTEST_SHORT[contestKey] || contestKey}` }
    ];
    return { rows, notes, mode, dstMode, bothQb, k };
  };

  const HARD_LABELS = {
    max_kickers: v => `Max ${v} kicker`,
    max_k_plus_dst: v => `K + DST combined ≤ ${v}`,
    max_dst: v => v >= 2 ? 'Two DSTs only as a grind-script dart (see below)' : `Max ${v} DST`,
    two_dst_requires: v => `Two DSTs: only when total ≤ ${v.total_max}${v.or_grind_overlay ? ' or the grind overlay is on (total ≤ 41 / wind ≥ 10)' : ''}${v.allow_k ? '' : ', never with a kicker'} · max 1 per batch — 5 of 120 winners, mostly games that finished 17–21`,
    dst_max_opposing_skill: v => `DST with at most ${v} opposing skill players`,
    no_dog_pocket_qb_captain_spread_min: v => `No dog pocket-QB captain at +${v} or more`,
    captain_positions_never: v => `Never ${[].concat(v).join('/')} at captain`,
    captain_dst_max_per_batch: v => `At most ${v} DST captain per batch`,
    min_salary_used: v => `Salary used ≥ $${(+v).toLocaleString()}`,
    max_sub_1k_players: v => `At most ${v} player under $1k`,
    max_sub3pct_owned_players: v => `At most ${v} player under 3% owned`,
    wr_cpt_max_other_own_catchers: v => `WR captain: at most ${v} other own pass-catcher`,
    rb_cpt_max_other_own_rb: v => `RB captain: ${v === 0 ? 'no' : 'at most ' + v} other own RB`,
    rb_cpt_max_own_skill_wide: v => `RB captain: at most ${v} own skill players around him`,
    pocket_qb_cpt_min_own_catchers: v => `Pocket-QB captain: at least ${v} own pass-catchers`,
    rushing_qb_cpt_min_own_catchers: v => `Rushing-QB captain: at least ${v} own pass-catcher`,
    te_cpt_require_own_qb: v => v ? 'TE captain: own QB in the lineup' : 'TE captain: own QB optional',
    te_cpt_max_own_k: v => `TE captain: ${v === 0 ? 'no' : 'at most ' + v} own kicker`,
    te_cpt_max_other_own_te: v => `TE captain: ${v === 0 ? 'no' : 'at most ' + v} other own TE`,
    captain_min_cpt_optimal_pct: v => `Captain is ≥ ${v}% CPT-optimal in the sim`,
    min_players_from_captain_team: v => `At least ${v} players from the captain's team`,
    max_salary: v => `Salary ≤ $${(+v).toLocaleString()}`
  };
  const humanize = k => k.replace(/^_/, '').replace(/_/g, ' ').replace(/\bqb\b/g, 'QB').replace(/\bwr\b/g, 'WR').replace(/\brb\b/g, 'RB').replace(/\bte\b/g, 'TE').replace(/\bdst\b/g, 'DST').replace(/\bcpt\b/g, 'CPT').replace(/\bk\b/g, 'K').replace(/\bopp\b/g, 'opp').replace(/\bown\b/g, 'own');
  const chipLabel = k => ({ own_QB: 'own QB', own_RB: 'own RB', own_WR: 'own WR', own_TE: 'own TE', own_K: 'own K', own_DST: 'own DST',
    opp_QB: 'opp QB', opp_RB: 'opp RB', opp_WR: 'opp WR', opp_TE: 'opp TE', opp_K: 'opp K', opp_DST: 'opp DST',
    own_second_catcher: '2nd own catcher', own_second_rb: '2nd own RB', own_second_te: '2nd own TE', both_qbs: 'both QBs' }[k] || humanize(k));

  /* ---------- URL state (shareable links) ----------
     ?slate=<id>&s=<spread>&t=<total>&env=<env>&c=<contest>&n=<entries>&lu=<cpt-flex-flex-…>
     lu tokens are DK ids (captain's CPT id, then FLEX ids) when every player in
     the lineup has them, else name slugs ("amon_ra_st_brown"); '' = empty captain. */
  const URL_ORDER = [['slate', 'slate'], ['s', 'spread'], ['t', 'total'], ['env', 'env'], ['c', 'contest'], ['n', 'entries'], ['lu', 'lu']];
  const nameSlug = n => String(n ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const halfStep = (v, lo, hi) => { v = parseFloat(v); return isNaN(v) ? null : Math.max(lo, Math.min(hi, Math.round(v * 2) / 2)); };
  // Accepts "?a=1&b=2", "a=1", or a whole href; keeps only well-formed values.
  const urlParse = search => {
    const q = new URLSearchParams(String(search || '').replace(/^[^?]*\?/, '').replace(/#.*$/, ''));
    const out = {}, word = /^[a-z0-9_]{1,40}$/i;
    const g = k => { const v = q.get(k); return v == null ? null : v.trim(); };
    if (g('slate') && word.test(g('slate'))) out.slate = g('slate');
    if (g('s')) { const v = halfStep(Math.abs(parseFloat(g('s'))), 0, 30); if (v != null) out.spread = v; }
    if (g('t')) { const v = halfStep(g('t'), 20, 80); if (v != null) out.total = v; }
    if (g('env') && word.test(g('env'))) out.env = g('env');
    if (g('c') && word.test(g('c'))) out.contest = g('c');
    if (g('n')) { const v = parseInt(g('n'), 10); if (v >= 1) out.entries = Math.min(150, v); }
    if (g('lu') != null) { const t = g('lu').split('-').slice(0, 6); if (t.some(Boolean) && t.every(x => /^[a-z0-9_]{0,60}$/i.test(x))) out.lu = t; }
    return out;
  };
  const urlSerialize = o => URL_ORDER.map(([k, f]) => {
    let v = o[f]; if (v == null || v === '' || (Array.isArray(v) && !v.some(Boolean))) return null;
    if (f === 'lu') v = v.join('-');
    return `${k}=${encodeURIComponent(String(v))}`;
  }).filter(Boolean).join('&');
  // L = {cpt, flex:[names]}; ids = Map name → [flexId, cptId] (engine players().ids).
  const lineupTokens = (L, ids) => {
    const flex = (L.flex || []).filter(Boolean), all = [L.cpt, ...flex].filter(Boolean);
    if (!all.length) return null;
    const idOk = ids && ids.size && all.every(n => ids.has(n) && ids.get(n)[0] && ids.get(n)[1]);
    if (idOk) return [L.cpt ? ids.get(L.cpt)[1] : '', ...flex.map(n => ids.get(n)[0])];
    return [L.cpt ? nameSlug(L.cpt) : '', ...flex.map(nameSlug)];
  };
  // tokens → {cpt, flex, bad:[unmatched tokens]}; ambiguous slugs never match.
  const lineupFromTokens = (tokens, names, ids) => {
    const byId = new Map(), bySlug = new Map();
    if (ids) for (const [n, pair] of ids) pair.forEach(id => { if (id) byId.set(String(id), n); });
    for (const n of names) { const s = nameSlug(n); bySlug.set(s, bySlug.has(s) ? null : n); }
    const bad = [], seen = new Set();
    const hit = t => { if (!t) return null; const n = (/^\d+$/.test(t) && byId.get(t)) || bySlug.get(t.toLowerCase()) || null; if (!n || seen.has(n)) { bad.push(t); return null; } seen.add(n); return n; };
    const cpt = hit(tokens[0]);
    return { cpt, flex: tokens.slice(1).map(hit).filter(Boolean), bad };
  };

  /* ---------- formatting ---------- */
  const pct   = x => `${Math.round(x * 100)}%`;
  const range = a => `${Math.round(a[0] * 100)}–${Math.round(a[1] * 100)}%`;
  const num   = x => (Math.round(x * 10) / 10).toString();
  const esc   = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nTag  = n => `<span class="n${n < SMALL_N ? ' small' : ''}">n = ${n}${n < SMALL_N ? ' · small sample' : ''}</span>`;
  const spreadLabel = (s, fav) => `${fav || 'Fav'} −${num(Math.abs(+s))}`;

  /* =================================================================
     1b. RULES, HISTORY FIRST (v0.4.1) — every rule comes from the 120
     historical winners; the 2026 field archive only *checks* it.
     rule_verdicts.rules[i] = { hist:{rate,n,basis}, check, slates_n,
     slates_with, slates_against, pooled_lift, lift/field/top1[] … }.
     `check` is neutral: agrees / aligned / split / mixed / not_enough /
     watch. Nothing on the page ever says a historical rule is overturned;
     a `watch` item is re-examined in the winner data as slates accrue.
     Effective n for the 2026 check = primetime SLATES, never lineups.
     ================================================================= */
  const CHECK = {
    agrees:     { icon: '✓', word: 'agrees',                cls: 'ok' },
    aligned:    { icon: '✓', word: 'aligned',               cls: 'ok' },
    split:      { icon: '↔', word: 'split by script',       cls: 'unk' },
    mixed:      { icon: '–', word: 'mixed',                 cls: 'unk' },
    not_enough: { icon: '…', word: 'not enough slates yet', cls: 'unk' },
    watch:      { icon: '!', word: 'watch list',            cls: 'warn' },
    untested:   { icon: '–', word: 'no 2026 test',          cls: 'unk' }
  };
  const VERDICT = CHECK;   // older name, kept for the Lab / review modules
  // Law → the rule ids that check it. Laws 1, 2, 6 and 10 have no field check yet.
  const LAW_RULES = { 3: ['cpt_WR', 'cpt_RB', 'cpt_QB'], 4: ['cpt_fav'], 5: ['cpt_QB_DOG'], 7: ['K', 'two_K', 'cpt_K'], 8: ['five_one_fav', 'four_two', 'three_three'], 9: ['both_qb'] };
  const rvIndex = new WeakMap();
  const ruleById = (dt, id) => {
    const rs = dt && dt.rule_verdicts && dt.rule_verdicts.rules; if (!rs) return null;
    let m = rvIndex.get(rs); if (!m) { m = new Map(rs.map(r => [r.id, r])); rvIndex.set(rs, m); }
    return m.get(id) || null;
  };
  // Captain-template chip → its rule id ("QB_FAV|+own_TE", "QB_FAV|-own_K", "QB_FAV|shape").
  const tmplRuleId = (tmpl, kind, item) => kind === 'shape' ? `${tmpl}|shape` : `${tmpl}|${kind === 'inc' ? '+' : '-'}${item}`;
  const checkOf = r => r ? (CHECK[r.check] ? r.check : 'untested') : 'untested';
  // A law's 2026 check rolls its rules up without ever overriding them: any watch → watch; all agree/aligned → agrees;
  // any split → split; all not_enough → not_enough; else mixed. No rules → untested.
  const lawVerdict = (dt, n) => {
    const rules = (LAW_RULES[n] || []).map(id => ruleById(dt, id)).filter(Boolean);
    const counts = {}; Object.keys(CHECK).forEach(k => { counts[k] = rules.filter(r => checkOf(r) === k).length; });
    const all = k => rules.every(r => k.includes(checkOf(r)));
    const verdict = !rules.length ? 'untested' : counts.watch ? 'watch' : all(['agrees', 'aligned']) ? 'agrees' : counts.split ? 'split' : all(['not_enough']) ? 'not_enough' : 'mixed';
    return { verdict, rules, counts };
  };
  const sgn = x => x == null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(1)}`;
  const pc = x => x == null ? '—' : `${Number.isInteger(+x) ? x : (+x).toFixed(1)}%`;
  const rvSlates = dt => (dt.rule_verdicts && dt.rule_verdicts.slates) || [];
  const slateLabels = dt => rvSlates(dt).map(s => s.label.replace(/\s+/g, ''));
  const minSlates = dt => ((dt.rule_verdicts || {}).thresholds || {}).min_slates || 4;
  // Historical basis: always first.
  const histText = (dt, r) => {
    if (!r || !r.hist || r.hist.rate == null) return 'History: the 120-winner codex';
    // approved copy: 50 of 120 winners (41.7%); 2025 = 49% of all 49 winners, 50% of the 46 that join to lines
    if (r.id === 'K') return `K in about half of winning lineups (41% of ${r.hist.n_all}; 49–50% in 2025) — hold 40–50% of the batch`;
    return `History: ${pc(r.hist.rate)} of ${r.hist.basis}`;
  };
  // The neutral 2026 check (primetime tier).
  const checkText = (dt, r) => {
    const k = checkOf(r), n = r ? r.slates_n || 0 : 0;
    if (!r) return '2026 check: no field test for this yet';
    if (r.type === 'portfolio_share') {
      if (k === 'not_enough' || k === 'untested') return '2026 check: not enough primetime slates yet';
      const sw = r.top1_min != null && r.top1_max != null && r.top1_max - r.top1_min >= 40;
      if (k === 'aligned') return `2026 check: aligned${sw ? `; the top 1% swings ${Math.round(r.top1_min)}–${Math.round(r.top1_max)}% by script` : ''} (top 1% ${pc(r.top1_2026)} over ${n} primetime slates)`;
      return `2026 check: top 1% ${pc(r.top1_2026)} over ${n} slates — outside the band, watch list`;
    }
    if (k === 'agrees') return `2026 check: agrees ${r.slates_with}/${n} primetime slates`;
    if (k === 'watch') return `2026 check: disagrees ${r.slates_against}/${n} — watch list`;
    if (k === 'split') return `2026 check: split by script (${r.slates_with} with, ${r.slates_against} against)`;
    if (k === 'mixed') return `2026 check: mixed (${r.slates_with} with, ${r.slates_against} against, ${n} slates)`;
    return `2026 check: not enough slates yet (${n} of ${minSlates(dt)} needed)`;
  };
  // Tooltip: history, then the check, per-slate lifts, excluded slates, the Sunday tier.
  const verdictTip = (dt, r) => {
    if (!r) return 'History: the 120-winner codex. 2026 check: no field test for this yet.';
    const lbl = slateLabels(dt), sl = rvSlates(dt);
    const per = (r.lift || []).map((x, i) => x == null ? null : `${lbl[i]} ${sgn(x)}`).filter(Boolean).join(', ');
    const ex = sl.filter(s => s.excluded).map(s => `${s.label} excluded (${s.excluded})`).join('; ');
    const sun = r.sunday && r.sunday.slates_n ? ` Sunday slates (supporting, not pooled): ${CHECK[r.sunday.check] ? CHECK[r.sunday.check].word : r.sunday.check}, ${r.sunday.slates_n} slates.` : '';
    return `${r.label}. ${histText(dt, r)}. ${checkText(dt, r)}.${r.pooled_lift != null && r.type !== 'portfolio_share' ? ` Top 1% − field, pooled ${sgn(r.pooled_lift)} pts.` : ''}${per ? ` Per slate: ${per}.` : ''}${ex ? ` ${ex}.` : ''}${sun} Rules come from the historical winners; 2026 only annotates.`;
  };
  // The badge's fraction: slates that went the check's way / slates checked.
  const vFrac = (dt, r) => {
    if (!r || !r.slates_n || r.type === 'portfolio_share') return '';
    const k = checkOf(r);
    return k === 'watch' ? `${r.slates_against}/${r.slates_n} against` : k === 'agrees' ? `${r.slates_with}/${r.slates_n} agree` : `${r.slates_n} slates`;
  };
  // 2026-check badge. mini = glyph only (for chips); the tooltip always leads with the history.
  const vBadge = (dt, r, opts = {}) => {
    const k = checkOf(r), v = CHECK[k], tip = verdictTip(dt, r), fr = vFrac(dt, r);
    return `<span class="sd-vb ${v.cls}${opts.mini ? ' mini' : ''}" title="${esc(tip)}" aria-label="${esc(tip)}" data-check="${k}">${v.icon}${opts.mini ? '' : ` 2026: ${v.word}${fr ? ` <small>${fr}</small>` : ''}`}</span>`;
  };
  // One small, neutral 2026-check line per law (under the law, never beside it as a verdict).
  const lawBadge = (dt, lv) => {
    if (lv.rules.length <= 1) return lv.rules[0] ? vBadge(dt, lv.rules[0]) : vBadge(dt, null);
    const v = CHECK[lv.verdict], tip = lv.rules.map(r => verdictTip(dt, r)).join('\n');
    const parts = Object.keys(CHECK).filter(k => lv.counts[k]).map(k => `${lv.counts[k]} ${CHECK[k].word}`).join(' · ');
    return `<span class="sd-vb ${v.cls}" title="${esc(tip)}" aria-label="${esc(tip)}" data-check="${lv.verdict}">${v.icon} 2026: <small>${parts}</small></span>`;
  };
  const vIcon = k => { const v = CHECK[k] || CHECK[{ confirmed: 'agrees', no_edge_yet: 'mixed' }[k]] || CHECK.untested; return `<span class="sd-vb ${v.cls} mini" aria-hidden="true">${v.icon}</span>`; };
  const checkLegend = () => ['agrees', 'aligned', 'split', 'not_enough', 'watch'].map(k => `${vIcon(k)} ${CHECK[k].word}`).join(' · ');

  // Winners (120, 2018–25) · top 1% · field (2026 contest archive) for one expected-script row.
  // tier 'sunday' reads the supporting tier (field_tiers.sunday); the default is primetime.
  const cohortRows = (dt, key, tier = 'primetime') => {
    const T = tier === 'sunday' ? (((dt.field_tiers || {}).sunday) || {}) : { top1: dt.top1pct_by_expected_script, field: dt.field_by_expected_script };
    return { winners: (dt.winners_by_expected_script || {})[key] || null, top1: (T.top1 || {})[key] || null, field: (T.field || {})[key] || null };
  };

  // Cut lines. Field-size buckets match the contest pills (SE <5k, 5k–25k, 25k+).
  const CUT_TIERS = [['winner_score', 'Winner'], ['cut_top0_1', 'Top 0.1%'], ['cut_top1', 'Top 1%'], ['cut_top5', 'Top 5%'], ['cut_top20', 'Top 20%'], ['min_cash_score', 'Min cash']];
  const fieldBucket = size => +size < 5000 ? 'se_small' : +size < 25000 ? 'mid' : 'large';
  const median = a => { const s = a.filter(v => v != null && isFinite(v)).sort((x, y) => x - y), m = s.length >> 1; return !s.length ? null : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const cutLadder = (cuts, contestKey) => {
    const rows = (cuts || []).filter(c => fieldBucket(c.field_size) === contestKey);
    const slates = [...new Set(rows.map(c => c.slate))];
    const tiers = CUT_TIERS.map(([key, label]) => {
      const withV = rows.filter(c => c[key] != null);
      const vals = withV.map(c => c[key]);
      return { key, label, n: vals.length,
        median: median(vals), min: vals.length ? Math.min(...vals) : null, max: vals.length ? Math.max(...vals) : null,
        bySlate: slates.map(s => median(withV.filter(c => c.slate === s).map(c => c[key]))),
        ratio: median(withV.filter(c => c.winner_score).map(c => c[key] / c.winner_score * 100)) };
    });
    const sizes = rows.map(c => c.field_size);
    return { key: contestKey, contests: rows.length, slates, tiers,
      field: sizes.length ? [Math.min(...sizes), Math.max(...sizes)] : null,
      cashPct: median(rows.map(c => c.min_cash_pct)) };
  };
  // DK showdown points: captain scores 1.5×.
  const lineupProj = (cptProj, flexProj) => Math.round((1.5 * (+cptProj || 0) + flexProj.reduce((a, v) => a + (+v || 0), 0)) * 100) / 100;
  // Where a projected score sits against each cut tier of a ladder.
  const projVsCuts = (proj, ladder) => ladder.tiers.filter(t => t.key !== 'winner_score' && t.median != null)
    .map(t => ({ key: t.key, label: t.label, median: t.median, min: t.min, max: t.max, gap: Math.round((proj - t.median) * 10) / 10, clearsAll: proj >= t.max, clearsNone: proj < t.min }));

  /* =================================================================
     2. SVG CHARTS (inline, no library)
     ================================================================= */
  const W = 600;
  // Stacked bar: segments [{label, value, cls}], optional marker {label, value, at (fraction 0..1 of bar where the marker centers)}
  const stackedBar = (segments, opts = {}) => {
    const total = segments.reduce((a, s) => a + s.value, 0) || 1;
    const h = 24, y = 2, gap = 2, H = opts.marker ? 62 : 34;
    let x = 0, out = '';
    segments.forEach((s, i) => {
      const w = Math.max(0, s.value / total * W - (i < segments.length - 1 ? gap : 0));
      const r = 4;
      const left = i === 0, right = i === segments.length - 1;
      const path = roundedRect(x, y, w, h, left ? r : 0, right ? r : 0);
      out += `<path d="${path}" class="${s.cls}"/>`;
      if (w > 64) out += `<text x="${x + 8}" y="${y + h / 2 + 3.5}" class="${s.dark ? '' : 'on-fill'}">${esc(s.label)} ${Math.round(s.value)}%</text>`;
      else if (w > 26) out += `<text x="${x + w / 2}" y="${y + h / 2 + 3.5}" text-anchor="middle" class="${s.dark ? '' : 'on-fill'}">${Math.round(s.value)}</text>`;
      x += w + gap;
    });
    if (opts.marker) {
      const m = opts.marker, mw = m.value / total * W, cx = m.at * W;
      const x1 = Math.max(0, cx - mw / 2), x2 = Math.min(W, cx + mw / 2), my = y + h + 10;
      out += `<line x1="${x1}" y1="${my}" x2="${x2}" y2="${my}" class="sd-seg-marker"/>
              <line x1="${x1}" y1="${my - 4}" x2="${x1}" y2="${my + 4}" class="sd-seg-marker"/>
              <line x1="${x2}" y1="${my - 4}" x2="${x2}" y2="${my + 4}" class="sd-seg-marker"/>
              <text x="${(x1 + x2) / 2}" y="${my + 16}" text-anchor="middle" class="val">${esc(m.label)} ${Math.round(m.value)}%</text>`;
    }
    return `<svg class="sd-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || segments.map(s => `${s.label} ${Math.round(s.value)}%`).join(', '))}">${out}</svg>`;
  };
  const roundedRect = (x, y, w, h, rl, rr) => {
    if (w <= 0) return '';
    rl = Math.min(rl, w / 2, h / 2); rr = Math.min(rr, w / 2, h / 2);
    return `M${x + rl},${y} H${x + w - rr} ${rr ? `Q${x + w},${y} ${x + w},${y + rr}` : ''} V${y + h - rr} ${rr ? `Q${x + w},${y + h} ${x + w - rr},${y + h}` : ''} H${x + rl} ${rl ? `Q${x},${y + h} ${x},${y + h - rl}` : ''} V${y + rl} ${rl ? `Q${x},${y} ${x + rl},${y}` : ''} Z`;
  };
  // Donut: parts [{label, value, cls}] → 4-segment ring with 2px gaps.
  const donut = (parts, aria) => {
    const R = 50, r = 36, C = 60, total = parts.reduce((a, p) => a + p.value, 0) || 1;
    const gapDeg = 3;
    let a0 = -90, out = '';
    parts.forEach(p => {
      const sweep = p.value / total * 360;
      if (sweep <= 0) return;
      const s = a0 + gapDeg / 2, e = a0 + sweep - gapDeg / 2;
      if (e > s) out += `<path d="${arc(C, C, R, r, s, e)}" class="${p.cls}"/>`;
      a0 += sweep;
    });
    return `<svg viewBox="0 0 120 120" class="sd-chart" role="img" aria-label="${esc(aria)}">${out}</svg>`;
  };
  const polar = (cx, cy, rad, deg) => [cx + rad * Math.cos(deg * Math.PI / 180), cy + rad * Math.sin(deg * Math.PI / 180)];
  const arc = (cx, cy, R, r, s, e) => {
    const large = (e - s) > 180 ? 1 : 0;
    const [x1, y1] = polar(cx, cy, R, s), [x2, y2] = polar(cx, cy, R, e), [x3, y3] = polar(cx, cy, r, e), [x4, y4] = polar(cx, cy, r, s);
    return `M${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} L${x3.toFixed(2)},${y3.toFixed(2)} A${r},${r} 0 ${large} 0 ${x4.toFixed(2)},${y4.toFixed(2)} Z`;
  };
  // Small horizontal rate bar (HTML, components.css .bar). `key` makes it morph between renders.
  const rate = (label, v, dim, key) => `<div class="sd-rate"><span>${esc(label)}</span><span class="bar"><span class="bar-fill${dim ? ' dim' : ''}"${key ? ` data-m="${key}"` : ''} style="width:${Math.max(0, Math.min(100, v))}%"></span></span><span class="v">${key ? FX.num(key + '.v', Math.round(v), 0, { post: '%' }) : Math.round(v) + '%'}</span></div>`;

  // HTML stacked bar (morphs between renders; replaces the SVG stackedBar on
  // live panels). Segments [{k,label,value,cls,dark}], optional marker
  // {label,value,at} drawn as a dashed bracket under the bar.
  const hbar = (key, segments, opts = {}) => {
    const total = segments.reduce((a, s) => a + s.value, 0) || 1;
    const segs = segments.map((s, i) => {
      const w = s.value / total * 100;
      const lab = w >= 17 ? `${esc(s.label)} <b>${Math.round(s.value)}%</b>` : w >= 6 ? `<b>${Math.round(s.value)}</b>` : '';
      return `<div class="sd-hseg ${s.cls}${s.dark ? ' dark' : ''}" data-m="${key}.${s.k || i}" style="width:${w.toFixed(3)}%" title="${esc(s.label)} ${Math.round(s.value)}%"><span>${lab}</span></div>`;
    }).join('');
    let mark = '';
    if (opts.marker) {
      const m = opts.marker, mw = m.value / total * 100, cx = m.at * 100, x1 = Math.max(0, cx - mw / 2), w = Math.min(100, cx + mw / 2) - x1;
      mark = `<div class="sd-hmark" data-m="${key}.mark" style="left:${x1.toFixed(3)}%;width:${w.toFixed(3)}%"><span>${esc(m.label)} ${Math.round(m.value)}%</span></div>`;
    }
    return `<div class="sd-hbar-wrap${mark ? ' has-mark' : ''}" role="img" aria-label="${esc(opts.aria || segments.map(s => `${s.label} ${Math.round(s.value)}%`).join(', '))}"><div class="sd-hbar${opts.tall ? ' tall' : ''}">${segs}</div>${mark}</div>`;
  };
  // Ring (donut) of stroked circles — dash lengths morph between renders.
  const ring = (key, parts, aria) => {
    const R = 46, C = 2 * Math.PI * R, total = parts.reduce((a, p) => a + p.value, 0) || 1;
    let acc = 0;
    const segs = parts.map((p, i) => {
      const len = p.value / total * C, gap = len > 4 ? 3 : 0, dash = Math.max(0, len - gap);
      const s = `<circle class="sd-ring-seg ${p.cls}" data-m="${key}.${i}" cx="60" cy="60" r="${R}" style="stroke-dasharray:${dash.toFixed(2)} ${C.toFixed(2)};stroke-dashoffset:${(-acc).toFixed(2)}"/>`;
      acc += len; return s;
    }).join('');
    return `<svg viewBox="0 0 120 120" class="sd-chart sd-ring" role="img" aria-label="${esc(aria)}"><g transform="rotate(-90 60 60)"><circle class="sd-ring-track" cx="60" cy="60" r="${R}"/>${segs}</g></svg>`;
  };

  /* =================================================================
     3. PAGE
     ================================================================= */
  const SEG = ['sd-seg-1', 'sd-seg-2', 'sd-seg-3', 'sd-seg-4'];
  const POS = ['WR', 'RB', 'QB', 'TE'];

  let data = null, slates = [], urlIn = {};   // urlIn: what the page was opened with (urlParse)
  /* ---------- gating (see GATING_MODE) ---------- */
  // ?gating=open|server previews either mode anywhere but birdiebuddy.io (the route still decides entitlement).
  const gatingMode = (loc = window.location) => {
    const q = /[?&]gating=(open|server)\b/.exec((loc && loc.search) || '');
    return q && !/(^|\.)birdiebuddy\.io$/i.test((loc && loc.hostname) || '') ? q[1] : GATING_MODE;
  };
  // Public part + Pro part → the combined shape the renderers read. Pro top-level keys replace the public slices
  // (archetypes, ten_laws) and add the Pro-only ones; `_split` is bookkeeping. mergePro(pub, null) = public only.
  const mergePro = (pub, pro) => {
    const out = {};
    for (const k of Object.keys(pub || {})) if (k !== '_split') out[k] = pub[k];
    for (const k of Object.keys(pro || {})) if (k !== '_split') out[k] = pro[k];
    return out;
  };
  // The route's answer → the Pro part, or null (gated, malformed, or not the Pro file).
  const proFrom = env => env && env.gated === false && env.data && env.data._split && env.data._split.part === 'pro' ? env.data : null;
  let gating = GATING_MODE, pub = null, proState = 'open';   // proState: open (Pro data in `data`) | pending | locked | error
  const hasPro = () => proState === 'open';
  const state = { spread: 7.5, total: 48.5, env: 'dome', contest: 'se_small', entries: 1, lean: 'none', preset: null, view: 'expected', realized: null, cutKey: null, attack: false };

  /* ---------- primetime-first slates (+ opt-in Sunday attack mode) ----------
     The codex, playbook and engine are primetime-focused (TNF / SNF / MNF / Wed / Sat /
     holiday standalone). Sunday single-game slates stay hidden unless the reader turns on
     "Attack a Sunday game", and within it only an extreme script signal earns an attack badge. */
  const slateTier = sl => {
    if (!sl) return 'primetime';
    if (sl.tier) return sl.tier;
    if (/TNF|SNF|MNF|Thu|Mon|Wed|Sat/.test(sl.week || '')) return 'primetime';
    if (sl.kickoff) { const d = new Date(sl.kickoff); if (!isNaN(d)) return d.getDay() !== 0 || d.getHours() >= 19 ? 'primetime' : 'sunday'; }
    return 'primetime';
  };
  // Attack signal from the page's own base rates (never invented numbers): a 10+ favorite (blowout-prone),
  // a grind total, or 15+ mph wind.
  const attackFor = sl => {
    if (!sl || !data) return { on: false, reasons: [] };
    const R = [], br = data.base_rates, o = data.overlays;
    if (bucketSpread(sl.spread) === '10_plus') { const b = br.by_spread['10_plus']; R.push(`${sl.fav} −${num(sl.spread)}: a 10+ favorite blows it out ${b.blowout14}% of the time${b.n ? ` (n = ${b.n} games)` : ''}`); }
    if (+sl.total <= o.grind.trigger.total_max) { const t = br.by_total.grind; R.push(`total ${num(sl.total)}: grind — ${t.le37}% of these games finish at 37 or less${t.n ? ` (n = ${t.n})` : ''}`); }
    if (sl.env === 'wind_15_plus') { const w = br.weather.wind_15_plus; R.push(`wind 15+: over rate ${w.over_rate}% (n = ${w.n})`); }
    return { on: R.length > 0, reasons: R };
  };
  // The next primetime slate this week (earliest kickoff), else a primetime replay.
  const nextPrimetime = () => {
    const live = slates.filter(x => !x.replay && slateTier(x) === 'primetime').sort((a, b) => String(a.kickoff || '').localeCompare(String(b.kickoff || '')));
    return live[0] || slates.find(x => slateTier(x) === 'primetime') || slates[0] || null;
  };
  // Slates offered in Step 1 and the Lab: primetime always; Sunday only in attack mode; the current preset always.
  const visibleSlates = () => slates.filter(x => slateTier(x) === 'primetime' || state.attack || x.id === state.preset);

  const store = {
    load() { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; } },
    save(s) { try { localStorage.setItem(LS_KEY, JSON.stringify({ spread: s.spread, total: s.total, env: s.env, contest: s.contest, entries: s.entries, lean: s.lean, preset: s.preset })); } catch {} },
    clear() { try { localStorage.removeItem(LS_KEY); } catch {} }
  };

  const $id = id => document.getElementById(id);
  const derive = () => {
    const sb = bucketSpread(state.spread), tb = bucketTotal(state.total);
    const ov = overlaysFor(data, state.total, state.env);
    const cell = cheatCell(sb, state.total);
    const cellData = data.captain_by_spread_x_total[cell.row][cell.col];
    const preset = slates.find(p => p.id === state.preset) || null;
    return { sb, tb, ov, cell, cellData, preset,
      spreadBucket: data.inputs.spread_buckets.find(b => b.key === sb),
      totalBucket:  data.inputs.total_buckets.find(b => b.key === tb),
      alloc: allocationFor(data, sb, state.lean),
      shortlist: shortlistFor(cellData),
      dials: dialsFor(data, ov, state.spread, state.contest),
      laws: pinnedLawsFor(state.spread, state.total) };
  };

  /* ---------- Step 1: inputs ---------- */
  const pill = (group, key, label, on, extra = '') => `<button type="button" class="chip" role="radio" aria-checked="${on}" aria-pressed="${on}" data-group="${group}" data-key="${esc(key)}" ${extra}>${label}</button>`;
  const setSlider = (id, value, lo, hi, bubble) => {
    const el = $id(id + 'Range'), wrap = $id(id + 'Slider'), out = $id(id + 'Bubble');
    if (!el) return;
    if (!el.matches(':active')) el.value = value;          // don't fight a drag in progress
    const p = (+el.value - +el.min) / ((+el.max - +el.min) || 1) * 100;
    wrap.style.setProperty('--p', `${p}%`);
    out.textContent = bubble;
    out.style.left = `calc(${p}% + ${((0.5 - p / 100) * 18).toFixed(1)}px)`;
  };
  // Bucket bands under a slider track: [{key,label,from,to,on,mark}]
  const bands = (lo, hi, list) => list.map(b => {
    const l = (Math.max(lo, b.from) - lo) / (hi - lo) * 100, r = (Math.min(hi, b.to) - lo) / (hi - lo) * 100;
    return `<span class="sd-band${b.on ? ' on' : ''}${b.mark ? ' mark-' + b.mark : ''}" style="left:${l.toFixed(2)}%;width:${(r - l).toFixed(2)}%"><i>${esc(b.label)}</i></span>`;
  }).join('');
  const renderInputs = () => {
    const d = derive();
    const sbKey = d.sb, tbKey = d.tb, eKey = bucketEntries(state.entries);
    $id('sdSpreadPills').innerHTML = data.inputs.spread_buckets.map(b => pill('spread', b.key, esc(b.label.replace("Pick'em to 3", 'PK–3').replace(' to ', '–').replace(' or more', '+')), b.key === sbKey)).join('');
    $id('sdTotalPills').innerHTML = data.inputs.total_buckets.map(b => pill('total', b.key, esc(b.label.replace(' or under', ' or less').replace(' to ', '–').replace(' or more', '+').replace('41 or less', '≤41')), b.key === tbKey)).join('');
    $id('sdEnvPills').innerHTML = data.inputs.environment.map(k => `<button type="button" class="sd-env" role="radio" aria-checked="${k === state.env}" aria-pressed="${k === state.env}" data-group="env" data-key="${esc(k)}" title="${esc(ENV_LABEL[k] || k)}">${ENV_ICON[k] || ''}<span>${esc(ENV_SHORT[k] || k)}</span></button>`).join('');
    $id('sdContestPills').innerHTML = data.inputs.contest_types.map(c => `<button type="button" role="radio" aria-checked="${c.key === state.contest}" class="${c.key === state.contest ? 'active' : ''}" data-group="contest" data-key="${esc(c.key)}">${esc(CONTEST_SHORT[c.key] || c.label)}</button>`).join('');
    $id('sdEntriesPills').innerHTML = ENTRY_PILLS.map(p => pill('entries', p.key, p.label, p.key === eKey)).join('');
    $id('sdLeanPills').innerHTML = LEANS.map(l => `<button type="button" role="radio" aria-checked="${l.key === state.lean}" class="${l.key === state.lean ? 'active' : ''}" data-group="lean" data-key="${l.key}">${l.label}</button>`).join('');
    if (document.activeElement !== $id('sdSpreadNum')) $id('sdSpreadNum').value = state.spread;
    if (document.activeElement !== $id('sdTotalNum')) $id('sdTotalNum').value = state.total;
    if (document.activeElement !== $id('sdEntriesNum')) $id('sdEntriesNum').value = state.entries;
    // sliders + bucket bands
    const fav = d.preset ? d.preset.fav : 'Fav';
    setSlider('sdSpread', Math.min(SPREAD_RANGE[1], state.spread), ...SPREAD_RANGE, `${fav} −${num(state.spread)}`);
    setSlider('sdTotal', Math.max(TOTAL_RANGE[0], Math.min(TOTAL_RANGE[1], state.total)), ...TOTAL_RANGE, num(state.total));
    setSlider('sdEntries', nearestStep(state.entries), 0, ENTRY_STEPS.length - 1, `${state.entries}`);
    $id('sdSpreadBands').innerHTML = bands(...SPREAD_RANGE, [
      { label: 'PK–3', from: 0, to: 3.25, on: sbKey === 'pk_3' }, { label: '3.5–6.5', from: 3.25, to: 6.75, on: sbKey === '3.5_6.5' },
      { label: '7–9.5', from: 6.75, to: 9.75, on: sbKey === '7_9.5' }, { label: '10+', from: 9.75, to: 17, on: sbKey === '10_plus' }]);
    const o = data.overlays;
    $id('sdTotalBands').innerHTML = bands(...TOTAL_RANGE, [
      { label: `≤${o.grind.trigger.total_max} grind`, from: 34, to: o.grind.trigger.total_max + 0.25, on: tbKey === 'grind', mark: 'grind' }, { label: '42–45', from: 41.25, to: 45.75, on: tbKey === 'low' },
      { label: '46–49', from: 45.75, to: o.shootout.trigger.total_min - 0.25, on: tbKey === 'mid' },
      { label: `${o.shootout.trigger.total_min}+ shootout`, from: o.shootout.trigger.total_min - 0.25, to: 62, on: +state.total >= o.shootout.trigger.total_min, mark: 'shootout' }]);
    // Tune drawer (dock): same state, compact controls.
    setSlider('sdTSpread', Math.min(SPREAD_RANGE[1], state.spread), ...SPREAD_RANGE, `${fav} −${num(state.spread)}`);
    setSlider('sdTTotal', Math.max(TOTAL_RANGE[0], Math.min(TOTAL_RANGE[1], state.total)), ...TOTAL_RANGE, num(state.total));
    $id('sdTSpreadVal').textContent = d.spreadBucket.label;
    $id('sdTTotalVal').textContent = `${d.totalBucket.label}${d.ov.shootout ? ' · SHOOTOUT' : +state.total <= o.grind.trigger.total_max ? ' · GRIND' : ''}`;
    $id('sdTEnvPills').innerHTML = $id('sdEnvPills').innerHTML;
    $id('sdTTotalSlider').classList.toggle('hot', d.ov.shootout);
    $id('sdTotalSlider').classList.toggle('hot', d.ov.shootout);
    $id('sdTotalSlider').classList.toggle('cold', +state.total <= o.grind.trigger.total_max);
    $id('sdSpreadVal').textContent = `${d.spreadBucket.label} → ${d.sb}`;
    $id('sdTotalVal').textContent = `${d.totalBucket.label} → ${d.tb}`;
    $id('sdEnvVal').textContent = `over rate ${data.base_rates.weather[state.env].over_rate}%`;
    $id('sdEntriesVal').textContent = `${state.entries} lineup${state.entries === 1 ? '' : 's'}`;
    $id('sdPresetVal').textContent = d.preset ? `${d.preset.label} loaded` : 'custom slate';
    const chipOf = p => pill('preset', p.id, `<b>${esc(p.label)}</b> <span>${esc(p.fav)} −${num(p.spread)} · ${num(p.total)} · ${esc(ENV_SHORT[p.env] || p.env).toLowerCase()}</span>`, p.id === state.preset);
    const prime = slates.filter(x => slateTier(x) === 'primetime'), live = prime.filter(x => !x.replay), rep = prime.filter(x => x.replay);
    const sun = slates.filter(x => slateTier(x) === 'sunday'), atk = sun.filter(x => attackFor(x).on);
    $id('sdPresets').innerHTML = !slates.length ? '<span class="sd-num-hint">No presets this week.</span>' : `
      ${live.length ? `<div class="sd-preset-group"><span class="sd-preset-k">This week · primetime</span>${live.map(chipOf).join('')}</div>` : ''}
      ${rep.length ? `<div class="sd-preset-group"><span class="sd-preset-k">Practice · W2 primetime replays</span>${rep.map(chipOf).join('')}</div>` : ''}
      ${sun.length ? `<div class="sd-preset-group sd-attack">
        <button type="button" class="sd-attack-toggle${state.attack ? ' on' : ''}" data-attack aria-pressed="${state.attack}">${state.attack ? '▾' : '▸'} Attack a Sunday game <small>${sun.length} Sunday slate${sun.length === 1 ? '' : 's'}${atk.length ? ` · ${atk.length} with an extreme script` : ''} · primetime-first</small></button>
        ${state.attack ? sun.slice().sort((a, b) => attackFor(b).on - attackFor(a).on).map(x => { const a = attackFor(x); return `<div class="sd-attack-row${a.on ? ' on' : ''}">${chipOf(x)}${a.on ? `<span class="sd-attack-badge" title="${esc(a.reasons.join(' · '))}">attack</span><small>${esc(a.reasons.join(' · '))}</small>` : '<small class="dim">no edge from the script — primetime-first</small>'}</div>`; }).join('') : ''}
      </div>` : ''}`;
    const chip = `${spreadLabel(state.spread, d.preset && d.preset.fav)} · ${num(state.total)} · ${ENV_SHORT[state.env]} · ${CONTEST_SHORT[state.contest]} · ${state.entries} ${state.entries === 1 ? 'entry' : 'entries'}`;
    const chipEl = $id('sdChipText'); if (chipEl) chipEl.textContent = chip;
    $id('sdSummary').textContent = chip;
  };

  /* ---------- Console (hero) + dock ---------- */
  const OV_LIGHTS = [['shootout', 'Shootout'], ['grind', 'Grind'], ['dome', 'Dome'], ['wind', 'Wind 15+']];
  let labScore = null;   // {score, verdict, legal, tag, partial} from showdown_lab.js
  const scoreRing = (key, s, big) => {
    const R = big ? 34 : 13, C = 2 * Math.PI * R, v = s && s.score != null ? s.score : 0, sz = big ? 84 : 34;
    const cls = !s ? 'idle' : !s.legal ? 'bad' : s.partial ? 'part' : v >= 85 ? 'elite' : v >= 70 ? 'good' : v >= 50 ? 'ok' : 'low';
    return `<svg class="sd-score-ring ${cls}" viewBox="0 0 ${sz} ${sz}" width="${sz}" height="${sz}" aria-hidden="true"><g transform="rotate(-90 ${sz / 2} ${sz / 2})"><circle class="trk" cx="${sz / 2}" cy="${sz / 2}" r="${R}"/><circle class="val" data-m="${key}" cx="${sz / 2}" cy="${sz / 2}" r="${R}" style="stroke-dasharray:${(C * v / 100).toFixed(2)} ${C.toFixed(2)}"/></g></svg>`;
  };
  const renderConsole = d => {
    const b = data.base_rates.by_spread[d.sb], t = data.base_rates.by_total[d.tb], odds = scriptOdds(b), r = gameRead(d);
    const fav = d.preset ? d.preset.fav : 'Fav', dog = d.preset ? d.preset.dog : 'Dog';
    const s = labScore;
    $id('sdConsole').innerHTML = `
      <div class="sd-con-tile"><span class="k">Spread</span><b>${esc(fav)} −${FX.num('con.spread', +state.spread, state.spread % 1 ? 1 : 0)}</b>
        <small>${esc(d.spreadBucket.label)} · ${esc(dog)} wins ${FX.num('con.dog', b.dog_wins, 0, { post: '%' })}</small>
        <span class="sd-con-meter"><i data-m="con.m.spread" style="width:${(Math.min(17, state.spread) / 17 * 100).toFixed(1)}%"></i></span></div>
      <div class="sd-con-tile"><span class="k">Total</span><b>${FX.num('con.total', +state.total, state.total % 1 ? 1 : 0)}</b>
        <small>mean ${FX.num('con.mean', t.mean_actual, 1)} · P(≥55) ${FX.num('con.ge55', t.ge55, 0, { post: '%' })}</small>
        <span class="sd-con-meter${d.ov.shootout ? ' hot' : ''}"><i data-m="con.m.total" style="width:${((Math.max(34, Math.min(62, state.total)) - 34) / 28 * 100).toFixed(1)}%"></i></span></div>
      <div class="sd-con-tile sd-con-wide"><span class="k">Script odds · ${esc(d.spreadBucket.label)}</span><b>${esc(r.script)}</b>
        <div class="sd-con-odds">${['A', 'B', 'C', 'D'].map((k, i) => `<span><i class="sd-seg-${i + 1}" data-m="con.o.${k}" style="height:${Math.max(4, odds[k] / 60 * 100).toFixed(1)}%"></i><em>${k}</em><small>${FX.num('con.o.' + k + '.v', Math.round(odds[k]), 0)}</small></span>`).join('')}</div></div>
      <div class="sd-con-tile"><span class="k">Overlays</span>
        <div class="sd-lights">${OV_LIGHTS.map(([k, l]) => `<span class="sd-light${d.ov[k] ? ' on' : ''}" data-light="${k}"><i></i>${l}</span>`).join('')}</div></div>
      <a class="sd-con-tile sd-con-score" href="nfl/showdown/#step4" data-jump="step4"><span class="k">Lineup Lab</span>
        <span class="sd-con-score-row">${scoreRing('con.score', s, true)}<span class="sd-con-score-txt">${s && s.score != null ? `<b>${FX.num('con.score.v', s.score, 0)}</b><small>${esc(s.verdict)}</small>` : '<b class="dim">—</b><small>build a lineup ↓</small>'}</span></span></a>`;
  };
  const STEPS = [['step1', 'Set'], ['step2', 'Read'], ['step3', 'Build'], ['step4', 'Score'], ['step5', 'Ship'], ['step6', 'Review']];
  const renderDock = d => {
    const s = labScore;
    $id('sdDock').innerHTML = `<div class="sd-dock-inner">
      <div class="sd-dock-steps">${STEPS.map(([id, l], i) => `<a href="nfl/showdown/#${id}" data-jump="${id}" class="sd-dock-step" data-step="${id}"><span>${i + 1}</span>${l}</a>`).join('')}</div>
      <div class="sd-dock-read"><span class="sd-dock-slate">${esc(spreadLabel(state.spread, d.preset && d.preset.fav))} · ${num(state.total)} · ${esc(ENV_SHORT[state.env])}</span>
        <span class="sd-dock-lights">${OV_LIGHTS.map(([k, l]) => `<i class="${d.ov[k] ? 'on' : ''}" title="${l}${d.ov[k] ? ' overlay on' : ''}"></i>`).join('')}</span>
        <button type="button" class="sd-dock-tune${$id('sdTune') && !$id('sdTune').hidden ? ' on' : ''}" data-tune-toggle aria-expanded="${$id('sdTune') && !$id('sdTune').hidden}" aria-controls="sdTune" title="Adjust the line from anywhere">Tune</button>
        <button type="button" class="sd-dock-link" data-copy-link="" title="Copy a link to this slate${s ? ' and your Lab lineup' : ''}" aria-label="Copy a link to this slate">${svgI('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>')}</button>
        <a class="sd-dock-score ${s ? (!s.legal ? 'bad' : s.score >= 70 && !s.partial ? 'good' : '') : 'idle'}" href="nfl/showdown/#step4" data-jump="step4">${scoreRing('dock.score', s, false)}<b>${s && s.score != null ? s.score : '—'}</b></a></div>
      </div><div class="sd-dock-progress"><i id="sdDockProgress"></i></div>`;
    spy();
  };
  // Scrollspy + reading progress for the dock.
  const spy = () => {
    const dock = $id('sdDock'); if (!dock) return;
    const off = (dock.getBoundingClientRect().bottom || 0) + 120;
    let cur = STEPS[0][0];
    for (const [id] of STEPS) { const el = $id(id); if (el && el.getBoundingClientRect().top - off <= 0) cur = id; }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = STEPS[STEPS.length - 1][0];
    dock.querySelectorAll('.sd-dock-step').forEach(a => a.classList.toggle('active', a.dataset.step === cur));
    const page = $id('sdPage'), bar = $id('sdDockProgress');
    if (page && bar) { const r = page.getBoundingClientRect(), p = Math.max(0, Math.min(1, (off - r.top) / Math.max(1, r.height - window.innerHeight + off))); bar.style.width = `${(p * 100).toFixed(1)}%`; }
  };
  const setDockTop = () => {
    // The NFL nav is sticky inside its own #site-header mount, so it scrolls
    // away; the dock pins to the viewport top unless the nav really sticks.
    const nav = document.querySelector('.nfl-nav'), mount = document.getElementById('site-header');
    const sticks = nav && mount && mount.getBoundingClientRect().height > nav.getBoundingClientRect().height + 1;
    const h = sticks ? Math.round(nav.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty('--sd-nav-h', `${h}px`);
    const dock = $id('sdDock'); if (dock) document.documentElement.style.setProperty('--sd-dock-h', `${Math.round(dock.getBoundingClientRect().height)}px`);
  };

  /* ---------- Step 2: read the game ---------- */
  const renderScript = d => {
    const b = data.base_rates.by_spread[d.sb];
    const favControls = b.fav_wins - b.blowout14;
    const segs = [
      { label: 'Blowout ≥14', value: b.blowout14, cls: SEG[0] },
      { label: 'Fav controls', value: favControls, cls: SEG[1] },
      { label: 'Dog wins', value: b.dog_wins, cls: SEG[3], dark: true }
    ];
    const at = (b.blowout14 + favControls) / (b.blowout14 + favControls + b.dog_wins);
    $id('sdScript').innerHTML = `
      <div class="card-title">Script distribution · <span class="card-title-accent">${esc(d.spreadBucket.label)}</span></div>
      ${hbar('script', segs.map((x, i) => ({ ...x, k: ['A', 'B', 'D'][i] })), { tall: true, marker: { label: 'Within 3', value: b.within3, at }, aria: `Spread ${d.spreadBucket.label}: blowout ${b.blowout14}%, favorite controls ${favControls}%, dog wins ${b.dog_wins}%, within 3 points ${b.within3}%` })}
      <div class="sd-legend">
        <span><i class="sd-seg-1"></i>Blowout (fav by ≥14) ${b.blowout14}%</span>
        <span><i class="sd-seg-2"></i>Fav controls (wins by &lt;14) ${favControls}%</span>
        <span><i class="sd-seg-4"></i>Dog wins ${b.dog_wins}%</span>
        <span>┆ Within 3 (either side) ${b.within3}% · overlaps</span>
      </div>
      <p class="sd-lede">A <strong>${esc(d.spreadBucket.label.toLowerCase())}</strong> favorite blows it out <strong>${FX.num('script.bl', b.blowout14, 0, { post: '%' })}</strong> of the time and loses <strong>${FX.num('script.dw', b.dog_wins, 0, { post: '%' })}</strong>. Fav by 7+: ${b.fav_by7}%. Build for the distribution, not the favorite.</p>
      <div class="sd-caption">${b.n ? `${nTag(b.n)} games at this spread · ` : ''}2,761 games 2016–25 · fav controls = fav wins ${b.fav_wins} − blowout ${b.blowout14}</div>`;
  };

  const gameRead = d => {
    const b = data.base_rates.by_spread[d.sb], t = data.base_rates.by_total[d.tb];
    const parts = [['Blowout-prone', b.blowout14], ['Favorite-controlled', b.fav_wins - b.blowout14], ['Coin flip', b.within3], ['Upset-prone', b.dog_wins]].sort((x, y) => y[1] - x[1]);
    const ovs = Object.keys(d.ov).filter(k => d.ov[k]).map(k => k === 'wind' ? 'Wind ≥15' : k[0].toUpperCase() + k.slice(1));
    return { script: parts[0][0], scriptPct: parts[0][1], runner: parts[1][0], runnerPct: parts[1][1], mean: t.mean_actual, ovs };
  };
  const renderRead = d => {
    const r = gameRead(d);
    $id('sdRead').innerHTML = `
      <div class="card-title card-title-accent">The game · one line</div>
      <div class="sd-verdict sd-verdict-4">
        <div class="sd-vd"><span>Script</span><b>${r.script} game</b><small>${FX.num('read.sp', r.scriptPct, 0, { post: '%' })} most likely · ${r.runner.toLowerCase()} ${r.runnerPct}% next</small></div>
        <div class="sd-vd"><span>Points</span><b>${FX.num('read.mean', r.mean, 1)} mean</b><small>${esc(d.totalBucket.label)} total band · line ${num(state.total)}</small></div>
        <div class="sd-vd"><span>Environment</span><b>${esc(ENV_LABEL[state.env])}</b><small>over rate ${data.base_rates.weather[state.env].over_rate}%</small></div>
        <div class="sd-vd"><span>Overlay</span><b class="${r.ovs.length ? 'gold' : ''}">${r.ovs.length ? r.ovs.join(' + ') : 'None'}</b><small>${r.ovs.length ? 'changes the dials below' : 'base allocation applies'}</small></div>
      </div>`;
  };

  const renderTotalStrip = d => {
    const t = data.base_rates.by_total[d.tb];
    const w = data.base_rates.weather;
    const wind = isWind(state.env) ? `<div class="sd-badges"><div class="sd-badge on"><b>Wind ≥10</b><span>over rate ${w[state.env].over_rate}% (n = ${w[state.env].n}) vs ${w.dome.over_rate}–${w.outdoor_mild.over_rate}% dome/mild</span></div></div>` : '';
    $id('sdTotalStrip').innerHTML = `
      <div class="card-title">Total reality · <span class="card-title-accent">${esc(d.totalBucket.label)}</span></div>
      <div class="sd-strip" role="img" aria-label="Total ${d.totalBucket.label}: mean actual ${t.mean_actual}, over by 7 or more ${t.over7}%, under by 7 or more ${t.under7}%, 55 or more ${t.ge55}%, 37 or less ${t.le37}%">
        <div class="sd-strip-cell"><b>${FX.num('tot.mean_actual', t.mean_actual, 1)}</b><span>mean actual</span></div>
        <div class="sd-strip-cell"><b>${FX.num('tot.over7', t.over7, 0, { post: '%' })}</b><span>over by 7+</span></div>
        <div class="sd-strip-cell"><b>${FX.num('tot.under7', t.under7, 0, { post: '%' })}</b><span>under by 7+</span></div>
        <div class="sd-strip-cell"><b>${FX.num('tot.ge55', t.ge55, 0, { post: '%' })}</b><span>P(≥55)</span></div>
        <div class="sd-strip-cell"><b>${FX.num('tot.le37', t.le37, 0, { post: '%' })}</b><span>P(≤37)</span></div>
      </div>
      ${wind}
      <div class="sd-caption">${t.n ? `${nTag(t.n)} games in this band · ` : ''}2,761 games 2016–25 · ${esc(ENV_LABEL[state.env])} over rate ${w[state.env].over_rate}% (n = ${w[state.env].n})</div>`;
  };

  const renderOverlays = d => {
    const o = data.overlays, a = data.archetypes, p = data.portfolio;
    const badges = [
      { key: 'shootout', name: 'Shootout', on: d.ov.shootout, text: d.ov.shootout ? `${a.E.overlay} · both-QB max ${pct(o.shootout.both_qbs_share_max)}, K ${range(p.k_share.shootout)}, DST ${range(p.dst_share.shootout)}, TE-CPT +${pct(o.shootout.te_cpt_bonus)}` : `total ≥ ${o.shootout.trigger.total_min}` },
      { key: 'grind', name: 'Grind', on: d.ov.grind, text: d.ov.grind ? `${a.F.overlay} · K ${range(p.k_share.grind)}, DST ${range(p.dst_share.grind)}, both-QB max ${pct(o.grind.both_qbs_share_max)}, RB-CPT +${pct(o.grind.rb_cpt_bonus)}` : `total ≤ ${o.grind.trigger.total_max} or wind ≥ ${o.grind.trigger.or_wind_min}` },
      { key: 'dome', name: 'Dome', on: d.ov.dome, text: d.ov.dome ? `TE-CPT −${pct(o.dome.te_cpt_penalty)} · K share +${pct(o.dome.k_share_bump)} · dome winners: K ${data.roof_weather_winners.dome.K}%, WR CPT ${data.roof_weather_winners.dome.cpt_pos.WR}%` : 'roof closed' },
      { key: 'wind', name: 'Wind', on: d.ov.wind, text: d.ov.wind ? `QB-CPT −${pct(o.wind.qb_cpt_penalty)} · DST share → grind ${range(p.dst_share.grind)}` : `wind ≥ ${o.wind.trigger.wind_min}` }
    ];
    const none = !badges.some(b => b.on);
    $id('sdOverlays').innerHTML = `
      <div class="card-title">Overlay${none ? ' · <span class="card-title-accent">none</span>' : ''}</div>
      <div class="sd-badges">${badges.map(b => `<div class="sd-badge${b.on ? ' on' : ''}"><b>${b.name}</b><span>${esc(b.text)}</span></div>`).join('')}</div>
      <div class="sd-caption">Overlays fire from the total and the environment only. A lean reallocates A/B/C/D — it can never switch one off (W2 DET@BUF, rules v1.2).</div>`;
  };

  // Rate bar with a 90% Wilson whisker (ci = [lo, hi] in %, from the row's `ci` object).
  const ciBar = (v, ci, key) => `<span class="sd-cibar"><span class="bar"><span class="bar-fill" data-m="${key}" style="width:${Math.max(0, Math.min(100, v))}%"></span></span>${ci ? `<i class="sd-ci" data-m="${key}.ci" style="left:${ci[0]}%;width:${Math.max(0, ci[1] - ci[0])}%" title="90% Wilson interval ${ci[0]}–${ci[1]}%"></i>` : ''}</span>`;
  const winnerCol = (title, row, n, source, key = 'w') => {
    const cp = row.cpt_pos, ci = row.ci || {}, cpci = ci.cpt_pos || {};
    return `<div class="sd-winner-col">
      <h4>${title}</h4>
      <div class="sd-donut-wrap">
        <div style="position:relative">${ring(key + '.ring', POS.map((k, i) => ({ label: k, value: cp[k] || 0, cls: SEG[i] })), `Captain position: ${POS.map(k => `${k} ${cp[k]}%`).join(', ')}`)}
          <div class="sd-donut-center" style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center"><b>${FX.num(key + '.fav', row.cpt_fav, 0, { post: '%' })}</b><span>CPT fav</span>${ci.cpt_fav ? `<small class="sd-ci-txt">${ci.cpt_fav[0]}–${ci.cpt_fav[1]}</small>` : ''}</div></div>
        <div class="sd-rates">
          <div class="sd-rate" title="${ci.cpt_fav ? `CPT fav ${row.cpt_fav}% · 90% Wilson interval ${ci.cpt_fav[0]}–${ci.cpt_fav[1]}% (n = ${n})` : ''}"><span>CPT fav</span>${ciBar(row.cpt_fav, ci.cpt_fav, key + '.fv')}<span class="v">${FX.num(key + '.fv.v', row.cpt_fav, 0, { post: '%' })}</span></div>
          ${POS.map((k, i) => `<div class="sd-rate" title="${cpci[k] ? `CPT ${k} ${cp[k]}% · 90% Wilson interval ${cpci[k][0]}–${cpci[k][1]}% (n = ${n})` : ''}"><span><i class="sd-legend"><i class="${SEG[i]}"></i></i>CPT ${k}</span>${ciBar(cp[k], cpci[k], `${key}.cp.${k}`)}<span class="v">${FX.num(key + '.cp.' + k + '.v', cp[k], 0, { post: '%' })}</span></div>`).join('')}</div>
      </div>
      <div class="sd-rates">
        ${rate('5-1 fav', row.five_one_fav, false, key + '.51')}${rate('4-2', row.four_two, false, key + '.42')}${rate('3-3', row.three_three, false, key + '.33')}
      </div>
      <div class="sd-rates">
        ${rate('K in lineup', row.K, true, key + '.k')}${rate('DST in lineup', row.DST, true, key + '.dst')}${rate('Both QBs', row.both_qb, true, key + '.bq')}${rate('Dog QB in lineup', row.dog_qb_in_lineup, true, key + '.dq')}
      </div>
      <div class="sd-caption">${nTag(n)} · ${source}${row.ci ? ' · whisker = 90% Wilson interval on the captain rates' : ''}</div>
    </div>`;
  };

  // Winners · Top 1% · Field on one row key: a dot plot per metric (0–100%).
  const COH_METRICS = [['cpt_fav', 'CPT fav'], ['cpt_pos.WR', 'CPT WR'], ['cpt_pos.RB', 'CPT RB'], ['cpt_pos.QB', 'CPT QB'], ['cpt_pos.TE', 'CPT TE'],
    ['five_one_fav', '5-1 fav'], ['four_two', '4-2'], ['three_three', '3-3'], ['K', 'K in lineup'], ['DST', 'DST in lineup'], ['both_qb', 'Both QBs'], ['dog_qb_in_lineup', 'Dog QB in']];
  const getv = (row, path) => { if (!row) return null; const [a, b] = path.split('.'); const v = b ? (row[a] || {})[b] : row[a]; return v == null ? null : +v; };
  const getci = (row, path) => { if (!row || !row.ci) return null; const [a, b] = path.split('.'); return b ? (row.ci[a] || {})[b] || null : row.ci[a] || null; };
  const slatesTag = r => r ? `<span class="n${r.slates_n < 3 ? ' small' : ''}">${r.slates_n} slate${r.slates_n === 1 ? '' : 's'} · ${(+r.lineups_n).toLocaleString('en-US')} lineups${r.slates_n < 3 ? ' · small sample' : ''}</span>` : '<span class="n small">no archive slate in this bucket yet</span>';
  const cohortCol = (title, key, mk, tier = 'primetime') => {
    const c = cohortRows(data, key, tier), w = c.winners, t = c.top1, f = c.field;
    const fa = data.field_archive || {};
    const labels = Object.fromEntries([...(fa.slates || []), ...((fa.sunday || {}).slates || [])].map(s => [s.id, s.label]));
    const rows = COH_METRICS.map(([m, label]) => {
      const vw = getv(w, m), vt = getv(t, m), vf = getv(f, m), ci = getci(w, m);
      const dot = (cls, v, k) => v == null ? '' : `<i class="sd-coh-dot ${cls}" data-m="${mk}.${m}.${k}" style="left:${Math.max(0, Math.min(100, v))}%"></i>`;
      const delta = vt != null && vf != null ? vt - vf : null;
      return `<div class="sd-coh-row" title="${esc(`${label}: winners ${vw ?? '—'}% · top 1% ${vt ?? '—'}% · field ${vf ?? '—'}%`)}">
        <span class="sd-coh-k">${label}<small class="sd-coh-m"><b>${vw ?? '—'}</b>·<b class="t">${vt ?? '—'}</b>·<b class="f">${vf ?? '—'}</b></small></span>
        <span class="sd-coh-track">${ci ? `<i class="sd-coh-ci" data-m="${mk}.${m}.ci" style="left:${ci[0]}%;width:${Math.max(0, ci[1] - ci[0])}%"></i>` : ''}${dot('f', vf, 'f')}${dot('w', vw, 'w')}${dot('t', vt, 't')}</span>
        <span class="sd-coh-v"><span class="sd-coh-vals"><b>${vw ?? '—'}</b>·<b class="t">${vt ?? '—'}</b>·<b class="f">${vf ?? '—'}</b></span>${delta != null ? `<em class="${t && t.slates_n < 3 ? 'small' : ''}">${sgn(delta).replace('.0', '')}</em>` : ''}</span>
      </div>`;
    }).join('');
    const sl = r => r && r.slates ? ` (${r.slates.map(s => esc(labels[s] || s)).join(', ')})` : '';
    return `<div class="sd-winner-col sd-coh-col">
      <h4>${title}</h4>
      <div class="sd-coh-head"><span></span><span class="sd-coh-legend"><span><i class="sd-coh-dot w"></i>Winners</span><span><i class="sd-coh-dot t"></i>Top 1%</span><span><i class="sd-coh-dot f"></i>Field</span></span><span class="sd-coh-v"><span class="sd-coh-vals">W·1%·F</span> <em>Δ</em></span></div>
      <div class="sd-coh-rows">${rows}</div>
      <div class="sd-caption">Winners ${w ? nTag(w.n) : '—'} · 120 DK winners 2018–25 (the rules)<br>2026 top 1% ${slatesTag(t)}${sl(t)}<br>2026 field ${slatesTag(f)}${sl(f)}${tier === 'sunday' ? '<br>Sunday single-game slates · supporting only, never pooled with primetime' : ''}</div>
    </div>`;
  };

  const REALIZED = [
    { key: 'fav_by_14_plus', label: 'Blowout (fav by 14+)', dist: b => b.blowout14 },
    { key: 'fav_by_4_13',    label: 'Fav by 4–13',          dist: b => b.fav_wins - b.blowout14 },
    { key: 'within_3',       label: 'Within 3',             dist: b => b.within3 },
    { key: 'dog_by_4_plus',  label: 'Dog wins',             dist: b => b.dog_wins }
  ];
  const renderWinners = d => {
    const src = '120 DK showdown winners 2018–25';
    const b = data.base_rates.by_spread[d.sb];
    if (!state.realized) state.realized = REALIZED.slice().sort((x, y) => y.dist(b) - x.dist(b))[0].key;
    const head = `<div class="sd-winners-head">
      <div class="card-title">What winners looked like here</div>
      <div class="seg" role="tablist" aria-label="Winner view">
        <button type="button" role="tab" data-view="expected" class="${state.view === 'expected' ? 'active' : ''}" aria-selected="${state.view === 'expected'}">Build for the distribution</button>
        <button type="button" role="tab" data-view="realized" class="${state.view === 'realized' ? 'active' : ''}" aria-selected="${state.view === 'realized'}">If you're right about the game</button>
        ${data.top1pct_by_expected_script ? `<button type="button" role="tab" data-view="cohorts" class="${state.view === 'cohorts' ? 'active' : ''}" aria-selected="${state.view === 'cohorts'}">Winners · Top 1% · Field</button>` : ''}
      </div></div>`;
    let body;
    if (state.view === 'cohorts' && data.top1pct_by_expected_script) {
      const sk = expectedSpreadRow(d.sb), tk = expectedTotalRow(d.tb, state.total), tier = state.cohTier === 'sunday' ? 'sunday' : 'primetime';
      const fa = data.field_archive || {}, anom = fa.anomalies || [];
      body = `<p class="sd-lede">The rules come from the <strong>120 historical winners</strong> (gold). Beside them, the <strong>top 1%</strong> and the <strong>whole field</strong> of the 2026 contest archive in games priced like this one — a check on the rules, not a replacement. Δ = top 1% − field, in points. The archive's n is <strong>slates</strong>, not lineups: every lineup in a slate shares one game.</p>
        <div class="sd-coh-tier"><div class="seg" role="tablist" aria-label="Archive tier">
          <button type="button" role="tab" data-coh-tier="primetime" class="${tier === 'primetime' ? 'active' : ''}" aria-selected="${tier === 'primetime'}">Primetime (primary)</button>
          <button type="button" role="tab" data-coh-tier="sunday" class="${tier === 'sunday' ? 'active' : ''}" aria-selected="${tier === 'sunday'}">Sunday slates (supporting)</button></div>
          ${anom.length ? `<span class="sd-caption">${anom.map(a => `${esc(a.label)} excluded: ${esc(a.reason)}`).join(' · ')}</span>` : ''}</div>
        <div class="sd-grid-2">
          ${cohortCol(`Spread ${esc(d.spreadBucket.label)} · <span style="color:var(--text-dimmed)">${sk}</span>`, sk, 'cS', tier)}
          ${cohortCol(`Total ${esc(d.totalBucket.label)} · <span style="color:var(--text-dimmed)">${tk}</span>`, tk, 'cT', tier)}
        </div>`;
    } else if (state.view === 'expected' || state.view === 'cohorts') {
      const sk = expectedSpreadRow(d.sb), tk = expectedTotalRow(d.tb, state.total);
      const sr = data.winners_by_expected_script[sk], tr = data.winners_by_expected_script[tk];
      body = `<p class="sd-lede">Winners in games the market priced like this one — the view you build the batch for.</p>
        <div class="sd-grid-2">
          ${winnerCol(`Spread ${esc(d.spreadBucket.label)} · <span style="color:var(--text-dimmed)">${sk}</span>`, sr, sr.n, src, 'wS')}
          ${winnerCol(`Total ${esc(d.totalBucket.label)} · <span style="color:var(--text-dimmed)">${tk}</span>`, tr, tr.n, src, 'wT')}
        </div>`;
    } else {
      const rr = data.winners_by_realized_script[state.realized];
      const cur = REALIZED.find(r => r.key === state.realized);
      const max = Math.max(...REALIZED.map(r => r.dist(b)));
      body = `<p class="sd-lede">Pick the script you believe. The % is how often a <strong>${esc(d.spreadBucket.label.toLowerCase())}</strong> favorite produced it; the card shows what won when it did.</p>
        <div class="sd-scripts" role="tablist" aria-label="Realized script">${REALIZED.map(r => { const v = r.dist(b), on = r.key === state.realized; return `
          <button type="button" class="sd-script-tile${on ? ' on' : ''}" role="tab" data-realized="${r.key}" aria-selected="${on}">
            <span class="sd-script-tile-label">${esc(r.label)}</span>
            <span class="sd-script-tile-pct">${Math.round(v)}%</span>
            <span class="bar"><span class="bar-fill" data-m="real.${r.key}" style="width:${v / max * 100}%"></span></span>
            <span class="sd-script-tile-sub">of games at this spread</span>
          </button>`; }).join('')}</div>
        <div class="sd-grid-2">${winnerCol(`${esc(cur.label)} · <span style="color:var(--text-dimmed)">${cur.key}</span>`, rr, rr.n, src, 'wR')}
          <div class="sd-winner-col" style="justify-content:center"><h4>Read it</h4>
            <div class="sd-kpis">
              <div class="sd-kpi"><b>${FX.num('kpi.cpt_fav', rr.cpt_fav, 0, { post: '%' })}</b><span>CPT from the favorite</span></div>
              <div class="sd-kpi"><b>${FX.num('kpi.five_one_fav', rr.five_one_fav, 0, { post: '%' })}</b><span>5-1 fav shape</span></div>
              <div class="sd-kpi"><b>${FX.num('kpi.both_qb', rr.both_qb, 0, { post: '%' })}</b><span>both QBs</span></div>
              <div class="sd-kpi"><b>${FX.num('kpi.dog_qb_in_lineup', rr.dog_qb_in_lineup, 0, { post: '%' })}</b><span>dog QB in lineup</span></div>
            </div>
            <p class="sd-lede" style="color:var(--text-muted)">This is the "if" view — what one lineup looks like when you call the script. The other tab is what you build the batch for.</p>
            <div class="sd-caption">${nTag(rr.n)} · ${src}</div></div>
        </div>`;
    }
    $id('sdWinners').innerHTML = head + body;
  };

  const renderCheat = d => {
    const c = data.captain_by_spread_x_total, e = data.captain_by_environment, rw = data.roof_weather_winners;
    const rowLabel = { le3: 'Spread ≤3', '3.5_6.5': '3.5–6.5', ge7: '≥7' };
    const heat = (v, max) => { const lvl = v <= 0 ? 0 : Math.min(5, Math.max(1, Math.ceil(v / max * 5))); return `<span class="sd-heat" data-level="${lvl}"><b>${v}%</b></span>`; };
    // one intensity scale per table so cells compare across the whole grid
    const maxPos = Math.max(...Object.values(c).flatMap(r => Object.values(r).flatMap(v => POS.map(k => v[k]))));
    const cell = (r, col) => { const v = c[r][col]; const on = r === d.cell.row && col === d.cell.col;
      return `<div class="sd-hcell${on ? ' active' : ''}" ${on ? 'aria-current="true"' : ''}>
        <span class="sd-hcell-tag">${rowLabel[r]} · ${col === 'total_ge46' ? 'total ≥46' : 'total ≤45.5'}</span>
        <div class="sd-heat-row">${POS.map(k => `<span class="sd-heat-k">${k}</span>${heat(v[k], maxPos)}`).join('')}</div>
        <div class="sd-cell-foot">fav CPT <b>${v.fav}%</b> · K <b>${v.K}%</b>${v.n ? ` · <span class="n${v.n < SMALL_N ? ' small' : ''}">n ${v.n}</span>` : ''}</div></div>`; };
    const ek = envRow(state.total), rk = roofRow(state.env);
    const envLabel = { grind_le42: 'Grind ≤42', 'avg_42.5_48.5': 'Avg 42.5–48.5', shootout_ge49: 'Shootout ≥49' };
    const roofLabel = { dome: 'Dome', outdoor_mild: 'Outdoor mild', cold_le35: 'Cold ≤35°', wind_ge15: 'Wind ≥15' };
    const maxEnv = Math.max(...Object.values(e).flatMap(v => POS.map(k => v[k])));
    const maxRoof = Math.max(...Object.values(rw).flatMap(v => [...POS.map(k => v.cpt_pos[k]), v.K, v.DST, v.both_qb]));
    const hrow = (label, on, cells, tail) => `<div class="sd-hrow${on ? ' active' : ''}"><span class="k">${label}</span><span class="sd-heat-row">${cells}</span><span class="sd-hrow-tail">${tail || ''}</span></div>`;
    $id('sdCheat').innerHTML = `
      <div class="card-title">Captain cheat-sheet · <span class="card-title-accent">${rowLabel[d.cell.row]} × ${d.cell.col === 'total_ge46' ? 'total ≥46' : 'total ≤45.5'}</span></div>
      <p class="sd-lede">Where the winning captain came from, by position. Darker gold = bigger share; your cell is outlined.</p>
      <div class="sd-hgrid" role="table" aria-label="Captain position share of winners by spread and total">
        <div class="sd-cheat-h"></div><div class="sd-cheat-h">Total ≤45.5</div><div class="sd-cheat-h">Total ≥46</div>
        ${['le3', '3.5_6.5', 'ge7'].map(r => `<div class="sd-cheat-h" style="align-self:center">${rowLabel[r]}</div>${cell(r, 'total_le45.5')}${cell(r, 'total_ge46')}`).join('')}
      </div>
      <div class="sd-caption">120 DK showdown winners 2018–25 · % of winning captains by position · fav = captain from the favorite</div>
      <div class="sd-hrows">
        <div class="sd-caption">By total band · winning captain position</div>
        ${Object.keys(e).map(k => hrow(envLabel[k], k === ek, POS.map(p => `<span class="sd-heat-k">${p}</span>${heat(e[k][p], maxEnv)}`).join(''), `default: ${esc(e[k].default)}`)).join('')}
      </div>
      <div class="sd-hrows">
        <div class="sd-caption">By roof / weather · captain position, then K · DST · both QBs in the lineup</div>
        ${Object.keys(rw).map(k => hrow(roofLabel[k], k === rk, `<span class="sd-heat-row-7">${[...POS.map(p => [p, rw[k].cpt_pos[p]]), ['K', rw[k].K], ['DST', rw[k].DST], ['2QB', rw[k].both_qb]].map(([kk, v]) => `<span class="sd-heat-k">${kk}</span>${heat(v, maxRoof)}`).join('')}</span>`, `own ${rw[k].cum_own}% · ${nTag(rw[k].n)}`)).join('')}
        ${!rk ? `<div class="sd-caption">No 10–14 mph wind cut in the winner set — the wind ≥10 effect shows in the total strip (over rate ${data.base_rates.weather.wind_10_14.over_rate}%).</div>` : ''}
      </div>
      <div class="sd-caption">Rows: 120 winners by total band (captain position) and by roof/weather (captain position · K · DST · both QBs)</div>`;
  };

  /* ---------- Step 3: build it ---------- */
  const renderShortlist = d => {
    const laws = data.ten_laws;
    const law = n => laws.find(l => l.n === n) || {};
    $id('sdShortlist').innerHTML = `
      <div class="card-title">Captain shortlist · <span class="card-title-accent">ranked for this cell</span></div>
      <div class="sd-seats">${d.shortlist.map((s, i) => { const max = d.shortlist[0].weight || 1; return `
        <div class="sd-seat" data-seat="${esc(s.seat)}">
          <span class="sd-seat-rank">SEAT ${i + 1}</span>
          <span class="sd-seat-name">${esc(seatName(d.preset, s.seat) || s.seat)}${seatName(d.preset, s.seat) ? `<small>${esc(s.seat)}</small>` : ''}</span>
          <span class="sd-seat-big">≈${FX.num('seat.' + s.seat, Math.round(s.weight), 0, { post: '%' })}<small>of winners here</small></span>
          <span class="bar bar-thick"><span class="bar-fill" data-m="seatbar.${esc(s.seat)}" style="width:${s.weight / max * 100}%"></span></span>
          <span class="sd-seat-share">${s.pos} CPT ${s.posShare}% × ${s.side} ${s.sideShare}%</span>
          <span class="sd-seat-why">${esc(s.why)}</span>
        </div>`; }).join('')}</div>
      <div class="sd-leverage"><b>Leverage test.</b> CPT-optimal 7% / CPT-own 2% = <b>a seat</b> · 6% / 14% = <b>a flex</b> · sweet spot <b>5–15% owned</b> with top-3 CPT-optimal.</div>
      <div class="sd-never">
        <div class="sd-never-item"><b>Dog pocket QB at +3.5 or more ${vBadge(data, ruleById(data, 'cpt_QB_DOG'), { mini: true })}</b><span>${esc(law(5).evidence)}</span></div>
        <div class="sd-never-item"><b>Kicker ${vBadge(data, ruleById(data, 'cpt_K'), { mini: true })}</b><span>${esc(law(7).evidence)}</span></div>
        <div class="sd-never-item"><b>DST ${vBadge(data, null, { mini: true })}</b><span>${esc(law(3).evidence)}</span></div>
      </div>
      <div class="sd-caption">120 DK showdown winners 2018–25 · seat weight ≈ position share × side share in the active cheat-sheet cell (independence estimate)</div>`;
  };

  const renderAlloc = d => {
    const a = d.alloc, ar = data.archetypes, p = data.portfolio, o = data.overlays;
    const counts = largestRemainder(a, state.entries);
    const names = { A: ar.A.name, B: ar.B.name.replace(' (by 4-13)', ''), C: ar.C.name.replace(' (within 3)', ''), D: ar.D.name };
    const segs = ['A', 'B', 'C', 'D'].map((k, i) => ({ label: k, value: a[k], cls: SEG[i], dark: i === 3 }));
    const lean = LEANS.find(l => l.key === state.lean);
    const adj = [];
    if (d.ov.shootout) adj.push(`<span class="sd-ovl-banner"><b>E · Shootout</b><span>both-QB max ${pct(o.shootout.both_qbs_share_max)} · K ${range(p.k_share.shootout)} · DST ${range(p.dst_share.shootout)} · TE-CPT +${pct(o.shootout.te_cpt_bonus)} · RB-CPT −${pct(o.shootout.rb_cpt_penalty)}</span></span>`);
    if (d.ov.grind) adj.push(`<span class="sd-ovl-banner"><b>F · Grind</b><span>K ${range(p.k_share.grind)} · DST ${range(p.dst_share.grind)} · both-QB max ${pct(o.grind.both_qbs_share_max)} · RB-CPT +${pct(o.grind.rb_cpt_bonus)} · QB-CPT −${pct(o.grind.qb_cpt_penalty)}</span></span>`);
    if (d.ov.dome) adj.push(`<span class="sd-ovl-banner"><b>Dome</b><span>TE-CPT −${pct(o.dome.te_cpt_penalty)} · K share +${pct(o.dome.k_share_bump)}</span></span>`);
    if (d.ov.wind) adj.push(`<span class="sd-ovl-banner"><b>Wind ≥15</b><span>QB-CPT −${pct(o.wind.qb_cpt_penalty)} · DST share → grind</span></span>`);
    $id('sdAlloc').innerHTML = `
      <div class="card-title">Allocation · <span class="card-title-accent">${esc(d.spreadBucket.label)}${lean && lean.script ? ` · lean ${lean.label.toLowerCase()} → ${lean.script}` : ''}</span></div>
      ${hbar('alloc', segs.map(x => ({ ...x, k: x.label })), { tall: true, aria: `Allocation: ${segs.map(s => `${s.label} ${Math.round(s.value)}%`).join(', ')}` })}
      <div class="sd-legend">${['A', 'B', 'C', 'D'].map((k, i) => `<span><i class="${SEG[i]}"></i>${k} · ${esc(names[k])} ${Math.round(a[k])}%</span>`).join('')}</div>
      <div class="sd-counts"><span>${state.entries} lineup${state.entries === 1 ? '' : 's'} →</span>${['A', 'B', 'C', 'D'].map(k => `<span class="chip sd-count-chip${counts[k] > 0 ? ' active' : ''}">${FX.num('cnt.' + k, counts[k], 0)} ${k}</span>`).join('')}</div>
      ${adj.length ? `<div class="sd-overlay-adj">${adj.join('')}</div>` : ''}
      <div class="sd-caption">Base shares from the codex allocation table for this spread bucket${lean && lean.script ? ` · lean moved ${LEAN_PTS} pts from ${lean.from.join('+')} into ${lean.script}` : ''} · counts by largest remainder · overlay values untouched by the lean</div>`;
    return counts;
  };

  const tmplChips = key => {
    const t = data.captain_templates[key]; if (!t) return '';
    return `<div class="sd-tmpl"><span class="sd-tmpl-k">${key}</span>
      ${t.include.map(x => `<span class="sd-chip-ok">✓ ${esc(chipLabel(x))}</span>`).join('')}
      ${t.avoid.map(x => `<span class="sd-chip-no">✗ ${esc(chipLabel(x))}</span>`).join('')}
      ${t.shapes.map(x => `<span class="sd-chip-n">${esc(x)}</span>`).join('')}
      <span class="sd-chip-n">K ${pct(t.k_rate)}</span><span class="sd-chip-n">DST ${pct(t.dst_rate)}</span></div>`;
  };
  // " · 2026: 1 agrees · 1 watch" after a template's name — the 2026 check tally; the template itself is historical.
  const tmplTally = (key, t) => {
    const rs = [...t.include.map(x => tmplRuleId(key, 'inc', x)), ...t.avoid.map(x => tmplRuleId(key, 'avd', x)), tmplRuleId(key, 'shape')].map(id => ruleById(data, id)).filter(Boolean);
    const c = k => rs.filter(r => checkOf(r) === k).length;
    const parts = ['agrees', 'watch'].filter(k => c(k)).map(k => `${c(k)} ${CHECK[k].word}`);
    return rs.length ? ` · <span class="sd-tmpl-tally">2026 check: ${parts.length ? parts.join(' · ') : 'nothing settled yet'} of ${rs.length} items</span>` : '';
  };
  const renderRecipes = (d, counts) => {
    const ar = data.archetypes, p = data.portfolio, o = data.overlays;
    const odds = scriptOdds(data.base_rates.by_spread[d.sb]);
    const cards = ['A', 'B', 'C', 'D'].filter(k => d.alloc[k] > 0).map(k => {
      const a = ar[k], m = SCRIPT_META[k];
      const banners = [];
      if (d.ov.shootout) banners.push(`<div class="sd-ovl-banner"><b>E · Shootout</b><span>${esc(ar.E.overlay)} · captains ${esc(ar.E.captain)} · shape ${ar.E.shape.join('/')}</span></div>`);
      if (d.ov.grind) banners.push(`<div class="sd-ovl-banner"><b>F · Grind</b><span>${esc(ar.F.overlay)} · captain ${esc(ar.F.captain)} · shape ${ar.F.shape.join('/')}</span></div>`);
      const kDial = d.ov.grind ? p.k_share.grind : d.ov.shootout ? p.k_share.shootout : null;
      const dDial = (d.ov.grind || d.ov.wind) ? p.dst_share.grind : d.ov.shootout ? p.dst_share.shootout : null;
      const t = data.captain_templates[m.tmpl];
      const open = FOLDS() ? FOLDS().isOpen('recipe-' + k, counts[k] > 0) : true;
      return `<details class="card sd-recipe" data-script="${k}" data-fold-id="recipe-${k}"${open ? ' open' : ''}>
        <summary class="sd-recipe-head">
          <span class="sd-script-badge sd-script-badge-lbl" aria-label="Script ${k}"><small>Script</small>${k}</span>
          <div class="sd-recipe-title"><div class="sd-recipe-name">${esc(a.name)}</div><div class="sd-recipe-trig">fires: ${esc(a.trigger)}</div></div>
          <div class="sd-recipe-count">${FX.num('rc.' + k, counts[k], 0)}<small>of ${state.entries} lineup${state.entries === 1 ? '' : 's'}</small></div>
          <span class="sd-fold-chev" aria-hidden="true"></span>
        </summary>
        <div class="sd-recipe-body">
        <div class="sd-recipe-odds">
          <div class="sd-odd"><span class="sd-odd-k">Batch share</span><span class="bar"><span class="bar-fill" data-m="rb.${k}" style="width:${d.alloc[k]}%"></span></span><b>${FX.num('rbv.' + k, Math.round(d.alloc[k]), 0, { post: '%' })}</b></div>
          <div class="sd-odd"><span class="sd-odd-k">Happens</span><span class="bar"><span class="bar-fill dim" data-m="ro.${k}" style="width:${odds[k]}%"></span></span><b>${FX.num('rov.' + k, Math.round(odds[k]), 0, { post: '%' })}</b><span class="sd-odd-n">of ${esc(d.spreadBucket.label.toLowerCase())} games</span></div>
        </div>
        <div class="sd-recipe-cpt"><small>Captain</small>${esc(withNames(d.preset, a.captain))}</div>
        <div class="sd-recipe-stats">
          <div class="sd-stat-tile"><span class="sd-stat-k">Shape</span><div class="sd-tmpl">${a.shape.map(x => `<span class="sd-chip-n">${esc(x)}</span>`).join('')}</div></div>
          <div class="sd-stat-tile"><span class="sd-stat-k">Kicker</span><b class="sd-stat-v">${a.k}%</b><span class="bar"><span class="bar-fill" style="width:${a.k}%"></span></span><span class="sd-stat-n">of these winners${kDial ? ` · dial ${range(kDial)}` : ''}</span></div>
          <div class="sd-stat-tile"><span class="sd-stat-k">DST</span><b class="sd-stat-v">${a.dst}%</b><span class="bar"><span class="bar-fill" style="width:${a.dst}%"></span></span><span class="sd-stat-n">of these winners${dDial ? ` · dial ${range(dDial)}` : ''}</span></div>
        </div>
        <div class="sd-recipe-rows">
          <div class="sd-rrow"><span class="sd-rrow-k">Flex</span><span class="sd-rrow-v"><span class="sd-tmpl">${flexChips(a.flex).map(x => `<span class="sd-chip-n">${esc(withNames(d.preset, x))}</span>`).join('')}</span>${flexNotes(a.flex).length ? `<span class="sd-rrow-note">${esc(flexNotes(a.flex).join(' · '))}</span>` : ''}</span></div>
          <div class="sd-rrow"><span class="sd-rrow-k">Bring-back</span><span class="sd-rrow-v">${esc(withNames(d.preset, m.bring))}</span></div>
        </div>
        <div class="sd-say">Captain ${esc(m.seat)} wins because ${esc(m.because)}; the flex is ${esc(a.flex.split(';')[0])}; the bring-back is ${esc(m.bring.split(' — ')[0].split(' (')[0])}.</div>
        ${banners.join('')}
        ${t ? `<details class="sd-fold"><summary>Captain template ${m.tmpl} · ${t.include.length} include · ${t.avoid.length} avoid${tmplTally(m.tmpl, t)} <span class="sd-fold-arrow">▸</span></summary><div class="sd-tmpl-groups">
          <div class="sd-tmpl-group"><span class="sd-tmpl-k">include</span><div class="sd-tmpl">${t.include.map(x => `<span class="sd-chip-ok">✓ ${esc(chipLabel(x))}${vBadge(data, ruleById(data, tmplRuleId(m.tmpl, 'inc', x)), { mini: true })}</span>`).join('')}</div></div>
          <div class="sd-tmpl-group"><span class="sd-tmpl-k">avoid</span><div class="sd-tmpl">${t.avoid.map(x => `<span class="sd-chip-no">✗ ${esc(chipLabel(x))}${vBadge(data, ruleById(data, tmplRuleId(m.tmpl, 'avd', x)), { mini: true })}</span>`).join('')}</div></div>
          <div class="sd-tmpl-group"><span class="sd-tmpl-k">template rates</span><div class="sd-tmpl">${t.shapes.map(x => `<span class="sd-chip-n">${esc(x)}</span>`).join('')}${vBadge(data, ruleById(data, tmplRuleId(m.tmpl, 'shape')), { mini: true })}<span class="sd-chip-n">K ${pct(t.k_rate)}</span><span class="sd-chip-n">DST ${pct(t.dst_rate)}</span></div></div>
          <div class="sd-caption">Template = the historical winners with this captain type. Square = its 2026 check: ${checkLegend()} · hover for the history and the slates</div>
        </div></details>` : ''}
        </div>
      </details>`;
    });
    $id('sdRecipes').innerHTML = `<div class="sd-recipes">${cards.join('')}</div>
      <div class="sd-caption" style="margin-top:8px">Recipes from the codex archetypes A–D · "happens" = how often the script occurs at this spread (2,761 games) · include/avoid chips are captain-template winner rates · E/F overlays banner the cards they modify</div>`;
  };

  const renderDials = d => {
    const bar = r => r.bar ? `<span class="sd-dial-bar" aria-hidden="true"><i data-m="dial.${esc(r.k)}" style="left:${Math.round(r.bar[0] * 100)}%;width:${Math.max(2, Math.round((r.bar[1] - r.bar[0]) * 100))}%"></i></span>` : '';
    $id('sdDials').innerHTML = `
      <div class="card-title">Dials · <span class="card-title-accent">enter these in the Contest Generator</span></div>
      <table class="sd-dials"><thead><tr><th>Dial</th><th>Target</th><th>Why</th></tr></thead><tbody>
        ${d.dials.rows.map(r => `<tr><td>${esc(r.k)}</td><td class="v${r.adj ? ' adj' : ''}">${esc(r.v)}${bar(r)}</td><td>${esc(r.note || '')}</td></tr>`).join('')}
      </tbody></table>
      <div class="sd-caption">portfolio dials from rules.json v1.2 · gold = overlay-adjusted for this slate · bars show the target band on a 0–100% scale</div>`;
  };

  const renderVerdict = (d, counts) => {
    const ct = data.inputs.contest_types.find(c => c.key === state.contest);
    const ovs = Object.keys(d.ov).filter(k => d.ov[k]).map(k => k[0].toUpperCase() + k.slice(1));
    const dial = k => d.dials.rows.find(r => r.k === k);
    const scripts = ['A', 'B', 'C', 'D'].filter(k => counts[k] > 0).map(k => `${counts[k]}×${k}`).join(' · ') || `A ${Math.round(d.alloc.A)}%`;
    $id('sdVerdict').innerHTML = `
      <div class="card-title card-title-accent">The play · one glance</div>
      <div class="sd-verdict">
        <div class="sd-vd"><span>Captain</span><b>${esc(seatName(d.preset, d.shortlist[0].seat) || d.shortlist[0].seat)}</b><small>${seatName(d.preset, d.shortlist[0].seat) ? esc(d.shortlist[0].seat) + ' · ' : ''}then ${esc(seatName(d.preset, d.shortlist[1].seat) || d.shortlist[1].seat)}</small></div>
        <div class="sd-vd"><span>Batch</span><b>${scripts}</b><small>${state.entries} lineup${state.entries === 1 ? '' : 's'} · A ${Math.round(d.alloc.A)} / B ${Math.round(d.alloc.B)} / C ${Math.round(d.alloc.C)} / D ${Math.round(d.alloc.D)}</small></div>
        <div class="sd-vd"><span>Kicker · DST</span><b>${esc(dial('K share').v)} · ${esc(dial('DST share').v)}</b><small>share of the batch</small></div>
        <div class="sd-vd"><span>Both QBs</span><b>≤ ${esc(dial('Both-QB max').v)}</b><small>${ovs.length ? ovs.join(' + ') + ' overlay' : 'no overlay'}</small></div>
        <div class="sd-vd"><span>Ownership</span><b>${esc(ct.own_target)}</b><small>dupes ≤ ${ct.dupe_cap} · ${esc(CONTEST_SHORT[state.contest])}</small></div>
      </div>`;
  };

  const renderLaws = d => {
    const pinned = data.ten_laws.filter(l => d.laws.has(l.n)), rest = data.ten_laws.filter(l => !d.laws.has(l.n));
    const law = (l, open) => { const lv = lawVerdict(data, l.n);
      return `<details class="sd-law${open ? ' pinned' : ''}" ${open ? 'open' : ''}><summary><span class="no">${l.n}</span><span class="sd-law-txt">${esc(l.law)}<small class="sd-law-chk">${lv.rules.length ? lawBadge(data, lv) : vBadge(data, null)}</small></span></summary><p>${esc(l.evidence)}</p>
        ${lv.rules.length ? `<div class="sd-law-tests">${lv.rules.map(r => `<div><span>${esc(r.label)}<small class="sd-hist">${esc(histText(data, r))}</small><small>${vBadge(data, r, { mini: true })} ${esc(checkText(data, r))}</small></span></div>`).join('')}</div>` : '<p class="sd-law-untested">No 2026 field check for this law yet: it rests on the 120-winner study, as every rule does.</p>'}</details>`; };
    $id('sdLaws').innerHTML = `
      <div class="card-title">Ten laws · <span class="card-title-accent">${pinned.map(l => l.n).join(', ')} pinned for this cell</span></div>
      <div class="sd-laws">${pinned.map(l => law(l, true)).join('')}</div>
      <details class="sd-fold"><summary>The other ${rest.length} laws <span class="sd-fold-arrow">▸</span></summary><div class="sd-laws" style="margin-top:8px">${rest.map(l => law(l, false)).join('')}</div></details>
      <div class="sd-caption">Each law is the historical winners' (evidence under it). The small line is its 2026 check over ${(data.field_archive || {}).n_slates || 0} primetime slates: ${checkLegend()}. Open a law for the history and the check per test.</div>`;
  };

  /* ---------- Step 4: ship it ---------- */
  const renderFit = d => {
    const ct = data.inputs.contest_types.find(c => c.key === state.contest);
    // The Power Sweep / Spy small-field study is a DK CLASSIC main-slate study: it lives on the Classic page, not here.
    const small = '';
    $id('sdFit').innerHTML = `
      <div class="card-title">Contest fit · <span class="card-title-accent">${esc(ct.label)}</span></div>
      <div class="sd-fit-row">
        <div class="sd-fit-big">${esc(ct.own_target)}<small>cumulative ownership target</small></div>
        <div class="sd-fit-big">≤ ${ct.dupe_cap}<small>dupe gate</small></div>
      </div>
      ${ct.note && !/Spy|Power Sweep/.test(ct.note) ? `<p class="sd-lede">${esc(ct.note)}</p>` : ''}
      ${small}
      <div class="sd-caption">contest fit from the codex contest table · dupes: ${esc(data.ten_laws[9].evidence)}</div>`;
  };

  // Score you need: cut ladder by field size (cut_lines). Follows the Step 1 contest unless a bucket is picked here.
  const renderCuts = () => {
    const host = $id('sdCuts'); if (!host) return;
    const cuts = data.cut_lines || [];
    if (!cuts.length) { host.hidden = true; return; }
    host.hidden = false;
    const tier = state.cutTier === 'sunday' ? 'sunday' : 'primetime';
    const key = state.cutKey || state.contest, L = cutLadder(cuts.filter(c => (c.tier || 'primetime') === tier), key);
    const fa = data.field_archive || {};
    const labels = Object.fromEntries([...(fa.slates || []), ...((fa.sunday || {}).slates || [])].map(s => [s.id, s.label]));
    const small = L.slates.length < 3;
    const top1 = L.tiers.find(t => t.key === 'cut_top1');
    const body = !L.contests ? `<p class="sd-lede">No archived contest of this size yet.</p>` : `
      <div class="sd-cuts">${L.tiers.map(t => `
        <div class="sd-cut${t.key === 'cut_top1' ? ' hl' : ''}">
          <span class="sd-cut-k">${esc(t.label)}${t.key === 'min_cash_score' && L.cashPct != null ? `<small>top ~${Math.round(L.cashPct)}% paid</small>` : ''}</span>
          <span class="sd-cut-bar"><span class="bar"><span class="bar-fill" data-m="cut.${t.key}" style="width:${t.ratio != null ? Math.min(100, t.ratio).toFixed(1) : 0}%"></span></span></span>
          <span class="sd-cut-v"><b>${t.ratio != null ? FX.num('cut.' + t.key + '.r', t.ratio, 0, { post: '%' }) : '—'}</b><small>of winner</small></span>
          <span class="sd-cut-pts">${L.slates.map((s, i) => `<span>${esc(labels[s] || s)} <b>${t.bySlate[i] != null ? t.bySlate[i].toFixed(1) : '—'}</b></span>`).join('')}</span>
        </div>`).join('')}</div>`;
    ANS('cuts', top1 && top1.min != null ? `Top-1% cut ran <b>${top1.min.toFixed(1)}–${top1.max.toFixed(1)}</b> pts in ${esc(CONTEST_SHORT[key] || key)} ${tier} fields · <span class="n">${L.contests} contest${L.contests === 1 ? '' : 's'}</span>` : `No archived ${esc(CONTEST_SHORT[key] || key)} ${tier} contest yet`);
    host.innerHTML = `
      <div class="sd-winners-head"><div class="card-title">Score you need · <span class="card-title-accent">${esc(CONTEST_SHORT[key] || key)} fields</span></div>
        <div class="seg" role="tablist" aria-label="Field size">${Object.keys(CONTEST_SHORT).map(k => `<button type="button" role="tab" data-cut="${k}" class="${k === key ? 'active' : ''}" aria-selected="${k === key}">${esc(CONTEST_SHORT[k])}</button>`).join('')}</div>
        <div class="seg" role="tablist" aria-label="Slate tier"><button type="button" role="tab" data-cut-tier="primetime" class="${tier === 'primetime' ? 'active' : ''}" aria-selected="${tier === 'primetime'}">Primetime</button><button type="button" role="tab" data-cut-tier="sunday" class="${tier === 'sunday' ? 'active' : ''}" aria-selected="${tier === 'sunday'}">Sunday (supporting)</button></div></div>
      <p class="sd-lede">What past DK showdown contests of this size took to finish in each tier. The points move with the game${top1 && top1.min != null ? ` (the top-1% cut ran ${top1.min.toFixed(1)}–${top1.max.toFixed(1)} here)` : ''}, so the number that travels is the <strong>share of the winning score</strong>; the points per slate are below each bar.</p>
      ${body}
      <div class="sd-caption"><span class="n${small ? ' small' : ''}">n = ${L.contests} contest${L.contests === 1 ? '' : 's'} · ${L.slates.length} slate${L.slates.length === 1 ? '' : 's'}${small ? ' · small sample' : ''}</span>${L.field ? ` · fields ${L.field[0].toLocaleString('en-US')}–${L.field[1].toLocaleString('en-US')}` : ''} · % = median of cut ÷ winner score across contests · points = median per slate · min cash = lowest paid score (DK entry history) · cut_lines from the contest archive</div>`;
  };

  const renderCheck = () => {
    const h = data.hard_rules, s = data.soft_penalties;
    const items = Object.keys(h).filter(k => !k.startsWith('_')).map(k => ({ k, label: (HARD_LABELS[k] || (v => `${humanize(k)}: ${v}`))(h[k]) }));
    const soft = Object.keys(s).filter(k => !k.startsWith('_')).map(k => { const v = s[k]; const pen = typeof v === 'object' ? v.penalty : v; return `<span class="sd-chip-n" title="${esc(k)}">${esc(humanize(k))}${pen != null ? ` −${pen}` : ''}</span>`; });
    $id('sdCheck').innerHTML = `
      <div class="card-title">The engine's rules · <span class="card-title-accent">${items.length} hard · ${soft.length} soft</span></div>
      <p class="sd-lede">The Lineup Lab runs every one of these on your lineup automatically — <a href="nfl/showdown/#step4" data-jump="step4" class="sd-link">score a lineup ↑</a>. Here they are as a reference.</p>
      <details class="sd-fold"><summary>The ${items.length} hard rules (a break = rejected) <span class="sd-fold-arrow">▸</span></summary>
      <div class="sd-ref" style="margin-top:8px">${items.map(i => `<div><span>${esc(i.label)}</span><small>${esc(i.k)}</small></div>`).join('')}</div></details>
      <details class="sd-fold"><summary>The engine would frown at · ${soft.length} soft penalties <span class="sd-fold-arrow">▸</span></summary>
      <div class="sd-frown" style="margin-top:8px">${soft.join('')}</div></details>
      <div class="sd-caption">hard_rules + soft_penalties from rules.json ${esc((data.engine && data.engine.rules_version || 'v1.2').split(' ')[0])} · a soft penalty is subtracted from the lineup score (1.0 ≈ one sim-rank bucket)</div>`;
  };

  const renderLessons = () => {
    $id('sdLessons').innerHTML = `
      <div class="card-title">What 2026 taught us</div>
      <div class="sd-lessons">${data.lessons_2026.map(l => `<div class="sd-lesson"><b>${esc(l.slate)}</b>${esc(l.lesson)}</div>`).join('')}</div>`;
  };

  /* ---------- Export text ---------- */
  const playbookText = d => {
    const b = data.base_rates.by_spread[d.sb], t = data.base_rates.by_total[d.tb];
    const counts = largestRemainder(d.alloc, state.entries);
    const ct = data.inputs.contest_types.find(c => c.key === state.contest);
    const ovs = Object.keys(d.ov).filter(k => d.ov[k]).map(k => k.toUpperCase()).join(' + ') || 'none';
    const sk = expectedSpreadRow(d.sb), sr = data.winners_by_expected_script[sk];
    const L = [];
    L.push(`BIRDIEBUDDY SHOWDOWN PLAYBOOK — ${spreadLabel(state.spread, d.preset && d.preset.fav)} · ${num(state.total)} · ${ENV_LABEL[state.env]} · ${ct.label} · ${state.entries} entr${state.entries === 1 ? 'y' : 'ies'}`);
    L.push(`data ${data.meta.version}`);
    L.push('');
    L.push(`READ THE GAME (${d.spreadBucket.label} / ${d.totalBucket.label})`);
    L.push(`  Script: blowout ${b.blowout14}% · fav controls ${b.fav_wins - b.blowout14}% · within 3 ${b.within3}% · dog wins ${b.dog_wins}%  (2,761 games)`);
    L.push(`  Total: mean ${t.mean_actual} · over 7+ ${t.over7}% · under 7+ ${t.under7}% · P(≥55) ${t.ge55}% · P(≤37) ${t.le37}%`);
    L.push(`  Overlay: ${ovs}${state.lean !== 'none' ? ` · lean ${state.lean} (reallocates only)` : ''}`);
    L.push(`  Winners (${sk}, n=${sr.n}): CPT fav ${sr.cpt_fav}% · WR ${sr.cpt_pos.WR}/RB ${sr.cpt_pos.RB}/QB ${sr.cpt_pos.QB}/TE ${sr.cpt_pos.TE} · 5-1 ${sr.five_one_fav}% 4-2 ${sr.four_two}% 3-3 ${sr.three_three}% · K ${sr.K}% DST ${sr.DST}% both-QB ${sr.both_qb}%`);
    L.push(`  Cheat-sheet cell ${d.cell.row} × ${d.cell.col}: ${POS.map(p => `${p} ${d.cellData[p]}`).join(' · ')} · fav ${d.cellData.fav}% · K ${d.cellData.K}%`);
    L.push('');
    L.push('BUILD IT');
    L.push(`  Captain shortlist: ${d.shortlist.map((s, i) => `${i + 1}. ${s.seat} (≈${Math.round(s.weight)}%)`).join(' · ')}`);
    L.push(`  Never: dog pocket QB at +3.5 or more · K · DST`);
    L.push(`  Allocation: ${['A', 'B', 'C', 'D'].map(k => `${k} ${Math.round(d.alloc[k])}%`).join(' / ')} → ${state.entries} lineup${state.entries === 1 ? '' : 's'} = ${['A', 'B', 'C', 'D'].map(k => `${counts[k]} ${k}`).join(' · ')}`);
    ['A', 'B', 'C', 'D'].filter(k => d.alloc[k] > 0).forEach(k => { const a = data.archetypes[k], m = SCRIPT_META[k];
      L.push(`  [${k}] ${a.name} — captain ${a.captain}; shape ${a.shape.join('/')}; flex: ${a.flex}; K ${a.k}% DST ${a.dst}%`);
      L.push(`      "Captain ${m.seat} wins because ${m.because}; the flex is ${a.flex.split(';')[0]}; the bring-back is ${m.bring}."`); });
    if (d.ov.shootout) L.push(`  E overlay: ${data.archetypes.E.overlay}`);
    if (d.ov.grind) L.push(`  F overlay: ${data.archetypes.F.overlay}`);
    L.push('');
    L.push('DIALS');
    d.dials.rows.forEach(r => L.push(`  ${r.k}: ${r.v}${r.note ? `  (${r.note})` : ''}`));
    L.push('');
    L.push('SHIP IT');
    L.push(`  Ownership target ${ct.own_target} · dupes ≤ ${ct.dupe_cap}${ct.note ? ` · ${ct.note}` : ''}`);
    L.push(`  Laws pinned: ${[...d.laws].sort((a, b) => a - b).map(n => `${n}. ${data.ten_laws[n - 1].law} [field: ${VERDICT[lawVerdict(data, n).verdict].word}]`).join(' | ')}`);
    return L.join('\n');
  };
  const stokasticText = d => {
    const L = [`# Stokastic Contest Generator — ${spreadLabel(state.spread, d.preset && d.preset.fav)} · ${num(state.total)} · ${ENV_LABEL[state.env]} · ${state.entries} lineups`];
    d.dials.rows.forEach(r => L.push(`${r.k.padEnd(30)} ${r.v}`));
    const counts = largestRemainder(d.alloc, state.entries);
    L.push(`${'Script counts'.padEnd(30)} ${['A', 'B', 'C', 'D'].map(k => `${k}:${counts[k]}`).join(' ')}`);
    L.push(`${'Captain shortlist'.padEnd(30)} ${d.shortlist.map(s => s.seat).join(', ')}`);
    L.push(`${'Never captain'.padEnd(30)} dog pocket QB (+3.5 or more), K, DST`);
    return L.join('\n');
  };
  const clip = async text => {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {}
    if (!ok) { try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch {} }
    return ok;
  };
  const copy = async (text, btn) => {
    const ok = await clip(text);
    const old = btn.textContent; btn.textContent = ok ? 'Copied ✓' : 'Copy failed'; setTimeout(() => { btn.textContent = old; }, 1600);
  };

  /* ---------- shareable link (URL state) ---------- */
  // The Lab (showdown_lab.js) reports its pool + lineup tokens; before it boots, the slate is the preset.
  const urlState = () => {
    const li = window.BBI.showdownLab && window.BBI.showdownLab.urlInfo ? window.BBI.showdownLab.urlInfo() : null;
    return { slate: li ? li.slate || state.preset : state.preset || urlIn.slate, spread: state.spread, total: state.total, env: state.env, contest: state.contest, entries: state.entries, lu: li ? li.lu : urlIn.lu };
  };
  const cleanHash = () => (location.hash || '').replace(/\?.*$/, '');
  const shareUrl = hash => `${location.origin}${location.pathname}?${urlSerialize(urlState())}${hash == null ? cleanHash() : hash}`;
  // Written only once the reader has touched something (or arrived on a link), so a
  // plain visit keeps a plain URL. Debounced: sliders re-render every frame.
  let urlArmed = false, urlT = 0;
  const syncUrl = () => {
    if (!urlArmed || !data) return;
    clearTimeout(urlT);
    urlT = setTimeout(() => { try { history.replaceState(history.state, '', shareUrl()); } catch {} }, 300);
  };
  const copyLink = async (hash, btn) => {
    const u = urlState(), ok = await clip(shareUrl(hash));
    track('share_link_copy', { ok, lineup: !!u.lu, target: hash || 'page', preset: !!state.preset });
    if (btn && btn.dataset.copyLink != null && btn.textContent.trim()) { const old = btn.textContent; btn.textContent = ok ? 'Link copied ✓' : 'Copy failed'; setTimeout(() => { btn.textContent = old; }, 1600); }
    const pre = slates.find(x => x.id === state.preset);
    toast(ok ? `<b>Link copied</b> — opens ${pre ? esc(pre.label) + ' · ' : ''}${esc(spreadLabel(state.spread, pre && pre.fav))} · ${num(state.total)}${u.lu ? ' with this lineup in the Lab' : ''}` : 'Copy failed — your browser blocked the clipboard', ok ? '' : 'warn');
  };
  // Play card image: verdict strip + one block per script, drawn on a canvas (no library).
  // With a complete Lab lineup, a lineup panel (six slots, codex ring, verdict, script,
  // top 3 report lines) sits between the strip and the script cards.
  const playCardPng = async d => {
    const counts = largestRemainder(d.alloc, state.entries);
    const ct = data.inputs.contest_types.find(c => c.key === state.contest);
    const r = gameRead(d);
    const scripts = hasPro() ? ['A', 'B', 'C', 'D'].filter(k => d.alloc[k] > 0) : [];   // the recipe cards are Pro
    const lu = window.BBI.showdownLab && window.BBI.showdownLab.cardData ? window.BBI.showdownLab.cardData() : null;
    const LP_H = 318, lpOff = lu ? LP_H + 24 : 0;
    const W = 1200, S = 2, pad = 48, colW = (W - pad * 2 - 24) / 2;
    const rows = Math.ceil(scripts.length / 2), cardH = 272, H = 330 + lpOff + rows * (cardH + 24) + 70;
    const cv = document.createElement('canvas'); cv.width = W * S; cv.height = H * S;
    const g = cv.getContext('2d'); g.scale(S, S);
    try { await document.fonts.ready; } catch {}
    const mono = "'JetBrains Mono', Menlo, monospace", sans = "'Inter', -apple-system, Helvetica, sans-serif";
    const gold = '#d4a843', ink = '#f4f4f8', muted = '#8a8a98', dim = '#5a5a68';
    const rr = (x, y, w, h, rad, fill, stroke) => { g.beginPath(); g.roundRect(x, y, w, h, rad); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); } };
    const txt = (t, x, y, opt = {}) => { g.font = `${opt.weight || 400} ${opt.size || 14}px ${opt.font || sans}`; g.fillStyle = opt.color || ink; g.textAlign = opt.align || 'left'; g.fillText(String(t), x, y); };
    const wrap = (t, x, y, maxW, lh, opt = {}) => { g.font = `${opt.weight || 400} ${opt.size || 13}px ${opt.font || sans}`; const words = String(t).split(' '); let line = '', yy = y, n = 0;
      for (const w of words) { const test = line ? line + ' ' + w : w; if (g.measureText(test).width > maxW && line) { txt(line, x, yy, opt); line = w; yy += lh; n++; if (opt.max && n >= opt.max) return yy; } else line = test; }
      if (line) txt(line, x, yy, opt); return yy + lh; };
    const bar = (x, y, w, v, color) => { rr(x, y, w, 6, 3, '#101017'); rr(x, y, Math.max(6, w * Math.min(1, v)), 6, 3, color || gold); };
    g.fillStyle = '#0a0a0f'; g.fillRect(0, 0, W, H);
    txt('BIRDIEBUDDY NFL · SHOWDOWN PLAYBOOK', pad, 46, { font: mono, size: 12, color: gold });
    txt(`${spreadLabel(state.spread, d.preset && d.preset.fav)}${d.preset ? `  ·  ${d.preset.label}` : ''}  ·  ${num(state.total)}  ·  ${ENV_LABEL[state.env]}  ·  ${ct.label}  ·  ${state.entries} entr${state.entries === 1 ? 'y' : 'ies'}`, pad, 84, { size: 26, weight: 800 });
    txt(`${r.script} game (${r.scriptPct}%) · ${r.mean} mean points · ${r.ovs.length ? r.ovs.join(' + ') + ' overlay' : 'no overlay'}`, pad, 112, { size: 15, color: muted });
    // verdict tiles
    const tiles = [['CAPTAIN', seatName(d.preset, d.shortlist[0].seat) || d.shortlist[0].seat, `then ${seatName(d.preset, d.shortlist[1].seat) || d.shortlist[1].seat}`],
      ['BATCH', scripts.map(k => `${counts[k]}×${k}`).join(' · '), `A ${Math.round(d.alloc.A)} / B ${Math.round(d.alloc.B)} / C ${Math.round(d.alloc.C)} / D ${Math.round(d.alloc.D)}`],
      ['KICKER · DST', `${d.dials.rows[0].v} · ${d.dials.rows[1].v}`, 'share of the batch'],
      ['BOTH QBS', `≤ ${d.dials.rows[2].v}`, r.ovs.length ? r.ovs.join(' + ') : 'portfolio default'],
      ['OWNERSHIP', ct.own_target, `dupes ≤ ${ct.dupe_cap}`]];
    const tw = (W - pad * 2 - 4 * 12) / 5;
    tiles.forEach((t, i) => { const x = pad + i * (tw + 12); rr(x, 140, tw, 110, 10, '#101017', 'rgba(212,168,67,0.3)');
      txt(t[0], x + 14, 166, { font: mono, size: 10, color: dim }); wrap(t[1], x + 14, 196, tw - 28, 24, { size: 20, weight: 700, max: 2 }); txt(t[2], x + 14, 236, { font: mono, size: 10.5, color: muted }); });
    if (lu) lineupPanel(g, { rr, txt, wrap, pad, y: 290, w: W - pad * 2, h: LP_H, mono, sans, gold, ink, muted, dim }, lu);
    // script cards
    scripts.forEach((k, i) => { const a = data.archetypes[k], m = SCRIPT_META[k]; const x = pad + (i % 2) * (colW + 24), y = 290 + lpOff + Math.floor(i / 2) * (cardH + 24);
      rr(x, y, colW, cardH, 12, '#141419', 'rgba(255,255,255,0.08)');
      rr(x + 18, y + 18, 34, 34, 8, gold); txt(k, x + 35, y + 42, { font: mono, size: 18, weight: 700, color: '#1a1408', align: 'center' });
      txt(a.name, x + 64, y + 34, { size: 17, weight: 700 }); txt(`${counts[k]} of ${state.entries} lineup${state.entries === 1 ? '' : 's'}`, x + 64, y + 52, { font: mono, size: 11, color: muted });
      txt(`${Math.round(d.alloc[k])}%`, x + colW - 18, y + 40, { font: mono, size: 22, weight: 700, color: gold, align: 'right' });
      txt('CAPTAIN', x + 18, y + 84, { font: mono, size: 10, color: dim }); wrap(withNames(d.preset, a.captain), x + 18, y + 104, colW - 36, 20, { size: 15, weight: 700, max: 2 });
      txt('FLEX', x + 18, y + 148, { font: mono, size: 10, color: dim }); wrap(flexChips(a.flex).map(c => withNames(d.preset, c)).join('  ·  '), x + 18, y + 166, colW - 36, 17, { size: 13, color: ink, max: 2 });
      txt(`K ${a.k}%`, x + 18, y + 214, { font: mono, size: 11, color: muted }); bar(x + 66, y + 208, 110, a.k / 100);
      txt(`DST ${a.dst}%`, x + 200, y + 214, { font: mono, size: 11, color: muted }); bar(x + 258, y + 208, 110, a.dst / 100);
      txt(`shape ${a.shape.join(' / ')}`, x + 18, y + 238, { font: mono, size: 11, color: muted });
      wrap(`Bring-back: ${withNames(d.preset, m.bring)}`, x + 18, y + 260, colW - 36, 15, { size: 11.5, color: muted, max: 1 }); });
    txt(`120 DK showdown winners 2018–25 · 2,761 games 2016–25 · data ${data.meta.version} · birdiebuddy.io/nfl/showdown`, pad, H - 28, { font: mono, size: 11, color: dim });
    return new Promise(res => cv.toBlob(res, 'image/png'));
  };
  // Lineup panel on the play card. lu = showdownLab.cardData(): {slots, score, legal, verdict, tag, scriptName, odds, plan, lines, pool, salary}.
  const lineupPanel = (g, k, lu) => {
    const { rr, txt, wrap, pad, y, w, h, mono, gold, ink, muted, dim } = k;
    const red = '#f87171', green = '#4ade80';
    const fit = (t, maxW, font) => { g.font = font; if (g.measureText(t).width <= maxW) return t; while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; };
    rr(pad, y, w, h, 12, '#141419', 'rgba(212,168,67,0.35)');
    txt('YOUR LINEUP · LINEUP LAB', pad + 22, y + 32, { font: mono, size: 11, color: gold });
    txt(`${lu.pool} · $${Math.round(lu.salary).toLocaleString('en-US')} of $50,000`, pad + w - 22, y + 32, { font: mono, size: 11, color: muted, align: 'right' });
    // codex score ring
    const cx = pad + 92, cy = y + 124, R = 52;
    g.lineWidth = 10; g.lineCap = 'round';
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.strokeStyle = '#23232c'; g.stroke();
    if (lu.score > 0) { g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(100, lu.score) / 100); g.strokeStyle = lu.legal ? gold : red; g.stroke(); }
    g.lineCap = 'butt';
    txt(lu.score, cx, cy + 10, { font: mono, size: 34, weight: 700, align: 'center', color: lu.legal ? ink : red });
    txt('codex score', cx, cy + 30, { font: mono, size: 9.5, color: dim, align: 'center' });
    // verdict + script
    const x0 = pad + 176;
    txt('VERDICT', x0, y + 72, { font: mono, size: 10, color: dim });
    txt(fit(lu.verdict.title, 340, `800 22px ${k.sans}`), x0, y + 100, { size: 22, weight: 800, color: lu.legal ? ink : red });
    wrap(lu.verdict.sub, x0, y + 124, 340, 17, { size: 13, color: muted, max: 2 });
    if (lu.tag) {
      rr(x0, y + 164, 30, 30, 7, gold); txt(lu.tag, x0 + 15, y + 185, { font: mono, size: 16, weight: 700, color: '#1a1408', align: 'center' });
      txt(lu.scriptName, x0 + 42, y + 177, { size: 15, weight: 700 });
      txt(`plays script ${lu.tag} · ${lu.odds}% at this spread · plan ${lu.plan}%`, x0 + 42, y + 194, { font: mono, size: 10.5, color: muted });
    }
    // six slots, 2 columns × 3 rows
    const sx0 = pad + 560, sw = (w - 560 - 22 - 12) / 2, sh = 50;
    lu.slots.forEach((p, i) => {
      const sx = sx0 + (i % 2) * (sw + 12), sy = y + 52 + Math.floor(i / 2) * (sh + 10);
      rr(sx, sy, sw, sh, 9, '#101017', p.cpt ? 'rgba(212,168,67,0.6)' : 'rgba(255,255,255,0.08)');
      txt(p.cpt ? 'CPT' : 'FLEX', sx + 12, sy + 19, { font: mono, size: 9, color: p.cpt ? gold : dim });
      rr(sx + 10, sy + 26, 36, 17, 4, '#1c1c24'); txt(p.pos, sx + 28, sy + 38.5, { font: mono, size: 10, weight: 600, color: muted, align: 'center' });
      txt(fit(p.name, sw - 58 - 74, `700 14px ${k.sans}`), sx + 58, sy + 23, { size: 14, weight: 700 });
      txt(`${p.team} · ${p.side}`, sx + 58, sy + 40, { font: mono, size: 10, color: dim });
      txt(`$${Math.round(p.sal).toLocaleString('en-US')}`, sx + sw - 12, sy + 23, { font: mono, size: 12, color: p.cpt ? gold : ink, align: 'right' });
      if (p.cpt) txt('1.5×', sx + sw - 12, sy + 40, { font: mono, size: 9.5, color: dim, align: 'right' });
    });
    // top 3 report lines
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(pad + 22, y + 236, w - 44, 1);
    txt('ENGINE REPORT · TOP 3', pad + 22, y + 258, { font: mono, size: 10, color: dim });
    const lw = (w - 44 - 32) / 3, ICON = { fail: ['✗', red], pen: ['−', muted], bonus: ['+', gold], pass: ['✓', green], info: ['·', muted] };
    lu.lines.slice(0, 3).forEach((l, i) => {
      const lx = pad + 22 + i * (lw + 16), [ic, col] = ICON[l.kind] || ICON.info;
      txt(ic, lx, y + 281, { font: mono, size: 13, weight: 700, color: col });
      wrap(l.text, lx + 18, y + 281, lw - 18, 16, { size: 12.5, color: l.kind === 'fail' ? red : ink, max: 2 });
    });
  };
  // mode: 'download' | 'copy' | 'lineup' (the Lab's share button: copy the image when the browser allows, and download it).
  const sharePng = async (mode, btn) => {
    const old = btn.textContent; btn.textContent = 'Rendering…';
    try {
      const blob = await playCardPng(derive());
      let copied = false;
      if (mode !== 'download' && navigator.clipboard && window.ClipboardItem) {
        try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); copied = true; } catch (e) { if (mode === 'copy') throw e; }
      }
      if (mode === 'copy' && copied) btn.textContent = 'Copied image ✓';
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `showdown-${mode === 'lineup' ? 'lineup' : 'playcard'}-${(state.preset || 'custom')}-${num(state.spread)}-${num(state.total)}.png`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); btn.textContent = copied ? 'Downloaded + copied ✓' : 'Downloaded ✓'; }
    } catch (e) { console.warn('[showdown] play card export failed', e); btn.textContent = 'Export failed'; }
    setTimeout(() => { btn.textContent = old; }, 1800);
  };

  const renderExport = () => {
    $id('sdExport').innerHTML = `
      <div class="card-title">Export</div>
      <div class="sd-export">
        <button type="button" class="btn btn-primary" data-copy="playbook">Copy playbook</button>
        <button type="button" class="btn" data-copy="stokastic">Copy Stokastic settings</button>
        <button type="button" class="btn" data-share="download">Download play card (PNG)</button>
        <button type="button" class="btn" data-share="copy">Copy play card image</button>
        <button type="button" class="btn btn-ghost" data-print>Print</button>
      </div>
      <div class="sd-caption">text = steps 2–4 for this slate · play card = the one-glance strip + the script cards as one image for Discord, plus your Lab lineup once it has all six · <button type="button" class="sd-link" data-copy-link="">copy a link to this slate</button></div>`;
  };

  /* ---------- fold summary lines (showdown_folds.js draws the folds) ---------- */
  const FOLDS = () => window.BBI.showdownFolds;
  const ANS = (k, html) => { if (FOLDS()) FOLDS().ans(k, html); };
  const DEEP_LINK = id => !!id && (/^step[1-6]$|^sdLabPro$/.test(id) || !!(document.getElementById(id) && document.getElementById(id).matches('details.sd-sec')));
  const lawShort = t => esc(String(t).split('. ')[0].replace(/\.$/, ''));
  const stepFourAns = () => {
    const s = labScore;
    ANS('step4', s && s.score != null ? `Lab lineup scores <b>${s.score}</b>${s.verdict ? ` · ${esc(s.verdict)}` : ''}${s.partial ? ' · partial' : ''}` : 'No Lab lineup yet · build one, or let <b>Build it for me</b> search the pool');
  };
  const renderAnswers = (d, counts) => {
    const r = gameRead(d), b = data.base_rates.by_spread[d.sb], t = data.base_rates.by_total[d.tb];
    const pre = d.preset;
    const lean = LEANS.find(l => l.key === state.lean);
    ANS('step1', `${pre ? `<b>${esc(pre.label)}</b> · ` : '<b>Custom line</b> · '}${esc(spreadLabel(state.spread, pre && pre.fav))} · ${num(state.total)} · ${esc(ENV_SHORT[state.env])} · ${esc(CONTEST_SHORT[state.contest])} · ${state.entries} ${state.entries === 1 ? 'entry' : 'entries'}${lean && lean.script ? ` · lean ${esc(lean.label.toLowerCase())}` : ''}`);
    const ov = r.ovs.length ? `<b>${esc(r.ovs.join(' + '))}</b> overlay` : 'no overlay';
    ANS('step2', `<b>${esc(r.script)} ${r.scriptPct}%</b> · ${esc(r.runner.toLowerCase())} ${r.runnerPct}% · total mean ${r.mean} · ${ov}`);
    ANS('read', `${esc(r.script)} game, ${r.scriptPct}% most likely · ${esc(r.runner.toLowerCase())} ${r.runnerPct}% next · ${r.mean} mean points`);
    ANS('overlay', r.ovs.length ? `<b>${esc(r.ovs.join(' + '))}</b> on · changes the dials and the recipes` : 'None · the base allocation applies');
    ANS('script', `Blowout ${b.blowout14}% · fav controls ${b.fav_wins - b.blowout14}% · dog wins ${b.dog_wins}% · within 3 ${b.within3}%${b.n ? ` · <span class="n">n = ${b.n.toLocaleString('en-US')}</span>` : ''}`);
    ANS('total', `Mean actual ${t.mean_actual} · over by 7+ ${t.over7}% · under by 7+ ${t.under7}%${t.n ? ` · <span class="n">n = ${t.n.toLocaleString('en-US')}</span>` : ''}`);
    const sr = data.winners_by_expected_script[expectedSpreadRow(d.sb)];
    if (sr) ANS('winners', `CPT fav ${sr.cpt_fav}% · 4-2 ${sr.four_two}% · 3-3 ${sr.three_three}% · K ${sr.K}% · both QBs ${sr.both_qb}% · <span class="n">n = ${sr.n}</span>`);
    const c = d.cellData;
    ANS('cheat', `Your cell: ${POS.map(p => `${p} ${c[p]}`).join(' · ')} · fav CPT ${c.fav}%`);
    const cap = x => esc(seatName(pre, x.seat) || x.seat);
    ANS('shortlist', d.shortlist.slice(0, 4).map((x, i) => `${i + 1} <b>${cap(x)}</b> ≈${Math.round(x.weight)}%`).join(' · ') + ' of winners here');
    const ct = data.inputs.contest_types.find(x => x.key === state.contest);
    ANS('step5', `${esc(CONTEST_SHORT[state.contest])} fields · own <b>${esc(ct.own_target)}</b> · dupes <b>≤ ${ct.dupe_cap}</b>`);
    stepFourAns();
    if (!hasPro()) { ANS('step3', `CPT <b>${cap(d.shortlist[0])}</b> → ${cap(d.shortlist[1])}`); return; }
    const dial = k => (d.dials.rows.find(x => x.k === k) || {}).v || '—';
    const batch = ['A', 'B', 'C', 'D'].filter(k => counts[k] > 0);
    const batchTxt = batch.map(k => `${counts[k]}×${k}`).join(' · ') || '—';
    ANS('step3', `CPT <b>${cap(d.shortlist[0])}</b> → ${cap(d.shortlist[1])} · batch <b>${batchTxt}</b> · K ${esc(dial('K share'))} · DST ${esc(dial('DST share'))} · both QBs ≤ ${esc(dial('Both-QB max'))}`);
    ANS('play', `<b>${cap(d.shortlist[0])}</b>, then ${cap(d.shortlist[1])} · batch ${batchTxt} · own ${esc(ct.own_target)}`);
    ANS('alloc', `${state.entries} lineup${state.entries === 1 ? '' : 's'} → ${['A', 'B', 'C', 'D'].map(k => counts[k] > 0 ? `<b>${counts[k]} ${k}</b>` : `0 ${k}`).join(' · ')} · A ${Math.round(d.alloc.A)} / B ${Math.round(d.alloc.B)} / C ${Math.round(d.alloc.C)} / D ${Math.round(d.alloc.D)}`);
    ANS('recipes', batch.length ? `Your batch plays <b>${batch.join(', ')}</b>${FOLDS() && FOLDS().mode === 'game' ? ': those recipes open' : ''}` : 'No lineups in the batch yet');
    ANS('dials', `K <b>${esc(dial('K share'))}</b> · DST <b>${esc(dial('DST share'))}</b> · both QBs <b>≤ ${esc(dial('Both-QB max'))}</b> · CPT cap ${esc(dial('Per-captain share cap'))} · overlap ${esc(dial('Max overlap between lineups'))} · dupes ≤ ${esc(dial('Dupes max'))}`);
    const pinned = data.ten_laws.filter(l => d.laws.has(l.n));
    ANS('laws', pinned.length ? `Pinned for this game: ${pinned.map(l => `<b>${l.n}</b> ${lawShort(l.law)}`).join(' · ')}` : 'The ten laws from the 120 winners');
    const nh = Object.keys(data.hard_rules).filter(k => !k.startsWith('_')).length, ns = Object.keys(data.soft_penalties).filter(k => !k.startsWith('_')).length;
    ANS('rules', `${nh} hard · ${ns} soft · rules.json ${esc((data.engine && data.engine.rules_version || '').split(' ')[0] || '')} · the Lab runs all of them`);
    ANS('export', 'Copy the playbook or the Stokastic settings · play card image for Discord');
    ANS('lessons', (data.lessons_2026 || []).map(l => esc(l.slate.split(' (')[0])).join(' · '));
    ANS('step6', 'After the slate: drop DK contest standings · what 2026 taught us');
    ANS('review', 'Drop a DK contest-standings export: the winner graded, the cut ladder, where your entries finished');
  };

  /* ---------- master render ---------- */
  // Snapshot keyed elements → re-render → morph from the old values.
  const render = () => {
    if (!data) return;
    const prev = FX.snapshot(), restore = FX.keepFocus();
    const d = derive();
    renderInputs(); renderConsole(d); renderDock(d);
    renderRead(d); renderScript(d); renderTotalStrip(d); renderOverlays(d); renderWinners(d); renderCheat(d);
    renderShortlist(d);
    // The Pro sections render only with the Pro part loaded (always, in open mode); otherwise the upgrade card.
    const counts = hasPro() ? renderAlloc(d) : largestRemainder(d.alloc, state.entries);
    if (hasPro()) {
      renderVerdict(d, counts); renderRecipes(d, counts); renderDials(d); renderLaws(d);
      renderFit(d); renderCuts(); renderCheck(); renderExport(); renderLessons();
    }
    renderProLocks();
    renderAnswers(d, counts);
    store.save(state);
    syncUrl();
    document.dispatchEvent(new CustomEvent('sd:render', { detail: { d, state, counts } }));
    FX.rove();
    restore();
    FX.morph(prev);
    FX.reveal();
  };
  let raf = 0;
  const scheduleRender = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; render(); }); };
  // The Lab reports its live score here; only the console + dock re-render.
  const setLabScore = s => {
    labScore = s; if (!data) return;
    const prev = FX.snapshot($id('sdConsole')), prevDock = FX.snapshot($id('sdDock')), d = derive(), restore = FX.keepFocus();
    renderConsole(d); renderDock(d); restore(); FX.morph(prev, $id('sdConsole')); FX.morph(prevDock, $id('sdDock'));
    stepFourAns();
  };
  let toastT = 0;
  const toast = (msg, kind = '') => { const t = $id('sdToast'); if (!t) return; t.className = `sd-toast show ${kind}`; t.innerHTML = msg; clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'sd-toast'; }, 2600); };

  /* ---------- events ---------- */
  const setNum = (key, v, lo, hi) => { v = parseFloat(v); if (isNaN(v)) return; state[key] = Math.max(lo, Math.min(hi, key === 'entries' ? Math.round(v) : Math.round(v * 2) / 2)); state.preset = null; };
  const jump = id => { let el = document.getElementById(id); if (!el) return; if (FOLDS()) FOLDS().openTo(el);
    const sec = el.closest('details.sd-sec'); if (sec && el.parentElement && el.parentElement.classList.contains('sd-sec-body') && el === el.parentElement.firstElementChild) el = sec;   // land on the fold's header
    el.scrollIntoView({ behavior: FX.reduced() ? 'auto' : 'smooth', block: 'start' }); };
  // The dock's Tune drawer is a disclosure: the toggle carries aria-expanded; opening moves focus to the
  // first slider, closing (Done, the toggle, Escape) hands focus back to the toggle if it was inside.
  const setTune = open => {
    const t = $id('sdTune'); if (!t || t.hidden === !open) return;
    const inside = t.contains(document.activeElement);
    t.hidden = !open; renderDock(derive()); setDockTop();
    if (open) $id('sdTSpreadRange').focus({ preventScroll: true });
    else if (inside || document.activeElement === document.body) { const b = $id('sdDock').querySelector('[data-tune-toggle]'); if (b) b.focus({ preventScroll: true }); }
  };
  const bind = () => {
    document.addEventListener('click', e => {
      const p = e.target.closest('[data-group]');
      if (p) {
        const g = p.dataset.group, k = p.dataset.key;
        if (g === 'spread') { state.spread = SPREAD_REP[k]; state.preset = null; }
        else if (g === 'total') { state.total = TOTAL_REP[k]; state.preset = null; state.realized = null; }
        else if (g === 'env') { state.env = k; state.preset = null; }
        else if (g === 'contest') { state.contest = k; state.cutKey = null; }
        else if (g === 'entries') state.entries = ENTRY_PILLS.find(x => x.key === k).rep;
        else if (g === 'lean') state.lean = k;
        else if (g === 'preset') { const s = slates.find(x => x.id === k); if (s) { state.spread = s.spread; state.total = s.total; state.env = s.env; state.preset = s.id; state.realized = null; toast(`<b>${esc(s.label)}</b> loaded · ${esc(s.fav)} −${num(s.spread)} · ${num(s.total)}`); track('preset_select', { id: s.id, from: 'step1', replay: !!s.replay }); } }
        else return;
        render(); return;
      }
      const v = e.target.closest('[data-view]'); if (v) { state.view = v.dataset.view; render(); return; }
      const r = e.target.closest('[data-realized]'); if (r) { state.realized = r.dataset.realized; render(); return; }
      const cu = e.target.closest('[data-cut]'); if (cu) { state.cutKey = cu.dataset.cut; render(); return; }
      const ctr = e.target.closest('[data-cut-tier]'); if (ctr) { state.cutTier = ctr.dataset.cutTier; render(); return; }
      const coh = e.target.closest('[data-coh-tier]'); if (coh) { state.cohTier = coh.dataset.cohTier; render(); return; }
      if (e.target.closest('[data-attack]')) { state.attack = !state.attack; track('attack_toggle', { on: state.attack }); render(); return; }
      const sh = e.target.closest('[data-share]'); if (sh) { sharePng(sh.dataset.share, sh); return; }
      const cl = e.target.closest('[data-copy-link]'); if (cl) { copyLink(cl.dataset.copyLink || '', cl); return; }
      if (e.target.closest('[data-print]')) { window.print(); return; }
      if (e.target.closest('[data-pro-retry]')) { loadPro(); return; }
      const c = e.target.closest('[data-copy]'); if (c && hasPro()) { const d = derive(); copy(c.dataset.copy === 'playbook' ? playbookText(d) : stokasticText(d), c); return; }
      if (e.target.closest('[data-tune-toggle]')) { setTune($id('sdTune').hidden); return; }
      const j = e.target.closest('[data-jump]'); if (j) { e.preventDefault(); jump(j.dataset.jump); return; }
      if (e.target.closest('[data-edit]')) { e.preventDefault(); jump('step1'); return; }
      if (e.target.closest('#sdReset')) { store.clear(); Object.assign(state, { spread: 7.5, total: 48.5, env: 'dome', contest: 'se_small', entries: 1, lean: 'none', preset: null, realized: null }); render(); }
    });
    const onNum = (id, key, lo, hi) => { const el = $id(id); const h = () => { setNum(key, el.value, lo, hi); if (key === 'total') state.realized = null; render(); }; el.addEventListener('change', h); el.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); h(); el.blur(); } }); };
    onNum('sdSpreadNum', 'spread', 0, 30); onNum('sdTotalNum', 'total', 20, 80); onNum('sdEntriesNum', 'entries', 1, 150);
    // Sliders: live while dragging (one render per frame).
    const SLIDER = { sdSpreadRange: ['spread', 'set'], sdTotalRange: ['total', 'set'], sdEntriesRange: ['entries', 'set'], sdTSpreadRange: ['spread', 'tune'], sdTTotalRange: ['total', 'tune'] };
    // Touch: a thumb that lands on a full-width track while the reader scrolls the page must not move the
    // line. The track is touch-action: pan-y (CSS), so a vertical swipe becomes a scroll and the browser
    // cancels the pointer: put back the value the touch started from.
    const onRange = (id, fn) => {
      const el = $id(id); let start = null, cancelled = false;
      el.addEventListener('pointerdown', e => { start = e.pointerType === 'mouse' ? null : el.value; cancelled = false; });
      el.addEventListener('pointercancel', () => { if (start != null && el.value !== start) { cancelled = true; setTimeout(() => { cancelled = false; }, 400); el.value = start; fn(+start); render(); } start = null; });
      el.addEventListener('pointerup', () => { start = null; });
      el.addEventListener('input', () => { if (cancelled) return; fn(+el.value); scheduleRender(); });
      el.addEventListener('change', () => { if (cancelled) return; fn(+el.value); render(); const [k, where] = SLIDER[id]; track('slider_commit', { slider: k, where, value: state[k] }); });
    };
    onRange('sdSpreadRange', v => { state.spread = v; state.preset = null; });
    onRange('sdTotalRange', v => { state.total = v; state.preset = null; state.realized = null; });
    onRange('sdEntriesRange', v => { state.entries = ENTRY_STEPS[v]; });
    onRange('sdTSpreadRange', v => { state.spread = v; state.preset = null; });
    onRange('sdTTotalRange', v => { state.total = v; state.preset = null; state.realized = null; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$id('sdTune').hidden) setTune(false); });
    let st = 0;
    window.addEventListener('scroll', () => { if (st) return; st = requestAnimationFrame(() => { st = 0; spy(); }); }, { passive: true });
    window.addEventListener('resize', () => { setDockTop(); spy(); });
  };

  /* ---------- server gating: the Pro part + the upgrade card ---------- */
  // Each [data-pro-data] wrapper holds sections that read the Pro part. Without it: content hidden, one card
  // in its place (the auth.js upgrade card when locked). Rewritten only when the state changes.
  let lockIO = null;
  const lockSeen = new WeakSet();
  const lockCard = (wrap, st) => {
    if (st === 'pending') return `<p class="sd-lede">Checking your plan…</p>`;
    if (st === 'error') return `<p class="sd-lede">The Pro sections didn't load. <button type="button" class="sd-link" data-pro-retry>Try again</button></p>`;
    const msg = wrap.getAttribute('data-gate-msg') || '';
    const A = window.BBI.auth;
    if (A && A.lockCard) return A.lockCard('pro', msg);
    return `<div class="bbi-lock-card"><div class="eyebrow">Pro feature</div><h4>Unlock this with Pro</h4><p>${esc(msg)}</p><a class="bbi-auth-btn" href="pricing.html">See plans</a></div>`;
  };
  // The hosts showdown.js fills from the Pro part: emptied on sign-out so nothing Pro stays in the DOM.
  const PRO_HOSTS = ['sdVerdict', 'sdAlloc', 'sdRecipes', 'sdDials', 'sdLaws', 'sdFit', 'sdCuts', 'sdCheck', 'sdExport', 'sdLessons'];
  const renderProLocks = () => {
    if (gating === 'open' || typeof document.querySelectorAll !== 'function') return;
    if (!hasPro()) PRO_HOSTS.forEach(id => { const el = $id(id); if (el && el.firstChild) el.innerHTML = ''; });
    document.querySelectorAll('[data-pro-data]').forEach(wrap => {
      let lk = wrap.querySelector(':scope > .sd-pro-lock');
      const st = hasPro() ? null : proState;
      [...wrap.children].forEach(c => { if (c !== lk) c.hidden = !!st; });
      if (!st) { if (lk) lk.remove(); return; }
      if (!lk) { lk = document.createElement('div'); lk.className = 'sd-pro-lock'; wrap.appendChild(lk); }
      if (lk.dataset.state === st) return;
      lk.dataset.state = st;
      lk.innerHTML = lockCard(wrap, st);
      // gate_view, as track.js logs for [data-gate] locks: once per region, when the card scrolls into view.
      if (st !== 'locked' || lockSeen.has(wrap) || !('IntersectionObserver' in window)) return;
      if (!lockIO) lockIO = new IntersectionObserver(es => es.forEach(e => {
        const w = e.target.closest('[data-pro-data]');
        if (!e.isIntersecting || !w || lockSeen.has(w)) return;
        lockSeen.add(w); lockIO.unobserve(e.target);
        const sec = w.closest('section[id]');
        track('gate_view', { tier: 'pro', section: sec ? sec.id : '' });
      }), { threshold: 0.25 });
      lockIO.observe(lk);
    });
  };
  // auth.js is lazy-loaded by nfl.js; wait for it (no auth → anonymous → locked).
  const waitAuth = (ms = 15000) => new Promise(res => {
    const t0 = Date.now();
    const tick = () => { if (window.BBI.auth) res(window.BBI.auth); else if (Date.now() - t0 > ms) res(null); else setTimeout(tick, 100); };
    tick();
  });
  let proSeq = 0;
  const loadPro = async () => {
    const seq = ++proSeq;
    if (proState !== 'open') { proState = 'pending'; renderProLocks(); }
    const A = await waitAuth();
    let pro = null, st = 'locked';
    try {
      const token = A && A.backend && A.backend.accessToken ? await A.backend.accessToken() : null;
      if (token) {   // signed out → locked without a round trip; the route would answer gated anyway
        const r = await fetch(`${(A && A.API_BASE) || ''}${PRO_ROUTE}`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        pro = proFrom(await r.json());
        if (pro) st = 'open';
      }
    } catch (e) { console.warn('[showdown] Pro part unavailable:', e.message || e); st = 'error'; }
    if (seq !== proSeq) return;   // a newer sign-in / sign-out took over
    if (pro && pro._split.version !== pub.meta.version) console.warn(`[showdown] Pro part is data ${pro._split.version}, public part ${pub.meta.version}: redeploy the route with the site`);
    proState = st;
    data = mergePro(pub, pro);
    render();
  };
  const watchPro = async () => {
    const A = await waitAuth();
    const who = () => { const u = A && A.user && A.user(); return u ? `${u.email}|${u.tier}` : ''; };
    let last = who();
    loadPro();
    if (A && A.onChange) A.onChange(() => { const k = who(); if (k !== last) { last = k; loadPro(); } });
  };

  const showError = msg => {
    const host = $id('sdError'); if (!host) return;
    host.hidden = false;
    host.innerHTML = `<div class="card sd-error"><h3>Playbook data didn't load</h3><p class="sd-lede">${esc(msg)} — the page reads <code>${DATA_PATH}</code>. Refresh, or check the deploy.</p></div>`;
    const page = $id('sdPage'); if (page) page.hidden = true;
  };

  const init = async () => {
    try {
      gating = gatingMode();
      const res = await fetch(gating === 'server' ? PUBLIC_PATH : DATA_PATH, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
      if (!data || !data.base_rates || !data.archetypes) throw new Error('unexpected JSON shape');
      if (gating === 'server') { pub = data; data = mergePro(pub, null); proState = 'pending'; }
    } catch (e) { showError(e.message || String(e)); return; }
    try { const r = await fetch(SLATES_PATH, { cache: 'no-cache' }); if (r.ok) slates = (await r.json()).slates || []; } catch {}
    const saved = store.load();
    if (saved && typeof saved === 'object') {
      for (const k of ['spread', 'total', 'env', 'contest', 'entries', 'lean', 'preset']) if (saved[k] != null) state[k] = saved[k];
      if (!data.inputs.environment.includes(state.env)) state.env = 'dome';
      if (!data.inputs.contest_types.some(c => c.key === state.contest)) state.contest = 'se_small';
      if (!LEANS.some(l => l.key === state.lean)) state.lean = 'none';
      state.entries = Math.max(1, Math.round(+state.entries || 1));
    }
    // A shared link wins over localStorage. A slate with no line of its own loads the
    // slate's line; a line that differs from the slate's is a what-if (no preset).
    const u = urlIn = urlParse(location.href);
    if (Object.keys(u).length) {
      const sl = slates.find(x => x.id === u.slate);
      if (sl && u.spread == null && u.total == null && u.env == null) Object.assign(state, { spread: sl.spread, total: sl.total, env: sl.env });
      if (u.spread != null) state.spread = u.spread;
      if (u.total != null) state.total = u.total;
      if (u.env && data.inputs.environment.includes(u.env)) state.env = u.env;
      if (u.contest && data.inputs.contest_types.some(c => c.key === u.contest)) { state.contest = u.contest; state.cutKey = null; }
      if (u.entries) state.entries = u.entries;
      state.preset = sl && +sl.spread === +state.spread && +sl.total === +state.total && sl.env === state.env ? sl.id : null;
      state.realized = null;
      urlArmed = true;
    } else if (!(saved && typeof saved === 'object')) {
      // First visit (no saved inputs, no link): Step 1 starts on the Lab's default pool (this week's first
      // game), so the Lab grades that game against its own line instead of opening as a what-if.
      const fresh = nextPrimetime();
      if (fresh && data.inputs.environment.includes(fresh.env)) Object.assign(state, { spread: fresh.spread, total: fresh.total, env: fresh.env, preset: fresh.id });
    }
    ['pointerdown', 'keydown', 'input'].forEach(ev => document.addEventListener(ev, () => { urlArmed = true; }, { once: true, capture: true, passive: true }));
    const v = $id('sdVersion'); if (v) v.textContent = data.meta.version;
    const rv = $id('sdRulesVersion'); if (rv && data.engine && data.engine.rules_version) rv.textContent = 'v' + data.engine.rules_version.split(' ')[0];
    bind();
    render();
    setDockTop(); spy();
    document.dispatchEvent(new CustomEvent('sd:ready', { detail: { data, slates } }));
    if (gating === 'server') watchPro();
    // Deep links (#step4 from the hub / nav / a shared link) land before the page has content.
    // Late layout (the Lab's pool fetch, auth gate wrapping, fonts) keeps shifting things for a
    // moment, so re-land on every layout change for ~3 s unless the reader takes over first.
    const h = cleanHash().slice(1);
    if (DEEP_LINK(h)) {
      if (FOLDS()) FOLDS().openTo(document.getElementById(h));
      let stopped = false, ro = null;
      const land = () => { const el = document.getElementById(h); if (el && !stopped) el.scrollIntoView({ block: 'start' }); };
      const stop = () => { stopped = true; if (ro) ro.disconnect(); };
      ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(ev => window.addEventListener(ev, stop, { once: true, passive: true, capture: true }));
      land();
      if (window.ResizeObserver) {
        let q = 0; ro = new ResizeObserver(() => { if (q) return; q = requestAnimationFrame(() => { q = 0; land(); }); });
        [document.querySelector('.sd-main'), document.body].forEach(el => el && ro.observe(el));
      } else [120, 900].forEach(t => setTimeout(land, t));
      setTimeout(stop, 3000);
    }
    window.addEventListener('hashchange', () => { const id = cleanHash().slice(1); if (DEEP_LINK(id)) jump(id); });
  };

  /* ---------- ownership correction + role leverage (pure; the Lab draws them) ---------- */
  // ownership_correction.json (codex/ownership_correction.py): OUR role-cell coefficients for how a pre-contest
  // ownership projection misses DK ownership, plus error bands. correctOwn mirrors correct() there: cell → effect
  // (a cell that didn't ship carries the identity) → floor 0 → rescale FLEX to 500 % / CPT to 100 % → the q10–q90
  // band of the corrected value's chalk bucket. Runs in the browser on the reader's own file; nothing is stored.
  const ownBucket = (v, table) => { const ks = Object.keys(table); for (const k of ks) { const [lo, hi] = table[k].range; if (v >= lo && (hi == null || v < hi)) return k; } return ks[ks.length - 1]; };
  const ownCell = (kind, pos, side, proj) => {
    if (pos === 'K' || pos === 'DST') return `${pos}_${side}`;
    if (kind === 'flex') {
      if (pos === 'QB' && proj >= 5) return `QB_${side}`;
      if (proj < 5) return 'tail_lt5';
      return `${pos}_${side}_${proj < 15 ? '5_15' : proj < 30 ? '15_30' : '30_plus'}`;
    }
    if (pos === 'QB' && proj >= 2) return `QB_${side}`;
    if (proj < 1) return 'tail_lt1';
    return `${pos}_${side}_${proj < 5 ? '1_5' : '5_plus'}`;
  };
  // v ± the band's q10 / q90 (floored at 0). which: 'corrected' | 'raw' | 'bb_model'.
  const ownBand = (P, kind, v, which) => {
    const B = P && P.bands && P.bands[kind] && P.bands[kind][which]; if (!B) return null;
    const b = B[ownBucket(v, B)]; return { lo: Math.max(0, v + (b.q10 || 0)), hi: Math.max(0, v + (b.q90 || 0)), n: b.n, bucket: ownBucket(v, B) };
  };
  // players: [{name, pos, team, own, cpt_own}] of ONE slate → Map name → {own, cpt_own (corrected), own_raw, cpt_own_raw, own_lo/hi, cpt_own_lo/hi, own_n, cpt_own_n, cell_flex, cell_cpt}
  const correctOwn = (players, fav, P) => {
    const out = new Map(players.map(p => [p.name, {}]));
    for (const [kind, key] of [['flex', 'own'], ['cpt', 'cpt_own']]) {
      const M = P[kind], form = M.form, idn = M.identity_effect ?? (form === 'add' ? 0 : 1);
      const cells = players.map(p => ownCell(kind, p.pos, p.team === fav ? 'fav' : 'dog', +p[key] || 0));
      const adj = players.map((p, i) => { const c = M.cells[cells[i]], e = c ? c.effect : idn, v = +p[key] || 0; return Math.max(0, form === 'add' ? v + e : v * e); });
      const s = adj.reduce((a, b) => a + b, 0), q = s > 0 ? adj.map(a => a * M.target_sum / s) : adj;
      players.forEach((p, i) => {
        const o = out.get(p.name), b = ownBand(P, kind, q[i], 'corrected');
        Object.assign(o, { [key]: q[i], [`${key}_raw`]: +p[key] || 0, [`cell_${kind}`]: cells[i], [`${key}_lo`]: b ? b.lo : q[i], [`${key}_hi`]: b ? b.hi : q[i], [`${key}_n`]: b ? b.n : 0 });
      });
    }
    return out;
  };
  // est. dupes = field × Π own × 6 (the engine's formula, own floored at 0.05 %); cpt: {cpt_own}, fl: [{own}].
  const estDupes = (field, cptOwn, flexOwns) => field * (Math.max(cptOwn, 0.05) / 100) * flexOwns.reduce((a, o) => a * (Math.max(o, 0.05) / 100), 1) * 6;

  // role_rates (codex/role_rates.py): how often each depth role was the captain / in FLEX of the historical winners.
  // Leverage = that rate − the summed projected ownership of the pool players in the role (points), CPT and FLEX
  // separately — the definition in role_rates.leverage and LEVERAGE_METHOD.md. players = the active pool.
  // split: a K or DST role holding more than one player projected ≥ 5 % FLEX own (e.g. two kickers listed for one
  // team). The role sums them while the field splits one player's worth, so its "over-owned" number is an
  // ownership-model artifact, not leverage: the board leaves it unranked (LEVERAGE_METHOD.md, GB kickers).
  const ROLE_DEPTH = { QB: ['QB1', 'QB2+'], RB: ['RB1', 'RB2+'], WR: ['WR1', 'WR2', 'WR3+'], TE: ['TE1', 'TE2+'] };
  const roleMap = (players, fav) => {
    const role = new Map();
    for (const t of new Set(players.map(p => p.team))) for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DST'])
      players.filter(p => p.team === t && p.pos === pos).sort((a, b) => b.sal - a.sal)
        .forEach((p, i) => role.set(p.name, `${t === fav ? 'FAV' : 'DOG'}_${ROLE_DEPTH[pos] ? ROLE_DEPTH[pos][Math.min(i, ROLE_DEPTH[pos].length - 1)] : pos}`));
    return role;
  };
  const levBucket = s => s <= 3 ? 'spread_le3' : s <= 6.5 ? 'spread_3.5_6.5' : 'spread_ge7';
  const LEV_BUCKET_LABEL = { spread_le3: 'spread ≤ 3', 'spread_3.5_6.5': 'spread 3.5–6.5', spread_ge7: 'spread ≥ 7', all: 'all spreads' };
  const leverageFor = (players, fav, spread, rr) => {
    if (!rr || !rr.cohorts || !rr.roles) return null;
    const C = rr.cohorts[rr.default_cohort], b = levBucket(+spread), row = C.by_spread && C.by_spread[b];
    const useRow = !!(row && row.roles && row.n >= rr.min_bucket_n), R = useRow ? row.roles : C.roles;
    const role = roleMap(players, fav), SAL = (rr.depth && rr.depth.salary_by_role) || {};
    const thinOf = p => { const s = SAL[role.get(p.name)]; return !s || !(s.n >= 5) || p.sal < s.p5 || p.sal > s.p95; };
    const roles = {};
    for (const r of rr.roles) {
      const h = R[r.id]; if (!h) continue;
      const mem = players.filter(p => role.get(p.name) === r.id), hf = r.multi ? h.flex.per100 : h.flex.pct;
      const oc = mem.reduce((s, p) => s + (+p.cpt_own || 0), 0), of = mem.reduce((s, p) => s + (+p.own || 0), 0);
      roles[r.id] = { id: r.id, label: r.label, side: r.side, pos: r.pos, multi: r.multi, players: mem.map(p => p.name), thin: mem.length > 0 && mem.every(thinOf),
        split: (r.pos === 'K' || r.pos === 'DST') && mem.filter(p => (+p.own || 0) >= 5).length > 1,
        cpt: { hist: h.cpt.pct, k: h.cpt.k, ci: h.cpt.ci90, own: oc, lev: h.cpt.pct - oc },
        flex: { hist: hf, pct: h.flex.pct, k: h.flex.k, ci: h.flex.ci90, own: of, lev: hf - of, per100: !!r.multi } };
    }
    const byPlayer = new Map(players.map(p => [p.name, { role: role.get(p.name), thin: thinOf(p), sal: SAL[role.get(p.name)] || null }]));
    return { bucket: useRow ? b : 'all', n: useRow ? row.n : C.n, cohort: rr.default_cohort, cohortN: C.n, roles, byPlayer };
  };
  // The 2026 field-gap note for a role family (FAV_QB …) and slot ('cpt' | 'flex'), or null when the field is aligned.
  const fieldGapFor = (rr, side, pos, slot) => {
    const f = rr && rr.field_gap && rr.field_gap.families && rr.field_gap.families[`${side}_${pos}`];
    const g = f && f[slot]; return g && g.label !== 'aligned' ? g : null;
  };

  // Public surface (also used by the verification harness).
  window.BBI.showdown = { bucketSpread, bucketTotal, expectedSpreadRow, expectedTotalRow, cheatCell, envRow, roofRow, overlaysFor, allocationFor, largestRemainder, shortlistFor, dialsFor, pinnedLawsFor, LEANS, state, get data() { return data; }, set data(v) { data = v; }, get slates() { return slates; }, set slates(v) { slates = v; }, render, init,   // setters: test seam
    derive: () => derive(), slateTier, attackFor, nextPrimetime, visibleSlates, histText, checkText, checkLegend, CHECK, setLabScore, toast, scriptOdds, ENV_LABEL, ENV_SHORT, CONTEST_SHORT, SCRIPT_META,
    VERDICT, LAW_RULES, ruleById, tmplRuleId, lawVerdict, verdictTip, vBadge, vIcon, lawBadge, cohortRows, fieldBucket, cutLadder, lineupProj, projVsCuts, median,
    urlParse, urlSerialize, nameSlug, lineupTokens, lineupFromTokens, get urlIn() { return urlIn; }, syncUrl, copyLink, sharePng,
    playbookText: () => playbookText(derive()), stokasticText: () => stokasticText(derive()), playCardPng: () => playCardPng(derive()),
    GATING_MODE, PUBLIC_PATH, PRO_ROUTE, gatingMode, mergePro, proFrom, hasPro, get gating() { return gating; }, get proState() { return proState; },
    ownBucket, ownCell, ownBand, correctOwn, estDupes, roleMap, levBucket, LEV_BUCKET_LABEL, leverageFor, fieldGapFor };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
