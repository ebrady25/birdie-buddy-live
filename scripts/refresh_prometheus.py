#!/usr/bin/env python3
"""
refresh_prometheus.py — DG baseline backtest for BirdieBuddy.

Runs via GitHub Actions every Sunday night (23:04 ET / 03:04 UTC Mon).
Re-scores DG's pre-tournament baseline against actual finishing positions
across the 2025 reference season + all completed 2026 events.

Output: data/prometheus_backtest.json (47+ events, mean Spearman ~0.39).
This is the stable benchmark HEPHAESTUS shadow variants are scored against.

Resume-safe: reads existing per_event array, only fetches new events.
Rate-limited: 2s between DG requests, aborts after 3 consecutive 429s.
55-minute wall-clock budget (well under GH Actions 6h job limit).

Self-contained — inlines the calibration math from BBI-Cowork/Context/calibration_helper.py
so the live repo has no dependency on the private archive.
"""

import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

DG_KEY = os.environ.get("DG_API_KEY", "")
EVENTS_FILE = Path("scripts/backtest_events.json")
OUT_FILE = Path("data/prometheus_backtest.json")

RATE_LIMIT_SEC = 2.0
CONSECUTIVE_429_ABORT = 3
MAX_WALL_SEC = 55 * 60


# ------------- inlined calibration math -------------

def _infer_prob_scale(values):
    nn = [v for v in values if v is not None]
    if not nn:
        return "unit"
    return "percent" if max(nn) > 1.01 else "unit"


def _scale_probs(raw, scale):
    return [(r / 100 if scale == "percent" else r) if r is not None else 0.0 for r in raw]


def _brier(pairs):
    if not pairs:
        return None
    return sum((p - y) ** 2 for p, y in pairs) / len(pairs)


def _log_loss(pairs, eps=1e-3):
    if not pairs:
        return None
    return -sum(
        y * math.log(max(eps, min(1 - eps, p)))
        + (1 - y) * math.log(max(eps, min(1 - eps, 1 - p)))
        for p, y in pairs
    ) / len(pairs)


def _reliability_bins(pairs, n_bins=10):
    bins = [[] for _ in range(n_bins)]
    for p, y in pairs:
        idx = min(n_bins - 1, int(p * n_bins))
        bins[idx].append((p, y))
    out = []
    for i, b in enumerate(bins):
        if not b:
            out.append(None)
            continue
        out.append({
            "bin": f"{int(i * 100 / n_bins)}-{int((i + 1) * 100 / n_bins)}%",
            "n": len(b),
            "mean_pred": round(sum(p for p, _ in b) / len(b), 4),
            "actual_rate": round(sum(y for _, y in b) / len(b), 4),
        })
    return out


def compute_calibration(field, actual_by_dgid, prob_keys_map):
    result = {}
    for m, key in prob_keys_map.items():
        raw = [p.get(key) for p in field]
        scale = _infer_prob_scale(raw)
        scaled = _scale_probs(raw, scale)
        pairs = []
        for player, pred in zip(field, scaled):
            dgid = player.get("dg_id")
            if dgid is None or dgid not in actual_by_dgid:
                continue
            y = actual_by_dgid[dgid].get(m)
            if y is None:
                continue
            pairs.append((pred, y))
        if not pairs:
            result[m] = {"error": "no joined players", "n": 0}
            continue
        br = _brier(pairs)
        ll = _log_loss(pairs)
        mp = sum(p for p, _ in pairs) / len(pairs)
        ma = sum(y for _, y in pairs) / len(pairs)
        naive = _brier([(ma, y) for _, y in pairs])
        skill = ((naive - br) / naive * 100) if naive and naive > 0 else 0
        result[m] = {
            "n": len(pairs),
            "scale_detected": scale,
            "brier": round(br, 4),
            "log_loss": round(ll, 4),
            "mean_pred": round(mp, 4),
            "mean_actual": round(ma, 4),
            "naive_brier": round(naive, 4),
            "skill_pct": round(skill, 2),
            "bins": _reliability_bins(pairs),
        }
    return result


def spearman_rho(a, b):
    n = len(a)
    if n < 2:
        return None
    d2 = sum((x - y) ** 2 for x, y in zip(a, b))
    return 1 - (6 * d2) / (n * (n * n - 1))


# ------------- DG fetch -------------

def fetch(url, timeout=30, max_retries=1):
    """Fetch with 429 handling. Returns (json|None, '429'|None)."""
    attempt = 0
    while True:
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                return json.loads(r.read()), None
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < max_retries:
                time.sleep(15)
                attempt += 1
                continue
            if e.code == 429:
                return None, "429"
            raise


def prob_from_odds(v):
    if v is None:
        return 0.0
    try:
        v = float(v)
    except (TypeError, ValueError):
        return 0.0
    if v <= 0 or math.isnan(v):
        return 0.0
    return min(1.0, max(0.0, 1.0 / v))


def score_event(event_id, year):
    """Score a single event. Returns (result_dict, was_429)."""
    url_preds = (
        f"https://feeds.datagolf.com/preds/pre-tournament-archive?tour=pga"
        f"&event_id={event_id}&year={year}&market=win&odds_format=decimal"
        f"&file_format=json&key={DG_KEY}"
    )
    url_rounds = (
        f"https://feeds.datagolf.com/historical-raw-data/rounds?tour=pga"
        f"&event_id={event_id}&year={year}&file_format=json&key={DG_KEY}"
    )

    preds, err = fetch(url_preds)
    if err == "429":
        return {"error": "429_rate_limited"}, True
    time.sleep(RATE_LIMIT_SEC)
    rounds, err = fetch(url_rounds)
    if err == "429":
        return {"error": "429_rate_limited"}, True

    field = preds.get("baseline", []) if preds else []
    if not field:
        return {"error": "no baseline"}, False

    standings = []
    for p in rounds.get("scores", []) if rounds else []:
        scores = [
            p[rk]["score"] for rk in ("round_1", "round_2", "round_3", "round_4")
            if p.get(rk) and p[rk].get("score") is not None
        ]
        if not scores:
            continue
        standings.append({
            "dg_id": p["dg_id"],
            "total": sum(scores),
            "made_cut": len(scores) == 4,
        })
    if not standings:
        return {"error": "no standings"}, False

    standings.sort(key=lambda x: (not x["made_cut"], x["total"]))
    prev = -1
    pos = 0
    for i, s in enumerate(standings):
        if s["made_cut"] and s["total"] != prev:
            pos = i + 1
            prev = s["total"]
        s["position"] = pos if s["made_cut"] else None

    actual_by_dg = {
        s["dg_id"]: {
            "make_cut": 1 if s["made_cut"] else 0,
            "top_20": 1 if (s["made_cut"] and s.get("position") and s["position"] <= 20) else 0,
            "top_10": 1 if (s["made_cut"] and s.get("position") and s["position"] <= 10) else 0,
            "top_5":  1 if (s["made_cut"] and s.get("position") and s["position"] <= 5) else 0,
            "win":    1 if (s.get("position") == 1) else 0,
            "position": s.get("position"),
        }
        for s in standings
    }

    for p in field:
        p["win_prob"] = prob_from_odds(p.get("win"))
        p["top_10_prob"] = prob_from_odds(p.get("top_10"))
        p["top_5_prob"] = prob_from_odds(p.get("top_5"))
        p["top_20_prob"] = prob_from_odds(p.get("top_20"))
        mc = p.get("make_cut")
        if mc is None:
            p["make_cut_prob"] = 0.0
        elif 0 <= mc <= 1:
            p["make_cut_prob"] = mc
        else:
            p["make_cut_prob"] = prob_from_odds(mc)

    cal = compute_calibration(
        field, actual_by_dg,
        prob_keys_map={
            "win": "win_prob", "top_10": "top_10_prob",
            "top_5": "top_5_prob", "top_20": "top_20_prob",
            "make_cut": "make_cut_prob",
        },
    )

    mc_players = [
        p for p in field
        if p["dg_id"] in actual_by_dg and actual_by_dg[p["dg_id"]]["position"]
    ]
    mc_players.sort(key=lambda x: -x["win_prob"])
    for i, p in enumerate(mc_players):
        p["pred_rank_mc"] = i + 1
    mc_sorted_actual = sorted(mc_players, key=lambda x: actual_by_dg[x["dg_id"]]["position"])
    for i, p in enumerate(mc_sorted_actual):
        p["actual_rank_mc"] = i + 1
    pred_ranks = [p["pred_rank_mc"] for p in mc_players]
    act_ranks = [p["actual_rank_mc"] for p in mc_players]
    rho = spearman_rho(pred_ranks, act_ranks) if len(mc_players) >= 3 else None
    if rho is not None:
        rho = max(-1.0, min(1.0, rho))

    return {
        "event_id": event_id,
        "year": year,
        "event_name": preds.get("event_name", ""),
        "field_size": len(field),
        "made_cut": sum(1 for s in standings if s["made_cut"]),
        "spearman_dg_baseline": round(rho, 4) if rho is not None else None,
        "calibration": cal,
    }, False


def discover_2026_archived():
    """Discover 2026 events with archived_preds=yes from DG event-list."""
    try:
        url = f"https://feeds.datagolf.com/historical-odds/event-list?file_format=json&key={DG_KEY}"
        data, err = fetch(url)
        if err or not data:
            return []
        out = []
        for ev in data:
            try:
                yr = int(ev.get("calendar_year") or ev.get("year") or 0)
                if yr != 2026:
                    continue
                if str(ev.get("tour", "pga")).lower() != "pga":
                    continue
                if str(ev.get("archived_preds", "")).lower() not in ("yes", "true", "1"):
                    continue
                eid = int(ev.get("event_id") or 0)
                if not eid:
                    continue
                out.append({"event_id": eid, "event_name": ev.get("event_name", ""), "year": 2026})
            except (TypeError, ValueError):
                continue
        return out
    except Exception:  # noqa: BLE001
        return []


def main():
    if not DG_KEY:
        sys.exit("ERROR: DG_API_KEY secret not set in repo settings.")

    t0 = time.time()

    events = json.load(open(EVENTS_FILE))
    events_2026 = discover_2026_archived()
    print(f"Discovered {len(events_2026)} 2026 events with archived preds", flush=True)
    all_events = list(events) + events_2026

    existing_per_event = []
    existing_keys = set()
    if OUT_FILE.exists():
        try:
            prev = json.load(open(OUT_FILE))
            existing_per_event = prev.get("per_event", [])
            for r in existing_per_event:
                if r.get("event_id") and r.get("year") and "error" not in r:
                    existing_keys.add((r["event_id"], r["year"]))
            print(f"Resume: {len(existing_keys)} events already scored — skipping.", flush=True)
        except Exception:  # noqa: BLE001
            pass

    to_process = [e for e in all_events if (e["event_id"], e["year"]) not in existing_keys]
    print(f"Processing {len(to_process)} events (total {len(all_events)})...", flush=True)

    new_results = []
    consecutive_429 = 0
    aborted_429 = False
    for i, e in enumerate(to_process):
        if time.time() - t0 > MAX_WALL_SEC:
            print(f"  Wall-clock budget reached at {int(time.time()-t0)}s — committing partial.", flush=True)
            break
        try:
            r, was_429 = score_event(e["event_id"], e["year"])
        except Exception as ex:  # noqa: BLE001
            r = {"error": str(ex)[:120], "event_id": e["event_id"], "year": e["year"]}
            was_429 = False
        r["event_name_input"] = e["event_name"]
        r.setdefault("event_id", e["event_id"])
        r.setdefault("year", e["year"])
        new_results.append(r)

        if was_429:
            consecutive_429 += 1
            print(f"  [{i+1:>2}/{len(to_process)}] {e['event_name'][:38]:<38} 429 ({consecutive_429} consecutive)", flush=True)
            if consecutive_429 >= CONSECUTIVE_429_ABORT:
                print("  Aborting after 3 consecutive 429s — committing partial.", flush=True)
                aborted_429 = True
                break
        else:
            consecutive_429 = 0
            if "error" in r:
                print(f"  [{i+1:>2}/{len(to_process)}] {e['event_name'][:38]:<38} ERR: {r['error'][:50]}", flush=True)
            else:
                rho = r.get("spearman_dg_baseline")
                b10 = r.get("calibration", {}).get("top_10", {}).get("brier")
                rho_s = f"{rho:+.3f}" if rho is not None else "None"
                b10_s = f"{b10:.4f}" if b10 is not None else "None"
                print(f"  [{i+1:>2}/{len(to_process)}] {e['event_name'][:38]:<38} "
                      f"rho={rho_s} brier(t10)={b10_s} n={r.get('made_cut')}", flush=True)
        time.sleep(RATE_LIMIT_SEC)

    all_results = list(existing_per_event) + new_results
    seen = {}
    for r in all_results:
        k = (r.get("event_id"), r.get("year"))
        seen[k] = r
    merged = list(seen.values())

    valid = [r for r in merged if "error" not in r]
    agg = {}
    if valid:
        rhos = [r["spearman_dg_baseline"] for r in valid if r.get("spearman_dg_baseline") is not None]
        agg["n_events"] = len(valid)
        agg["mean_spearman"] = round(sum(rhos) / len(rhos), 4) if rhos else None
        agg["median_spearman"] = round(sorted(rhos)[len(rhos) // 2], 4) if rhos else None
        for m in ("win", "top_5", "top_10", "top_20", "make_cut"):
            briers = [
                r["calibration"][m]["brier"] for r in valid
                if m in r.get("calibration", {}) and "brier" in r["calibration"][m]
            ]
            if briers:
                agg[f"mean_brier_{m}"] = round(sum(briers) / len(briers), 4)
                agg[f"median_brier_{m}"] = round(sorted(briers)[len(briers) // 2], 4)

    failed = [
        {"event_id": r.get("event_id"), "year": r.get("year"),
         "event_name": r.get("event_name_input", ""), "error": r.get("error")}
        for r in merged if "error" in r
    ]

    out = {
        "run_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "reference_season": 2025,
        "seasons_included": sorted({r.get("year") for r in merged if r.get("year")}),
        "model_source": "DataGolf pre-tournament baseline. Reference benchmark for shadow-variant promotion decisions.",
        "n_events_attempted": len(all_events),
        "n_events_scored": len(valid),
        "aborted_after_429s": aborted_429,
        "aggregate": agg,
        "per_event": merged,
        "failed_events": failed,
        "notes": "Resume-safe. Spearman on made-cut players only. Brier on full-field binary outcomes.",
        "auto_generated_by": "github-actions / refresh_prometheus.py",
    }
    OUT_FILE.parent.mkdir(exist_ok=True)
    with OUT_FILE.open("w") as f:
        json.dump(out, f, indent=2)

    duration = int(time.time() - t0)
    print("\n" + "=" * 70, flush=True)
    print(f"Saved: {OUT_FILE}", flush=True)
    print(f"Events scored: {agg.get('n_events')}/{len(all_events)} (duration={duration}s)", flush=True)
    print(f"Mean Spearman: {agg.get('mean_spearman')} | Median: {agg.get('median_spearman')}", flush=True)
    print(f"Mean Brier: top10={agg.get('mean_brier_top_10')}, top5={agg.get('mean_brier_top_5')}, "
          f"win={agg.get('mean_brier_win')}, MC={agg.get('mean_brier_make_cut')}", flush=True)
    if failed:
        print(f"Failed events ({len(failed)}):", flush=True)
        for f in failed[:20]:
            print(f"  {f['year']} eid={f['event_id']} {f['event_name'][:40]}: {f['error']}", flush=True)


if __name__ == "__main__":
    main()
