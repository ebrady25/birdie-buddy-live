# BirdieBuddy — Pantheon Pro v1

Multi-page static site for the BBI v8.5 prediction engine. Served from `ebrady25/birdie-buddy-live` (public) via GitHub Pages.

## Pages

| Page | Path | Tier | Purpose |
|---|---|---|---|
| Overview | `index.html` | Free | Landing — hero, snapshot strip, 15-agent grid, top-of-field reel, live pivots, performance teaser |
| Rankings (Teaser) | `full_rankings.html` | Free | Top 5 by BBI, bottom 2 blurred, unlock CTA, animated 10-factor equalizer |
| Rankings (Full) | `rankings.html` | Pro | Full-field sortable rankings, Pool / DFS toggle, 10-factor heat-map cells |
| DFS Lineups | `lineups.html` | Pro | 12 lineups with THEMIS percentile distributions, exposure panel, Hermes ownership overlays |
| Performance | `performance.html` | Free | Model report card — Spearman trend SVG, shadow-model grid, calibration grid, PROMETHEUS backtest |
| Market | `market.html` | All-Access | OMNIA edge board across 15 sportsbooks + Kelly sizing |
| Live | `live.html` | Pro | PERSEPHONE in-round pivot feed (Thu/Fri/Sat/Sun) |
| Simulator | `simulator.html` | Free* | Interactive 10k Monte Carlo sandbox (*contest buckets gated: Mid=Pro, Large/Mass=All-Access) |
| Compare | `compare.html` | Pro | Head-to-head player comparison |
| Account | `account.html` | Free | User account management, billing portal link |
| Pricing | `pricing.html` | Free | Tier comparison and checkout CTA |

Stubs wired in the nav: `archive.html`, `course.html`, `courses.html`, `watchlist.html`, `recap.html`.

## Architecture

- **No build step.** Everything is static HTML/CSS/JS that runs from `file://` or any static host.
- **Auth system** in `assets/js/auth.js` — client-side tier gating with demo backend. Production backend (Supabase + Stripe) in development at `../vercel-app/`.
- **Design system** lives in `assets/css/design-system.css` (tokens) and `assets/css/components.css` (patterns).
  Single source of truth: `--gold-500: #d4a843`, `--ink-0: #0a0a0f`, Inter + JetBrains Mono.
- **Shared runtime** in `assets/js/`:
  - `core.js` — `fmt.*`, `$`, `$$`, debounce, search helpers
  - `data.js` — fetch cache, `BBI.renderHeader()`, `BBI.renderFooter()`
  - `components.js` — tooltip, copy-to-clipboard, sort helpers
  - `animations.js` — `observeAnimations()`, count-up, bar-fill reveal
    (graceful fallback when `IntersectionObserver` is unavailable)
  - `auth.js` — tiered entitlements, login/signup modal, page gating, header auth control
- **Data layer** in `data/` — 14 JSON files produced by the 15-agent pipeline. Each page
  fetches only what it needs via `window.BBI.data.load(path)`.

## Auth & Gating

The auth system is a client-side entitlement layer with a clean backend seam. See `assets/js/auth.js` for full documentation.

**Tiers:** Free → Pro → All-Access → Sharp

**Page gating** is centralized via `PAGE_TIERS` map in auth.js. Pages not listed are free. The `applyPageGate()` function stamps `data-gate` on the page's gated region automatically — no per-page edits needed.

**Security note:** localStorage tier flags are presentational only. Real enforcement will come from the backend API once Vercel/Supabase is connected.

## Local preview

```bash
cd site && python3 -m http.server 8800
# open http://localhost:8800/
```

Or open `site/index.html` directly in Brave — all fetches use relative paths and work from `file://` in Chromium-based browsers.

## Deployment

**Do not push directly to birdie-buddy-live.** Use the deploy script:

```bash
# From tars-orchestration repo root
python3 Code/site_deploy.py [phase]
```

This script:
1. Stashes local changes
2. Pulls latest origin/main
3. Scrubs model weights and normalized factor scores
4. Rsyncs `site/` to the birdie-buddy-live repo
5. Commits and pushes to GitHub Pages
6. Restores stashed changes

## Data refresh

The site is **data-agnostic**: every page reads from `data/*.json`. Your weekly pipeline writes into the same filenames — no site-side changes are needed.

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

## Backend Integration (In Progress)

The Vercel + Supabase backend lives in `../vercel-app/`. Once connected:
- `/api/rankings?event=SLUG` will return teaser JSON (free) or full JSON (Pro+)
- `/api/stripe-webhook` will handle subscription tier updates
- Frontend will switch from static JSON to API calls with Bearer tokens
- Auth.js backend seam will be replaced with real API calls
