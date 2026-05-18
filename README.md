# BirdieBuddy

A PGA Tour prediction model and analytics platform. Each week BBI ranks the field
across 10 weighted factors, projects DraftKings DFS lineups under salary and
exposure constraints, computes sportsbook edges across 15 books, and publishes
the math that produced each call so you can decide whether to trust it.

**Live site:** [https://ebrady25.github.io/birdie-buddy-live/](https://ebrady25.github.io/birdie-buddy-live/)

---

## Performance — 2026 season to date

Six scored events through Cadillac Championship (Week 13). All numbers computed
under the same canonical methodology — `scipy.stats.spearmanr` with proper
tie-handling, paired against final finishes via DataGolf's historical rounds API.

| Metric | Value | Context |
|---|---|---|
| Season avg rank correlation (ρ) | **0.409** | Above 0.40 target tier |
| Best week | **0.574** (Valero Texas Open, W9) | Aspirational tier (≥0.50) |
| Hardest week | 0.315 (Cadillac, W13) | Still positive + statistically significant |
| Head-to-head record vs industry baseline | **4–2** | Mean lead of +0.066 ρ across head-to-head events |
| Winners ranked in BBI top-10 | **5 / 6** | Includes Cameron Young #2 at Cadillac, Matt Fitzpatrick #3 at RBC, Rory McIlroy #9 at Augusta |
| Statistical significance | All 6 events at p ≤ 0.011 | Small fields compress ρ; we still cleared 95% confidence on every scored event |

The model is calibrated for individual stroke-play. Team events (Zurich Classic,
Ryder Cup weeks) are deferred by design rather than guessed at.

---

## What lives on the site

| Page | What it shows |
|---|---|
| **[Overview](./index.html)** | This week's headline picks, snapshot strip, agent activity grid, live pivots, performance teaser |
| **[Rankings](./rankings.html)** | Sortable full-field table with all 10 BBI factors heat-mapped per player. Pool / DFS toggle |
| **[DFS Lineups](./lineups.html)** | 11 lineups across CASH / CORE / LEVERAGE / MOONSHOT archetypes, each with ownership overlays and salary-floor enforcement |
| **[Performance](./performance.html)** | Weekly ρ chart + table, 5 shadow-variant scoreboards, calibration grid (Brier per market), 47-event historical baseline |
| **[Simulator](./simulator.html)** | Interactive 10k Monte Carlo sandbox over per-player distributions |
| **[Market](./market.html)** | Sportsbook edge board — model probability vs market consensus across 15 books, with parlay builder and best-book identification |
| **[Live](./live.html)** | In-round leaderboard pivot feed (active Thursday–Sunday during play) |
| **[Archive](./archive.html)** | Drill-into 47-event historical reference set powering the performance baseline |
| **[Methodology](./methodology.html)** | Trust page — full factor definitions, weights, scoring formulas, calibration math |
| **[Player profiles](./player.html)** | Per-player view: SG fingerprint, factor decomposition, course history, recent form trajectory |
| **[Course profiles](./course.html)** | 48-venue Course DNA browser — what skills this course rewards, who has performed here historically, similar-DNA peer venues |
| **[Compare](./compare.html)** | Up to 3 players overlaid on SG, factor decomposition, recent form, and course history |
| **[Recap](./recap.html)** | Weekly report card — what worked, what missed, factor attribution for top-10 finishers |

---

## What makes BBI different

**A 10-factor composite, not a single signal.** Talent (22%), course fit (22%), recent
form (13%), made-cut safety (12%), and six smaller layers. Each factor weight is
explicit, published on the [methodology page](./methodology.html), and audited weekly
against actual finishes. The composite uses different weight profiles for pool play
vs. DFS — the constraints differ, the math should too.

**Course-aware weighting, not generic ranking.** Every course has a DNA profile
documenting which strokes-gained categories matter most there (off-the-tee at
Quail Hollow, approach at Augusta, putting at Pebble). Factor weights flex per
course. When a venue undergoes a significant redesign (Doral 2014 Hanse, Quail
Hollow 2024), historical data outside the current era is excluded explicitly,
not blindly averaged.

**Cross-event historical pulls.** When the same physical course hosts multiple
tournaments under different IDs (Quail Hollow's Truist Championship + 2017 + 2025
PGA Championship; Bethpage Black + multiple events), BBI pulls historical rounds
across all relevant event IDs and merges them. Most prediction models look at
the current event's history alone.

**Five shadow variants tested every week.** Alongside the published rankings, BBI
runs five alternative weight configurations and scores each variant's calls
against actual finishes. Promotion requires ≥0.03 ρ advantage AND ≥5% Brier
advantage over ≥8 events for ≥3 consecutive weeks — and human approval. Variants
that don't clear the bar stay in shadow indefinitely. No undocumented model drift.

**A pre-publication critic.** Before any week's rankings ship, an independent
review layer scans for five categories of model artifact — single-factor reliance,
small-sample fades, stale-history boosts, cross-variant instability, baseline
divergences — and flags players whose ranking depends on shaky inputs. Those flags
trigger explicit human-review override decisions, logged transparently in each
player's record.

**Methodology consistency, audited.** Every Spearman number on the site uses the
same scoring method, against the same actual-finish source, with the same tie
handling. When earlier methodology drift was discovered (a Masters score computed
against post-event rankings instead of pre-tournament predictions inflated the
result by 0.25), the entire season was recomputed under the canonical method and
republished. Performance numbers are honest, not cherry-picked.

**Deferral as a feature.** When the calendar produces a team event (Zurich
Classic, Presidents Cup), the pipeline marks the week deferred and publishes
nothing rather than guessing with an individual stroke-play model. Same for any
week where data quality preconditions aren't met — explicit refusal beats
pretending.

---

## How a week unfolds

Monday morning the pipeline produces the week's BBI rankings, runs five shadow
variants, generates an independent critic pass, applies any human overrides,
and deploys the updated rankings page.

Tuesday morning adds the weather composite for the upcoming venue, the sportsbook
edge analysis as books finalize prices, and the DFS lineup portfolio with
ownership-aware leverage decisions. Wednesday morning runs a final lock pass.

Thursday through Sunday during play, a live in-round agent updates the leaderboard
pivot view twice daily, surfacing real-time momentum changes for any active bets
or DFS lineups still in play.

Monday after the tournament closes, a postmortem agent computes the BBI ranking's
correlation with actual finishes, scores all five shadow variants against the
same outcomes, and publishes the weekly recap with full factor attribution for
the top-10 finishers.

---

## Technical architecture

The site is a multi-page static HTML/CSS/JS application — no build step, no
framework dependencies, runs from any static host or `file://`. Every page
fetches data from `data/*.json` files via a thin shared runtime.

**Design system** in `assets/css/design-system.css` (tokens) and `components.css`
(patterns). Single source of truth for color, type, spacing, and elevation.

**Shared runtime** in `assets/js/`:
- `core.js` — formatters, DOM helpers, search utilities
- `data.js` — fetch cache, header/footer rendering, canonical paths
- `components.js` — tooltips, copy-to-clipboard, sortable table helpers
- `animations.js` — IntersectionObserver-based reveal patterns with graceful fallback

**Data layer** in `data/` — 30+ JSON files written by the upstream pipeline. The
site is data-agnostic; pipeline writes the same filenames each week.

```
data/
├── current_event.json          ← which event this week
├── bbi_rankings.json           ← the headline ranking output
├── dfs_lineups.json            ← 11 DFS lineups under $50K cap
├── athena_pool.json            ← 100-person pool picks
├── nike_bankroll.json          ← Kelly-sized bet recommendations
├── shadow_models.json          ← 5 weight-variant rankings
├── themis.json                 ← 10k Monte Carlo simulations per player
├── omnia.json                  ← 15-book sportsbook edges + Kelly stakes
├── persephone.json             ← live in-round leaderboard pivots
├── spearman_tracker.json       ← weekly ρ history + rolling metrics
├── calibration_tracker.json    ← Brier scores per market
├── model_competition.json      ← shadow variant scoreboards
├── prometheus_backtest.json    ← 47-event historical reference set
├── performance_attribution.json ← per-factor contribution to top-10 finishers
├── performance_weekly_recaps.json ← templated recap content
└── world_ranking.json          ← global percentile tier scale
```

**Public-IP scrubber.** Recipe-disclosing fields (factor weights, normalized
factor scores, raw model coefficients) are stripped from the public data layer
before publish. The site shows what predictions the model produced and how well
they performed, not the exact weights that produced them.

---

## Local preview

```bash
cd site && python3 -m http.server 8800
# open http://localhost:8800/
```

Or open `index.html` directly in a Chromium browser — relative paths work from `file://`.

---

## Verification

Pre-deploy verification runs `tools/jsdom_verify.mjs` across all pages:
- 0 JavaScript errors per page
- Header + footer render cleanly
- Animation observer initializes correctly
- Expected row counts match (rankings: 72, lineups: 11, etc.)

Pages that fail verification do not deploy.

---

## Roadmap

Active development focuses on three streams:

1. **Course-history enrichment.** Expanding course similarity matrices so a
   player's performance at correlating venues contributes a small weight when
   direct course history is thin.

2. **Self-improving model loop.** Building infrastructure for the 5 shadow
   variants to evolve their weight configurations based on accumulated weekly
   evidence, with strict promotion criteria and human approval gates preserved.

3. **Subscriber surfaces.** The site today serves a single user. The
   architecture is designed extensible enough to support per-user analysis
   (custom watchlists, personalized lineups, alert preferences) once the
   prediction model is mature enough to deserve a paying audience.

---

## License

Private project. Public-facing data on this site is provided as-is for
informational purposes only. Not financial or wagering advice.
