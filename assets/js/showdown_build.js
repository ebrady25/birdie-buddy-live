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

  return { TOP, PER_BUCKET, BUDGET, YIELD_EVERY, codexScore, candidates, search, ranked, topCards, pickBatch, ORDER };
});
