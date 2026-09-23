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
    auto: null, autoMode: 'codex', rowFocus: null
  };

  /* ---------------- persistence ---------------- */
  // One lineup remembered per slate pool, so switching slates never loses work.
  const lineupKey = () => lab.source === 'mine' ? 'mine' : lab.poolId;
  const stash = () => { if (lineupKey()) lab.saved[lineupKey()] = { cpt: lab.cpt, flex: lab.flex.slice() }; };
  const unstash = () => { const s = lab.saved[lineupKey()]; lab.cpt = s ? s.cpt : null; lab.flex = s && Array.isArray(s.flex) && s.flex.length === 5 ? s.flex.slice() : [null, null, null, null, null]; };
  const save = () => { stash(); try { localStorage.setItem(LS_KEY, JSON.stringify({ poolId: lab.poolId, saved: lab.saved, field: lab.field, sort: lab.sort })); } catch {} };
  const load = () => { try { const s = JSON.parse(localStorage.getItem(LS_KEY)); if (s && typeof s === 'object') { lab.poolId = s.poolId || null; lab.saved = s.saved && typeof s.saved === 'object' ? s.saved : {}; lab.field = s.field || null; lab.sort = s.sort || 'sal'; } } catch {} };

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
    if (lab.source === 'mine' && lab.mine) return lab.mine.players;
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
  const fieldSize = () => lab.field || FIELD_DEFAULT[SD().state.contest] || 11700;
  const windFor = env => env === 'wind_15_plus' ? 15 : env === 'wind_10_14' ? 12 : 0;
  let engine = null;
  const engineOpts = pl => { const s = SD().state; return { fav: favTeam(pl), spread: s.spread, total: s.total, wind: windFor(s.env), roof: s.env === 'dome' ? 'dome' : 'outdoors', field: fieldSize(), n: s.entries }; };
  const buildEngine = () => {
    const pl = players(); engine = null; lab.err = '';
    if (!pl || !pl.P.size) return null;
    try {
      engine = SE.createEngine(SD().data, pl, engineOpts(pl));
    } catch (e) { lab.err = e.message; }
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
    if (lab.team !== 'ALL' && !teams.includes(lab.team)) lab.team = 'ALL';
    $('sdLab').innerHTML = `
      <div class="card sd-lab-bar fx-reveal">
        <div class="sd-lab-bar-row">
          <div class="sd-lab-src"><span class="sd-lab-k">Slate pool</span><div class="sd-srcs">${srcChips || '<span class="sd-num-hint">loading…</span>'}</div></div>
          <div class="sd-lab-opts">
            ${lab.source === 'mine' && teams.length === 2 ? `<label class="sd-lab-opt"><span class="sd-lab-k">Favorite</span><span class="seg">${teams.map(t => `<button type="button" class="${t === fav ? 'active' : ''}" aria-pressed="${t === fav}" data-lab-fav="${esc(t)}">${esc(t)}</button>`).join('')}</span></label>` : ''}
            <label class="sd-lab-opt"><span class="sd-lab-k">Field size</span><input class="sd-num" id="sdLabField" type="number" min="100" max="2000000" step="100" value="${fieldSize()}" aria-label="Contest field size"></label>
          </div>
        </div>
        <div class="sd-lab-bar-note" id="sdLabNote"></div>
      </div>
      <div class="sd-lab-grid">
        <div class="card sd-lab-pool fx-reveal">
          <div class="sd-pool-head">
            <input class="sd-pool-q" id="sdPoolQ" type="search" placeholder="Search players  /" value="${esc(lab.q)}" aria-label="Search players" autocomplete="off">
            <select class="sd-pool-sort" id="sdPoolSort" aria-label="Sort players">
              ${[['sal', 'Salary'], ['name', 'Name'], ...(pl && pl.has.proj ? [['proj', 'Projection']] : []), ...(pl && pl.has.own ? [['own', bbOwn() ? 'BB proj own' : 'Ownership']] : []), ...(pl && pl.has.proj ? [['value', 'Pts / $1k']] : [])].map(([k, l]) => `<option value="${k}"${lab.sort === k ? ' selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          <div class="sd-pool-filters">
            <div class="sd-pool-pos" role="group" aria-label="Position">${['ALL', ...POS].map(p => `<button type="button" class="${lab.pos === p ? 'on' : ''}" aria-pressed="${lab.pos === p}" data-lab-pos="${p}">${p}</button>`).join('')}</div>
            <div class="sd-pool-team" role="group" aria-label="Team">${['ALL', ...teams].map(t => `<button type="button" class="${lab.team === t ? 'on' : ''}" aria-pressed="${lab.team === t}" data-lab-team="${esc(t)}">${t === 'ALL' ? 'Both' : esc(t)}${t === fav ? '<i>fav</i>' : ''}</button>`).join('')}</div>
          </div>
          <div class="sd-pool-cols"><span>Player</span><span>${pl && pl.has.proj ? 'Proj · Own' : pl && pl.has.own ? 'Own %' : ''}</span><span>Salary</span><span>Add</span></div>
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
    lab.built = `${lab.source}|${lab.poolId}|${lab.mine ? lab.mine.stamp : ''}|${pl ? pl.has.own : ''}|${fav}|${teams.join()}|${ids.join()}`;
    bindSkeleton();
  };

  /* ---------------- render: pool list ---------------- */
  const renderPool = () => {
    const list = $('sdPoolList'); if (!list) return;
    if (!engine) { list.innerHTML = `<div class="sd-pool-empty">${esc(lab.err || 'Loading the slate pool…')}</div>`; return; }
    const q = lab.q.trim().toLowerCase(), fav = engine.A.fav, has = engine.has;
    let ps = [...engine.P.values()].filter(p => (lab.pos === 'ALL' || p.pos === lab.pos) && (lab.team === 'ALL' || p.team === lab.team) && (!q || p.name.toLowerCase().includes(q)));
    const key = { sal: p => -p.sal, name: p => p.name, proj: p => -p.proj, own: p => -p.own, value: p => -(p.sal ? p.proj / p.sal * 1000 : 0) }[lab.sort] || (p => -p.sal);
    ps.sort((a, b) => { const x = key(a), y = key(b); return x < y ? -1 : x > y ? 1 : b.sal - a.sal; });
    const top = list.scrollTop;
    const ae = document.activeElement, focusKey = ae && list.contains(ae) ? (ae.dataset.labAdd ? ['row', ae.dataset.labAdd] : ae.dataset.labCpt ? ['cpt', ae.dataset.labCpt] : ae.dataset.labFlex ? ['flex', ae.dataset.labFlex] : null) : null;
    const used = salaryUsed(), bb = bbOwn();
    const status = new Map(((curPool() && lab.source === 'sample' && curPool().players) || []).filter(p => p.status).map(p => [p.name, p.status]));
    // Roving tabindex: the list is one tab stop (the last row the keyboard was on, else the first); its C / + buttons are for pointers.
    const rover = ps.some(p => p.name === lab.rowFocus) ? lab.rowFocus : ps.length ? ps[0].name : null;
    list.innerHTML = ps.map(p => {
      const cpt = lab.cpt === p.name, inl = inLineup(p.name), over = !inl && used + p.sal > CAP;
      return `<div class="sd-p${inl ? ' in' : ''}${cpt ? ' cpt' : ''}${over ? ' over' : ''}" role="listitem" data-lab-add="${esc(p.name)}" tabindex="${p.name === rover ? 0 : -1}" aria-label="${esc(p.name)}, ${esc(p.pos)} ${esc(p.team)}, ${money(p.sal)}${cpt ? ', captain' : inl ? ', in lineup' : ''}${over ? ', over the cap' : ''}">
        <span class="sd-pos pos-${esc(p.pos)}">${esc(p.pos)}</span>
        <span class="sd-p-name">${esc(p.name)}<small>${esc(p.team)}${p.team === fav ? ' · fav' : ' · dog'}${engine.rank.get(p.name) === 1 && ['WR', 'RB', 'TE', 'QB'].includes(p.pos) ? ` · ${p.pos}1` : ''}${status.get(p.name) ? ` · <b class="sd-p-status">${esc(status.get(p.name))}</b>` : ''}</small></span>
        <span class="sd-p-proj">${has.proj ? `${p.proj.toFixed(1)}${has.own ? `<small>${p.own.toFixed(0)}%</small>` : ''}` : has.own ? `${ownPct(p.own)}<small>${bb ? 'BB proj' : 'own'}</small>` : ''}</span>
        <span class="sd-p-sal">${money(p.sal)}<small>CPT ${money(p.sal * 1.5)}</small></span>
        <span class="sd-p-act"><button type="button" tabindex="-1" class="sd-p-btn c${cpt ? ' on' : ''}" data-lab-cpt="${esc(p.name)}" title="Captain (1.5×)" aria-label="Make ${esc(p.name)} captain">C</button><button type="button" tabindex="-1" class="sd-p-btn${inl && !cpt ? ' on' : ''}" data-lab-flex="${esc(p.name)}" title="${inl ? 'Remove' : 'Add to FLEX'}" aria-label="${inl ? 'Remove' : 'Add'} ${esc(p.name)}">${inl ? '−' : '+'}</button></span>
      </div>`;
    }).join('') || '<div class="sd-pool-empty">No players match.</div>';
    list.scrollTop = top;
    if (focusKey) { const attr = { row: 'data-lab-add', cpt: 'data-lab-cpt', flex: 'data-lab-flex' }[focusKey[0]]; const el = [...list.querySelectorAll(`[${attr}]`)].find(x => x.getAttribute(attr) === focusKey[1]); if (el) el.focus({ preventScroll: true }); }
    const src = lab.source === 'mine' ? lab.mine.label : `${curPool().label} · ${curPool().week} · ${curPool().source}`;
    const gone = lab.source === 'sample' && curPool() ? curPool().players.length - engine.P.size : 0;
    $('sdPoolCap').innerHTML = `${ps.length} of ${engine.P.size} players${gone > 0 ? ` (${gone} out / IR hidden)` : ''} · ${esc(src)}${bb ? ` · ownership: <b>BB proj</b> — ${esc(bb.own_source)}, ${esc(bb.own_quality || 'rough')}${bb.own_note ? ` (${esc(bb.own_note)})` : ''}` : has.own ? '' : ' · no ownership in this file'}`;
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
      if (urlReady) track('lab_lineup_complete', { band: T().band(sc, !r.hard.length), legal: !r.hard.length, script: tag || '', pool: lab.source, hard_fails: r.hard.length });
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
      <div class="sd-own-note">Cut = median past score for the tier (range across ${L.slates.length} slates); gold = your projection clears it. A projection is a median outcome and a top-1% finish takes a ceiling game, and cuts move with how much the game scores, so read the gap, not a pass/fail.</div>`;
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

  const STATUS_ICON = { pass: '✓', fail: '✗', pending: '…', unknown: '?', na: '·' };
  const renderReport = (r, n) => {
    const host = $('sdLabReport'); if (!host) return;
    if (!r) { host.innerHTML = `<div class="card-title">Engine report</div><p class="sd-lede">Every rule the engine enforces lights up here as you build: ${SD().data ? Object.keys(SD().data.hard_rules).length : 21} hard rules, ${SD().data ? Object.keys(SD().data.soft_penalties).filter(k => !k.startsWith('_')).length : 15} soft penalties, the overlay adjustments for this slate, and the captain template your lineup should fit.</p>`; return; }
    const prev = FX.snapshot(host);
    const X = r.X, rules = r.rules.filter(x => x.status !== 'na');
    const order = { fail: 0, pending: 1, unknown: 2, pass: 3 };
    rules.sort((a, b) => order[a.status] - order[b.status]);
    const passN = rules.filter(x => x.status === 'pass').length;
    const t = r.template, has = engine.has, bb = bbOwn();
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
          <span class="sd-lab-k" style="margin-top:10px">Ownership &amp; dupes${bb ? ` <small>BB proj · ${esc(bb.own_quality || 'rough')}</small>` : ''}</span>
          ${has.own ? `<div class="sd-facts">
            <div><span>Cum own</span><b>${FX.num('lab.cum', X.cum, 0, { post: '%' })}</b><small>target ${esc(ct ? ct.own_target : '')}${own ? (X.cum >= +own[1] && X.cum <= +own[2] ? ' ✓' : ' ✗') : ''}</small></div>
            <div><span>Est. dupes</span><b>${FX.num('lab.dupes', X.est_dupes, X.est_dupes < 10 ? 1 : 0)}</b><small>gate ≤ ${r.dupes.gate}${r.dupes.ok ? ' ✓' : ' ✗'}</small></div>
            <div><span>CPT own</span><b>${X.cpt.cpt_own.toFixed(1)}%</b><small>${has.cpt_opt ? `opt ${X.cpt.cpt_opt.toFixed(1)}%` : bb ? 'BB proj' : 'no optimal %'}</small></div>
            <div><span>Field</span><b>${(engine.A.field / 1000).toFixed(engine.A.field < 10000 ? 1 : 0)}k</b><small>dupes = field × Π own × 6</small></div></div>
            ${bb ? `<div class="sd-own-note">Ownership here is <b>BB proj</b>: ${esc(bb.own_source)} — rough, good for chalk / mid / under-3% tiers and a dupe warning, not precise CPT ownership. Drop your Stokastic Data Hub export into <a href="nfl/showdown/#sdLabPro" data-jump="sdLabPro" class="sd-link">Your slate</a> for projections, CPT-optimal and the punt rule.</div>` : ''}`
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

  /* ---------------- master ---------------- */
  const render = () => {
    if (!SD() || !SD().data || !$('sdLab')) return;
    const restore = FX.keepFocus();
    buildEngine();
    const pl = players();
    const key = `${lab.source}|${lab.poolId}|${lab.mine ? lab.mine.stamp : ''}|${pl ? pl.has.own : ''}|${pl ? favTeam(pl) : ''}|${pl ? [...new Set([...pl.P.values()].map(p => p.team))].sort().join() : ''}`;
    if (lab.built !== key) skeleton();
    // drop names that aren't in this pool
    if (engine) { if (lab.cpt && !engine.P.has(lab.cpt)) lab.cpt = null; lab.flex = lab.flex.map(n => n && engine.P.has(n) ? n : null); }
    renderNote(); renderPool(); renderLineup(); renderAuto();
    const fld = $('sdLabField'); if (fld && document.activeElement !== fld) fld.value = fieldSize();
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
    f.addEventListener('change', () => { const v = Math.round(+f.value); lab.field = v >= 100 ? v : null; render(); });
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
  const searchKey = () => engine ? JSON.stringify([lab.source, lab.poolId, lab.mine && lab.mine.stamp, { ...engine.A, n: 0 }]) : '';
  const autoMode = () => lab.autoMode === 'proj' && engine && engine.has.proj ? 'proj' : 'codex';
  const autoPlan = () => { const N = SD().state.entries; return { N, counts: SD().largestRemainder(SD().derive().alloc, N) }; };
  const autoFresh = () => lab.auto && lab.auto.st && lab.auto.status !== 'running' && lab.auto.key === searchKey();
  const autoTop = () => {
    const A = lab.auto, m = autoMode();
    if (A.topKey !== m + A.status) { A.top = SB.topCards(A.st, m, 12, 3); A.topKey = m + A.status; }
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
    const k = JSON.stringify([N, counts, autoMode(), A.status, fieldSize()]);
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
      <span class="sd-bl-why">${lead != null ? `codex ${r.codex} · ` : ''}${money(r.sal)} · ${esc(r.split)}${r.proj ? ` · ${r.proj.toFixed(1)} pts` : ''}${r.dupes != null ? ` · dupes ~${r.dupes.toFixed(r.dupes < 10 ? 1 : 0)}` : ''}</span></button>`;
  const autoCard = (r, i) => {
    const p = engine && engine.P.get(r.cpt);
    return `<button type="button" class="sd-auto-card" data-auto-load="t${i}" title="Load into the Lab">
      <span class="sd-auto-card-top"><span class="sd-bl-score ${r.codex >= 85 ? 'elite' : r.codex >= 70 ? 'good' : ''}">${r.codex}</span><span class="sd-script-badge sm">${r.tag}</span><em>${money(r.sal)}${r.proj ? ` · ${r.proj.toFixed(1)} pts` : ''}</em></span>
      <b>${p ? `<span class="sd-pos pos-${esc(p.pos)}">${esc(p.pos)}</span>` : ''}<span>${esc(r.cpt)}<small>CPT${p ? ` · ${esc(p.team)}${p.team === engine.A.fav ? ' fav' : ' dog'}` : ''}</small></span></b>
      <span class="sd-auto-flex">${r.flex.map(esc).join(' · ')}</span>
      <small>${esc(r.split)} · K ${r.k} · DST ${r.dst}${r.dupes != null ? ` · dupes ~${r.dupes.toFixed(r.dupes < 10 ? 1 : 0)}` : ''} · fit − pen ${r.raw >= 0 ? '+' : '−'}${Math.abs(r.raw).toFixed(2)}</small></button>`;
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
          <p class="sd-lede">Every legal captain + five flex from ${esc(pool)}'s top ${SB.TOP} players (by ${has.proj ? 'projection' : 'salary'}, plus each team's K and DST), ${money(H.min_salary_used)}–${money(H.max_salary ?? CAP)}, every hard rule, graded by the same engine as the Lab and ranked by ${mode === 'proj' ? 'projection' : 'codex score'}. ${N > 1 ? `Then the engine picks your ${N}-lineup batch with its portfolio rules and your Step 3 plan (${plan}).` : 'Tap a result to load it into the Lab.'}</p></div>
        <div class="sd-auto-go">
          ${has.proj ? `<span class="seg" role="group" aria-label="Rank by">${[['codex', 'Codex score'], ['proj', 'Projection']].map(([k, l]) => `<button type="button" class="${mode === k ? 'active' : ''}" aria-pressed="${mode === k}" data-auto="mode" data-mode="${k}">${l}</button>`).join('')}</span>` : ''}
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
    const best = top[0], at100 = SB.ranked(st, 'codex').filter(r => r.codex === 100).length;
    const skipped = st.skippedCaptains || [];
    const html = `${head}
      ${fresh ? '' : `<div class="sd-auto-stale">The line, pool or field changed since this search: these grades are for the old one. <button type="button" class="sd-link" data-auto="go">Search again</button></div>`}
      <div class="sd-batch-sum sd-auto-sum">
        <div><span>Graded</span><b>${FX.num('au.full', st.full, 0, { sep: true })}</b><small>lineups in the salary window</small></div>
        <div><span>Legal</span><b>${FX.num('au.legal', st.legal, 0, { sep: true })}</b><small>${st.full ? Math.round(st.legal / st.full * 100) : 0}% pass every hard rule</small></div>
        <div><span>Best codex</span><b>${best ? best.codex : '—'}</b><small>${at100 ? `${at100.toLocaleString('en-US')} kept at 100` : 'of 100'}</small></div>
        <div><span>Search</span><b>${st.players} players</b><small>${st.captains} captains · ${(A.ms / 1000).toFixed(1)} s${st.capped ? ' · capped' : ''}${A.status === 'stopped' ? ` · stopped at ${Math.round(st.frac * 100)}%` : ''}</small></div>
      </div>
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
      <span class="sd-lab-k">Top lineups <small>tap one to load it into the Lab · at most 3 per captain</small></span>
      <div class="sd-auto-cards">${top.map(autoCard).join('') || '<div class="sd-unlock">No legal lineup in this pool at this line.</div>'}</div>
      <div class="sd-caption">n = ${st.legal.toLocaleString('en-US')} legal lineups, each graded by the Lab's engine (codex score = 50 + 50 × (story fit − penalties)) · ties: unclamped fit − penalties, ${has.proj ? 'projection, ' : ''}salary used · kept ${(st.kept || 0).toLocaleString('en-US')} (best ${SB.PER_BUCKET} per script × captain) for the batch · players outside the top ${SB.TOP} never enter a build${skipped.length ? ` · ${skipped.length} captain${skipped.length > 1 ? 's' : ''} ruled out up front (${esc(skipped.map(x => `${x[0]}: ${x[1]}`).join('; '))})` : ''}</div>`;
    if (autoDrawn.get(host) === html) return;   // every Lab click re-renders: keep the DOM (and an open selection log) when nothing changed
    const open = host.querySelector('.sd-auto-batch details[open]');
    host.innerHTML = html; autoDrawn.set(host, html);
    if (open) { const d = host.querySelector('.sd-auto-batch details'); if (d) d.open = true; }
    FX.morph(new Map(), host);
  };
  const autoAction = (a, btn) => {
    if (a === 'go') { startAuto(); return; }
    if (a === 'stop') { stopAuto(); return; }
    if (a === 'mode') { lab.autoMode = btn.dataset.mode; renderAuto(); return; }
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
  };
  const readFiles = async files => {
    let base = lab.mine ? lab.mine.players : null, gotPlayers = false;
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
        track('file_load', { type: pl.source === 'stokastic' ? 'stokastic' : 'dk_salaries', card: 'lab', own: !!pl.has.own, proj: !!pl.has.proj });
        pro.files = pro.files.filter(x => x.name !== f.name).concat({ name: f.name, kind: 'players', desc: `${pl.source === 'stokastic' ? 'Stokastic Data Hub' : 'DraftKings salaries'} · ${pl.P.size} players${pl.ids.size ? ' · DK ids ✓' : ''}${pl.has.own ? ' · ownership ✓' : ''}${pl.has.proj ? ' · projections ✓' : ''}` });
      } else {
        pro.lineupsText = text; pro.lineupsName = f.name;
        pro.files = pro.files.filter(x => x.name !== f.name).concat({ name: f.name, kind: 'lineups', desc: `${Math.max(0, text.trim().split(/\r?\n/).length - 1)} lineup rows` });
        track('file_load', { type: 'lineups', card: 'lab' });
      }
    }
    if (gotPlayers) {
      const teams = [...new Set([...base.P.values()].map(p => p.team))].sort();
      lab.mine = { players: base, label: `${teams.join(' / ')} · ${base.P.size} players`, stamp: Date.now() };
      stash(); lab.source = 'mine'; unstash();
      SD().toast(`<b>Your slate loaded</b> — ${esc(lab.mine.label)}${base.has.own ? ' · every rule live' : ''}`, 'good');
    }
    renderPro(); render();
    if (pro.lineupsText && files.some(f => pro.lineupsName === f.name)) scoreBatch();
  };

  // What the batch was scored against; if it changes, the batch is re-scored.
  const engineKey = () => engine ? JSON.stringify([lab.source, lab.poolId, lab.mine && lab.mine.stamp, engine.A, engine.settings.DUPE_MAX]) : '';
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

  /* ---------------- boot ---------------- */
  let booted = false;
  const boot = async () => {
    if (booted || !SE || !SD() || !SD().data) return; booted = true;
    load();
    const ids = allPoolIds();
    const pre = SD().state.preset, u = SD().urlIn || {};
    const fresh = SD().nextPrimetime ? SD().nextPrimetime() : (SD().slates || []).find(s => !s.replay);
    lab.poolId = ids.includes(u.slate) ? u.slate : ids.includes(pre) ? pre : fresh ? fresh.id : ids.includes(lab.poolId) ? lab.poolId : ids[ids.length - 1];
    unstash();
    document.getElementById('sdLab').addEventListener('click', onClick);
    document.getElementById('sdLabPro').addEventListener('click', onProClick);
    document.addEventListener('keydown', onKey);
    renderPro();
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

  window.BBI.showdownLab = { lab, render, codexScore, get engine() { return engine; }, readFiles, scoreBatch, pickBook, cardData, urlInfo, reportLines, fetchPool, openLineup, startAuto, stopAuto, verdictFor };
})();
