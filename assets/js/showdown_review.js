/* =====================================================================
   BIRDIEBUDDY — SHOWDOWN TUESDAY REVIEW (Step 5)
   Drop a DraftKings contest-standings CSV (the same export as the
   codex's data/dk_standings) and optionally your DK username:
     · the winner's lineup, graded by the engine against the slate line
     · the cut ladder for that contest
     · field vs top 1% for that contest — the entry tagging is a port of
       codex/field_composition.py (classify / feature_row / the cohort
       loop); tools/showdown_review_parity.py proves JS = Python on a file
     · your entries: rank, percentile and codex grade
   Files are read in the browser; nothing is uploaded.

   Part 1 (pure, no DOM) loads as BBI.showdownReview or via require().
   Part 2 (the Step 5 card) runs only in the browser.
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.BBI = root.BBI || {}; root.BBI.showdownReview = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- constants (mirrors of field_composition.py) ---------------- */
  const DST_NICK = { Cardinals: 'ARI', Falcons: 'ATL', Ravens: 'BAL', Bills: 'BUF', Panthers: 'CAR', Bears: 'CHI', Bengals: 'CIN',
    Browns: 'CLE', Cowboys: 'DAL', Broncos: 'DEN', Lions: 'DET', Packers: 'GB', Texans: 'HOU', Colts: 'IND',
    Jaguars: 'JAX', Chiefs: 'KC', Raiders: 'LV', Chargers: 'LAC', Rams: 'LAR', Dolphins: 'MIA', Vikings: 'MIN',
    Patriots: 'NE', Saints: 'NO', Giants: 'NYG', Jets: 'NYJ', Eagles: 'PHI', Steelers: 'PIT', '49ers': 'SF',
    Seahawks: 'SEA', Buccaneers: 'TB', Titans: 'TEN', Commanders: 'WAS' };
  const COHORTS = [['field', null], ['top20', 0.20], ['top5', 0.05], ['top1', 0.01], ['top0.1', 0.001], ['winner', 0]];
  const TIERS = ['lt10', '10_25', 'ge25'];
  const tier = o => o < 10 ? 'lt10' : o < 25 ? '10_25' : 'ge25';
  const FLAGS = ['own_QB', 'own_RB', 'own_WR', 'own_TE', 'own_K', 'own_DST', 'opp_QB', 'opp_RB', 'opp_WR', 'opp_TE', 'opp_K', 'opp_DST',
    'own_second_catcher', 'own_second_rb', 'own_second_te', 'both_qbs'];
  const POS6 = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'], SPLITS = ['6-0', '5-1', '4-2', '3-3', '2-4', '1-5'];
  const UNCOND = [...POS6.map(p => 'cpt_pos_' + p), ...SPLITS.map(s => 'split_' + s), 'four_two', 'three_three', 'K', 'two_K', 'DST', 'both_qb'];
  const sided = T => ['cpt_fav', 'five_one_fav', 'dog_qb_in_lineup', 'script_A', 'script_B', 'script_C', 'script_D', 'shape_on_template', ...Object.keys(T).map(k => 'ctype_' + k)];
  const COND = [...FLAGS.slice(0, 12), 'own_second_catcher', 'own_second_rb', 'own_second_te', 'both_qb', 'shape_on_template'];
  const templatesOf = ct => Object.fromEntries(Object.entries(ct || {}).filter(([k]) => !k.startsWith('_')));

  /* ---------------- parsing ---------------- */
  // One CSV line (csv.reader semantics for quoted fields; standings rows never span lines).
  const splitLine = line => {
    if (line.indexOf('"') < 0) return line.split(',');
    const out = []; let f = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"') { if (line[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"' && f === '') q = true;
      else if (ch === ',') { out.push(f); f = ''; }
      else f += ch;
    }
    out.push(f); return out;
  };
  const isStandings = text => /^\uFEFF?Rank,EntryId,EntryName/.test(String(text).slice(0, 60));
  // read_standings(): entries [rank, entryId, entryName, points, lineup] + the %Drafted table (FLEX / CPT).
  const parseStandings = text => {
    const lines = String(text).split(/\r?\n/);
    const entries = [], flexOwn = new Map(), cptOwn = new Map(), fpts = new Map();
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]; if (!line) continue;
      const row = splitLine(line);
      if (row.length >= 10 && row[7]) {
        const v = parseFloat(row[9].replace(/%+$/, '')) || 0, nm = row[7].trim();
        (row[8] === 'CPT' ? cptOwn : flexOwn).set(nm, v);
        if (row[8] !== 'CPT' && row.length > 10) fpts.set(nm, parseFloat(row[10]) || 0);
      }
      if (row[0] && row.length > 5 && row[5].trim()) entries.push([parseInt(row[0], 10), row[1], row[2], parseFloat(row[4] || 0) || 0, row[5].trim()]);
    }
    return { entries, flexOwn, cptOwn, fpts };
  };
  // "CPT A FLEX B FLEX C …" → [['CPT','A'], ['FLEX','B'], …] (LINEUP_RE of field_composition.py).
  const parseLineup = lu => [...String(lu).matchAll(/(CPT|FLEX)\s+(.+?)(?=\s+(?:CPT|FLEX)\s|\s*$)/g)].map(m => [m[1], m[2].trim()]);
  const baseName = en => String(en || '').replace(/\s*\(\d+\/\d+\)$/, '');

  /* ---------------- players ---------------- */
  // reg: Map name → [pos, team] (a slate pool, a DK salary file, …). Returns name → [pos, team] for this contest.
  const resolver = (reg, teams) => name => {
    const n = String(name).trim();
    if (DST_NICK[n] && teams.includes(DST_NICK[n])) return ['DST', DST_NICK[n]];
    const r = reg.get(n);
    return r && teams.includes(r[1]) ? r : null;
  };
  // The two teams: ownership-weighted votes over the %Drafted table (field_composition.py), from what reg can place.
  const teamsFor = (names, reg, flexOwn, cptOwn) => {
    const votes = new Map();
    for (const n of names) {
      const hit = DST_NICK[n] ? [['DST', DST_NICK[n]]] : reg.has(n) ? [reg.get(n)] : [];
      for (const [, t] of hit) votes.set(t, (votes.get(t) || 0) + (flexOwn.get(n) || 0) + (cptOwn.get(n) || 0));
    }
    return [...votes].sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]);
  };
  const ownershipNames = S => new Set([...S.flexOwn.keys(), ...S.cptOwn.keys()]);
  // Can this player list (a slate pool, Your slate, a DK salary file) place this contest? Only when its own
  // players (not a DST nickname, which vouches for any team) cover both teams, it places ≥ MATCH_MIN of the
  // contest's ownership (%Drafted FLEX + CPT), and — for a slate pool — the two teams are that slate's game.
  // A pool that shares one team with the contest (last week's opponent, this week's game) fails all three.
  const MATCH_MIN = 0.9;
  const matchList = (S, list, slate) => {
    const reg = new Map(list.map(p => [p.name, [p.pos, p.team]])), names = [...ownershipNames(S)];
    const teams = teamsFor(names, reg, S.flexOwn, S.cptOwn);
    if (teams.length !== 2) return null;
    const own = new Set(names.filter(n => reg.has(n)).map(n => reg.get(n)[1]));
    if (!teams.every(t => own.has(t))) return null;
    if (slate && !(teams.includes(slate.fav) && teams.includes(slate.dog))) return null;
    const place = resolver(reg, teams), w = n => (S.flexOwn.get(n) || 0) + (S.cptOwn.get(n) || 0);
    let tot = 0, hit = 0;
    for (const n of names) { tot += w(n); if (place(n)) hit += w(n); }
    const cov = tot > 0 ? hit / tot : names.filter(n => place(n)).length / Math.max(1, names.length);
    return cov >= MATCH_MIN ? { reg, teams, place, cov } : null;
  };

  /* ---------------- tagging: classify() + feature_row() of field_composition.py ---------------- */
  const classify = (names, P, fav, dog, T) => {
    const c = P.get(names[0]), fl = names.slice(1).map(n => P.get(n)), ownT = c[1];
    const d = new Map(), qbs = new Set(); let ownCatch = 0;
    const dd = k => d.get(k) || 0;
    if (c[0] === 'QB') qbs.add(ownT);
    for (const [pos, team] of fl) {
      const rel = team === ownT ? 'own' : 'opp'; d.set(`${rel}_${pos}`, dd(`${rel}_${pos}`) + 1);
      if (pos === 'QB') qbs.add(team);
      if (rel === 'own' && (pos === 'WR' || pos === 'TE')) ownCatch++;
    }
    const nOwn = 1 + fl.filter(([, t]) => t === ownT).length;
    const f = { own_QB: dd('own_QB') > 0, own_RB: dd('own_RB') > 0, own_WR: dd('own_WR') > 0, own_TE: dd('own_TE') > 0, own_K: dd('own_K') > 0, own_DST: dd('own_DST') > 0,
      opp_QB: dd('opp_QB') > 0, opp_RB: dd('opp_RB') > 0, opp_WR: dd('opp_WR') > 0, opp_TE: dd('opp_TE') > 0, opp_K: dd('opp_K') > 0, opp_DST: dd('opp_DST') > 0,
      own_second_catcher: ownCatch >= (c[0] !== 'WR' && c[0] !== 'TE' ? 2 : 1), own_second_rb: dd('own_RB') >= (c[0] === 'RB' ? 1 : 2),
      own_second_te: dd('own_TE') >= (c[0] !== 'TE' ? 2 : 1), both_qbs: qbs.size === 2 };
    const kN = dd('own_K') + dd('opp_K'), dstN = dd('own_DST') + dd('opp_DST'), split = `${nOwn}-${6 - nOwn}`;
    const X = { cpt_pos: c[0], split, K: kN > 0, two_K: kN >= 2, DST: dstN > 0, both_qb: f.both_qbs, four_two: split === '4-2', three_three: split === '3-3' };
    for (const k of Object.keys(f)) if (k !== 'both_qbs') X[k] = f[k];
    if (fav) {
      const side = ownT === fav ? 'FAV' : 'DOG', favN = side === 'FAV' ? nOwn : 6 - nOwn;
      const dogQb = [c, ...fl].some(([p, t]) => p === 'QB' && t === dog), favCpt = side === 'FAV';
      let tag;
      if (favCpt && favN >= 5) tag = 'A';
      else if (favCpt && favN === 4 && !dogQb && !(dd('own_K') || dd('own_DST'))) tag = 'A';
      else if (favCpt && !f.both_qbs) tag = 'B';
      else if (favCpt) tag = 'C';
      else if (favN <= 2) tag = 'D';
      else tag = f.both_qbs ? 'C' : 'D';
      const ctype = `${c[0]}_${side}`, t = T[ctype];
      Object.assign(X, { side, ctype, cpt_fav: favCpt, five_one_fav: split === '5-1' && favCpt, dog_qb_in_lineup: dogQb, tag, shape_on_template: !!t && t.shapes.includes(split) });
      if (t) { const inc = t.include.filter(k => f[k]).length, avd = t.avoid.filter(k => f[k]).length; X.fit = inc / t.include.length - 0.5 * avd / Math.max(1, t.avoid.length); }
    }
    return X;
  };
  const featureRow = (X, T) => {
    const r = {};
    for (const p of POS6) r['cpt_pos_' + p] = X.cpt_pos === p;
    for (const s of SPLITS) r['split_' + s] = X.split === s;
    for (const k of ['four_two', 'three_three', 'K', 'two_K', 'DST', 'both_qb', ...FLAGS.slice(0, 12), 'own_second_catcher', 'own_second_rb', 'own_second_te']) r[k] = X[k];
    if ('side' in X) {
      Object.assign(r, { cpt_fav: X.cpt_fav, five_one_fav: X.five_one_fav, dog_qb_in_lineup: X.dog_qb_in_lineup, shape_on_template: X.shape_on_template, ctype: X.ctype });
      for (const s of 'ABCD') r['script_' + s] = X.tag === s;
      for (const k of Object.keys(T)) r['ctype_' + k] = X.ctype === k;
    }
    return r;
  };

  /* ---------------- one contest: tags, cohorts, cuts ---------------- */
  // S = parseStandings(), place = resolver(). Tags every entry once per unique lineup (dupes share a rank).
  const tagContest = (S, place, fav, dog, T) => {
    const P = new Map(), unresolved = new Map();
    for (const n of ownershipNames(S)) { const r = place(n); if (r) P.set(n, r); }
    const cache = new Map(), recs = [];
    const groups = new Map();                                   // (lineup, rank) → count, like Counter((lu, rk))
    for (const e of S.entries) { const k = e[4] + '\u0001' + e[0]; groups.set(k, (groups.get(k) || 0) + 1); }
    for (const [k, cnt] of groups) {
      const cut = k.lastIndexOf('\u0001'), lu = k.slice(0, cut), rk = +k.slice(cut + 1);
      if (!cache.has(lu)) {
        const ps = parseLineup(lu), nm = ps.map(x => x[1]);
        if (nm.length !== 6 || ps[0][0] !== 'CPT' || nm.some(p => !P.has(p))) cache.set(lu, null);
        else {
          const X = classify(nm, P, fav, dog, T), fr = featureRow(X, T);
          fr.cpt_own = S.cptOwn.get(nm[0]) || 0; fr.tier = tier(fr.cpt_own);
          cache.set(lu, { X, fr });
        }
      }
      const hit = cache.get(lu);
      if (!hit) { for (const [, p] of parseLineup(lu)) if (!P.has(p)) unresolved.set(p, (unresolved.get(p) || 0) + cnt); continue; }
      recs.push({ fr: hit.fr, rank: rk, w: cnt });
    }
    const placed = recs.reduce((a, r) => a + r.w, 0);
    return { P, cache, recs, N: S.entries.length, unique: new Set(S.entries.map(e => e[4])).size, placed, unresolvedEntries: S.entries.length - placed, unresolved, fav, dog };
  };
  // The cohort loop of field_composition.py main(): per cohort × captain-own tier, counts per feature
  // (and, with a line, per captain type × conditional feature). Returns Map key "cohort|feature|tier" → {n, c}.
  // opts.cond = false skips the captain-type × conditional rows (the page's table doesn't show them).
  const cohorts = (tc, T, opts = {}) => {
    const out = new Map(), N = tc.N, fav = tc.fav, cond = opts.cond !== false;
    const feats = tc.recs.length ? [...UNCOND, ...(fav ? sided(T) : [])] : [];
    for (const [coh, p] of COHORTS) {
      const thr = p == null ? N : p === 0 ? 1 : Math.max(1, N * p);
      const sub = tc.recs.filter(r => r.rank <= thr);
      for (const tr of ['all', ...TIERS]) {
        const s2 = tr === 'all' ? sub : sub.filter(r => r.fr.tier === tr);
        const n = s2.reduce((a, r) => a + r.w, 0); if (!n) continue;
        for (const f of feats) out.set(`${coh}|${f}|${tr}`, { n, c: s2.reduce((a, r) => a + (r.fr[f] ? r.w : 0), 0) });
        if (!fav || !cond) continue;
        const byCt = new Map(); for (const r of s2) { const k = r.fr.ctype; if (!byCt.has(k)) byCt.set(k, []); byCt.get(k).push(r); }
        for (const ct of [...byCt.keys()].sort()) {
          const s3 = byCt.get(ct), nc = s3.reduce((a, r) => a + r.w, 0);
          for (const k of COND) out.set(`${coh}|${ct}|${k}|${tr}`, { n: nc, c: s3.reduce((a, r) => a + (r.fr[k] ? r.w : 0), 0) });
        }
      }
    }
    return out;
  };
  // cut_lines.csv for one contest: the score at each finishing tier (sorted high → low, cut(p) = pts[max(1, int(N·p)) − 1]).
  const round2 = x => Math.round(x * 100) / 100;
  const cutLine = S => {
    const pts = S.entries.map(e => e[3]).sort((a, b) => b - a), N = pts.length;
    if (!N) return null;
    const cut = p => round2(pts[Math.max(1, Math.trunc(N * p)) - 1]);
    return { field_size: N, winner_score: round2(pts[0]), cut_top0_1: cut(0.001), cut_top1: cut(0.01), cut_top5: cut(0.05), cut_top20: cut(0.20) };
  };
  // Your entries: EntryName matched on the DK username (the "(3/20)" suffix dropped, case-insensitive).
  const entriesFor = (S, user) => {
    const u = String(user || '').trim().toLowerCase(); if (!u) return [];
    const dupes = new Map(); for (const e of S.entries) dupes.set(e[4], (dupes.get(e[4]) || 0) + 1);
    const N = S.entries.length;
    return S.entries.filter(e => baseName(e[2]).toLowerCase() === u).sort((a, b) => a[0] - b[0])
      .map(([rank, id, name, points, lineup]) => ({ rank, id, name, points, lineup, pct: Math.round(rank / N * 10000) / 100, dupes: dupes.get(lineup), top20: rank <= N * 0.2, top5: rank <= N * 0.05, top1: rank <= N * 0.01 }));
  };
  const contestIdOf = fname => { const m = /contest-standings-(\d+)/.exec(String(fname || '')); return m ? m[1] : null; };

  /* ---------------- zip (DK exports come zipped) ---------------- */
  // First .csv inside a .zip, via the central directory + DecompressionStream('deflate-raw'). Browser only.
  const unzipFirstCsv = async buf => {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('not a zip file');
    let p = dv.getUint32(eocd + 16, true); const count = dv.getUint16(eocd + 10, true);
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (!/\.csv$/i.test(name)) continue;
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true), raw = u8.subarray(start, start + csize);
      if (method === 0) return { name, text: new TextDecoder().decode(raw) };
      if (method !== 8 || typeof DecompressionStream === 'undefined') throw new Error('this browser can\'t unzip — unzip the file and drop the .csv');
      const out = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
      return { name, text: new TextDecoder().decode(out) };
    }
    throw new Error('no .csv inside the zip');
  };

  return { DST_NICK, COHORTS, TIERS, UNCOND, COND, sided, templatesOf, tier, splitLine, isStandings, parseStandings, parseLineup, baseName, resolver, teamsFor, ownershipNames, MATCH_MIN, matchList,
    classify, featureRow, tagContest, cohorts, cutLine, entriesFor, contestIdOf, unzipFirstCsv };
});

/* =====================================================================
   Part 2 — the Step 5 card (#sdReview). Browser only.
   ===================================================================== */
(() => {
  'use strict';
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const R = window.BBI.showdownReview, SE = window.BBI.showdownEngine, FX = window.BBI.fx;
  const SD = () => window.BBI.showdown, LAB = () => window.BBI.showdownLab;
  const LS_USER = 'bbi_showdown_review_user';
  const MIN_TOP1 = 20;   // field_composition.py MIN_TOP1_N: a top-1% cohort smaller than this is a small sample
  const LIFT = 5;        // pts: the codex's "edge" threshold (rule_verdicts LIFT_PTS)
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = id => document.getElementById(id);
  const fmtN = n => (+n).toLocaleString('en-US');
  const pctTxt = v => v == null ? '—' : `${v >= 10 || v === 0 ? Math.round(v) : v.toFixed(1)}%`;
  const reduced = () => (FX && FX.reduced ? FX.reduced() : false);
  const SCRIPT_NAME = { A: 'Favorite blowout', B: 'Favorite controls', C: 'Coin flip', D: 'Dog upset' };
  const TIER_LABEL = { all: 'All', lt10: 'CPT <10%', '10_25': '10–25%', ge25: '25%+' };
  // Feature → the rule_verdicts id that tests it (direction comes from there).
  const RULE_OF = { cpt_fav: 'cpt_fav', cpt_pos_WR: 'cpt_WR', cpt_pos_RB: 'cpt_RB', cpt_pos_QB: 'cpt_QB', cpt_pos_TE: 'cpt_TE', cpt_pos_K: 'cpt_K', ctype_QB_DOG: 'cpt_QB_DOG',
    five_one_fav: 'five_one_fav', four_two: 'four_two', three_three: 'three_three', K: 'K', two_K: 'two_K', DST: 'DST', both_qb: 'both_qb', dog_qb_in_lineup: 'dog_qb', shape_on_template: 'on_template_shape' };
  const GROUPS = [
    ['Captain', [['cpt_pos_WR', 'WR captain'], ['cpt_pos_RB', 'RB captain'], ['cpt_pos_QB', 'QB captain'], ['cpt_pos_TE', 'TE captain'], ['cpt_pos_DST', 'DST captain'], ['cpt_pos_K', 'K captain'],
      ['cpt_fav', 'Favorite captain'], ['ctype_QB_DOG', 'Dog QB captain']]],
    ['Shape', [['five_one_fav', '5-1 with a fav captain'], ['split_5-1', '5-1 (either side)'], ['four_two', '4-2'], ['three_three', '3-3'], ['split_2-4', '2-4'], ['split_1-5', '1-5'], ['split_6-0', '6-0'],
      ['shape_on_template', 'Shape on the captain template']]],
    ['Kicker · DST · QBs', [['K', 'Kicker in'], ['two_K', 'Two kickers'], ['DST', 'DST in'], ['both_qb', 'Both QBs'], ['dog_qb_in_lineup', 'Dog QB in']]],
    ['Script (the line decides fav / dog)', [['script_A', 'A · favorite blowout'], ['script_B', 'B · favorite controls'], ['script_C', 'C · coin flip'], ['script_D', 'D · dog upset']]]
  ];
  const windFor = env => env === 'wind_15_plus' ? 15 : env === 'wind_10_14' ? 12 : 0;

  // First-party analytics (track.js): bucketed, never the file name or the username. A no-op when absent.
  const track = (e, p) => { try { if (window.BBI.track) window.BBI.track(e, p); } catch {} };
  const size = n => (window.BBI.track && window.BBI.track.size) ? window.BBI.track.size(n) : String(n);
  const rv = { fname: '', cid: null, S: null, extra: null, extraName: '', src: null, lineMode: 'slate', fav: null, tier: 'all', user: '', err: '', busy: '', tags: new Map(), eng: null, grades: new Map() };
  try { rv.user = localStorage.getItem(LS_USER) || ''; } catch {}

  /* ---------------- players: which list places this contest ---------------- */
  const getPool = async id => {
    const L = LAB(); if (L && L.fetchPool) return L.fetchPool(id);
    const r = await fetch(`nfl/showdown/pools/${id}.json`, { cache: 'no-cache' }); if (!r.ok) throw new Error(`pool ${id}: HTTP ${r.status}`); return r.json();
  };
  // Every list we could place players from: the sample pools, Your slate (Lab), a DK salary file dropped here.
  const sources = async () => {
    const pools = await Promise.all((SD().slates || []).map(s => getPool(s.id).then(p => ({ kind: 'pool', id: s.id, label: `${s.label} sample pool`, list: p.players, slate: s }), () => null)));
    const out = pools.filter(Boolean);
    const L = LAB();
    if (L && L.lab && L.lab.mine) out.push({ kind: 'mine', id: null, label: `Your slate (${L.lab.mine.label})`, list: [...L.lab.mine.players.P.values()], ids: L.lab.mine.players.ids, slate: null });
    if (rv.extra) out.push({ kind: 'file', id: null, label: rv.extraName, list: [...rv.extra.P.values()], ids: rv.extra.ids, slate: null });
    return out;
  };
  // The list that places this contest best (R.matchList: both teams, ≥ 90% of the ownership, the slate's own game);
  // none → null, and the card asks for that slate's DKSalaries.csv.
  const pickSource = async S => {
    let best = null;
    for (const src of await sources()) {
      const m = R.matchList(S, src.list, src.slate);
      if (m && (!best || m.cov > best.cov + 1e-9)) best = { ...src, ...m };
    }
    return best;
  };

  /* ---------------- the line + the engine ---------------- */
  const guessFav = () => {
    const t = rv.src.teams, pre = SD().derive().preset;
    if (pre && t.includes(pre.fav) && t.includes(pre.dog)) return pre.fav;
    const own = new Map(t.map(x => [x, 0]));
    for (const [n, v] of rv.S.cptOwn) { const r = rv.src.place(n); if (r) own.set(r[1], own.get(r[1]) + v); }
    return [...own].sort((a, b) => b[1] - a[1])[0][0];
  };
  const lineNow = () => {
    const st = SD().state, s = rv.src.slate, teams = rv.src.teams, useSlate = rv.lineMode === 'slate' && !!s;
    const fav = useSlate ? s.fav : rv.fav && teams.includes(rv.fav) ? rv.fav : s && teams.includes(s.fav) ? s.fav : guessFav();
    return { fav, dog: teams.find(t => t !== fav), spread: useSlate ? s.spread : st.spread, total: useSlate ? s.total : st.total, env: useSlate ? s.env : st.env,
      from: useSlate ? 'slate' : 'step1', guessed: !useSlate && !rv.fav && !(s && teams.includes(s.fav)) };
  };
  // The contest's own ownership (%Drafted) goes on the players, so the ownership rules and the dupe estimate use what really happened.
  const poolName = n => { const t = R.DST_NICK[n]; if (t) { const d = rv.src.list.find(p => p.pos === 'DST' && p.team === t); return d ? d.name : null; } return rv.src.reg.has(n) ? n : null; };
  const engineFor = ln => {
    const key = JSON.stringify([ln.fav, ln.spread, ln.total, ln.env]);
    if (rv.eng && rv.eng.key === key) return rv.eng;
    const back = new Map(); for (const n of R.ownershipNames(rv.S)) { const pn = poolName(n); if (pn) back.set(pn, n); }
    const list = rv.src.list.filter(p => rv.src.teams.includes(p.team)).map(p => ({ name: p.name, pos: p.pos, team: p.team, sal: p.sal, flex_id: p.flex_id, cpt_id: p.cpt_id,
      own: rv.S.flexOwn.get(back.get(p.name) ?? p.name) || 0, cpt_own: rv.S.cptOwn.get(back.get(p.name) ?? p.name) || 0 }));
    let E = null, err = '';
    try { E = SE.createEngine(SD().data, SE.playersFromList(list, { own: true, cpt_own: true }), { fav: ln.fav, spread: ln.spread, total: ln.total, wind: windFor(ln.env), roof: ln.env === 'dome' ? 'dome' : 'outdoors', field: rv.S.entries.length, n: 1 }); }
    catch (e) { err = e.message; }
    rv.grades = new Map();
    return (rv.eng = { key, E, err });
  };
  const codex = r => LAB() && LAB().codexScore ? LAB().codexScore(r) : Math.max(0, Math.min(100, Math.round(50 + 50 * (r.fit - r.penSum))));
  const verdict = r => LAB() && LAB().verdictFor ? LAB().verdictFor(r, 6) : { cls: r.hard.length ? 'bad' : 'ok', title: r.hard.length ? 'Rejected by the engine' : 'Legal', sub: r.hard.join(' · ') };
  // A standings lineup string → {L, r, score, v} graded by the engine (null when a player can't be placed).
  const grade = (E, lu) => {
    if (rv.grades.has(lu)) return rv.grades.get(lu);
    const nm = R.parseLineup(lu).map(([, n]) => poolName(n));
    let g = null;
    if (nm.length === 6 && nm.every(n => n && E.P.has(n))) { const L = { cpt: nm[0], flex: nm.slice(1) }, r = E.scoreOne(L); g = { L, r, score: codex(r), v: verdict(r) }; }
    rv.grades.set(lu, g); return g;
  };
  const tagsFor = ln => {
    if (!rv.tags.has(ln.fav)) {
      const T = R.templatesOf(SD().data.captain_templates), tc = R.tagContest(rv.S, rv.src.place, ln.fav, ln.dog, T);
      rv.tags.set(ln.fav, { tc, co: R.cohorts(tc, T, { cond: false }) });
    }
    return rv.tags.get(ln.fav);
  };

  /* ---------------- files ---------------- */
  const readFiles = async files => {
    rv.err = '';
    let standings = null;
    for (const f of files) {
      try {
        let name = f.name, text;
        const zip = /\.zip$/i.test(name);
        if (zip) { const z = await R.unzipFirstCsv(await f.arrayBuffer()); text = z.text; name = z.name.split('/').pop() || name; }
        else text = await f.text();
        if (R.isStandings(text)) { standings = { name, text, zip }; track('file_load', { type: zip ? 'standings_zip' : 'standings_csv', card: 'review' }); continue; }
        const pl = SE.readPlayers(text);
        rv.extra = pl; rv.extraName = `${name} · ${pl.P.size} players`;
        track('file_load', { type: pl.source === 'stokastic' ? 'stokastic' : 'dk_salaries', card: 'review' });
      } catch (e) { rv.err = `${f.name}: ${e.message}`; }
    }
    if (!standings && !rv.S) { rv.err = rv.err || 'That isn\'t a DK contest-standings export (it starts "Rank,EntryId,EntryName,…").'; renderBody(); return; }
    rv.busy = standings ? `Reading ${standings.name}…` : 'Placing players…'; renderBody();
    await new Promise(r => setTimeout(r, 30));   // let the busy line paint before the heavy pass
    try {
      if (standings) {
        const S = R.parseStandings(standings.text);
        if (!S.entries.length) { rv.busy = ''; rv.err = `${standings.name}: no entries in this standings file (only the %Drafted table), so there is nothing to review.`; renderBody(); return; }
        rv.S = S; rv.fname = standings.name; rv.cid = R.contestIdOf(standings.name);
      }
      rv.src = await pickSource(rv.S);
      rv.tags = new Map(); rv.eng = null; rv.grades = new Map(); rv.fav = null;
      rv.lineMode = rv.src && rv.src.slate ? 'slate' : 'step1';
      rv.busy = '';
      renderBody();
      if (standings) {
        const mine = rv.user.trim() ? R.entriesFor(rv.S, rv.user).length : 0;
        track('review_load', { entries: size(rv.S.entries.length), zip: !!standings.zip, placed: rv.src ? rv.src.kind : 'none', replay: !!(rv.src && rv.src.slate && rv.src.slate.replay), has_user: !!rv.user.trim(), user_found: mine > 0 });
        announce(`Contest loaded · ${rv.S.entries.length.toLocaleString('en-US')} entries${rv.src ? '' : ' · players not placed yet'}`);
      }
    } catch (e) { rv.busy = ''; rv.err = e.message; renderBody(); }
  };

  /* ---------------- render ---------------- */
  const skeleton = () => {
    const host = $('sdReview'); if (!host) return false;
    host.innerHTML = `
      <div class="sd-winners-head"><div class="card-title">Tuesday review · <span class="card-title-accent">a contest you played</span></div></div>
      <p class="sd-lede">Drop a DraftKings contest-standings export (the CSV, or the .zip from the contest page) and your DK username. You get the winner's lineup graded by the engine, this contest's cut ladder, field vs top 1% on every codex feature, and where your entries finished. The file is read in your browser; nothing is uploaded.</p>
      <div class="sd-rv-in">
        <div class="sd-drop sd-rv-drop" id="sdRvDrop" tabindex="0" role="button" aria-label="Load a DraftKings contest-standings file (CSV or zip)">
          <input type="file" id="sdRvFiles" accept=".csv,.zip,text/csv" multiple hidden>
          <b>Drop contest standings</b><span>contest-standings-*.csv or .zip · for a game without a sample pool, add that slate's DKSalaries.csv</span><small>read in your browser · nothing is uploaded</small>
        </div>
        <div class="sd-rv-opts">
          <label class="sd-lab-k" for="sdRvUser">DK username <small>optional · finds your entries</small></label>
          <input class="sd-pool-q" id="sdRvUser" type="text" value="${esc(rv.user)}" placeholder="your DraftKings username" autocomplete="off" autocapitalize="off" spellcheck="false">
          <div class="sd-rv-files" id="sdRvFilesList"></div>
        </div>
      </div>
      <div id="sdRvBody"></div>`;
    const inp = $('sdRvFiles'), drop = $('sdRvDrop');
    drop.addEventListener('click', () => inp.click());
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
    inp.addEventListener('change', () => { readFiles([...inp.files]); inp.value = ''; });
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => readFiles([...(e.dataTransfer?.files || [])]));
    let t = 0;
    $('sdRvUser').addEventListener('input', e => { rv.user = e.target.value; try { localStorage.setItem(LS_USER, rv.user.trim()); } catch {} clearTimeout(t); t = setTimeout(renderBody, 250); });
    host.addEventListener('click', onClick);
    return true;
  };

  const ring = (score, cls) => {
    const C = 2 * Math.PI * 52;
    return `<div class="sd-gauge sd-rv-gauge ${cls}"><svg viewBox="0 0 128 128" aria-hidden="true"><g transform="rotate(-90 64 64)"><circle class="trk" cx="64" cy="64" r="52"/><circle class="val" cx="64" cy="64" r="52" style="stroke-dasharray:${((score || 0) / 100 * C).toFixed(2)} ${C.toFixed(2)}"/></g></svg><div class="sd-gauge-num">${score == null ? '—' : score}<small>codex</small></div></div>`;
  };
  const slotsHtml = (E, g, lu) => {
    const ps = R.parseLineup(lu);
    return `<div class="sd-rv-slots">${ps.map(([slot, n], i) => {
      const pn = poolName(n), p = pn && E && E.P.get(pn), cpt = slot === 'CPT', own = (cpt ? rv.S.cptOwn : rv.S.flexOwn).get(n), pts = rv.S.fpts.get(n);
      return `<div class="sd-rv-slot${cpt ? ' cpt' : ''}${p ? '' : ' miss'}"><span class="sd-slot-k">${cpt ? 'CPT' : 'FLEX'}</span>${p ? `<span class="sd-pos pos-${esc(p.pos)}">${esc(p.pos)}</span>` : '<span class="sd-pos">?</span>'}
        <span class="sd-rv-slot-name">${esc(n)}<small>${p ? `${esc(p.team)} · ${p.team === E.A.fav ? 'fav' : 'dog'} · ` : 'not in the player list · '}${own != null ? `${pctTxt(own)} drafted` : ''}</small></span>
        <span class="sd-rv-slot-pts">${pts != null ? (cpt ? pts * 1.5 : pts).toFixed(1) : ''}<small>${p ? `$${fmtN(cpt ? p.sal * 1.5 : p.sal)}` : ''}</small></span></div>`;
    }).join('')}</div>`;
  };

  // Re-rendering the body drops the focused toggle; keepFocus puts keyboard focus back on its twin.
  // A draw that throws shows its error instead of leaving the busy line up.
  const renderBody = () => {
    const restore = FX && FX.keepFocus ? FX.keepFocus() : () => {};
    try { drawBody(); } catch (e) { const host = $('sdRvBody'); if (host) host.innerHTML = `<div class="sd-sal-warn">Couldn't show this contest: ${esc(e.message)}</div>`; }
    restore();
  };
  const drawBody = () => {
    const host = $('sdRvBody'); if (!host) return;
    const fl = $('sdRvFilesList');
    if (fl) fl.innerHTML = [rv.fname ? `<div class="sd-file players"><b>${esc(rv.fname)}</b><span>${rv.S ? `${fmtN(rv.S.entries.length)} entries · contest ${esc(rv.cid || '?')}` : ''}</span></div>` : '', rv.extra ? `<div class="sd-file"><b>${esc(rv.extraName)}</b><span>player list for placing names</span></div>` : ''].join('');
    if (rv.busy) { host.innerHTML = `<div class="sd-unlock sd-rv-busy">${esc(rv.busy)}</div>`; announce(rv.busy); return; }
    const err = rv.err ? `<div class="sd-sal-warn">${esc(rv.err)}</div>` : '';
    if (!rv.S) { host.innerHTML = err; return; }
    if (!rv.src) {
      host.innerHTML = `${err}<div class="sd-unlock">Couldn't place this contest's players: no sample slate has them. Drop that slate's <b>DKSalaries.csv</b> here too (or load it in <a href="nfl/showdown/#sdLabPro" data-jump="sdLabPro" class="sd-link">Your slate</a>) and the review runs.</div>`;
      return;
    }
    const ln = lineNow(), { tc, co } = tagsFor(ln), { E, err: eErr } = engineFor(ln), S = rv.S, N = S.entries.length;
    const cut = R.cutLine(S), s = rv.src.slate, teams = rv.src.teams;
    const envLabel = (SD().ENV_LABEL || {})[ln.env] || ln.env;
    // ---- summary + line controls
    const lineCtl = `<div class="sd-rv-line">
        ${s ? `<span class="seg" role="group" aria-label="Line to grade against">${[['slate', `${s.label.replace(/ · .*$/, '')} line`], ['step1', 'Step 1 line']].map(([k, l]) => `<button type="button" class="${rv.lineMode === k ? 'active' : ''}" aria-pressed="${rv.lineMode === k}" data-rv="line" data-mode="${k}">${esc(l)}</button>`).join('')}</span>` : ''}
        ${ln.from === 'step1' ? `<span class="seg" role="group" aria-label="Favorite">${teams.map(t => `<button type="button" class="${t === ln.fav ? 'active' : ''}" aria-pressed="${t === ln.fav}" data-rv="fav" data-team="${esc(t)}">${esc(t)} fav</button>`).join('')}</span>` : ''}
        <span class="sd-num-hint">${ln.from === 'slate' ? 'the preset line for this game' : `spread, total and roof from Step 1${ln.guessed ? ' · favorite guessed from captain ownership: set it' : ''}`}</span></div>`;
    const facts = `<div class="sd-facts sd-rv-facts">
        <div><span>Field</span><b>${fmtN(N)}</b><small>${fmtN(tc.unique)} unique lineups</small></div>
        <div><span>Placed</span><b class="${tc.unresolvedEntries ? 'warn' : ''}">${Math.round(tc.placed / Math.max(1, N) * 1000) / 10}%</b><small>${tc.unresolvedEntries ? `${fmtN(tc.unresolvedEntries)} entries left out` : 'every entry tagged'}</small></div>
        <div><span>Players from</span><b class="sd-rv-src">${esc(rv.src.label)}</b><small>${esc(teams.join(' vs '))}</small></div>
        <div><span>Graded against</span><b>${esc(ln.fav)} −${ln.spread} · ${ln.total}</b><small>${esc(envLabel)} · ${ln.from === 'slate' ? 'slate line' : 'Step 1 line'}</small></div></div>`;
    // ---- winner
    const winners = S.entries.filter(e => e[0] === 1), w = winners[0];
    const wg = E && w ? grade(E, w[4]) : null;
    const dupes = w ? S.entries.filter(e => e[4] === w[4]).length : 0;
    const canLab = rv.src.kind === 'pool' || rv.src.kind === 'mine';
    const win = !w ? '' : `
      <div class="sd-rv-block">
        <span class="sd-lab-k">The winner <small>${esc(R.baseName(w[2]))} · ${w[3].toFixed(2)} pts${winners.length > 1 ? ` · ${winners.length - 1} more tied at #1` : ''} · ${dupes} cop${dupes === 1 ? 'y' : 'ies'} of this lineup in the field</small></span>
        <div class="sd-rv-win">
          ${wg ? `<div class="sd-gauge-row sd-rv-verdict">${ring(wg.score, wg.v.cls)}<div class="sd-gauge-txt"><b class="sd-verdict-title">${esc(wg.v.title)}</b><span class="sd-verdict-sub">${esc(wg.v.sub)}</span>
            <span class="sd-script-chip"><span class="sd-script-badge sm">${wg.r.script.tag}</span><span><b>${esc(SCRIPT_NAME[wg.r.script.tag])}</b><small>${esc(wg.r.X.ctype.replace('_', ' '))} captain · ${esc(wg.r.X.split)} · K ${wg.r.X.k_n} · DST ${wg.r.X.dst_n} · cum own ${Math.round(wg.r.X.cum)}% · fit ${wg.r.fit.toFixed(2)}${wg.r.pen.length ? ` · ${esc(wg.r.pen.map(p => p[0]).join(', '))}` : ' · no penalties'}</small></span></span>
            ${canLab ? `<div class="sd-lab-actions"><button type="button" class="btn btn-sm" data-rv="lab" data-lu="w">Open in the Lab</button></div>` : ''}</div></div>`
          : `<div class="sd-unlock">${eErr ? esc(eErr) : 'A player in the winning lineup isn\'t in the player list, so the engine can\'t grade it.'}</div>`}
          ${slotsHtml(E, wg, w[4])}
        </div>
      </div>`;
    // ---- cut ladder (this contest)
    const mine = R.entriesFor(S, rv.user);
    const tiers = [['winner_score', 'Winner'], ['cut_top0_1', 'Top 0.1%'], ['cut_top1', 'Top 1%'], ['cut_top5', 'Top 5%'], ['cut_top20', 'Top 20%']];
    const shr = v => cut && cut.winner_score > 0 ? v / cut.winner_score * 100 : 0;   // share of the winning score (0 when nobody scored)
    const ladder = !cut ? '' : `
      <div class="sd-rv-block">
        <span class="sd-lab-k">Cut ladder <small>the score each tier took in this contest · bar = share of the winning score</small></span>
        <div class="sd-cuts">${tiers.map(([k, l]) => `<div class="sd-cut${k === 'cut_top1' ? ' hl' : ''}"><span class="sd-cut-k">${l}</span>
          <span class="sd-cut-bar"><span class="bar"><span class="bar-fill" style="width:${Math.min(100, shr(cut[k])).toFixed(1)}%"></span></span></span>
          <span class="sd-cut-v"><b>${cut[k].toFixed(2)}</b><small>${Math.round(shr(cut[k]))}% of winner</small></span></div>`).join('')}
          ${mine.length ? `<div class="sd-cut sd-rv-you"><span class="sd-cut-k">Your best</span><span class="sd-cut-bar"><span class="bar"><span class="bar-fill dim" style="width:${Math.min(100, shr(mine[0].points)).toFixed(1)}%"></span></span></span><span class="sd-cut-v"><b>${mine[0].points.toFixed(2)}</b><small>#${fmtN(mine[0].rank)} · top ${pctTxt(mine[0].pct)}</small></span></div>` : ''}
        </div>
        <div class="sd-caption"><span class="n small">n = 1 contest · ${fmtN(N)} entries</span> · cut(p) = the score at rank max(1, ⌊N·p⌋), as in cut_lines.csv · min cash needs the payout table (DK entry history), not in a standings file</div>
      </div>`;
    // ---- field vs top 1%
    const tr = rv.tier, get = (coh, f) => { const x = co.get(`${coh}|${f}|${tr}`); return x ? { n: x.n, v: x.c / x.n * 100, c: x.c } : null; };
    const nOf = coh => { const x = [...co.keys()].find(k => k.startsWith(coh + '|') && k.endsWith('|' + tr)); return x ? co.get(x).n : 0; };
    const nF = nOf('field'), n1 = nOf('top1'), n01 = nOf('top0.1'), nW = nOf('winner');
    const dt = SD().data, tally = { ok: 0, unk: 0, bad: 0 };
    const rowsHtml = GROUPS.map(([g, feats]) => {
      const rows = feats.map(([f, label]) => {
        const F = get('field', f), T1 = get('top1', f); if (!F || !T1 || (!F.c && !T1.c)) return '';
        const T01 = get('top0.1', f), Wn = get('winner', f), lift = Math.round((T1.v - F.v) * 10) / 10;
        const rule = RULE_OF[f] && SD().ruleById ? SD().ruleById(dt, RULE_OF[f]) : null;
        let badge = '';
        if (rule && tr === 'all') {
          const sg = rule.direction * lift, cls = sg >= LIFT ? 'ok' : sg <= -LIFT ? 'bad' : 'unk'; tally[cls]++;
          const word = cls === 'ok' ? 'agreed' : cls === 'bad' ? 'went against it' : 'flat (under ±5 pts)';
          const tip = `Codex: ${rule.direction > 0 ? 'more' : 'less'} of "${rule.label}". This contest: top 1% ${pctTxt(T1.v)} vs field ${pctTxt(F.v)} (${lift > 0 ? '+' : lift < 0 ? '−' : '±'}${Math.abs(lift).toFixed(1)} pts), so it ${word}. One game — the archive verdict (Step 2) pools slates.`;
          badge = `<span class="sd-vb ${cls} mini" title="${esc(tip)}" aria-label="${esc(tip)}">${cls === 'ok' ? '✓' : cls === 'bad' ? '✗' : '–'}</span>`;
        }
        const x1 = Math.max(0, Math.min(100, F.v)), x2 = Math.max(0, Math.min(100, T1.v));
        return `<div class="sd-rv-row">
          <span class="sd-rv-k">${esc(label)}${badge}<span class="sd-coh-track" aria-hidden="true"><i class="sd-coh-dot f" style="left:${x1.toFixed(1)}%"></i><i class="sd-coh-dot t" style="left:${x2.toFixed(1)}%"></i></span></span>
          <span class="sd-rv-v">${pctTxt(F.v)}</span><span class="sd-rv-v t">${pctTxt(T1.v)}</span>
          <span class="sd-rv-v lift${Math.abs(lift) >= LIFT ? (lift > 0 ? ' up' : ' dn') : ''}">${lift > 0 ? '+' : lift < 0 ? '−' : '±'}${Math.abs(lift).toFixed(1)}</span>
          <span class="sd-rv-v x">${T01 ? pctTxt(T01.v) : '—'}</span><span class="sd-rv-v x w">${Wn ? (Wn.v >= 50 ? '✓' : '·') : '—'}</span></div>`;
      }).join('');
      return rows ? `<div class="sd-rv-group"><span class="sd-rv-gk">${esc(g)}</span>${rows}</div>` : '';
    }).join('');
    const table = `
      <div class="sd-rv-block">
        <div class="sd-winners-head"><span class="sd-lab-k">Field vs top 1% <small>share of lineups with the feature, inside this contest</small></span>
          <div class="seg" role="group" aria-label="Captain ownership tier">${Object.keys(TIER_LABEL).map(k => `<button type="button" class="${k === tr ? 'active' : ''}" aria-pressed="${k === tr}" data-rv="tier" data-tier="${k}">${TIER_LABEL[k]}</button>`).join('')}</div></div>
        ${tr === 'all' && (tally.ok + tally.unk + tally.bad) ? `<div class="sd-rv-tally">The codex's calls in this contest: <span class="sd-vb ok">✓ ${tally.ok} agreed</span> <span class="sd-vb unk">– ${tally.unk} flat</span> <span class="sd-vb bad">✗ ${tally.bad} went against</span></div>` : ''}
        <div class="sd-rv-table">
          <div class="sd-rv-row sd-rv-hd"><span class="sd-rv-k"><span class="sd-coh-legend"><span><i class="sd-coh-dot f"></i>field</span><span><i class="sd-coh-dot t"></i>top 1%</span></span></span>
            <span class="sd-rv-v">Field<small class="n">${fmtN(nF)}</small></span><span class="sd-rv-v t">Top 1%<small class="n${n1 < MIN_TOP1 ? ' small' : ''}">${fmtN(n1)}</small></span><span class="sd-rv-v">Lift<small>pts</small></span>
            <span class="sd-rv-v x">Top 0.1%<small class="n${n01 < MIN_TOP1 ? ' small' : ''}">${fmtN(n01)}</small></span><span class="sd-rv-v x w">Win<small class="n">${fmtN(nW)}</small></span></div>
          ${rowsHtml || '<div class="sd-unlock">No lineups in this tier.</div>'}
        </div>
        <div class="sd-caption">Numbers under the headers = lineups in each cohort (amber under ${MIN_TOP1}) · cohorts cut inside this contest, as in codex/field_composition.py (parity-tested: tools/showdown_review_parity.py) · lift = top-1% rate − field rate · ✓ / – / ✗ = did the codex's direction hold here (±${LIFT} pts) · <b>one contest is one game</b>: this describes what happened, it is not evidence (the archive verdicts in Step 2 pool slates).</div>
      </div>`;
    // ---- your entries
    let you = '';
    if (rv.user.trim()) {
      if (!mine.length) you = `<div class="sd-rv-block"><span class="sd-lab-k">Your entries</span><div class="sd-unlock">No entries for “${esc(rv.user.trim())}” in this contest. The username must match DK's EntryName (without the “(3/20)” part).</div></div>`;
      else {
        const gs = mine.map(e => ({ e, g: E ? grade(E, e.lineup) : null }));
        const graded = gs.filter(x => x.g), avg = graded.length ? Math.round(graded.reduce((a, x) => a + x.g.score, 0) / graded.length) : null;
        you = `<div class="sd-rv-block">
          <span class="sd-lab-k">Your entries <small>${esc(R.baseName(mine[0].name))} · tap one to open it in the Lab</small></span>
          <div class="sd-batch-sum">
            <div><span>Entries</span><b>${mine.length}</b><small>${new Set(mine.map(e => e.lineup)).size} unique</small></div>
            <div><span>Best finish</span><b>#${fmtN(mine[0].rank)}</b><small>top ${pctTxt(mine[0].pct)} · ${mine[0].points.toFixed(2)} pts</small></div>
            <div><span>Top 20% · 1%</span><b>${mine.filter(e => e.top20).length} · ${mine.filter(e => e.top1).length}</b><small>of ${mine.length}</small></div>
            <div><span>Avg codex</span><b>${avg != null ? avg : '—'}</b><small>${graded.filter(x => x.g.r.hard.length).length} broke a hard rule</small></div>
          </div>
          <div class="sd-blist">${gs.map((x, i) => `<button type="button" class="sd-bl${x.g && x.g.r.hard.length ? ' bad' : ''}" ${x.g && canLab ? `data-rv="lab" data-lu="e${i}"` : 'disabled'}>
            <span class="sd-bl-score ${x.e.top1 ? 'elite' : x.e.top20 ? 'good' : ''}">#${fmtN(x.e.rank)}<small>top ${pctTxt(x.e.pct)}</small></span>
            <span class="sd-bl-line"><span class="sd-bl-cpt">${esc(R.parseLineup(x.e.lineup)[0]?.[1] || '')}</span><small>${esc(R.parseLineup(x.e.lineup).slice(1).map(p => p[1]).join(' · '))}</small></span>
            <span class="sd-script-badge sm">${x.g ? x.g.r.script.tag : '?'}</span>
            <span class="sd-bl-why">${x.e.points.toFixed(2)} pts · ${x.g ? `codex ${x.g.score} · ${esc(x.g.v.title)}` : 'not graded (player not placed)'}${x.e.dupes > 1 ? ` · ${x.e.dupes} copies` : ''}</span></button>`).join('')}</div>
        </div>`;
      }
    }
    const unplaced = tc.unresolved.size ? `<details class="sd-fold"><summary>${tc.unresolved.size} player${tc.unresolved.size > 1 ? 's' : ''} not placed · ${fmtN(tc.unresolvedEntries)} entries left out <span class="sd-fold-arrow">▸</span></summary><div class="sd-log">${[...tc.unresolved].sort((a, b) => b[1] - a[1]).map(([n, c]) => `<div>${esc(n)} · in ${fmtN(c)} entries</div>`).join('')}</div></details>` : '';
    host.innerHTML = `${err}${lineCtl}${facts}${win}${you}${ladder}${table}${unplaced}`;
  };

  /* ---------------- events ---------------- */
  const announce = msg => { const el = $('sdStatus'); if (el && el.textContent !== msg) el.textContent = msg; };
  const onClick = e => {
    const b = e.target.closest('[data-rv]'); if (!b) return;
    const a = b.dataset.rv;
    if (a === 'line') { rv.lineMode = b.dataset.mode; renderBody(); return; }
    if (a === 'fav') { rv.fav = b.dataset.team; renderBody(); return; }
    if (a === 'tier') { rv.tier = b.dataset.tier; renderBody(); return; }
    if (a === 'lab') {
      const ln = lineNow(), { E } = engineFor(ln); if (!E || !LAB() || !LAB().openLineup) return;
      const lu = b.dataset.lu === 'w' ? rv.S.entries.find(x => x[0] === 1)[4] : R.entriesFor(rv.S, rv.user)[+b.dataset.lu.slice(1)].lineup;
      const g = grade(E, lu); if (!g) return;
      LAB().openLineup(rv.src.kind === 'pool' ? rv.src.id : null, g.L, ln.from);
    }
  };
  // Step 1 moved: only the Step-1-line mode regrades (the tags only change with the favorite).
  let t = 0;
  document.addEventListener('sd:render', () => {
    if (!rv.S || !rv.src || rv.lineMode === 'slate' && rv.src.slate) return;
    clearTimeout(t); t = setTimeout(renderBody, 250);
  });
  const boot = () => { if (skeleton()) renderBody(); };
  if (SD() && SD().data) boot(); else document.addEventListener('sd:ready', boot, { once: true });
})();
