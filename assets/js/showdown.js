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

  const DATA_PATH   = 'assets/data/showdown_playbook.json';
  const SLATES_PATH = 'assets/data/showdown_slates.json';
  const LS_KEY      = 'bbi_showdown_inputs';
  const SMALL_N     = 15;

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
      { k: 'K share', v: range(k), adj: mode !== 'default' || ov.dome, note: `${mode} · ceiling ${pct(p.share_ceilings.k)}` + (ov.dome ? ' · dome bump' : '') },
      { k: 'DST share', v: range(p.dst_share[dstMode]), adj: dstMode !== 'default', note: `${dstMode}` + (ov.wind ? ' (wind ≥15 → grind)' : '') + ` · ceiling ${pct(p.share_ceilings.dst)}` },
      { k: 'Both-QB max', v: pct(bothQb), adj: bothQb !== p.both_qbs_share_max, note: ov.grind ? 'grind overlay' : ov.shootout ? 'shootout overlay' : 'portfolio default' },
      { k: '5-1 fav minimum', v: +spread >= p.big_spread ? `${p.five_one_fav_min_count_big_spread} lineups` : +spread >= p.five_one_fav_min_spread ? `${p.five_one_fav_min_count} lineup` : '—',
        adj: +spread >= p.five_one_fav_min_spread, note: +spread >= p.five_one_fav_min_spread ? `spread ≥ ${+spread >= p.big_spread ? p.big_spread : p.five_one_fav_min_spread}` : `only when spread ≥ ${p.five_one_fav_min_spread}` },
      { k: 'Fav captain share min', v: +spread >= p.big_spread ? pct(p.fav_captain_share_min_big_spread) : '—', adj: +spread >= p.big_spread, note: `spread ≥ ${p.big_spread}` },
      { k: 'Per-captain share cap', v: `${pct(p.max_per_captain_share)} · max ${p.max_per_captain_abs}`, note: 'share of batch · absolute' },
      { k: 'Captain position cap', v: Object.entries(p.captain_position_share_max).map(([a, b]) => `${a} ${pct(b)}`).join(' · '), note: 'share of batch at captain', adj: false },
      { k: 'Max overlap between lineups', v: `${p.max_overlap_players} players`, note: 'any two lineups' },
      { k: 'Punt share max', v: pct(p.sub_1k_share_max), note: 'lineups with a sub-$1k player' },
      { k: 'Dupes max', v: `${dupesFor(data, contestKey)}`, note: `for ${CONTEST_SHORT[contestKey] || contestKey}` }
    ];
    return { rows, notes, mode, dstMode, bothQb, k };
  };

  const HARD_LABELS = {
    max_kickers: v => `Max ${v} kicker`,
    max_k_plus_dst: v => `K + DST combined ≤ ${v}`,
    max_dst: v => `Max ${v} DST`,
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

  /* ---------- formatting ---------- */
  const pct   = x => `${Math.round(x * 100)}%`;
  const range = a => `${Math.round(a[0] * 100)}–${Math.round(a[1] * 100)}%`;
  const num   = x => (Math.round(x * 10) / 10).toString();
  const esc   = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nTag  = n => `<span class="n${n < SMALL_N ? ' small' : ''}">n = ${n}${n < SMALL_N ? ' · small sample' : ''}</span>`;
  const spreadLabel = (s, fav) => `${fav || 'Fav'} −${num(Math.abs(+s))}`;

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
  // Small horizontal rate bar (HTML, components.css .bar)
  const rate = (label, v, dim) => `<div class="sd-rate"><span>${esc(label)}</span><span class="bar"><span class="bar-fill" style="width:${Math.max(0, Math.min(100, v))}%${dim ? ';background:var(--gold-700)' : ''}"></span></span><span class="v">${Math.round(v)}%</span></div>`;

  /* =================================================================
     3. PAGE
     ================================================================= */
  const SEG = ['sd-seg-1', 'sd-seg-2', 'sd-seg-3', 'sd-seg-4'];
  const POS = ['WR', 'RB', 'QB', 'TE'];

  let data = null, slates = [];
  const state = { spread: 7.5, total: 48.5, env: 'dome', contest: 'se_small', entries: 1, lean: 'none', preset: null, view: 'expected', realized: null };

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
  const renderInputs = () => {
    const d = derive();
    const sbKey = d.sb, tbKey = d.tb, eKey = bucketEntries(state.entries);
    $id('sdSpreadPills').innerHTML = data.inputs.spread_buckets.map(b => pill('spread', b.key, esc(b.label.replace("Pick'em to 3", 'PK–3').replace(' to ', '–').replace(' or more', '+')), b.key === sbKey)).join('');
    $id('sdTotalPills').innerHTML = data.inputs.total_buckets.map(b => pill('total', b.key, esc(b.label.replace(' or under', ' or less').replace(' to ', '–').replace(' or more', '+').replace('41 or less', '≤41')), b.key === tbKey)).join('');
    $id('sdEnvPills').innerHTML = data.inputs.environment.map(k => pill('env', k, ENV_LABEL[k] || k, k === state.env)).join('');
    $id('sdContestPills').innerHTML = data.inputs.contest_types.map(c => pill('contest', c.key, esc(c.label.replace('Single entry / 3-max, under 5k', 'SE / 3-max <5k')), c.key === state.contest)).join('');
    $id('sdEntriesPills').innerHTML = ENTRY_PILLS.map(p => pill('entries', p.key, p.label, p.key === eKey)).join('');
    $id('sdLeanPills').innerHTML = LEANS.map(l => pill('lean', l.key, l.label, l.key === state.lean)).join('');
    if (document.activeElement !== $id('sdSpreadNum')) $id('sdSpreadNum').value = state.spread;
    if (document.activeElement !== $id('sdTotalNum')) $id('sdTotalNum').value = state.total;
    if (document.activeElement !== $id('sdEntriesNum')) $id('sdEntriesNum').value = state.entries;
    $id('sdSpreadVal').textContent = `${d.spreadBucket.label} → ${d.sb}`;
    $id('sdTotalVal').textContent = `${d.totalBucket.label} → ${d.tb}`;
    $id('sdPresets').innerHTML = slates.length
      ? slates.map(p => pill('preset', p.id, `${esc(p.label)} · ${esc(p.fav)} −${num(p.spread)} · ${num(p.total)} · ${esc(ENV_SHORT[p.env] || p.env).toLowerCase()}`, p.id === state.preset)).join('')
      : '<span class="sd-num-hint">No presets this week.</span>';
    const chip = `${spreadLabel(state.spread, d.preset && d.preset.fav)} · ${num(state.total)} · ${ENV_SHORT[state.env]} · ${CONTEST_SHORT[state.contest]} · ${state.entries} ${state.entries === 1 ? 'entry' : 'entries'}`;
    $id('sdChipText').textContent = chip;
    $id('sdSummary').textContent = chip;
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
      ${stackedBar(segs, { marker: { label: 'Within 3', value: b.within3, at }, aria: `Spread ${d.spreadBucket.label}: blowout ${b.blowout14}%, favorite controls ${favControls}%, dog wins ${b.dog_wins}%, within 3 points ${b.within3}%` })}
      <div class="sd-legend">
        <span><i class="sd-seg-1"></i>Blowout (fav by ≥14) ${b.blowout14}%</span>
        <span><i class="sd-seg-2"></i>Fav controls (wins by &lt;14) ${favControls}%</span>
        <span><i class="sd-seg-4"></i>Dog wins ${b.dog_wins}%</span>
        <span>┆ Within 3 (either side) ${b.within3}% · overlaps</span>
      </div>
      <p class="sd-lede">A <strong>${esc(d.spreadBucket.label.toLowerCase())}</strong> favorite blows it out <strong>${b.blowout14}%</strong> of the time and loses <strong>${b.dog_wins}%</strong>. Fav by 7+: ${b.fav_by7}%. Build for the distribution, not the favorite.</p>
      <div class="sd-caption">2,761 games 2016–25 · fav controls = fav wins ${b.fav_wins} − blowout ${b.blowout14}</div>`;
  };

  const renderTotalStrip = d => {
    const t = data.base_rates.by_total[d.tb];
    const w = data.base_rates.weather;
    const wind = isWind(state.env) ? `<div class="sd-badges"><div class="sd-badge on"><b>Wind ≥10</b><span>over rate ${w[state.env].over_rate}% (n = ${w[state.env].n}) vs ${w.dome.over_rate}–${w.outdoor_mild.over_rate}% dome/mild</span></div></div>` : '';
    $id('sdTotalStrip').innerHTML = `
      <div class="card-title">Total reality · <span class="card-title-accent">${esc(d.totalBucket.label)}</span></div>
      <div class="sd-strip" role="img" aria-label="Total ${d.totalBucket.label}: mean actual ${t.mean_actual}, over by 7 or more ${t.over7}%, under by 7 or more ${t.under7}%, 55 or more ${t.ge55}%, 37 or less ${t.le37}%">
        <div class="sd-strip-cell"><b>${t.mean_actual}</b><span>mean actual</span></div>
        <div class="sd-strip-cell"><b>${t.over7}%</b><span>over by 7+</span></div>
        <div class="sd-strip-cell"><b>${t.under7}%</b><span>under by 7+</span></div>
        <div class="sd-strip-cell"><b>${t.ge55}%</b><span>P(≥55)</span></div>
        <div class="sd-strip-cell"><b>${t.le37}%</b><span>P(≤37)</span></div>
      </div>
      ${wind}
      <div class="sd-caption">2,761 games 2016–25 · ${esc(ENV_LABEL[state.env])} over rate ${w[state.env].over_rate}% (n = ${w[state.env].n})</div>`;
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

  const winnerCol = (title, row, n, source) => {
    const cp = row.cpt_pos;
    return `<div class="sd-winner-col">
      <h4>${title}</h4>
      <div class="sd-donut-wrap">
        <div style="position:relative">${donut(POS.map((k, i) => ({ label: k, value: cp[k] || 0, cls: SEG[i] })), `Captain position: ${POS.map(k => `${k} ${cp[k]}%`).join(', ')}`)}
          <div class="sd-donut-center" style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center"><b>${row.cpt_fav}%</b><span>CPT fav</span></div></div>
        <div class="sd-rates">${POS.map((k, i) => `<div class="sd-rate"><span><i class="sd-legend"><i class="${SEG[i]}"></i></i>CPT ${k}</span><span class="bar"><span class="bar-fill" style="width:${cp[k]}%"></span></span><span class="v">${cp[k]}%</span></div>`).join('')}</div>
      </div>
      <div class="sd-rates">
        ${rate('5-1 fav', row.five_one_fav)}${rate('4-2', row.four_two)}${rate('3-3', row.three_three)}
      </div>
      <div class="sd-rates">
        ${rate('K in lineup', row.K, true)}${rate('DST in lineup', row.DST, true)}${rate('Both QBs', row.both_qb, true)}${rate('Dog QB in lineup', row.dog_qb_in_lineup, true)}
      </div>
      <div class="sd-caption">${nTag(n)} · ${source}</div>
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
        <button type="button" role="tab" data-view="expected" class="${state.view === 'expected' ? 'active' : ''}" aria-selected="${state.view === 'expected'}">By expected script (Vegas)</button>
        <button type="button" role="tab" data-view="realized" class="${state.view === 'realized' ? 'active' : ''}" aria-selected="${state.view === 'realized'}">If you're right about the game</button>
      </div></div>`;
    let body;
    if (state.view === 'expected') {
      const sk = expectedSpreadRow(d.sb), tk = expectedTotalRow(d.tb, state.total);
      const sr = data.winners_by_expected_script[sk], tr = data.winners_by_expected_script[tk];
      body = `<p class="sd-lede">Build for the distribution: winners in games the market priced like this one.</p>
        <div class="sd-grid-2">
          ${winnerCol(`Spread ${esc(d.spreadBucket.label)} · <span style="color:var(--text-dimmed)">${sk}</span>`, sr, sr.n, src)}
          ${winnerCol(`Total ${esc(d.totalBucket.label)} · <span style="color:var(--text-dimmed)">${tk}</span>`, tr, tr.n, src)}
        </div>`;
    } else {
      const rr = data.winners_by_realized_script[state.realized];
      const cur = REALIZED.find(r => r.key === state.realized);
      body = `<p class="sd-lede">If you're right about the game: winners by how the game actually went. Pick the script you believe — the % is how often a ${esc(d.spreadBucket.label.toLowerCase())} favorite produced it.</p>
        <div class="sd-realized-tabs" role="tablist">${REALIZED.map(r => `<button type="button" class="chip" role="tab" data-realized="${r.key}" aria-pressed="${r.key === state.realized}" aria-selected="${r.key === state.realized}">${r.label} <span class="count">${Math.round(r.dist(b))}%</span></button>`).join('')}</div>
        <div class="sd-grid-2">${winnerCol(`${esc(cur.label)} · <span style="color:var(--text-dimmed)">${cur.key}</span>`, rr, rr.n, src)}
          <div class="sd-winner-col" style="justify-content:center"><h4>Read it</h4>
            <p class="sd-lede">CPT from the favorite <strong>${rr.cpt_fav}%</strong> · 5-1 fav <strong>${rr.five_one_fav}%</strong> · both QBs <strong>${rr.both_qb}%</strong> · dog QB in the lineup <strong>${rr.dog_qb_in_lineup}%</strong>.</p>
            <p class="sd-lede" style="color:var(--text-muted)">This is the "if" view. The expected view is what you build the batch for; this is what one lineup looks like when you call the script.</p>
            <div class="sd-caption">${nTag(rr.n)} · ${src}</div></div>
        </div>`;
    }
    $id('sdWinners').innerHTML = head + body;
  };

  const renderCheat = d => {
    const c = data.captain_by_spread_x_total, e = data.captain_by_environment, rw = data.roof_weather_winners;
    const rowLabel = { le3: 'Spread ≤3', '3.5_6.5': '3.5–6.5', ge7: '≥7' };
    const cellHtml = (r, col) => { const v = c[r][col]; const on = r === d.cell.row && col === d.cell.col;
      return `<div class="sd-cell${on ? ' active' : ''}" ${on ? 'aria-current="true"' : ''}>${POS.map(k => `${k} <b>${v[k]}</b>`).join(' · ')}<br>fav <b>${v.fav}%</b> · K <b>${v.K}%</b></div>`; };
    const ek = envRow(state.total), rk = roofRow(state.env);
    const envLabel = { grind_le42: 'Grind ≤42', 'avg_42.5_48.5': 'Avg 42.5–48.5', shootout_ge49: 'Shootout ≥49' };
    const roofLabel = { dome: 'Dome', outdoor_mild: 'Outdoor mild', cold_le35: 'Cold ≤35°', wind_ge15: 'Wind ≥15' };
    $id('sdCheat').innerHTML = `
      <div class="card-title">Captain cheat-sheet · <span class="card-title-accent">${rowLabel[d.cell.row]} × ${d.cell.col === 'total_ge46' ? 'total ≥46' : 'total ≤45.5'}</span></div>
      <div class="sd-cheat" role="table" aria-label="Captain position share of winners by spread and total">
        <div class="sd-cheat-h"></div><div class="sd-cheat-h">Total ≤45.5</div><div class="sd-cheat-h">Total ≥46</div>
        ${['le3', '3.5_6.5', 'ge7'].map(r => `<div class="sd-cheat-h" style="align-self:center">${rowLabel[r]}</div>${cellHtml(r, 'total_le45.5')}${cellHtml(r, 'total_ge46')}`).join('')}
      </div>
      <div class="sd-caption">120 DK showdown winners 2018–25 · % of winning captains by position · fav = captain from the favorite</div>
      <div class="sd-rows" style="margin-top:6px">
        ${Object.keys(e).map(k => `<div class="sd-row${k === ek ? ' active' : ''}"><span class="k">${envLabel[k]}</span><span>${POS.map(p => `${p} ${e[k][p]}`).join(' · ')} · default: ${esc(e[k].default)}</span></div>`).join('')}
      </div>
      <div class="sd-rows" style="margin-top:6px">
        ${Object.keys(rw).map(k => `<div class="sd-row${k === rk ? ' active' : ''}"><span class="k">${roofLabel[k]}</span><span>CPT ${POS.map(p => `${p} ${rw[k].cpt_pos[p]}`).join(' · ')} · K ${rw[k].K} · DST ${rw[k].DST} · both-QB ${rw[k].both_qb} · own ${rw[k].cum_own}% · ${nTag(rw[k].n)}</span></div>`).join('')}
        ${!rk ? `<div class="sd-caption">No 10–14 mph wind cut in the winner set — the wind ≥10 effect shows in the total strip (over rate ${data.base_rates.weather.wind_10_14.over_rate}%).</div>` : ''}
      </div>
      <div class="sd-caption">Environment rows: 120 winners by total band and by roof/weather.</div>`;
  };

  /* ---------- Step 3: build it ---------- */
  const renderShortlist = d => {
    const laws = data.ten_laws;
    const law = n => laws.find(l => l.n === n) || {};
    $id('sdShortlist').innerHTML = `
      <div class="card-title">Captain shortlist · <span class="card-title-accent">ranked for this cell</span></div>
      <div class="sd-seats">${d.shortlist.map((s, i) => `
        <div class="sd-seat">
          <span class="sd-seat-rank">SEAT ${i + 1}</span>
          <span class="sd-seat-name">${esc(s.seat)}</span>
          <span class="sd-seat-share">${s.pos} ${s.posShare}% · ${s.side} ${s.sideShare}% <small>≈ ${Math.round(s.weight)}% of winners here</small></span>
          <span class="sd-seat-why">${esc(s.why)}</span>
        </div>`).join('')}</div>
      <div class="sd-leverage"><b>Leverage test.</b> CPT-optimal 7% / CPT-own 2% = <b>a seat</b> · 6% / 14% = <b>a flex</b> · sweet spot <b>5–15% owned</b> with top-3 CPT-optimal.</div>
      <div class="sd-never">
        <div class="sd-never-item"><b>Dog pocket QB at +3.5 or more</b><span>${esc(law(5).evidence)}</span></div>
        <div class="sd-never-item"><b>Kicker</b><span>${esc(law(7).evidence)}</span></div>
        <div class="sd-never-item"><b>DST</b><span>${esc(law(3).evidence)}</span></div>
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
      ${stackedBar(segs, { aria: `Allocation: ${segs.map(s => `${s.label} ${Math.round(s.value)}%`).join(', ')}` })}
      <div class="sd-legend">${['A', 'B', 'C', 'D'].map((k, i) => `<span><i class="${SEG[i]}"></i>${k} · ${esc(names[k])} ${Math.round(a[k])}%</span>`).join('')}</div>
      <div class="sd-counts"><span>${state.entries} lineup${state.entries === 1 ? '' : 's'} →</span>${['A', 'B', 'C', 'D'].map(k => `<span class="chip" aria-pressed="${counts[k] > 0}">${counts[k]} ${k}</span>`).join('')}</div>
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
  const renderRecipes = (d, counts) => {
    const ar = data.archetypes, p = data.portfolio, o = data.overlays;
    const cards = ['A', 'B', 'C', 'D'].filter(k => d.alloc[k] > 0).map(k => {
      const a = ar[k], m = SCRIPT_META[k];
      const banners = [];
      if (d.ov.shootout) banners.push(`<div class="sd-ovl-banner"><b>E overlay</b><span>${esc(ar.E.overlay)} · captains ${esc(ar.E.captain)} · shape ${ar.E.shape.join('/')}</span></div>`);
      if (d.ov.grind) banners.push(`<div class="sd-ovl-banner"><b>F overlay</b><span>${esc(ar.F.overlay)} · captain ${esc(ar.F.captain)} · shape ${ar.F.shape.join('/')}</span></div>`);
      return `<div class="card sd-recipe">
        <div class="sd-recipe-top">
          <div><div class="sd-recipe-script">Script ${k} · ${Math.round(d.alloc[k])}%</div><div class="sd-recipe-name">${esc(a.name)}</div><div class="sd-caption">trigger: ${esc(a.trigger)}</div></div>
          <div class="sd-recipe-count">${counts[k]}<small>lineup${counts[k] === 1 ? '' : 's'}</small></div>
        </div>
        <div class="sd-recipe-cpt"><small>Captain</small>${esc(a.captain)}</div>
        <div class="sd-tmpl">${a.shape.map(s => `<span class="sd-chip-n">${esc(s)}</span>`).join('')}<span class="sd-chip-n">K ${a.k}%</span><span class="sd-chip-n">DST ${a.dst}%</span></div>
        <div class="sd-recipe-lines">
          <div><span>Flex</span><span>${esc(a.flex)}</span></div>
          <div><span>K / DST</span><span>K in ${a.k}% of these winners · DST in ${a.dst}%${d.ov.shootout ? ` · shootout dials K ${range(p.k_share.shootout)} / DST ${range(p.dst_share.shootout)}` : d.ov.grind ? ` · grind dials K ${range(p.k_share.grind)} / DST ${range(p.dst_share.grind)}` : ''}</span></div>
          <div><span>Bring-back</span><span>${esc(m.bring)}</span></div>
        </div>
        <div class="sd-say">Captain ${esc(m.seat)} wins because ${esc(m.because)}; the flex is ${esc(a.flex.split(';')[0])}; the bring-back is ${esc(m.bring.split(' — ')[0].split(' (')[0])}.</div>
        ${banners.join('')}
        ${tmplChips(m.tmpl)}
      </div>`;
    });
    $id('sdRecipes').innerHTML = `<div class="sd-recipes">${cards.join('')}</div>
      <div class="sd-caption" style="margin-top:8px">Recipes from the codex archetypes A–D · include/avoid chips from the captain templates (winner rates) · E/F show as banners on the cards they modify</div>`;
  };

  const renderDials = d => {
    $id('sdDials').innerHTML = `
      <div class="card-title">Dials · <span class="card-title-accent">enter these in the Contest Generator</span></div>
      <table class="sd-dials"><thead><tr><th>Dial</th><th>Target</th><th>Why</th></tr></thead><tbody>
        ${d.dials.rows.map(r => `<tr><td>${esc(r.k)}</td><td class="v${r.adj ? ' adj' : ''}">${esc(r.v)}</td><td>${esc(r.note || '')}</td></tr>`).join('')}
      </tbody></table>
      <div class="sd-caption">portfolio dials from rules.json v1.2 · gold = overlay-adjusted for this slate · dupes cap by field size</div>`;
  };

  const renderLaws = d => {
    const laws = data.ten_laws.slice().sort((a, b) => (d.laws.has(b.n) - d.laws.has(a.n)) || a.n - b.n);
    $id('sdLaws').innerHTML = `
      <div class="card-title">Ten laws · <span class="card-title-accent">${[...d.laws].sort((a, b) => a - b).join(', ')} pinned for this cell</span></div>
      <div class="sd-laws">${laws.map(l => `<details class="sd-law${d.laws.has(l.n) ? ' pinned' : ''}" ${d.laws.has(l.n) ? 'open' : ''}><summary><span class="no">${l.n}</span><span>${esc(l.law)}</span></summary><p>${esc(l.evidence)}</p></details>`).join('')}</div>`;
  };

  /* ---------- Step 4: ship it ---------- */
  const renderFit = d => {
    const ct = data.inputs.contest_types.find(c => c.key === state.contest);
    const sf = data.contest_fit_small_field;
    const small = state.contest === 'se_small' ? `
      <div class="sd-small-field" role="img" aria-label="Small-field study: QB under 10% owned in ${sf.qb_under_10pct.winners} of winners vs ${sf.qb_under_10pct.field} of the field">
        <div><b>${esc(sf.qb_under_10pct.winners)}</b><span>QB under 10% owned</span><em>field ${esc(sf.qb_under_10pct.field)}</em></div>
        <div><b>${esc(sf.qb_plus_2.winners)}</b><span>QB + 2 own catchers</span><em>field ${esc(sf.qb_plus_2.field)}</em></div>
        <div><b>${esc(sf.run_back.power_sweep)}</b><span>Run-back · Power Sweep</span><em>Spy: ${esc(sf.run_back.spy)}</em></div>
        <div><b>${sf.total_own.power_sweep}% / ${sf.total_own.spy}%</b><span>Total own · PS / Spy</span></div>
        <div><b>${esc(sf.te_under_4k_spy)}</b><span>TE under $4k (Spy)</span><em>flex RB ${esc(sf.flex_rb)}</em></div>
        <div><b>${esc(sf.dupes)}</b><span>Winners duplicated</span><em>sim ROI+ ${esc(sf.sim_roi_positive)}</em></div>
      </div>
      <div class="sd-caption">${esc(sf.source)}</div>` : '';
    $id('sdFit').innerHTML = `
      <div class="card-title">Contest fit · <span class="card-title-accent">${esc(ct.label)}</span></div>
      <div class="sd-fit-row">
        <div class="sd-fit-big">${esc(ct.own_target)}<small>cumulative ownership target</small></div>
        <div class="sd-fit-big">≤ ${ct.dupe_cap}<small>dupe gate</small></div>
      </div>
      ${ct.note ? `<p class="sd-lede">${esc(ct.note)}</p>` : ''}
      ${small}
      <div class="sd-caption">contest fit from the codex contest table · dupes: ${esc(data.ten_laws[9].evidence)}</div>`;
  };

  const renderCheck = () => {
    const h = data.hard_rules, s = data.soft_penalties;
    const items = Object.keys(h).filter(k => !k.startsWith('_')).map(k => ({ k, label: (HARD_LABELS[k] || (v => `${humanize(k)}: ${v}`))(h[k]) }));
    const soft = Object.keys(s).filter(k => !k.startsWith('_')).map(k => { const v = s[k]; const pen = typeof v === 'object' ? v.penalty : v; return `<span class="sd-chip-n" title="${esc(k)}">${esc(humanize(k))}${pen != null ? ` −${pen}` : ''}</span>`; });
    $id('sdCheck').innerHTML = `
      <div class="card-title">Would the engine reject this? · <span class="card-title-accent">${items.length} hard rules</span></div>
      <div class="sd-check">${items.map(i => `<label><input type="checkbox" data-check="${esc(i.k)}"><span>${esc(i.label)}</span><small>${esc(i.k)}</small></label>`).join('')}</div>
      <div class="card-title" style="margin-top:8px">The engine would frown at</div>
      <div class="sd-frown">${soft.join('')}</div>
      <div class="sd-caption">hard_rules + soft_penalties from rules.json v1.2 · a soft penalty is subtracted from the lineup score (1.0 ≈ one sim-rank bucket)</div>`;
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
    L.push(`  Laws pinned: ${[...d.laws].sort((a, b) => a - b).map(n => `${n}. ${data.ten_laws[n - 1].law}`).join(' | ')}`);
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
  const copy = async (text, btn) => {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {}
    if (!ok) { try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch {} }
    const old = btn.textContent; btn.textContent = ok ? 'Copied ✓' : 'Copy failed'; setTimeout(() => { btn.textContent = old; }, 1600);
  };
  const renderExport = () => {
    $id('sdExport').innerHTML = `
      <div class="card-title">Export</div>
      <div class="sd-export">
        <button type="button" class="btn btn-primary" data-copy="playbook">Copy playbook</button>
        <button type="button" class="btn" data-copy="stokastic">Copy Stokastic settings</button>
      </div>
      <div class="sd-caption">plain text of steps 2–4 for this slate · the settings block is the dials table</div>`;
  };

  /* ---------- master render ---------- */
  const render = () => {
    if (!data) return;
    const d = derive();
    renderInputs();
    renderScript(d); renderTotalStrip(d); renderOverlays(d); renderWinners(d); renderCheat(d);
    renderShortlist(d);
    const counts = renderAlloc(d);
    renderRecipes(d, counts); renderDials(d); renderLaws(d);
    renderFit(d); renderCheck(); renderExport(); renderLessons();
    store.save(state);
  };

  /* ---------- events ---------- */
  const setNum = (key, v, lo, hi) => { v = parseFloat(v); if (isNaN(v)) return; state[key] = Math.max(lo, Math.min(hi, key === 'entries' ? Math.round(v) : Math.round(v * 2) / 2)); state.preset = null; };
  const bind = () => {
    document.addEventListener('click', e => {
      const p = e.target.closest('[data-group]');
      if (p) {
        const g = p.dataset.group, k = p.dataset.key;
        if (g === 'spread') { state.spread = SPREAD_REP[k]; state.preset = null; }
        else if (g === 'total') { state.total = TOTAL_REP[k]; state.preset = null; state.realized = null; }
        else if (g === 'env') { state.env = k; state.preset = null; }
        else if (g === 'contest') state.contest = k;
        else if (g === 'entries') state.entries = ENTRY_PILLS.find(x => x.key === k).rep;
        else if (g === 'lean') state.lean = k;
        else if (g === 'preset') { const s = slates.find(x => x.id === k); if (s) { state.spread = s.spread; state.total = s.total; state.env = s.env; state.preset = s.id; state.realized = null; } }
        render(); return;
      }
      const v = e.target.closest('[data-view]'); if (v) { state.view = v.dataset.view; render(); return; }
      const r = e.target.closest('[data-realized]'); if (r) { state.realized = r.dataset.realized; render(); return; }
      const c = e.target.closest('[data-copy]'); if (c) { const d = derive(); copy(c.dataset.copy === 'playbook' ? playbookText(d) : stokasticText(d), c); return; }
      if (e.target.closest('#sdReset')) { store.clear(); Object.assign(state, { spread: 7.5, total: 48.5, env: 'dome', contest: 'se_small', entries: 1, lean: 'none', preset: null, realized: null }); render(); }
    });
    const onNum = (id, key, lo, hi) => { const el = $id(id); const h = () => { setNum(key, el.value, lo, hi); if (key === 'total') state.realized = null; render(); }; el.addEventListener('change', h); el.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); h(); el.blur(); } }); };
    onNum('sdSpreadNum', 'spread', 0, 30); onNum('sdTotalNum', 'total', 20, 80); onNum('sdEntriesNum', 'entries', 1, 150);
  };

  const showError = msg => {
    const host = $id('sdError'); if (!host) return;
    host.hidden = false;
    host.innerHTML = `<div class="card sd-error"><h3>Playbook data didn't load</h3><p class="sd-lede">${esc(msg)} — the page reads <code>${DATA_PATH}</code>. Refresh, or check the deploy.</p></div>`;
    const page = $id('sdPage'); if (page) page.hidden = true;
  };

  const init = async () => {
    try {
      const res = await fetch(DATA_PATH, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
      if (!data || !data.base_rates || !data.archetypes) throw new Error('unexpected JSON shape');
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
    const v = $id('sdVersion'); if (v) v.textContent = data.meta.version;
    bind();
    render();
  };

  // Public surface (also used by the verification harness).
  window.BBI.showdown = { bucketSpread, bucketTotal, expectedSpreadRow, expectedTotalRow, cheatCell, envRow, roofRow, overlaysFor, allocationFor, largestRemainder, shortlistFor, dialsFor, pinnedLawsFor, LEANS, state, get data() { return data; }, render, init,
    playbookText: () => playbookText(derive()), stokasticText: () => stokasticText(derive()) };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
