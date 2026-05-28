/* =========================================================================
   BirdieBuddy Score v2 — scoring engine (Phase 1: pure logic, no rendering)

   Loads in the browser (attaches to window.BBI.score) and in Node
   (module.exports) so the same code that grades a user's lineup also runs
   the back-test validation gate.

   Pillars (calibrated 2026-05-21 against RBC/Truist/Cadillac, n=35):
     simLeverage  sum(top10_prob) - sum(ownership)   [best predictor, rho +0.340]
     ceiling      sum(p75)                            [rho +0.289]
     bbi          sum(bbi_dfs)                        [rho +0.283]
     floor        sum(p25)                            [rho +0.307]
     jointCut     P(>=5 of 6 make cut)                [cash only; negative in GPP]
     capPct       sumSalary / cap                     [field-modulated]
     mean         sum(mean_points)                    [rho +0.220]
     dupRisk      uniqueness = -sum(log ownership)    [higher = more unique]

   Composite = weighted sum of per-pillar z-scores vs a reference distribution
   (the sim grid in production; the scored set in back-test). Z-scoring is what
   lets heterogeneous-scale pillars combine fairly — raw sums would let p75
   (~600) swamp jointCut (~1.0) regardless of weight.
   ========================================================================= */
(function (root) {
  'use strict';

  var PILLARS = ['simLeverage', 'ceiling', 'bbi', 'floor', 'jointCut', 'capPct', 'mean', 'dupRisk'];
  var ROSTER = 6;
  var DEFAULT_CAP = 50000;

  // ---- schema adapter ----
  // Handles three schemas in one place:
  //   archived bbi_v85 (back-test): proj_own, make_cut, proj_total, ceiling/floor
  //                                 (Cadillac's ceiling/floor are 0-1 normalized)
  //   Truist archived:             proj_ownership, p_makecut, proj_points_total, p_top10
  //   live rich (site):            dk_salary, proj_ownership, prob_mc, prob_top10
  //                                + points distribution joined from THEMIS (2nd arg)
  // Pass the player's THEMIS per_player record as `themis` when available; its
  // mean_points / p25 / p75 / points_std / empirical_top10_prob take precedence.
  function normalizePlayer(p, themis) {
    themis = themis || {};

    var mean = num(themis.mean_points) || num(p.proj_total) || num(p.proj_points_total) || num(p.dk_pts) || 0;
    var std = num(themis.points_std) || num(p.std_dev) || num(p.dk_std) || 0;

    var p75 = num(themis.p75), p25 = num(themis.p25);
    var ceil = p75 || num(p.ceiling);
    var flr = p25 || num(p.floor);
    // Archived Cadillac stores ceiling/floor as 0-1 normalized factor scores, not
    // points. When no THEMIS percentile is available and the value looks normalized
    // (<= 1.5 while mean is a real total), reconstruct from Normal(mean, std).
    if (!p75 && ceil > 0 && ceil <= 1.5 && mean > 5) {
      ceil = std > 0 ? mean + 0.6745 * std : mean * 1.3;
      flr = std > 0 ? mean - 0.6745 * std : mean * 0.7;
    }

    var salary = num(p.dk_salary) || num(p.salary) || 0;

    var own = firstNum([p.proj_own, p.proj_ownership, p.hermes_own, p.dk_ownership], 0);
    own = own > 1 ? own / 100 : own;            // -> fraction 0..1

    var cut = firstNum([
      p.make_cut,
      p.prob_mc != null ? p.prob_mc * 100 : null,
      p.p_makecut != null ? p.p_makecut * 100 : null
    ], null);
    if (cut == null) cut = 85;                   // default 85% make-cut when absent
    cut = cut > 1 ? cut / 100 : cut;             // -> fraction 0..1
    cut = clamp(cut, 0, 1);

    var t10 = firstNum([themis.empirical_top10_prob, p.top_10, p.prob_top10, p.p_top10], 0);
    t10 = t10 > 1 ? t10 / 100 : t10;             // -> fraction 0..1

    return {
      dg_id: p.dg_id, name: p.name,
      salary: salary,
      mean: mean, std: std,
      ceiling: ceil, floor: flr,
      bbi: num(p.bbi_dfs) || num(p.composite) || 0,
      ownership: own,
      pCut: cut,
      top10: t10
    };
  }

  // ---- reference distribution: sample N random salary-valid lineups from a pool ----
  // Returns raw-pillar objects for each sampled lineup. Used to build the
  // normalization reference (mean/std per pillar) and the composite percentile
  // ladder, client-side, until the server-baked sim grid lands.
  function sampleRawPillars(pool, opts) {
    opts = opts || {};
    var n = opts.n || 1500, cap = opts.cap || DEFAULT_CAP, roster = opts.roster || ROSTER;
    var rng = mulberry32(opts.seed || 0x9e3779b9);
    var out = [], tries = 0, maxTries = n * 40;
    while (out.length < n && tries < maxTries) {
      tries++;
      var picks = [], used = {}, sal = 0;
      for (var k = 0; k < roster; k++) {
        var idx = Math.floor(rng() * pool.length);
        if (used[idx]) { k--; continue; }
        used[idx] = 1; picks.push(pool[idx]); sal += pool[idx].salary;
      }
      if (sal > cap || sal < cap * 0.80) continue;  // valid salary envelope
      out.push(computeRawPillars(picks, opts));
    }
    return out;
  }

  // percentile (0..1) of value within a numeric array (need not be pre-sorted)
  function percentile(value, arr) {
    if (!arr.length) return 0.5;
    var below = 0;
    for (var i = 0; i < arr.length; i++) if (arr[i] < value) below++;
    return below / arr.length;
  }

  // small deterministic PRNG so reference sampling is stable per load
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- raw pillars for one lineup (array of normalized players) ----
  function computeRawPillars(players, opts) {
    opts = opts || {};
    var cap = opts.cap || DEFAULT_CAP;
    var n = players.length || 1;

    var sumSalary = sum(players, function (p) { return p.salary; });
    var raw = {
      simLeverage: sum(players, function (p) { return p.top10; }) - sum(players, function (p) { return p.ownership; }),
      ceiling: sum(players, function (p) { return p.ceiling; }),
      bbi: sum(players, function (p) { return p.bbi; }),
      floor: sum(players, function (p) { return p.floor; }),
      mean: sum(players, function (p) { return p.mean; }),
      capPct: sumSalary / cap
    };

    // jointCut: P(>=5 of 6 make cut) via Poisson approx on expected misses
    var expMiss = sum(players, function (p) { return 1 - p.pCut; });
    raw.jointCut = Math.exp(-expMiss) * (1 + expMiss);

    // dupRisk -> uniqueness: higher = rarer lineup = better. -sum(log own).
    var uniq = 0;
    for (var i = 0; i < players.length; i++) {
      var o = Math.max(0.005, players[i].ownership);  // floor at 0.5% to bound the log
      uniq += -Math.log(o);
    }
    raw.dupRisk = uniq;

    return raw;
  }

  // ---- reference stats (mean/std per pillar) over a set of raw-pillar objects ----
  function refStats(rawList) {
    var stats = {};
    PILLARS.forEach(function (k) {
      var vals = rawList.map(function (r) { return r[k]; });
      var m = mean(vals);
      var sd = stdev(vals, m);
      stats[k] = { mean: m, std: sd };
    });
    return stats;
  }

  // ---- composite = weighted sum of per-pillar z-scores ----
  function composite(raw, weights, stats) {
    var s = 0;
    PILLARS.forEach(function (k) {
      var w = weights[k] || 0;
      if (!w) return;
      var st = stats[k] || { mean: 0, std: 0 };
      var z = st.std > 1e-9 ? (raw[k] - st.mean) / st.std : 0;
      s += w * z;
    });
    return s;
  }

  function pickWeights(allWeights, mode, bucket, style) {
    var base = (allWeights[mode] && allWeights[mode][bucket]) ? Object.assign({}, allWeights[mode][bucket]) : {};
    if (style && allWeights.styleNudge && allWeights.styleNudge[style]) {
      var nudge = allWeights.styleNudge[style];
      Object.keys(nudge).forEach(function (k) { base[k] = (base[k] || 0) + nudge[k]; });
    }
    return base;
  }

  // ---- Spearman rank correlation ----
  function spearman(a, b) {
    var n = a.length;
    if (n < 2) return 0;
    var ra = ranks(a), rb = ranks(b);
    var m = (n + 1) / 2, numr = 0, da = 0, db = 0;
    for (var i = 0; i < n; i++) {
      numr += (ra[i] - m) * (rb[i] - m);
      da += (ra[i] - m) * (ra[i] - m);
      db += (rb[i] - m) * (rb[i] - m);
    }
    return (da * db) > 0 ? numr / Math.sqrt(da * db) : 0;
  }

  // =====================================================================
  // __backtest — Phase 1 validation gate
  //   events: [{ name, lineups: [{players:[normalized x6], actual}], }]
  //   Per event: derive refStats from that event's lineups, score each,
  //   Spearman(composite, actual). Returns per-event + mean rho.
  // =====================================================================
  function __backtest(events, weights, opts) {
    opts = opts || {};
    var perEvent = [];
    events.forEach(function (ev) {
      var rawList = ev.lineups.map(function (l) { return computeRawPillars(l.players, opts); });
      var stats = refStats(rawList);
      var comps = rawList.map(function (r) { return composite(r, weights, stats); });
      var actuals = ev.lineups.map(function (l) { return l.actual; });
      perEvent.push({ event: ev.name, n: ev.lineups.length, rho: spearman(comps, actuals) });
    });
    var meanRho = mean(perEvent.map(function (e) { return e.rho; }));
    return { perEvent: perEvent, meanRho: meanRho };
  }

  // ---- small numeric helpers ----
  function num(x) { return (typeof x === 'number' && isFinite(x)) ? x : (x == null ? 0 : (isFinite(+x) ? +x : 0)); }
  function firstNum(arr, dflt) { for (var i = 0; i < arr.length; i++) { var v = arr[i]; if (v != null && isFinite(+v)) return +v; } return dflt; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function sum(arr, fn) { var s = 0; for (var i = 0; i < arr.length; i++) s += fn ? fn(arr[i]) : arr[i]; return s; }
  function mean(arr) { return arr.length ? sum(arr) / arr.length : 0; }
  function stdev(arr, m) { if (arr.length < 2) return 0; var v = 0; for (var i = 0; i < arr.length; i++) { var d = arr[i] - m; v += d * d; } return Math.sqrt(v / arr.length); }
  function ranks(xs) {
    var n = xs.length, idx = xs.map(function (_, i) { return i; });
    idx.sort(function (i, j) { return xs[i] - xs[j]; });
    var r = new Array(n);
    for (var k = 0; k < n; k++) r[idx[k]] = k + 1;
    return r;
  }

  // percentile (0..1) -> letter grade, per plan: A top10%, B top25%, C top50%, D top75%
  function gradeFromPercentile(p) {
    if (p >= 0.90) return 'A';
    if (p >= 0.75) return 'B';
    if (p >= 0.50) return 'C';
    if (p >= 0.25) return 'D';
    return 'F';
  }

  var API = {
    VERSION: '2.0.0',
    PILLARS: PILLARS,
    ROSTER: ROSTER,
    normalizePlayer: normalizePlayer,
    computeRawPillars: computeRawPillars,
    refStats: refStats,
    composite: composite,
    pickWeights: pickWeights,
    spearman: spearman,
    sampleRawPillars: sampleRawPillars,
    percentile: percentile,
    gradeFromPercentile: gradeFromPercentile,
    __backtest: __backtest
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;                       // Node
  } else {
    root.BBI = root.BBI || {};
    root.BBI.score = API;                       // browser
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
