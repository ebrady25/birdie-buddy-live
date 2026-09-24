/* =====================================================================
   BIRDIEBUDDY — SHOWDOWN ENGINE (JS port of codex/rules_engine.py)
   classify → hard_check → soft_score (+ captain-template story fit and
   overlays) → rank → portfolio selection, driven by the same rules the
   page reads (showdown_playbook.json: hard_rules, soft_penalties,
   captain_templates, portfolio, allocation_by_spread, overlays, engine).

   Parity contract: given the same player file, pool file and slate
   arguments, `text.dump / text.audit / text.select` reproduce
   rules_engine.py's --dump / --audit / default output exactly
   (tools/showdown_parity.py runs both engines and diffs them).
   Everything beyond that contract (checklists, partial lineups,
   portfolio report, missing-ownership mode) is additive and lives in
   clearly separated helpers below.

   Pure: no DOM. Loads in the browser as BBI.showdownEngine and in node
   via require().
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.BBI = root.BBI || {}; root.BBI.showdownEngine = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* =================================================================
     1. PYTHON-COMPATIBLE PRIMITIVES (parsing + formatting)
     ================================================================= */

  // csv.reader semantics (default dialect): quoted fields, "" escapes,
  // quote chars inside an unquoted field are literal, blank line → [].
  const parseCSV = (text, delim = ',') => {
    text = String(text || '');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = []; let row = [], field = '', inQ = false, quoted = false, i = 0, started = false;
    const endField = () => { row.push(field); field = ''; quoted = false; };
    const endRow = () => { if (started || row.length) { endField(); rows.push(row); } else rows.push([]); row = []; started = false; };
    while (i < text.length) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
        field += ch; i++; continue;
      }
      if (ch === '"' && field === '' && !quoted) { inQ = true; quoted = true; started = true; i++; continue; }
      if (ch === delim) { started = true; endField(); i++; continue; }
      if (ch === '\r' || ch === '\n') { endRow(); if (ch === '\r' && text[i + 1] === '\n') i++; i++; continue; }
      field += ch; started = true; i++;
    }
    if (started || row.length || inQ) endRow();
    return rows;
  };

  // float(str) — Python syntax only (no trailing junk like parseFloat allows).
  const PYFLOAT = /^[+-]?(?:(?:\d(?:_?\d)*)?\.?\d(?:_?\d)*(?:[eE][+-]?\d(?:_?\d)*)?|\d(?:_?\d)*\.|inf(?:inity)?|nan)$/i;
  const pyFloat = s => {
    if (s == null) return null;
    const t = String(s).trim();
    if (!t || !PYFLOAT.test(t)) return null;
    const l = t.toLowerCase().replace(/^[+-]/, '');
    if (l.startsWith('inf')) return t[0] === '-' ? -Infinity : Infinity;
    if (l === 'nan') return NaN;
    return Number(t.replace(/_/g, ''));
  };

  // format(x, '.Nf') — round-half-even on exact binary ties, like CPython.
  const pyFixed = (x, d) => {
    if (!isFinite(x)) return isNaN(x) ? 'nan' : (x < 0 ? '-inf' : 'inf');
    const neg = x < 0 || Object.is(x, -0), a = Math.abs(x);
    let s = a.toFixed(d);
    const full = a.toFixed(100), dot = full.indexOf('.'), ip = full.slice(0, dot), fp = full.slice(dot + 1);
    if (fp[d] === '5' && /^0*$/.test(fp.slice(d + 1))) {
      const last = d > 0 ? fp[d - 1] : ip[ip.length - 1];
      if (+last % 2 === 0) s = d > 0 ? `${ip}.${fp.slice(0, d)}` : ip;
    }
    return (neg ? '-' : '') + s;
  };
  const pyPct = (x, d = 0) => pyFixed(x * 100, d) + '%';          // f"{x:.0%}" multiplies in float first
  const pySigned = (x, d) => { const s = pyFixed(x, d); return s[0] === '-' ? s : '+' + s; };
  // repr(float): shortest round-trip digits, exponent outside [-4, 16).
  const pyFloatRepr = x => {
    if (!isFinite(x)) return isNaN(x) ? 'nan' : (x < 0 ? '-inf' : 'inf');
    if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
    const neg = x < 0, [m, e] = Math.abs(x).toExponential().split('e'), exp = +e, digits = m.replace('.', '');
    let out;
    if (exp < -4 || exp >= 16) {
      const mant = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
      out = `${mant}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
    } else if (exp >= 0) {
      const ip = digits.slice(0, exp + 1).padEnd(exp + 1, '0'), fp = digits.slice(exp + 1);
      out = `${ip}.${fp || '0'}`;
    } else out = `0.${'0'.repeat(-exp - 1)}${digits}`;
    return (neg ? '-' : '') + out;
  };
  // JSON-sourced numbers: an integer-valued JSON number was a Python int.
  const pyNum = x => Number.isInteger(x) ? String(x) : pyFloatRepr(x);
  const pyStr = s => {
    s = String(s);
    const q = s.includes("'") && !s.includes('"') ? '"' : "'";
    return q + s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').split(q).join('\\' + q) + q;
  };
  const pyRepr = v => {
    if (v === true) return 'True'; if (v === false) return 'False'; if (v == null) return 'None';
    if (typeof v === 'number') return pyNum(v);
    if (typeof v === 'string') return pyStr(v);
    if (Array.isArray(v)) return `[${v.map(pyRepr).join(', ')}]`;
    if (v instanceof Map) return `{${[...v].map(([k, x]) => `${pyRepr(k)}: ${pyRepr(x)}`).join(', ')}}`;
    return `{${Object.keys(v).map(k => `${pyStr(k)}: ${pyRepr(v[k])}`).join(', ')}}`;
  };
  const pyLower = s => String(s).toLowerCase();
  const pySplit = s => String(s).trim().split(/\s+/).filter(Boolean);
  const median = a => { const s = a.slice().sort((x, y) => x - y), n = s.length, m = n >> 1; return n % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const sum = a => a.reduce((x, y) => x + y, 0);
  // Counter.most_common(n) == stable sort by count desc, insertion order on ties.
  const mostCommon = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n);
  const inc = (map, k, by = 1) => map.set(k, (map.get(k) || 0) + by);

  /* =================================================================
     2. PLAYER FILES
     ================================================================= */
  const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);

  // Stokastic Data Hub SHOWDOWN export (the engine's --proj file). Mirrors
  // rules_engine.py: g(k) matches the first header whose stripped lower
  // name equals k; unparseable/missing → 0.0; later duplicate names win.
  const readStokastic = rows => {
    const hdr = rows[0], P = new Map();
    for (const raw of rows.slice(1)) {
      if (!raw.length) continue;                                   // DictReader skips blank rows
      const r = new Map(); hdr.forEach((h, i) => r.set(h, i < raw.length ? raw[i] : null));
      const g = k => { for (const [kk, v] of r) if (kk.trim().toLowerCase() === k.toLowerCase()) { const f = pyFloat(v); return f == null ? 0.0 : f; } return 0.0; };
      const name = String(r.get('Player') ?? '').trim();
      P.set(name, { name, sal: g('Salary'), pos: String(r.get('Position') ?? '').trim(), team: String(r.get('Team') ?? '').trim(), proj: g('Projection'),
        own: g('Ownership %'), opt: g('Optimal %'), cpt_own: g('CPT Ownership %'), cpt_opt: g('CPT Optimal %') });
    }
    const H = hdr.map(h => h.trim().toLowerCase());
    return { P, source: 'stokastic', has: { proj: H.includes('projection'), own: H.includes('ownership %'), cpt_own: H.includes('cpt ownership %'), cpt_opt: H.includes('cpt optimal %') }, ids: new Map() };
  };

  // DraftKings salary file (DKSalaries.csv) — or the DK upload template,
  // whose player list sits to the right of the lineup columns. Public DK
  // fields only: name, position, team, FLEX salary, FLEX/CPT ids.
  const readDraftKings = rows => {
    let hi = rows.findIndex(r => r.some(c => c.trim() === 'Roster Position') && r.some(c => c.trim() === 'Salary'));
    if (hi < 0) return null;
    const hdr = rows[hi].map(c => c.trim()), col = k => hdr.indexOf(k);
    const cN = col('Name'), cId = col('ID'), cRP = col('Roster Position'), cSal = col('Salary'), cPos = col('Position'), cTeam = col('TeamAbbrev'), cGame = col('Game Info'), cAvg = col('AvgPointsPerGame');
    const P = new Map(), ids = new Map();
    for (const r of rows.slice(hi + 1)) {
      const name = (r[cN] || '').trim(); if (!name) continue;
      const rp = (r[cRP] || '').trim().toUpperCase(), sal = pyFloat(r[cSal]) ?? 0, id = (r[cId] || '').trim();
      const cur = P.get(name) || { name, sal: 0, pos: (r[cPos] || '').trim(), team: (r[cTeam] || '').trim(), proj: 0, own: 0, opt: 0, cpt_own: 0, cpt_opt: 0, avg: pyFloat(r[cAvg]) ?? 0, game: (r[cGame] || '').trim() };
      const pair = ids.get(name) || ['', ''];
      if (rp === 'CPT') { pair[1] = id; if (!cur.sal) cur.sal = sal / 1.5; }
      else { pair[0] = id; cur.sal = sal; }
      P.set(name, cur); ids.set(name, pair);
    }
    return { P, source: 'draftkings', has: { proj: false, own: false, cpt_own: false, cpt_opt: false }, ids };
  };

  const readIdMap = rows => {                                       // Name,FlexID,CptID
    const hdr = rows[0].map(h => h.trim()), iN = hdr.indexOf('Name'), iF = hdr.indexOf('FlexID'), iC = hdr.indexOf('CptID');
    const ids = new Map();
    for (const r of rows.slice(1)) if (r.length) ids.set(r[iN], [r[iF], r[iC]]);
    return ids;
  };

  // Auto-detect a player file. Returns { P, has, ids, source } or throws.
  const readPlayers = text => {
    const rows = parseCSV(text);
    if (!rows.length) throw new Error('empty player file');
    const H = rows[0].map(h => h.trim().toLowerCase());
    if (H.includes('player') && H.includes('salary') && H.includes('position') && H.includes('team')) return readStokastic(rows);
    const dk = readDraftKings(rows); if (dk && dk.P.size) return dk;
    throw new Error('unrecognised player file — expected a Stokastic Data Hub showdown export or a DraftKings salary CSV');
  };

  // Merge a DK salary pool (ids) with a projections pool (own/opt/proj) by name.
  const mergePlayers = (base, extra) => {
    if (!base) return extra; if (!extra) return base;
    const P = new Map(base.P);
    // Field by field: a numeric field only comes from a file that actually has it,
    // so DK salaries dropped after a Data Hub export can't zero out ownership.
    const SRC = { proj: 'proj', own: 'own', opt: 'own', cpt_own: 'cpt_own', cpt_opt: 'cpt_opt' };
    for (const [n, p] of extra.P) {
      const q = P.get(n); if (!q) { P.set(n, p); continue; }
      const m = { ...q, sal: p.sal || q.sal };
      for (const [f, h] of Object.entries(SRC)) m[f] = extra.has[h] ? p[f] : base.has[h] ? q[f] : (p[f] || q[f] || 0);
      P.set(n, m);
    }
    const ids = new Map([...base.ids, ...extra.ids]);
    const has = {}; for (const k of ['proj', 'own', 'cpt_own', 'cpt_opt']) has[k] = base.has[k] || extra.has[k];
    return { P, has, ids, source: `${base.source}+${extra.source}` };
  };

  // Plain-object pool (the page's sample slates): [{name,pos,team,sal,flex_id,cpt_id,...}]
  const playersFromList = (list, has = {}) => {
    const P = new Map(), ids = new Map();
    for (const p of list) {
      P.set(p.name, { name: p.name, sal: +p.sal || 0, pos: p.pos, team: p.team, proj: +p.proj || 0, own: +p.own || 0, opt: +p.opt || 0, cpt_own: +p.cpt_own || 0, cpt_opt: +p.cpt_opt || 0 });
      if (p.flex_id || p.cpt_id) ids.set(p.name, [String(p.flex_id || ''), String(p.cpt_id || '')]);
    }
    return { P, ids, source: 'list', has: { proj: !!has.proj, own: !!has.own, cpt_own: !!has.cpt_own, cpt_opt: !!has.cpt_opt } };
  };

  /* =================================================================
     3. ENGINE
     ================================================================= */
  const bucket = s => s <= 3 ? 'pk_3' : s <= 6.5 ? '3.5_6.5' : s <= 9.5 ? '7_9.5' : '10_plus';

  // opts: { fav, spread, total, wind=0, roof='outdoors', field=11700, n=8, lean='', keepOrder=false, rushingQbs=[] }
  const createEngine = (data, players, opts) => {
    const A = Object.assign({ wind: 0, roof: 'outdoors', field: 11700, n: 8, lean: '', keepOrder: false, rushingQbs: [] }, opts);
    A.spread = +A.spread; A.total = +A.total; A.wind = +A.wind; A.field = Math.trunc(+A.field); A.n = Math.trunc(+A.n);
    const E = data.engine || {};
    const RULES = { hard: data.hard_rules, soft: data.soft_penalties, captain_templates: data.captain_templates, portfolio: data.portfolio,
      scripts: { allocation_by_spread: data.allocation_by_spread, dog_win_prob_by_spread: E.dog_win_prob_by_spread, overlays: data.overlays }, user_leans: E.user_leans || {} };
    const RUSHING_QBS = new Set([...(E.rushing_qbs || []), ...A.rushingQbs]);
    const SHAPE_PEN = E.shape_off_template_penalty ?? 0.3;
    const { P, has } = players, ID = players.ids || new Map();
    const IDREV = new Map(); for (const [k, v] of ID) { IDREV.set(v[0], k); } for (const [k, v] of ID) { IDREV.set(v[1], k); }

    const teams = [...new Set([...P.values()].map(p => p.team))].sort();
    if (!teams.includes(A.fav)) throw new Error(`favorite ${A.fav} not in ${JSON.stringify(teams)}`);
    const DOG = teams.filter(t => t !== A.fav)[0];
    if (!DOG) throw new Error('player file has only one team');
    const SB = bucket(A.spread), DOG_WP = RULES.scripts.dog_win_prob_by_spread[SB];
    const rank = new Map();
    for (const t of teams) for (const pos of ['WR', 'RB', 'TE', 'QB'])
      [...P.values()].filter(p => p.team === t && p.pos === pos).sort((a, b) => b.sal - a.sal).forEach((p, i) => rank.set(p.name, i + 1));
    const NAMES = new Map(); for (const n of P.keys()) NAMES.set(pyLower(n), n);

    const resolve = cell => {
      let c = String(cell).trim().replace(/^"+|"+$/g, '');
      const m = /^([\s\S]*?)\s*\((\d+)\)\s*$/.exec(c); if (m) c = m[1].trim();
      if (/^\d+$/.test(c) && ID.size) c = IDREV.get(c) ?? c;
      if (P.has(c)) return c;
      if (NAMES.has(pyLower(c))) return NAMES.get(pyLower(c));
      const cs = pySplit(c); if (!cs.length) return null;
      const last = pyLower(cs[cs.length - 1]);
      const cand = [...P.keys()].filter(n => { const ns = pySplit(n); return ns.length && pyLower(ns[ns.length - 1]) === last && pyLower(n[0]) === pyLower(c[0]); });
      return cand.length === 1 ? cand[0] : null;
    };

    // --pool: Stokastic "Name (id)" CSV, generator .psv, DK id upload, DK entries export, pasted names.
    const loadPool = (text, psv = false) => {
      const rd = parseCSV(text, psv ? '|' : ','), rows = [];
      if (!rd.length) return rows;
      const H = rd[0].map(h => h.trim().toLowerCase());
      let slots = H.map((h, i) => (['cpt', 'flex', 'f1', 'f2', 'f3', 'f4', 'f5'].includes(h) || h.startsWith('flex')) ? i : -1).filter(i => i >= 0);
      if (!slots.length) slots = H.map((_, i) => i).slice(0, 6);
      const metric = {};
      const pats = { roi: ['roi'], win: ['win'], top10: ['top10', 'top 10', 'top_10'], dupes: ['dupe'], proj: ['proj'], own: ['own'] };
      for (const key of Object.keys(pats)) H.forEach((h, i) => { if (slots.includes(i)) return; if (pats[key].some(p => h.includes(p)) && !(key in metric)) metric[key] = i; });
      const maxSlot = Math.max(...slots);
      rd.slice(1).forEach((row, k) => {
        if (row.length < maxSlot + 1) return;
        const names = slots.map(i => resolve(row[i]));
        if (names.some(n => n == null) || names.length !== 6) { rows.push({ bad: true, raw: row, names }); return; }
        const L = { bad: false, cpt: names[0], flex: names.slice(1), idx: k };
        for (const key of Object.keys(metric)) { const v = pyFloat(String(row[metric[key]] ?? '').replace(/%/g, '').replace(/,/g, '')); if (v != null) L[key] = v; }
        rows.push(L);
      });
      return rows;
    };

    /* ---------- classify ---------- */
    const classify = L => {
      const c = P.get(L.cpt), side = c.team === A.fav ? 'FAV' : 'DOG', ownT = c.team;
      const fl = L.flex.map(n => P.get(n));
      const d = new Map(), qbs = new Set(); let ownCatch = 0, oppSkill = 0;
      const dd = k => d.get(k) || 0;
      if (c.pos === 'QB') qbs.add(ownT);
      for (const p of fl) {
        const rel = p.team === ownT ? 'own' : 'opp'; inc(d, `${rel}_${p.pos}`);
        if (p.pos === 'QB') qbs.add(p.team);
        if (rel === 'own' && (p.pos === 'WR' || p.pos === 'TE')) ownCatch += 1;
        if (rel === 'opp' && SKILL.has(p.pos)) oppSkill += 1;
      }
      const nOwn = 1 + fl.filter(p => p.team === ownT).length, nSlots = 1 + fl.length;
      const favN = side === 'FAV' ? nOwn : nSlots - nOwn;
      const sal = c.sal * 1.5 + sum(fl.map(p => p.sal));
      const cum = c.cpt_own + sum(fl.map(p => p.own));
      const prod = (Math.max(c.cpt_own, 0.05) / 100) * fl.reduce((a, p) => a * (Math.max(p.own, 0.05) / 100), 1);
      const dogQb = [c, ...fl].some(p => p.pos === 'QB' && p.team === DOG);
      const dogQbOwn = Math.max(...fl.filter(p => p.pos === 'QB' && p.team === DOG).map(p => p.own), 0);
      const kN = dd('own_K') + dd('opp_K'), dstN = dd('own_DST') + dd('opp_DST');
      const ctype = `${c.pos}_${side}`;
      const feats = { own_QB: dd('own_QB') > 0, own_RB: dd('own_RB') > 0, own_WR: dd('own_WR') > 0, own_TE: dd('own_TE') > 0, own_K: dd('own_K') > 0, own_DST: dd('own_DST') > 0,
        opp_QB: dd('opp_QB') > 0, opp_RB: dd('opp_RB') > 0, opp_WR: dd('opp_WR') > 0, opp_TE: dd('opp_TE') > 0, opp_K: dd('opp_K') > 0, opp_DST: dd('opp_DST') > 0,
        own_second_catcher: ownCatch >= (c.pos !== 'WR' && c.pos !== 'TE' ? 2 : 1), own_second_rb: dd('own_RB') >= (c.pos === 'RB' ? 1 : 2),
        own_second_te: dd('own_TE') >= (c.pos === 'TE' ? 1 : 2), both_qbs: qbs.size === 2 };
      const favCpt = side === 'FAV';
      let tag;
      if (favCpt && favN >= 5) tag = 'A';
      else if (favCpt && favN === 4 && !dogQb && !(dd('own_K') || dd('own_DST'))) tag = 'A';
      else if (favCpt && !feats.both_qbs) tag = 'B';
      else if (favCpt) tag = 'C';
      else if (favN <= 2) tag = 'D';
      else tag = feats.both_qbs ? 'C' : 'D';
      return { cpt: c, side, ctype, fl, d, feats, n_own: nOwn, split: `${nOwn}-${nSlots - nOwn}`, fav_n: favN, five_one_fav: favN === 5,
        sal, cum, prod, k_n: kN, dst_n: dstN, dog_qb: dogQb, dog_qb_own: dogQbOwn, own_catch: ownCatch, opp_skill: oppSkill,
        sub1k: fl.filter(p => p.sal < 1000).length, sub3: [c, ...fl].filter(p => p.own < 3).length, tag,
        est_dupes: ('dupes' in L) ? L.dupes : A.field * prod * 6, partial: fl.length < 5 };
    };

    /* ---------- hard rules: one ordered list, two views ----------
       Each rule reports {key, label, status: pass|fail|na|pending|unknown, msg}.
       hardCheck() = the failing msgs in rules_engine.py's order (parity);
       checklist() = every rule with its status (the page). 'pending' only
       on partial lineups for rules that more players could still satisfy;
       'unknown' only when the player file has no ownership/optimal data. */
    const H = RULES.hard, S = RULES.soft, T = RULES.captain_templates;
    const hardRules = X => {
      const c = X.cpt, dd = k => X.d.get(k) || 0, f = X.feats, out = [];
      const add = (key, label, applies, bad, msg, kind = 'max', needs) => {
        let status = !applies ? 'na' : bad ? 'fail' : 'pass';
        if (needs && !has[needs]) status = applies ? 'unknown' : 'na';
        else if (X.partial && kind === 'min' && status === 'fail') status = 'pending';
        out.push({ key, label, status, msg: status === 'fail' || status === 'pending' ? msg : '' });
      };
      add('max_kickers', `Max ${H.max_kickers} kicker`, true, X.k_n > H.max_kickers, `${X.k_n} kickers`);
      {
        // v1.3: DSTs counted in every slot (captain included); two DSTs only as a grind-script dart, never with a K.
        const dstAll = X.dst_n + (c.pos === 'DST' ? 1 : 0), req = H.two_dst_requires || {}, gt = RULES.scripts.overlays.grind.trigger;
        add('max_dst', `Max ${H.max_dst} DST`, true, dstAll > H.max_dst, `${dstAll} DST`);
        const grindOk = (req.or_grind_overlay ?? true) && (A.total <= gt.total_max || A.wind >= gt.or_wind_min);
        add('two_dst_requires', `Two DSTs: grind dart only (total ≤ ${req.total_max ?? '—'} or grind overlay)`, dstAll >= 2,
          !(grindOk || A.total <= (req.total_max ?? -1)), `2 DST outside a grind (total ${pyFloatRepr(A.total)})`);
        add('two_dst_no_k', 'Two DSTs: no kicker', dstAll >= 2, !!X.k_n && !req.allow_k, '2 DST + K');
      }
      add('max_k_plus_dst', `K + DST ≤ ${H.max_k_plus_dst}`, true, X.k_n + X.dst_n > H.max_k_plus_dst, 'K+DST>2');
      {
        let facing = 0, bad = false;
        if (X.dst_n && X.opp_skill + 0 > H.dst_max_opposing_skill) {
          const dstTeam = X.fl.filter(p => p.pos === 'DST').map(p => p.team)[0];
          facing = [c, ...X.fl].filter(p => SKILL.has(p.pos) && p.team !== dstTeam).length;
          bad = facing > H.dst_max_opposing_skill;
        }
        add('dst_max_opposing_skill', `DST faces ≤ ${H.dst_max_opposing_skill} skill players`, X.dst_n > 0, bad, `DST vs ${facing} opposing skill`);
      }
      add('captain_positions_never', `Never ${[].concat(H.captain_positions_never).join('/')} at captain`, true, H.captain_positions_never.includes(c.pos), 'K captain');
      {
        const min = H.captain_min_cpt_optimal_pct ?? 0;
        add('captain_min_cpt_optimal_pct', `Captain ≥ ${pyNum(min)}% CPT-optimal`, true, c.cpt_opt < min, `captain CPT-optimal ${pyFixed(c.cpt_opt, 1)}% < ${pyNum(H.captain_min_cpt_optimal_pct)}%`, 'max', 'cpt_opt');
      }
      add('no_dog_pocket_qb_captain_spread_min', `No dog pocket-QB captain at +${pyNum(H.no_dog_pocket_qb_captain_spread_min)}`,
        c.pos === 'QB' && X.side === 'DOG', A.spread >= H.no_dog_pocket_qb_captain_spread_min && !RUSHING_QBS.has(c.name), 'dog pocket-QB captain');
      add('min_salary_used', `Salary ≥ $${H.min_salary_used.toLocaleString('en-US')}`, true, X.sal < H.min_salary_used, `salary ${pyFixed(X.sal, 0)}`, 'min');
      add('max_salary', `Salary ≤ $${(H.max_salary ?? 50000).toLocaleString('en-US')}`, true, X.sal > (H.max_salary ?? 50000), `OVER CAP ${pyFixed(X.sal, 0)}`);
      add('min_players_from_captain_team', `≥ ${H.min_players_from_captain_team ?? 1} from the captain's team`, true, X.n_own < (H.min_players_from_captain_team ?? 1), `only ${X.n_own} from captain's team`, 'min');
      add('max_sub_1k_players', `≤ ${H.max_sub_1k_players} player under $1k`, true, X.sub1k > H.max_sub_1k_players, 'sub-$1k player');
      add('max_sub3pct_owned_players', `≤ ${H.max_sub3pct_owned_players} player under 3% owned`, true, X.sub3 > H.max_sub3pct_owned_players, `${X.sub3} sub-3%-owned`, 'max', 'own');
      add('wr_cpt_max_other_own_catchers', `WR captain: ≤ ${H.wr_cpt_max_other_own_catchers} other own catcher`, c.pos === 'WR', X.own_catch > H.wr_cpt_max_other_own_catchers, `WR CPT + ${X.own_catch} own catchers`);
      add('rb_cpt_max_other_own_rb', 'RB captain: no other own RB', c.pos === 'RB', dd('own_RB') > H.rb_cpt_max_other_own_rb, 'RB CPT + own RB');
      add('rb_cpt_max_own_skill_wide', `RB captain: ≤ ${H.rb_cpt_max_own_skill_wide} own catchers`, c.pos === 'RB', X.own_catch > H.rb_cpt_max_own_skill_wide, 'RB CPT 3-wide');
      {
        const rushing = RUSHING_QBS.has(c.name), need = rushing ? H.rushing_qb_cpt_min_own_catchers : H.pocket_qb_cpt_min_own_catchers;
        add(rushing ? 'rushing_qb_cpt_min_own_catchers' : 'pocket_qb_cpt_min_own_catchers', `${rushing ? 'Rushing' : 'Pocket'}-QB captain: ≥ ${need} own catcher${need === 1 ? '' : 's'}`,
          c.pos === 'QB', X.own_catch < need, `QB CPT with ${X.own_catch} own catchers (need ${need})`, 'min');
      }
      add('te_cpt_require_own_qb', 'TE captain: own QB in the lineup', c.pos === 'TE' && !!H.te_cpt_require_own_qb, !f.own_QB, 'TE CPT without own QB', 'min');
      add('te_cpt_max_own_k', 'TE captain: no own kicker', c.pos === 'TE', dd('own_K') > H.te_cpt_max_own_k, 'TE CPT + own K');
      add('te_cpt_max_other_own_te', 'TE captain: no other own TE', c.pos === 'TE', dd('own_TE') > H.te_cpt_max_other_own_te, 'TE CPT + own TE');
      return out;
    };
    const hardCheck = X => hardRules(X).filter(r => r.status === 'fail').map(r => r.msg);

    /* ---------- soft score + story fit + overlays ---------- */
    const ov = RULES.scripts.overlays;
    const SHOOTOUT = A.total >= ov.shootout.trigger.total_min;
    const GRIND = A.total <= ov.grind.trigger.total_max || A.wind >= ov.grind.trigger.or_wind_min;
    const softScore = X => {
      const pen = [], c = X.cpt, dd = k => X.d.get(k) || 0, f = X.feats;
      if (c.pos === 'QB' && dd('own_K')) pen.push(['QB CPT + own K', S.qb_cpt_own_k]);
      if (c.pos === 'QB' && X.side === 'FAV' && dd('own_DST')) pen.push(['fav QB CPT + own DST', S.qb_cpt_fav_own_dst]);
      if (c.pos === 'WR' && !f.own_QB) pen.push(['WR CPT without QB', S.wr_cpt_no_own_qb]);
      if (c.pos === 'RB' && X.side === 'FAV' && !f.own_WR) pen.push(['fav RB CPT without own WR', S.rb_cpt_fav_no_own_wr]);
      if (c.pos === 'RB' && f.own_QB && X.own_catch >= 2) pen.push(['RB CPT + full pass stack', S.rb_cpt_own_qb_and_two_catchers]);
      if (c.pos === 'RB' && X.side === 'DOG' && dd('own_TE')) pen.push(['dog RB CPT + own TE', S.rb_cpt_dog_own_te]);
      if (c.pos === 'TE' && X.dst_n) pen.push(['TE CPT + DST', S.te_cpt_any_dst]);
      if (c.pos === 'TE' && !f.opp_WR) pen.push(['TE CPT without opp WR', S.te_cpt_no_opp_wr]);
      if (f.both_qbs && c.pos === 'RB' && X.side === 'FAV') pen.push(['both QBs w/ fav RB CPT', S.both_qbs_with_fav_rb_cpt]);
      if (f.both_qbs && c.pos === 'WR' && X.side === 'DOG') pen.push(['both QBs w/ dog WR CPT', S.both_qbs_with_dog_wr_cpt]);
      const lp = S.sub_1k_player_low_proj;
      if (lp && has.proj) for (const p of X.fl) if (p.sal < 1000 && p.proj < lp.proj_threshold) pen.push([`punt ${p.name} proj ${pyFixed(p.proj, 1)}`, lp.penalty]);
      const dq = S.dog_qb_in_lineup_when_field_own_over;
      if (has.own && X.dog_qb && X.dog_qb_own >= dq.own_threshold) pen.push([`dog QB at ${pyFixed(X.dog_qb_own, 0)}% own`, dq.penalty]);
      if (f.opp_WR && X.side === 'FAV' && (c.pos === 'RB' || c.pos === 'QB')) pen.push([`opp WR w/ fav ${c.pos} CPT`, S.opp_wr_with_fav_rb_or_fav_qb_cpt]);   // v1.4: applies in shootouts too
      const t = T[X.ctype]; let fit = 0.0, inc_ = [], avd_ = [];
      if (t) {
        inc_ = t.include.filter(k => f[k]); avd_ = t.avoid.filter(k => f[k]);
        fit = inc_.length / t.include.length - 0.5 * avd_.length / Math.max(1, t.avoid.length);
        if (!t.shapes.includes(X.split)) pen.push([`shape ${X.split} off-template for ${X.ctype}`, SHAPE_PEN]);
      }
      const adj = [];
      if (SHOOTOUT && c.pos === 'TE') adj.push(['shootout TE CPT', -ov.shootout.te_cpt_bonus]);
      if (SHOOTOUT && c.pos === 'RB') adj.push(['shootout RB CPT', ov.shootout.rb_cpt_penalty]);
      if (GRIND && c.pos === 'RB') adj.push(['grind RB CPT', -ov.grind.rb_cpt_bonus]);
      if (GRIND && c.pos === 'QB') adj.push(['grind QB CPT', ov.grind.qb_cpt_penalty]);
      if (ov.dome.trigger.roof.includes(A.roof) && c.pos === 'TE') adj.push(['dome TE CPT', ov.dome.te_cpt_penalty]);
      if (A.wind >= ov.wind.trigger.wind_min && c.pos === 'QB') adj.push(['wind QB CPT', ov.wind.qb_cpt_penalty]);
      return { pen: [...pen, ...adj], fit, template: t ? { key: X.ctype, include: t.include, avoid: t.avoid, shapes: t.shapes, hit: inc_, miss: t.include.filter(k => !f[k]), avoided: avd_ } : null };
    };

    /* ---------- rank ---------- */
    const baseRank = (L, i) => {
      if ('roi' in L) return L.roi;
      if ('proj' in L) return L.proj;
      if (A.keepOrder) return -i;
      return P.get(L.cpt).proj * 1.5 + sum(L.flex.map(x => P.get(x).proj));
    };
    const evaluate = pool => {
      const rows = pool.map((L, i) => { const X = classify(L), hv = hardCheck(X), s = softScore(X); return { L, X, hard: hv, pen: s.pen, fit: s.fit, template: s.template, base: baseRank(L, i) }; });
      const order = rows.map((_, i) => i).sort((a, b) => rows[b].base - rows[a].base);
      order.forEach((i, pct) => { rows[i].pctl = pct / rows.length; rows[i].simrank = pct + 1; });
      const hasRoi = rows.length > 5 && rows.every(r => 'roi' in r.L);
      let med = 0, top = 0;
      if (hasRoi) { med = median(rows.map(r => r.L.roi)); top = Math.max(...rows.map(r => r.L.roi)); }
      for (const r of rows) {
        let mag = 0.0;
        if (hasRoi && top > med) mag = 2.0 * Math.max(0.0, (r.L.roi - med) / (top - med));
        r.mag = mag;
        r.score = (1 - r.pctl) * 4 + mag + r.fit * 1.0 - sum(r.pen.map(p => p[1]));
      }
      return rows;
    };

    /* ---------- portfolio settings (after overlays + lean) ---------- */
    let shootout = SHOOTOUT, grind = GRIND;
    const PF = RULES.portfolio;
    let K_SHARE = PF.k_share[shootout ? 'shootout' : grind ? 'grind' : 'default'];
    let DST_SHARE = PF.dst_share[shootout ? 'shootout' : grind ? 'grind' : 'default'];
    let BOTHQB_MAX = PF.both_qbs_share_max;
    if (shootout) BOTHQB_MAX = ov.shootout.both_qbs_share_max;
    if (grind) BOTHQB_MAX = ov.grind.both_qbs_share_max;
    let ALLOC = RULES.scripts.allocation_by_spread[SB];
    const LEAN = A.lean ? (RULES.user_leans[A.lean] || null) : null;
    if (LEAN) {
      if (LEAN.disable_shootout_overlay) shootout = false;
      ALLOC = LEAN.allocation ?? ALLOC; K_SHARE = LEAN.k_share ?? K_SHARE; DST_SHARE = LEAN.dst_share ?? DST_SHARE;
      BOTHQB_MAX = LEAN.both_qbs_share_max ?? BOTHQB_MAX;
    }
    const DUPE_MAX = PF.dupes_max_by_field.find(([lim]) => A.field <= lim)[1];
    const settings = { SB, DOG, DOG_WP, shootout, grind, K_SHARE, DST_SHARE, BOTHQB_MAX, ALLOC, DUPE_MAX, LEAN };

    /* ---------- select (rules_engine.py default mode) ---------- */
    const select = rows => {
      const N = A.n, CE = PF.share_ceilings || {};
      const elig = rows.filter(r => !r.hard.length && r.pctl <= PF.sim_rank_max_percentile && r.X.est_dupes <= DUPE_MAX).sort((a, b) => b.score - a.score);
      const chosen = [], log = [];
      const cnt = (fn, list = chosen) => list.filter(q => fn(q.X)).length;
      const names = X => [X.cpt.name, ...X.fl.map(p => p.name)];
      const ok = (r, chosen) => {
        const X = r.X, c = X.cpt.name;
        const c_ = fn => chosen.filter(q => fn(q.X)).length;
        if (c_(q => q.cpt.name === c) >= Math.min(PF.max_per_captain_abs, Math.max(1, Math.floor(PF.max_per_captain_share * N)))) return 'captain cap';
        for (const q of chosen) { const s = new Set(names(q.X)); if (new Set(names(X).filter(n => s.has(n))).size > PF.max_overlap_players) return 'overlap'; }
        if (X.cpt.pos === 'DST' && c_(q => q.cpt.pos === 'DST') >= Math.floor(N / 20) * (PF.dst_captain_per_20 ?? 1)) return 'DST captain cap';
        const cps = (LEAN ? LEAN.captain_position_share_max : null) || PF.captain_position_share_max || {};
        if (X.cpt.pos in cps && (c_(q => q.cpt.pos === X.cpt.pos) + 1) / N > cps[X.cpt.pos] + 1e-9) return `${X.cpt.pos} captain share`;
        const top = r.pctl <= (PF.sim_override_pctl ?? 0);
        const bqCap = top ? (CE.both_qbs ?? BOTHQB_MAX) : BOTHQB_MAX;
        if (X.feats.both_qbs && (c_(q => q.feats.both_qbs) + 1) / N > bqCap + 1e-9) return 'both-QB share';
        if (X.k_n >= 2 && c_(q => q.k_n >= 2) >= PF.two_k_max) return 'two-K cap';
        if (X.k_n >= 2 && A.total < S.two_k_min_total) return 'two-K needs total ≥52';
        const twoDst = Y => Y.dst_n + (Y.cpt.pos === 'DST' ? 1 : 0) >= 2;
        if (twoDst(X) && c_(twoDst) >= (PF.two_dst_max_per_batch ?? 0)) return 'two-DST cap';
        const kCap = top ? (CE.k ?? K_SHARE[1]) : K_SHARE[1], dCap = top ? (CE.dst ?? DST_SHARE[1]) : DST_SHARE[1];
        if (X.k_n && (c_(q => q.k_n) + 1) / N > kCap + 1e-9) return 'K share max' + (top ? ' (ceiling)' : '');
        if (X.dst_n && (c_(q => q.dst_n) + 1) / N > dCap + 1e-9) return 'DST share max' + (top ? ' (ceiling)' : '');
        const extra = LEAN ? (LEAN.dog_qb_share_extra ?? PF.dog_qb_in_lineup_share_max_over_dog_winprob) : PF.dog_qb_in_lineup_share_max_over_dog_winprob;
        if (X.dog_qb && (c_(q => q.dog_qb) + 1) / N > DOG_WP + extra + 1e-9) return 'dog-QB share';
        if (LEAN && X.side === 'DOG' && (c_(q => q.side === 'DOG') + 1) / N > (LEAN.dog_captain_share_max ?? 1) + 1e-9) return 'dog-captain share (lean)';
        const tag = X.tag, quota = Math.ceil(ALLOC[tag] * N) + 1;
        if (c_(q => q.tag === tag) >= quota) return `script ${tag} quota`;
        if (X.sub1k && (c_(q => q.sub1k) + 1) / N > (PF.sub_1k_share_max ?? 1) + 1e-9) return 'punt share';
        for (const p of X.fl) if (p.own < PF.nonchalk_own_threshold && (chosen.filter(q => q.X.fl.some(x => x.name === p.name)).length + 1) / N > PF.nonchalk_flex_share_max) return `exposure ${p.name}`;
        return null;
      };
      const need51 = A.spread >= PF.big_spread ? PF.five_one_fav_min_count_big_spread : A.spread >= PF.five_one_fav_min_spread ? PF.five_one_fav_min_count : 0;
      const need = LEAN ? Math.max(need51, LEAN.five_one_fav_min_count ?? 0) : need51;
      for (const r of elig) {
        if (chosen.filter(q => q.X.five_one_fav).length >= need) break;
        if (r.X.five_one_fav && !ok(r, chosen)) { chosen.push(r); log.push(`forced 5-1 fav: ${fmt(r)}`); }
      }
      for (const r of elig) {
        if (chosen.length >= N) break;
        if (chosen.includes(r)) continue;
        const why = ok(r, chosen);
        if (why) { log.push(`skip (sim ${r.simrank}, ${why}): ${r.X.cpt.name} CPT`); continue; }
        chosen.push(r);
      }
      const cover = { FAV_WR1: X => X.cpt.pos === 'WR' && X.side === 'FAV' && rank.get(X.cpt.name) === 1,
        FAV_RB1: X => X.cpt.pos === 'RB' && X.side === 'FAV' && rank.get(X.cpt.name) === 1,
        FAV_QB: X => X.cpt.pos === 'QB' && X.side === 'FAV',
        DOG_WR1: X => X.cpt.pos === 'WR' && X.side === 'DOG' && rank.get(X.cpt.name) === 1 };
      const covered = (key, list) => list.some(q => cover[key](q.X));
      const COV = PF.captain_shortlist_min_coverage || [];
      for (const key of COV) {
        if (covered(key, chosen)) continue;
        let done = false;
        for (const v of chosen.slice().sort((a, b) => a.score - b.score)) {
          const others = chosen.filter(q => q !== v);
          if (COV.some(k2 => k2 !== key && covered(k2, chosen) && !covered(k2, others))) continue;
          for (const cand of elig) {
            if (chosen.includes(cand) || !cover[key](cand.X)) continue;
            if (!ok(cand, others)) { chosen.splice(chosen.indexOf(v), 1); chosen.push(cand); log.push(`coverage ${key}: out ${v.X.cpt.name} CPT (sim ${v.simrank}) → in ${fmt(cand)}`); done = true; break; }
          }
          if (done) break;
        }
        if (!done) log.push(`coverage ${key}: no eligible swap`);
      }
      const share = fn => cnt(fn) / Math.max(1, chosen.length);
      const notes = [];
      for (const [label, hasF, lo] of [['K', X => X.k_n > 0, K_SHARE[0]], ['DST', X => X.dst_n > 0, DST_SHARE[0]]]) {
        let tries = 0;
        while (share(hasF) < lo - 1e-9 && tries < N) {
          tries += 1;
          const victims = chosen.filter(q => !hasF(q.X)).sort((a, b) => a.score - b.score);
          if (!victims.length) break;
          let swapped = false;
          for (const cand of elig) {
            if (chosen.includes(cand) || !hasF(cand.X)) continue;
            const v = victims[0]; chosen.splice(chosen.indexOf(v), 1);
            if (!ok(cand, chosen)) { chosen.push(cand); log.push(`swap for ${label} share: out ${v.X.cpt.name} CPT (sim ${v.simrank}) → in ${fmt(cand)}`); swapped = true; break; }
            chosen.push(v);
          }
          if (!swapped) break;
        }
      }
      if (share(X => X.k_n > 0) < K_SHARE[0]) notes.push(`K share ${pyPct(share(X => X.k_n > 0))} below target ${pyPct(K_SHARE[0])} — consider swapping the lowest-score no-K lineup for the next K lineup`);
      if (share(X => X.dst_n > 0) < DST_SHARE[0]) notes.push(`DST share ${pyPct(share(X => X.dst_n > 0))} below target ${pyPct(DST_SHARE[0])}`);
      if (A.spread >= PF.big_spread && share(X => X.side === 'FAV') < PF.fav_captain_share_min_big_spread) notes.push('favorite-captain share below 50% at a 7+ spread');
      if (LEAN && share(X => X.side === 'FAV') < (LEAN.fav_captain_share_min ?? 0)) notes.push(`favorite-captain share ${pyPct(share(X => X.side === 'FAV'))} below the lean's ${pyPct(LEAN.fav_captain_share_min)}`);
      chosen.sort((a, b) => a.simrank - b.simrank);
      return { chosen, elig, log, notes, share };
    };

    /* ---------- text output (byte-identical to rules_engine.py) ---------- */
    function fmt(r) {
      const X = r.X, c = X.cpt;
      const roi = 'roi' in r.L ? ` · ROI ${pyFixed(r.L.roi, 0)}%` : '';
      return `CPT ${c.name} (${X.ctype}, ${pyFixed(c.cpt_own, 1)}% own / ${pyFixed(c.cpt_opt, 1)}% opt) · ${X.fl.map(p => p.name).join(', ')} · ${X.split} · K${X.k_n} D${X.dst_n} · cum ${pyFixed(X.cum, 0)}% · dupes~${pyFixed(X.est_dupes, 0)}${roi} · script ${X.tag}`;
    }
    const header = rows => [
      `# Rules engine — ${A.fav} −${pyFloatRepr(A.spread)} vs ${DOG}, total ${pyFloatRepr(A.total)}, wind ${pyFloatRepr(A.wind)}, roof ${A.roof}; field ${A.field}; spread bucket ${SB} (dog win prob ${pyPct(DOG_WP)})`,
      `Lean: ${A.lean || 'none'} · Overlays: shootout=${pyRepr(shootout)} grind=${pyRepr(grind)} · K share target ${pyRepr(K_SHARE)} · DST share ${pyRepr(DST_SHARE)} · both-QB max ${pyPct(BOTHQB_MAX)} · script allocation ${pyRepr(ALLOC)} · dupes ≤${DUPE_MAX}`,
      `Pool: ${rows.length} lineups; ${rows.filter(r => r.hard.length).length} fail hard rules.\n`
    ];
    const penText = pen => pen.map(([k, v]) => v > 0 ? `${k} (−${pyNum(v)})` : `${k} (+${pyNum(-v)})`).join('; ');
    const text = {
      audit: rows => [...header(rows),
        '| # | sim rank | lineup | hard violations | soft penalties | fit | score |\n|---|---|---|---|---|---|---|',
        ...rows.map((r, i) => `| ${i + 1} | ${r.simrank} | ${fmt(r)} | ${r.hard.join('; ') || '—'} | ${penText(r.pen) || '—'} | ${pySigned(r.fit, 2)} | ${pyFixed(r.score, 2)} |`)].join('\n') + '\n',
      select: rows => {
        const S_ = select(rows), { chosen, elig, log, notes, share } = S_;
        const cap = new Map(), tags = new Map(), exp = new Map();
        for (const r of chosen) { inc(cap, r.X.cpt.name); inc(tags, r.X.tag); for (const p of r.X.fl) inc(exp, p.name); }
        const L = [...header(rows), `## Selected ${chosen.length} of ${A.n} (eligible pool ${elig.length})\n`,
          '| # | sim rank | score | lineup | penalties |\n|---|---|---|---|---|',
          ...chosen.map((r, i) => `| ${i + 1} | ${r.simrank} | ${pyFixed(r.score, 2)} | ${fmt(r)} | ${r.pen.map(p => p[0]).join('; ') || '—'} |`),
          `\nCaptains: ${pyRepr(cap)} · scripts: ${pyRepr(tags)} (target ${pyRepr(ALLOC)}) · K ${pyPct(share(X => X.k_n > 0))} · DST ${pyPct(share(X => X.dst_n > 0))} · both-QB ${pyPct(share(X => X.feats.both_qbs))} · dog-QB ${pyPct(share(X => X.dog_qb))} · 5-1 fav ${chosen.filter(r => r.X.five_one_fav).length}`,
          'Flex exposure: ' + mostCommon(exp, 10).map(([n, c]) => `${n} ${c}/${chosen.length}`).join(', '),
          ...notes.map(n => '⚠ ' + n),
          '\n<details><summary>selection log</summary>\n\n' + log.map(l => '- ' + l).join('\n') + '\n</details>'];
        return L.join('\n') + '\n';
      },
      dump: rows => rows.map(r => { const X = r.X; return { cpt: X.cpt.name, flex: X.fl.map(p => p.name), ctype: X.ctype, side: X.side, split: X.split, tag: X.tag, k_n: X.k_n, dst_n: X.dst_n,
        both_qbs: X.feats.both_qbs, dog_qb: X.dog_qb, five_one_fav: X.five_one_fav, cum: X.cum, sub1k: X.sub1k, est_dupes: X.est_dupes,
        cpt_own: X.cpt.cpt_own, cpt_opt: X.cpt.cpt_opt, fit: r.fit, hard: r.hard, pen: r.pen.map(p => p[0]), score: r.score, simrank: r.simrank,
        roi: r.L.roi ?? null, win: r.L.win ?? null, dupes: r.L.dupes ?? null, feats: Object.fromEntries(Object.entries(X.feats).map(([k, v]) => [k, !!v])) }; })
    };

    /* =================================================================
       4. PAGE HELPERS (additive — not part of the parity contract)
       ================================================================= */
    const SCRIPT_NAMES = { A: 'Favorite blowout', B: 'Favorite controls', C: 'Coin flip', D: 'Dog upset' };

    // Score one lineup (complete or partial) for the Lineup Lab.
    // L = { cpt: name, flex: [names] } (names already resolved).
    const scoreOne = L => {
      const X = classify(L), rules = hardRules(X), s = softScore(X);
      const penSum = sum(s.pen.map(p => p[1]));
      return { X, rules, hard: rules.filter(r => r.status === 'fail').map(r => r.msg), pen: s.pen, penSum, fit: s.fit, template: s.template,
        script: { tag: X.tag, name: SCRIPT_NAMES[X.tag], alloc: ALLOC[X.tag] },
        dupes: has.own ? { est: X.est_dupes, gate: DUPE_MAX, ok: X.est_dupes <= DUPE_MAX } : null };
    };

    // Batch report for lineups the user already built (no selection):
    // every portfolio cap from rules.json as pass/warn/fail with the number.
    const portfolioReport = rows => {
      const N = rows.length, out = [];
      if (!N) return out;
      const share = fn => rows.filter(r => fn(r.X)).length / N;
      const add = (key, label, value, target, status, detail) => out.push({ key, label, value, target, status, detail });
      const capN = Math.min(PF.max_per_captain_abs, Math.max(1, Math.floor(PF.max_per_captain_share * N)));
      const caps = new Map(); rows.forEach(r => inc(caps, r.X.cpt.name));
      const worst = mostCommon(caps, 1)[0];
      add('captain_cap', 'Most lineups on one captain', `${worst[1]} · ${worst[0]}`, `≤ ${capN}`, worst[1] > capN ? 'fail' : 'pass', `${pyPct(PF.max_per_captain_share)} of the batch, max ${PF.max_per_captain_abs}`);
      let maxOv = 0; const nm = X => [X.cpt.name, ...X.fl.map(p => p.name)];
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { const s = new Set(nm(rows[i].X)); maxOv = Math.max(maxOv, new Set(nm(rows[j].X).filter(n => s.has(n))).size); }
      if (N > 1) add('overlap', 'Max shared players between two lineups', String(maxOv), `≤ ${PF.max_overlap_players}`, maxOv > PF.max_overlap_players ? 'fail' : 'pass', 'any pair');
      const band = (key, label, v, lo, hi) => add(key, label, pyPct(v), `${pyPct(lo)}–${pyPct(hi)}`, v > hi + 1e-9 ? 'fail' : v < lo - 1e-9 ? 'warn' : 'pass', 'share of lineups');
      band('k_share', 'Kicker share', share(X => X.k_n > 0), K_SHARE[0], K_SHARE[1]);
      band('dst_share', 'DST share', share(X => X.dst_n > 0), DST_SHARE[0], DST_SHARE[1]);
      const bq = share(X => X.feats.both_qbs);
      add('both_qbs', 'Both-QB share', pyPct(bq), `≤ ${pyPct(BOTHQB_MAX)}`, bq > BOTHQB_MAX + 1e-9 ? 'fail' : 'pass', shootout ? 'shootout overlay' : grind ? 'grind overlay' : 'portfolio default');
      const dq = share(X => X.dog_qb), dqMax = DOG_WP + PF.dog_qb_in_lineup_share_max_over_dog_winprob;
      add('dog_qb', 'Dog QB in lineup', pyPct(dq), `≤ ${pyPct(dqMax)}`, dq > dqMax + 1e-9 ? 'fail' : 'pass', `dog win prob ${pyPct(DOG_WP)} + ${pyPct(PF.dog_qb_in_lineup_share_max_over_dog_winprob)}`);
      const need51 = A.spread >= PF.big_spread ? PF.five_one_fav_min_count_big_spread : A.spread >= PF.five_one_fav_min_spread ? PF.five_one_fav_min_count : 0;
      const n51 = rows.filter(r => r.X.five_one_fav).length;
      if (need51) add('five_one', '5-1 favorite lineups', String(n51), `≥ ${Math.min(need51, N)}`, n51 >= Math.min(need51, N) ? 'pass' : 'warn', `spread ≥ ${A.spread >= PF.big_spread ? PF.big_spread : PF.five_one_fav_min_spread}`);
      if (A.spread >= PF.big_spread) { const fv = share(X => X.side === 'FAV'); add('fav_cpt', 'Favorite-captain share', pyPct(fv), `≥ ${pyPct(PF.fav_captain_share_min_big_spread)}`, fv < PF.fav_captain_share_min_big_spread ? 'warn' : 'pass', `spread ≥ ${PF.big_spread}`); }
      const cps = PF.captain_position_share_max || {};
      for (const pos of Object.keys(cps)) { const v = share(X => X.cpt.pos === pos); if (v > cps[pos] + 1e-9) add(`cpt_${pos}`, `${pos} captain share`, pyPct(v), `≤ ${pyPct(cps[pos])}`, 'fail', 'captain position cap'); }
      const tags = new Map(['A', 'B', 'C', 'D'].map(k => [k, 0])); rows.forEach(r => inc(tags, r.X.tag));
      add('scripts', 'Script mix', [...tags].map(([k, v]) => `${v}${k}`).join(' · '), ['A', 'B', 'C', 'D'].map(k => `${Math.round(ALLOC[k] * 100)}`).join('/'),
        [...tags].some(([k, v]) => v > Math.ceil(ALLOC[k] * N) + 1) ? 'warn' : 'pass', 'target allocation for this spread');
      const punt = share(X => X.sub1k);
      add('punt', 'Lineups with a sub-$1k player', pyPct(punt), `≤ ${pyPct(PF.sub_1k_share_max ?? 1)}`, punt > (PF.sub_1k_share_max ?? 1) + 1e-9 ? 'fail' : 'pass', 'punt share');
      if (has.own) {
        const exp = new Map(); rows.forEach(r => r.X.fl.forEach(p => { if (p.own < PF.nonchalk_own_threshold) inc(exp, p.name); }));
        const top = mostCommon(exp, 1)[0];
        if (top && N > 1) add('nonchalk', 'Top non-chalk flex exposure', `${top[1]}/${N} · ${top[0]}`, `≤ ${pyPct(PF.nonchalk_flex_share_max)}`, top[1] / N > PF.nonchalk_flex_share_max + 1e-9 ? 'fail' : 'pass', `players under ${PF.nonchalk_own_threshold}% owned`);
        const dup = rows.filter(r => r.X.est_dupes > DUPE_MAX).length;
        add('dupes', 'Lineups over the dupe gate', String(dup), `0 (≤ ${DUPE_MAX} dupes each)`, dup ? 'fail' : 'pass', `field ${A.field.toLocaleString('en-US')}`);
      }
      const cover = { FAV_WR1: X => X.cpt.pos === 'WR' && X.side === 'FAV' && rank.get(X.cpt.name) === 1, FAV_RB1: X => X.cpt.pos === 'RB' && X.side === 'FAV' && rank.get(X.cpt.name) === 1,
        FAV_QB: X => X.cpt.pos === 'QB' && X.side === 'FAV', DOG_WR1: X => X.cpt.pos === 'WR' && X.side === 'DOG' && rank.get(X.cpt.name) === 1 };
      if (N >= 4) { const miss = (PF.captain_shortlist_min_coverage || []).filter(k => !rows.some(r => cover[k](r.X)));
        add('coverage', 'Captain coverage', miss.length ? `missing ${miss.join(', ')}` : 'all four seats', 'FAV WR1 · FAV RB1 · FAV QB · DOG WR1', miss.length ? 'warn' : 'pass', 'batches of 4+'); }
      return out;
    };

    return { A, P, has, teams, DOG, SB, DOG_WP, rank, settings, resolve, loadPool, classify, hardCheck, hardRules, softScore, evaluate, select, scoreOne, portfolioReport, fmt, text };
  };

  return { parseCSV, pyFloat, pyFixed, pyPct, pyFloatRepr, pyRepr, readPlayers, readStokastic, readDraftKings, readIdMap, mergePlayers, playersFromList, bucket, createEngine };
});
