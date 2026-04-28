#!/usr/bin/env python3
"""
refresh_odds.py — Daily odds patch for BirdieBuddy OMNIA data.

Runs via GitHub Actions (Tue–Sat ~8am ET).
Fetches fresh book odds from DataGolf, re-deviggs market consensus,
recomputes edges vs the BBI model (BBI prob is fixed from Monday's run),
and patches data/omnia.json in place.
"""

import json, os, sys, requests
from datetime import datetime, timezone
from pathlib import Path

DG_KEY     = os.environ.get('DG_API_KEY', '')
DG_BASE    = 'https://feeds.datagolf.com'
OMNIA_PATH = Path('data/omnia.json')
MARKETS    = ['win', 'top_5', 'top_10', 'top_20']

# Fields in the DG odds row that are NOT book decimal odds
NON_BOOK = {'dg_id', 'player_name', 'player_name_dg', 'datagolf', 'player_id'}

BOOK_LABELS = {
    'bet365':'Bet365', 'betcris':'BetCris', 'betmgm':'BetMGM',
    'betonline':'BetOnline', 'betway':'Betway', 'bovada':'Bovada',
    'caesars':'Caesars', 'draftkings':'DraftKings', 'fanduel':'FanDuel',
    'pointsbet':'PointsBet', 'skybet':'SkyBet', 'williamhill':'William Hill',
    'pinnacle':'Pinnacle',
}


def fetch_market(market: str):
    r = requests.get(f'{DG_BASE}/betting-tools/outrights', params={
        'tour':         'pga',
        'market':       market,
        'odds_format':  'decimal',
        'file_format':  'json',
        'key':          DG_KEY,
    }, timeout=30)
    r.raise_for_status()
    return r.json()


def devig_market(players_raw: list, book_keys: list) -> dict:
    """
    Multiplicative devig per book: p_fair_i = (1/dec_i) / sum_j(1/dec_j)
    Returns {dg_id: {book_key: devigged_prob}}
    """
    result = {}
    for bk in book_keys:
        raws = {}
        for p in players_raw:
            dec = p.get(bk)
            if dec and isinstance(dec, (int, float)) and dec > 1:
                raws[p['dg_id']] = 1.0 / dec
        total = sum(raws.values())
        if not total:
            continue
        for pid, imp in raws.items():
            result.setdefault(pid, {})[bk] = imp / total
    return result


def best_book_for(book_odds: dict):
    """Return (label, key, decimal) for the book offering highest decimal (best payout)."""
    if not book_odds:
        return None, None, None
    best_k = max(book_odds, key=lambda k: book_odds[k] or 0)
    return BOOK_LABELS.get(best_k, best_k), best_k, book_odds[best_k]


def main():
    if not DG_KEY:
        sys.exit('ERROR: DG_API_KEY secret not set in repo settings.')

    if not OMNIA_PATH.exists():
        sys.exit('ERROR: data/omnia.json not found — run full OMNIA first.')

    with OMNIA_PATH.open() as f:
        omnia = json.load(f)

    if omnia.get('team_event'):
        print('Team event week — skipping odds refresh.')
        sys.exit(0)

    # Validate event matches (don't patch stale data)
    omnia_event = (omnia.get('event') or '').lower().strip()

    changed      = False
    all_books    = set()

    for market in MARKETS:
        print(f'→ {market}', flush=True)
        try:
            raw = fetch_market(market)
        except Exception as e:
            print(f'  WARN: fetch failed — {e}')
            continue

        # Sanity-check event name
        dg_event = (raw.get('event_name') or '').lower().strip()
        if omnia_event and dg_event and omnia_event not in dg_event and dg_event not in omnia_event:
            print(f'  WARN: event mismatch (omnia={omnia_event!r}, DG={dg_event!r}) — skipping {market}')
            continue

        players_raw = raw.get('odds') or raw.get('data') or []
        if not players_raw:
            print(f'  WARN: no player data')
            continue

        # Identify book columns
        sample    = players_raw[0]
        book_keys = [k for k in sample if k not in NON_BOOK and isinstance(sample.get(k), (int, float))]
        all_books.update(book_keys)

        # Build lookup and devig
        raw_by_id = {p['dg_id']: p for p in players_raw if 'dg_id' in p}
        devigged  = devig_market(players_raw, book_keys)

        # Patch existing edges
        market_data = omnia.setdefault('markets', {}).setdefault(market, {})
        edges       = market_data.get('all_edges', [])
        patched     = 0

        for edge in edges:
            pid   = edge.get('dg_id')
            p_raw = raw_by_id.get(pid)
            if not p_raw:
                continue

            # Collect decimal odds for this player
            book_odds = {
                bk: p_raw[bk]
                for bk in book_keys
                if p_raw.get(bk) and isinstance(p_raw[bk], (int, float)) and p_raw[bk] > 1
            }
            if not book_odds:
                continue

            edge['book_odds'] = book_odds
            edge['n_books']   = len(book_odds)

            # Best individual book
            bb_label, bb_key, bb_dec = best_book_for(book_odds)
            edge['best_book_name']    = bb_label
            edge['best_book_decimal'] = bb_dec

            # Convenience fields kept for backward compat
            edge['draftkings_decimal'] = book_odds.get('draftkings')
            edge['bet365_decimal']     = book_odds.get('bet365')

            # Recompute market consensus (mean devigged across all books)
            player_dev = devigged.get(pid, {})
            if player_dev:
                consensus = sum(player_dev.values()) / len(player_dev)
                edge['market_consensus_prob_deviged'] = round(consensus, 6)
                bbi_prob = edge.get('bbi_prob') or 0
                edge['edge_consensus_pp'] = round((bbi_prob - consensus) * 100, 4)
                edge['draftkings_prob_raw']   = round(player_dev.get('draftkings', 0), 6)
                edge['bet365_prob_deviged']   = round(player_dev.get('bet365', 0), 6)
                edge['pinnacle_prob_deviged'] = round(player_dev.get('pinnacle', 0), 6)

            patched += 1

        market_data['all_edges'] = edges
        print(f'  patched {patched}/{len(edges)} players · {len(book_keys)} books')
        changed = True

    if changed:
        # Update available_books list (exclude pinnacle from UI columns — handled on frontend)
        omnia['available_books'] = sorted(all_books)
        omnia['book_labels']     = {k: BOOK_LABELS.get(k, k.title()) for k in all_books}
        omnia['last_updated_book_odds'] = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
        with OMNIA_PATH.open('w') as f:
            json.dump(omnia, f, separators=(',', ':'))
        print('\nomnia.json updated ✓')
    else:
        print('\nNo changes written.')


if __name__ == '__main__':
    main()
