# Week 13 Postmortem: Cadillac Championship (Trump National Doral)
**Date completed:** May 3, 2026 | **Logged:** May 4, 2026 (Mnemosyne auto)

---

## Result Summary

| Metric | Value |
|--------|-------|
| Winner | Cameron Young (BBI Pool #2) |
| Runner-up | Scottie Scheffler (BBI Pool #1) |
| Field size | 72 players, 0 missed cuts |
| Spearman (BBI Pool) | **0.303** (p=0.011, statistically significant) |
| Spearman (BBI DFS) | 0.242 (p=0.043) |
| Top-10 overlap | 4/10 |
| Brier (top-10) | 0.1047 — skill score +14.5% vs naïve |
| Brier (win) | 0.0131 — skill score +7.2% vs naïve |

---

## Winner Analysis

**Cameron Young** won at -19 (64-67-70-68), finishing one stroke ahead of Scheffler. Young was the BBI #2 pick with a 6.9% win probability — a strong call. The model had the top two finishers ranked #1 and #2, a near-perfect top-of-board call.

Young's win validates the **long-game dominator + elite iron play** winner archetype configured for Doral. Young ranks among the tour's best in SG: OTT and SG: APP, the two metrics the model weighted most heavily (1.22 and 1.28 respectively).

---

## Top-10 Analysis

**Hit (4/10):** Young (pred #2), Scheffler (pred #1), Kim Si Woo (pred #4), Scott, Adam (pred #9)

**Missed (6/10):** Griffin, Ben (#27 BBI), Straka, Sepp (#30), Noren, Alex (#42), Smalley, Alex (#32), McCarty, Matt (#39), Kitayama, Kurt (#25)

The model captured the elite tier (Scheffler, Young) but missed mid-range players who outperformed their BBI scores. Griffin (T3, BBI #27) and Noren (T7, BBI #42) were significant underranks. Both are solid ball-strikers who may have benefited more from the Hanse redesign's premium on course management than the model anticipated.

---

## Factor Attribution (Top-10 actual finishers)

| Factor | Top-10 Avg | Field Avg | Ratio |
|--------|-----------|-----------|-------|
| **ceiling** | 0.954 | 0.355 | **2.69** ✅ |
| **leverage** | 1.718 | 0.639 | **2.69** ✅ |
| **floor** | 2.416 | 1.638 | **1.475** ✅ |
| talent | 13.082 | 9.685 | 1.351 |
| form | 7.703 | 5.880 | 1.310 |
| courseFit | 12.003 | 10.437 | 1.150 ⚠️ |
| dfsValue | 0.996 | 1.204 | 0.827 ❌ |

**Key findings:**
- **Ceiling and leverage** were the dominant differentiators — the top-10 were players with high upside potential and significant ownership leverage, not just chalk
- **CourseFit underperformed** (ratio 1.15, lowest meaningful factor) — the narrowed course history window (2014-2016 only, ~200 player-rounds) limited signal. The reduced weight (0.20 pool, 0.16 DFS) was the right call but courseFit still provided less lift than hoped
- **dfsValue was negatively correlated** with top-10 outcomes — the highest-value DFS plays did not convert to actual top finishes, suggesting salary-based value hunting was a trap at Doral

---

## Course History Note

This was the first Doral event since 2016 (Hanse redesign era). The `course_history_event_id_fallback` to event_id 473 (WGC-Cadillac, 2014-2016) performed adequately — it successfully identified Scheffler as a Doral fit and Scott, Adam as a comfortable play. However, several players with no Doral history (Griffin, Noren, Smalley) outperformed expectations, suggesting the NO_HISTORY multiplier (1.0 neutral) may have been too conservative for this return event.

**Recommendation for DNA library:** Consider raising NO_HISTORY multiplier to 1.05 for "return events" (courses returning after 5+ year hiatus with redesign), as form and recent ball-striking tend to be better predictors than historical course fit in these cases.

---

## Calibration Health

- Spearman 0.303 is **below RBC Heritage (0.344)** but still statistically significant
- The full-field made-cut scenario (72/72) is unusual and compresses the variance that Spearman rewards
- Rolling season average (3 scored events): **0.323**
- Target: 0.30+ sustained → currently on pace ✅

---

## Actionable Notes for Next Week

1. **CourseFit weight review:** For courses with <5 years of modern history, cap courseFit_pool at 0.18 (vs current default 0.22)
2. **Ceiling/leverage signal confirmed strong** — ensure these factors maintain their current weight allocation in v8.5+
3. **Small field effect:** 72-player no-cut field compresses Spearman range; don't penalize the model for lower correlation in these events

