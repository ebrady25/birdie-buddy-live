# BirdieBuddy — Pantheon Pro v1

Multi-page static site for the BBI v8.5 prediction engine. Designed to be served from
`ebrady25/birdie-buddy` (private) at `site/` under GitHub Pages.

## Pages

| Page | Path | Purpose |
|---|---|---|
| Overview | `index.html` | Landing — hero, snapshot strip, 15-agent grid, top-of-field reel, live pivots, performance teaser |
| Rankings | `rankings.html` | Full-field sortable rankings, Pool / DFS toggle, 10-factor heat-map cells |
| DFS Lineups | `lineups.html` | 12 lineups with THEMIS percentile distributions, exposure panel, Hermes ownership overlays |
| Performance | `performance.html` | Model report card — Spearman trend SVG, shadow-model grid, calibration grid, PROMETHEUS backtest |

Stubs wired in the nav (coming soon): `simulator.html`, `market.html`, `live.html`, `archive.html`, `methodology.html`.

## Architecture

- **No build step.** Everything is static HTML/CSS/JS that runs from `file://` or any static host.
- **Design system** lives in `assets/css/design-system.css` (tokens) and `assets/css/components.css` (patterns).
  Single source of truth: `--gold-500: #d4a843`, `--ink-0: #0a0a0f`, Inter + JetBrains Mono.
- **Shared runtime** in `assets/js/`:
  - `core.js` — `fmt.*`, `$`, `$$`, debounce, search helpers
  - `data.js` — fetch cache, `BBI.renderHeader()`, `BBI.renderFooter()`
  - `components.js` — tooltip, copy-to-clipboard, sort helpers
  - `animations.js` — `observeAnimations()`, count-up, bar-fill reveal
    (graceful fallback when `IntersectionObserver` is unavailable)
- **Data layer** in `data/` — 14 JSON files produced by the 15-agent pipeline. Each page
  fetches only what it needs via `window.BBI.data.load(path)`.

## Local preview

```bash
cd site && python3 -m http.server 8800
# open http://localhost:8800/
```

Or open `site/index.html` directly in Brave — all fetches use relative paths and work from
`file://` in Chromium-based browsers.

## Push-to-staging workflow

```bash
# From your BBI workspace
rsync -av --delete site/ path/to/birdie-buddy/site/
cd path/to/birdie-buddy
git add site/
git commit -m "deploy: site v1"
git push origin main
```

GitHub Pages is configured on `ebrady25/birdie-buddy` (private) — site will be live at
`https://<user>.github.io/birdie-buddy/site/` after push.

## Data refresh

The site is **data-agnostic**: every page reads from `data/*.json`. Your weekly pipeline
writes into the same filenames — no site-side changes are needed.

Expected filenames (see `assets/js/data.js` → `BBI.data.paths`):
```
current_event.json       bbi_rankings.json        dfs_lineups.json
themis.json              omnia.json               persephone.json
shadow_models.json       spearman_tracker.json    calibration_tracker.json
model_competition.json   prometheus_backtest.json archive_index.json
athena_pool.json         nike_bankroll.json
```

## Verification

A jsdom smoke test covers all 4 pages:
- 0 JS errors per page
- header + footer render
- `observeAnimations` defined
- correct row counts (index:15, rankings:82, lineups:12, performance:4)

Run: `node /tmp/jsdom_test5.mjs` (requires `jsdom` installed globally or via `npm i jsdom` here).

## Next additions (stubbed in nav)

- `simulator.html` — interactive 10k Monte Carlo sandbox on THEMIS per-player distributions
- `market.html` — OMNIA edge board across 15 sportsbooks + Kelly sizing
- `live.html` — PERSEPHONE in-round pivot feed (Thu/Fri/Sat/Sun)
- `archive.html` — historical event browser backed by `archive_index.json`
- `methodology.html` — model documentation, factor definitions, scoring formulas
