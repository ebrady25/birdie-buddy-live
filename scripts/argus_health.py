#!/usr/bin/env python3
"""
argus_health.py — Preflight health check for the BBI pipeline.

Runs via GitHub Actions on 5 cron windows (Mon/Tue/Wed) ahead of each
downstream Claude task. Writes data/argus_health.json. Downstream Claude
tasks curl the GH Pages URL and abort if status != "green".

Cloud-simplified vs the legacy Mac-resident ARGUS:
  - drops `disk` (irrelevant on ephemeral runners)
  - drops `stuck_sessions` (Mac-specific)
  - drops `github_auth` (the action is natively authed)

Checks performed (all phases):
  1. current_event   — data/current_event.json sanity (event_id, days_until_start, team_event)
  2. datagolf_api    — probes preds/pre-tournament, counts players returned
  3. prior_outputs   — phase-specific freshness gate on data/* files in this repo

Phase argument selects which prior_outputs are required:
  mnemosyne     → no prior-output gate (first phase of the week)
  phase1        → mnemosyne run today (current_event freshness)
  phase15       → bbi_rankings.json exists and is current
  preview       → phase15_report (themis.json) exists and <6h old
  lock          → tuesday dashboard data exists and <24h old

Status logic:
  green  — all required checks pass
  yellow — non-fatal warnings (e.g. low book count, slightly stale data)
  red    — at least one fatal check failed; downstream tasks MUST abort
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DG_KEY = os.environ.get("DG_API_KEY", "")
OUT_FILE = Path("data/argus_health.json")
CURRENT_EVENT_FILE = Path("data/current_event.json")

PHASES = ("mnemosyne", "phase1", "phase15", "preview", "lock")


def check_current_event():
    """Validate data/current_event.json shape + freshness."""
    if not CURRENT_EVENT_FILE.exists():
        return {"status": "fail", "error": "current_event.json missing"}
    try:
        ev = json.load(open(CURRENT_EVENT_FILE))
    except Exception as e:  # noqa: BLE001
        return {"status": "fail", "error": f"current_event.json invalid: {e}"}

    # Required fields the pipeline relies on
    required = ["event_id", "event_name", "start_date"]
    missing = [k for k in required if k not in ev]
    if missing:
        return {"status": "fail", "error": f"missing fields: {missing}", "fields_present": list(ev.keys())}

    # days_until_start
    try:
        sd = datetime.strptime(ev["start_date"], "%Y-%m-%d").replace(tzinfo=timezone.utc)
        days = (sd - datetime.now(timezone.utc)).days
    except Exception as e:  # noqa: BLE001
        return {"status": "fail", "error": f"bad start_date {ev.get('start_date')!r}: {e}"}

    team = bool(ev.get("team_event", False))

    # Stale = event already in the past by 2+ days (Mnemosyne should have advanced it)
    if days < -2:
        return {
            "status": "fail",
            "error": "current_event is stale",
            "event_id": ev.get("event_id"),
            "event_name": ev.get("event_name"),
            "days_until_start": days,
            "team_event": team,
        }

    return {
        "status": "pass",
        "event_id": ev.get("event_id"),
        "event_name": ev.get("event_name"),
        "start_date": ev.get("start_date"),
        "days_until_start": days,
        "team_event": team,
        "required_fields_present": True,
    }


def check_datagolf():
    """Probe the DG pre-tournament endpoint."""
    if not DG_KEY:
        return {"status": "fail", "error": "DG_API_KEY not set"}
    url = (
        "https://feeds.datagolf.com/preds/pre-tournament?tour=pga"
        f"&odds_format=percent&file_format=json&key={DG_KEY}"
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            duration = time.time() - t0
            data = json.loads(r.read())
            field = data.get("baseline", []) or data.get("data", []) or []
            return {
                "status": "pass" if field else "fail",
                "http_code": 200,
                "duration_s": round(duration, 2),
                "players_returned": len(field),
                "endpoint": "preds/pre-tournament",
            }
    except urllib.error.HTTPError as e:
        return {"status": "fail", "http_code": e.code, "endpoint": "preds/pre-tournament", "error": str(e)[:100]}
    except Exception as e:  # noqa: BLE001
        return {"status": "fail", "endpoint": "preds/pre-tournament", "error": str(e)[:100]}


def file_age_hours(path: Path):
    """Return file age in hours, or None if missing."""
    if not path.exists():
        return None
    age = time.time() - path.stat().st_mtime
    return round(age / 3600, 2)


def check_prior_outputs(phase: str):
    """Phase-specific freshness gate on already-deployed files in the live repo."""
    # phase → list of (file, max_age_hours_or_None) requirements
    # max_age_hours=None means "must exist, age not checked"
    requirements = {
        "mnemosyne": [],  # first phase of the week
        "phase1":    [],  # mnemosyne ran today but current_event sanity covers it
        "phase15":   [(Path("data/bbi_rankings.json"), 30)],   # Phase 1 ran <30h ago
        "preview":   [(Path("data/themis.json"), 6),
                      (Path("data/bbi_rankings.json"), 30)],
        "lock":      [(Path("data/bbi_rankings.json"), 48),
                      (Path("data/themis.json"), 30)],
    }
    reqs = requirements.get(phase)
    if reqs is None:
        return {"status": "fail", "error": f"unknown phase {phase!r}"}
    if not reqs:
        return {
            "status": "n/a",
            "note": f"{phase} has no prior-output gate (first or independent phase).",
        }

    failures = []
    notes = []
    for path, max_age in reqs:
        age_h = file_age_hours(path)
        if age_h is None:
            failures.append(f"{path} missing")
        elif max_age is not None and age_h > max_age:
            failures.append(f"{path} stale ({age_h}h > {max_age}h)")
        else:
            notes.append(f"{path.name} ({age_h}h)")

    if failures:
        return {"status": "fail", "failures": failures, "ok": notes}
    return {"status": "pass", "checked": notes}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", required=True, choices=PHASES)
    args = ap.parse_args()
    phase = args.phase

    checks = {
        "current_event": check_current_event(),
        "datagolf_api":  check_datagolf(),
        "prior_outputs": check_prior_outputs(phase),
    }

    statuses = [c.get("status") for c in checks.values()]
    has_fail = "fail" in statuses
    overall = "red" if has_fail else "green"

    next_phase_map = {
        "mnemosyne": "mnemosyne_postmortem",
        "phase1":    "phase1_apollo_atlas",
        "phase15":   "phase15_aeolus_zeus",
        "preview":   "phase2_preview",
        "lock":      "phase2_lock",
    }

    recommendations = []
    if checks["current_event"].get("status") == "fail":
        recommendations.append("MNEMOSYNE has not advanced CURRENT_EVENT — pipeline will cascade-abort.")
    if checks["datagolf_api"].get("status") == "fail":
        recommendations.append("DataGolf API is unreachable — wait and retry, do not run downstream tasks.")
    if checks["prior_outputs"].get("status") == "fail":
        recommendations.append(f"Prerequisite outputs for {phase} are missing or stale.")

    out = {
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "phase_checked": phase,
        "next_phase": next_phase_map[phase],
        "status": overall,
        "checks": checks,
        "recommendations": recommendations,
        "action_required": has_fail,
        "auto_generated_by": "github-actions / argus_health.py",
    }
    OUT_FILE.parent.mkdir(exist_ok=True)
    with OUT_FILE.open("w") as f:
        json.dump(out, f, indent=2)

    print(f"ARGUS preflight: {overall} (phase={phase})")
    print(json.dumps(out, indent=2))
    if has_fail:
        sys.exit(1)


if __name__ == "__main__":
    main()
