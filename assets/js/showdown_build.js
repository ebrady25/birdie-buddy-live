/* =====================================================================
   BIRDIEBUDDY — SHOWDOWN "BUILD IT FOR ME" (Lineup Lab, Step 4)
   The idea of codex/enumerate_pool.py in the browser: every legal
   captain × 5 flex from the pool's top players, pruned early by the
   salary window and the hard rules that can only get worse as players
   are added, then graded by the engine itself (showdown_engine.js:
   classify → hard rules → penalties + story fit → codex score).
   The best lineups per script × captain are kept, so a batch can be
   picked by the engine's own select() with the page's A/B/C/D plan.

   Pure (no DOM). search() is a generator: the page drives it in chunks
   (requestAnimationFrame) and reads progress from each yield (at most
   YIELD_EVERY graded lineups apart); node runs it to the end in tests. Loads as BBI.showdownBuild or via require().
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.BBI = root.BBI || {}; root.BBI.showdownBuild = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TOP = 30;            // players searched (enumerate_pool.py uses --top 24; the browser affords 30)
  const PER_BUCKET = 150;    // lineups kept per script × captain (select() needs the variety: overlap + captain caps)
  const BUDGET = 900000;     // complete lineups graded before the search stops (the cap)
  const YIELD_EVERY = 400;   // graded lineups between yields inside a subtree (≈2–3 ms desktop, ≈10 ms on a slow phone)

  // The Lab's codex score: 50 + 50 × (story fit − penalties), held to 0–100.
  const codexScore = r => Math.max(0, Math.min(100, Math.round(50 + 50 * (r.fit - r.penSum))));
  const ORDER = {
    // ties: the unclamped fit − penalties (many lineups clamp at 100), then projection, then salary used
    codex: (a, b) => b.codex - a.codex || b.raw - a.raw || b.proj - a.proj || b.sal - a.sal || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    proj:  (a, b) => b.proj - a.proj || b.codex - a.codex || b.raw - a.raw || b.sal - a.sal || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  };

  // The players searched: the top `top` by projection (salary when the pool has none),
  // plus each team's best K and DST so the kicker / DST builds stay reachable.
  const candidates = (E, top = TOP) => {
    const all = [...E.P.values()].filter(p => p.sal > 0);
    const key = E.has.proj ? (a, b) => b.proj - a.proj || b.sal - a.sal || (a.name < b.name ? -1 : 1) : (a, b) => b.sal - a.sal || (a.name < b.name ? -1 : 1);
    const pick = all.slice().sort(key).slice(0, top);
    for (const t of E.teams) for (const pos of ['K', 'DST']) {
      const best = all.filter(p => p.team === t && p.pos === pos).sort(key)[0];
      if (best && !pick.includes(best)) pick.push(best);
    }
    return pick;
  };

  // E = createEngine(...) instance, H = data.hard_rules.
  // o: { top, perBucket, budget, score: codexScore-like fn }
  function* search(E, H, o = {}) {
    const cap = H.max_salary ?? 50000, floor = H.min_salary_used ?? 0;
    const K = o.perBucket || PER_BUCKET, budget = o.budget || BUDGET, score = o.score || codexScore;
    const C = candidates(E, o.top || TOP);
    const never = new Set([].concat(H.captain_positions_never || []));
    const caps = C.filter(c => !never.has(c.pos));
    const st = { players: C.length, captains: caps.length, done: 0, frac: 0, nodes: 0, full: 0, legal: 0, capped: false, skippedCaptains: [], buckets: new Map(), has: { ...E.has } };
    const trim = b => {
      const keep = new Set(b.slice().sort(ORDER.codex).slice(0, K));
      if (E.has.proj) b.slice().sort(ORDER.proj).slice(0, K).forEach(r => keep.add(r));
      return b.filter(r => keep.has(r));
    };
    const own3 = !!E.has.own, minOwn = H.min_players_from_captain_team ?? 1;
    for (let ci = 0; ci < caps.length; ci++) {
      const c = caps[ci];
      // Captain-level rules (never-captain, dog pocket QB, CPT-optimal) on a 1-player lineup.
      const r0 = E.scoreOne({ cpt: c.name, flex: [] });
      if (r0.hard.length) { st.skippedCaptains.push([c.name, r0.hard[0]]); st.done = ci + 1; st.frac = st.done / caps.length; yield st; continue; }
      const F = C.filter(p => p !== c).sort((a, b) => b.sal - a.sal || (a.name < b.name ? -1 : 1));
      const n = F.length, sal = F.map(p => p.sal), pre = [0];
      for (let i = 0; i < n; i++) pre.push(pre[i] + sal[i]);
      const maxAdd = (i, k) => i + k <= n ? pre[i + k] - pre[i] : -Infinity;   // the k priciest from i on (sorted high → low)
      const minAdd = k => pre[n] - pre[n - k];                                  // the k cheapest overall
      const csal = c.sal * 1.5, isWR = c.pos === 'WR', isRB = c.pos === 'RB', isTE = c.pos === 'TE';
      const pick = [];
      // Counters for the hard rules a player can only break more of (exactly the engine's rule values).
      const leaf = cur => {
        st.full++;
        const L = { cpt: c.name, flex: pick.map(p => p.name) };
        const X = E.classify(L), hard = E.hardCheck(X);
        if (hard.length) return;
        st.legal++;
        const s = E.softScore(X), penSum = s.pen.reduce((a, p) => a + p[1], 0);
        const row = { key: `${c.name}|${L.flex.slice().sort().join('|')}`, cpt: c.name, flex: L.flex, codex: score({ fit: s.fit, penSum }), raw: Math.round((s.fit - penSum) * 1e4) / 1e4, fit: s.fit, penSum,
          proj: E.has.proj ? Math.round((c.proj * 1.5 + pick.reduce((a, p) => a + p.proj, 0)) * 100) / 100 : 0,
          sal: cur, tag: X.tag, split: X.split, k: X.k_n, dst: X.dst_n, five_one: X.five_one_fav, dupes: E.has.own ? X.est_dupes : null };
        const bk = `${X.tag}|${c.name}`;
        let b = st.buckets.get(bk); if (!b) st.buckets.set(bk, b = []);
        b.push(row); if (b.length > 2 * K) st.buckets.set(bk, trim(b));
      };
      // Add p with k slots still open (k counts p): the new counters, or null if a rule already breaks.
      const add = (cnt, p, k) => {
        const own = p.team === c.team, catcher = own && (p.pos === 'WR' || p.pos === 'TE');
        const nc = { k: cnt.k + (p.pos === 'K'), d: cnt.d + (p.pos === 'DST'), s1: cnt.s1 + (p.sal < 1000), s3: cnt.s3 + (own3 && p.own < 3),
          oc: cnt.oc + catcher, orb: cnt.orb + (own && p.pos === 'RB'), ok: cnt.ok + (own && p.pos === 'K'), ote: cnt.ote + (own && p.pos === 'TE'), no: cnt.no + own };
        if (nc.k > H.max_kickers || nc.d > H.max_dst || nc.k + nc.d > H.max_k_plus_dst || nc.s1 > H.max_sub_1k_players) return null;
        if (own3 && nc.s3 > H.max_sub3pct_owned_players) return null;
        if (isWR && nc.oc > H.wr_cpt_max_other_own_catchers) return null;
        if (isRB && (nc.orb > H.rb_cpt_max_other_own_rb || nc.oc > H.rb_cpt_max_own_skill_wide)) return null;
        if (isTE && (nc.ok > H.te_cpt_max_own_k || nc.ote > H.te_cpt_max_other_own_te)) return null;
        if (1 + nc.no + (k - 1) < minOwn) return null;              // can't reach the captain-team minimum any more
        return nc;
      };
      // The flex slots after the first, depth first on an explicit stack (the order the recursion had), so the
      // search can yield inside one captain × first-flex subtree (up to C(28,4) leaves) instead of only between them.
      // A frame = one open slot: {i: next F index to try, cur: salary so far, cnt: counters}; pick holds the players.
      const walk = function* (start0, cur0, cnt0) {
        const stack = [];
        const open = (start, cur, cnt) => { const k = 5 - pick.length; if (n - start >= k && cur + minAdd(k) <= cap) stack.push({ i: start, cur, cnt }); };
        open(start0, cur0, cnt0);
        let mark = st.full;
        while (stack.length) {
          const fr = stack[stack.length - 1], k = 5 - pick.length;
          let down = false;
          while (fr.i <= n - k) {
            const i = fr.i++;
            st.nodes++;
            if (fr.cur + maxAdd(i, k) < floor) { fr.i = n; break; }        // nothing from here on reaches the floor
            const p = F[i], s2 = fr.cur + p.sal;
            if (s2 + (k > 1 ? minAdd(k - 1) : 0) > cap) continue;          // too pricey with the cheapest fill
            const nc = add(fr.cnt, p, k); if (!nc) continue;
            pick.push(p);
            if (k > 1) { const d = stack.length; open(i + 1, s2, nc); if (stack.length > d) { down = true; break; } pick.pop(); continue; }
            if (s2 >= floor) leaf(s2);
            pick.pop();
            if (st.full >= budget) { pick.length = 1; return; }
            if (st.full - mark >= YIELD_EVERY) { mark = st.full; yield st; }
          }
          if (down) continue;
          stack.pop();
          if (stack.length) pick.pop();                                    // the player the parent frame added
        }
      };
      const zero = { k: 0, d: 0, s1: 0, s3: own3 && c.own < 3 ? 1 : 0, oc: 0, orb: 0, ok: 0, ote: 0, no: 0 };
      // One unit of work = captain × first flex; walk() also yields every YIELD_EVERY graded lineups inside it.
      for (let i = 0; i <= n - 5; i++) {
        if (csal + maxAdd(i, 5) < floor) break;
        const p = F[i], s2 = csal + p.sal, nc = s2 + minAdd(4) <= cap ? add(zero, p, 5) : null;
        if (nc) { st.nodes++; pick.push(p); yield* walk(i + 1, s2, nc); pick.pop(); }
        st.frac = (ci + (i + 1) / (n - 4)) / caps.length;
        if (st.full >= budget) { st.capped = true; break; }
        yield st;
      }
      st.done = ci + 1; st.frac = st.done / caps.length;
      if (st.capped) break;
      yield st;
    }
    for (const [k, b] of st.buckets) st.buckets.set(k, trim(b));
    st.kept = [...st.buckets.values()].reduce((a, b) => a + b.length, 0);
    st.finished = true;
    return st;
  }

  // Everything kept, best first by `mode` ('codex' | 'proj').
  const ranked = (st, mode = 'codex') => [...st.buckets.values()].flat().sort(ORDER[mode] || ORDER.codex);
  // The top cards: best first, at most `perCaptain` per captain so the list isn't one captain's six variants.
  const topCards = (st, mode, n = 12, perCaptain = 3) => {
    const out = [], per = new Map();
    for (const r of ranked(st, mode)) {
      if ((per.get(r.cpt) || 0) >= perCaptain) continue;
      per.set(r.cpt, (per.get(r.cpt) || 0) + 1); out.push(r);
      if (out.length >= n) break;
    }
    return out;
  };

  // Batch of N through the engine's select(): the kept lineups (in `mode` order, so the top half
  // is what select() calls eligible) with the page's script counts as the quotas.
  // counts = largestRemainder(page allocation, N). select() lets a script run to ceil(share × N) + 1;
  // share = (count − 1.5) / N makes that exactly `count` (and 0 when the plan has none).
  // SE = the engine module, opts = the Lab engine's createEngine options.
  const pickBatch = (SE, data, players, opts, st, counts, N, mode = 'codex') => {
    const SB = SE.bucket(+opts.spread);
    const share = {}; for (const k of ['A', 'B', 'C', 'D']) share[k] = (counts[k] || 0) > 0 ? (counts[k] - 1.5) / N : -1;
    const data2 = Object.assign({}, data, { allocation_by_spread: Object.assign({}, data.allocation_by_spread, { [SB]: share }) });
    const E2 = SE.createEngine(data2, players, Object.assign({}, opts, { n: N, keepOrder: true, lean: '' }));
    const rows = ranked(st, mode).filter(r => (counts[r.tag] || 0) > 0);
    const pool = rows.map((r, idx) => ({ bad: false, cpt: r.cpt, flex: r.flex.slice(), idx }));
    const ev = E2.evaluate(pool);
    const S = E2.select(ev);
    const chosen = S.chosen.map(x => rows[x.L.idx]);
    const got = { A: 0, B: 0, C: 0, D: 0 }; chosen.forEach(r => { got[r.tag]++; });
    // Which caps turned lineups away most often (the skip lines of the selection log).
    const why = new Map();
    for (const l of S.log) { const m = /^skip \(sim \d+, (.+?)\): /.exec(l); if (m) { const k = m[1].replace(/^exposure .*/, 'flex exposure').replace(/ \(ceiling\)$/, ''); why.set(k, (why.get(k) || 0) + 1); } }
    // select() lets its top lineups (pctl ≤ sim_override_pctl) run K / DST / both-QB to portfolio.share_ceilings;
    // the portfolio report checks the default band. Name any share that sits between the two.
    const shareOf = fn => S.chosen.filter(x => fn(x.X)).length / Math.max(1, S.chosen.length), set = E2.settings, CE = data.portfolio.share_ceilings || {};
    const ceilings = [['K', shareOf(X => X.k_n > 0), set.K_SHARE[1], CE.k], ['DST', shareOf(X => X.dst_n > 0), set.DST_SHARE[1], CE.dst], ['both-QB', shareOf(X => X.feats.both_qbs), set.BOTHQB_MAX, CE.both_qbs]]
      .filter(([, v, max]) => v > max + 1e-9).map(([label, v, max, ceiling]) => ({ label, share: v, max, ceiling }));
    return { chosen, got, want: { A: counts.A || 0, B: counts.B || 0, C: counts.C || 0, D: counts.D || 0 }, pool: pool.length, elig: S.elig.length, log: S.log, notes: S.notes,
      blockers: [...why].sort((a, b) => b[1] - a[1]).slice(0, 3), ceilings };
  };

  /* =================================================================
     SIM (2026-09-23) — correlated Monte Carlo of the game, for the
     "top-1% chance" of each kept lineup. Needs a projections file
     (Projection, and Std Dev when the file has it).

     1. Marginals: each player's DK points ~ lognormal with mean =
        projection and sd = the file's Std Dev (else the role's
        coefficient of variation, capped at 2, × projection;
        role_correlations.json):
        never below 0, right-skewed like real DK scores.
     2. Dependence: a Gaussian copula on the role correlations computed
        from nflverse box scores 2016–25 (codex/role_correlations.py;
        primetime cohort for primetime slates). Roles = rank by
        projection within team + position (QB1–2, RB1–3, WR1–5, TE1–3,
        K, DST); anyone deeper is drawn independently. The player matrix
        is a principal submatrix of the (PSD) game matrix; if rounding
        ever breaks Cholesky, off-diagonals shrink until it passes.
     3. Cut lines move with the game: in each draw the slate's best
        legal DK lineup (CPT 1.5×, $50k, both teams) is found exactly
        (branch and bound), and the top-1% / min-cash cut = the
        contest_economics.json share of the slate best for the field
        bucket (median over its n contests). A lineup's P(top 1%) is the
        share of draws in which it clears that draw's cut.
     All draws are shared by every lineup (common random numbers), so a
     lineup costs D × 6 additions. Seeded RNG: the same file gives the
     same numbers. Generators, like search(): the page drives them in
     chunks; node runs them to the end in tests.
     ================================================================= */
  const SIM_DRAWS = 2000;
  const SIM_DEPTH = { QB: 2, RB: 3, WR: 5, TE: 3 };
  const mulberry32 = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const gaussian = rand => { let spare = null; return () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0; while (u === 0) u = rand();
    const v = rand(), r = Math.sqrt(-2 * Math.log(u)); spare = r * Math.sin(2 * Math.PI * v); return r * Math.cos(2 * Math.PI * v); }; };
  const fnv = str => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };

  // The Std Dev column of a Stokastic Data Hub export (the engine reads the rest): Map name → sd. rows = parseCSV output.
  // In memory only, like every number from the reader's file.
  const readStd = rows => {
    const out = new Map(); if (!rows || !rows.length) return out;
    const H = rows[0].map(h => String(h).trim().toLowerCase()), iN = H.indexOf('player'), iS = H.findIndex(h => h === 'std dev' || h === 'stddev' || h === 'std');
    if (iN < 0 || iS < 0) return out;
    for (const r of rows.slice(1)) { const nm = String(r[iN] ?? '').trim(), v = parseFloat(r[iS]); if (nm && isFinite(v) && v >= 0) out.set(nm, v); }
    return out;
  };
  // Showdown role of each player: rank by projection (then salary) within team + position. null = deeper than the table.
  const simRoles = players => {
    const role = new Map();
    for (const t of new Set(players.map(p => p.team))) for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DST']) {
      players.filter(p => p.team === t && p.pos === pos).sort((a, b) => b.proj - a.proj || b.sal - a.sal || (a.name < b.name ? -1 : 1))
        .forEach((p, i) => role.set(p.name, SIM_DEPTH[pos] ? (i < SIM_DEPTH[pos] ? `${pos}${i + 1}` : null) : (i === 0 ? pos : null)));
    }
    return role;
  };
  const cholesky = (A, n) => {
    const L = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
      let s = A[i * n + j]; for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      if (i === j) { if (!(s > 1e-10)) return null; L[i * n + i] = Math.sqrt(s); } else L[i * n + j] = s / L[j * n + j];
    }
    return L;
  };
  // The cohort a slate uses: primetime for primetime slates (the page's core), all games otherwise.
  const simCohort = (rc, tier) => { const C = rc && rc.cohorts; if (!C) return null; const k = tier === 'sunday' || !C.primetime ? 'all' : 'primetime'; return C[k] ? { key: k, ...C[k] } : null; };
  // players: [{name, team, pos, sal, proj}] (the engine's P values); sd: Map name → Std Dev (may be empty); rc: role_correlations.json.
  const simPrepare = (players, sd, rc, tier) => {
    const C = simCohort(rc, tier); if (!C) throw new Error('role correlations missing');
    const R = rc.roles, ri = new Map(R.map((r, i) => [r, i])), ps = players.filter(p => p.proj > 0 && p.sal > 0).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const n = ps.length, role = simRoles(ps), teams = [...new Set(ps.map(p => p.team))].sort();
    const deepest = { QB: 'QB2', RB: 'RB3', WR: 'WR5', TE: 'TE3', K: 'K', DST: 'DST' };
    const mu = new Float64Array(n), sig = new Float64Array(n), sal = new Float64Array(n), team = new Int8Array(n);
    let fromFile = 0, fromCv = 0;
    ps.forEach((p, i) => {
      const r = role.get(p.name), st = C.roles[r || deepest[p.pos]] || {};
      let s = sd && sd.has(p.name) ? sd.get(p.name) : null;
      // role CV fallback capped at 2: the deep roles' CVs (up to ~5) come from zero-inflated tiny means, and past 2 a lognormal is all tail
      if (s != null && s > 0) fromFile++; else { s = Math.min(2, st.cv || 1) * p.proj; fromCv++; }
      const v = Math.log(1 + (s * s) / (p.proj * p.proj));
      sig[i] = Math.sqrt(v); mu[i] = Math.log(p.proj) - v / 2; sal[i] = p.sal; team[i] = teams.indexOf(p.team);
    });
    const A = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j) { A[i * n + j] = 1; continue; }
      const a = ri.get(role.get(ps[i].name)), b = ri.get(role.get(ps[j].name));
      A[i * n + j] = a == null || b == null ? 0 : ps[i].team === ps[j].team ? C.copula.own[a][b] : C.copula.opp[a][b];
    }
    let L = cholesky(A, n), shrink = 1;
    while (!L && shrink > 0.05) { shrink *= 0.9; const B = A.map((v, k) => (k % (n + 1) === 0 ? 1 : v * shrink)); L = cholesky(B, n); }
    if (!L) { L = new Float64Array(n * n); for (let i = 0; i < n; i++) L[i * n + i] = 1; shrink = 0; }
    const sig8 = ps.map(p => `${p.name}:${p.team}:${p.pos}:${p.sal}:${p.proj}:${sd && sd.has(p.name) ? sd.get(p.name) : ''}`).join('|');
    return { n, names: ps.map(p => p.name), idx: new Map(ps.map((p, i) => [p.name, i])), role, mu, sig, sal, team, A, L, shrink,
      cohort: C.key, cohortN: C.n_games, fromFile, fromCv, teams, key: `${C.key}|${rc.generated}|${fnv(sig8)}` };
  };
  // Best DK showdown lineup for one draw's scores x (exact: branch and bound over players sorted by score).
  const makeBest = (spec, cap = 50000) => {
    const n = spec.n, sal = spec.sal, team = spec.team, ord = new Int32Array(n), S = new Float64Array(n), pre = new Float64Array(n + 1);
    const cheap = Array.from(sal).sort((a, b) => a - b), minSal = [0]; for (let k = 1; k <= 5; k++) minSal.push(minSal[k - 1] + (cheap[k - 1] || 0));
    const idx = Array.from({ length: n }, (_, i) => i);
    let best = 0, a = 0, cTeam = 0;
    const dfs = (j, k, cur, s, mixed) => {
      for (let b = j; b < n; b++) {
        if (cur + pre[Math.min(n, b + k)] - pre[b] <= best) return;       // even the next k best can't beat it
        if (b === a) continue;
        const p = ord[b], s2 = s + sal[p]; if (s2 + minSal[k - 1] > cap) continue;
        const cur2 = cur + S[b], mix2 = mixed || team[p] !== cTeam;
        if (k === 1) { if (mix2 && cur2 > best) best = cur2; } else dfs(b + 1, k - 1, cur2, s2, mix2);
      }
    };
    return x => {
      idx.sort((i, j) => x[j] - x[i]);
      for (let i = 0; i < n; i++) { ord[i] = idx[i]; S[i] = x[idx[i]]; pre[i + 1] = pre[i] + S[i]; }
      best = 0; const top5 = pre[Math.min(5, n)];
      for (a = 0; a < n; a++) {
        const c = ord[a]; if (1.5 * S[a] + top5 <= best) break;
        const cs = 1.5 * sal[c]; if (cs + minSal[5] > cap) continue;
        cTeam = team[c]; dfs(0, 5, 1.5 * S[a], cs, false);
      }
      return best;
    };
  };
  // The draws: X[i * D + d] = player i's DK points in draw d; best[d] = that draw's best lineup. Yields {phase, frac}.
  function* simWorld(spec, o = {}) {
    const D = o.draws || SIM_DRAWS, n = spec.n, L = spec.L, X = new Float64Array(n * D), best = new Float64Array(D);
    const g = gaussian(mulberry32(o.seed != null ? o.seed : fnv(spec.key))), e = new Float64Array(n), x = new Float64Array(n), bestOf = makeBest(spec, o.cap || 50000);
    const every = o.chunk || 100, prog = { phase: 'draws', frac: 0, done: 0 };
    for (let d = 0; d < D; d++) {
      for (let i = 0; i < n; i++) e[i] = g();
      for (let i = 0; i < n; i++) { let z = 0; const r = i * n; for (let k = 0; k <= i; k++) z += L[r + k] * e[k]; x[i] = Math.exp(spec.mu[i] + spec.sig[i] * z); X[i * D + d] = x[i]; }
      best[d] = bestOf(x);
      if ((d + 1) % every === 0 && d + 1 < D) { prog.done = d + 1; prog.frac = (d + 1) / D; yield prog; }
    }
    const sb = Array.from(best).sort((a, b) => a - b);
    return { spec, D, X, best, bestMed: sb[D >> 1], cache: new Map() };
  }
  const q = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1) + 0.5)))];
  // One lineup's score in every draw (players outside the sim — no projection — score 0).
  const simScores = (W, cpt, flex) => {
    const D = W.D, out = new Float64Array(D), X = W.X, c = W.spec.idx.get(cpt);
    if (c != null) for (let d = 0, o = c * D; d < D; d++) out[d] = 1.5 * X[o + d];
    for (const f of flex) { const i = W.spec.idx.get(f); if (i == null) continue; for (let d = 0, o = i * D; d < D; d++) out[d] += X[o + d]; }
    return out;
  };
  // Cut lines as a share of the slate's best score, for the field size: contest_economics.json (by field bucket, tier),
  // else the playbook's cut_lines (contest cut / contest winner, same field bucket). Each carries its n.
  const ECON_BUCKETS = [[5000, 'lt5k'], [25000, '5k_25k'], [100000, '25k_100k'], [Infinity, '100k_plus']];
  const simCuts = (econ, cutLines, tier, field) => {
    const t = tier === 'sunday' ? 'sunday' : 'primetime', key = ECON_BUCKETS.find(([hi]) => +field < hi)[1];
    const T = econ && econ[t];
    if (T && T.by_field) {
      const row = T.by_field.find(r => r.field === key), use = row && row.cut_top1_pct_best != null ? row : T.overall;
      if (use && use.cut_top1_pct_best != null) {
        const lbl = row && use === row ? `${row.field_label} ${t}` : `all ${t} fields (no ${key} cell)`;
        return { src: 'econ', key: `econ|${t}|${use.field || 'all'}`, label: lbl, tier: t,
          top1: { pct: use.cut_top1_pct_best, n: use.n_contests, slates: use.n_slates, small: !!use.small },
          cash: use.min_cash_pct_best != null ? { pct: use.min_cash_pct_best, n: use.n_min_cash, slates: use.n_slates, small: !!use.small || use.n_min_cash < 3 } : null };
      }
    }
    const fb = +field < 5000 ? 'se_small' : +field < 25000 ? 'mid' : 'large', lab = { se_small: '<5k', mid: '5k–25k', large: '25k+' }[fb];
    const rows = (cutLines || []).filter(c => (c.tier || 'primetime') === t && c.winner_score > 0 && (+c.field_size < 5000 ? 'se_small' : +c.field_size < 25000 ? 'mid' : 'large') === fb);
    const med = a => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return !s.length ? null : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    const t1 = rows.filter(c => c.cut_top1 != null), mc = rows.filter(c => c.min_cash_score != null);
    if (!t1.length) return null;
    const sl = r => new Set(r.map(c => c.slate)).size;
    return { src: 'playbook', key: `pb|${t}|${fb}`, label: `${lab} ${t} (playbook cut lines, % of the contest winner)`, tier: t,
      top1: { pct: Math.round(med(t1.map(c => c.cut_top1 / c.winner_score * 100)) * 100) / 100, n: t1.length, slates: sl(t1), small: sl(t1) < 3 },
      cash: mc.length ? { pct: Math.round(med(mc.map(c => c.min_cash_score / c.winner_score * 100)) * 100) / 100, n: mc.length, slates: sl(mc), small: mc.length < 3 } : null };
  };
  // What the cut lines come to in this sim (points): median and 10th–90th percentile over the draws.
  const cutPoints = (W, pct) => { const s = Array.from(W.best, b => b * pct / 100).sort((a, b) => a - b); return { med: q(s, 0.5), lo: q(s, 0.1), hi: q(s, 0.9) }; };
  // P(score ≥ cut) for a fixed cut in points or a per-draw share of the slate best (pct).
  const pAtLeast = (scores, W, pct, fixed) => { let k = 0; const D = scores.length; for (let d = 0; d < D; d++) if (scores[d] >= (fixed != null ? fixed : W.best[d] * pct / 100)) k++; return k / D; };
  // Full stats for one lineup (cards, the Lab's own lineup): P(top 1%), P(min cash), median, 90th percentile.
  const simStats = (W, cpt, flex, cuts) => {
    const s = simScores(W, cpt, flex), top1 = cuts ? pAtLeast(s, W, cuts.top1.pct) : null, cash = cuts && cuts.cash ? pAtLeast(s, W, cuts.cash.pct) : null;
    const sorted = Array.from(s).sort((a, b) => a - b);
    return { top1, cash, med: q(sorted, 0.5), p90: q(sorted, 0.9), mean: sorted.reduce((a, v) => a + v, 0) / sorted.length, D: W.D,
      se: top1 != null ? Math.sqrt(Math.max(top1 * (1 - top1), 1 / W.D) / W.D) : null };
  };
  // P(top 1%) and P(min cash) for every kept lineup (rows from ranked()); results cached per lineup × cut in the world.
  // Sets r.top1 / r.cash (0–1). Yields {phase: 'lineups', frac}.
  function* simLineups(W, rows, cuts, o = {}) {
    const D = W.D, X = W.X, best = W.best, idx = W.spec.idx, t1 = new Float64Array(D), mc = new Float64Array(D);
    for (let d = 0; d < D; d++) { t1[d] = best[d] * cuts.top1.pct / 100; mc[d] = cuts.cash ? best[d] * cuts.cash.pct / 100 : Infinity; }
    const every = o.chunk || 250, prog = { phase: 'lineups', frac: 0, done: 0, total: rows.length }, off = new Int32Array(6);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r], ck = `${row.key}|${cuts.key}`, hit = W.cache.get(ck);
      if (hit) { row.top1 = hit[0]; row.cash = hit[1]; }
      else {
        const c = idx.get(row.cpt); off[0] = c == null ? -1 : c * D;
        for (let f = 0; f < 5; f++) { const i = idx.get(row.flex[f]); off[f + 1] = i == null ? -1 : i * D; }
        let k1 = 0, kc = 0;
        for (let d = 0; d < D; d++) {
          let s = off[0] < 0 ? 0 : 1.5 * X[off[0] + d];
          for (let f = 1; f < 6; f++) if (off[f] >= 0) s += X[off[f] + d];
          if (s >= t1[d]) k1++; if (s >= mc[d]) kc++;
        }
        row.top1 = k1 / D; row.cash = cuts.cash ? kc / D : null; W.cache.set(ck, [row.top1, row.cash]);
      }
      if ((r + 1) % every === 0) { prog.done = r + 1; prog.frac = (r + 1) / rows.length; yield prog; }
    }
    return rows;
  }
  // Blend = the mean of a lineup's percentile rank on codex fit (unclamped fit − penalties) and on P(top 1%),
  // both among the rows given (the kept lineups), 0–100. Ties share the average rank.
  const pctRanks = (rows, val) => {
    const n = rows.length, ord = rows.map((r, i) => i).sort((i, j) => val(rows[i]) - val(rows[j])), out = new Float64Array(n);
    for (let i = 0; i < n;) { let j = i; while (j + 1 < n && val(rows[ord[j + 1]]) === val(rows[ord[i]])) j++; const pr = n > 1 ? ((i + j) / 2) / (n - 1) * 100 : 100; for (let k = i; k <= j; k++) out[ord[k]] = pr; i = j + 1; }
    return out;
  };
  const applyBlend = rows => {
    const a = pctRanks(rows, r => r.raw), b = pctRanks(rows, r => (r.top1 == null ? -1 : r.top1));
    rows.forEach((r, i) => { r.blend = Math.round((a[i] + b[i]) / 2 * 10) / 10; });
    return rows;
  };
  const tieBreak = (a, b) => b.codex - a.codex || b.raw - a.raw || b.proj - a.proj || b.sal - a.sal || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  ORDER.top1 = (a, b) => (b.top1 ?? -1) - (a.top1 ?? -1) || tieBreak(a, b);
  ORDER.blend = (a, b) => (b.blend ?? -1) - (a.blend ?? -1) || (b.top1 ?? -1) - (a.top1 ?? -1) || tieBreak(a, b);

  return { TOP, PER_BUCKET, BUDGET, YIELD_EVERY, codexScore, candidates, search, ranked, topCards, pickBatch, ORDER,
    SIM_DRAWS, mulberry32, gaussian, readStd, simRoles, cholesky, simCohort, simPrepare, makeBest, simWorld, simScores, simCuts, cutPoints, pAtLeast, simStats, simLineups, pctRanks, applyBlend };
});
