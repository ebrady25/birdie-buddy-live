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
  const SLATES_PATH = 'nfl/showdown/showdown_slates.json';
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
        <div class="sd-vd"><span>Script</span><b>${r.script} game</b><small>${r.scriptPct}% most likely · ${r.runner.toLowerCase()} ${r.runnerPct}% next</small></div>
        <div class="sd-vd"><span>Points</span><b>${r.mean} mean</b><small>${esc(d.totalBucket.label)} total band · line ${num(state.total)}</small></div>
        <div class="sd-vd"><span>Environment</span><b>${esc(ENV_LABEL[state.env])}</b><small>over rate ${data.base_rates.weather[state.env].over_rate}%</small></div>
        <div class="sd-vd"><span>Overlay</span><b>${r.ovs.length ? r.ovs.join(' + ') : 'None'}</b><small>${r.ovs.length ? 'changes the dials below' : 'base allocation applies'}</small></div>
      </div>`;
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
        <button type="button" role="tab" data-view="expected" class="${state.view === 'expected' ? 'active' : ''}" aria-selected="${state.view === 'expected'}">Build for the distribution</button>
        <button type="button" role="tab" data-view="realized" class="${state.view === 'realized' ? 'active' : ''}" aria-selected="${state.view === 'realized'}">If you're right about the game</button>
      </div></div>`;
    let body;
    if (state.view === 'expected') {
      const sk = expectedSpreadRow(d.sb), tk = expectedTotalRow(d.tb, state.total);
      const sr = data.winners_by_expected_script[sk], tr = data.winners_by_expected_script[tk];
      body = `<p class="sd-lede">Winners in games the market priced like this one — the view you build the batch for.</p>
        <div class="sd-grid-2">
          ${winnerCol(`Spread ${esc(d.spreadBucket.label)} · <span style="color:var(--text-dimmed)">${sk}</span>`, sr, sr.n, src)}
          ${winnerCol(`Total ${esc(d.totalBucket.label)} · <span style="color:var(--text-dimmed)">${tk}</span>`, tr, tr.n, src)}
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
            <span class="bar"><span class="bar-fill" style="width:${v / max * 100}%"></span></span>
            <span class="sd-script-tile-sub">of games at this spread</span>
          </button>`; }).join('')}</div>
        <div class="sd-grid-2">${winnerCol(`${esc(cur.label)} · <span style="color:var(--text-dimmed)">${cur.key}</span>`, rr, rr.n, src)}
          <div class="sd-winner-col" style="justify-content:center"><h4>Read it</h4>
            <div class="sd-kpis">
              <div class="sd-kpi"><b>${rr.cpt_fav}%</b><span>CPT from the favorite</span></div>
              <div class="sd-kpi"><b>${rr.five_one_fav}%</b><span>5-1 fav shape</span></div>
              <div class="sd-kpi"><b>${rr.both_qb}%</b><span>both QBs</span></div>
              <div class="sd-kpi"><b>${rr.dog_qb_in_lineup}%</b><span>dog QB in lineup</span></div>
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
    const heat = (v, max) => { const lvl = v <= 0 ? 0 : Math.min(5, Math.max(1, Math.ceil(v / max * 5))); return `<span class="sd-heat" data-level="${lvl}"><b>${v}</b></span>`; };
    // one intensity scale per table so cells compare across the whole grid
    const maxPos = Math.max(...Object.values(c).flatMap(r => Object.values(r).flatMap(v => POS.map(k => v[k]))));
    const cell = (r, col) => { const v = c[r][col]; const on = r === d.cell.row && col === d.cell.col;
      return `<div class="sd-hcell${on ? ' active' : ''}" ${on ? 'aria-current="true"' : ''}>
        <span class="sd-hcell-tag">${rowLabel[r]} · ${col === 'total_ge46' ? 'total ≥46' : 'total ≤45.5'}</span>
        <div class="sd-heat-row">${POS.map(k => `<span class="sd-heat-k">${k}</span>${heat(v[k], maxPos)}`).join('')}</div>
        <div class="sd-cell-foot">fav CPT <b>${v.fav}%</b> · K <b>${v.K}%</b></div></div>`; };
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
        <div class="sd-seat">
          <span class="sd-seat-rank">SEAT ${i + 1}</span>
          <span class="sd-seat-name">${esc(seatName(d.preset, s.seat) || s.seat)}${seatName(d.preset, s.seat) ? `<small>${esc(s.seat)}</small>` : ''}</span>
          <span class="sd-seat-big">≈${Math.round(s.weight)}%<small>of winners here</small></span>
          <span class="bar bar-thick"><span class="bar-fill" style="width:${s.weight / max * 100}%"></span></span>
          <span class="sd-seat-share">${s.pos} CPT ${s.posShare}% × ${s.side} ${s.sideShare}%</span>
          <span class="sd-seat-why">${esc(s.why)}</span>
        </div>`; }).join('')}</div>
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
    const odds = scriptOdds(data.base_rates.by_spread[d.sb]);
    const cards = ['A', 'B', 'C', 'D'].filter(k => d.alloc[k] > 0).map(k => {
      const a = ar[k], m = SCRIPT_META[k];
      const banners = [];
      if (d.ov.shootout) banners.push(`<div class="sd-ovl-banner"><b>E · Shootout</b><span>${esc(ar.E.overlay)} · captains ${esc(ar.E.captain)} · shape ${ar.E.shape.join('/')}</span></div>`);
      if (d.ov.grind) banners.push(`<div class="sd-ovl-banner"><b>F · Grind</b><span>${esc(ar.F.overlay)} · captain ${esc(ar.F.captain)} · shape ${ar.F.shape.join('/')}</span></div>`);
      const kDial = d.ov.grind ? p.k_share.grind : d.ov.shootout ? p.k_share.shootout : null;
      const dDial = (d.ov.grind || d.ov.wind) ? p.dst_share.grind : d.ov.shootout ? p.dst_share.shootout : null;
      const t = data.captain_templates[m.tmpl];
      return `<div class="card sd-recipe">
        <div class="sd-recipe-head">
          <span class="sd-script-badge">${k}</span>
          <div class="sd-recipe-title"><div class="sd-recipe-name">${esc(a.name)}</div><div class="sd-recipe-trig">fires: ${esc(a.trigger)}</div></div>
          <div class="sd-recipe-count">${counts[k]}<small>of ${state.entries} lineup${state.entries === 1 ? '' : 's'}</small></div>
        </div>
        <div class="sd-recipe-odds">
          <div class="sd-odd"><span class="sd-odd-k">Batch share</span><span class="bar"><span class="bar-fill" style="width:${d.alloc[k]}%"></span></span><b>${Math.round(d.alloc[k])}%</b></div>
          <div class="sd-odd"><span class="sd-odd-k">Happens</span><span class="bar"><span class="bar-fill dim" style="width:${odds[k]}%"></span></span><b>${Math.round(odds[k])}%</b><span class="sd-odd-n">of ${esc(d.spreadBucket.label.toLowerCase())} games</span></div>
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
        ${t ? `<details class="sd-fold"><summary>Captain template ${m.tmpl} · ${t.include.length} include · ${t.avoid.length} avoid <span class="sd-fold-arrow">▸</span></summary><div class="sd-tmpl-groups">
          <div class="sd-tmpl-group"><span class="sd-tmpl-k">include</span><div class="sd-tmpl">${t.include.map(x => `<span class="sd-chip-ok">✓ ${esc(chipLabel(x))}</span>`).join('')}</div></div>
          <div class="sd-tmpl-group"><span class="sd-tmpl-k">avoid</span><div class="sd-tmpl">${t.avoid.map(x => `<span class="sd-chip-no">✗ ${esc(chipLabel(x))}</span>`).join('')}</div></div>
          <div class="sd-tmpl-group"><span class="sd-tmpl-k">template rates</span><div class="sd-tmpl">${t.shapes.map(x => `<span class="sd-chip-n">${esc(x)}</span>`).join('')}<span class="sd-chip-n">K ${pct(t.k_rate)}</span><span class="sd-chip-n">DST ${pct(t.dst_rate)}</span></div></div>
        </div></details>` : ''}
      </div>`;
    });
    $id('sdRecipes').innerHTML = `<div class="sd-recipes">${cards.join('')}</div>
      <div class="sd-caption" style="margin-top:8px">Recipes from the codex archetypes A–D · "happens" = how often the script occurs at this spread (2,761 games) · include/avoid chips are captain-template winner rates · E/F overlays banner the cards they modify</div>`;
  };

  const renderDials = d => {
    const bar = r => r.bar ? `<span class="sd-dial-bar" aria-hidden="true"><i style="left:${Math.round(r.bar[0] * 100)}%;width:${Math.max(2, Math.round((r.bar[1] - r.bar[0]) * 100))}%"></i></span>` : '';
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
    const law = (l, open) => `<details class="sd-law${open ? ' pinned' : ''}" ${open ? 'open' : ''}><summary><span class="no">${l.n}</span><span>${esc(l.law)}</span></summary><p>${esc(l.evidence)}</p></details>`;
    $id('sdLaws').innerHTML = `
      <div class="card-title">Ten laws · <span class="card-title-accent">${pinned.map(l => l.n).join(', ')} pinned for this cell</span></div>
      <div class="sd-laws">${pinned.map(l => law(l, true)).join('')}</div>
      <details class="sd-fold"><summary>The other ${rest.length} laws <span class="sd-fold-arrow">▸</span></summary><div class="sd-laws" style="margin-top:8px">${rest.map(l => law(l, false)).join('')}</div></details>`;
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
      <p class="sd-lede">Tick your lineup against the rules the engine enforces before it scores anything.</p>
      <details class="sd-fold"><summary>Open the ${items.length}-rule checklist <span class="sd-fold-arrow">▸</span></summary>
      <div class="sd-check" style="margin-top:8px">${items.map(i => `<label><input type="checkbox" data-check="${esc(i.k)}"><span>${esc(i.label)}</span><small>${esc(i.k)}</small></label>`).join('')}</div></details>
      <details class="sd-fold"><summary>The engine would frown at · ${soft.length} soft penalties <span class="sd-fold-arrow">▸</span></summary>
      <div class="sd-frown" style="margin-top:8px">${soft.join('')}</div></details>
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
  // Play card image: verdict strip + one block per script, drawn on a canvas (no library).
  const playCardPng = async d => {
    const counts = largestRemainder(d.alloc, state.entries);
    const ct = data.inputs.contest_types.find(c => c.key === state.contest);
    const r = gameRead(d);
    const scripts = ['A', 'B', 'C', 'D'].filter(k => d.alloc[k] > 0);
    const W = 1200, S = 2, pad = 48, colW = (W - pad * 2 - 24) / 2;
    const rows = Math.ceil(scripts.length / 2), cardH = 272, H = 330 + rows * (cardH + 24) + 70;
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
    // script cards
    scripts.forEach((k, i) => { const a = data.archetypes[k], m = SCRIPT_META[k]; const x = pad + (i % 2) * (colW + 24), y = 290 + Math.floor(i / 2) * (cardH + 24);
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
  const sharePng = async (mode, btn) => {
    const old = btn.textContent; btn.textContent = 'Rendering…';
    try {
      const blob = await playCardPng(derive());
      if (mode === 'copy' && navigator.clipboard && window.ClipboardItem) { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); btn.textContent = 'Copied image ✓'; }
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `showdown-playcard-${(state.preset || 'custom')}-${num(state.spread)}-${num(state.total)}.png`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); btn.textContent = 'Downloaded ✓'; }
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
      <div class="sd-caption">text = steps 2–4 for this slate · play card = the one-glance strip + the script cards as one image for Discord</div>`;
  };

  /* ---------- master render ---------- */
  const render = () => {
    if (!data) return;
    const d = derive();
    renderInputs();
    renderRead(d); renderScript(d); renderTotalStrip(d); renderOverlays(d); renderWinners(d); renderCheat(d);
    renderShortlist(d);
    const counts = renderAlloc(d);
    renderVerdict(d, counts); renderRecipes(d, counts); renderDials(d); renderLaws(d);
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
      const sh = e.target.closest('[data-share]'); if (sh) { sharePng(sh.dataset.share, sh); return; }
      if (e.target.closest('[data-print]')) { window.print(); return; }
      const c = e.target.closest('[data-copy]'); if (c) { const d = derive(); copy(c.dataset.copy === 'playbook' ? playbookText(d) : stokasticText(d), c); return; }
      if (e.target.closest('[data-edit]')) { e.preventDefault(); document.getElementById('step1')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
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
    playbookText: () => playbookText(derive()), stokasticText: () => stokasticText(derive()), playCardPng: () => playCardPng(derive()) };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
