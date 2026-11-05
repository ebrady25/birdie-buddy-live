/* =====================================================================
   BIRDIEBUDDY — DFS DNA (/dna/)
   A visitor drops their own DraftKings contest-history CSV and gets an
   ancestry-style read on HOW they play (the file has no lineups, so the
   DNA is behavior: what, where and how they enter).
   Spec: Projects/NFL/DFS/automation/DFS_DNA_SPEC_2026-11-05.md

   Two halves in one file:
   - CORE (pure, no DOM): parseCsv / readHistory / analyze. Runs in Node
     too (module.exports) so the numbers can be checked off the page.
   - PAGE: drop zone, sport chips, the canvas share card (portrait
     1080×1350 + landscape 1200×630), the free report, Phase-1 badges and
     the member section (data-gate="member", auth.js blurs it).

   Privacy: the file is read in the browser and never sent anywhere. The
   raw text is dropped after parsing; localStorage keeps only the computed
   summary (mix %, rarity, entry count, date) for "re-check next month",
   plus earned badges. No money, keys, contest names or dates are stored.
   Self-test: ?selftest=dna runs the bundled synthetic sample_history.csv.
   ===================================================================== */
(function (root) {
  'use strict';

  /* =================================================================
     CORE (pure)
     ================================================================= */

  // Columns we need (header match ignores case, spaces and column order). Points and Prize_Pool are optional; other columns are ignored.
  const REQUIRED = ['sport', 'game_type', 'entry', 'contest_key', 'contest_date_est', 'place', 'winnings_non_ticket', 'winnings_ticket', 'contest_entries', 'entry_fee', 'places_paid'];
  const MIN_ENTRIES = 25, EARLY_UNDER = 100, MEANINGFUL_GPP = 200, VOLUME_AT = 20;
  const LEAK_MIN_FEES = 50, LEAK_MIN_ENTRIES = 30;

  class DnaError extends Error { constructor(msg) { super(msg); this.name = 'DnaError'; } }

  // RFC 4180-ish: quoted fields with commas, doubled quotes, newlines inside quotes, CRLF / LF / CR, a BOM.
  const parseCsv = text => {
    text = String(text ?? '');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = []; let row = [], f = '', q = false, i = 0;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; }
        f += c; i++; continue;
      }
      if (c === '"' && f === '') { q = true; i++; continue; }
      if (c === ',') { row.push(f); f = ''; i++; continue; }
      if (c === '\r' || c === '\n') { row.push(f); rows.push(row); row = []; f = ''; if (c === '\r' && text[i + 1] === '\n') i++; i++; continue; }
      f += c; i++;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
  };

  // "$1,234.50" / "1234.5" / "-$5.00" / "($5.00)" -> number; blanks -> 0
  const money = s => {
    s = String(s ?? '').trim(); if (!s) return 0;
    const neg = /^\(.*\)$/.test(s) || /^-|^\$-/.test(s);
    const v = parseFloat(s.replace(/[^0-9.]/g, ''));
    return Number.isFinite(v) ? (neg ? -v : v) : 0;
  };
  const int = s => { const v = parseInt(String(s ?? '').replace(/[^0-9]/g, ''), 10); return Number.isFinite(v) ? v : 0; };

  // Contest_Date_EST is Eastern wall-clock time: read the parts as written, no time-zone math.
  // "2026-11-02 20:15:00" or "11/2/2026 8:15:00 PM". dow: 0 = Sunday.
  const parseDate = s => {
    s = String(s ?? '').trim();
    let y, mo, d, h = null, mi = 0, m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; if (m[4] != null) { h = +m[4]; mi = +m[5]; } }
    else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)?)?/i.exec(s))) {
      mo = +m[1]; d = +m[2]; y = +m[3]; if (y < 100) y += 2000;
      if (m[4] != null) { h = +m[4] % 12; mi = +m[5]; if (!m[6]) h = +m[4]; else if (/p/i.test(m[6])) h += 12; }
    } else return null;
    if (!(y > 1990 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
    const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    return { y, mo, d, h, mi, dow };
  };

  const normHead = h => String(h ?? '').replace(/^﻿/, '').trim().toLowerCase().replace(/[\s-]+/g, '_');

  const SPORT_LABEL = { NFL: 'NFL', GOLF: 'Golf', PGA: 'Golf', NBA: 'NBA', MLB: 'MLB', NHL: 'NHL', CFB: 'College football', CBB: 'College basketball', SOC: 'Soccer', NAS: 'NASCAR', MMA: 'MMA', TEN: 'Tennis', LOL: 'LoL', WNBA: 'WNBA', XFL: 'XFL', CFL: 'CFL', ALL: 'All sports' };
  const sportLabel = k => SPORT_LABEL[k] || (k.charAt(0) + k.slice(1).toLowerCase());

  // CSV text -> { entries, sports: [{key, label, n}], defaultSport }. Throws DnaError with a friendly message.
  const readHistory = text => {
    const rows = parseCsv(text);
    if (!rows.length) throw new DnaError("That file is empty. Download your contest history again and drop the new file here.");
    let hi = -1, col = null;
    for (let r = 0; r < Math.min(rows.length, 5); r++) {
      const idx = {}; rows[r].forEach((h, j) => { const k = normHead(h); if (k && !(k in idx)) idx[k] = j; });
      if (REQUIRED.every(k => k in idx)) { hi = r; col = idx; break; }
    }
    if (hi < 0) {
      const idx = {}; (rows[0] || []).forEach((h, j) => { idx[normHead(h)] = j; });
      const missing = REQUIRED.filter(k => !(k in idx));
      throw new DnaError(missing.length >= REQUIRED.length - 1
        ? "This doesn't look like a DraftKings contest history file. It should start with columns like Sport, Game_Type, Entry, Contest_Entries and Entry_Fee."
        : `This looks close, but it's missing ${missing.length === 1 ? 'a column' : 'some columns'} we need (${missing.map(k => k.replace(/(^|_)([a-z])/g, (a, b, c) => (b ? '_' : '') + c.toUpperCase())).join(', ')}). Download the full contest history again and drop that file.`);
    }
    const get = (r, k) => (col[k] != null ? r[col[k]] : '') ?? '';
    const entries = [], perContest = new Map();
    for (let r = hi + 1; r < rows.length; r++) {
      const row = rows[r]; if (row.length < 4) continue;
      const sport = String(get(row, 'sport')).trim().toUpperCase();
      if (!sport) continue;
      const name = String(get(row, 'entry')), gt = String(get(row, 'game_type'));
      const ck = String(get(row, 'contest_key')).trim() || `row${r}`;
      const e = {
        sport: sport === 'PGA' ? 'GOLF' : sport,
        showdown: /showdown/i.test(gt),
        classic: /classic/i.test(gt) && !/showdown/i.test(gt),
        single: /single entry|\[single/i.test(name),
        sat: /satellite|qualifier/i.test(name),
        ck,                                   // only for counting your lineups per contest; never shown
        dt: parseDate(get(row, 'contest_date_est')),
        place: int(get(row, 'place')),
        field: int(get(row, 'contest_entries')),
        paid: int(get(row, 'places_paid')),
        fee: Math.max(0, money(get(row, 'entry_fee'))),
        won: money(get(row, 'winnings_non_ticket')) + money(get(row, 'winnings_ticket')),
        ticket: money(get(row, 'winnings_ticket'))
      };
      entries.push(e);
      perContest.set(ck, (perContest.get(ck) || 0) + 1);
    }
    if (!entries.length) throw new DnaError("We found the right columns but no entries under them. Download your contest history again and drop the new file.");
    for (const e of entries) e.mine = perContest.get(e.ck);   // your lineups in that contest
    const counts = {};
    for (const e of entries) counts[e.sport] = (counts[e.sport] || 0) + 1;
    const sports = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).map(k => ({ key: k, label: sportLabel(k), n: counts[k] }));
    return { entries, sports, defaultSport: sports[0].key };
  };

  /* ---------------- archetypes ---------------- */
  // Colors: one accent each, all sitting at a similar lightness on the dark card; gold stays the brand + Legendary.
  const ARCH = [
    { id: 'primetime', name: 'Primetime Junkie', line: 'Lives for the lights. TNF, SNF, MNF.', color: '#9D8CFF' },
    { id: 'lottery',   name: 'Lottery Ticket',   line: 'One ticket, one dream, 150,000 rivals.', color: '#F472B6' },
    { id: 'volume',    name: 'Volume Shooter',   line: 'Why build one when you can build twenty?', color: '#4FB8FF' },
    { id: 'sniper',    name: 'Sniper',           line: 'Small fields, one bullet, no wasted shots.', color: '#3DD68C' },
    { id: 'grinder',   name: 'Grinder',          line: 'Double-ups, 50/50s, steady hands.', color: '#A3B1C6' },
    { id: 'highroller', name: 'High Roller',     line: 'Big buy-ins, bigger nerves.', color: '#FF8466' },
    { id: 'ticket',    name: 'Ticket Hunter',    line: 'Plays for seats, not cash.', color: '#B5E35D' },
    { id: 'mainslate', name: 'Main Slater',      line: 'Sunday 1 pm is church.', color: '#2CCFC4' }
  ];
  const OTHER_COLOR = '#3A3A4A';
  const ARCH_BY = Object.fromEntries(ARCH.map(a => [a.id, a]));

  // Rarity = best GPP finish in a field of 1,000+ (verifiable from the file). No population claims.
  const TIERS = [
    { id: 'legendary', label: 'Legendary', max: 0.001, color: '#D4A843' },
    { id: 'epic',      label: 'Epic',      max: 0.01,  color: '#B98CFF' },
    { id: 'rare',      label: 'Rare',      max: 0.05,  color: '#4FB8FF' },
    { id: 'uncommon',  label: 'Uncommon',  max: 0.20,  color: '#3DD68C' },
    { id: 'common',    label: 'Common',    max: 1.01,  color: '#8A8A98' }
  ];
  const TIER_RANK = { legendary: 4, epic: 3, rare: 2, uncommon: 1, common: 0 };

  const BANDS = [
    { id: 'mega',  label: 'Mega-field',  long: 'fields of 100,000+', min: 100000 },
    { id: 'big',   label: 'Big-field',   long: 'fields of 20k–100k', min: 20000 },
    { id: 'mid',   label: 'Mid-field',   long: 'fields of 1k–20k', min: 1000 },
    { id: 'small', label: 'Small-field', long: 'fields under 1,000', min: 0 }
  ];
  const bandOf = N => (BANDS.find(b => N >= b.min) || BANDS[3]).id;
  const TYPES = [
    { id: 'showdown', label: 'showdown', plural: 'Showdown' },
    { id: 'classic',  label: 'classic',  plural: 'Classic' },
    { id: 'cash',     label: 'cash games', plural: 'Cash games' },
    { id: 'sat',      label: 'satellites', plural: 'Satellites' },
    { id: 'other',    label: 'other formats', plural: 'Other formats' }
  ];
  const STYLES = [
    { id: 'single', label: 'single shots', long: 'one lineup in the contest' },
    { id: 'multi',  label: 'multi-entry',  long: '2–19 lineups in the contest' },
    { id: 'volume', label: 'volume (20+ lineups)', long: '20+ lineups in the contest' }
  ];

  const isCash = e => e.field > 1 && e.paid / e.field >= 0.30;
  const isGpp = e => !isCash(e) && e.field >= 100;
  const typeOf = e => e.sat ? 'sat' : isCash(e) ? 'cash' : e.showdown ? 'showdown' : e.classic ? 'classic' : 'other';
  const styleOf = e => e.mine >= VOLUME_AT ? 'volume' : e.mine >= 2 ? 'multi' : 'single';
  const isPrime = e => e.sport === 'NFL' && !!e.dt && ((e.dt.h != null && e.dt.h >= 19) || e.dt.dow === 1 || e.dt.dow === 4);   // NFL only: TNF/SNF/MNF
  const isMainSlate = e => e.sport === 'NFL' && e.classic && !!e.dt && e.dt.dow === 0 && e.dt.h != null && e.dt.h >= 12 && e.dt.h < 14;
  const seasonOf = e => !e.dt ? null : (e.sport === 'NFL' || e.sport === 'CFB') ? (e.dt.mo >= 3 ? e.dt.y : e.dt.y - 1) : e.dt.y;
  const topCut1 = N => Math.max(1, Math.floor(0.01 * N));   // Place <= max(1, 1% of N), places are whole numbers
  const topCut10 = N => Math.floor(0.10 * N);

  // Largest-remainder rounding so the shown percentages add up to exactly 100.
  const round100 = vals => {
    const tot = vals.reduce((a, v) => a + v, 0) || 1;
    const raw = vals.map(v => v / tot * 100), fl = raw.map(Math.floor);
    let left = 100 - fl.reduce((a, v) => a + v, 0);
    raw.map((v, i) => [v - fl[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { fl[i]++; left--; } });
    return fl;
  };

  const ordinal = n => { n = Math.round(n); const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'); return n.toLocaleString('en-US') + s; };
  const topPct = p => { const v = p * 100; return v < 0.1 ? v.toFixed(2).replace(/0$/, '') : v < 1 ? v.toFixed(1) : v < 10 ? v.toFixed(1).replace(/\.0$/, '') : String(Math.round(v)); };

  // A plain fix from our system for a losing bucket (our voice; no promises).
  const fixFor = b => {
    const big = b.band === 'mega' || b.band === 'big';
    let t;
    if (b.type === 'sat') t = 'Satellites only pay off when the seat gets used. Play them for contests you would enter anyway, and keep them to a small slice of your week.';
    else if (b.type === 'cash') t = 'Cash games pay the rake on every entry. Keep them to small fields where your build has a real edge, and keep the stake small next to your tournament play.';
    else if (b.type === 'other') t = "This format isn't where your edge is. Move that money to the contest types where you're doing better.";
    else if (big && b.style === 'single') t = b.type === 'showdown'
      ? 'One showdown lineup in a giant field rarely gets there. Move it to showdown small fields (under 5,000) where one good captain call can cash.'
      : 'One lineup in a giant field is a lottery ticket. Play the Milly as a $5 volume game, or move that money to sub-5k fields.';
    else if (big && b.style === 'multi') t = 'A handful of lineups in a huge field is the worst of both: too few to cover it, too many to be a cheap shot. Concentrate: pick one big contest and go cheap and wide, or drop to a field under 5,000.';
    else if (big) t = 'Twenty-plus lineups still spreads thin in a field this size. Concentrate, don\'t spray: fewer contests, a tighter player pool, and $5-and-under entries when the field is huge.';
    else if (b.band === 'mid') t = 'Mid-size fields reward discipline. Pick one or two contests per slate, build around one game you believe in, and don\'t spread the same money over five contests.';
    else t = b.type === 'showdown'
      ? 'Showdown small fields are the right home. The leak is the build: captain the likely game script and avoid the lineup the whole field will have.'
      : 'Small fields are the right place to be. The leak is the build: lean on ceiling, keep your player pool tight and pass on the most popular stack.';
    if (b.fees / Math.max(1, b.n) > 20) t += ' Lower the buy-in until the results earn it back.';
    return t;
  };

  // entries (from readHistory) + sport key ('ALL' or a sport) -> the full summary the page draws.
  const analyze = (all, sport = 'ALL') => {
    const E = sport === 'ALL' ? all : all.filter(e => e.sport === sport);
    const n = E.length;
    const out = { sport, sportLabel: sportLabel(sport), n, tooFew: n < MIN_ENTRIES, early: n < EARLY_UNDER };
    if (!n) return out;
    const share = f => E.reduce((a, e) => a + (f(e) ? 1 : 0), 0) / n;
    const fees = E.reduce((a, e) => a + e.fee, 0), won = E.reduce((a, e) => a + e.won, 0);
    const avgFee = fees / n;
    const s = out.shares = {
      showdown: share(e => e.showdown), primetime: share(isPrime),
      mega: share(e => e.field >= 100000), big: share(e => e.field >= 20000 && e.field < 100000),
      mid: share(e => e.field >= 1000 && e.field < 20000), small: share(e => e.field < 1000),
      volume: share(e => e.mine >= VOLUME_AT), cash: share(isCash), single: share(e => e.single),
      satellite: share(e => e.sat), mainslate: share(isMainSlate), classic: share(e => e.classic)
    };
    out.avgFee = avgFee;
    const seasons = new Set(E.map(seasonOf).filter(v => v != null));
    out.seasons = seasons.size || 1;

    // the 8 raw scores (spec table) -> the DNA mix
    const raw = {
      primetime: (s.showdown + s.primetime) / 2,
      lottery: s.mega * (avgFee <= 5 ? 1 : 0.6),
      volume: s.volume,
      sniper: (s.small + s.single) / 2,
      grinder: s.cash,
      highroller: Math.min(1, Math.max(0, (avgFee - 5) / 20)),   // $5 or less = 0, $25+ = 1
      ticket: Math.min(1, s.satellite * 2),
      mainslate: s.mainslate
    };
    out.raw = raw;
    const ranked = ARCH.map(a => ({ ...a, raw: raw[a.id] })).sort((a, b) => b.raw - a.raw);
    const sum = ranked.reduce((a, x) => a + x.raw, 0);
    if (sum > 0) {
      const pcts = round100(ranked.map(x => x.raw));
      ranked.forEach((x, i) => { x.pct = pcts[i]; x.share = x.raw / sum; });
      out.ranked = ranked.map(({ id, name, pct, share: sh, raw: r }) => ({ id, name, pct, share: sh, raw: r }));
      const top = ranked.slice(0, 4).filter(x => x.pct > 0);
      const otherPct = 100 - top.reduce((a, x) => a + x.pct, 0);
      out.mix = top.map(x => ({ id: x.id, name: x.name, line: x.line, color: x.color, pct: x.pct }));
      if (otherPct > 0) out.mix.push({ id: 'other', name: 'Other', color: OTHER_COLOR, pct: otherPct });
      out.dominant = out.mix[0];
    } else { out.ranked = []; out.mix = []; out.dominant = null; }

    // GPP finishes
    const G = E.filter(e => isGpp(e) && e.place > 0 && e.field > 0);
    const gn = G.length;
    const t1 = G.filter(e => e.place <= topCut1(e.field)).length, t10 = G.filter(e => e.place <= topCut10(e.field)).length;
    const exp1 = gn ? G.reduce((a, e) => a + topCut1(e.field) / e.field, 0) / gn : 0.01;
    const exp10 = gn ? G.reduce((a, e) => a + topCut10(e.field) / e.field, 0) / gn : 0.10;
    out.gpp = { n: gn, top1: t1, top10: t10, rate1: gn ? t1 / gn : 0, rate10: gn ? t10 / gn : 0, exp1, exp10, meaningful: gn >= MEANINGFUL_GPP };
    out.gpp.x1 = exp1 > 0 ? out.gpp.rate1 / exp1 : 0;
    out.gpp.x10 = exp10 > 0 ? out.gpp.rate10 / exp10 : 0;

    // best finish + rarity: GPPs with a field of 1,000+; the card falls back to any GPP when there isn't one
    let best = null;
    for (const e of G) if (e.field >= 1000 && (!best || e.place / e.field < best.p)) best = { place: e.place, field: e.field, p: e.place / e.field };
    out.best = best;
    if (!best) for (const e of G) if (!out.bestAny || e.place / e.field < out.bestAny.p) out.bestAny = { place: e.place, field: e.field, p: e.place / e.field };
    const tier = best ? TIERS.find(t => best.p <= t.max) : TIERS[4];
    out.rarity = { id: tier.id, label: tier.label, color: tier.color, sub: best ? `top ${topPct(best.p)}%` : 'no big-field finish yet' };

    // leak buckets: contest type × field band × entry style
    const B = new Map();
    for (const e of E) {
      const k = `${typeOf(e)}|${bandOf(e.field)}|${styleOf(e)}`;
      let b = B.get(k);
      if (!b) B.set(k, b = { key: k, type: typeOf(e), band: bandOf(e.field), style: styleOf(e), n: 0, fees: 0, won: 0, seasons: new Set(), top1: 0 });
      b.n++; b.fees += e.fee; b.won += e.won;
      const se = seasonOf(e); if (se != null) b.seasons.add(se);
      if (isGpp(e) && e.place > 0 && e.place <= topCut1(e.field)) b.top1++;
    }
    const buckets = [...B.values()].map(b => {
      const band = BANDS.find(x => x.id === b.band), type = TYPES.find(x => x.id === b.type), style = STYLES.find(x => x.id === b.style);
      const label = `${band.label} ${type.label} ${b.type === 'sat' || b.type === 'cash' ? `(${style.label})` : style.label}`;
      const o = { key: b.key, type: b.type, band: b.band, style: b.style, label, n: b.n, fees: b.fees, won: b.won, net: b.won - b.fees, roi: b.fees > 0 ? (b.won - b.fees) / b.fees : 0, seasons: b.seasons.size || 1, top1: b.top1 };
      o.eligible = o.fees >= LEAK_MIN_FEES && o.n >= LEAK_MIN_ENTRIES;
      o.fix = fixFor(o);
      return o;
    }).sort((a, b) => (b.eligible - a.eligible) || a.roi - b.roi || b.fees - a.fees);
    out.buckets = buckets;
    const elig = buckets.filter(b => b.eligible);
    out.leak = elig.length && elig[0].roi < 0 ? elig[0] : null;
    out.leakState = !elig.length ? 'thin' : out.leak ? 'leak' : 'clean';
    out.totals = { fees, won, net: won - fees, roi: fees > 0 ? (won - fees) / fees : 0 };

    // contest-type breakdown (type × band) for members
    const T = {};
    for (const e of E) {
      const t = typeOf(e), bd = bandOf(e.field);
      const c = (T[t] = T[t] || { all: { n: 0, fees: 0, won: 0 } });
      const cell = (c[bd] = c[bd] || { n: 0, fees: 0, won: 0 });
      cell.n++; cell.fees += e.fee; cell.won += e.won; c.all.n++; c.all.fees += e.fee; c.all.won += e.won;
    }
    out.types = TYPES.filter(t => T[t.id]).map(t => ({ id: t.id, label: t.plural, cells: Object.fromEntries(['mega', 'big', 'mid', 'small', 'all'].map(k => [k, T[t.id][k] ? { ...T[t.id][k], roi: T[t.id][k].fees > 0 ? (T[t.id][k].won - T[t.id][k].fees) / T[t.id][k].fees : null } : null])) }));

    // finish distribution vs the field (GPPs): what share of your finishes land in each slice, vs the slice's size
    const SL = [[0, 0.001, 'Top 0.1%'], [0.001, 0.01, '0.1–1%'], [0.01, 0.10, '1–10%'], [0.10, 0.20, '10–20%'], [0.20, 0.50, '20–50%'], [0.50, 1.0001, 'Bottom half']];
    out.finish = SL.map(([lo, hi, label]) => ({ label, you: gn ? G.filter(e => { const p = (e.place - 0.5) / e.field; return p >= lo && p < hi; }).length / gn : 0, field: Math.min(hi, 1) - lo }));

    // facts the badges need
    out.facts = {
      sniperHit: E.some(e => e.single && isGpp(e) && e.place > 0 && e.place <= topCut1(e.field)),
      satWon: E.some(e => e.sat && e.won > 0),
      top3: (out.ranked || []).slice(0, 3).filter(x => x.raw > 0).map(x => x.id)
    };
    out.badges = badgesFor(out);
    return out;
  };

  /* ---------------- Phase-1 badges ---------------- */
  const BADGES = [
    { id: 'dna',       label: 'DNA Taken',        how: 'Check your DNA once.', color: '#D4A843' },
    { id: 'finish',    label: 'Rare finish',      how: 'A top-5% finish in a tournament of 1,000+ (Epic: top 1%, Legendary: top 0.1%).', color: '#4FB8FF' },
    { id: 'sniper',    label: 'Sniper',           how: 'A top-1% finish in a single-entry tournament.', color: ARCH_BY.sniper.color },
    { id: 'volume',    label: 'Volume Shooter',   how: 'Volume Shooter in your top 3 types.', color: ARCH_BY.volume.color },
    { id: 'primetime', label: 'Primetime Junkie', how: 'Primetime Junkie in your top 3 types.', color: ARCH_BY.primetime.color },
    { id: 'ticket',    label: 'Ticket Punched',   how: 'Win a seat (or cash) in a satellite.', color: ARCH_BY.ticket.color }
  ];
  // -> { id: true | tier id } for what this file earns
  function badgesFor(a) {
    const b = { dna: true };
    if (a.rarity && TIER_RANK[a.rarity.id] >= TIER_RANK.rare) b.finish = a.rarity.id;
    if (a.facts.sniperHit) b.sniper = true;
    if (a.facts.top3.includes('volume')) b.volume = true;
    if (a.facts.top3.includes('primetime')) b.primetime = true;
    if (a.facts.satWon) b.ticket = true;
    return b;
  }
  const badgeLabel = (id, v) => id === 'finish' ? `${(TIERS.find(t => t.id === v) || TIERS[2]).label} finish` : (BADGES.find(x => x.id === id) || {}).label;
  const badgeColor = (id, v) => id === 'finish' ? (TIERS.find(t => t.id === v) || TIERS[2]).color : (BADGES.find(x => x.id === id) || {}).color;
  // merge stored + new badges (a badge, once earned, stays; a finish keeps its best tier)
  const mergeBadges = (old, now) => {
    const m = { ...(old || {}) };
    for (const [k, v] of Object.entries(now || {})) {
      if (k === 'finish') { const o = m.finish && m.finish.v; if (!o || TIER_RANK[v] > TIER_RANK[o]) m.finish = { v, at: (m.finish && m.finish.at) || today() }; }
      else if (!m[k]) m[k] = { v: true, at: today() };
    }
    return m;
  };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  // The only thing kept between visits: no money, keys, names or contest dates.
  const snapshotOf = a => ({ at: today(), sport: a.sport, n: a.n, dominant: a.dominant ? a.dominant.id : null, rarity: a.rarity ? a.rarity.id : null, mix: Object.fromEntries((a.ranked || []).map(x => [x.id, x.pct])) });

  const DNA = { parseCsv, readHistory, analyze, money, parseDate, ordinal, topPct, round100, snapshotOf, mergeBadges, badgeLabel, badgeColor, ARCH, TIERS, BADGES, BANDS, TYPES, STYLES, DnaError, MIN_ENTRIES, EARLY_UNDER, MEANINGFUL_GPP };
  if (typeof module === 'object' && module.exports) module.exports = DNA;
  if (!root || !root.document) return;
  root.DNA = DNA;
  const BBI = root.BBI = root.BBI || {};
  BBI.dna = DNA;

  /* =================================================================
     PAGE
     ================================================================= */
  const document = root.document;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pct0 = v => `${Math.round((+v || 0) * 100)}%`;
  const pct1 = v => `${((+v || 0) * 100).toFixed(1).replace(/\.0$/, '')}%`;
  const usd = v => (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: Math.abs(v) < 100 ? 2 : 0, maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 });
  const roiTxt = r => r == null ? '—' : `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(Math.round(r * 100))}%`;
  const num = v => Math.round(v).toLocaleString('en-US');
  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const lsDel = k => { try { localStorage.removeItem(k); } catch {} };
  const lsJson = (k, d) => { try { const v = JSON.parse(lsGet(k)); return v == null ? d : v; } catch { return d; } };
  const LS_HIST = 'bbi_dna_history', LS_BADGES = 'bbi_dna_badges';
  const Q = new URLSearchParams(root.location.search);
  const MAX_BYTES = 25 * 1024 * 1024;

  const S = { hist: null, sport: null, a: null, fmt: 'portrait', cards: {}, tracked: false, prevSnap: null, badges: {} };

  /* ---------------- status + errors ---------------- */
  const setError = msg => { const el = $('dnaError'); if (!el) return; el.textContent = msg || ''; el.hidden = !msg; };
  const busy = on => { const z = $('dnaDrop'); if (z) z.classList.toggle('is-busy', !!on); const t = $('dnaDropT'); if (t) t.textContent = on ? 'Reading your file…' : 'Drop your contest history CSV here'; };

  /* ---------------- file in ---------------- */
  const readFile = f => new Promise((res, rej) => {
    if (f.text) { f.text().then(res, rej); return; }
    const r = new FileReader(); r.onload = () => res(String(r.result || '')); r.onerror = () => rej(r.error); r.readAsText(f);
  });
  const takeFile = async f => {
    if (!f) return;
    setError('');
    if (f.size > MAX_BYTES) { setError("That file is bigger than a contest history should be (over 25 MB). Check you picked the right file."); return; }
    if (f.name && !/\.(csv|txt)$/i.test(f.name) && f.type && !/csv|text|excel/i.test(f.type)) { setError("That isn't a CSV file. Download your contest history as a CSV and drop it here."); return; }
    busy(true);
    try { takeText(await readFile(f)); }
    catch (e) { setError("Your browser couldn't read that file. Try choosing it again."); }
    finally { busy(false); }
  };
  // Parse, keep the parsed entries in memory only (the raw text goes out of scope here), then draw.
  const takeText = text => {
    let hist;
    try { hist = readHistory(text); }
    catch (e) { setError(e instanceof DnaError ? e.message : "We couldn't read that file. Make sure it's the CSV straight from DraftKings."); return false; }
    S.hist = hist; S.tracked = false; S.prevSnap = null;
    const ok = hist.sports.filter(s => s.n >= MIN_ENTRIES);
    S.sport = (ok[0] || hist.sports[0]).key;
    show();
    return true;
  };

  /* ---------------- result ---------------- */
  const show = () => {
    const a = S.a = analyze(S.hist.entries, S.sport);
    S.cards = {};
    const res = $('dnaResult'); res.hidden = false;
    drawChips();
    if (a.tooFew) {
      $('dnaBody').hidden = true;
      $('dnaThin').hidden = false;
      $('dnaThin').innerHTML = `<b>We need at least ${MIN_ENTRIES} entries for a read.</b> This file has ${num(a.n)} ${a.sport === 'ALL' ? '' : esc(a.sportLabel) + ' '}entr${a.n === 1 ? 'y' : 'ies'}. ${S.hist.sports.length > 1 ? 'Try another sport above, or ' : ''}come back after a few more slates.`;
      return;
    }
    $('dnaThin').hidden = true; $('dnaBody').hidden = false;
    // re-check next month: the last different snapshot for this sport is the "before"
    const hist = lsJson(LS_HIST, {}); const list = Array.isArray(hist[a.sport]) ? hist[a.sport] : [];
    const snap = snapshotOf(a);
    const same = x => x && x.n === snap.n && JSON.stringify(x.mix) === JSON.stringify(snap.mix);
    S.prevSnap = [...list].reverse().find(x => !same(x)) || null;
    if (!same(list[list.length - 1])) { list.push(snap); hist[a.sport] = list.slice(-12); if (!S.selftest) lsSet(LS_HIST, JSON.stringify(hist)); }
    // badges: stored + this file
    S.badges = mergeBadges(lsJson(LS_BADGES, {}), a.badges);
    if (!S.selftest) lsSet(LS_BADGES, JSON.stringify(S.badges));
    if (!S.selftest && BBI.badges) BBI.badges.fromDna(a);   // Trophy Room: DNA Taken, Two-Sport, finishes, Sniper, Ticket Punched
    $('dnaEarly').hidden = !a.early;
    drawReport(a); drawBadges(); drawMember();
    drawCardPreview();
    if (!S.tracked && BBI.track) { S.tracked = true; try { BBI.track('dna_generated', { archetype: a.dominant ? a.dominant.id : 'none', rarity: a.rarity.id }); } catch {} }
    if (!S.selftest) { try { res.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); } catch {} }
  };

  const drawChips = () => {
    const box = $('dnaSports'); const sp = S.hist.sports;
    const list = sp.length > 1 ? [{ key: 'ALL', label: 'All', n: S.hist.entries.length }, ...sp] : sp;
    box.innerHTML = list.map(s => `<button type="button" class="chip" data-sport="${esc(s.key)}" aria-pressed="${s.key === S.sport}">${esc(s.key === 'ALL' ? 'All' : s.label)}<span class="count">${num(s.n)}</span></button>`).join('');
  };

  const explain = (id, a) => {
    const s = a.shares;
    switch (id) {
      case 'primetime': return (a.sport === 'NFL' || a.sport === 'ALL') ? `${pct0(s.showdown)} of your entries are showdowns and ${pct0(s.primetime)} lock under the lights (night games, plus every Monday and Thursday). You play the games everyone is watching.` : `${pct0(s.showdown)} of your entries are single-game showdowns. You play the games everyone is watching.`;
      case 'lottery': return `${pct0(s.mega)} of your entries go into fields of 100,000 or more, at ${usd(a.avgFee)} a ticket on average. You're chasing the life-changing number.`;
      case 'volume': return `${pct0(s.volume)} of your entries sit in contests where you have ${VOLUME_AT} or more lineups. You'd rather cover the outcomes than bet on one.`;
      case 'sniper': return `${pct0(s.small)} of your entries are in fields under 1,000 and ${pct0(s.single)} are single-entry contests. Fewer rivals, one lineup each.`;
      case 'grinder': return `${pct0(s.cash)} of your entries are cash games: double-ups, 50/50s and head-to-heads, where half the field gets paid.`;
      case 'highroller': return `Your average buy-in is ${usd(a.avgFee)}. The higher the fee, the sharper the room tends to be.`;
      case 'ticket': return `${pct0(s.satellite)} of your entries are satellites and qualifiers: you play for seats in bigger contests.`;
      case 'mainslate': return `${pct0(s.mainslate)} of your entries are classic contests that lock Sunday at 1 pm ET, the main slate.`;
      default: return '';
    }
  };

  const drawReport = a => {
    const top3 = (a.mix || []).filter(m => m.id !== 'other').slice(0, 3);
    $('dnaMixList').innerHTML = top3.map(m => `<li style="--c:${m.color}"><div class="dna-mix-h"><span class="dna-dot" aria-hidden="true"></span><b>The ${esc(m.name)}</b><span class="dna-mix-p num">${m.pct}%</span></div><p>${esc(explain(m.id, a))}</p></li>`).join('');
    const g = a.gpp;
    $('dnaFinish').innerHTML = !g.n ? `<p class="dna-muted">No tournament (GPP) finishes in this file yet.</p>` : `
      <div class="dna-vs">
        <div class="dna-vs-row"><span class="dna-vs-k">Top 1%</span><span class="dna-vs-you num">${pct1(g.rate1)}</span><span class="dna-vs-exp">vs ${pct1(g.exp1)} expected</span>${g.meaningful ? `<span class="dna-vs-x ${g.x1 >= 1 ? 'up' : 'down'}">${g.x1.toFixed(1)}× the field</span>` : ''}</div>
        <div class="dna-vs-row"><span class="dna-vs-k">Top 10%</span><span class="dna-vs-you num">${pct1(g.rate10)}</span><span class="dna-vs-exp">vs ${pct1(g.exp10)} expected</span>${g.meaningful ? `<span class="dna-vs-x ${g.x10 >= 1 ? 'up' : 'down'}">${g.x10.toFixed(1)}× the field</span>` : ''}</div>
      </div>
      <p class="dna-muted">${g.meaningful ? `From ${num(g.n)} tournament entries. "Expected" is what a random lineup would hit in the same contests.` : `From ${num(g.n)} tournament entries: we need ${MEANINGFUL_GPP} or more before the rate means much. Need more entries.`}</p>`;
    const L = $('dnaLeak');
    if (a.leakState === 'thin') L.innerHTML = `<p class="dna-leak-t">Not enough volume yet</p><p class="dna-muted">A leak needs a bucket with at least $${LEAK_MIN_FEES} in fees and ${LEAK_MIN_ENTRIES} entries. Come back once you've played more.</p>`;
    else if (a.leakState === 'clean') L.innerHTML = `<p class="dna-leak-t">No leak found</p><p class="dna-muted">Every bucket with real volume is in the green. Keep doing what you're doing, and keep the stake steady.</p>`;
    else {
      const b = a.leak;
      L.innerHTML = `<p class="dna-leak-t">${esc(b.label.charAt(0).toUpperCase() + b.label.slice(1))}: <span class="dna-neg">${roiTxt(b.roi)}</span> over ${b.seasons} season${b.seasons === 1 ? '' : 's'}</p>
        <p class="dna-leak-meta num">${num(b.n)} entries · ${usd(b.fees)} in fees</p>
        <p class="dna-leak-fix"><b>Fix:</b> ${esc(b.fix)}</p>`;
    }
  };

  const drawBadges = () => {
    $('dnaBadges').innerHTML = BADGES.map(b => {
      const got = S.badges[b.id], v = got && got.v;
      const label = b.id === 'finish' && v ? badgeLabel('finish', v) : b.label, color = b.id === 'finish' && v ? badgeColor('finish', v) : b.color;
      return `<li class="dna-badge ${got ? 'is-on' : ''}" style="--c:${color}"><span class="dna-badge-ic" aria-hidden="true"></span><span class="dna-badge-t"><b>${esc(label)}</b><small>${got ? `Earned ${esc(got.at)}` : esc(b.how)}</small></span><span class="sr-only">${got ? 'earned' : 'not earned yet'}</span></li>`;
    }).join('');
  };

  /* ---------------- members ---------------- */
  const isMember = () => { try { return !!(BBI.auth && BBI.auth.isMember()); } catch { return false; } };
  const memberHtml = a => {
    const rows = a.buckets.filter(b => b.n > 0);
    const leakRows = rows.map(b => `<tr class="${b.eligible ? '' : 'is-thin'}"><th scope="row">${esc(b.label.charAt(0).toUpperCase() + b.label.slice(1))}${b.eligible ? '' : ' <small>(small sample)</small>'}</th><td class="num" data-k="Entries">${num(b.n)}</td><td class="num" data-k="Fees">${usd(b.fees)}</td><td class="num ${b.roi < 0 ? 'dna-neg' : 'dna-pos'}" data-k="ROI">${roiTxt(b.roi)}</td><td class="dna-fix-c">${b.roi < 0 ? esc(b.fix) : '<span class="dna-muted">Working. Keep it.</span>'}</td></tr>`).join('');
    const cell = c => c ? `<span class="num">${num(c.n)}</span><small class="${c.roi < 0 ? 'dna-neg' : 'dna-pos'}">${roiTxt(c.roi)}</small>` : '<span class="dna-muted">·</span>';
    const typeRows = a.types.map(t => `<tr><th scope="row">${esc(t.label)}</th>${['mega', 'big', 'mid', 'small', 'all'].map(k => `<td>${cell(t.cells[k])}</td>`).join('')}</tr>`).join('');
    const maxF = Math.max(...a.finish.map(f => Math.max(f.you, f.field)), 0.01);
    const fin = a.finish.map(f => `<div class="dna-fd-row"><span class="dna-fd-k">${esc(f.label)}</span><span class="dna-fd-bars"><span class="dna-fd-you" style="width:${(f.you / maxF * 100).toFixed(1)}%"></span><span class="dna-fd-field" style="width:${(f.field / maxF * 100).toFixed(1)}%"></span></span><span class="dna-fd-v num">${pct1(f.you)} <small>vs ${pct1(f.field)}</small></span></div>`).join('');
    const prev = S.prevSnap;
    const shift = !prev ? `<p class="dna-muted">Saved today's read on this device. Come back next month with a fresh file and we'll show how your DNA shifted.</p>` : (() => {
      const now = Object.fromEntries((a.ranked || []).map(x => [x.id, x.pct]));
      const d = ARCH.map(x => ({ x, d: (now[x.id] || 0) - (prev.mix[x.id] || 0) })).filter(r => r.d !== 0).sort((p, q) => Math.abs(q.d) - Math.abs(p.d)).slice(0, 4);
      return `<p class="dna-muted">Since your read on ${esc(prev.at)} (${num(prev.n)} entries then, ${num(a.n)} now):</p>
        <ul class="dna-shift">${d.length ? d.map(r => `<li style="--c:${r.x.color}"><span class="dna-dot" aria-hidden="true"></span>${esc(r.x.name)} <b class="${r.d > 0 ? 'dna-pos' : 'dna-neg'}">${r.d > 0 ? '+' : '−'}${Math.abs(r.d)} pts</b></li>`).join('') : '<li>No change in your mix.</li>'}</ul>
        ${prev.dominant !== (a.dominant && a.dominant.id) && prev.dominant ? `<p>You were <b>The ${esc(ARCH_BY[prev.dominant].name)}</b>. Now you're <b>The ${esc(a.dominant.name)}</b>.</p>` : ''}`;
    })();
    return `
      <div class="dna-m-block"><h3>Every leak, with the fix</h3>
        <div class="dna-scroll"><table class="dna-table dna-leaks"><thead><tr><th scope="col">Bucket</th><th scope="col">Entries</th><th scope="col">Fees</th><th scope="col">ROI</th><th scope="col">Fix</th></tr></thead><tbody>${leakRows}</tbody></table></div>
        <p class="dna-muted">Buckets = contest type × field size × how many lineups you had in the contest. ROI only counts once a bucket has $${LEAK_MIN_FEES} in fees and ${LEAK_MIN_ENTRIES} entries.</p></div>
      <div class="dna-m-block"><h3>Contest-type breakdown</h3>
        <div class="dna-scroll"><table class="dna-table dna-grid-t"><thead><tr><th scope="col">Type</th><th scope="col">100k+</th><th scope="col">20k–100k</th><th scope="col">1k–20k</th><th scope="col">Under 1k</th><th scope="col">All</th></tr></thead><tbody>${typeRows}</tbody></table></div>
        <p class="dna-muted">Entries, then ROI, for each field size.</p></div>
      <div class="dna-m-block"><h3>Finish distribution vs the field</h3>
        <div class="dna-fd" role="img" aria-label="Your tournament finishes by slice, against the slice's share of the field">${fin}</div>
        <p class="dna-legend"><span class="dna-key you"></span>You <span class="dna-key field"></span>A random lineup</p></div>
      <div class="dna-m-block"><h3>What winners do differently</h3>
        <ul class="dna-rules">
          <li><b>Field-size discipline.</b> The smaller the field, the fewer lineups you have to beat. Our system leans toward small fields and single-entry contests, and treats giant fields as cheap, wide entries rather than big single shots.</li>
          <li><b>Concentrate, don't spray.</b> One or two contests per slate, built around one game you believe in, beats ten contests with the same five lineups.</li>
          <li><b>Play the Milly as $5 volume, not $100 singles.</b> If you want the big prize, buy many cheap tickets in one contest instead of one expensive one.</li>
          <li><b>Showdown small fields.</b> Single-game contests are where one good read pays: keep them small and play the primetime games with a plan.</li>
          <li><b>Same stake every week.</b> Pick a weekly number you can afford to lose and stick to it, win or lose.</li>
        </ul></div>
      <div class="dna-m-block"><h3>Re-check next month</h3>${shift}</div>`;
  };
  // Non-members get a decorative stand-in (never their real member numbers), blurred by auth.js with the upgrade card on top.
  const teaserHtml = () => `
      <div class="dna-m-block" aria-hidden="true"><h3>Every leak, with the fix</h3>
        <div class="dna-scroll"><table class="dna-table"><thead><tr><th>Bucket</th><th>Entries</th><th>Fees</th><th>ROI</th><th>Fix</th></tr></thead><tbody>
        ${['Big-field showdown volume', 'Mid-field classic multi-entry', 'Mega-field classic single shots', 'Small-field showdown single shots', 'Cash games (single shots)'].map((l, i) => `<tr><th>${l}</th><td>${[412, 188, 96, 61, 40][i]}</td><td>$•••</td><td class="${i < 3 ? 'dna-neg' : 'dna-pos'}">${i < 3 ? '−' : '+'}••%</td><td>Play the big fields cheap and wide, keep the rest small and concentrated.</td></tr>`).join('')}
        </tbody></table></div></div>
      <div class="dna-m-block" aria-hidden="true"><h3>Contest-type breakdown</h3><div class="dna-fake-grid"></div></div>
      <div class="dna-m-block" aria-hidden="true"><h3>Finish distribution vs the field</h3><div class="dna-fake-bars"></div></div>
      <div class="dna-m-block" aria-hidden="true"><h3>What winners do differently</h3><p>Field-size discipline, concentration and the stake rules our system plays by.</p></div>
      <div class="dna-m-block" aria-hidden="true"><h3>Re-check next month</h3><p>How your DNA shifted since last time.</p></div>`;
  const drawMember = () => {
    const body = $('dnaMemberBody'); if (!body || !S.a || S.a.tooFew) return;
    const m = isMember();
    body.innerHTML = m ? memberHtml(S.a) : teaserHtml();
    body.dataset.member = m ? '1' : '0';
  };
  // auth.js loads async (brand.js injects it): redraw when it lands and when the visitor signs in/out.
  const watchAuth = () => {
    const t0 = Date.now();
    const poll = () => {
      const au = BBI.auth;
      if (au && au.onChange) { au.onChange(() => setTimeout(drawMember, 0)); drawMember(); return; }
      if (Date.now() - t0 < 20000) setTimeout(poll, 250);
      else { const f = $('dnaGateFallback'); if (f) f.hidden = false; }   // no auth.js: a plain pricing link instead of the overlay
    };
    poll();
  };

  /* =================================================================
     SHARE CARD
     Portrait 1080×1350 and landscape 1200×630, drawn on an offscreen canvas in
     the browser (same family as the Lab card): nothing is uploaded and nothing
     is fetched beyond the site's own mark. Never on the card: ROI, money,
     contest dates or keys.
     ================================================================= */
  const SIZES = { portrait: [1080, 1350], landscape: [1200, 630] };
  const CK = { bg: '#0a0a0f', card: '#141419', sunk: '#101017', chip: '#1c1c24', gold: '#d4a843', ink: '#f4f4f8', body: '#c0c0cc', muted: '#8a8a98', dim: '#5a5a68' };
  const C_SANS = "'Inter', -apple-system, 'Segoe UI', Helvetica, sans-serif", C_MONO = "'JetBrains Mono', Menlo, monospace";
  const CARD_FONTS = ['800 120px Inter', '700 26px Inter', '600 26px Inter', '500 30px Inter', '600 16px "JetBrains Mono"', '700 26px "JetBrains Mono"', '400 16px "JetBrains Mono"'];
  let markP = null;
  // The brand mark is the site's own file (assets/img/mark-gold.svg), never redrawn; no mark if it can't load.
  const cardMark = () => markP || (markP = new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = 'assets/img/mark-gold.svg'; }));
  const rgba = (hex, a) => { const h = hex.replace('#', ''); const v = parseInt(h.length === 3 ? h.replace(/./g, c => c + c) : h, 16); return `rgba(${v >> 16 & 255},${v >> 8 & 255},${v & 255},${a})`; };

  // the card's content, from an analysis + the badges earned so far (no money anywhere in here)
  const cardData = a => {
    const best = a.best || a.bestAny;
    const g = a.gpp;
    const badges = BADGES.filter(b => S.badges[b.id]).map(b => ({ label: badgeLabel(b.id, S.badges[b.id].v), color: badgeColor(b.id, S.badges[b.id].v) }));
    return {
      sport: a.sport === 'ALL' ? 'ALL SPORTS' : a.sportLabel.toUpperCase(), n: a.n, early: a.early,
      dom: a.dominant || { name: 'Wildcard', line: 'No single habit runs your game.', color: CK.gold, pct: 0 },
      mix: a.mix || [], rarity: a.rarity,
      stats: [
        ['Best finish', best ? ordinal(best.place) : '—', best ? `of ${num(best.field)}` : 'no tournament finish yet'],
        g.meaningful ? ['Top-1% rate', `${g.x1.toFixed(1)}×`, 'vs the field'] : ['Top-1% finishes', num(g.top1), `in ${num(g.n)} tournament entries`],
        ['Entries', num(a.n), `${a.seasons} season${a.seasons === 1 ? '' : 's'}`]
      ],
      badges
    };
  };

  const drawCard = async (d, fmt) => {
    try { await Promise.all(CARD_FONTS.map(f => document.fonts.load(f))); } catch {}
    try { await document.fonts.ready; } catch {}
    const mark = await cardMark();
    const [W, H] = SIZES[fmt], P = fmt === 'portrait' ? 72 : 56, IW = W - P * 2, port = fmt === 'portrait';
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const font = (o = {}) => `${o.weight || 400} ${o.size || 14}px ${o.mono ? C_MONO : C_SANS}`;
    const fit = (t, maxW, o) => { t = String(t ?? ''); g.font = font(o); if (g.measureText(t).width <= maxW) return t; while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; };
    const LS = 'letterSpacing' in g;   // tracking on the mono labels where the browser supports it
    const txt = (t, x, y, o = {}) => { g.font = font(o); g.fillStyle = o.color || CK.ink; g.textAlign = o.align || 'left'; g.textBaseline = 'alphabetic'; if (LS) g.letterSpacing = o.ls || '0px'; g.fillText(o.maxW ? fit(t, o.maxW, o) : String(t ?? ''), x, y); if (LS) g.letterSpacing = '0px'; };
    const measure = (t, o = {}) => { g.font = font(o); t = String(t ?? ''); return g.measureText(t).width + (LS && o.ls ? parseFloat(o.ls) * t.length : 0); };
    const lines = (t, maxW, o) => {   // word wrap -> array of lines
      g.font = font(o); const out = []; let line = '';
      for (const w of String(t ?? '').split(' ').filter(Boolean)) { const test = line ? `${line} ${w}` : w; if (g.measureText(test).width <= maxW || !line) line = test; else { out.push(line); line = w; } }
      if (line) out.push(line); return out;
    };
    const rr = (x, y, w, h, r, fill, stroke, lw = 1) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); } };
    const acc = d.dom.color;

    // background: page color, a gold glow top-left, the dominant type's glow on the right, a gold rule on top
    g.fillStyle = CK.bg; g.fillRect(0, 0, W, H);
    let gl = g.createRadialGradient(0, 0, 0, 0, 0, W * 0.85); gl.addColorStop(0, 'rgba(212,168,67,0.12)'); gl.addColorStop(1, 'rgba(212,168,67,0)'); g.fillStyle = gl; g.fillRect(0, 0, W, H);
    gl = g.createRadialGradient(W, port ? 380 : 120, 0, W, port ? 380 : 120, port ? 720 : 560); gl.addColorStop(0, rgba(acc, 0.20)); gl.addColorStop(1, rgba(acc, 0)); g.fillStyle = gl; g.fillRect(0, 0, W, H);
    g.fillStyle = CK.gold; g.fillRect(0, 0, W, port ? 8 : 6);

    // a faint double helix in the mix colors (decoration only: the right-hand band beside the hero)
    const helix = (cx, y0, y1, amp, dotR) => {
      const cols = d.mix.length ? d.mix.map(m => m.color) : [CK.gold];
      const steps = Math.floor((y1 - y0) / (dotR * 3.4));
      for (let i = 0; i <= steps; i++) {
        const y = y0 + i * (y1 - y0) / steps, ph = i * 0.42, sx = Math.sin(ph), z = Math.cos(ph);
        const c = cols[i % cols.length];
        if (i % 2 === 0) { g.strokeStyle = rgba(c, 0.10); g.lineWidth = 2; g.beginPath(); g.moveTo(cx - amp * sx, y); g.lineTo(cx + amp * sx, y); g.stroke(); }
        g.fillStyle = rgba(c, 0.16 + 0.16 * (z + 1) / 2); g.beginPath(); g.arc(cx + amp * sx, y, dotR * (0.8 + 0.25 * (z + 1) / 2), 0, Math.PI * 2); g.fill();
        g.fillStyle = rgba(c, 0.16 + 0.16 * (1 - z) / 2); g.beginPath(); g.arc(cx - amp * sx, y, dotR * (0.8 + 0.25 * (1 - z) / 2), 0, Math.PI * 2); g.fill();
      }
    };

    // header: mark + name (left), sport + entries (right)
    const hdr = port ? { mh: 46, my: 52, name: 36, ny: 90, sub: 16, sy: 118, rs: 16, ry: 82, rv: 26, rvy: 116, div: 150 } : { mh: 38, my: 32, name: 28, ny: 62, sub: 13, sy: 84, rs: 13, ry: 54, rv: 20, rvy: 82, div: 112 };
    let bx = P;
    if (mark && mark.naturalWidth) { const h = hdr.mh, w = h * mark.naturalWidth / mark.naturalHeight; g.drawImage(mark, P, hdr.my, w, h); bx = P + w + 14; }
    txt('BirdieBuddy', bx, hdr.ny, { size: hdr.name, weight: 800 });
    txt('DFS DNA', bx, hdr.sy, { mono: true, size: hdr.sub, weight: 600, color: CK.gold, ls: '2px' });
    txt(d.sport, W - P, hdr.ry, { mono: true, size: hdr.rs, weight: 600, color: CK.gold, align: 'right', ls: '2px' });
    txt(`${num(d.n)} entries`, W - P, hdr.rvy, { size: hdr.rv, weight: 700, align: 'right' });
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(P, hdr.div, IW, 1);

    if (port) helix(W - P - 70, 196, 700, 44, 7);

    // hero: "my DFS DNA says I'm" / The / NAME / one-liner / rarity
    const heroW = port ? 790 : 520;
    const k = port ? { eyebrow: 20, ey: 214, the: 46, ty: 280, nameMax: 136, nameMin: 70, line: 34, lineLh: 46 } : { eyebrow: 14, ey: 152, the: 28, ty: 188, nameMax: 58, nameMin: 38, line: 20, lineLh: 27 };
    let ns = k.nameMax, nl;
    for (; ns >= k.nameMin; ns -= 2) { nl = lines(d.dom.name, heroW, { size: ns, weight: 800 }); if (nl.length <= 2 && nl.every(l => measure(l, { size: ns, weight: 800 }) <= heroW)) break; }
    const off = port && nl.length < 2 ? Math.round(ns * 0.5) : 0;   // a one-line name sits a little lower, so the hero stays centred
    txt(`MY DFS DNA SAYS I'M${d.dom.pct ? ` · ${d.dom.pct}%` : ''}`, P, k.ey + off, { mono: true, size: k.eyebrow, weight: 700, color: acc, ls: '2px' });
    txt('The', P, k.ty + off, { size: k.the, weight: 600, color: CK.body });
    let y = k.ty + off;
    nl.slice(0, 2).forEach(l => { y += ns * 1.0; txt(l, P - ns * 0.04, y, { size: ns, weight: 800, maxW: heroW }); });
    // a short accent underline under the name
    g.fillStyle = acc; g.fillRect(P, y + (port ? 26 : 16), port ? 120 : 72, port ? 6 : 4);
    y += port ? 26 + 6 : 16 + 4;
    const ol = lines(d.dom.line, heroW, { size: k.line, weight: 500 }).slice(0, port ? 2 : 1);
    ol.forEach(l => { y += k.lineLh + (port ? 8 : 4); txt(l, P, y, { size: k.line, weight: 500, color: CK.body, maxW: heroW }); });

    // rarity badge: a gem + tier name + the finish it comes from
    const rar = (x, top, s) => {
      const r = d.rarity, c = r.color, h = 64 * s, legend = r.id === 'legendary';
      const t1 = `${r.label.toUpperCase()} FINISH`, t2 = r.sub, o1 = { mono: true, size: 21 * s, weight: 700, color: c, ls: `${1.5 * s}px` };
      const w1 = measure(t1, o1), w = 64 * s + w1 + 18 * s + measure(t2, { size: 21 * s, weight: 600 }) + 30 * s;
      g.save();
      if (legend) { g.shadowColor = 'rgba(212,168,67,0.45)'; g.shadowBlur = 28 * s; }
      rr(x, top, w, h, h / 2, rgba(c, legend ? 0.16 : 0.12), rgba(c, 0.75), 2 * s);
      g.restore();
      // gem: a faceted diamond (rotated square with a highlight)
      const gx = x + 34 * s, gy = top + h / 2, gr = 15 * s;
      g.beginPath(); g.moveTo(gx, gy - gr); g.lineTo(gx + gr, gy); g.lineTo(gx, gy + gr); g.lineTo(gx - gr, gy); g.closePath();
      if (legend) { const lg = g.createLinearGradient(gx - gr, gy - gr, gx + gr, gy + gr); lg.addColorStop(0, '#f9e9a8'); lg.addColorStop(0.5, '#d4a843'); lg.addColorStop(1, '#8a6e2a'); g.fillStyle = lg; } else g.fillStyle = c;
      g.fill();
      g.beginPath(); g.moveTo(gx, gy - gr); g.lineTo(gx + gr * 0.45, gy); g.lineTo(gx, gy + gr * 0.2); g.lineTo(gx - gr * 0.45, gy); g.closePath(); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fill();
      txt(t1, x + 64 * s, top + h / 2 + 7.5 * s, o1);
      txt(t2, x + 64 * s + w1 + 18 * s, top + h / 2 + 7.5 * s, { size: 21 * s, weight: 600, color: CK.ink });
      return h;
    };
    rar(P, y + (port ? 34 : 18), port ? 1 : 0.68);

    // the mix: an ancestry-style stacked bar + legend
    const M = port ? { x: P, w: IW, ly: 790, by: 812, bh: 92, br: 24, gy: 960, rowH: 60, sw: 20, ns: 27, pctS: 27, cols: 2 } : { x: 620, w: W - P - 620, ly: 152, by: 168, bh: 60, br: 16, gy: 268, rowH: 40, sw: 14, ns: 18, pctS: 18, cols: 2 };
    txt('MY MIX', M.x, M.ly, { mono: true, size: port ? 16 : 13, weight: 600, color: CK.dim, ls: '2px' });
    txt('TOP 4 OF 8 TYPES', M.x + M.w, M.ly, { mono: true, size: port ? 14 : 11, color: CK.dim, align: 'right', ls: '1px' });
    g.save(); g.beginPath(); if (g.roundRect) g.roundRect(M.x, M.by, M.w, M.bh, M.br); else g.rect(M.x, M.by, M.w, M.bh); g.clip();
    g.fillStyle = CK.sunk; g.fillRect(M.x, M.by, M.w, M.bh);
    const gap = port ? 5 : 4, segs = d.mix.filter(m => m.pct > 0), avail = M.w - gap * Math.max(0, segs.length - 1);
    let sx = M.x;
    segs.forEach((m, i) => {
      const w = i === segs.length - 1 ? M.x + M.w - sx : Math.round(avail * m.pct / 100);
      const sg = g.createLinearGradient(0, M.by, 0, M.by + M.bh); sg.addColorStop(0, m.color); sg.addColorStop(1, rgba(m.color, 0.78));
      g.fillStyle = sg; g.fillRect(sx, M.by, w, M.bh);
      g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(sx, M.by, w, M.bh * 0.42);   // a soft sheen on the top
      const label = `${m.pct}%`;
      if (w >= measure(label, { mono: true, size: port ? 26 : 17, weight: 700 }) + 24) txt(label, sx + 16 * (port ? 1 : 0.7), M.by + M.bh / 2 + (port ? 9 : 6), { mono: true, size: port ? 26 : 17, weight: 700, color: m.id === 'other' ? CK.body : '#0a0a0f' });
      sx += w + gap;
    });
    g.restore();
    const legend = d.mix.filter(m => m.id !== 'other').slice(0, 4), cw = (M.w - (port ? 32 : 20)) / 2;
    legend.forEach((m, i) => {
      const cx = M.x + (i % 2) * (cw + (port ? 32 : 20)), cy = M.gy + Math.floor(i / 2) * M.rowH;
      rr(cx, cy - M.sw + 2, M.sw, M.sw, port ? 6 : 4, m.color);
      txt(m.name, cx + M.sw + (port ? 14 : 10), cy, { size: M.ns, weight: 600, color: i === 0 ? CK.ink : CK.body, maxW: cw - M.sw - (port ? 90 : 62) });
      txt(`${m.pct}%`, cx + cw, cy, { mono: true, size: M.pctS, weight: 700, color: i === 0 ? m.color : CK.ink, align: 'right' });
    });

    // three stat tiles
    const T = port ? { y: 1116, h: 140, gap: 20, k: 15, ky: 38, v: 52, vy: 96, s: 19, sy: 124 } : { y: 434, h: 102, gap: 16, k: 12, ky: 28, v: 38, vy: 69, s: 14, sy: 90 };
    const tw = (IW - T.gap * 2) / 3;
    d.stats.forEach((t, i) => {
      const x = P + i * (tw + T.gap);
      rr(x, T.y, tw, T.h, port ? 18 : 14, CK.card, i === 0 && d.rarity.id === 'legendary' ? 'rgba(212,168,67,0.55)' : 'rgba(212,168,67,0.22)', port ? 1.5 : 1);
      txt(t[0].toUpperCase(), x + (port ? 24 : 18), T.y + T.ky, { mono: true, size: T.k, weight: 600, color: CK.dim, maxW: tw - 40, ls: '1px' });
      txt(t[1], x + (port ? 24 : 18), T.y + T.vy, { size: String(t[1]).length > 7 ? T.v * 0.8 : T.v, weight: 800, maxW: tw - 40 });
      txt(t[2], x + (port ? 24 : 18), T.y + T.sy, { mono: true, size: T.s, color: CK.muted, maxW: tw - 40 });
    });

    // badge row (Phase-1 badges earned so far)
    const BR = port ? { x: P, y: 1050, maxX: W - P } : { x: 620, y: 352, maxX: W - P };   // portrait: under the legend, above the tiles
    const bh = port ? 42 : 30, bs = port ? 18 : 13;
    let px = BR.x, shown = 0;
    for (const b of d.badges) {
      const w = measure(b.label, { size: bs, weight: 600 }) + (port ? 46 : 34);
      const left = d.badges.length - shown - 1, more = left > 0 ? measure(`+${left}`, { mono: true, size: bs, weight: 600 }) + 30 : 0;
      if (px + w + more > BR.maxX && shown) { txt(`+${d.badges.length - shown}`, px + 6, BR.y + bh / 2 + bs * 0.36, { mono: true, size: bs, weight: 600, color: CK.muted }); break; }
      rr(px, BR.y, w, bh, bh / 2, rgba(b.color, 0.10), rgba(b.color, 0.55), port ? 1.5 : 1);
      g.fillStyle = b.color; g.beginPath(); g.arc(px + (port ? 20 : 15), BR.y + bh / 2, port ? 6 : 4.5, 0, Math.PI * 2); g.fill();
      txt(b.label, px + (port ? 34 : 25), BR.y + bh / 2 + bs * 0.36, { size: bs, weight: 600, color: CK.ink });
      px += w + (port ? 10 : 8); shown++;
    }

    // footer
    const fy = port ? 1280 : 556;
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(P, fy, IW, 1);
    txt('Check your DFS DNA · birdiebuddy.io/dna', P, fy + (port ? 44 : 38), { mono: true, size: port ? 24 : 18, weight: 600, color: CK.gold });
    if (d.early) txt('EARLY READ', W - P, fy + (port ? 44 : 38), { mono: true, size: port ? 16 : 13, weight: 600, color: CK.muted, align: 'right', ls: '2px' });
    return cv;
  };
  const cardBlob = cv => new Promise(res => { try { cv.toBlob(res, 'image/png'); } catch { res(null); } });
  const canCopyImg = () => !!(navigator.clipboard && navigator.clipboard.write && root.ClipboardItem);
  const canShareFile = f => { try { return !!(f && navigator.share && navigator.canShare && navigator.canShare({ files: [f] })); } catch { return false; } };

  // -> {canvas, blob, file, name, alt} for the current analysis in one format (cached per sport + format)
  const renderCard = async fmt => {
    const a = S.a; if (!a || a.tooFew) return null;
    const key = `${a.sport}|${fmt}`;
    if (S.cards[key]) return S.cards[key];
    const d = cardData(a);
    const canvas = await drawCard(d, fmt), blob = await cardBlob(canvas);
    const name = `birdiebuddy-dfs-dna-${a.sport.toLowerCase()}-${fmt}.png`;
    let file = null; try { file = blob ? new File([blob], name, { type: 'image/png' }) : null; } catch {}
    const alt = `DFS DNA card: The ${d.dom.name}. Mix: ${d.mix.map(m => `${m.name} ${m.pct}%`).join(', ')}. ${d.rarity.label} finish (${d.rarity.sub}). ${d.stats.map(s => `${s[0]} ${s[1]} ${s[2]}`).join('; ')}.`;
    return (S.cards[key] = { canvas, blob, file, name, alt, url: blob ? URL.createObjectURL(blob) : '' });
  };
  const cardStatus = t => { const s = $('dnaCardSt'); if (s) s.textContent = t; };
  let drawSeq = 0;
  const drawCardPreview = async () => {
    const img = $('dnaCardImg'), wait = $('dnaCardWait'), well = $('dnaCardPrev');
    const fmt = S.fmt, seq = ++drawSeq;
    well.dataset.fmt = fmt;
    img.hidden = true; wait.hidden = false; wait.textContent = 'Drawing your card…'; cardStatus('');
    document.querySelectorAll('[data-fmt]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.fmt === fmt)));
    const acts = document.querySelectorAll('[data-card-act]'); acts.forEach(b => { b.disabled = true; });
    const r = await renderCard(fmt);
    if (seq !== drawSeq) return;
    if (!r || !r.blob) { wait.textContent = "Your browser couldn't draw the card."; return; }
    const [w, h] = SIZES[fmt]; img.width = w; img.height = h;
    img.src = r.url; img.alt = r.alt; img.hidden = false; wait.hidden = true;
    const share = document.querySelector('[data-card-act="share"]'), copy = document.querySelector('[data-card-act="copy"]');
    share.hidden = !canShareFile(r.file); copy.hidden = !canCopyImg();
    acts.forEach(b => { b.disabled = false; });
  };
  const hypeMan = () => { if (BBI.badges) BBI.badges.earn('hype_man'); };   // Trophy Room: Hype Man
  const cardAct = async act => {
    const r = S.a && S.cards[`${S.a.sport}|${S.fmt}`]; if (!r || !r.blob) return;
    if (act === 'download') {
      const a = document.createElement('a'); a.href = URL.createObjectURL(r.blob); a.download = r.name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      cardStatus('Downloaded.'); hypeMan(); return;
    }
    if (act === 'copy') {
      try { await navigator.clipboard.write([new root.ClipboardItem({ 'image/png': r.blob })]); cardStatus('Image copied: paste it into a post or a message.'); hypeMan(); }
      catch { cardStatus('Your browser blocked the copy: use Download PNG instead.'); }
      return;
    }
    if (act === 'share') {
      try { await navigator.share({ files: [r.file], title: 'My DFS DNA', text: 'Check your DFS DNA · birdiebuddy.io/dna' }); cardStatus('Shared.'); hypeMan(); }
      catch (e) { cardStatus(e && e.name === 'AbortError' ? '' : "Sharing didn't work here: use Download PNG instead."); }
    }
  };

  /* ---------------- reset ---------------- */
  const reset = () => {
    S.hist = null; S.a = null; S.cards = {};
    $('dnaResult').hidden = true; setError('');
    const inp = $('dnaFile'); if (inp) inp.value = '';
    try { $('dnaHero').scrollIntoView({ block: 'start' }); } catch {}
    const z = $('dnaFile'); if (z) z.focus({ preventScroll: true });
  };
  const forget = () => {
    lsDel(LS_HIST); lsDel(LS_BADGES); S.badges = S.a ? mergeBadges({}, S.a.badges) : {}; S.prevSnap = null;
    if (S.a && !S.a.tooFew) { drawBadges(); drawMember(); S.cards = {}; drawCardPreview(); }
    const f = $('dnaForgetSt'); if (f) f.textContent = 'Saved reads and badges cleared from this device.';
  };

  /* ---------------- sample ---------------- */
  const SAMPLE = 'dna/sample_history.csv?v=20261105b';
  const loadSample = async (src = SAMPLE) => {
    setError(''); busy(true);
    try { const r = await fetch(src, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); return takeText(await r.text()); }
    catch { setError("Couldn't load the sample just now. Try again in a moment."); return false; }
    finally { busy(false); }
  };

  /* ---------------- wiring ---------------- */
  const bind = () => {
    const inp = $('dnaFile'), zone = $('dnaDrop');
    inp.addEventListener('change', () => { if (inp.files && inp.files[0]) takeFile(inp.files[0]); });
    // the zone is a big target for a mouse or tap; keyboard users get the real file input (focusable) inside it
    zone.addEventListener('click', e => { if (e.target.closest('button, a, label, input')) return; inp.click(); });
    let depth = 0;
    const over = on => zone.classList.toggle('is-over', on);
    document.addEventListener('dragenter', e => { if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) { depth++; over(true); } });
    document.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) over(false); });
    document.addEventListener('dragover', e => { if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    document.addEventListener('drop', e => {
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault(); depth = 0; over(false); takeFile(e.dataTransfer.files[0]);
    });
    $('dnaSample').addEventListener('click', () => loadSample());
    document.addEventListener('click', e => {
      const sp = e.target.closest('[data-sport]');
      if (sp && S.hist) { S.sport = sp.dataset.sport; S.tracked = true; show(); const b = document.querySelector(`[data-sport="${CSS.escape(S.sport)}"]`); if (b) b.focus({ preventScroll: true }); return; }
      const f = e.target.closest('[data-fmt]');
      if (f && S.a) { S.fmt = f.dataset.fmt; drawCardPreview(); return; }
      const c = e.target.closest('[data-card-act]'); if (c) { cardAct(c.dataset.cardAct); return; }
      if (e.target.closest('[data-dna="again"]')) { reset(); return; }
      if (e.target.closest('[data-dna="forget"]')) forget();
    });
  };

  /* ?selftest=dna (a check, not a feature): runs the bundled synthetic sample through the page, draws both card
     sizes and writes a JSON summary to <html data-dna-selftest>; the PNGs go on <html data-dna-png-portrait|landscape>
     so a headless check can save them. Nothing is written to localStorage. ?src=/path.csv (same-origin path only)
     points it at another file served by a local review server. */
  const selfTest = async () => {
    S.selftest = true;
    const out = { ok: false };
    try {
      const srcQ = Q.get('src');
      const src = srcQ && /^\/(?!\/)[\w\-./]+\.csv$/i.test(srcQ) ? srcQ : SAMPLE;
      out.src = src === SAMPLE ? 'sample' : 'custom';
      const ok = await loadSample(src);
      if (!ok) throw new Error(($('dnaError') || {}).textContent || 'load failed');
      if (Q.get('sport')) { S.sport = Q.get('sport').toUpperCase(); show(); }
      const a = S.a;
      out.sport = a.sport; out.n = a.n; out.early = a.early; out.sports = S.hist.sports.map(s => `${s.key}:${s.n}`);
      out.mix = (a.mix || []).map(m => `${m.name} ${m.pct}%`); out.dominant = a.dominant && a.dominant.name;
      out.ranked = (a.ranked || []).map(x => `${x.name} ${x.pct}% (raw ${x.raw.toFixed(3)})`);
      out.shares = Object.fromEntries(Object.entries(a.shares).map(([k, v]) => [k, +v.toFixed(3)]));
      out.avgFee = +a.avgFee.toFixed(2); out.seasons = a.seasons;
      out.gpp = { n: a.gpp.n, top1: a.gpp.top1, rate1: +(a.gpp.rate1 * 100).toFixed(2), exp1: +(a.gpp.exp1 * 100).toFixed(2), x1: +a.gpp.x1.toFixed(2), rate10: +(a.gpp.rate10 * 100).toFixed(2), x10: +a.gpp.x10.toFixed(2) };
      out.best = a.best ? `${ordinal(a.best.place)} of ${num(a.best.field)}` : null;
      out.rarity = `${a.rarity.label} (${a.rarity.sub})`;
      out.leak = a.leak ? `${a.leak.label}: ${roiTxt(a.leak.roi)} over ${a.leak.seasons} seasons (${a.leak.n} entries, ${usd(a.leak.fees)})` : a.leakState;
      out.leakFix = a.leak ? a.leak.fix : null;
      out.badges = Object.keys(a.badges).map(k => badgeLabel(k, a.badges[k]));
      for (const fmt of ['portrait', 'landscape']) {
        const r = await renderCard(fmt);
        const url = r ? r.canvas.toDataURL('image/png') : '';
        out[`png_${fmt}`] = url.length; out[`size_${fmt}`] = r ? `${r.canvas.width}x${r.canvas.height}` : null;
        document.documentElement.setAttribute(`data-dna-png-${fmt}`, url);
      }
      for (let t0 = Date.now(); !BBI.auth && Date.now() - t0 < 8000;) await new Promise(r => setTimeout(r, 100));   // auth.js loads async
      await new Promise(r => setTimeout(r, 300));
      const gate = document.querySelector('#dnaMember[data-gate="member"]');
      out.gated = { present: !!gate, locked: !!(gate && gate.classList.contains('bbi-locked')), member: isMember(), teaser: ($('dnaMemberBody') || {}).dataset ? $('dnaMemberBody').dataset.member === '0' : null };
      out.noHScroll = document.documentElement.scrollWidth <= root.innerWidth;
      out.ok = true;
    } catch (e) { out.error = String(e && e.message || e); }
    document.documentElement.dataset.dnaSelftest = JSON.stringify(out);
  };

  // for checks only (headless review): the page state and a member-view redraw; no data leaves the page
  BBI.dnaPage = { state: S, redrawMember: drawMember, memberHtml: () => S.a && !S.a.tooFew ? memberHtml(S.a) : '' };

  const boot = () => {
    const peek = $('dnaPeek'), sampleBtn = $('dnaSample');
    if (peek && sampleBtn) peek.addEventListener('click', () => sampleBtn.click());   // the peeking sample card runs the sample
    bind();
    watchAuth();
    if (Q.get('selftest') === 'dna') { setTimeout(selfTest, 0); return; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : null);
