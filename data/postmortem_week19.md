# BBI Postmortem — RBC Canadian Open 2026 (Week 19)
**Event:** RBC Canadian Open | **Course:** TPC Toronto at Osprey Valley (North Course) | **Date:** 2026-06-14

## Result Summary
- **Winner:** Bud Cauley | Score: -27 (263) | BBI Pool Rank: #21 | DG Rank: #11
- **Runner-up:** Matt Fitzpatrick (-25) — BBI #3 ✓
- **Third:** Viktor Hovland (-24) — BBI #9 ✓

## Model Performance
| Metric | Value | vs Target |
|--------|-------|-----------|
| Spearman BBI | 0.1990 | ❌ Below 0.40 target |
| Spearman DG | 0.2453 | — |
| Beat DG | ❌ NO | — |
| Z-normalized | 1.675 | — |
| Top-5 hits | 1/5 | — |
| Top-10 hits | 2/10 | — |
| Top-20 hits | 9/20 | — |

**Assessment:** Second-lowest Spearman of season (0.199). BBI LOST to DG this week (DG=0.245 vs BBI=0.199). Cauley win from BBI #21 was a surprise but not extreme. DG also ranked him mid-field (#11 among made-cut). The real miss was the top of the BBI board: Burns (#1 BBI) finished T21, Fleetwood (#2 BBI) T13. Fitzpatrick (#3 BBI) T2 was a strong partial hit.

## Calibration
| Market | Brier | Skill % |
|--------|-------|---------|
| Win | 0.0070 | +0.6% |
| Top 5 | 0.0321 | +5.5% |
| Top 10 | 0.0646 | +1.3% |
| Top 20 | 0.1861 | -53.8% |
| Make Cut | 0.2296 | +8.1% |

**Top-20 Brier severely negative (-53.8%):** This reflects the difficulty of the 147-player field with broad BBI top-20 probabilities. Many players projected with 60-70% top-20 probability missed the cut or finished outside top-40.

## Factor Attribution (Top-10 vs Field)
Winning factors (over-indexed in actual top-10):
1. **courseFit** (ratio: 1.140) — Course fit was the best discriminator
2. **form** (ratio: 1.139) — Recent form mattered
3. **ceiling** (ratio: 1.108) — Upside predicted top performers

Underperforming:
1. **contrarian/dfsValue/strategic** (ratio ~1.04) — Low-signal factors, as expected

## Shadow Variant Scores (JOB C)
| Variant | Spearman | Delta vs v8.5 |
|---------|----------|---------------|
| v8.5 (baseline) | 0.1990 | — |
| v8.6-cf | 0.1907 | -0.0083 |
| v8.6-tal | 0.1629 | -0.0361 |
| v8.6-form | 0.1894 | -0.0096 |
| v8.6-dyn | 0.1828 | -0.0162 |
| v8.7-cfgate | 0.1772 | -0.0218 |

**Baseline won this week** — all shadow variants underperformed v8.5. v8.6-cf was closest (-0.0083). Competition leader remains uncertain (no variant cleared baseline).

## Key Misses
- **Burns, Sam** (BBI #1, DG high-prob): T21. Course history from 2025 TPC Toronto gave him outsized courseFit boost. 2025 data predates current North Course setup; may not transfer.
- **Fleetwood, Tommy** (BBI #2): T13. No course history (NO_HISTORY tier). Pure talent/form pick.
- **Morikawa, Collin** (BBI #4): T37. Form and talent elevated him; course didn't suit.

## Key Hits
- **Fitzpatrick, Matt** (BBI #3 → T2) ✓
- **Hovland, Viktor** (BBI #9 → T3) ✓
- **Clark, Wyndham** (BBI #12 → T11) ✓
- **Fox, Ryan** (BBI #14 → T8) ✓

## Course History Coverage Note
77/144 eligible players had TPC Toronto history (53.5%), but **only 2025 data is actual TPC Toronto North Course**. Prior years (2022-2024) were at different venues (St. George's, Oakdale, Hamilton). This means courseFit layer was effectively 1-year history for most players, reducing signal quality. Apollo should be updated to filter to venue-specific years for RBC Canadian Open in future.

## Improvement Suggestions
1. **Venue-year filtering for RBC Canadian Open**: Apollo pulls event_id=32 years 2022-2025, but TPC Toronto (North Course) only hosted in 2025. Years 2022-2024 were at different venues. This inflates "course history" coverage from ~18% to 53% with irrelevant data. Apollo needs course_name filtering for events that rotate venues.
2. **Burns/Lowry courseFit inflation**: Both had "COMFORTABLE" tier (4 rounds, 2025 TPC Toronto). Burns finished T21, Lowry T37. 1 year of course history at a venue that changes character annually may need a "recency weighting" — penalize single-year history at venue-rotating events.
3. **Consider DG win-prob rank for DG comparison**: Using prob_win rank for DG's Spearman places DG at 0.245 vs BBI 0.199. This is directionally informative but DG prob_win is a better calibrated predictor than simple rank. Long-term, we should track both.
