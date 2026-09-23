/* =====================================================================
   BIRDIEBUDDY — CLASSIC ENGINE (JS port of codex/classic_engine.py)
   Per-lineup audit for DK classic (main slate): classify → hard rules →
   soft flags, driven by rules.json["classic"] as copied into the page
   JSON (classic_playbook.json → rules.hard / rules.soft / rules.portfolio).

   Parity contract: given the same Data Hub file, pool file and lines
   file, `auditText` reproduces classic_engine.py --audit byte for byte
   (tools/classic_parity.py runs both and diffs them). The portfolio
   selection half of classic_engine.py (default mode) is NOT ported —
   the page checks one lineup at a time.
   Everything beyond the contract (DK salary files, roster validity,
   missing-ownership mode, the page checklist) is additive and lives in
   the helpers after section 2.

   Pure: no DOM. Needs showdown_engine.js (Python-compatible CSV parsing
   and number formatting). Loads in the browser as BBI.classicEngine and
   in node via require().
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./showdown_engine.js'));
  else { root.BBI = root.BBI || {}; root.BBI.classicEngine = factory(root.BBI.showdownEngine); }
})(typeof self !== 'undefined' ? self : this, function (SE) {
  'use strict';
  const { parseCSV, pyFloat, pyFixed, pyFloatRepr } = SE;
  const SLOT_HDR = ['qb', 'rb', 'wr', 'te', 'flex', 'dst'];
  const SKILL = ['RB', 'WR', 'TE'];

  /* =================================================================
     1. PLAYER FILES
     ================================================================= */
  // Stokastic Data Hub MAIN export (classic_engine.py --proj): Player,Salary,Position,Team,Opponent,Projection,Ownership %,Optimal %
  // g(k) = float(r.get(k) or 0): exact header name, missing/empty → 0.
  const readDataHub = rows => {
    const hdr = rows[0], P = new Map();
    for (const raw of rows.slice(1)) {
      if (!raw.length) continue;
      const r = new Map(); hdr.forEach((h, i) => r.set(h, i < raw.length ? raw[i] : null));
      const g = k => { const v = r.get(k); if (v == null || v === '') return 0.0; const x = pyFloat(v); if (x == null) throw new Error(`bad number ${JSON.stringify(v)} in ${k}`); return x; };
      const name = String(r.get('Player') ?? '').trim();
      P.set(name, { name, sal: g('Salary'), pos: String(r.get('Position') ?? '').trim(), team: String(r.get('Team') ?? '').trim(), opp: String(r.get('Opponent') ?? '').trim(),
        proj: g('Projection'), own: g('Ownership %'), opt: g('Optimal %') });
    }
    const H = hdr.map(h => h.trim());
    return { P, source: 'stokastic', has: { proj: H.includes('Projection'), own: H.includes('Ownership %'), opt: H.includes('Optimal %') }, ids: new Map() };
  };

  // DraftKings classic salary file (DKSalaries.csv) or a DK upload/entries template with the player list on the right.
  // Public DK fields only: name, position, team, opponent (from Game Info), salary, id.
  const readDraftKings = rows => {
    const hi = rows.findIndex(r => r.some(c => c.trim() === 'Roster Position') && r.some(c => c.trim() === 'Salary'));
    if (hi < 0) return null;
    const hdr = rows[hi].map(c => c.trim()), col = k => hdr.indexOf(k);
    const cN = col('Name'), cId = col('ID'), cSal = col('Salary'), cPos = col('Position'), cTeam = col('TeamAbbrev'), cGame = col('Game Info'), cRP = col('Roster Position');
    const P = new Map(), ids = new Map();
    for (const r of rows.slice(hi + 1)) {
      const name = (r[cN] || '').trim(); if (!name) continue;
      if ((r[cRP] || '').trim().toUpperCase() === 'CPT') continue;         // a showdown file slipped in: skip captain rows
      const team = (r[cTeam] || '').trim(), gi = (r[cGame] || '').trim();
      const m = /^([A-Z]{2,4})@([A-Z]{2,4})/.exec(gi);
      const opp = m ? (m[1] === team ? m[2] : m[2] === team ? m[1] : '') : '';
      P.set(name, { name, sal: pyFloat(r[cSal]) ?? 0, pos: (r[cPos] || '').trim(), team, opp, proj: 0, own: 0, opt: 0, game: gi });
      if (cId >= 0) ids.set(name, (r[cId] || '').trim());
    }
    return { P, source: 'draftkings', has: { proj: false, own: false, opt: false }, ids };
  };

  const readPlayers = text => {
    const rows = parseCSV(text);
    if (!rows.length) throw new Error('empty file');
    const H = rows[0].map(h => h.trim());
    if (H.includes('Player') && H.includes('Salary') && H.includes('Position') && H.includes('Team')) {
      if (H.includes('CPT Ownership %')) throw new Error('that is a showdown Data Hub export — the classic checker needs the MAIN slate export');
      return readDataHub(rows);
    }
    const dk = readDraftKings(rows); if (dk && dk.P.size) return dk;
    throw new Error('unrecognised file — expected a DraftKings classic salary CSV (DKSalaries.csv) or a Stokastic Data Hub main-slate export');
  };

  // DK salaries (ids, opponents) + Data Hub (own / opt / proj), merged by name. Numeric fields only come from a file that has them.
  const mergePlayers = (base, extra) => {
    if (!base) return extra; if (!extra) return base;
    const P = new Map(base.P);
    for (const [n, p] of extra.P) {
      const q = P.get(n); if (!q) { P.set(n, p); continue; }
      const m = { ...q, sal: p.sal || q.sal, opp: p.opp || q.opp, team: p.team || q.team, pos: p.pos || q.pos };
      for (const f of ['proj', 'own', 'opt']) m[f] = extra.has[f] ? p[f] : base.has[f] ? q[f] : (p[f] || q[f] || 0);
      P.set(n, m);
    }
    const has = {}; for (const k of ['proj', 'own', 'opt']) has[k] = !!(base.has[k] || extra.has[k]);
    return { P, has, ids: new Map([...base.ids, ...extra.ids]), source: `${base.source}+${extra.source}` };
  };

  // The page's sample pool: [{name,pos,team,opp,sal}] — public DK fields, no ownership.
  const playersFromList = list => {
    const P = new Map();
    for (const p of list) P.set(p.name, { name: p.name, sal: +p.sal || 0, pos: p.pos, team: p.team, opp: p.opp || '', proj: 0, own: +p.own || 0, opt: +p.opt || 0 });
    return { P, ids: new Map(), source: 'list', has: { proj: false, own: false, opt: false } };
  };

  // Lines keyed by team, team-relative (negative = favored), exactly as classic_engine.py builds LINES.
  //   rows: [{home, away, spread_line (home-relative, nflverse sign: + = home favored), total_line}]
  const linesFromCsv = text => {
    const rows = parseCSV(text), hdr = rows[0].map(h => h.trim()), L = new Map();
    for (const raw of rows.slice(1)) {
      if (!raw.length) continue;
      const r = {}; hdr.forEach((h, i) => { r[h] = raw[i]; });
      const sl = pyFloat(r.spread_line), tl = pyFloat(r.total_line);
      L.set(r.home, { spread: -sl, total: tl });
      L.set(r.away, { spread: sl, total: tl });
    }
    return L;
  };
  // The page's game rows: [{away, home, fav, spread (≥0, points the fav gives), total}]
  const linesFromGames = games => {
    const L = new Map();
    for (const g of games) {
      if (!g.away || !g.home || !isFinite(+g.total) || !isFinite(+g.spread)) continue;
      const s = Math.abs(+g.spread), favHome = g.fav === g.home;
      L.set(g.home, { spread: favHome ? -s : s, total: +g.total, opp: g.away });
      L.set(g.away, { spread: favHome ? s : -s, total: +g.total, opp: g.home });
    }
    return L;
  };

  /* =================================================================
     2. ENGINE (the parity core)
     ================================================================= */
  const combos2 = a => { const out = []; for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) out.push([a[i], a[j]]); return out; };
  const counter = arr => { const m = new Map(); for (const k of arr) m.set(k, (m.get(k) || 0) + 1); return m; };
  const gameKey = p => [p.team, p.opp].sort().join('|');

  const createEngine = (rules, players, lines = new Map()) => {
    const H = rules.hard, S = rules.soft;
    const P = players.P, ID = players.ids || new Map();
    const IDREV = new Map(); for (const [n, id] of ID) if (id) IDREV.set(String(id), n);
    const NAMES = new Map(); for (const n of P.keys()) NAMES.set(n.toLowerCase(), n);
    const split = s => String(s).trim().split(/\s+/).filter(Boolean);

    const resolve = cell => {
      let c = String(cell).trim();
      const m = /^([\s\S]*?)\s*\((\d+)\)\s*$/.exec(c); if (m) c = m[1].trim();
      if (/^\d+$/.test(c)) c = IDREV.get(c) ?? c;
      if (P.has(c)) return c;
      if (NAMES.has(c.toLowerCase())) return NAMES.get(c.toLowerCase());
      const cs = split(c); if (!cs.length) return null;
      const last = cs[cs.length - 1].toLowerCase(), first = c[0].toLowerCase();
      const cand = [...P.keys()].filter(n => { const ns = split(n); return ns.length && ns[ns.length - 1].toLowerCase() === last && n[0].toLowerCase() === first; });
      return cand.length === 1 ? cand[0] : null;
    };

    const classify = names => {
      const ps = names.map(n => P.get(n));
      const qb = ps.find(p => p.pos === 'QB'), dst = ps.find(p => p.pos === 'DST');
      const skill = ps.filter(p => SKILL.includes(p.pos));
      const same = skill.filter(p => p.team === qb.team), catchers = same.filter(p => p.pos === 'WR' || p.pos === 'TE');
      const bb = skill.filter(p => p.team === qb.opp);
      const qbGame = gameKey(qb);
      const other = skill.filter(p => gameKey(p) !== qbGame);
      const teams = counter(ps.map(p => p.team)), games = counter(ps.map(gameKey));
      const pairs = combos2(other);
      const secSame = pairs.filter(([a, b]) => a.team === b.team).length;
      const secOpp = pairs.filter(([a, b]) => a.team === b.opp).length;
      const vsDst = [...skill, qb].filter(p => p.team === dst.opp).length;
      const rbOwnDst = ps.some(p => p.pos === 'RB' && p.team === dst.team);
      const chalkNeg = ps.filter(p => p.own >= H.chalk_own_threshold && p.opt < p.own).length;
      const sub5 = ps.filter(p => p.own < 5).length;
      const cum = ps.reduce((a, p) => a + p.own, 0), sal = ps.reduce((a, p) => a + p.sal, 0);
      const posList = ps.map(p => p.pos), cnt = k => posList.filter(x => x === k).length;
      const flex = cnt('RB') === 3 ? 'RB' : cnt('WR') === 4 ? 'WR' : 'TE';
      const line = lines.get(qb.team) || null;
      const prod = ps.reduce((a, p) => a * (Math.max(p.own, 0.05) / 100), 1);
      return { ps, qb, dst, n_catch: catchers.length, n_same: same.length, bb, sec_same: secSame, sec_opp: secOpp, games: games.size,
        max_team: Math.max(...teams.values()), max_game: Math.max(...games.values()), vs_dst: vsDst, rb_own_dst: rbOwnDst, chalk_neg: chalkNeg,
        sub5, cum, sal, flex, line, prod };
    };

    const hard = X => {
      const v = [];
      if (X.n_catch < H.qb_min_same_team_catchers) v.push('naked QB');
      if (X.sec_same > H.max_secondary_same_team_pairs) v.push(`${X.sec_same} secondary same-team pair(s)`);
      if (X.vs_dst > H.offense_vs_own_dst_max) v.push(`${X.vs_dst} offense vs own DST`);
      if (X.max_team > H.max_players_one_team) v.push(`${X.max_team} from one team`);
      if (X.max_game > H.max_players_one_game) v.push(`${X.max_game} from one game`);
      if (X.chalk_neg > H.max_negative_leverage_chalk_per_lineup) v.push(`${X.chalk_neg} negative-leverage chalk`);
      if (X.sal < H.min_salary_used) v.push(`salary ${pyFixed(X.sal, 0)}`);
      return v;
    };

    // [[label, penalty, key]] — key names the rules.json soft field (additive; the label + penalty are the parity surface).
    const soft = X => {
      const pen = [];
      if (X.n_catch < S.qb_catchers_default) pen.push(['QB+1 only', 0.3, 'qb_catchers_default']);
      if (!X.bb.length) pen.push(['no bring-back', 0.3, 'bring_back']);
      else if (!X.bb.some(p => p.pos === S.bring_back_lean)) pen.push([`bring-back not ${S.bring_back_lean}`, 0.1, 'bring_back_lean']);
      if (S.secondary_opposing_pair_required && X.sec_opp === 0) pen.push(['no secondary opposing pair', 0.4, 'secondary_opposing_pair_required']);
      if (!(S.games_represented[0] <= X.games && X.games <= S.games_represented[1])) pen.push([`${X.games} games`, 0.2, 'games_represented']);
      if (X.flex !== S.flex_default) pen.push([`FLEX ${X.flex}`, 0.1, 'flex_default']);
      if (X.qb.sal > S.qb_salary_max) pen.push([`QB $${pyFixed(X.qb.sal, 0)}`, 0.2, 'qb_salary_max']);
      if (X.qb.own > S.qb_own_max) pen.push([`QB ${pyFixed(X.qb.own, 0)}% own`, 0.3, 'qb_own_max']);
      if (X.line) {
        if (X.line.total < S.qb_game_total_min) pen.push([`QB game total ${pyFloatRepr(X.line.total)}`, 0.4, 'qb_game_total_min']);
        if (X.line.spread > S.qb_team_dog_max) pen.push([`QB team +${pyFloatRepr(X.line.spread)}`, 0.5, 'qb_team_dog_max']);
      }
      if (!(S.sub5_ceiling_plays[0] <= X.sub5 && X.sub5 <= S.sub5_ceiling_plays[1])) pen.push([`${X.sub5} sub-5% plays`, 0.2, 'sub5_ceiling_plays']);
      if (X.dst.sal > S.dst_salary_max) pen.push([`DST $${pyFixed(X.dst.sal, 0)}`, 0.2, 'dst_salary_max']);
      if (X.rb_own_dst) pen.push(['RB + own DST', -0.1, 'rb_own_dst']);
      return pen;
    };

    // classic_engine.py pool reader: slot columns by header (qb/rb/wr/te/flex/dst) or the first 9; roi/dupe/proj metric columns.
    const loadPool = text => {
      const rows = parseCSV(text); if (!rows.length) return [];
      const hdr = rows[0].map(h => h.trim().toLowerCase());
      let slots = hdr.map((h, i) => SLOT_HDR.includes(h) ? i : -1).filter(i => i >= 0);
      if (!slots.length) slots = [...Array(9).keys()];
      const metric = {};
      hdr.forEach((h, i) => { if (slots.includes(i)) return; for (const k of ['roi', 'dupe', 'proj']) if (h.includes(k)) metric[k] = i; });
      const pool = [];
      for (const row of rows.slice(1)) {
        const names = slots.filter(i => i < row.length).map(i => resolve(row[i]));
        if (names.length !== 9 || names.some(n => n == null)) continue;
        const L = { names };
        for (const k of ['roi', 'dupe', 'proj']) if (k in metric) { const v = row[metric[k]]; if (v !== '' && v != null) { const x = pyFloat(String(v).replace(/%/g, '')); if (x == null) throw new Error(`bad ${k} ${JSON.stringify(v)}`); L[k] = x; } }
        pool.push(L);
      }
      return pool;
    };

    const evaluate = (pool, field = 5000) => {
      const rows = pool.map(L => {
        const X = classify(L.names);
        const base = 'roi' in L ? L.roi : 'proj' in L ? L.proj : X.ps.reduce((a, p) => a + p.proj, 0);
        return { L, X, hard: hard(X), pen: soft(X), base, dupes: 'dupe' in L ? L.dupe : field * X.prod * 3 };
      });
      const order = rows.map((_, i) => i).sort((a, b) => rows[b].base - rows[a].base || a - b);
      order.forEach((i, k) => { rows[i].rank = k + 1; rows[i].score = (1 - k / rows.length) * 4 - rows[i].pen.reduce((a, p) => a + p[1], 0); });
      return rows;
    };

    const fmt = r => {
      const X = r.X;
      return `QB ${X.qb.name} ($${pyFixed(X.qb.sal, 0)}, ${pyFixed(X.qb.own, 0)}%) +${X.n_catch}c · BB ${X.bb.map(p => p.pos).join('/') || '—'} · sec-opp ${X.sec_opp} · ${X.games}g · FLEX ${X.flex} · DST ${X.dst.name} · cum ${pyFixed(X.cum, 0)}% · sub5 ${X.sub5} · ≥20% ${X.ps.filter(p => p.own >= 20).length} · $${pyFixed(X.sal, 0)} · dupes~${pyFixed(r.dupes, 1)}`;
    };
    const auditText = (rows, field = 5000) => {
      let s = `# Classic engine — pool ${rows.length}, ${rows.filter(r => r.hard.length).length} fail hard rules; field ${field}\n`;
      s += '| # | rank | lineup | hard | soft |\n|---|---|---|---|---|\n';
      rows.forEach((r, i) => { s += `| ${i + 1} | ${r.rank} | ${fmt(r)} | ${r.hard.join('; ') || '—'} | ${r.pen.map(p => p[0]).join('; ') || '—'} |\n`; });
      return s;
    };

    /* ---------------------------------------------------------------
       3. PAGE CHECKLIST (additive — not part of the parity contract)
       --------------------------------------------------------------- */
    // DK classic roster validity: 1 QB, 2–3 RB, 3–4 WR, 1–2 TE, 1 DST, 9 unique players, ≤ $50,000.
    const roster = names => {
      const issues = [];
      const ps = names.map(n => P.get(n)).filter(Boolean);
      if (new Set(names).size !== names.length) issues.push('the same player twice');
      const c = k => ps.filter(p => p.pos === k).length;
      const need = [['QB', 1, 1], ['RB', 2, 3], ['WR', 3, 4], ['TE', 1, 2], ['DST', 1, 1]];
      for (const [k, lo, hi] of need) { const n = c(k); if (n < lo || n > hi) issues.push(`${n} ${k}${lo === hi ? ` (needs ${lo})` : ` (needs ${lo}–${hi})`}`); }
      if (names.length === 9 && c('RB') + c('WR') + c('TE') !== 7) issues.push('FLEX must be an RB, WR or TE');
      const sal = ps.reduce((a, p) => a + p.sal, 0);
      if (sal > 50000) issues.push(`salary $${Math.round(sal).toLocaleString('en-US')} over the $50,000 cap`);
      if (ps.some(p => !p.opp)) issues.push(`no opponent for ${ps.filter(p => !p.opp).map(p => p.name).join(', ')}`);
      return { ok: names.length === 9 && !issues.length, issues, n: names.length, sal };
    };

    // Rule-by-rule status for the page: pass / fail / unknown (needs ownership or a line) with a short message.
    const check = names => {
      const R = roster(names);
      if (!R.ok) return { roster: R, X: null, hard: [], soft: [] };
      const X = classify(names), fails = hard(X), pens = soft(X);
      const own = !!players.has.own, opt = !!players.has.opt;
      const hardRows = [
        ['qb_min_same_team_catchers', X.n_catch >= H.qb_min_same_team_catchers, `${X.n_catch} same-team catcher${X.n_catch === 1 ? '' : 's'}`],
        ['max_secondary_same_team_pairs', X.sec_same <= H.max_secondary_same_team_pairs, `${X.sec_same} teammate pair${X.sec_same === 1 ? '' : 's'} outside the QB game`],
        ['offense_vs_own_dst_max', X.vs_dst <= H.offense_vs_own_dst_max, `${X.vs_dst} facing your DST`],
        ['max_players_one_team', X.max_team <= H.max_players_one_team, `${X.max_team} max from one team`],
        ['max_players_one_game', X.max_game <= H.max_players_one_game, `${X.max_game} max from one game`],
        ['max_negative_leverage_chalk_per_lineup', own && opt ? X.chalk_neg <= H.max_negative_leverage_chalk_per_lineup : null, own && opt ? `${X.chalk_neg} negative-leverage chalk` : 'needs ownership + Optimal %'],
        ['min_salary_used', X.sal >= H.min_salary_used, `$${Math.round(X.sal).toLocaleString('en-US')} used`]
      ].map(([key, ok, msg]) => ({ key, status: ok == null ? 'unknown' : ok ? 'pass' : 'fail', msg }));
      const penBy = new Map(pens.map(p => [p[2], p]));
      const bbKey = !X.bb.length ? 'bring_back' : 'bring_back_lean';
      const softRows = [
        ['qb_catchers_default', null, `QB + ${X.n_catch}`],
        [bbKey === 'bring_back' ? 'bring_back' : 'bring_back_lean', null, X.bb.length ? `bring-back: ${X.bb.map(p => p.pos).join(' + ')}` : 'no bring-back'],
        ['secondary_opposing_pair_required', null, `${X.sec_opp} secondary opposing pair${X.sec_opp === 1 ? '' : 's'}`],
        ['games_represented', null, `${X.games} games`],
        ['flex_default', null, `FLEX ${X.flex}`],
        ['qb_salary_max', null, `QB $${Math.round(X.qb.sal).toLocaleString('en-US')}`],
        ['qb_own_max', own ? null : 'unknown', own ? `QB ${Math.round(X.qb.own)}% owned` : 'needs ownership'],
        ['qb_game_total_min', X.line ? null : 'unknown', X.line ? `QB game total ${X.line.total}` : `no ${X.qb.team}–${X.qb.opp} line in Step 1`],
        ['qb_team_dog_max', X.line ? null : 'unknown', X.line ? `${X.qb.team} ${X.line.spread < 0 ? '−' + Math.abs(X.line.spread) : X.line.spread > 0 ? '+' + X.line.spread : 'PK'}` : `no ${X.qb.team}–${X.qb.opp} line in Step 1`],
        ['sub5_ceiling_plays', own ? null : 'unknown', own ? `${X.sub5} under 5% owned` : 'needs ownership'],
        ['dst_salary_max', null, `DST $${Math.round(X.dst.sal).toLocaleString('en-US')}`]
      ].map(([key, forced, msg]) => {
        const p = penBy.get(key);
        return { key, status: forced || (p ? 'flag' : 'pass'), msg, pen: p ? p[1] : 0, label: p ? p[0] : '' };
      });
      if (penBy.has('rb_own_dst')) softRows.push({ key: 'rb_own_dst', status: 'bonus', msg: 'RB + own DST', pen: -0.1, label: 'RB + own DST' });
      return { roster: R, X, hard: hardRows, soft: softRows, engineHard: fails, engineSoft: pens };
    };

    return { resolve, classify, hard, soft, loadPool, evaluate, fmt, auditText, roster, check };
  };

  return { readPlayers, readDataHub, readDraftKings, mergePlayers, playersFromList, linesFromCsv, linesFromGames, createEngine };
});
