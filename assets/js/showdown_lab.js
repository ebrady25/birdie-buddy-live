/* =====================================================================
   BIRDIEBUDDY — SHOWDOWN LINEUP LAB (Step 4)
   Build a lineup from a slate pool and the engine (showdown_engine.js,
   parity-tested against rules_engine.py) grades it live: hard rules,
   soft penalties + overlay adjustments, captain-template story fit, the
   script it plays, ownership/dupes when a projections file is loaded.
   Pro panel: load your own DK salary + Stokastic files, score a whole
   book, portfolio report, and let the engine pick a book from a pool.
   Files are read in the browser; nothing is uploaded.
   ===================================================================== */
window.BBI = window.BBI || {};
(() => {
  'use strict';
  const SE = window.BBI.showdownEngine, FX = window.BBI.fx, SB = window.BBI.showdownBuild;
  const SD = () => window.BBI.showdown;
  const POOL_DIR = 'nfl/showdown/pools/';
  const LS_KEY = 'bbi_showdown_lab';
  const CAP = 50000;
  const FIELD_DEFAULT = { se_small: 2000, mid: 12000, large: 100000 };
  const POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
  const GONE = new Set(['O', 'OUT', 'IR', 'SUSP', 'PUP', 'NFI']);   // DK status: not playing → left out of the Lab pool (Q / D stay, tagged)
  const SCRIPT_NAME = { A: 'Favorite blowout', B: 'Favorite controls', C: 'Coin flip', D: 'Dog upset' };
  const FEAT_LABEL = { own_QB: 'own QB', own_RB: 'own RB', own_WR: 'own WR', own_TE: 'own TE', own_K: 'own K', own_DST: 'own DST', opp_QB: 'opp QB', opp_RB: 'opp RB', opp_WR: 'opp WR',
    opp_TE: 'opp TE', opp_K: 'opp K', opp_DST: 'opp DST', own_second_catcher: '2nd own catcher', own_second_rb: '2nd own RB', own_second_te: '2nd own TE', both_qbs: 'both QBs' };

  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = v => '$' + Math.round(v).toLocaleString('en-US');
  const ownPct = v => `${(+v).toFixed(v >= 10 ? 0 : 1)}%`;
  const $ = id => document.getElementById(id);
  // First-party analytics (track.js): bucketed, no names. A no-op when it isn't loaded.
  const track = (e, p) => { try { if (window.BBI.track) window.BBI.track(e, p); } catch {} };
  const T = () => window.BBI.track || { size: n => String(n), band: s => String(s) };
  // Screen readers hear the grade through one small status line, never the re-rendered cards.
  const announce = msg => { const el = $('sdStatus'); if (el && el.textContent !== msg) el.textContent = msg; };

  const lab = {
    source: 'sample', poolId: null, pools: {}, mine: null, mineFav: null,
    cpt: null, flex: [null, null, null, null, null],
    pos: 'ALL', team: 'ALL', q: '', sort: 'sal', field: null,
    batch: null, book: null, celebrated: '', completed: '', prevSlots: {}, built: '', err: '', saved: {},
    auto: null, autoMode: null, rowFocus: null,   // autoMode null = the default (blend once the sim ran, else codex fit)
    corr: true, mineBB: null   // corr: "Use corrected ownership" (a preference, stored); mineBB: the sample pool matching Your slate (BB model own + statuses)
  };

  /* ---------------- persistence ---------------- */
  // One lineup remembered per slate pool, so switching slates never loses work.
  const lineupKey = () => lab.source === 'mine' ? 'mine' : lab.poolId;
  const stash = () => { if (lineupKey()) lab.saved[lineupKey()] = { cpt: lab.cpt, flex: lab.flex.slice() }; };
  const unstash = () => { const s = lab.saved[lineupKey()]; lab.cpt = s ? s.cpt : null; lab.flex = s && Array.isArray(s.flex) && s.flex.length === 5 ? s.flex.slice() : [null, null, null, null, null]; };
  // What the Lab remembers: pool id, lineups (player names only), field, sort, the corrected-ownership switch.
  // Never an ownership / projection number: the reader's Stokastic file stays in memory for this visit only.
  const persistBlob = () => JSON.stringify({ poolId: lab.poolId, saved: lab.saved, field: lab.field, sort: lab.sort, corr: lab.corr });
  // Every localStorage write in the Lab goes through here, to one of three keys: the Lab blob (names + settings),
  // the Step 5 contest link (public DK contest id / field / name) and the routine ticks (step ids per slate).
  const LS_KEYS = new Set([LS_KEY, 'bbi_showdown_contest', 'bbi_showdown_routine']);
  const lsSet = (k, v) => { if (!LS_KEYS.has(k)) return; try { localStorage.setItem(k, v); } catch {} };
  const save = () => { stash(); lsSet(LS_KEY, persistBlob()); };
  const load = () => { try { const s = JSON.parse(localStorage.getItem(LS_KEY)); if (s && typeof s === 'object') { lab.poolId = s.poolId || null; lab.saved = s.saved && typeof s.saved === 'object' ? s.saved : {}; lab.field = s.field || null; lab.sort = s.sort || 'sal'; lab.corr = s.corr !== false; } } catch {} };

  /* ---------------- pools + engine ---------------- */
  const fetchPool = async id => {
    if (lab.pools[id]) return lab.pools[id];
    const r = await fetch(`${POOL_DIR}${id}.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`pool ${id}: HTTP ${r.status}`);
    return (lab.pools[id] = await r.json());
  };
  // Primetime-first: the Lab offers the page's visible slates (primetime always, Sunday only in attack mode).
  const poolIds = () => { const v = SD().visibleSlates ? SD().visibleSlates() : (SD().slates || []); const ids = v.map(s => s.id);
    if (lab.poolId && !ids.includes(lab.poolId) && (SD().slates || []).some(s => s.id === lab.poolId)) ids.push(lab.poolId); return ids; };
  const allPoolIds = () => (SD().slates || []).map(s => s.id);
  const curPool = () => lab.source === 'mine' ? null : lab.pools[lab.poolId] || null;
  const players = () => {
    if (lab.source === 'mine' && lab.mine) return useCorr() ? mineCorr().pl : lab.mine.players;
    const p = curPool(); return p ? SE.playersFromList(p.players.filter(x => !GONE.has(String(x.status || '').toUpperCase())), p.has || {}) : null;
  };
  // Pool ownership from the BirdieBuddy model (pool JSON own_source), labelled "BB proj" wherever it shows.
  const bbOwn = () => { const p = lab.source === 'sample' ? curPool() : null; return p && p.has && p.has.own && p.own_source ? p : null; };
  const favTeam = pl => {
    if (lab.source !== 'mine') { const p = curPool(); return p && p.fav; }
    const teams = [...new Set([...pl.P.values()].map(p => p.team))].sort();
    const preset = (SD().slates || []).find(s => s.id === SD().state.preset);
    if (lab.mineFav && teams.includes(lab.mineFav)) return lab.mineFav;
    if (preset && teams.includes(preset.fav)) return preset.fav;
    return teams[0];
  };
  /* ---------------- ownership sources ---------------- */
  // Your slate from a Stokastic Data Hub export → three numbers per player: Stokastic raw · BirdieBuddy-corrected
  // (ownership_correction.json: our role-cell coefficients, applied here in the browser) · our BB model (from the
  // sample pool of the same game, when there is one). With "Use corrected ownership" on (the default) the engine's
  // dupes, cum own and ownership rules run on the corrected number. Sample pools carry the BB model only, shown
  // with its own (wider) held-out band.
  const OC_PATH = 'nfl/showdown/ownership_correction.json';
  let OC = null;
  const loadOC = async () => { try { const r = await fetch(OC_PATH, { cache: 'no-cache' }); if (r.ok) { const j = await r.json(); if (j && j.flex && j.cpt && j.bands) OC = j; } } catch {} };
  const stokOwn = () => !!(lab.source === 'mine' && lab.mine && lab.mine.players.has.own && /stokastic/.test(lab.mine.players.source || ''));
  const useCorr = () => !!(lab.corr && OC && stokOwn());
  let corrCache = { key: '', pl: null, C: null };
  const mineCorr = () => {
    const base = lab.mine.players, fav = favTeam(base), key = `${lab.mine.stamp}|${fav}|${OC ? OC.generated : ''}`;
    if (corrCache.key !== key) {
      const C = SD().correctOwn([...base.P.values()], fav, OC), P = new Map();
      for (const [n, p] of base.P) { const c = C.get(n); P.set(n, c ? { ...p, own: c.own, cpt_own: c.cpt_own } : p); }
      corrCache = { key, C, pl: { ...base, P } };
    }
    return corrCache;
  };
  const normName = n => String(n).toLowerCase().replace(/[.'’]/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/\s+/g, ' ').trim();
  // Your slate ↔ the sample pool of the same two teams (newest first): BB model ownership + DK statuses.
  const matchBB = async () => {
    lab.mineBB = null; if (!lab.mine) return;
    const teams = [...new Set([...lab.mine.players.P.values()].map(p => p.team))].sort().join();
    const s = (SD().slates || []).find(x => [x.fav, x.dog].sort().join() === teams); if (!s) return;
    try { const p = await fetchPool(s.id); lab.mineBB = { id: s.id, label: p.label, own: !!(p.has && p.has.own), own_source: p.own_source || '', map: new Map(p.players.map(x => [normName(x.name), x])) }; } catch {}
  };
  // 'stok' (Your slate, Stokastic ownership) | 'bb' (sample pool, BB model) | null (no ownership)
  const ownKind = () => stokOwn() ? 'stok' : bbOwn() ? 'bb' : null;
  const band = (kind, v, which) => OC ? SD().ownBand(OC, kind, v, which) : null;
  // Per player: the numbers the row shows + the band of the number the engine uses (for the dupes range).
  const ownOf = name => {
    const k = ownKind(); if (!k) return null;
    if (k === 'bb') { const p = engine && engine.P.get(name); if (!p) return null;
      return { kind: k, used: { f: p.own, c: p.cpt_own, fb: band('flex', p.own, 'bb_model'), cb: band('cpt', p.cpt_own, 'bb_model') } }; }
    const raw = lab.mine.players.P.get(name); if (!raw) return null;
    const c = OC ? mineCorr().C.get(name) : null, m = lab.mineBB && lab.mineBB.own ? lab.mineBB.map.get(normName(name)) : null;
    const corr = c ? { f: c.own, c: c.cpt_own, fb: { lo: c.own_lo, hi: c.own_hi, n: c.own_n }, cb: { lo: c.cpt_own_lo, hi: c.cpt_own_hi, n: c.cpt_own_n } } : null;
    const rawV = { f: raw.own, c: raw.cpt_own, fb: band('flex', raw.own, 'raw'), cb: band('cpt', raw.cpt_own, 'raw') };
    return { kind: k, raw: rawV, corr, bb: m ? { f: +m.own || 0, c: +m.cpt_own || 0 } : null, used: useCorr() && corr ? corr : rawV };
  };
  const ownLabel = () => { const k = ownKind(); return k === 'stok' ? (useCorr() ? 'BirdieBuddy-corrected Stokastic' : 'Stokastic raw') : k === 'bb' ? 'BB model (rough)' : ''; };
  // Leverage (role_rates): the active pool's roles vs the historical winners, with the engine's ownership.
  let lev = null;
  const levPlayers = () => {
    if (!engine || !engine.has.own) return null;
    const st = lab.source === 'mine' && lab.mineBB ? lab.mineBB.map : null;
    return [...engine.P.values()].filter(p => {
      if (lab.source !== 'mine') return true;   // sample pools already leave OUT / IR players out
      const m = st && st.get(normName(p.name));
      return !(m && GONE.has(String(m.status || '').toUpperCase())) && (!engine.has.proj || p.proj > 0);
    });
  };
  const computeLev = () => { const RR = SD().data && SD().data.role_rates, ps = levPlayers(); lev = RR && ps && ps.length ? SD().leverageFor(ps, engine.A.fav, engine.A.spread, RR) : null; return lev; };
  const fieldSize = () => lab.field || FIELD_DEFAULT[SD().state.contest] || 11700;
  const windFor = env => env === 'wind_15_plus' ? 15 : env === 'wind_10_14' ? 12 : 0;
  let engine = null;
  const engineOpts = pl => { const s = SD().state; return { fav: favTeam(pl), spread: s.spread, total: s.total, wind: windFor(s.env), roof: s.env === 'dome' ? 'dome' : 'outdoors', field: fieldSize(), n: s.entries }; };
  const buildEngine = () => {
    const pl = players(); engine = null; lev = null; lab.err = '';
    if (!pl || !pl.P.size) return null;
    try {
      engine = SE.createEngine(SD().data, pl, engineOpts(pl));
      computeLev();
    } catch (e) { lab.err = e.message; lev = null; }
    return engine;
  };

  /* ---------------- scoring ---------------- */
  // Codex score: the lineup terms rules_engine.py adds to its sim rank
  // (story fit − penalties), on a 0–100 dial. 1.0 of fit−penalty = 50 points.
  const codexScore = r => Math.max(0, Math.min(100, Math.round(50 + 50 * (r.fit - r.penSum))));
  const verdictFor = (r, n) => {
    const legal = !r.hard.length;
    if (n < 6) return { cls: legal ? 'part' : 'bad', title: legal ? `Building · ${n}/6` : 'Already breaks a rule', sub: legal ? 'provisional grade — fill every slot' : r.hard.join(' · ') };
    if (!legal) return { cls: 'bad', title: 'Rejected by the engine', sub: `breaks ${r.hard.length} hard rule${r.hard.length > 1 ? 's' : ''} — ${r.hard.join(' · ')}` };
    const sc = codexScore(r);
    if (sc >= 85) return { cls: 'elite', title: 'Codex-grade', sub: 'fits the winning template with nothing to charge' };
    if (sc >= 70) return { cls: 'good', title: 'Strong build', sub: 'legal, on-template, light penalties' };
    if (sc >= 50) return { cls: 'ok', title: 'Playable', sub: 'legal — the report shows what drags it' };
    return { cls: 'low', title: 'Off-script', sub: 'legal but fights the template — see the report' };
  };
  const lineupNames = () => ({ cpt: lab.cpt, flex: lab.flex.filter(Boolean) });
  const filled = () => (lab.cpt ? 1 : 0) + lab.flex.filter(Boolean).length;
  const scoreCurrent = () => {
    if (!engine || !lab.cpt || !engine.P.has(lab.cpt)) return null;
    const L = lineupNames(); if (L.flex.some(n => !engine.P.has(n))) return null;
    return provisional(engine.scoreOne(L), 1 + L.flex.length);
  };
  // On a partial lineup, penalties for something *missing* (a shape that
  // isn't finished, a QB/WR not added yet) are pending, not charged.
  const PENDING_PEN = /^shape |without/;
  const provisional = (r, n) => {
    if (n >= 6) return r;
    const pending = r.pen.filter(p => PENDING_PEN.test(p[0]));
    const pen = r.pen.filter(p => !PENDING_PEN.test(p[0]));
    return { ...r, pen, pending, penSum: pen.reduce((a, p) => a + p[1], 0) };
  };
  const salaryUsed = () => {
    if (!engine) return 0;
    const P = engine.P; let s = 0;
    if (lab.cpt && P.has(lab.cpt)) s += P.get(lab.cpt).sal * 1.5;
    lab.flex.forEach(n => { if (n && P.has(n)) s += P.get(n).sal; });
    return s;
  };

  // Map the page's captain shortlist seats ("Fav WR1", "Dog RB") to players.
  const seatPlayer = seat => {
    if (!engine) return null;
    const m = /^(Fav|Dog) (WR1|RB|QB|TE1)/.exec(seat); if (!m) return null;
    const team = m[1] === 'Fav' ? engine.A.fav : engine.DOG, pos = m[2].replace(/1$/, '');
    const cand = [...engine.P.values()].filter(p => p.team === team && p.pos === pos).sort((a, b) => b.sal - a.sal);
    return cand[0] || null;
  };

  // Best next add: try every player in the next open seat, keep legal +
  // cap-feasible ones, rank by codex score (partial lineups score partially).
  const suggestions = () => {
    if (!engine) return [];
    const n = filled(); if (n >= 6) return [];
    const inL = new Set([lab.cpt, ...lab.flex].filter(Boolean));
    const d = SD().derive();
    if (!lab.cpt) {
      return d.shortlist.map(s => ({ seat: s, p: seatPlayer(s.seat) })).filter(x => x.p && !inL.has(x.p.name)).slice(0, 4)
        .map(x => ({ name: x.p.name, as: 'cpt', label: x.seat.seat, val: `≈${Math.round(x.seat.weight)}%`, tip: `${x.seat.seat}: ≈${Math.round(x.seat.weight)}% of winners in this cell (step 3 shortlist)` }));
    }
    const used = salaryUsed(), open = 5 - lab.flex.filter(Boolean).length;
    const cheap = [...engine.P.values()].filter(p => !inL.has(p.name)).sort((a, b) => a.sal - b.sal);
    const out = [];
    for (const p of engine.P.values()) {
      if (inL.has(p.name) || !p.sal) continue;
      const rest = cheap.filter(x => x !== p).slice(0, open - 1).reduce((a, x) => a + x.sal, 0);   // cheapest way to fill the other open seats
      if (used + p.sal + rest > CAP) continue;
      const r = provisional(engine.scoreOne({ cpt: lab.cpt, flex: [...lab.flex.filter(Boolean), p.name] }), filled() + 1);
      if (r.rules.some(x => x.status === 'fail')) continue;
      out.push({ name: p.name, as: 'flex', score: codexScore(r), sal: p.sal, pos: p.pos, tip: `${p.pos} · ${money(p.sal)} · lineup grade → ${codexScore(r)}` });
    }
    return out.sort((a, b) => b.score - a.score || b.sal - a.sal).slice(0, 4).map(x => ({ ...x, label: x.pos, val: `▲ ${x.score}` }));
  };

  /* ---------------- lineup edits ---------------- */
  const inLineup = name => lab.cpt === name || lab.flex.includes(name);
  const removeName = name => { if (lab.cpt === name) lab.cpt = null; lab.flex = lab.flex.map(n => n === name ? null : n); };
  const addFlex = name => {
    if (inLineup(name)) { removeName(name); return; }
    const i = lab.flex.indexOf(null);
    if (i >= 0) lab.flex[i] = name; else if (!lab.cpt) lab.cpt = name; else SD().toast('Lineup is full — remove a player first', 'warn');
  };
  const setCpt = name => { removeName(name); if (lab.cpt) { const i = lab.flex.indexOf(null); if (i >= 0) lab.flex[i] = lab.cpt; } lab.cpt = name; };
  const clearLineup = () => { lab.cpt = null; lab.flex = [null, null, null, null, null]; };
  const fillFrom = L => { lab.cpt = L.cpt; lab.flex = [...L.flex, null, null, null, null, null].slice(0, 5); };
  // lab_player_add: only when the action put a player in (a toggle that removed one is not an add).
  const trackAdd = (name, was, via) => {
    const now = lab.cpt === name ? 'cpt' : inLineup(name) ? 'flex' : null;
    if (!now || now === was) return;
    const p = engine && engine.P.get(name);
    track('lab_player_add', { pos: p ? p.pos : '', as: now, via, n: filled(), pool: lab.source });
  };
  const slotOf = name => lab.cpt === name ? 'cpt' : inLineup(name) ? 'flex' : null;

  /* ---------------- render: skeleton ---------------- */
  const skeleton = () => {
    const ids = poolIds();
    const pool = curPool(), pl = players();
    const srcChips = ids.map(id => { const s = (SD().slates || []).find(x => x.id === id); return `<button type="button" class="sd-src${lab.source === 'sample' && lab.poolId === id ? ' on' : ''}" aria-pressed="${lab.source === 'sample' && lab.poolId === id}" data-lab-pool="${esc(id)}"><b>${esc(s ? s.label : id)}</b><small>${esc(s ? `${s.fav} −${s.spread} · ${s.total}` : '')}</small></button>`; }).join('')
      + (lab.mine ? `<button type="button" class="sd-src mine${lab.source === 'mine' ? ' on' : ''}" aria-pressed="${lab.source === 'mine'}" data-lab-mine><b>Your slate</b><small>${esc(lab.mine.label)}</small></button>` : '');
    const teams = pl ? [...new Set([...pl.P.values()].map(p => p.team))].sort() : [];
    const fav = pl ? favTeam(pl) : '';
    const levOk = !!(pl && pl.has.own && SD().data.role_rates), stok = stokOwn();
    if (lab.team !== 'ALL' && !teams.includes(lab.team)) lab.team = 'ALL';
    $('sdLab').innerHTML = `
      <div class="card sd-lab-bar fx-reveal">
        <div class="sd-lab-bar-row">
          <div class="sd-lab-src"><span class="sd-lab-k">Slate pool</span><div class="sd-srcs">${srcChips || '<span class="sd-num-hint">loading…</span>'}</div></div>
          <div class="sd-lab-opts">
            ${lab.source === 'mine' && teams.length === 2 ? `<label class="sd-lab-opt"><span class="sd-lab-k">Favorite</span><span class="seg">${teams.map(t => `<button type="button" class="${t === fav ? 'active' : ''}" aria-pressed="${t === fav}" data-lab-fav="${esc(t)}">${esc(t)}</button>`).join('')}</span></label>` : ''}
            ${stok ? `<label class="sd-lab-opt sd-corr-opt"><span class="sd-lab-k">Ownership</span><span class="sd-corr"><input type="checkbox" id="sdLabCorr" ${lab.corr && OC ? 'checked' : ''} ${OC ? '' : 'disabled'}><span>Use corrected ownership<small>${OC ? 'on: the engine grades with BirdieBuddy-corrected Stokastic · off: Stokastic raw' : 'correction file not loaded: the engine uses Stokastic raw'}</small></span></span></label>` : ''}
            <label class="sd-lab-opt"><span class="sd-lab-k">Field size</span><input class="sd-num" id="sdLabField" type="number" min="100" max="2000000" step="100" value="${fieldSize()}" aria-label="Contest field size" aria-describedby="sdLabFieldLink"><small class="sd-field-link" id="sdLabFieldLink"></small></label>
          </div>
        </div>
        <div class="sd-lab-bar-note" id="sdLabNote"></div>
      </div>
      <div class="sd-lab-grid">
        <div class="card sd-lab-pool fx-reveal${levOk ? ' has-lev' : ''}">
          <div class="sd-pool-head">
            <input class="sd-pool-q" id="sdPoolQ" type="search" placeholder="Search players  /" value="${esc(lab.q)}" aria-label="Search players" autocomplete="off">
            <select class="sd-pool-sort" id="sdPoolSort" aria-label="Sort players">
              ${[['sal', 'Salary'], ['name', 'Name'], ...(pl && pl.has.proj ? [['proj', 'Projection']] : []), ...(pl && pl.has.own ? [['own', bbOwn() ? 'BB proj own' : 'Ownership']] : []), ...(pl && pl.has.proj ? [['value', 'Pts / $1k']] : []), ...(levOk ? [['levf', 'Lev FLEX'], ['levc', 'Lev CPT']] : [])].map(([k, l]) => `<option value="${k}"${lab.sort === k ? ' selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          <div class="sd-pool-filters">
            <div class="sd-pool-pos" role="group" aria-label="Position">${['ALL', ...POS].map(p => `<button type="button" class="${lab.pos === p ? 'on' : ''}" aria-pressed="${lab.pos === p}" data-lab-pos="${p}">${p}</button>`).join('')}</div>
            <div class="sd-pool-team" role="group" aria-label="Team">${['ALL', ...teams].map(t => `<button type="button" class="${lab.team === t ? 'on' : ''}" aria-pressed="${lab.team === t}" data-lab-team="${esc(t)}">${t === 'ALL' ? 'Both' : esc(t)}${t === fav ? '<i>fav</i>' : ''}</button>`).join('')}</div>
          </div>
          <div class="sd-pool-cols"><span>Player</span><span>${pl && pl.has.proj ? 'Proj · Own' : pl && pl.has.own ? 'Own %' : ''}</span>${levOk ? '<span title="Leverage: historical role rate − projected ownership, points (F = FLEX, C = CPT)">Lev</span>' : ''}<span>Salary</span><span>Add</span></div>
          <div class="sd-pool-list" id="sdPoolList" role="list" aria-label="Player pool" aria-describedby="sdPoolKeys"></div>
          <span class="sr-only" id="sdPoolKeys">One tab stop: arrow keys move between players, Enter adds or removes the player, C makes him captain.</span>
          <div class="sd-caption" id="sdPoolCap"></div>
        </div>
        <div class="sd-lab-build">
          <div class="card card-premium sd-lab-lineup fx-reveal" id="sdLabLineup"></div>
          <div class="card sd-lab-report fx-reveal" id="sdLabReport"></div>
        </div>
      </div>
      <div class="card sd-auto fx-reveal" id="sdAuto"></div>`;
    lab.built = `${lab.source}|${lab.poolId}|${lab.mine ? lab.mine.stamp : ''}|${pl ? pl.has.own : ''}|${fav}|${teams.join()}|${ids.join()}|${stok}|${!!OC}`;
    bindSkeleton();
  };

  /* ---------------- render: pool list ---------------- */
  const o1 = v => v == null ? '—' : v.toFixed(1);
  const o0 = v => v >= 10 ? v.toFixed(0) : v.toFixed(1);
  const sgn = v => { const r = Math.round(v * 10) / 10; return r > 0 ? `+${r.toFixed(1)}` : r < 0 ? `−${Math.abs(r).toFixed(1)}` : '0.0'; };
  // Pool sort by leverage, same rule as the Step 3 board: ranked players first (by leverage, high to low), then thin
  // matches and split K / DST roles (greyed, never ranked), then players with no role. Keys compare as tuples.
  const levSortKey = (L, name, slot) => { const b = L && L.byPlayer.get(name), r = b && L.roles[b.role]; return r ? [b.thin || r.split ? 1 : 0, -r[slot].lev] : [2, 0]; };
  const cmpKey = (x, y) => { if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) { const c = cmpKey(x[i], y[i]); if (c) return c; } return 0; } return x < y ? -1 : x > y ? 1 : 0; };
  const ci = c => c ? `${o0(c[0])}–${o0(c[1])}%` : '';
  const levTip = (r, b, p) => {
    const L = SD().LEV_BUCKET_LABEL[lev.bucket], s = b.sal;
    return `${r.label} (${L} row, n = ${lev.n} primetime winners)\n`
      + `CPT: ${r.cpt.hist.toFixed(1)}% of winning captains (${r.cpt.k}/${lev.n}, 90% CI ${ci(r.cpt.ci)}) − ${r.cpt.own.toFixed(1)}% projected CPT own = ${sgn(r.cpt.lev)}\n`
      + `FLEX: ${r.flex.per100 ? `${r.flex.hist.toFixed(1)} role players per 100 winning lineups (≥ 1 in ${r.flex.pct.toFixed(1)}%, 90% CI ${ci(r.flex.ci)})` : `${r.flex.hist.toFixed(1)}% of winning lineups (${r.flex.k}/${lev.n}, 90% CI ${ci(r.flex.ci)})`} − ${r.flex.own.toFixed(1)}% projected FLEX own = ${sgn(r.flex.lev)}`
      + `${r.players.length > 1 ? `\n${r.players.length} pool players share this role: the leverage is the role's, not his alone` : ''}`
      + `${r.split ? `\nSplit ${r.pos}: ${r.players.length} players in this role are each projected at 5%+ own, so the summed ownership overstates it (the field splits one player's worth): an ownership-model issue, not leverage` : ''}`
      + `${b.thin ? `\nThin match: ${money(p.sal)} ${s && s.n >= 5 ? `is outside the ${money(s.p5)}–${money(s.p95)} this role's winners were priced at (n ${s.n})` : 'and too few historical salaries for this role'}: read with care` : ''}`
      + `\nOwnership: ${ownLabel()}. History = how often the role is in winning lineups, not a projection.`;
  };
  const levAria = p => { const b = lev && lev.byPlayer.get(p.name), r = b && lev.roles[b.role]; return r ? `, ${esc(r.label)} leverage FLEX ${sgn(r.flex.lev)}, captain ${sgn(r.cpt.lev)}${b.thin ? ' (thin match)' : r.split ? ' (split role, not ranked)' : ''}` : ''; };
  const levCell = p => {
    const b = lev.byPlayer.get(p.name), r = b && lev.roles[b.role];
    if (!r) return '<span class="sd-p-lev"></span>';
    const n = (v, k) => `<span class="${Math.round(v * 10) > 0 ? 'up' : ''}"><i>${k}</i>${sgn(v)}</span>`;
    return `<span class="sd-p-lev${b.thin || r.split ? ' thin' : ''}" title="${esc(levTip(r, b, p))}">${n(r.flex.lev, 'F')}${n(r.cpt.lev, 'C')}</span>`;
  };
  // The line under a player: ownership (three numbers on a Stokastic slate; BB model + band on a sample pool) and,
  // on phones, his leverage (the Lev column is hidden there).
  const ownLine = p => {
    const o = ownOf(p.name), b = lev && lev.byPlayer.get(p.name), r = b && lev.roles[b.role];
    if (!o && !r) return '';
    const bandT = x => x ? `<i>${o0(x.lo)}–${o0(x.hi)}</i>` : '';
    let own = '';
    if (o && o.kind === 'stok') {
      const useC = useCorr() && o.corr;
      const part = (k, f) => `<span><em>${k}</em>${useC ? '' : '<b>'}Stok ${o1(o.raw[f])}${useC ? '' : '</b>'} · ${o.corr ? `${useC ? '<b>' : ''}corr ${o1(o.corr[f])}${useC ? '</b>' : ''} ${bandT(o.corr[f + 'b'])}` : 'corr —'} · BB ${o.bb ? o1(o.bb[f]) : '—'}</span>`;
      own = part('FLEX', 'f') + part('CPT', 'c');
    } else if (o && o.kind === 'bb') {
      own = `<span><em>FLEX</em><b>BB ${o1(o.used.f)}</b> ${bandT(o.used.fb)}</span><span><em>CPT</em><b>BB ${o1(o.used.c)}</b> ${bandT(o.used.cb)}</span><span class="rough">rough</span>`;
    }
    const lv = r ? `<span class="sd-p-xlev${b.thin || r.split ? ' thin' : ''}"><em>Lev</em>F ${sgn(r.flex.lev)} · C ${sgn(r.cpt.lev)}</span>` : '';
    return `<span class="sd-p-x${o && o.kind === 'stok' ? ' stok' : ''}">${own}${lv}</span>`;
  };
  const renderPool = () => {
    const list = $('sdPoolList'); if (!list) return;
    if (!engine) { list.innerHTML = `<div class="sd-pool-empty">${esc(lab.err || 'Loading the slate pool…')}</div>`; return; }
    const q = lab.q.trim().toLowerCase(), fav = engine.A.fav, has = engine.has;
    let ps = [...engine.P.values()].filter(p => (lab.pos === 'ALL' || p.pos === lab.pos) && (lab.team === 'ALL' || p.team === lab.team) && (!q || p.name.toLowerCase().includes(q)));
    const key = { sal: p => -p.sal, name: p => p.name, proj: p => -p.proj, own: p => -p.own, value: p => -(p.sal ? p.proj / p.sal * 1000 : 0),
      ...(lev ? { levf: p => levSortKey(lev, p.name, 'flex'), levc: p => levSortKey(lev, p.name, 'cpt') } : {}) }[lab.sort] || (p => -p.sal);
    ps.sort((a, b) => { const x = key(a), y = key(b); return cmpKey(x, y) || b.sal - a.sal; });
    const top = list.scrollTop;
    const ae = document.activeElement, focusKey = ae && list.contains(ae) ? (ae.dataset.labAdd ? ['row', ae.dataset.labAdd] : ae.dataset.labCpt ? ['cpt', ae.dataset.labCpt] : ae.dataset.labFlex ? ['flex', ae.dataset.labFlex] : null) : null;
    const used = salaryUsed(), bb = bbOwn();
    const status = new Map(((curPool() && lab.source === 'sample' && curPool().players) || []).filter(p => p.status).map(p => [p.name, p.status]));
    // Roving tabindex: the list is one tab stop (the last row the keyboard was on, else the first); its C / + buttons are for pointers.
    const rover = ps.some(p => p.name === lab.rowFocus) ? lab.rowFocus : ps.length ? ps[0].name : null;
    list.innerHTML = ps.map(p => {
      const cpt = lab.cpt === p.name, inl = inLineup(p.name), over = !inl && used + p.sal > CAP;
      return `<div class="sd-p${inl ? ' in' : ''}${cpt ? ' cpt' : ''}${over ? ' over' : ''}" role="listitem" data-lab-add="${esc(p.name)}" tabindex="${p.name === rover ? 0 : -1}" aria-label="${esc(p.name)}, ${esc(p.pos)} ${esc(p.team)}, ${money(p.sal)}${cpt ? ', captain' : inl ? ', in lineup' : ''}${over ? ', over the cap' : ''}${levAria(p)}">
        <span class="sd-pos pos-${esc(p.pos)}">${esc(p.pos)}</span>
        <span class="sd-p-name">${esc(p.name)}<small>${esc(p.team)}${p.team === fav ? ' · fav' : ' · dog'}${engine.rank.get(p.name) === 1 && ['WR', 'RB', 'TE', 'QB'].includes(p.pos) ? ` · ${p.pos}1` : ''}${status.get(p.name) ? ` · <b class="sd-p-status">${esc(status.get(p.name))}</b>` : ''}</small></span>
        <span class="sd-p-proj">${has.proj ? `${p.proj.toFixed(1)}${has.own ? `<small>${p.own.toFixed(0)}%</small>` : ''}` : has.own ? `${ownPct(p.own)}<small>${bb ? 'BB proj' : 'own'}</small>` : ''}</span>
        ${lev ? levCell(p) : ''}
        <span class="sd-p-sal">${money(p.sal)}<small>CPT ${money(p.sal * 1.5)}</small></span>
        <span class="sd-p-act"><button type="button" tabindex="-1" class="sd-p-btn c${cpt ? ' on' : ''}" data-lab-cpt="${esc(p.name)}" title="Captain (1.5×)" aria-label="Make ${esc(p.name)} captain">C</button><button type="button" tabindex="-1" class="sd-p-btn${inl && !cpt ? ' on' : ''}" data-lab-flex="${esc(p.name)}" title="${inl ? 'Remove' : 'Add to FLEX'}" aria-label="${inl ? 'Remove' : 'Add'} ${esc(p.name)}">${inl ? '−' : '+'}</button></span>
        ${ownLine(p)}
      </div>`;
    }).join('') || '<div class="sd-pool-empty">No players match.</div>';
    list.scrollTop = top;
    if (focusKey) { const attr = { row: 'data-lab-add', cpt: 'data-lab-cpt', flex: 'data-lab-flex' }[focusKey[0]]; const el = [...list.querySelectorAll(`[${attr}]`)].find(x => x.getAttribute(attr) === focusKey[1]); if (el) el.focus({ preventScroll: true }); }
    const src = lab.source === 'mine' ? lab.mine.label : `${curPool().label} · ${curPool().week} · ${curPool().source}`;
    const gone = lab.source === 'sample' && curPool() ? curPool().players.length - engine.P.size : 0;
    $('sdPoolCap').innerHTML = `${ps.length} of ${engine.P.size} players${gone > 0 ? ` (${gone} out / IR hidden)` : ''} · ${esc(src)}${bb ? ` · ownership: <b>BB proj</b> — ${esc(bb.own_source)}, ${esc(bb.own_quality || 'rough')}${bb.own_note ? ` (${esc(bb.own_note)})` : ''}${OC && OC.bands.flex.bb_model ? ' · range = its held-out 80% band' : ''}` : stokOwn() ? ` · ownership: <b>${useCorr() ? 'corrected' : 'Stokastic raw'}</b> drives the engine · line under each player: FLEX / CPT = Stok (your file) · corr (BirdieBuddy-corrected, 80% band) · BB (our model${lab.mineBB && lab.mineBB.own ? `, ${esc(lab.mineBB.label)}` : ': no sample pool for this game'})` : has.own ? '' : ' · no ownership in this file'}${lev ? ` · <b>Lev</b> = historical role rate − projected ownership (${esc(SD().LEV_BUCKET_LABEL[lev.bucket])} row, n = ${lev.n} primetime winners); greyed = thin match` : ''}`;
  };

  /* ---------------- render: lineup + verdict ---------------- */
  const slot = (key, name, isCpt) => {
    const p = name && engine ? engine.P.get(name) : null, prev = lab.prevSlots[key];
    const pop = name && prev !== name ? ' pop' : '';
    if (!p) return `<div class="sd-slot empty${isCpt ? ' cpt' : ''}" data-slot="${key}"><span class="sd-slot-k">${isCpt ? 'CPT <em>1.5×</em>' : 'FLEX'}</span><span class="sd-slot-hint">${isCpt ? 'pick a captain — or tap C in the pool' : 'tap a player'}</span></div>`;
    return `<div class="sd-slot filled${isCpt ? ' cpt' : ''}${pop}" data-slot="${key}">
      <span class="sd-slot-k">${isCpt ? 'CPT <em>1.5×</em>' : 'FLEX'}</span>
      <span class="sd-pos pos-${esc(p.pos)}">${esc(p.pos)}</span>
      <span class="sd-slot-name">${esc(p.name)}<small>${esc(p.team)}${p.team === engine.A.fav ? ' · fav' : ' · dog'}</small></span>
      <span class="sd-slot-sal">${money(isCpt ? p.sal * 1.5 : p.sal)}</span>
      <button type="button" class="sd-slot-x" data-lab-remove="${esc(p.name)}" aria-label="Remove ${esc(p.name)}">×</button></div>`;
  };
  const renderLineup = () => {
    const host = $('sdLabLineup'); if (!host) return;
    const prev = FX.snapshot(host);
    const r = scoreCurrent(), n = filled(), d = SD().derive();
    const used = salaryUsed(), minSal = SD().data.hard_rules.min_salary_used;
    const sc = r ? codexScore(r) : null, v = r ? verdictFor(r, n) : null;
    const C = 2 * Math.PI * 52;
    const odds = SD().scriptOdds(SD().data.base_rates.by_spread[d.sb]);
    const tag = r && n === 6 ? r.script.tag : null;
    const sug = suggestions();
    const inSet = new Set([lab.cpt, ...lab.flex].filter(Boolean));
    const cheapest = engine ? [...engine.P.values()].filter(p => !inSet.has(p.name) && p.sal > 0).map(p => p.sal).sort((a, b) => a - b) : [];
    const stuck = n > 0 && n < 6 && cheapest.length >= 6 - n && cheapest.slice(0, 6 - n).reduce((a, b) => a + b, 0) > CAP - used;
    host.innerHTML = `
      <div class="sd-gauge-row">
        <div class="sd-gauge ${v ? v.cls : 'idle'}" id="sdGauge">
          <svg viewBox="0 0 128 128" aria-hidden="true"><g transform="rotate(-90 64 64)"><circle class="trk" cx="64" cy="64" r="52"/><circle class="val" data-m="lab.gauge" cx="64" cy="64" r="52" style="stroke-dasharray:${((sc || 0) / 100 * C).toFixed(2)} ${C.toFixed(2)}"/></g></svg>
          <div class="sd-gauge-num">${sc != null ? FX.num('lab.score', sc, 0, { from: 0 }) : '—'}<small>codex score</small></div>
        </div>
        <div class="sd-gauge-txt">
          <span class="sd-lab-k">Verdict</span>
          <b class="sd-verdict-title">${v ? esc(v.title) : 'Build a lineup'}</b>
          <span class="sd-verdict-sub">${v ? esc(v.sub) : 'Pick a captain and five flex. The engine grades every click.'}</span>
          ${tag ? `<span class="sd-script-chip"><span class="sd-script-badge sm">${tag}</span><span><b>${SCRIPT_NAME[tag]}</b><small>plays script ${tag} · happens ${Math.round(odds[tag])}% at this spread · your plan ${Math.round(d.alloc[tag])}% of the batch</small></span></span>` : ''}
        </div>
      </div>
      <div class="sd-slots">${slot('cpt', lab.cpt, true)}${lab.flex.map((nm, i) => slot('f' + i, nm, false)).join('')}</div>
      <div class="sd-sal">
        <div class="sd-sal-top"><span>Salary ${FX.num('lab.sal', used, 0, { pre: '$', sep: true })} <small>of $50,000</small></span><span class="${used > CAP ? 'neg' : ''}">${used > CAP ? 'over by ' + money(used - CAP) : money(CAP - used) + ' left'}${n < 6 && n ? ` · ${money((CAP - used) / Math.max(1, 6 - n))}/slot` : ''}</span></div>
        <div class="sd-sal-bar${used > CAP ? ' over' : used >= minSal ? ' ok' : ''}"><i data-m="lab.salbar" style="width:${Math.min(100, used / CAP * 100).toFixed(2)}%"></i><em style="left:${(minSal / CAP * 100).toFixed(2)}%" title="engine minimum ${money(minSal)}"></em></div>
        <div class="sd-sal-cap"><span>engine min ${money(minSal)}</span><span>cap $50,000</span></div>
        ${stuck ? `<div class="sd-sal-warn">No one left fits: the ${6 - n} cheapest remaining player${6 - n > 1 ? 's' : ''} cost ${money(cheapest.slice(0, 6 - n).reduce((a, b) => a + b, 0))} and you have ${money(CAP - used)}. Swap someone down.</div>` : ''}
      </div>
      ${sug.length ? `<div class="sd-sug"><span class="sd-lab-k">${lab.cpt ? 'Best next add' : 'Codex captains for this slate'}</span><div class="sd-sug-row">${sug.map(s => `<button type="button" class="sd-sug-btn" data-lab-sug="${esc(s.name)}" data-as="${s.as}" title="${esc(s.tip)}"><span class="sd-pos pos-${esc(engine.P.get(s.name).pos)}">${esc(engine.P.get(s.name).pos)}</span>${esc(s.name)}<em>${esc(s.val)}</em></button>`).join('')}</div></div>` : ''}
      <div class="sd-lab-actions">
        <button type="button" class="btn btn-sm" data-lab-act="paste">Paste a lineup</button>
        <button type="button" class="btn btn-sm" data-lab-act="copy" ${n === 6 ? '' : 'disabled'}>Copy lineup</button>
        <button type="button" class="btn btn-sm" data-lab-act="dk" ${n === 6 && hasIds() ? '' : 'disabled'} title="${hasIds() ? 'CPT id + FLEX ids, ready for a DK upload' : 'this pool has no DK ids'}">Copy DK upload row</button>
        <button type="button" class="btn btn-sm" data-share="lineup" ${n === 6 ? '' : 'disabled'} title="The play card with this lineup on it: downloads the PNG and copies the image where the browser allows">Share lineup card</button>
        <button type="button" class="btn btn-sm" data-copy-link="#step4" title="A link that opens this slate with this lineup graded in the Lab">Copy link</button>
        <button type="button" class="btn btn-sm btn-ghost" data-lab-act="clear" ${n ? '' : 'disabled'}>Clear</button>
      </div>
      <div class="sd-paste" id="sdPaste" hidden><input class="sd-pool-q" id="sdPasteIn" placeholder="CPT first: 6 names or DK ids, comma-separated" aria-label="Paste a lineup"><button type="button" class="btn btn-sm btn-primary" data-lab-act="paste-go">Score it</button></div>`;
    FX.morph(prev, host);
    lab.prevSlots = { cpt: lab.cpt, ...Object.fromEntries(lab.flex.map((nm, i) => ['f' + i, nm])) };
    renderReport(r, n);
    SD().setLabScore(r ? { score: sc, verdict: v.title, legal: !r.hard.length, partial: n < 6 } : null);
    announce(r ? `Lineup ${n} of 6 · codex score ${sc} · ${v.title}${tag ? ` · plays script ${tag}` : ''}` : n ? `Lineup ${n} of 6` : '');
    // lab_lineup_complete: once per six-man lineup the reader built (a lineup restored at load doesn't count).
    const done = n === 6 && r ? `${lab.source}|${lab.poolId}|${lab.cpt}|${[...lab.flex].sort().join(',')}` : '';
    if (done && lab.completed !== done) {
      if (urlReady) track('lab_lineup_complete', { band: T().band(sc, !r.hard.length), legal: !r.hard.length, script: tag || '', pool: lab.source, hard_fails: r.hard.length, own: ownKind() === 'stok' ? (useCorr() ? 'corrected' : 'raw') : ownKind() || 'none' });
      lab.completed = done;
    }
    // Celebrate a newly completed, legal, strong lineup (once per lineup + slate).
    const k = `${lab.cpt}|${[...lab.flex].sort().join(',')}|${SD().state.spread}|${SD().state.total}|${SD().state.env}`;
    if (r && n === 6 && !r.hard.length && sc >= 70 && lab.celebrated !== k) {
      lab.celebrated = k;
      const g = $('sdGauge').getBoundingClientRect();
      if (g.bottom > 0 && g.top < innerHeight) FX.confetti(g.left + g.width / 2, g.top + g.height / 2, sc >= 85 ? 140 : 70);
      $('sdGauge').classList.add('celebrate');
      track('celebrate', { band: T().band(sc, true), script: r.script.tag });
      SD().toast(`<b>${sc >= 85 ? 'Codex-grade' : 'Strong'} lineup · ${sc}</b> — ${SCRIPT_NAME[r.script.tag]} script, no hard-rule breaks`, 'good');
    }
    save();
  };
  const hasIds = () => engine && [lab.cpt, ...lab.flex].every(nm => nm && (engine.P.has(nm)) && idsOf(nm)[0] && idsOf(nm)[1]);
  const idsOf = nm => { const pl = players(); return (pl && pl.ids && pl.ids.get(nm)) || ['', '']; };

  // Projected points vs the cut ladder for the Lab's field size (cut_lines, the same data as Step 5).
  const cutBlock = (X, n, has) => {
    const S = SD(), cuts = S.data.cut_lines; if (!cuts || !cuts.length) return '';
    const key = S.fieldBucket(fieldSize()), L = S.cutLadder(cuts, key), t1 = L.tiers.find(t => t.key === 'cut_top1');
    if (!L.contests || !t1 || t1.median == null) return '';
    const head = `<span class="sd-lab-k" style="margin-top:10px">Score you need <small>${esc(S.CONTEST_SHORT[key])} fields · ${L.contests} contest${L.contests === 1 ? '' : 's'} · <span class="${L.slates.length < 3 ? 'warn' : ''}">${L.slates.length} slate${L.slates.length === 1 ? '' : 's'}</span></small></span>`;
    if (!has.proj) return `${head}<div class="sd-unlock">Top-1% cuts in past ${esc(S.CONTEST_SHORT[key])} fields ran <b>${t1.min.toFixed(1)}–${t1.max.toFixed(1)}</b> pts (median ${t1.median.toFixed(1)}). Load a projections file in <a href="nfl/showdown/#sdLabPro" data-jump="sdLabPro" class="sd-link">Your slate</a> to see this lineup's projected points against the <a href="nfl/showdown/#step5" data-jump="step5" class="sd-link">cut ladder</a>.</div>`;
    if (n < 6) return `${head}<div class="sd-unlock">Fill all six slots to set the lineup's projection against the cuts.</div>`;
    const proj = S.lineupProj(X.cpt.proj, X.fl.map(p => p.proj));
    return `${head}<div class="sd-cutvs">
        <div class="sd-cutvs-proj"><b>${FX.num('lab.proj', proj, 1)}</b><small>projected pts · CPT 1.5×</small></div>
        ${S.projVsCuts(proj, L).map(r => `<div class="sd-cutvs-row${r.gap >= 0 ? ' over' : ''}"><span>${esc(r.label)}</span><b>${r.median.toFixed(1)}</b><em>${r.gap >= 0 ? '+' : '−'}${Math.abs(r.gap).toFixed(1)}</em><small>${r.min.toFixed(1)}–${r.max.toFixed(1)}</small></div>`).join('')}
      </div>
      <div class="sd-own-note">Cut = median past score for the tier (range across ${L.slates.length} slates); gold = your projection clears it. A projection is a median outcome and a top-1% finish takes a ceiling game, and cuts move with how much the game scores, so read the gap, not a pass/fail.</div>
      ${labSim(X)}`;
  };
  // The sim on the Lab's own lineup (the same draws as Build it for me): how often these six clear the moving cut.
  const labSim = X => {
    if (!simOk() || !getSpec()) return '';
    const W = worldNow(), c = W ? simCutsNow() : null;
    if (!W) return '<div class="sd-own-note">Simulating the game for the top-1% chance…</div>';
    if (!c) return '';
    const s = SB.simStats(W, X.cpt.name, X.fl.map(p => p.name), c);
    return `<span class="sd-lab-k" style="margin-top:10px">Top-1% sim <small>${W.D.toLocaleString('en-US')} correlated draws · ${esc(c.label)} · <span class="${c.top1.small ? 'warn' : ''}">n = ${c.top1.n} contests</span></small></span>
      <span class="sd-sim-line lab"><span><em>Top 1%</em><b>${pctTxt(s.top1)}</b></span><span><em>Cash</em><b>${pctTxt(s.cash)}</b></span><span><em>Median</em><b>${s.med.toFixed(1)}</b></span><span><em>90th</em><b>${s.p90.toFixed(1)}</b></span></span>
      <div class="sd-own-note">Top 1% = the share of draws in which this lineup clears ${c.top1.pct}% of that draw's best lineup (the cut moves with the game); a random entry has 1%. Median / 90th = its score over the draws, CPT 1.5×.</div>`;
  };

  // The three lines a share card carries: hard-rule breaks, then the biggest penalties,
  // then bonuses; a clean lineup falls back to its rule tally and story fit.
  const reportLines = r => {
    const rules = r.rules.filter(x => x.status !== 'na'), out = [];
    rules.filter(x => x.status === 'fail').forEach(x => out.push({ kind: 'fail', text: `${x.label}${x.msg ? ` — ${x.msg}` : ''}` }));
    r.pen.filter(p => p[1] > 0).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => out.push({ kind: 'pen', text: `${k} −${v.toFixed(2)}` }));
    r.pen.filter(p => p[1] < 0).sort((a, b) => a[1] - b[1]).forEach(([k, v]) => out.push({ kind: 'bonus', text: `${k} +${Math.abs(v).toFixed(2)}` }));
    out.push({ kind: rules.some(x => x.status === 'fail') ? 'fail' : 'pass', text: `${rules.filter(x => x.status === 'pass').length}/${rules.length} engine rules pass` });
    out.push({ kind: 'info', text: `story fit ${r.fit.toFixed(2)} · ${r.X.ctype.replace('_', ' ')} captain template` });
    return out.slice(0, 3);
  };
  // Complete lineup → the play card's lineup panel (showdown.js playCardPng); else null.
  const cardData = () => {
    if (!engine || filled() < 6) return null;
    const r = scoreCurrent(); if (!r) return null;
    const d = SD().derive(), odds = SD().scriptOdds(SD().data.base_rates.by_spread[d.sb]), tag = r.script.tag;
    const slots = [lab.cpt, ...lab.flex].map((nm, i) => { const p = engine.P.get(nm); return { cpt: i === 0, name: p.name, pos: p.pos, team: p.team, side: p.team === engine.A.fav ? 'fav' : 'dog', sal: i === 0 ? p.sal * 1.5 : p.sal }; });
    return { slots, score: codexScore(r), legal: !r.hard.length, verdict: verdictFor(r, 6), tag, scriptName: SCRIPT_NAME[tag], odds: Math.round(odds[tag]), plan: Math.round(d.alloc[tag]),
      lines: reportLines(r), pool: lab.source === 'mine' ? (lab.mine ? lab.mine.label : 'your slate') : (curPool() ? curPool().label : ''), salary: salaryUsed() };
  };
  // What a shared link carries from the Lab: the sample pool + the lineup as tokens.
  let urlReady = false;   // until boot has applied a linked lineup, the page keeps what the URL came with
  const urlInfo = () => {
    if (!urlReady) return null;
    const pl = engine ? players() : null;
    return { slate: lab.source === 'sample' ? lab.poolId : null, lu: pl ? SD().lineupTokens({ cpt: lab.cpt, flex: lab.flex }, pl.ids) : null };
  };

  // Est. dupes with every player at the low / high end of the band of the ownership the engine uses.
  const dupesRange = X => {
    const all = [X.cpt, ...X.fl].map(p => ownOf(p.name));
    if (!engine || all.some(o => !o || !o.used.fb || !o.used.cb)) return null;
    const at = e => SD().estDupes(engine.A.field, all[0].used.cb[e], all.slice(1).map(o => o.used.fb[e]));
    return { lo: at('lo'), hi: at('hi') };
  };
  const dupeFmt = v => v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString('en-US');
  const ownNote = () => {
    if (!OC) return 'Ownership here is <b>Stokastic raw</b> from your file (the correction file did not load).';
    const cv = OC.cv || {}, f = cv.flex && cv.flex.nested_loso, c = cv.cpt && cv.cpt.nested_loso, n = (OC.training && OC.training.slates || []).length;
    const fit = f && c ? ` Held-out (nested leave-one-slate-out) error on ${n} slates: CPT ${c.mae_raw} → ${c.mae_corr}, FLEX ${f.mae_raw} → ${f.mae_corr} pts (FLEX is marginal): a first read, with n = ${n} slates.` : '';
    return useCorr()
      ? `Ownership here is <b>BirdieBuddy-corrected</b>: your Stokastic file with our role correction (v${esc(OC.version)}: small shrunken fixes for kickers, the dog DST and a few chalk cells, FLEX rescaled to 500%, CPT to 100%).${fit} Switch it off above to grade on Stokastic raw.`
      : `Ownership here is <b>Stokastic raw</b> from your file. Switch on <b>Use corrected ownership</b> above for BirdieBuddy's role correction.${fit}`;
  };

  const STATUS_ICON = { pass: '✓', fail: '✗', pending: '…', unknown: '?', na: '·' };
  const renderReport = (r, n) => {
    const host = $('sdLabReport'); if (!host) return;
    if (!r) { host.innerHTML = `<div class="card-title">Engine report</div><p class="sd-lede">Every rule the engine enforces lights up here as you build: ${SD().data ? Object.keys(SD().data.hard_rules).length : 21} hard rules, ${SD().data ? Object.keys(SD().data.soft_penalties).filter(k => !k.startsWith('_')).length : 15} soft penalties, the overlay adjustments for this slate, and the captain template your lineup should fit.</p>`; return; }
    const prev = FX.snapshot(host);
    const X = r.X, rules = r.rules.filter(x => x.status !== 'na');
    const order = { fail: 0, pending: 1, unknown: 2, pass: 3 };
    rules.sort((a, b) => order[a.status] - order[b.status]);
    const passN = rules.filter(x => x.status === 'pass').length;
    const t = r.template, has = engine.has, bb = bbOwn(), dr = has.own && n >= 6 ? dupesRange(X) : null;
    const ct = SD().data.inputs.contest_types.find(c => c.key === SD().state.contest);
    const own = (ct && /(\d+)\D+(\d+)/.exec(ct.own_target)) || null;
    const vb = (kind, k) => SD().vBadge(SD().data, SD().ruleById(SD().data, SD().tmplRuleId(X.ctype, kind, k)), { mini: true });   // 2026 check (tooltip leads with the history)
    const featChip = (k, kind) => { const on = X.feats[k]; return `<span class="${kind === 'inc' ? (on ? 'sd-chip-ok' : 'sd-chip-n dim') : (on ? 'sd-chip-no' : 'sd-chip-n dim')}">${kind === 'inc' ? (on ? '✓' : '○') : (on ? '✗' : '○')} ${esc(FEAT_LABEL[k] || k)}${vb(kind, k)}</span>`; };
    const penRows = r.pen.map(([k, v]) => `<div class="sd-pen ${v < 0 ? 'bonus' : ''}"><span>${esc(k)}</span><b>${v < 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}</b></div>`).join('')
      + (r.pending || []).map(([k, v]) => `<div class="sd-pen pending"><span>${esc(k)} <small>pending — fill the lineup</small></span><b>−${Math.abs(v).toFixed(2)}?</b></div>`).join('');
    host.innerHTML = `
      <div class="sd-rep-head"><div class="card-title">Engine report · <span class="card-title-accent">${esc(X.ctype.replace('_', ' '))} captain</span></div>
        <span class="sd-rep-tally"><b class="${rules.some(x => x.status === 'fail') ? 'neg' : 'pos'}">${passN}/${rules.length}</b> rules pass</span></div>
      <div class="sd-rep-grid">
        <div class="sd-rep-block">
          <span class="sd-lab-k">Hard rules <small>a break = rejected</small></span>
          <div class="sd-rules">${rules.map(x => `<div class="sd-rule ${x.status}"><i>${STATUS_ICON[x.status]}</i><span>${esc(x.label)}${x.msg ? `<small>${esc(x.msg)}</small>` : x.status === 'unknown' ? '<small>needs an ownership / optimal file</small>' : x.status === 'pending' ? '<small>fill the lineup to settle</small>' : ''}</span></div>`).join('')}</div>
        </div>
        <div class="sd-rep-block">
          <span class="sd-lab-k">Story fit <small>captain template ${esc(X.ctype)}</small></span>
          ${t ? `<div class="sd-fit"><div class="sd-fit-bar"><i data-m="lab.fit" style="width:${Math.max(0, Math.min(100, r.fit * 100)).toFixed(1)}%"></i></div><b>${FX.num('lab.fitv', r.fit, 2)}</b></div>
          <div class="sd-tmpl">${t.include.map(k => featChip(k, 'inc')).join('')}</div>
          <div class="sd-tmpl">${t.avoid.map(k => featChip(k, 'avd')).join('')}<span class="${t.shapes.includes(X.split) ? 'sd-chip-ok' : 'sd-chip-no'}">shape ${esc(X.split)}${t.shapes.includes(X.split) ? '' : ` · wants ${esc(t.shapes.join('/'))}`}${vb('shape')}</span></div>
          <div class="sd-caption">Template = the historical ${esc(X.ctype)} winners. Square = its 2026 check · ${SD().checkLegend ? SD().checkLegend() : ''} · hover for the history</div>`
          : `<p class="sd-lede">No captain template for ${esc(X.ctype)} — the codex never saw one win.</p>`}
          <span class="sd-lab-k" style="margin-top:10px">Penalties &amp; overlays <small>subtracted from the score</small></span>
          <div class="sd-pens">${penRows || '<div class="sd-pen clean"><span>No penalties — clean build</span><b>0</b></div>'}
            <div class="sd-pen total"><span>fit − penalties</span><b>${(r.fit - r.penSum >= 0 ? '+' : '−') + Math.abs(r.fit - r.penSum).toFixed(2)}</b></div></div>
        </div>
        <div class="sd-rep-block">
          <span class="sd-lab-k">The build</span>
          <div class="sd-facts">
            <div><span>Shape</span><b>${esc(X.split)}</b><small>${X.five_one_fav ? '5-1 favorite' : X.side === 'FAV' ? 'fav captain' : 'dog captain'}</small></div>
            <div><span>Kicker</span><b>${X.k_n}</b><small>${X.k_n ? 'in' : 'none'}</small></div>
            <div><span>DST</span><b>${X.dst_n}</b><small>${X.dst_n ? 'in' : 'none'}</small></div>
            <div><span>Both QBs</span><b>${X.feats.both_qbs ? 'yes' : 'no'}</b><small>dog QB ${X.dog_qb ? 'in' : 'out'}</small></div>
          </div>
          <span class="sd-lab-k" style="margin-top:10px">Ownership &amp; dupes${bb ? ` <small>BB proj · ${esc(bb.own_quality || 'rough')}</small>` : stokOwn() ? ` <small>${useCorr() ? 'BirdieBuddy-corrected' : 'Stokastic raw'}</small>` : ''}</span>
          ${has.own ? `<div class="sd-facts">
            <div><span>Cum own</span><b>${FX.num('lab.cum', X.cum, 0, { post: '%' })}</b><small>target ${esc(ct ? ct.own_target : '')}${own ? (X.cum >= +own[1] && X.cum <= +own[2] ? ' ✓' : ' ✗') : ''}</small></div>
            <div><span>Est. dupes</span><b>${FX.num('lab.dupes', X.est_dupes, X.est_dupes < 10 ? 1 : 0)}</b><small>gate ≤ ${r.dupes.gate}${r.dupes.ok ? ' ✓' : ' ✗'}${dr ? ` · range ${dupeFmt(dr.lo)}–${dupeFmt(dr.hi)}` : ''}</small></div>
            <div><span>CPT own</span><b>${X.cpt.cpt_own.toFixed(1)}%</b><small>${has.cpt_opt ? `opt ${X.cpt.cpt_opt.toFixed(1)}%` : bb ? 'BB proj' : 'no optimal %'}</small></div>
            <div><span>Field</span><b>${(engine.A.field / 1000).toFixed(engine.A.field < 10000 ? 1 : 0)}k</b><small>dupes = field × Π own × 6</small></div></div>
            ${stokOwn() ? `<div class="sd-own-note">${ownNote()}${dr ? ` Dupes range ${dupeFmt(dr.lo)}–${dupeFmt(dr.hi)}: all six at the low / high end of their 80% ownership band, an outer bound.` : ''} Computed in your browser; nothing from your file is saved or put in a link.</div>` : ''}
            ${bb ? `<div class="sd-own-note">Ownership here is <b>BB proj</b>: ${esc(bb.own_source)} — rough, good for chalk / mid / under-3% tiers and a dupe warning, not precise CPT ownership.${dr ? ` Dupes range ${dupeFmt(dr.lo)}–${dupeFmt(dr.hi)}: all six at the low / high end of the model's held-out 80% band (${OC ? esc(String(OC.bands.bb_model_note || '').split(':')[0]) : ''}), an outer bound.` : ''} Drop your Stokastic Data Hub export into <a href="nfl/showdown/#sdLabPro" data-jump="sdLabPro" class="sd-link">Your slate</a> for projections, CPT-optimal and the punt rule.</div>` : ''}`
          : `<div class="sd-unlock">This pool has public DraftKings fields only. Drop your Stokastic Data Hub export into <a href="nfl/showdown/#sdLabPro" data-jump="sdLabPro" class="sd-link">Your slate</a> to check ownership, dupes, CPT-optimal and the punt rule.</div>`}
          ${cutBlock(X, n, has)}
        </div>
      </div>
      <details class="sd-fold"><summary>How the codex score works <span class="sd-fold-arrow">▸</span></summary>
        <p class="sd-lede" style="margin-top:6px">Codex score = 50 + 50 × (story fit − penalties), held to 0–100. Story fit = share of the captain template's <em>include</em> items present − ½ × share of its <em>avoid</em> items present; penalties are the soft rules and overlay adjustments above, straight from rules.json. These are the same lineup terms <code>rules_engine.py</code> adds to its sim ranking (the JS engine is parity-tested against it on 38k lineups). A hard-rule break rejects the lineup whatever the score.</p></details>`;
    FX.morph(prev, host);
  };

  const renderNote = () => {
    const el = $('sdLabNote'); if (!el) return;
    const s = SD().state, preset = (SD().slates || []).find(x => x.id === s.preset);
    const pool = curPool();
    const d = SD().derive();
    const ov = Object.keys(d.ov).filter(k => d.ov[k]);
    let msg = `Grading against <b>${esc(engine ? engine.A.fav : '')} −${s.spread} · total ${s.total} · ${esc(SD().ENV_LABEL[s.env])}</b>${ov.length ? ` · <span class="gold">${ov.map(k => k.toUpperCase()).join(' + ')}</span> overlay` : ''} — from Step 1.`;
    const slate = (SD().slates || []).find(x => pool && x.id === pool.id);
    const same = slate && +slate.spread === +s.spread && +slate.total === +s.total && slate.env === s.env;
    if (lab.source === 'sample' && pool && !same) msg += ` <span class="warn">What-if: the rail isn't set to ${esc(pool.label)}'s line.</span> <button type="button" class="sd-link" data-lab-sync>Load its line</button>`;
    else msg += ' Move the sliders and watch the grade react.';
    el.innerHTML = msg;
  };

  /* ---------------- Step 3: leverage board ---------------- */
  // The Lab pool's roles against the historical winners (role_rates): where the projected ownership sits below how
  // often a role shows up in winning lineups (leverage) and where the field is projected past anything the winners
  // did (over-owned), then the 2026 field check, history first. Thin matches are greyed and never headlined.
  const FG_TEXT = {
    field_gap: g => `The 2026 field plays this ${g.field_minus_hist < 0 ? 'less' : 'more'} than the winners did (${sgn(g.field_minus_hist)} pts), and the top 1% moved back toward history (${sgn(g.top1_minus_field)} pts vs the field; ${g.top1_minus_field > 0 ? 'above' : 'below'} the field on ${g.top1_minus_field > 0 ? g.slates_top1_above_field : g.slates_top1_below_field} of ${g.slates_n} slates).`,
    field_differs_top1_agrees_with_field: g => `The 2026 field plays this ${g.field_minus_hist < 0 ? 'less' : 'more'} than the winners did (${sgn(g.field_minus_hist)} pts), but the top 1% played it like the field (${sgn(g.top1_minus_field)} pts vs the field): history is the only evidence for the gap.`
  };
  const renderLevBoard = () => {
    const host = $('sdLevBoard'); if (!host) return;
    const RR = SD().data && SD().data.role_rates;
    if (!RR) { host.hidden = true; return; }
    host.hidden = false;
    const poolName = lab.source === 'mine' && lab.mine ? `your slate · ${lab.mine.label}` : curPool() ? curPool().label : 'the Lab pool';
    const head = `<div class="card-title">Leverage board · <span class="card-title-accent">${esc(poolName)}</span></div>`;
    if (!engine) { host.innerHTML = `${head}<p class="sd-lede">${esc(lab.err || 'Loading the Lab pool…')}</p>`; return; }
    if (!lev) { host.innerHTML = `${head}<div class="sd-unlock">This pool has no ownership, so there is nothing to set against the winners' role rates. Pick a sample slate in the <a href="nfl/showdown/#step4" data-jump="step4" class="sd-link">Lab</a> (BB model ownership) or drop your Stokastic Data Hub export into <a href="nfl/showdown/#sdLabPro" data-jump="sdLabPro" class="sd-link">Your slate</a>.</div>`; return; }
    const C = RR.cohorts[lev.cohort], rows = [];
    for (const r of Object.values(lev.roles)) if (r.players.length) for (const slot of ['cpt', 'flex']) rows.push({ r, slot, x: r[slot] });
    const ranked = rows.filter(o => !o.r.thin && !o.r.split);
    const top = ranked.filter(o => Math.round(o.x.lev * 10) > 0).sort((a, b) => b.x.lev - a.x.lev).slice(0, 5);
    const over = ranked.filter(o => Math.round(o.x.lev * 10) < 0).sort((a, b) => a.x.lev - b.x.lev).slice(0, 5);
    const thin = rows.filter(o => o.r.thin && !o.r.split && Math.abs(o.x.lev) >= 5).sort((a, b) => Math.abs(b.x.lev) - Math.abs(a.x.lev)).slice(0, 4);
    const split = rows.filter(o => o.r.split && Math.abs(o.x.lev) >= 5).sort((a, b) => Math.abs(b.x.lev) - Math.abs(a.x.lev));
    const who = r => r.players.length > 3 ? `${r.players.slice(0, 3).join(', ')} +${r.players.length - 3}` : r.players.join(', ');
    const row = o => {
      const { r, slot, x } = o, gap = SD().fieldGapFor(RR, r.side, r.pos, slot), inCi = x.ci && (x.ci[1] - x.ci[0]) / 2 > Math.abs(x.lev);
      return `<div class="sd-levb-row${r.thin ? ' thin' : ''}">
        <span class="sd-levb-slot">${slot === 'cpt' ? 'CPT' : 'FLEX'}</span>
        <span class="sd-levb-role"><b>${esc(r.label)}</b><small>${esc(who(r))}${gap ? ` · <span class="sd-levb-chk" title="${esc(`2026 check: history ${gap.hist}% · 2026 field ${gap.field_2026}% · top 1% ${gap.top1_2026}% (${gap.slates_n} primetime slates). Annotates only; never changes a rule.`)}">2026 check</span>` : ''}</small></span>
        <span class="sd-levb-num"><b>${x.hist.toFixed(1)}${x.per100 ? '' : '%'}</b><small>${x.per100 ? 'per 100' : `${x.k}/${lev.n} winners`}</small></span>
        <span class="sd-levb-num"><b>${x.own.toFixed(1)}%</b><small>proj own</small></span>
        <span class="sd-levb-lev"><b>${sgn(x.lev)}</b><small class="${inCi ? 'warn' : ''}" title="90% CI of the historical rate">${inCi ? 'inside CI ' : 'CI '}${ci(x.ci)}</small></span>
      </div>`;
    };
    const list = (title, sub, xs) => `<div class="sd-levb-col"><span class="sd-lab-k">${title} <small>${sub}</small></span>${xs.length ? xs.map(row).join('') : '<div class="sd-pen clean"><span>None on this slate</span></div>'}</div>`;
    const FG = RR.field_gap, gaps = [];
    if (FG && FG.families) for (const [fam, v] of Object.entries(FG.families)) for (const slot of ['flex', 'cpt']) { const g = v[slot]; if (g && FG_TEXT[g.label]) gaps.push({ fam, slot, g }); }
    gaps.sort((a, b) => (a.g.label === 'field_gap' ? 0 : 1) - (b.g.label === 'field_gap' ? 0 : 1));
    const famName = f => { const [side, pos] = f.split('_'); return `${side === 'FAV' ? 'Fav' : 'Dog'} ${pos}`; };
    const hc = RR.cohorts[FG && FG.hist_cohort] || C;
    const html = `${head}
      <p class="sd-lede">How often each role shows up in the historical winning lineups, set against this pool's projected ownership: <b>leverage = historical rate − projected ownership</b> (points, CPT and FLEX apart). History: ${C.n} primetime winners, ${esc(engine.A.fav)} −${engine.A.spread} → the <b>${esc(SD().LEV_BUCKET_LABEL[lev.bucket])}</b> row (n = ${lev.n}). Ownership: <b>${esc(ownLabel())}</b>.</p>
      <div class="sd-levb-grid">
        ${list('Top leverage seats', 'winners used the role more than the field is projected to', top)}
        ${list('Most over-owned seats', 'the field is projected past what winners did', over)}
      </div>
      ${split.length ? `<div class="sd-caption"><span class="warn">Split ${split.every(o => o.r.pos === 'K') ? 'kickers' : split.every(o => o.r.pos === 'DST') ? 'defenses' : 'K / DST'}, not ranked:</span> ${split.map(o => `${esc(o.r.label)} ${o.slot === 'cpt' ? 'CPT' : 'FLEX'} ${sgn(o.x.lev)} (${esc(who(o.r))})`).join(' · ')}. The pool lists more than one ${split.every(o => o.r.pos === 'K') ? 'kicker' : 'K / DST'} for the team, each projected at 5%+ own, and the role adds them up while the field will split one player's worth. That is an ownership-model issue to fix, not leverage.</div>` : ''}
      ${thin.length ? `<div class="sd-caption">Thin matches, not ranked (salary outside the price the role's winners had): ${thin.map(o => `${esc(o.r.label)} ${o.slot === 'cpt' ? 'CPT' : 'FLEX'} ${sgn(o.x.lev)} (${esc(who(o.r))})`).join(' · ')}</div>` : ''}
      ${gaps.length ? `<span class="sd-lab-k" style="margin-top:12px">2026 field check <small>${FG.slates.length} primetime slates${(FG.excluded || []).length ? ` · ${esc(FG.excluded.map(e => e.slate.replace(/^2026-wk\d+-/, '').toUpperCase().replace('-', '@')).join(', '))} excluded (injury-distorted)` : ''} · the field archive splits by position and side, not depth · annotates, never changes a rule</small></span>
      <div class="sd-sure-gaps">${gaps.map(({ fam, slot, g }) => `<div><b>${esc(famName(fam))} · ${slot === 'cpt' ? 'captain' : 'FLEX'}</b><span>History ${g.hist}% of ${hc.n} primetime winners · 2026 field ${g.field_2026}% · top 1% ${g.top1_2026}%</span><small>${esc(FG_TEXT[g.label](g))}</small></div>`).join('')}</div>` : ''}
      <div class="sd-caption">The historical rate is how often a role appears in winning lineups (codex role_rates: ${C.n} primetime winners, 90% Wilson CIs), not a projection for this game. Roles: side × depth by salary rank among active players (QB1, RB1, RB2+, WR1–3+, TE1, TE2+, K, DST); a multi-player role (RB2+, WR3+, TE2+, K, DST) sums its players and counts role players per 100 lineups. "Inside CI" = the gap is smaller than the history's own uncertainty. Same numbers as the Lab's Lev column.</div>`;
    if (host.dataset.drawn !== html) { host.innerHTML = html; host.dataset.drawn = html; }
  };

  /* ---------------- master ---------------- */
  const render = () => {
    if (!SD() || !SD().data || !$('sdLab')) return;
    const restore = FX.keepFocus();
    buildEngine();
    const pl = players();
    const key = `${lab.source}|${lab.poolId}|${lab.mine ? lab.mine.stamp : ''}|${pl ? pl.has.own : ''}|${pl ? favTeam(pl) : ''}|${pl ? [...new Set([...pl.P.values()].map(p => p.team))].sort().join() : ''}|${stokOwn()}|${!!OC}`;
    if (lab.built !== key) skeleton();
    // drop names that aren't in this pool
    if (engine) { if (lab.cpt && !engine.P.has(lab.cpt)) lab.cpt = null; lab.flex = lab.flex.map(n => n && engine.P.has(n) ? n : null); }
    renderNote(); renderPool(); renderLineup(); renderAuto(); renderLevBoard();
    simStep();   // draws for this player set when projections are loaded (cached; a no-op otherwise)
    const fld = $('sdLabField'); if (fld && document.activeElement !== fld) fld.value = fieldSize();
    const fl = $('sdLabFieldLink'); if (fl) { const t = linkOn() ? `from Step 5: ${shortName(lab.link.name)}` : lab.field ? 'set by hand' : `Step 1 default (${SD().CONTEST_SHORT[SD().state.contest] || ''})`; if (fl.textContent !== t) fl.textContent = t; }
    renderWhere(); renderRoutine(); foldAns();
    const go = $('sdBatchGo'); if (go) go.disabled = !engine;
    const lbl = $('sdBatchLabel'); if (lbl) lbl.textContent = `${pro.lineupsName ? pro.lineupsName + ' · ' : ''}scored against ${lab.source === 'mine' && lab.mine ? 'your slate' : curPool() ? curPool().label : 'the selected pool'} and the Step 1 line`;
    syncBatch();
    SD().syncUrl();
    restore();
    FX.reveal();
  };

  /* ---------------- events ---------------- */
  const bindSkeleton = () => {
    const q = $('sdPoolQ');
    q.addEventListener('input', () => { lab.q = q.value; renderPool(); });
    q.addEventListener('keydown', e => {
      if (e.key === 'Enter') { const first = $('sdPoolList').querySelector('[data-lab-add]'); if (first) { const nm = first.dataset.labAdd, was = slotOf(nm); addFlex(nm); trackAdd(nm, was, 'search'); lab.q = ''; q.value = ''; render(); q.focus(); } }
      if (e.key === 'ArrowDown') { const r = $('sdPoolList').querySelector('[data-lab-add][tabindex="0"]') || $('sdPoolList').querySelector('[data-lab-add]'); if (r) { e.preventDefault(); r.focus(); } }
    });
    $('sdPoolSort').addEventListener('change', e => { lab.sort = e.target.value; renderPool(); save(); });
    // Whichever row takes focus (keyboard or a tap) becomes the list's one tab stop.
    $('sdPoolList').addEventListener('focusin', e => {
      const r = e.target.closest('[data-lab-add]'); if (!r || r.getAttribute('tabindex') === '0') return;
      lab.rowFocus = r.dataset.labAdd;
      e.currentTarget.querySelectorAll('[data-lab-add][tabindex="0"]').forEach(x => x.setAttribute('tabindex', '-1')); r.setAttribute('tabindex', '0');
    });
    const f = $('sdLabField');
    f.addEventListener('change', () => { const v = Math.round(+f.value); lab.field = v >= 100 ? v : null; if (lab.link && +lab.link.field !== lab.field) { lab.link = null; saveLink(null); } render(); });
    const cr = $('sdLabCorr');
    if (cr) cr.addEventListener('change', () => { lab.corr = cr.checked; SD().toast(cr.checked ? '<b>Corrected ownership on</b>: the engine grades with BirdieBuddy-corrected Stokastic' : '<b>Corrected ownership off</b>: the engine grades with Stokastic raw'); render(); save(); });
  };
  const switchPool = async id => {
    stash(); lab.source = 'sample'; lab.poolId = id; unstash();
    try { await fetchPool(id); } catch (e) { lab.err = e.message; }
    render();
  };
  const onClick = e => {
    const t = e.target;
    const cptB = t.closest('[data-lab-cpt]'); if (cptB) { const nm = cptB.dataset.labCpt, was = slotOf(nm); if (lab.cpt === nm) removeName(nm); else setCpt(nm); trackAdd(nm, was, 'cpt_button'); render(); return; }
    const flexB = t.closest('[data-lab-flex]'); if (flexB) { const nm = flexB.dataset.labFlex, was = slotOf(nm); addFlex(nm); trackAdd(nm, was, 'add_button'); render(); return; }
    const row = t.closest('[data-lab-add]'); if (row) { const nm = row.dataset.labAdd, was = slotOf(nm); lab.rowFocus = nm; addFlex(nm); trackAdd(nm, was, 'row'); render(); return; }
    const rm = t.closest('[data-lab-remove]'); if (rm) { removeName(rm.dataset.labRemove); render(); return; }
    const sg = t.closest('[data-lab-sug]'); if (sg) { const nm = sg.dataset.labSug, was = slotOf(nm); if (sg.dataset.as === 'cpt') setCpt(nm); else addFlex(nm); trackAdd(nm, was, 'suggestion'); render(); return; }
    const pos = t.closest('[data-lab-pos]'); if (pos) { lab.pos = pos.dataset.labPos; skeletonFilters(); renderPool(); return; }
    const tm = t.closest('[data-lab-team]'); if (tm) { lab.team = tm.dataset.labTeam; skeletonFilters(); renderPool(); return; }
    const pb = t.closest('[data-lab-pool]'); if (pb) { const id = pb.dataset.labPool; track('preset_select', { id, from: 'lab' }); syncPreset(id); switchPool(id); return; }
    if (t.closest('[data-lab-mine]')) { stash(); lab.source = 'mine'; unstash(); render(); return; }
    const fv = t.closest('[data-lab-fav]'); if (fv) { lab.mineFav = fv.dataset.labFav; render(); return; }
    if (t.closest('[data-lab-sync]')) { syncPreset(lab.poolId); return; }
    const act = t.closest('[data-lab-act]'); if (act) { labAction(act.dataset.labAct, act); return; }
    const au = t.closest('[data-auto]'); if (au) { autoAction(au.dataset.auto, au); return; }
    const al = t.closest('[data-auto-load]'); if (al) { autoLoad(al.dataset.autoLoad); return; }
  };
  const skeletonFilters = () => {
    document.querySelectorAll('[data-lab-pos]').forEach(b => { b.classList.toggle('on', b.dataset.labPos === lab.pos); b.setAttribute('aria-pressed', String(b.dataset.labPos === lab.pos)); });
    document.querySelectorAll('[data-lab-team]').forEach(b => { b.classList.toggle('on', b.dataset.labTeam === lab.team); b.setAttribute('aria-pressed', String(b.dataset.labTeam === lab.team)); });
  };
  // Load a sample slate's line into Step 1 (the page re-renders → the lab follows).
  const syncPreset = id => {
    const s = (SD().slates || []).find(x => x.id === id); if (!s) return;
    Object.assign(SD().state, { spread: s.spread, total: s.total, env: s.env, preset: s.id, realized: null });
    SD().render();
  };
  const copyText = async (text, btn, okMsg) => {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {}
    if (!ok) { try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch {} }
    SD().toast(ok ? okMsg : 'Copy failed — your browser blocked the clipboard', ok ? '' : 'warn');
  };
  // Paste is forgiving (the engine's resolve stays strict for parity):
  // exact / "Name (id)" / DK id → unique last name → unique substring.
  const looseResolve = x => {
    const hit = engine.resolve(x); if (hit) return hit;
    const q = x.trim().toLowerCase().replace(/\s*\(\d+\)$/, ''); if (!q) return null;
    const names = [...engine.P.keys()];
    const last = names.filter(n => n.toLowerCase().split(/\s+/).includes(q.split(/\s+/).pop()) && (q.split(/\s+/).length === 1 || n.toLowerCase()[0] === q[0]));
    if (last.length === 1) return last[0];
    const sub = names.filter(n => n.toLowerCase().includes(q));
    return sub.length === 1 ? sub[0] : null;
  };
  const labAction = (a, btn) => {
    if (a === 'clear') { clearLineup(); render(); return; }
    if (a === 'paste') { const p = $('sdPaste'); p.hidden = !p.hidden; if (!p.hidden) $('sdPasteIn').focus(); return; }
    if (a === 'paste-go') {
      const raw = $('sdPasteIn').value.split(/[,\t\n;]+/).map(x => x.trim()).filter(Boolean);
      if (!engine) return;
      const names = raw.map(looseResolve);
      const bad = raw.filter((x, i) => !names[i]);
      if (bad.length || names.length < 1) { SD().toast(`Couldn't match: ${esc(bad.join(', ') || 'nothing pasted')}`, 'warn'); return; }
      const dup = names.filter((n, i) => names.indexOf(n) !== i);
      if (dup.length) { SD().toast(`${esc(dup[0])} appears twice — a showdown lineup needs six different players`, 'warn'); return; }
      fillFrom({ cpt: names[0], flex: names.slice(1, 6) }); render(); return;
    }
    if (a === 'copy') { copyText(`CPT ${lab.cpt}, ${lab.flex.join(', ')}`, btn, 'Lineup copied'); return; }
    if (a === 'dk') { copyText(`CPT,FLEX,FLEX,FLEX,FLEX,FLEX\n${[idsOf(lab.cpt)[1], ...lab.flex.map(n => idsOf(n)[0])].join(',')}`, btn, 'DK upload row copied — paste into your upload CSV'); return; }
  };
  const onKey = e => {
    if (e.target && e.target.id === 'sdPasteIn' && e.key === 'Enter') { e.preventDefault(); labAction('paste-go'); return; }
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      const lab_ = $('sdLab'); if (!lab_) return; const r = lab_.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) { e.preventDefault(); $('sdPoolQ').focus(); }
    }
    // Row shortcuts only when the row itself has focus (its C / + buttons handle their own Enter/Space).
    const row = e.target && e.target.matches && e.target.matches('[data-lab-add]') ? e.target : null;
    if (!row || e.metaKey || e.ctrlKey || e.altKey) return;
    const nm = row.dataset.labAdd;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const was = slotOf(nm); lab.rowFocus = nm; addFlex(nm); trackAdd(nm, was, 'key'); render(); return; }
    if (e.key === 'c' || e.key === 'C') { const was = slotOf(nm); lab.rowFocus = nm; setCpt(nm); trackAdd(nm, was, 'key'); render(); return; }
    // ↑ / ↓ / Home / End / PageUp / PageDown walk the list (the roving tab stop follows).
    const rows = [...row.parentNode.querySelectorAll('[data-lab-add]')], i = rows.indexOf(row);
    const j = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: rows.length - 1, PageDown: i + 8, PageUp: i - 8 }[e.key];
    if (j == null) return;
    e.preventDefault();
    const to = rows[Math.max(0, Math.min(rows.length - 1, j))];
    if (!to || to === row) { if (e.key === 'ArrowUp' && i === 0) $('sdPoolQ')?.focus(); return; }
    row.setAttribute('tabindex', '-1'); to.setAttribute('tabindex', '0'); lab.rowFocus = to.dataset.labAdd;
    to.focus({ preventScroll: true }); to.scrollIntoView({ block: 'nearest' });
  };

  /* =================================================================
     BUILD IT FOR ME — the engine searches the pool (showdown_build.js):
     every legal captain + 5 flex from the top players, graded like the
     Lab grades yours; for N > 1 the engine's select() picks the batch
     with the Step 3 script counts as its quotas.
     ================================================================= */
  let autoRun = null;   // { raf } while a search runs
  const autoDrawn = new WeakMap();   // host → the HTML it shows (a rebuilt skeleton = a new host = drawn again)
  // What a search depends on: pool + the engine's line / field (not the entry count).
  const searchKey = () => engine ? JSON.stringify([lab.source, lab.poolId, lab.mine && lab.mine.stamp, { ...engine.A, n: 0 }, useCorr()]) : '';

  /* ---------------- top-1% sim (2026-09-23; showdown_build.js SIM) ----------------
     With a projections file loaded: 2,000 correlated draws of the game (role correlations from nflverse box
     scores, lognormal marginals from Projection + Std Dev), the slate's best lineup in every draw, and the
     contest_economics.json cut lines as a share of it. Each kept lineup gets P(top 1%) and P(min cash); ranking
     can blend codex fit with P(top 1%). Runs in ~14 ms slices like the search; the draws are cached per player
     set, lineup results per lineup × cut. Nothing from the reader's file is stored or sent. */
  const RC_PATH = 'nfl/showdown/role_correlations.json', ECON_PATH = 'nfl/showdown/contest_economics.json';
  let RC = null, ECON = null, simDataP = null, simDataDone = false;
  const loadSimData = () => simDataP || (simDataP = Promise.all([RC_PATH, ECON_PATH].map(u => fetch(u, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null)))
    .then(([rc, ec]) => { if (rc && rc.cohorts && Array.isArray(rc.roles)) RC = rc; if (ec && ec.primetime) ECON = ec; simDataDone = true; }));
  const simTier = () => { const id = lab.source === 'mine' ? lab.mineBB && lab.mineBB.id : lab.poolId, s = (SD().slates || []).find(x => x.id === id); return SD().slateTier ? SD().slateTier(s) : 'primetime'; };
  const simOk = () => !!(SB && SB.simPrepare && RC && engine && engine.has.proj);
  let simSpec = { key: '', spec: null }, world = null, simRun = null;   // world = { key, W, ms }; simRun = { raf, phase, frac } while a job runs
  const getSpec = () => {
    if (!simOk()) return null;
    const k = `${lab.source}|${lab.poolId}|${lab.mine ? lab.mine.stamp : ''}|${simTier()}|${RC.generated}`;
    if (simSpec.key !== k) { let spec = null; try { spec = SB.simPrepare([...engine.P.values()], lab.source === 'mine' && lab.mine ? lab.mine.sd : null, RC, simTier()); } catch (e) { console.warn('[showdown] sim setup failed', e); } simSpec = { key: k, spec: spec && spec.n >= 6 ? spec : null }; }
    return simSpec.spec;
  };
  const simCutsNow = () => SB && SB.simCuts ? SB.simCuts(ECON, SD().data.cut_lines, simTier(), fieldSize()) : null;
  const worldNow = () => { const sp = getSpec(); return sp && world && world.key === sp.key ? world.W : null; };
  const simTag = () => { const A = lab.auto; return A && A.sim ? `${A.sim.worldKey}|${A.sim.cutsKey}` : ''; };
  const simReady = () => !!(lab.auto && lab.auto.sim && simOk());
  const simProgress = () => {
    const bar = $('sdSimBar'), txt = $('sdSimStat'); if (!simRun) return;
    if (bar) { bar.style.width = `${(simRun.frac * 100).toFixed(1)}%`; bar.parentNode.setAttribute('aria-valuenow', String(Math.round(simRun.frac * 100))); }
    if (txt) txt.textContent = simRunText();
  };
  const simRunText = () => !simRun ? '' : simRun.phase === 'draws' ? `Simulating the game · ${SB.SIM_DRAWS.toLocaleString('en-US')} correlated draws · ${Math.round(simRun.frac * 100)}%`
    : `Scoring ${(simRun.total || 0).toLocaleString('en-US')} kept lineups against the cut lines · ${Math.round(simRun.frac * 100)}%`;
  const slice = (gen, run, onDone) => {
    const tick = () => {
      if (simRun !== run) return;
      if (run.abort && run.abort()) { simRun = null; return; }
      const t = performance.now(); let r;
      do { r = gen.next(); } while (!r.done && performance.now() - t < 14);   // ~one frame of work, then let the page paint
      if (!r.done) { run.frac = r.value.frac; simProgress(); run.raf = requestAnimationFrame(tick); return; }
      simRun = null; onDone(r.value);
    };
    run.raf = requestAnimationFrame(tick);
  };
  // One job at a time: the draws for this player set (once), then the search's kept lineups at the current cut lines.
  const simStep = () => {
    if (simRun || !simOk()) return;
    const sp = getSpec(); if (!sp) return;
    if (!world || world.key !== sp.key) {
      const t0 = performance.now(), run = simRun = { raf: 0, phase: 'draws', frac: 0, abort: () => simSpec.spec !== sp };
      slice(SB.simWorld(sp, { draws: SB.SIM_DRAWS }), run, W => { world = { key: sp.key, W, ms: performance.now() - t0 }; render(); });
      if (lab.auto && lab.auto.st) renderAuto();
      return;
    }
    const A = lab.auto; if (!autoFresh()) return;
    const cuts = simCutsNow(); if (!cuts) return;
    if (A.sim && A.sim.cutsKey === cuts.key && A.sim.worldKey === sp.key) return;
    const rows = SB.ranked(A.st, 'codex'), t0 = performance.now();
    const run = simRun = { raf: 0, phase: 'lineups', frac: 0, total: rows.length, abort: () => lab.auto !== A || !autoFresh() };
    slice(SB.simLineups(world.W, rows, cuts), run, () => {
      SB.applyBlend(rows);
      const first = !A.sim;
      A.sim = { worldKey: sp.key, cutsKey: cuts.key, cuts, n: rows.length, ms: performance.now() - t0, best: rows.reduce((m, r) => Math.max(m, r.top1 || 0), 0), stats: new Map() };
      if (first) track('build_for_me', { result: 'sim', lineups: T().size(rows.length), secs: Math.round((A.sim.ms + (world.ms || 0)) / 100) / 10, cut: cuts.src, tier: cuts.tier, pool: lab.source });
      renderAuto(); renderLineup();
    });
    renderAuto();
  };
  // Median / 90th percentile need the lineup's whole distribution: computed for the lineups on screen only, cached.
  const simStatsFor = (A, r) => {
    const W = worldNow(); if (!W || !A.sim) return null;
    const k = `${r.key}|${A.sim.cutsKey}`; let s = A.sim.stats.get(k);
    if (!s) { s = SB.simStats(W, r.cpt, r.flex, A.sim.cuts); A.sim.stats.set(k, s); }
    return s;
  };
  const pctTxt = p => p == null ? '—' : p >= 0.095 ? `${Math.round(p * 100)}%` : `${(p * 100).toFixed(1)}%`;
  const RANK_LABEL = { codex: 'codex fit', top1: 'top-1% chance', blend: 'blend of codex fit and top-1% chance', proj: 'projection' };
  // Default: blend once the sim has run, codex fit before (and without projections). An explicit choice sticks.
  const autoMode = () => {
    const m = lab.autoMode || (simReady() ? 'blend' : 'codex');
    if (m === 'top1' || m === 'blend') return simReady() ? m : 'codex';
    return m === 'proj' && engine && engine.has.proj ? 'proj' : 'codex';
  };
  const autoPlan = () => { const N = SD().state.entries; return { N, counts: SD().largestRemainder(SD().derive().alloc, N) }; };
  const autoFresh = () => lab.auto && lab.auto.st && lab.auto.status !== 'running' && lab.auto.key === searchKey();
  const autoTop = () => {
    const A = lab.auto, m = autoMode();
    const tk = m + A.status + simTag();
    if (A.topKey !== tk) { A.top = SB.topCards(A.st, m, 12, 3); A.topKey = tk; }
    return A.top;
  };
  // The batch pick (select() over the kept lineups: ≈0.2 s on a desktop, ≈1 s on a slow phone) runs off the render
  // path, debounced, and in a Worker (the same engine + build files) when the browser gives us one, so the page
  // stays responsive; no Worker, or it fails → the same call inline.
  let pickT = 0, pickW = null, pickSeq = 0;
  const pickWorker = () => {
    if (pickW !== null) return pickW || null;
    pickW = false;
    try {
      const src = f => { const el = document.querySelector(`script[src*="${f}"]`); return el ? el.src : ''; };
      const a = src('showdown_engine.js'), b = src('showdown_build.js');
      if (!a || !b || typeof Worker === 'undefined' || typeof Blob === 'undefined' || !window.URL || !URL.createObjectURL) return null;
      const code = `importScripts(${JSON.stringify(a)}, ${JSON.stringify(b)});
let D = null;
onmessage = e => { const m = e.data; if (m.data) D = m.data;
  try { postMessage({ seq: m.seq, pick: self.BBI.showdownBuild.pickBatch(self.BBI.showdownEngine, D, m.pl, m.opts, m.st, m.counts, m.N, m.mode) }); }
  catch (err) { postMessage({ seq: m.seq, err: String((err && err.message) || err) }); } };`;
      pickW = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
      pickW.sentData = null;
    } catch { pickW = false; }
    return pickW || null;
  };
  const autoPick = (now) => {
    if (!autoFresh()) return null;
    const A = lab.auto, { N, counts } = autoPlan(); if (N < 2) return null;
    const k = JSON.stringify([N, counts, autoMode(), A.status, fieldSize(), simTag()]);
    if (A.pickKey === k) return A.pick;
    const run = () => {
      if (!autoFresh() || lab.auto !== A) return;
      try { A.pick = SB.pickBatch(SE, SD().data, players(), engineOpts(players()), A.st, counts, N, autoMode()); }
      catch (e) { console.warn('[showdown] batch pick failed', e); A.pick = { chosen: [], got: {}, want: {}, log: [], notes: [`batch pick failed: ${e.message}`], blockers: [], pool: 0, elig: 0 }; }
      A.pickKey = k;
    };
    if (now) { pickSeq++; run(); return A.pick; }
    const offThread = () => {
      const W = pickWorker(); if (!W) { run(); renderAuto(); return; }
      const seq = ++pickSeq, pl = players(), d = SD().data, mode = autoMode();
      const inline = () => { if (seq === pickSeq) { run(); renderAuto(); } };
      W.onmessage = e => {
        const m = e.data; if (m.seq !== pickSeq || !autoFresh() || lab.auto !== A) return;
        if (m.err) { console.warn('[showdown] batch pick (worker) failed', m.err); inline(); return; }
        A.pick = m.pick; A.pickKey = k; renderAuto();
      };
      W.onerror = e => { if (e && e.preventDefault) e.preventDefault(); pickW = false; W.terminate(); inline(); };
      const msg = { seq, pl, opts: engineOpts(pl), st: { buckets: A.st.buckets }, counts, N, mode };
      if (W.sentData !== d) { msg.data = d; W.sentData = d; }
      try { W.postMessage(msg); } catch { pickW = false; W.terminate(); inline(); }
    };
    clearTimeout(pickT); pickT = setTimeout(offThread, A.pick ? 220 : 0);
    return A.pick && A.pickKey !== k ? { ...A.pick, updating: true } : null;
  };
  const autoStat = st => st ? `${Math.round(st.frac * 100)}% · ${st.full.toLocaleString('en-US')} lineups graded · ${st.legal.toLocaleString('en-US')} legal` : 'starting…';
  const autoProgress = () => {
    const st = lab.auto && lab.auto.st, bar = $('sdAutoBar'), txt = $('sdAutoStat');
    if (bar) { bar.style.width = `${((st ? st.frac : 0) * 100).toFixed(1)}%`; bar.parentNode.setAttribute('aria-valuenow', String(Math.round((st ? st.frac : 0) * 100))); }
    if (txt) txt.textContent = `Searching · ${autoStat(st)}`;
  };
  const startAuto = () => {
    if (!engine || !SB) return;
    stopAuto(true);
    const gen = SB.search(engine, SD().data.hard_rules, { score: codexScore });
    const run = autoRun = { raf: 0 };
    lab.auto = { status: 'running', st: null, key: searchKey(), t0: performance.now(), ms: 0 };
    const tick = () => {
      if (autoRun !== run) return;
      const t = performance.now(); let r;
      do { r = gen.next(); } while (!r.done && performance.now() - t < 14);   // ~one frame of work, then let the page paint
      lab.auto.st = r.value;
      if (!r.done) { autoProgress(); run.raf = requestAnimationFrame(tick); return; }
      autoRun = null; lab.auto.status = 'done'; lab.auto.ms = performance.now() - lab.auto.t0;
      track('build_for_me', { result: 'done', entries: T().size(SD().state.entries), mode: autoMode(), legal: T().size(lab.auto.st.legal), secs: Math.round(lab.auto.ms / 100) / 10, pool: lab.source });
      renderAuto();
      const top = autoTop()[0];
      SD().toast(`<b>${lab.auto.st.legal.toLocaleString('en-US')} legal lineups graded</b>${top ? ` · best ${top.codex}: ${esc(top.cpt)} CPT` : ''}`, 'good');
    };
    renderAuto();
    run.raf = requestAnimationFrame(tick);
  };
  const stopAuto = silent => {
    if (!autoRun) return;
    cancelAnimationFrame(autoRun.raf); autoRun = null;
    if (silent) return;
    lab.auto.status = lab.auto.st ? 'stopped' : null; lab.auto.ms = performance.now() - lab.auto.t0;
    track('build_for_me', { result: 'stopped', entries: T().size(SD().state.entries), mode: autoMode(), secs: Math.round(lab.auto.ms / 100) / 10, pool: lab.source });
    if (lab.auto.st) lab.auto.st.kept = [...lab.auto.st.buckets.values()].reduce((a, b) => a + b.length, 0);
    if (!lab.auto.st) lab.auto = null;
    renderAuto();
  };
  const autoRow = (r, id, lead) => `<button type="button" class="sd-bl" data-auto-load="${id}">
      <span class="sd-bl-score ${r.codex >= 85 ? 'elite' : r.codex >= 70 ? 'good' : ''}">${lead != null ? lead : r.codex}</span>
      <span class="sd-bl-line"><span class="sd-bl-cpt">${esc(r.cpt)}</span><small>${r.flex.map(esc).join(' · ')}</small></span>
      <span class="sd-script-badge sm">${r.tag}</span>
      <span class="sd-bl-why">${lead != null ? `codex ${r.codex} · ` : ''}${simReady() && r.top1 != null ? `top 1% ${pctTxt(r.top1)} · ` : ''}${money(r.sal)} · ${esc(r.split)}${r.proj ? ` · ${r.proj.toFixed(1)} pts` : ''}${r.dupes != null ? ` · dupes ~${r.dupes.toFixed(r.dupes < 10 ? 1 : 0)}` : ''}</span></button>`;
  const autoCard = (r, i) => {
    const p = engine && engine.P.get(r.cpt);
    return `<button type="button" class="sd-auto-card" data-auto-load="t${i}" title="Load into the Lab">
      <span class="sd-auto-card-top"><span class="sd-bl-score ${r.codex >= 85 ? 'elite' : r.codex >= 70 ? 'good' : ''}">${r.codex}</span><span class="sd-script-badge sm">${r.tag}</span><em>${money(r.sal)}${r.proj ? ` · ${r.proj.toFixed(1)} pts` : ''}</em></span>
      <b>${p ? `<span class="sd-pos pos-${esc(p.pos)}">${esc(p.pos)}</span>` : ''}<span>${esc(r.cpt)}<small>CPT${p ? ` · ${esc(p.team)}${p.team === engine.A.fav ? ' fav' : ' dog'}` : ''}</small></span></b>
      <span class="sd-auto-flex">${r.flex.map(esc).join(' · ')}</span>
      <small>${esc(r.split)} · K ${r.k} · DST ${r.dst}${r.dupes != null ? ` · dupes ~${r.dupes.toFixed(r.dupes < 10 ? 1 : 0)}` : ''} · fit − pen ${r.raw >= 0 ? '+' : '−'}${Math.abs(r.raw).toFixed(2)}</small>${simCardLine(r)}</button>`;
  };
  // The sim's line on a card: P(top 1%), P(min cash), median and 90th-percentile score over the draws (+ the blend when ranking by it).
  const simCardLine = r => {
    const A = lab.auto; if (!simReady() || r.top1 == null) return '';
    const s = simStatsFor(A, r); if (!s) return '';
    return `<span class="sd-sim-line"><span><em>Top 1%</em><b>${pctTxt(s.top1)}</b></span><span><em>Cash</em><b>${pctTxt(s.cash)}</b></span><span><em>Median</em><b>${s.med.toFixed(1)}</b></span><span><em>90th</em><b>${s.p90.toFixed(1)}</b></span>${r.blend != null ? `<span><em>Blend</em><b>${Math.round(r.blend)}</b></span>` : ''}</span>`;
  };
  // Without projections the sim can't run: say so, and what unlocks it. Codex ranking stays.
  const simNeed = has => {
    if (!SB || !SB.simPrepare) return '';
    if (!has.proj) return `<p class="sd-sim-need"><b>Top-1% chance</b> needs a projections file: the sim draws every player's points from Projection + Std Dev. Load your Stokastic Data Hub export in <a href="nfl/showdown/#sdLabPro" data-jump="sdLabPro" class="sd-link">Your slate</a>; until then lineups rank by codex fit.</p>`;
    if (simDataDone && !RC) return '<p class="sd-sim-need">The top-1% sim is unavailable: the role correlations file did not load. Lineups rank by codex fit.</p>';
    return '';
  };
  // The sim panel under the search summary: progress while it runs; then the cut lines it used (with their n) and how it works.
  const simBlock = (A, st) => {
    if (!simOk()) return '';
    if (!A.sim) {
      const f = simRun ? simRun.frac : 0;
      return `<div class="sd-sim"><span class="sd-lab-k">Top-1% sim <small>correlated draws of the game · cut lines that move with it</small></span>
        <div class="sd-auto-prog" role="progressbar" aria-label="Sim progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(f * 100)}"><i id="sdSimBar" style="width:${(f * 100).toFixed(1)}%"></i></div>
        <span class="sd-auto-stat" id="sdSimStat">${simRun ? simRunText() : simCutsNow() ? 'Starting…' : 'No cut lines for this field size.'}</span></div>`;
    }
    const W = worldNow(), c = A.sim.cuts, sp = getSpec(); if (!W || !sp) return '';
    const t1 = SB.cutPoints(W, c.top1.pct), mc = c.cash ? SB.cutPoints(W, c.cash.pct) : null, bs = SB.cutPoints(W, 100);
    const stale = A.sim.cutsKey !== (simCutsNow() || {}).key;
    const nTxt = x => `<span class="${x.small ? 'warn' : ''}">n = ${x.n} contest${x.n === 1 ? '' : 's'}, ${x.slates} slate${x.slates === 1 ? '' : 's'}</span>`;
    return `<div class="sd-sim${stale ? ' updating' : ''}">
      <span class="sd-lab-k">Top-1% sim <small>${W.D.toLocaleString('en-US')} correlated draws of the game · ${esc(c.label)}${stale ? ' · updating for the new field size…' : ''}</small></span>
      <div class="sd-batch-sum sd-sim-sum">
        <div><span>Top-1% cut</span><b>${t1.med.toFixed(1)}</b><small>${c.top1.pct}% of each draw's best lineup · ${nTxt(c.top1)} · this sim ${t1.lo.toFixed(0)}–${t1.hi.toFixed(0)}</small></div>
        <div><span>Min cash</span><b>${mc ? mc.med.toFixed(1) : '—'}</b><small>${mc ? `${c.cash.pct}% of the best · ${nTxt(c.cash)}` : 'no payout table for this tier'}</small></div>
        <div><span>Best lineup</span><b>${bs.med.toFixed(1)}</b><small>median of each draw's best legal lineup · ${bs.lo.toFixed(0)}–${bs.hi.toFixed(0)}</small></div>
        <div><span>Best chance</span><b>${pctTxt(A.sim.best)}</b><small>top 1% among ${A.sim.n.toLocaleString('en-US')} kept lineups · a random entry: 1%</small></div>
      </div>
      <details class="sd-fold"><summary>How the sim works <span class="sd-fold-arrow">▸</span></summary><div class="sd-own-note">
        Each player's DK points are drawn from a skewed (lognormal) curve with mean = the projection and spread = ${sp.fromFile ? `the file's Std Dev (${sp.fromFile} of ${sp.n} players${sp.fromCv ? `; ${sp.fromCv} use the role's coefficient of variation` : ''})` : 'the role\'s coefficient of variation × projection (no Std Dev column in the file)'}.
        Players move together by role (QB1 with his WR1, a DST against the other QB…): correlations computed from nflverse box scores ${esc((RC.seasons || []).join('–'))}, ${esc(sp.cohort)} cohort, n = ${(sp.cohortN || 0).toLocaleString('en-US')} games${sp.shrink < 1 ? ` (shrunk ×${sp.shrink.toFixed(2)} to stay positive-definite)` : ''}. Roles = projection rank within team + position; deeper players are drawn independently.
        In every draw the slate's best legal lineup (CPT 1.5×, $50k, both teams) is found exactly, and the cut is the share of it that the ${esc(c.src === 'econ' ? 'contest economics archive' : 'playbook cut lines')} measured for this field size (${esc(c.label)}), so the bar rises in a shootout and falls in a grind.
        P(top 1%) = the share of draws in which the lineup clears that draw's cut (sampling error ± ${(Math.sqrt(0.05 * 0.95 / W.D) * 100).toFixed(1)} percentage points at a 5% chance). A projection file's median is not a ceiling: this is how often the six together get there. Same file, same numbers (seeded).</div></details>
    </div>`;
  };
  const renderAuto = () => {
    const host = $('sdAuto'); if (!host) return;
    if (!SB) { host.hidden = true; return; }
    const A = lab.auto, running = A && A.status === 'running';
    if (running && A.key !== searchKey()) { stopAuto(true); lab.auto = null; return renderAuto(); }   // the pool or line moved under a running search
    const has = engine ? engine.has : {}, { N, counts } = autoPlan(), mode = autoMode();
    const plan = ['A', 'B', 'C', 'D'].filter(k => counts[k]).map(k => `${counts[k]} ${k}`).join(' · ');
    const pool = lab.source === 'mine' ? 'your slate' : curPool() ? curPool().label : 'this pool';
    const H = SD().data.hard_rules;
    const head = `
      <div class="sd-auto-head">
        <div class="sd-auto-intro"><div class="card-title">Build it for me · <span class="card-title-accent">the engine searches the pool</span></div>
          <p class="sd-lede">Every legal captain + five flex from ${esc(pool)}'s top ${SB.TOP} players (by ${has.proj ? 'projection' : 'salary'}, plus each team's K and DST), ${money(H.min_salary_used)}–${money(H.max_salary ?? CAP)}, every hard rule, graded by the same engine as the Lab and ranked by ${RANK_LABEL[mode]}. ${N > 1 ? `Then the engine picks your ${N}-lineup batch with its portfolio rules and your Step 3 plan (${plan}).` : 'Tap a result to load it into the Lab.'}</p>
          ${simNeed(has)}</div>
        <div class="sd-auto-go">
          ${has.proj ? `<span class="sd-rank-by"><span class="sd-lab-k">Rank by</span><span class="seg" role="group" aria-label="Rank by">${[['codex', 'Codex fit'], ['top1', 'Top-1% chance'], ['blend', 'Blend'], ['proj', 'Projection']].map(([k, l]) => { const off = (k === 'top1' || k === 'blend') && !simReady();
            return `<button type="button" class="${mode === k ? 'active' : ''}" aria-pressed="${mode === k}" data-auto="mode" data-mode="${k}"${off ? ` disabled title="${simOk() ? 'The sim runs right after the search' : 'Needs the sim: a projections file and the role correlations'}"` : ''}>${l}</button>`; }).join('')}</span></span>` : ''}
          <button type="button" class="btn btn-primary btn-sm" data-auto="go" ${engine && !running ? '' : 'disabled'}>${A && A.st && !running ? 'Search again' : N > 1 ? `Build ${N} lineups` : 'Build it'}</button>
        </div>
      </div>`;
    if (running) {
      const f = A.st ? A.st.frac : 0;
      autoDrawn.delete(host);
      host.innerHTML = `${head}
        <div class="sd-auto-run"><div class="sd-auto-prog" role="progressbar" aria-label="Search progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(f * 100)}"><i id="sdAutoBar" style="width:${(f * 100).toFixed(1)}%"></i></div>
          <div class="sd-auto-runrow"><span class="sd-auto-stat" id="sdAutoStat">Searching · ${autoStat(A.st)}</span><button type="button" class="btn btn-sm btn-ghost" data-auto="stop">Stop</button></div></div>`;
      return;
    }
    if (!A || !A.st) { if (autoDrawn.get(host) !== head) { host.innerHTML = head; autoDrawn.set(host, head); } return; }
    const st = A.st, fresh = A.key === searchKey(), top = autoTop(), pick = fresh ? autoPick() : null;
    const byCodex = A.byCodex && A.byCodex.st === st && A.byCodex.kept === st.kept ? A.byCodex : (A.byCodex = { st, kept: st.kept, rows: SB.ranked(st, 'codex') });
    const best = byCodex.rows[0], at100 = byCodex.rows.filter(r => r.codex === 100).length;   // the codex tile reads codex order whatever the ranking
    const skipped = st.skippedCaptains || [];
    const html = `${head}
      ${fresh ? '' : `<div class="sd-auto-stale">The line, pool or field changed since this search: these grades are for the old one. <button type="button" class="sd-link" data-auto="go">Search again</button></div>`}
      <div class="sd-batch-sum sd-auto-sum">
        <div><span>Graded</span><b>${FX.num('au.full', st.full, 0, { sep: true })}</b><small>lineups in the salary window</small></div>
        <div><span>Legal</span><b>${FX.num('au.legal', st.legal, 0, { sep: true })}</b><small>${st.full ? Math.round(st.legal / st.full * 100) : 0}% pass every hard rule</small></div>
        <div><span>Best codex</span><b>${best ? best.codex : '—'}</b><small>${at100 ? `${at100.toLocaleString('en-US')} kept at 100` : 'of 100'}</small></div>
        <div><span>Search</span><b>${st.players} players</b><small>${st.captains} captains · ${(A.ms / 1000).toFixed(1)} s${st.capped ? ' · capped' : ''}${A.status === 'stopped' ? ` · stopped at ${Math.round(st.frac * 100)}%` : ''}</small></div>
      </div>
      ${fresh ? simBlock(A, st) : ''}
      ${N > 1 && fresh && !pick ? `<div class="sd-auto-batch"><span class="sd-lab-k">Your batch · picking ${N} lineups…</span></div>` : ''}
      ${pick ? `
      <div class="sd-auto-batch${pick.updating ? ' updating' : ''}">
        <span class="sd-lab-k">Your batch · ${pick.updating ? `updating for ${N}…` : `${pick.chosen.length} of ${N}`} <small>the engine's select(): legal, top half of the search, dupe gate, captain caps, K / DST / both-QB shares, 5-1s, captain coverage</small></span>
        <div class="sd-auto-mix">${['A', 'B', 'C', 'D'].filter(k => pick.want[k] || pick.got[k]).map(k => `<span class="${pick.got[k] === pick.want[k] ? 'ok' : 'short'}"><span class="sd-script-badge sm">${k}</span>${pick.got[k]} of ${pick.want[k]}<small>${esc(SCRIPT_NAME[k])}</small></span>`).join('')}</div>
        ${pick.chosen.length ? `<div class="sd-blist">${pick.chosen.map((r, i) => autoRow(r, `b${i}`, i + 1)).join('')}</div>` : '<div class="sd-unlock">No batch fits the portfolio caps from this search. Try fewer entries, or load projections so more of the pool ranks.</div>'}
        ${pick.chosen.length < N || pick.notes.length || (pick.ceilings || []).length ? `<div class="sd-book-notes">${(pick.ceilings || []).map(c => `<div>! ${esc(c.label)} share ${Math.round(c.share * 100)}% is over the default ${Math.round(c.max * 100)}% band: select() lets its top-ranked lineups run to the ${Math.round((c.ceiling ?? c.max) * 100)}% ceiling (portfolio.share_ceilings), so the portfolio report will flag it.</div>`).join('')}${pick.chosen.length < N ? `<div>! Only ${pick.chosen.length} of ${N} fit the engine's portfolio caps${pick.blockers.length ? `; the caps that turned lineups away most: ${esc(pick.blockers.map(([k, c]) => `${k} (${c})`).join(', '))}` : ''}.${N > 40 ? ` With at most ${SD().data.portfolio.max_per_captain_abs} lineups per captain and ${SD().data.portfolio.max_overlap_players} shared players between any two, a ${SB.TOP}-player search can only field so many.` : ''}</div>` : ''}${pick.notes.map(n => `<div>! ${esc(n)}</div>`).join('')}</div>` : ''}
        <div class="sd-lab-actions"><button type="button" class="btn btn-primary btn-sm" data-auto="use" ${pick.chosen.length ? '' : 'disabled'}>Use these ${pick.chosen.length} as my batch</button><span class="sd-num-hint">scores them in Your slate below: portfolio report, DK upload</span></div>
        <details class="sd-fold"><summary>Selection log · ${pick.log.length} decisions · pool ${pick.pool.toLocaleString('en-US')}, eligible ${pick.elig.toLocaleString('en-US')} <span class="sd-fold-arrow">▸</span></summary><div class="sd-log">${pick.log.map(l => `<div>${esc(l)}</div>`).join('') || '<div>No skips: every pick passed on the first try.</div>'}</div></details>
      </div>` : ''}
      <span class="sd-lab-k">Top lineups <small>by ${esc(RANK_LABEL[mode])} · tap one to load it into the Lab · at most 3 per captain</small></span>
      <div class="sd-auto-cards">${top.map(autoCard).join('') || '<div class="sd-unlock">No legal lineup in this pool at this line.</div>'}</div>
      <div class="sd-caption">n = ${st.legal.toLocaleString('en-US')} legal lineups, each graded by the Lab's engine (codex score = 50 + 50 × (story fit − penalties))${simReady() ? ` · blend = the mean of each lineup's percentile rank on codex fit (unclamped fit − penalties) and on top-1% chance among the ${(lab.auto.sim.n || 0).toLocaleString('en-US')} kept lineups, 0–100` : ''} · ties: unclamped fit − penalties, ${has.proj ? 'projection, ' : ''}salary used · kept ${(st.kept || 0).toLocaleString('en-US')} (best ${SB.PER_BUCKET} per script × captain) for the batch · players outside the top ${SB.TOP} never enter a build${skipped.length ? ` · ${skipped.length} captain${skipped.length > 1 ? 's' : ''} ruled out up front (${esc(skipped.map(x => `${x[0]}: ${x[1]}`).join('; '))})` : ''}</div>`;
    if (fresh) setTimeout(simStep, 0);   // the sim follows the search (a no-op once it has run for this pool × cut)
    if (autoDrawn.get(host) === html) return;   // every Lab click re-renders: keep the DOM (and an open selection log) when nothing changed
    const open = host.querySelector('.sd-auto-batch details[open]'), openSim = host.querySelector('.sd-sim details[open]');
    host.innerHTML = html; autoDrawn.set(host, html);
    if (open) { const d = host.querySelector('.sd-auto-batch details'); if (d) d.open = true; }
    if (openSim) { const d = host.querySelector('.sd-sim details'); if (d) d.open = true; }
    FX.morph(new Map(), host);
  };
  const autoAction = (a, btn) => {
    if (a === 'go') { startAuto(); return; }
    if (a === 'stop') { stopAuto(); return; }
    if (a === 'mode') { lab.autoMode = btn.dataset.mode; track('build_for_me', { result: 'rank', mode: autoMode(), sim: simReady() }); renderAuto(); return; }
    if (a === 'use') {
      const pk = autoPick(true); if (!pk || !pk.chosen.length) return;
      const cell = n => /[",]/.test(n) ? `"${n.replace(/"/g, '""')}"` : n;
      pro.lineupsText = 'CPT,FLEX,FLEX,FLEX,FLEX,FLEX\n' + pk.chosen.map(r => [r.cpt, ...r.flex].map(cell).join(',')).join('\n');
      pro.lineupsName = 'Build it for me';
      renderPro(); scoreBatch();
      const out = $('sdBatchOut'); if (out) out.scrollIntoView({ behavior: FX.reduced() ? 'auto' : 'smooth', block: 'start' });
    }
  };
  const autoLoad = id => {
    const A = lab.auto; if (!A || !A.st) return;
    const r = id[0] === 't' ? autoTop()[+id.slice(1)] : (autoPick(true) || { chosen: [] }).chosen[+id.slice(1)];
    if (!r || !engine || !engine.P.has(r.cpt)) return;
    fillFrom({ cpt: r.cpt, flex: r.flex }); render();
    $('sdLabLineup')?.scrollIntoView({ behavior: FX.reduced() ? 'auto' : 'smooth', block: 'center' });
  };

  /* =================================================================
     PRO PANEL — your files, batch scoring, portfolio, pool → book
     ================================================================= */
  const pro = { files: [], lineupsText: '', lineupsName: '' };
  const renderPro = () => {
    const host = $('sdLabPro'); if (!host) return;
    const m = lab.mine;
    host.innerHTML = `
      <div class="card-title">Your slate · <span class="card-title-accent">score your own files</span></div>
      <div class="sd-pro-grid">
        <div class="sd-drop" id="sdDrop" tabindex="0" role="button" aria-label="Load files: DraftKings salary CSV, Stokastic Data Hub export, or a lineup CSV">
          <input type="file" id="sdFiles" accept=".csv,.psv,.txt" multiple hidden>
          <b>Drop files here</b><span>or click to choose · DK salaries · Stokastic Data Hub export · lineup CSVs (DK upload, DKEntries, Stokastic sim/generator)</span>
          <small>🔒 Read in your browser — nothing is uploaded.</small>
        </div>
        <div class="sd-files">${pro.files.length ? pro.files.map(f => `<div class="sd-file ${f.kind}"><b>${esc(f.name)}</b><span>${esc(f.desc)}</span></div>`).join('') : '<div class="sd-file empty"><span>No files yet. Tip: DK salaries give you DK ids for uploads; the Data Hub export adds projections, ownership and optimal % so every rule can be checked.</span></div>'}</div>
      </div>
      <div class="sd-batch-in">
        <label class="sd-lab-k" for="sdBatchText">Lineups to score <small>paste rows (CPT first) or drop a lineup CSV</small></label>
        <textarea id="sdBatchText" rows="4" placeholder="CPT,FLEX,FLEX,FLEX,FLEX,FLEX&#10;Davante Adams,Matthew Stafford,Kyren Williams,Malik Nabers,Harrison Mevis,Rams">${esc(pro.lineupsText)}</textarea>
        <div class="sd-lab-actions"><button type="button" class="btn btn-primary btn-sm" data-pro="score" id="sdBatchGo">Score these lineups</button>
          <span class="sd-num-hint" id="sdBatchLabel"></span></div>
      </div>
      <div id="sdBatchOut"></div>`;
    const inp = $('sdFiles'), drop = $('sdDrop');
    drop.addEventListener('click', () => inp.click());
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
    inp.addEventListener('change', () => readFiles([...inp.files]));
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => readFiles([...(e.dataTransfer?.files || [])]));
    $('sdBatchText').addEventListener('input', e => { pro.lineupsText = e.target.value; });
    if (lab.batch) renderBatch();
    foldAns();
  };
  const readFiles = async files => {
    let base = lab.mine ? lab.mine.players : null, gotPlayers = false;
    let sd = lab.mine && lab.mine.sd ? new Map(lab.mine.sd) : new Map();   // Std Dev (Stokastic) for the sim: memory only
    let at = lab.mine ? lab.mine.at || null : null;   // when the projections were exported (the routine's "fresh?"): memory only
    for (const f of files) {
      const text = await f.text();
      let pl = null;
      try { pl = SE.readPlayers(text); } catch {}
      // A DKEntries export carries a player list on the right AND lineups on the left:
      // score its lineups; borrow its player list only if no slate is loaded yet.
      const head = SE.parseCSV(text.split(/\r?\n/).slice(0, 2).join('\n'));
      const cptCol = head[0] ? head[0].findIndex(h => h.trim().toLowerCase() === 'cpt') : -1;
      if (pl && cptCol >= 0 && head[1] && (head[1][cptCol] || '').trim()) {
        if (!base) { base = pl; gotPlayers = true; }
        pro.lineupsText = text; pro.lineupsName = f.name;
        pro.files = pro.files.filter(x => x.name !== f.name).concat({ name: f.name, kind: 'lineups', desc: `DK entries file · lineups${!lab.mine && gotPlayers ? ' + its player list' : ''}` });
        track('file_load', { type: 'dk_entries', card: 'lab' });
        continue;
      }
      if (pl) {
        base = SE.mergePlayers(base, pl); gotPlayers = true;
        const sdf = pl.source === 'stokastic' && SB && SB.readStd ? SB.readStd(SE.parseCSV(text)) : null;
        if (sdf && sdf.size) for (const [k, v] of sdf) sd.set(k, v);
        if (pl.has.proj) { const t = /_(\d{4}-\d{2}-\d{2})_(\d{4})ET/.exec(f.name); at = (t && etMs(`${t[1]}T${t[2].slice(0, 2)}:${t[2].slice(2)}`)) || f.lastModified || null; }
        track('file_load', { type: pl.source === 'stokastic' ? 'stokastic' : 'dk_salaries', card: 'lab', own: !!pl.has.own, proj: !!pl.has.proj });
        pro.files = pro.files.filter(x => x.name !== f.name).concat({ name: f.name, kind: 'players', desc: `${pl.source === 'stokastic' ? 'Stokastic Data Hub' : 'DraftKings salaries'} · ${pl.P.size} players${pl.ids.size ? ' · DK ids ✓' : ''}${pl.has.own ? ' · ownership ✓' : ''}${pl.has.proj ? ' · projections ✓' : ''}${sdf && sdf.size ? ' · Std Dev ✓' : ''}` });
      } else {
        pro.lineupsText = text; pro.lineupsName = f.name;
        pro.files = pro.files.filter(x => x.name !== f.name).concat({ name: f.name, kind: 'lineups', desc: `${Math.max(0, text.trim().split(/\r?\n/).length - 1)} lineup rows` });
        track('file_load', { type: 'lineups', card: 'lab' });
      }
    }
    if (gotPlayers) {
      const teams = [...new Set([...base.P.values()].map(p => p.team))].sort();
      lab.mine = { players: base, label: `${teams.join(' / ')} · ${base.P.size} players`, stamp: Date.now(), sd, at };
      stash(); lab.source = 'mine'; unstash();
      await matchBB();
      SD().toast(`<b>Your slate loaded</b> — ${esc(lab.mine.label)}${base.has.own ? ' · every rule live' : ''}`, 'good');
    }
    renderPro(); render();
    if (pro.lineupsText && files.some(f => pro.lineupsName === f.name)) scoreBatch();
  };

  // What the batch was scored against; if it changes, the batch is re-scored.
  const engineKey = () => engine ? JSON.stringify([lab.source, lab.poolId, lab.mine && lab.mine.stamp, engine.A, engine.settings.DUPE_MAX, useCorr()]) : '';
  let rescoreT = 0;
  const syncBatch = () => {
    if (!lab.batch || lab.batch.key === engineKey()) return;
    clearTimeout(rescoreT);
    rescoreT = setTimeout(() => { if (lab.batch && lab.batch.key !== engineKey() && engine) { pro.lineupsText = lab.batch.text; scoreBatch(true); } }, 250);
  };
  const scoreBatch = (quiet) => {
    if (!engine) { SD().toast('Load a slate pool first', 'warn'); return; }
    let text = pro.lineupsText.trim();
    if (!text) { SD().toast('Paste or drop some lineups first', 'warn'); return; }
    const first = text.split(/\r?\n/)[0].toLowerCase();
    if (!/\bcpt\b|\bflex|^f1\b|\|/.test(first)) text = 'CPT,FLEX,FLEX,FLEX,FLEX,FLEX\n' + text;
    text = text.replace(/\t/g, ',');
    const pool = engine.loadPool(text, /\|/.test(first));
    const good = pool.filter(r => !r.bad), bad = pool.filter(r => r.bad);
    if (!good.length) { SD().toast(`No lineups matched this pool${bad.length ? ` (${bad.length} rows had unknown names)` : ''}`, 'warn'); return; }
    const rows = engine.evaluate(good);
    rows.forEach(r => { r.codex = codexScore({ fit: r.fit, penSum: r.pen.reduce((a, p) => a + p[1], 0) }); });
    lab.batch = { rows, bad: bad.length, report: engine.portfolioReport(rows), sort: 'score', key: engineKey(), text };
    lab.book = null;
    renderBatch();
    if (quiet !== true) {
      SD().toast(`<b>${rows.length} lineups scored</b> · ${rows.filter(r => !r.hard.length).length} legal`, 'good');
      track('batch_score', { size: T().size(rows.length), legal: T().size(rows.filter(r => !r.hard.length).length), from: pro.lineupsName === 'Build it for me' ? 'build' : pro.files.some(f => f.name === pro.lineupsName) ? 'file' : 'paste', pool: lab.source });
    }
  };
  const lineCell = r => `<span class="sd-bl-cpt">${esc(r.X.cpt.name)}</span><small>${r.X.fl.map(p => esc(p.name)).join(' · ')}</small>`;
  const renderBatch = () => {
    const host = $('sdBatchOut'); if (!host || !lab.batch) return;
    const B = lab.batch, rows = B.rows.slice();
    const legal = rows.filter(r => !r.hard.length);
    const avg = rows.reduce((a, r) => a + r.codex, 0) / rows.length;
    const tags = { A: 0, B: 0, C: 0, D: 0 }; rows.forEach(r => tags[r.X.tag]++);
    rows.sort((a, b) => (a.hard.length > 0) - (b.hard.length > 0) || b.codex - a.codex);   // legal first, best grade first
    const entries = SD().state.entries, isPool = rows.length > entries;
    const book = lab.book;
    host.innerHTML = `
      <div class="sd-batch-sum">
        <div><span>Lineups</span><b>${FX.num('b.n', rows.length, 0, { from: 0 })}</b><small>${B.bad ? `${B.bad} rows unmatched` : 'all matched'}</small></div>
        <div><span>Legal</span><b class="${legal.length === rows.length ? 'pos' : 'neg'}">${FX.num('b.legal', legal.length, 0, { from: 0 })}</b><small>${rows.length - legal.length} rejected</small></div>
        <div><span>Avg codex score</span><b>${FX.num('b.avg', avg, 0, { from: 0 })}</b><small>of 100</small></div>
        <div><span>Script mix</span><b>${Object.entries(tags).map(([k, v]) => `${v}${k}`).join(' ')}</b><small>plan ${['A', 'B', 'C', 'D'].map(k => Math.round(SD().derive().alloc[k])).join('/')}</small></div>
      </div>
      <span class="sd-lab-k">Portfolio report <small>every cap in rules.json, for this batch${bbOwn() && engine && engine.has.own ? ' · ownership: BB proj (rough)' : ''}</small></span>
      <div class="sd-port">${B.report.map(c => `<div class="sd-port-row ${c.status}"><i>${c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✗'}</i><span>${esc(c.label)}<small>${esc(c.detail)}</small></span><b>${esc(c.value)}</b><em>${esc(c.target)}</em></div>`).join('')}</div>
      ${isPool ? `<div class="sd-bookcta"><div><b>${rows.length} lineups is a pool, not a book.</b><span>Let the engine pick your ${entries}-lineup book the way <code>rules_engine.py</code> does: legal only, top half of the pool, dupe gate, captain caps, K/DST/both-QB shares, script quotas, forced 5-1s, captain coverage.</span></div><button type="button" class="btn btn-primary btn-sm" data-pro="book">Pick my ${entries}-lineup book</button></div>` : ''}
      ${book ? renderBook(book) : ''}
      <span class="sd-lab-k">Lineups <small>tap one to open it in the Lab</small></span>
      <div class="sd-blist">${rows.slice(0, 300).map(r => `<button type="button" class="sd-bl ${r.hard.length ? 'bad' : ''}" data-pro-load="${r.L.idx}">
        <span class="sd-bl-score ${r.hard.length ? 'bad' : r.codex >= 85 ? 'elite' : r.codex >= 70 ? 'good' : ''}">${r.hard.length ? '✗' : r.codex}</span>
        <span class="sd-bl-line">${lineCell(r)}</span>
        <span class="sd-script-badge sm">${r.X.tag}</span>
        <span class="sd-bl-why">${r.hard.length ? esc(r.hard.join(' · ')) : r.pen.length ? esc(r.pen.map(p => p[0]).join(' · ')) : 'clean'}</span></button>`).join('')}
        ${rows.length > 300 ? `<div class="sd-caption">showing 300 of ${rows.length}</div>` : ''}</div>`;
    FX.morph(new Map(), host);
  };
  const renderBook = bk => `
      <div class="sd-book">
        <div class="sd-book-head"><b>The engine's book · ${bk.chosen.length} of ${SD().state.entries}</b><span>from ${bk.eligN} eligible of ${lab.batch.rows.length}</span>
          <span class="sd-book-acts"><button type="button" class="btn btn-sm" data-pro="book-copy">Copy names</button>${bk.ids ? '<button type="button" class="btn btn-sm btn-primary" data-pro="book-dk">Download DK upload CSV</button>' : ''}</span></div>
        <div class="sd-blist">${bk.chosen.map((r, i) => `<button type="button" class="sd-bl" data-pro-load="${r.L.idx}"><span class="sd-bl-score ${r.codex >= 85 ? 'elite' : r.codex >= 70 ? 'good' : ''}">${i + 1}</span><span class="sd-bl-line">${lineCell(r)}</span><span class="sd-script-badge sm">${r.X.tag}</span><span class="sd-bl-why">rank ${r.simrank} · score ${r.score.toFixed(2)}</span></button>`).join('')}</div>
        ${bk.notes.length ? `<div class="sd-book-notes">${bk.notes.map(n => `<div>⚠ ${esc(n)}</div>`).join('')}</div>` : ''}
        <details class="sd-fold"><summary>Selection log · ${bk.log.length} decisions <span class="sd-fold-arrow">▸</span></summary><div class="sd-log">${bk.log.map(l => `<div>${esc(l)}</div>`).join('')}</div></details>
      </div>`;
  const pickBook = () => {
    if (!engine || !lab.batch) return;
    const S = engine.select(lab.batch.rows);
    S.chosen.forEach(r => { if (r.codex == null) r.codex = codexScore({ fit: r.fit, penSum: r.pen.reduce((a, p) => a + p[1], 0) }); });
    const ids = S.chosen.every(r => idsOf(r.X.cpt.name)[1] && r.X.fl.every(p => idsOf(p.name)[0]));
    lab.book = { chosen: S.chosen, log: S.log, notes: S.notes, eligN: S.elig.length, ids };
    renderBatch();
    SD().toast(`<b>Book picked</b> · ${S.chosen.length} lineups`, 'good');
    track('book_pick', { size: T().size(S.chosen.length), pool_size: T().size(lab.batch.rows.length), entries: T().size(SD().state.entries) });
  };
  const onProClick = e => {
    const t = e.target, b = t.closest('[data-pro]');
    if (b) {
      const a = b.dataset.pro;
      if (a === 'score') { pro.lineupsText = $('sdBatchText').value; scoreBatch(); }
      if (a === 'book') pickBook();
      if (a === 'book-copy' && lab.book) copyText(lab.book.chosen.map(r => [r.X.cpt.name, ...r.X.fl.map(p => p.name)].join(', ')).join('\n'), b, 'Book copied');
      if (a === 'book-dk' && lab.book) {
        const csv = 'CPT,FLEX,FLEX,FLEX,FLEX,FLEX\n' + lab.book.chosen.map(r => [idsOf(r.X.cpt.name)[1], ...r.X.fl.map(p => idsOf(p.name)[0])].join(',')).join('\n') + '\n';
        const a2 = document.createElement('a'); a2.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a2.download = `DK_upload_showdown_${Date.now()}.csv`; document.body.appendChild(a2); a2.click(); a2.remove();
        tick('export', true); renderRoutine(); foldAns();
      }
      return;
    }
    const ld = t.closest('[data-pro-load]');
    if (ld && lab.batch) {
      const r = lab.batch.rows.find(x => String(x.L.idx) === ld.dataset.proLoad); if (!r) return;
      fillFrom({ cpt: r.X.cpt.name, flex: r.X.fl.map(p => p.name) }); render();
      document.getElementById('sdLabLineup')?.scrollIntoView({ behavior: FX.reduced() ? 'auto' : 'smooth', block: 'center' });
    }
  };

  // A shared link's lu= tokens (DK ids or name slugs) → the Lab lineup, graded.
  const loadUrlLineup = tokens => {
    const pl = players(); if (!engine || !pl) return;
    const L = SD().lineupFromTokens(tokens, [...engine.P.keys()], pl.ids);
    if (!L.cpt && !L.flex.length) { SD().toast(`The linked lineup isn't in ${esc(curPool() ? curPool().label : 'this pool')} — nothing loaded`, 'warn'); return; }
    fillFrom(L); render();
    if (L.bad.length) SD().toast(`Linked lineup loaded · ${L.bad.length} player${L.bad.length > 1 ? 's' : ''} not in this pool (out / IR, or a different slate)`, 'warn');
  };

  // The Tuesday review (showdown_review.js) opens a lineup here: a sample pool (poolId) or Your slate (null).
  // line: 'slate' loads the pool's own line into Step 1; otherwise Step 1's line stays and the preset is
  // released, so the Lab doesn't follow Step 1 back to another pool.
  const openLineup = async (poolId, L, line) => {
    if (poolId) {
      const s = (SD().slates || []).find(x => x.id === poolId);
      if (line === 'slate' && s) Object.assign(SD().state, { spread: s.spread, total: s.total, env: s.env, preset: s.id, realized: null });
      else if (SD().state.preset && SD().state.preset !== poolId) SD().state.preset = null;
      stash(); lab.source = 'sample'; lab.poolId = poolId; unstash();
      try { await fetchPool(poolId); } catch (e) { lab.err = e.message; }
    } else if (lab.mine) { stash(); lab.source = 'mine'; unstash(); }
    fillFrom(L);
    SD().render();
    render();
    $('sdLabLineup')?.scrollIntoView({ behavior: FX.reduced() ? 'auto' : 'smooth', block: 'center' });
  };

  /* =================================================================
     WHERE TO ENTER (Step 5) + THIS WEEK'S ROUTINE (Step 4) · 2026-09-23
     Where to enter: this week's primetime showdown GPPs (contests_this_week.json, public DK lobby + payout tables,
     built by codex/contest_economics.py --this-week) for the Lab's slate, each set against the 2026 contest archive
     (contest_economics.json: cut line, dupes, n), with a plain-English pick for the Step 1 entry count. "Use in Lab"
     links the Lab's field size (and the Step 1 contest size) to that contest. No live list → the archive's field
     buckets. The routine: the player's week as ticks per slate (localStorage; names and ticks only).
     ================================================================= */
  const TW_PATH = 'nfl/showdown/contests_this_week.json', LS_CONTEST = 'bbi_showdown_contest', LS_ROUTINE = 'bbi_showdown_routine';
  let TW = null, twDone = false, twP = null;
  const loadTW = () => twP || (twP = fetch(TW_PATH, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null)
    .then(j => { if (j && Array.isArray(j.slates)) TW = j; twDone = true; }));
  const teamsOf = label => { const m = /([A-Z]{2,3})\s*@\s*([A-Z]{2,3})/.exec(String(label || '')); return m ? [m[1], m[2]].sort().join() : ''; };
  // This week's list for a slate: the DK draft group first, else the two teams (a replay never matches a live list).
  const matchTW = (tw, q) => {
    if (!tw || !Array.isArray(tw.slates) || !q || q.replay) return null;
    return (q.dg && tw.slates.find(s => s.draft_group_id && +s.draft_group_id === +q.dg)) || (q.teams && tw.slates.find(s => teamsOf(s.label) === q.teams)) || null;
  };
  // The archive cell behind a contest: field size × entry max (≥ 1 contest), else the field-size marginal.
  const econCell = (econ, field, emax) => {
    const P = econ && econ.primetime; if (!P) return null;
    const fe = (P.by_field_entry_max || []).find(r => r.field === field && r.emax === emax && r.n_contests > 0);
    if (fe) return { row: fe, basis: `${fe.field_label} × ${fe.emax_label}` };
    const f = (P.by_field || []).find(r => r.field === field);
    return f ? { row: f, basis: `${f.field_label} (all entry maxes)` } : null;
  };
  const shortName = n => String(n || '').replace(/^NFL Showdown\s+/i, '').replace(/\s*\([A-Z]{2,3}\s*@\s*[A-Z]{2,3}\)\s*$/, '');
  const anyTop1 = k => 1 - Math.pow(0.99, Math.max(0, k));   // contest_economics method.any_top1_pct: k entries at a 1% rate
  const eqKey = c => c.dupe_adj_top1_equity ?? (c.top1_equity || 0) * 0.5;   // the file's ranking key
  const REC_TIER = k => k <= 3 ? 'few' : k < 20 ? 'some' : 'book';
  // The pick for k lineups: which contests fit, why (archive numbers with n), and a single-entry ladder for 4+.
  const whereRec = (k, contests, econ, contestTypes) => {
    k = Math.max(1, Math.round(+k || 1));
    const tier = REC_TIER(k), cs = (contests || []).slice().sort((a, b) => (a.rank || 0) - (b.rank || 0) || eqKey(b) - eqKey(a));
    const fit = { few: c => c.max_entries <= 5, some: c => c.max_entries >= k && c.field_size < 100000, book: c => c.max_entries >= Math.min(k, 150) }[tier];
    const fits = cs.filter(fit), se = cs.filter(c => c.max_entries === 1);
    const cell = (f, e) => { const x = econCell(econ, f, e); return x && x.row.field === f && (x.row.emax === e) ? x.row : null; };
    const nm = v => v == null ? '—' : (+v).toFixed(v < 10 ? 1 : 0), usd = v => v == null ? '—' : `$${(+v).toFixed(2)}`, pc = v => v == null ? '—' : `${Math.round(v)}%`, n = r => `n = ${r.n_contests}${r.small ? ', small' : ''}`;
    const p = anyTop1(k), odds = `At a 1% top-1% rate, ${k} lineup${k === 1 ? '' : 's'} = a ${(p * 100).toFixed(p < 0.1 ? 1 : 0)}% chance of at least one top-1% finish on the slate.`;
    const lines = [];
    const large = (contestTypes || []).find(c => c.key === 'large');
    if (tier === 'few') {
      const A = cell('lt5k', 'se'), B = cell('100k_plus', 'max150');
      if (A && B) lines.push({ t: `A unique lineup keeps its whole prize. In <5k single-entry fields a top-1% lineup had ${nm(A.top1_mean_dupes)} duplicates on average and 1st place was split in ${pc(A.winner_split_pct)} of contests (${n(A)}); in 100k+ 150-max fields, ${nm(B.top1_mean_dupes)} and ${pc(B.winner_split_pct)} (${n(B)}).`, small: A.small || B.small });
    } else if (tier === 'some') {
      const C = cell('5k_25k', 'max150'), D = cell('25k_100k', 'max20');
      if (C && D) lines.push({ t: `Mid-size fields dupe less: top-1% lineups had ${nm(C.top1_mean_dupes)} duplicates in 5k–25k 150-max fields (${n(C)}) vs ${nm(D.top1_mean_dupes)} in 25k–100k 20-max (${n(D)}). Put your best 1–2 in single entry, the rest in a field that takes all ${k}.`, small: C.small || D.small });
    } else {
      const E = cell('25k_100k', 'max150'), F = cell('100k_plus', 'max150');
      if (E && F) lines.push({ t: `Big 150-max fields paid ${usd(E.top1_equity)} (25k–100k, ${n(E)}) and ${usd(F.top1_equity)} (100k+, ${n(F)}) per $1 to a 1% player, but their top-1% lineups carried ${nm(E.top1_mean_dupes)} and ${nm(F.top1_mean_dupes)} duplicates: keep every lineup under the ${large ? large.dupe_cap : 20}-dupe gate and ladder your top 1–2 into single entry.`, small: E.small || F.small });
    }
    lines.push({ t: odds, small: false });
    const title = { few: `${k} lineup${k === 1 ? '' : 's'} → single-entry and ≤5-max contests`, some: `${k} lineups → a ladder: single entry for your best, a 20-max or mid-size field for the rest`, book: `${k} lineups → a book: big 20- / 150-max fields, top 1–2 laddered into single entry` }[tier];
    return { tier, k, title, lines, fits, top: fits.slice(0, 3), ladder: tier === 'few' ? null : se[0] || null, p };
  };
  const loadLink = () => { try { const j = JSON.parse(localStorage.getItem(LS_CONTEST)); return j && +j.field >= 100 ? j : null; } catch { return null; } };
  const saveLink = v => { if (v) lsSet(LS_CONTEST, JSON.stringify({ id: v.id, dg: v.dg, field: v.field, name: v.name })); else try { localStorage.removeItem(LS_CONTEST); } catch {} };
  lab.link = null;   // { id, dg, field, name } of the contest the Lab's field size came from (Step 5)
  const linkOn = () => !!(lab.link && lab.field && +lab.link.field === +lab.field);
  const useContest = (field, name, id, dg) => {
    lab.field = Math.round(+field); lab.link = { id: id || null, dg: dg || null, field: lab.field, name: String(name || '') };
    saveLink(lab.link); tick('contests', true);
    const S = SD(), key = S.fieldBucket(lab.field), was = S.state.contest;
    if (S.data.inputs.contest_types.some(c => c.key === key)) { S.state.contest = key; S.state.cutKey = null; }
    save();
    SD().toast(`<b>${esc(shortName(name))}</b> linked: the Lab grades for a ${lab.field.toLocaleString('en-US')} field${was !== S.state.contest ? ` · Step 1 contest → ${esc(S.CONTEST_SHORT[S.state.contest])}` : ''}`, 'good');
    S.render();   // Step 1 / Step 5 follow; sd:render re-renders the Lab
  };
  // The Lab's slate as the list knows it: DK draft group + teams (sample pool), or the teams of Your slate.
  const whereQuery = () => {
    if (lab.source === 'mine' && lab.mine) return { teams: [...new Set([...lab.mine.players.P.values()].map(p => p.team))].sort().join(), label: lab.mine.label };
    const s = (SD().slates || []).find(x => x.id === lab.poolId);
    return s ? { dg: s.dk_draft_group, teams: [s.fav, s.dog].sort().join(), replay: !!s.replay, label: s.label, kickoff: s.kickoff } : null;
  };
  const fmtN = v => (+v).toLocaleString('en-US');
  const money2 = v => v >= 100 ? money(v) : `$${(+v).toFixed(v % 1 ? 2 : 0)}`;
  let cutMemo = { W: null, m: new Map() };   // the sim's cut in points per share-of-best (one sort of the draws each)
  const cutPtsFor = (W, pct) => { if (cutMemo.W !== W) cutMemo = { W, m: new Map() }; if (!cutMemo.m.has(pct)) cutMemo.m.set(pct, SB.cutPoints(W, pct)); return cutMemo.m.get(pct); };
  const whereRow = (c, fitIds, simW) => {
    const ec = econCell(ECON, c.field_bucket, c.entry_max_bucket), r = ec && ec.row, linked = linkOn() && lab.link.id === c.contest_id;
    const cutPts = simW && r && r.cut_top1_pct_best != null ? cutPtsFor(simW, r.cut_top1_pct_best) : null;
    const dsm = c.dupe_n_contests != null && c.dupe_n_contests < 3;
    return `<div class="sd-wh-row${fitIds.has(c.contest_id) ? ' fit' : ''}${linked ? ' on' : ''}">
      <span class="sd-wh-rank">#${c.rank}</span>
      <span class="sd-wh-name"><b>${esc(shortName(c.name))}</b><small>${money2(c.entry_fee)} · ${fmtN(c.field_size)} field${c.entries_now != null ? ` (${fmtN(c.entries_now)} in)` : ''} · ${c.max_entries === 1 ? 'single entry' : `${c.max_entries}-max`}</small></span>
      <span class="sd-wh-eq"><b>${c.dupe_adj_top1_equity != null ? `$${c.dupe_adj_top1_equity.toFixed(2)}` : c.top1_equity != null ? `$${c.top1_equity.toFixed(2)}` : '—'}</b><small>per $1${c.dupe_adj_top1_equity != null ? ', after dupes' : ', raw (no dupe basis)'}</small></span>
      <button type="button" class="btn btn-sm${linked ? ' btn-primary' : ''}" data-where-use="${esc(c.contest_id)}" aria-pressed="${linked}" aria-label="${linked ? 'Unlink' : 'Use in the Lab'}: ${esc(shortName(c.name))}">${linked ? 'In the Lab ✓' : 'Use in Lab'}</button>
      <span class="sd-wh-x">
        <span><em>Top-1% cut</em>${r && r.cut_top1_pct_best != null ? `<b>${r.cut_top1_pct_best.toFixed(0)}%</b> of the slate's best${cutPts ? ` · ≈${cutPts.med.toFixed(0)} pts this game (sim)` : ''} <i class="${r.small ? 'warn' : ''}">n = ${r.n_contests}</i>` : '—'}</span>
        <span><em>Dupes</em>${c.dupe_risk ? `<b>${esc(c.dupe_risk)}</b> · ${c.top1_mean_dupes != null ? `${c.top1_mean_dupes.toFixed(1)} per top-1% lineup` : ''} <i class="${dsm ? 'warn' : ''}">n = ${c.dupe_n_contests ?? '—'}</i>` : '—'}</span>
        <span><em>Top-1% finish</em>${c.avg_top1_prize_x_fee != null ? `pays <b>${Math.round(c.avg_top1_prize_x_fee)}×</b> the fee on average · ${fmtN(c.top1_places)} places` : '—'}</span>
      </span>
    </div>`;
  };
  const bucketTable = () => {
    const rows = ECON && ECON.primetime && ECON.primetime.by_field; if (!rows || !rows.length) return '';
    return `<span class="sd-lab-k">The 2026 archive by field size <small>primetime · ${fmtN(ECON.primetime.n_contests)} contests · ${ECON.primetime.n_slates} slates · pick one to set the Lab's field</small></span>
      <div class="sd-wh-list">${rows.map(r => `<div class="sd-wh-row">
        <span class="sd-wh-rank">${esc(r.field_label)}</span>
        <span class="sd-wh-name"><b>${esc(r.field_label)} fields</b><small>median ${fmtN(r.median_field)} entries</small></span>
        <span class="sd-wh-eq"><b>$${r.top1_equity != null ? r.top1_equity.toFixed(2) : '—'}</b><small>per $1${r.dupe_haircut != null ? ` · dupes ×${r.dupe_haircut}` : ''}</small></span>
        <button type="button" class="btn btn-sm" data-where-field="${r.median_field}" data-where-label="${esc(r.field_label)} field (archive median)" aria-label="Use a ${esc(r.field_label)} field in the Lab">Use in Lab</button>
        <span class="sd-wh-x"><span><em>Top-1% cut</em><b>${r.cut_top1_pct_best != null ? r.cut_top1_pct_best.toFixed(0) : '—'}%</b> of the slate's best</span><span><em>Min cash</em>${r.min_cash_pct_best != null ? `${r.min_cash_pct_best.toFixed(0)}%` : '—'}</span><span><em>Dupes</em>${r.top1_mean_dupes != null ? `${r.top1_mean_dupes.toFixed(1)} per top-1% lineup · 1st split ${Math.round(r.winner_split_pct)}%` : '—'}</span><span><i class="${r.small ? 'warn' : ''}">n = ${r.n_contests} contests, ${r.n_slates} slates</i></span></span>
      </div>`).join('')}</div>`;
  };
  const renderWhere = () => {
    const host = $('sdWhere'); if (!host || !SD().data) return;
    const q = whereQuery(), S = SD(), k = Math.max(1, S.state.entries || 1);
    const head = `<div class="card-title">Where to enter · <span class="card-title-accent">${esc(q ? q.label : 'this slate')}</span></div>`;
    if (!twDone && !TW) { if (host.dataset.drawn !== head) { host.innerHTML = `${head}<p class="sd-lede">Loading this week's contest list…</p>`; host.dataset.drawn = head; } return; }
    const tw = TW && TW.status === 'ok' ? TW : null, ts = matchTW(tw, q), posted = ts && ts.posted && (ts.contests || []).length;
    const rec = whereRec(k, posted ? ts.contests : [], ECON, S.data.inputs.contest_types);
    const W = posted && worldNow(), fitIds = new Set(rec.top.map(c => c.contest_id));
    const pulled = TW && TW.generated ? `pulled ${esc(String(TW.generated).replace('T', ' '))} ET` : '';
    const o = ECON && ECON.primetime && ECON.primetime.overall;
    const others = tw ? tw.slates.filter(s => s !== ts).map(s => {
      const sl = (S.slates || []).find(x => !x.replay && (x.dk_draft_group && +x.dk_draft_group === +s.draft_group_id || [x.fav, x.dog].sort().join() === teamsOf(s.label)));
      const txt = `${esc(s.label)}${s.window ? ` · ${esc(s.window)}` : ''}: ${s.posted ? `${s.n_contests ?? (s.contests || []).length} contests` : 'not posted yet'}`;
      return sl ? `<button type="button" class="sd-link" data-group="preset" data-key="${esc(sl.id)}">${txt}</button>` : `<span>${txt}</span>`;
    }) : [];
    let body;
    if (posted) {
      const all = ts.contests.slice().sort((a, b) => a.rank - b.rank);
      body = `
      <div class="sd-batch-sum sd-wh-sum">
        <div><span>Contests</span><b>${all.length}</b><small>${esc(ts.window || '')} GPPs · ${pulled}${TW.stale ? ' · <i class="warn">stale</i>' : ''}</small></div>
        <div><span>Your entries</span><b>${k}</b><small>from Step 1 · ${rec.fits.length} contest${rec.fits.length === 1 ? '' : 's'} fit</small></div>
        <div><span>Top-1% cut</span><b>${o && o.cut_top1_pct_best != null ? `${Math.round(o.cut_top1_pct_best)}%` : '—'}</b><small>of the slate's best · ${o ? `n = ${o.n_contests}` : ''}</small></div>
        <div><span>Rake</span><b>${o && o.pool_per_fee != null ? `${Math.round((1 - o.pool_per_fee) * 100)}%` : '—'}</b><small>prize pool ${o ? `${o.pool_per_fee} of fees · n = ${o.n_payout}` : ''}</small></div>
      </div>
      <div class="sd-wh-rec"><b>${esc(rec.title)}</b>${rec.lines.map(l => `<p class="${l.small ? 'small' : ''}">${esc(l.t)}</p>`).join('')}</div>
      <span class="sd-lab-k">Best fits for ${k} lineup${k === 1 ? '' : 's'} <small>ranked by $ back per $1 for a player who finishes top 1% exactly 1% of the time, after the dupe haircut · gold edge = fits</small></span>
      <div class="sd-wh-list">${rec.top.length ? rec.top.map(c => whereRow(c, fitIds, W)).join('') : `<div class="sd-unlock">None of this slate's contests fits ${k} lineups this way: see the full list.</div>`}</div>
      ${rec.ladder && !fitIds.has(rec.ladder.contest_id) ? `<span class="sd-lab-k">Ladder <small>your top 1–2 lineups also go in the best single-entry contest</small></span><div class="sd-wh-list">${whereRow(rec.ladder, fitIds, W)}</div>` : ''}
      <details class="sd-fold"><summary>All ${all.length} contests on ${esc(ts.label)} <span class="sd-fold-arrow">▸</span></summary><div class="sd-wh-list" style="margin-top:8px">${all.map(c => whereRow(c, fitIds, W)).join('')}</div></details>`;
    } else {
      const why = !TW ? 'This week\'s contest list did not load.'
        : TW.status !== 'ok' ? `DraftKings' lobby was unavailable on the last pull${TW.generated ? ` (${esc(String(TW.generated).replace('T', ' '))} ET)` : ''}: no live list this week.`
        : !q || q.replay ? `The Lab is on ${q ? `a replay (${esc(q.label)})` : 'no slate'}: the live list covers this week's primetime games.`
        : ts ? `${esc(ts.label)}${ts.window ? ` (${esc(ts.window)})` : ''}: DraftKings hasn't posted its showdown contests yet (${pulled}).`
        : `No live list for ${esc(q.label)}: the list covers this week's primetime games only.`;
      body = `<div class="sd-unlock">${why}${others.length ? ` This week: ${others.join(' · ')}.` : ''} Until then, the archive's field sizes below set the Lab.</div>
      <div class="sd-wh-rec"><b>${esc(rec.title)}</b>${rec.lines.map(l => `<p class="${l.small ? 'small' : ''}">${esc(l.t)}</p>`).join('')}</div>
      ${bucketTable()}`;
    }
    const html = `${head}
      <p class="sd-lede">This week's DraftKings showdown GPPs for the Lab's slate, set against what 2026 primetime contests paid: the top-1% cut, how often top-1% lineups were duplicated, and the money a top-1% finish brings per $1 entered. <b>Use in Lab</b> sets the Lab's field size (and the Step 1 contest size) to that contest.</p>
      ${posted && others.length ? `<div class="sd-caption">Also this week: ${others.join(' · ')}</div>` : ''}
      ${body}
      <div class="sd-caption">contests_this_week.json (public DK lobby + contest payout tables${pulled ? `, ${pulled}` : ''}) · contest_economics.json (2026 primetime archive: ${o ? `${fmtN(o.n_contests)} contests, ${o.n_slates} slates` : 'not loaded'}; n per cell, amber = under 3 contests) · $ per $1 = prizes paid to the top 1% of places ÷ entry fees, the return of a player who finishes top 1% exactly 1% of the time, × the dupe haircut for that field × entry max · a cut in points needs the game: load projections and the sim shows it · not advice to enter any contest</div>`;
    if (host.dataset.drawn === html) return;
    const open = host.querySelector('details[open]');
    host.innerHTML = html; host.dataset.drawn = html;
    if (open) { const d = host.querySelector('details'); if (d) d.open = true; }
  };
  const onWhereClick = e => {
    const u = e.target.closest('[data-where-use]');
    if (u) {
      const q = whereQuery(), ts = matchTW(TW && TW.status === 'ok' ? TW : null, q), c = ts && (ts.contests || []).find(x => String(x.contest_id) === u.dataset.whereUse);
      if (!c) return;
      if (linkOn() && lab.link.id === c.contest_id) { lab.link = null; saveLink(null); render(); return; }   // tap again = unlink
      useContest(c.field_size, c.name, c.contest_id, ts.draft_group_id); return;
    }
    const f = e.target.closest('[data-where-field]'); if (f) useContest(+f.dataset.whereField, f.dataset.whereLabel, null, null);
  };

  /* ---------------- this week's routine (per slate, ticks in localStorage) ---------------- */
  // Kickoff / export times are ET wall clock ("2026-09-24T20:15:00", "…_2026-09-23_2042ET.csv") → epoch ms.
  const etMs = (s) => {
    const m = /(\d{4})-(\d{2})-(\d{2})[T _](\d{2}):?(\d{2})/.exec(String(s || '')); if (!m) return null;
    const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    try {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess)).map(x => [x.type, x.value]));
      const asNY = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
      return guess + (guess - asNY);
    } catch { return guess + 4 * 3600e3; }
  };
  const dur = ms => { const a = Math.abs(ms), h = a / 3600e3; return h >= 48 ? `${Math.round(h / 24)} d` : h >= 1 ? `${h < 10 ? h.toFixed(1).replace(/\.0$/, '') : Math.round(h)} h` : `${Math.max(1, Math.round(a / 60e3))} min`; };
  const ROUTINE = [
    { id: 'slate', t: 'Set the slate', jump: 'step1' },
    { id: 'proj', t: 'Load projections', jump: 'sdLabPro' },
    { id: 'lev', t: 'Check the leverage board', jump: 'sdLevBoard' },
    { id: 'build', t: 'Build the book', jump: 'sdAuto' },
    { id: 'port', t: 'Check the portfolio report', jump: 'sdLabPro' },
    { id: 'contests', t: 'Pick contests', jump: 'sdWhere' },
    { id: 'export', t: 'Export the DK upload CSV', jump: 'sdLabPro' },
    { id: 'review', t: 'After the slate: upload results to the review', jump: 'sdReview' }
  ];
  const routineKey = () => SD().state.preset || (lab.source === 'mine' ? 'mine' : lab.poolId) || 'custom';
  const loadTicks = () => { try { const j = JSON.parse(localStorage.getItem(LS_ROUTINE)); return j && typeof j === 'object' && j.s ? j : { v: 1, s: {} }; } catch { return { v: 1, s: {} }; } };
  const ticksFor = key => (loadTicks().s[key] || {}).ticks || {};
  // Keep the 12 most recently touched slates; only ids + booleans + a time go in.
  const tick = (id, on, key = routineKey()) => {
    const j = loadTicks(), cur = j.s[key] || { ticks: {} };
    if (on) cur.ticks[id] = 1; else delete cur.ticks[id];
    cur.at = Date.now(); j.s[key] = cur;
    const keep = Object.entries(j.s).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 12);
    j.s = Object.fromEntries(keep);
    lsSet(LS_ROUTINE, JSON.stringify(j));
  };
  // What the page can see for each step (a hint, never a tick): the reader ticks.
  const routineHints = now => {
    const S = SD(), sl = (S.slates || []).find(x => x.id === S.state.preset), ko = sl && sl.kickoff ? etMs(sl.kickoff) : null, H = {};
    const lock = ko != null ? ko - now : null;
    H.slate = sl ? { t: `${sl.label}${sl.replay ? ' (replay)' : ''}${lock != null ? (lock > 0 ? ` · locks in ${dur(lock)}` : ` · locked ${dur(lock)} ago`) : ''}`, ok: !sl.replay } : { t: 'custom line: pick this week\'s game in Step 1', ok: null };
    const m = lab.mine;
    if (m && m.players.has.proj) {
      const age = m.at ? now - m.at : null, stale = age != null && age > 12 * 3600e3, late = lock != null && lock > 0 && age != null && age > lock;
      H.proj = { t: `${m.at ? `export ${dur(age)} old` : 'loaded'}${lock != null && lock > 0 ? ` · ${dur(lock)} to lock` : ''}${stale || late ? ' · re-export closer to lock' : ''}`, ok: !(stale || late) };
    } else H.proj = { t: m ? 'your file has no projections: the Data Hub export has them' : 'drop your Stokastic Data Hub export in Your slate', ok: null };
    const top = lev && Object.values(lev.roles).filter(r => !r.thin && !r.split && r.players.length).map(r => [r, Math.max(r.cpt.lev, r.flex.lev)]).sort((a, b) => b[1] - a[1])[0];
    H.lev = lev ? { t: top ? `top seat: ${top[0].label} ${sgn(top[1])}` : 'no leverage seat on this slate', ok: true } : { t: 'needs ownership: a sample slate or your Stokastic file', ok: null };
    const A = lab.auto;
    H.build = A && A.st && A.status !== 'running' ? { t: `${A.st.legal.toLocaleString('en-US')} legal lineups graded${A.pick && A.pick.chosen ? ` · batch ${A.pick.chosen.length} of ${S.state.entries}` : ''}`, ok: true } : { t: A && A.status === 'running' ? 'searching…' : 'Build it for me in the Lab', ok: null };
    const B = lab.batch;
    H.port = B ? (() => { const c = { pass: 0, warn: 0, fail: 0 }; B.report.forEach(x => { c[x.status] = (c[x.status] || 0) + 1; }); return { t: `${B.rows.length} lineups · ${c.pass} pass · ${c.warn} warn · ${c.fail} fail`, ok: !c.fail }; })() : { t: 'score a batch in Your slate', ok: null };
    H.contests = linkOn() ? { t: `${shortName(lab.link.name)} · ${lab.link.field.toLocaleString('en-US')} field`, ok: true } : { t: 'Where to enter, Step 5', ok: null };
    H.export = lab.book ? { t: lab.book.ids ? `book of ${lab.book.chosen.length} ready for the DK CSV` : `book of ${lab.book.chosen.length}: load DK salaries for the ids`, ok: !!lab.book.ids } : { t: 'pick a book, then download its DK upload CSV', ok: null };
    H.review = lock != null && lock < -4 * 3600e3 ? { t: 'the slate is over: export DK standings within a week, then drop them in the review', ok: null } : { t: 'Tuesday: DK standings → Tuesday review', ok: null };
    return H;
  };
  const renderRoutine = () => {
    const host = $('sdRoutine'); if (!host || !SD().data) return;
    const key = routineKey(), T = ticksFor(key), H = routineHints(Date.now()), done = ROUTINE.filter(x => T[x.id]).length;
    const sl = (SD().slates || []).find(x => x.id === key);
    const html = `<div class="sd-routine-head"><div class="card-title">This week's routine · <span class="card-title-accent">${esc(sl ? sl.label : key === 'mine' ? 'your slate' : key)}</span></div>
        <span class="sd-routine-n"><b>${done}</b> of ${ROUTINE.length}</span></div>
      <div class="sd-routine-bar" aria-hidden="true"><i style="width:${(done / ROUTINE.length * 100).toFixed(1)}%"></i></div>
      <ol class="sd-routine-list">${ROUTINE.map((x, i) => { const h = H[x.id] || {}; return `<li class="${T[x.id] ? 'done' : ''}">
        <label><input type="checkbox" data-routine="${x.id}" ${T[x.id] ? 'checked' : ''}><span class="sd-routine-i">${i + 1}</span><span class="sd-routine-t">${esc(x.t)}<small class="${h.ok === false ? 'warn' : h.ok ? 'ok' : ''}">${esc(h.t || '')}</small></span></label>
        <a href="nfl/showdown/#${x.jump}" data-jump="${x.jump}" class="sd-link" aria-label="Go to: ${esc(x.t)}">Go</a></li>`; }).join('')}</ol>
      <div class="sd-caption">Ticks are kept on this device per slate (the last 12 slates; nothing else is stored) · the grey line under each step is what the page can see right now · picking a contest in Where to enter and downloading the DK CSV tick themselves · <button type="button" class="sd-link" data-routine-clear>clear this slate's ticks</button></div>`;
    if (host.dataset.drawn === html) return;
    host.innerHTML = html; host.dataset.drawn = html;
  };
  // Summary lines for the folds this file draws into (showdown_folds.js). A hint, like the routine's grey lines.
  const foldAns = () => {
    const F = window.BBI.showdownFolds, S = SD(); if (!F || !S || !S.data) return;
    try {
      const H = routineHints(Date.now()), cap = t => t ? t[0].toUpperCase() + t.slice(1) : '';
      const key = routineKey(), T = ticksFor(key), done = ROUTINE.filter(x => T[x.id]).length, next = ROUTINE.find(x => !T[x.id]);
      F.ans('routine', `<b>${done}</b> of ${ROUTINE.length} done${next ? ` · next: ${esc(next.t)} <a href="nfl/showdown/#${next.jump}" data-jump="${next.jump}" class="sd-link">Go</a>` : ' · all done'}`);
      F.ans('leverage', esc(cap(H.lev.t)));
      const n = (lab.cpt ? 1 : 0) + lab.flex.filter(Boolean).length, pool = lab.source === 'mine' ? 'your slate' : curPool() ? curPool().label : '';
      F.ans('lab', `${n ? `<b>${n} of 6</b> picked` : 'Build a lineup and the engine grades it live, or let <b>Build it for me</b> search the pool'}${pool ? ` · pool ${esc(pool)}` : ''}`);
      F.ans('files', lab.mine ? `Your slate loaded · ${esc(H.proj.t)}${lab.batch ? ` · ${esc(H.port.t)}` : ''}` : 'No files yet · DK salaries, Data Hub export, lineup CSVs · read in your browser, nothing uploaded');
      const q = whereQuery(), ct = S.data.inputs.contest_types.find(c => c.key === S.state.contest);
      F.ans('where', linkOn() ? `Entering <b>${esc(shortName(lab.link.name))}</b> · ${lab.link.field.toLocaleString('en-US')} field` : `This week's DK showdown GPPs${q ? ` for ${esc(q.label)}` : ''}${ct ? ` · fit: own <b>${esc(ct.own_target)}</b>, dupes <b>≤ ${ct.dupe_cap}</b>` : ''}`);
    } catch (err) { /* a summary line is a hint; never let it break the Lab */ }
  };
  const onRoutine = e => {
    const c = e.target.closest('[data-routine]');
    if (c && e.type === 'change') { tick(c.dataset.routine, c.checked); renderRoutine(); foldAns(); return; }
    if (e.type === 'click' && e.target.closest('[data-routine-clear]')) { const j = loadTicks(); delete j.s[routineKey()]; lsSet(LS_ROUTINE, JSON.stringify(j)); renderRoutine(); foldAns(); }
  };

  /* ---------------- boot ---------------- */
  let booted = false;
  const boot = async () => {
    if (booted || !SE || !SD() || !SD().data) return; booted = true;
    load(); lab.link = loadLink();
    const ocP = loadOC();   // fetched alongside the first pool; the Lab draws once both are in
    loadTW().then(() => render());   // Step 5 · Where to enter
    const wh = document.getElementById('sdWhere'); if (wh) wh.addEventListener('click', onWhereClick);
    const rt = document.getElementById('sdRoutine'); if (rt) { rt.addEventListener('change', onRoutine); rt.addEventListener('click', onRoutine); }
    loadSimData().then(() => { if (engine && engine.has.proj) render(); });   // the sim's inputs: only needed once projections are in
    const ids = allPoolIds();
    const pre = SD().state.preset, u = SD().urlIn || {};
    const fresh = SD().nextPrimetime ? SD().nextPrimetime() : (SD().slates || []).find(s => !s.replay);
    lab.poolId = ids.includes(u.slate) ? u.slate : ids.includes(pre) ? pre : fresh ? fresh.id : ids.includes(lab.poolId) ? lab.poolId : ids[ids.length - 1];
    unstash();
    document.getElementById('sdLab').addEventListener('click', onClick);
    document.getElementById('sdLabPro').addEventListener('click', onProClick);
    document.addEventListener('keydown', onKey);
    renderPro();
    await Promise.all([ocP, lab.poolId ? fetchPool(lab.poolId).catch(() => {}) : null]);
    if (lab.poolId) await switchPool(lab.poolId); else render();
    if (u.lu) loadUrlLineup(u.lu);
    urlReady = true; SD().syncUrl();
    // Warm the other pools so switching is instant.
    poolIds().filter(i => i !== lab.poolId).forEach(i => fetchPool(i).catch(() => {}));
  };
  document.addEventListener('sd:ready', boot);
  document.addEventListener('sd:render', () => {
    if (!booted) return;
    const pre = SD().state.preset;
    if (lab.source === 'sample' && pre && pre !== lab.poolId && allPoolIds().includes(pre)) { switchPool(pre); return; }
    render();
  });
  if (SD() && SD().data) boot();

  window.BBI.showdownLab = { lab, render, codexScore, levSortKey, cmpKey, get engine() { return engine; }, readFiles, scoreBatch, pickBook, cardData, urlInfo, reportLines, fetchPool, openLineup, startAuto, stopAuto, verdictFor,
    get lev() { return lev; }, ownOf, useCorr, persistBlob, get oc() { return OC; }, _test: { save, buildEngine, players, setOC: j => { OC = j; }, dupesRange,
      setSim: (rc, econ) => { RC = rc; ECON = econ; simDataDone = true; }, sim: () => ({ world, spec: getSpec(), cuts: simCutsNow(), mode: autoMode(), ready: simReady(), running: simRun }), simStep,
      setTW: j => { TW = j; twDone = true; }, whereQuery, useContest, linkOn, routineHints, tick, ticksFor, routineKey },
    where: { matchTW, econCell, whereRec, shortName, anyTop1, teamsOf, REC_TIER }, routine: { ROUTINE, etMs, dur, LS_ROUTINE } };
})();
