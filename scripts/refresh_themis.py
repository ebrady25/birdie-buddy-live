#!/usr/bin/env python3
"""
refresh_themis.py — Monte Carlo simulator for BirdieBuddy.

Runs via GitHub Actions on (a) cron Tue 07:33 ET and (b) push to
data/bbi_rankings.json (so Phase 1.5/Preview/Lock overrides automatically
re-fire THEMIS with the fresh inputs).

Reads:  data/bbi_rankings.json (rankings array — proj_total, std_dev, make_cut)
Writes: data/themis.json (per_player empirical probabilities + percentile stats)

Produces per-player Monte Carlo output only — lineup_distributions are
recomputed by the Preview/Lock Claude phase from in-memory sim totals,
since they require the full 10k×82 totals matrix that's too large to
publish as JSON.

Self-contained — the simulator math is inlined from BBI-Cowork/Context/themis_simulator.py.
"""

import json
import math
import random
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

INPUT_FILE = Path("data/bbi_rankings.json")
OUTPUT_FILE = Path("data/themis.json")
N_SIMS = 10000
SEED = 42


def simulate_tournament(players, rng):
    totals = {}
    for p in players:
        mu = p.get("proj_total", 50) or 50
        sigma = p.get("std_dev", 15) or 15
        if sigma <= 0:
            sigma = 15
        mc_prob = p["_make_cut_prob"]
        made_cut = rng.random() < mc_prob
        if not made_cut:
            total = mu * 0.5 + rng.gauss(0, sigma * 0.4)
        else:
            total = rng.gauss(mu, sigma)
        totals[p["dg_id"]] = total
    ranked = sorted(totals.items(), key=lambda x: -x[1])
    return ranked, totals


def normalize_make_cut(players):
    """Detect 0-1 vs 0-100 scale and write _make_cut_prob in [0,1] on each player."""
    mc_vals = [p.get("make_cut") for p in players if p.get("make_cut") is not None]
    is_percent = bool(mc_vals) and max(mc_vals) > 1.5

    for p in players:
        mc = p.get("make_cut")
        if mc is None:
            p["_make_cut_prob"] = 0.7
        elif is_percent:
            p["_make_cut_prob"] = max(0.0, min(1.0, mc / 100.0))
        elif 0 <= mc <= 1:
            p["_make_cut_prob"] = mc
        else:
            p["_make_cut_prob"] = max(0.0, min(1.0, 1.0 / mc))


def simulate_tournaments(players, n_sims=N_SIMS, seed=SEED):
    rng = random.Random(seed)
    normalize_make_cut(players)

    counts = {p["dg_id"]: {"win": 0, "top_5": 0, "top_10": 0, "top_20": 0} for p in players}
    all_totals = {p["dg_id"]: [] for p in players}

    for _ in range(n_sims):
        ranked, totals = simulate_tournament(players, rng)
        for p in players:
            all_totals[p["dg_id"]].append(totals[p["dg_id"]])
        for rank, (dgid, _t) in enumerate(ranked):
            r = rank + 1
            if r == 1:
                counts[dgid]["win"] += 1
            if r <= 5:
                counts[dgid]["top_5"] += 1
            if r <= 10:
                counts[dgid]["top_10"] += 1
            if r <= 20:
                counts[dgid]["top_20"] += 1

    per_player = {}
    for p in players:
        dgid = p["dg_id"]
        c = counts[dgid]
        tots = sorted(all_totals[dgid])
        per_player[str(dgid)] = {
            "name": p.get("name"),
            "empirical_win_prob":   round(c["win"] / n_sims, 4),
            "empirical_top5_prob":  round(c["top_5"] / n_sims, 4),
            "empirical_top10_prob": round(c["top_10"] / n_sims, 4),
            "empirical_top20_prob": round(c["top_20"] / n_sims, 4),
            "mean_points":          round(sum(tots) / len(tots), 2),
            "p5":  round(tots[int(0.05 * len(tots))], 2),
            "p25": round(tots[int(0.25 * len(tots))], 2),
            "p50": round(tots[int(0.50 * len(tots))], 2),
            "p75": round(tots[int(0.75 * len(tots))], 2),
            "p95": round(tots[int(0.95 * len(tots))], 2),
            "points_std": round(statistics.pstdev(tots), 2),
        }
    return per_player


def compare_empirical_vs_book(players, per_player):
    out = []
    for p in players:
        dgid = p["dg_id"]
        emp = per_player.get(str(dgid), {})
        bbi_win = p.get("win_pct")
        bbi_t10 = p.get("top_10")
        out.append({
            "name": p.get("name"),
            "dg_id": dgid,
            "bbi_win_prob": bbi_win,
            "empirical_win_prob": emp.get("empirical_win_prob"),
            "delta_win": round((emp.get("empirical_win_prob") or 0) - (bbi_win or 0), 4),
            "bbi_top10_prob": bbi_t10,
            "empirical_top10_prob": emp.get("empirical_top10_prob"),
            "delta_top10": round((emp.get("empirical_top10_prob") or 0) - (bbi_t10 or 0), 4),
        })
    return out


def main():
    if not INPUT_FILE.exists():
        sys.exit(f"ERROR: {INPUT_FILE} not found — Phase 1 must publish first.")

    t0 = time.time()
    rankings_doc = json.load(open(INPUT_FILE))
    players = rankings_doc.get("rankings") or rankings_doc.get("players") or []
    if not players:
        sys.exit("ERROR: no rankings found in bbi_rankings.json")

    print(f"Simulating {len(players)} players × {N_SIMS} tournaments (seed={SEED})...", flush=True)
    per_player = simulate_tournaments(players, n_sims=N_SIMS, seed=SEED)
    comparison = compare_empirical_vs_book(players, per_player)

    out = {
        "event": rankings_doc.get("event"),
        "event_id": rankings_doc.get("event_id"),
        "n_simulations": N_SIMS,
        "seed": SEED,
        "n_players": len(players),
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "per_player": per_player,
        "comparison_emp_vs_book": comparison,
        "lineup_distributions": [],
        "notes": (
            "Per-player Monte Carlo only. Lineup distributions are recomputed "
            "in-process by Preview/Lock since they need the full sim totals matrix."
        ),
        "auto_generated_by": "github-actions / refresh_themis.py",
    }
    OUTPUT_FILE.parent.mkdir(exist_ok=True)
    with OUTPUT_FILE.open("w") as f:
        json.dump(out, f, indent=2)

    duration = time.time() - t0
    n_winners = sum(1 for s in per_player.values() if s["empirical_win_prob"] > 0)
    top_w = sorted(per_player.values(), key=lambda s: -s["empirical_win_prob"])[:5]
    print("\n" + "=" * 70, flush=True)
    print(f"Saved: {OUTPUT_FILE} (duration={duration:.1f}s)", flush=True)
    print(f"Players with non-zero win prob: {n_winners}/{len(players)}", flush=True)
    print("Top 5 by empirical_win_prob:")
    for s in top_w:
        print(f"  {s['name']:<28} win={s['empirical_win_prob']:.4f} t10={s['empirical_top10_prob']:.3f} mean={s['mean_points']:.1f}")


if __name__ == "__main__":
    main()
