# Week 14 Postmortem: Truist Championship
**Quail Hollow Club, Charlotte NC | May 7–10, 2026**
*Generated: 2026-05-11 by Mnemosyne v3.0*

---

## Result

**Winner: Kristoffer Reitan** — 15-under 269 (66-70-64-69)
- BBI Pool Rank: **#43** | DG Pre-tournament Rank: #36
- BBI win probability: 0.67%
- Reitan was not identified as a threat by either model. His R3 (64, -7) was driven by OTT+2.06 and PUTT+3.12 — a transcendent Quail Hollow round.

**T2: Rickie Fowler / Nicolai Hojgaard** (−13)
- Fowler: BBI #13 — model's best top-5 hit
- Hojgaard: BBI #14 — solid near-miss

**4th: Alex Fitzpatrick** (−12)
**T5: J.J. Spaun / Tommy Fleetwood / Sungjae Im** (−11)

---

## Model Performance

| Metric | BBI v8.5 | DataGolf | Delta |
|--------|----------|----------|-------|
| Spearman rho | **0.1766** | 0.1449 | +0.032 beat-DG |
| Fisher Z | 1.471 | 1.203 | +0.268 |
| Top-5 hits | 0/5 | — | — |
| Top-10 hits | 3/10 | — | — |
| Top-20 hits | 9/20 | — | — |
| Winner in top-10 | No (rank 43) | No (rank 36) | — |

**Assessment: Weakest week of 2026.** Spearman 0.177 is the season low. Neither model identified the winner or any of the top-3 finishers' trajectories. BBI did beat DG narrowly (+0.032), extending the season head-to-head record to **5-2**. Both models failed this week — it was a low-ranked surprise winner week.

---

## Top BBI Picks vs Actual

| BBI Rank | Player | Actual | Notes |
|----------|--------|--------|-------|
| #1 | McIlroy, Rory | T22 | Big miss — variance, not model flaw |
| #2 | Schauffele, Xander | T60 | Disaster — Quail history should be negative |
| #3 | Young, Cameron | T10 | Hit |
| #4 | Fitzpatrick, Matt | T52 | Big miss |
| #5 | Kim, Si Woo | T65 | Disaster |
| #6 | Fleetwood, Tommy | T5 | Hit |
| #7 | Aberg, Ludvig | T8 | Hit |
| #10 | Spaun, J.J. | T5 | Hit |
| #12 | Cantlay, Patrick | T10 | Near-hit |
| #13 | Fowler, Rickie | T2 | Near-win |
| #14 | Hojgaard, Nicolai | T2 | Near-win |
| #43 | **Reitan, Kristoffer** | **WIN** | Winner missed |

---

## Key Observations

### Major Misses
1. **Schauffele (BBI #2 → T60)**: Quail Hollow has been a consistent underperformance venue for Schauffele despite elite OTT. His historical course SG should be flagged as negative — this is a known pattern being missed by the model.
2. **Kim Si Woo (BBI #5 → T65)**: Bermuda-to-bentgrass transition may not be penalizing correctly in the putting weight.
3. **Matt Fitzpatrick (BBI #4 → T52)**: No obvious explanation — investigate career Quail results. Alex Fitzpatrick (BBI unranked) finished 4th, adding insult.

### Validated Picks
- Fowler (#13 → T2) and Hojgaard (#14 → T2): Both correctly in the BBI credible range
- Fleetwood (#6 → T5): Iron play + bentgrass putting translated perfectly
- Aberg (#7 → T8): Course fit model for Quail validated

### Winner Analysis
Reitan's winning profile: R1 PUTT+2.70, R3 OTT+2.06 / PUTT+3.12. He exploited the bentgrass putting surface with a transcendent hot streak. BBI had him COMFORTABLE tier (4 rounds, positive wSG). His pre-tournament form metrics didn't indicate a ceiling this high — this is a performance cap miss, not a profiling miss.

---

## Season Standings

| Week | Event | BBI rho | Beat DG? |
|------|-------|---------|----------|
| 7 | Valspar | 0.399 | Yes |
| 8 | Houston Open | 0.453 | Yes |
| 9 | Valero | 0.574 | Yes |
| 10 | Masters | 0.371 | No |
| 11 | RBC Heritage | 0.344 | No |
| 13 | Cadillac | 0.315 | Yes |
| **14** | **Truist** | **0.177** | **Yes** |
| | **Season avg** | **0.376** | **5-2** |

Three consecutive below-0.40 events. Season avg has slipped from 0.409 to 0.376. This is a concern worth addressing in calibration.

---

## Improvement Suggestions for Week 15

1. **Schauffele Quail outlier flag**: Add course-specific negative overrides for players where historical SG at the venue dramatically underperforms their overall SG profile. Schauffele at Quail is a prototype case.

2. **Bentgrass PUTT weight re-examination**: The current sg_putt weight (0.95) may be too low for Quail Hollow. Reitan's win and Fowler/Hojgaard's T2 were both PUTT-driven. Consider raising to 1.05–1.10 for Quail specifically.

3. **OTT-PUTT synergy tier**: Reitan profile = adequate OTT + elite bentgrass PUTT. This combination may deserve a synthetic synergy multiplier: players in top-40 OTT AND top-15 PUTT at bentgrass courses get a +5% BBI boost.

4. **Season calibration alert**: 3 consecutive sub-0.40 events. Consider whether f_courseFit and f_form weights need global recalibration before the next major stretch begins.
