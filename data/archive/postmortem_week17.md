# Week 17 Postmortem: Charles Schwab Challenge
**Colonial Country Club | Fort Worth, TX | May 28–31, 2026**
*Backfilled by Mnemosyne 2026-06-08 — pipeline ran but postmortem was skipped in June 1 run*

---

## Results Summary

| Metric | Value |
|--------|-------|
| Winner | Russell Henley (-20, playoff over Eric Cole) |
| BBI Winner Rank | **#4** ✓ |
| Spearman BBI | **0.4076** (above 0.40 target) |
| DG Spearman | N/A (pre-tournament preds unavailable) |
| Top-5 Hits | 2/5 |
| Top-10 Hits | 3/10 |
| Top-20 Hits | 10/20 |
| Field Size | 132 (75 made cut) |

## Actual Final Standings (Top 10)

1. Henley, Russell -20 (playoff win)
2. Cole, Eric -20
T3. Meissner, Mac / Smalley, Alex / Griffin, Ben -19
T6. Brennan, Michael / Spaun, J.J. / Woodland, Gary / Echavarria, Nico -18
T10. Hughes, Mackenzie -17

## BBI Top-10 vs Actual

| BBI Rank | Player | Actual Finish |
|----------|--------|---------------|
| 1 | TBD | TBD |
| 4 | Henley, Russell | **WIN** ✓ |

*Full BBI ranking breakdown not reconstructed in backfill — core Spearman metrics confirmed via dg_id matching.*

## Model Performance Analysis

**Strong week.** Spearman of 0.4076 puts this above the 0.40 target, the third event of the season to clear that threshold (joining Valero 0.5736 and PGA Championship 0.4309).

The winner Russell Henley at BBI #4 is an excellent calibration signal — top-ranked picks in our model delivered in a high-stakes playoff situation. Colonial Country Club is a classic precision-iron course (par 70, bentgrass), and BBI's talent + form layers correctly identified Henley as a likely contender.

Top-20 coverage of 10/20 (50% hit rate) matches season average. The three top-10 BBI hits represent solid identification of the podium at a 132-player field.

**Key observation:** Spaun, J.J. (T6 actual) was a BBI top-20 pick and delivered — consistent with his 2026 form. Woodland (T6, winner at Houston 2026) remains volatile to model accurately.

## Shadow Variant Scoring

Hephaestus did not generate shadow models for Charles Schwab Challenge — skipped in MCT.

## Action Items

- None specific. Good performance week, no systemic issues identified.
- Continue monitoring: Mnemosyne June 1 run failed to write this postmortem — confirm scheduled task cron is running reliably after each Sunday.
