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
  const SE = window.BBI.showdownEngine, FX = window.BBI.fx;
  const SD = () => window.BBI.showdown;
  const POOL_DIR = 'nfl/showdown/pools/';
  const LS_KEY = 'bbi_showdown_lab';
  const CAP = 50000;
  const FIELD_DEFAULT = { se_small: 2000, mid: 12000, large: 100000 };
  const POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
  const SCRIPT_NAME = { A: 'Favorite blowout', B: 'Favorite controls', C: 'Coin flip', D: 'Dog upset' };
  const FEAT_LABEL = { own_QB: 'own QB', own_RB: 'own RB', own_WR: 'own WR', own_TE: 'own TE', own_K: 'own K', own_DST: 'own DST', opp_QB: 'opp QB', opp_RB: 'opp RB', opp_WR: 'opp WR',
    opp_TE: 'opp TE', opp_K: 'opp K', opp_DST: 'opp DST', own_second_catcher: '2nd own catcher', own_second_rb: '2nd own RB', own_second_te: '2nd own TE', both_qbs: 'both QBs' };

  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = v => '$' + Math.round(v).toLocaleString('en-US');
  const $ = id => document.getElementById(id);

  const lab = {
    source: 'sample', poolId: null, pools: {}, mine: null, mineFav: null,
    cpt: null, flex: [null, null, null, null, null],
    pos: 'ALL', team: 'ALL', q: '', sort: 'sal', field: null,
    batch: null, book: null, celebrated: '', prevSlots: {}, built: '', err: '', saved: {}
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
  const poolIds = () => (SD().slates || []).map(s => s.id);
  const curPool = () => lab.source === 'mine' ? null : lab.pools[lab.poolId] || null;
  const players = () => {
    if (lab.source === 'mine' && lab.mine) return lab.mine.players;
    const p = curPool(); return p ? SE.playersFromList(p.players) : null;
  };
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
  const buildEngine = () => {
    const pl = players(); engine = null; lab.err = '';
    if (!pl || !pl.P.size) return null;
    const s = SD().state;
    try {
      engine = SE.createEngine(SD().data, pl, { fav: favTeam(pl), spread: s.spread, total: s.total, wind: windFor(s.env), roof: s.env === 'dome' ? 'dome' : 'outdoors', field: fieldSize(), n: s.entries });
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

  /* ---------------- render: skeleton ---------------- */
  const skeleton = () => {
    const ids = poolIds();
    const pool = curPool(), pl = players();
    const srcChips = ids.map(id => { const s = (SD().slates || []).find(x => x.id === id); return `<button type="button" class="sd-src${lab.source === 'sample' && lab.poolId === id ? ' on' : ''}" data-lab-pool="${esc(id)}"><b>${esc(s ? s.label : id)}</b><small>${esc(s ? `${s.fav} −${s.spread} · ${s.total}` : '')}</small></button>`; }).join('')
      + (lab.mine ? `<button type="button" class="sd-src mine${lab.source === 'mine' ? ' on' : ''}" data-lab-mine><b>Your slate</b><small>${esc(lab.mine.label)}</small></button>` : '');
    const teams = pl ? [...new Set([...pl.P.values()].map(p => p.team))].sort() : [];
    const fav = pl ? favTeam(pl) : '';
    if (lab.team !== 'ALL' && !teams.includes(lab.team)) lab.team = 'ALL';
    $('sdLab').innerHTML = `
      <div class="card sd-lab-bar fx-reveal">
        <div class="sd-lab-bar-row">
          <div class="sd-lab-src"><span class="sd-lab-k">Slate pool</span><div class="sd-srcs">${srcChips || '<span class="sd-num-hint">loading…</span>'}</div></div>
          <div class="sd-lab-opts">
            ${lab.source === 'mine' && teams.length === 2 ? `<label class="sd-lab-opt"><span class="sd-lab-k">Favorite</span><span class="seg">${teams.map(t => `<button type="button" class="${t === fav ? 'active' : ''}" data-lab-fav="${esc(t)}">${esc(t)}</button>`).join('')}</span></label>` : ''}
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
              ${[['sal', 'Salary'], ['name', 'Name'], ...(pl && pl.has.proj ? [['proj', 'Projection']] : []), ...(pl && pl.has.own ? [['own', 'Ownership'], ['value', 'Pts / $1k']] : [])].map(([k, l]) => `<option value="${k}"${lab.sort === k ? ' selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          <div class="sd-pool-filters">
            <div class="sd-pool-pos" role="group" aria-label="Position">${['ALL', ...POS].map(p => `<button type="button" class="${lab.pos === p ? 'on' : ''}" data-lab-pos="${p}">${p}</button>`).join('')}</div>
            <div class="sd-pool-team" role="group" aria-label="Team">${['ALL', ...teams].map(t => `<button type="button" class="${lab.team === t ? 'on' : ''}" data-lab-team="${esc(t)}">${t === 'ALL' ? 'Both' : esc(t)}${t === fav ? '<i>fav</i>' : ''}</button>`).join('')}</div>
          </div>
          <div class="sd-pool-cols"><span>Player</span><span>${pl && pl.has.proj ? 'Proj · Own' : ''}</span><span>Salary</span><span>Add</span></div>
          <div class="sd-pool-list" id="sdPoolList" role="list"></div>
          <div class="sd-caption" id="sdPoolCap"></div>
        </div>
        <div class="sd-lab-build">
          <div class="card card-premium sd-lab-lineup fx-reveal" id="sdLabLineup"></div>
          <div class="card sd-lab-report fx-reveal" id="sdLabReport"></div>
        </div>
      </div>`;
    lab.built = `${lab.source}|${lab.poolId}|${lab.mine ? lab.mine.stamp : ''}|${pl ? pl.has.own : ''}|${fav}|${teams.join()}`;
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
    const used = salaryUsed();
    list.innerHTML = ps.map(p => {
      const cpt = lab.cpt === p.name, inl = inLineup(p.name), over = !inl && used + p.sal > CAP;
      return `<div class="sd-p${inl ? ' in' : ''}${cpt ? ' cpt' : ''}${over ? ' over' : ''}" role="listitem" data-lab-add="${esc(p.name)}" tabindex="0" aria-label="${esc(p.name)}, ${esc(p.pos)} ${esc(p.team)}, ${money(p.sal)}${inl ? ', in lineup' : ''}">
        <span class="sd-pos pos-${esc(p.pos)}">${esc(p.pos)}</span>
        <span class="sd-p-name">${esc(p.name)}<small>${esc(p.team)}${p.team === fav ? ' · fav' : ' · dog'}${engine.rank.get(p.name) === 1 && ['WR', 'RB', 'TE', 'QB'].includes(p.pos) ? ` · ${p.pos}1` : ''}</small></span>
        <span class="sd-p-proj">${has.proj ? `${p.proj.toFixed(1)}${has.own ? `<small>${p.own.toFixed(0)}%</small>` : ''}` : ''}</span>
        <span class="sd-p-sal">${money(p.sal)}<small>CPT ${money(p.sal * 1.5)}</small></span>
        <span class="sd-p-act"><button type="button" class="sd-p-btn c${cpt ? ' on' : ''}" data-lab-cpt="${esc(p.name)}" title="Captain (1.5×)" aria-label="Make ${esc(p.name)} captain">C</button><button type="button" class="sd-p-btn${inl && !cpt ? ' on' : ''}" data-lab-flex="${esc(p.name)}" title="${inl ? 'Remove' : 'Add to FLEX'}" aria-label="${inl ? 'Remove' : 'Add'} ${esc(p.name)}">${inl ? '−' : '+'}</button></span>
      </div>`;
    }).join('') || '<div class="sd-pool-empty">No players match.</div>';
    list.scrollTop = top;
    if (focusKey) { const attr = { row: 'data-lab-add', cpt: 'data-lab-cpt', flex: 'data-lab-flex' }[focusKey[0]]; const el = [...list.querySelectorAll(`[${attr}]`)].find(x => x.getAttribute(attr) === focusKey[1]); if (el) el.focus({ preventScroll: true }); }
    const src = lab.source === 'mine' ? lab.mine.label : `${curPool().label} · ${curPool().week} · ${curPool().source}`;
    $('sdPoolCap').innerHTML = `${ps.length} of ${engine.P.size} players · ${esc(src)}${has.own ? '' : ' · no ownership in this file'}`;
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
        <button type="button" class="btn btn-sm btn-ghost" data-lab-act="clear" ${n ? '' : 'disabled'}>Clear</button>
      </div>
      <div class="sd-paste" id="sdPaste" hidden><input class="sd-pool-q" id="sdPasteIn" placeholder="CPT first: 6 names or DK ids, comma-separated" aria-label="Paste a lineup"><button type="button" class="btn btn-sm btn-primary" data-lab-act="paste-go">Score it</button></div>`;
    FX.morph(prev, host);
    lab.prevSlots = { cpt: lab.cpt, ...Object.fromEntries(lab.flex.map((nm, i) => ['f' + i, nm])) };
    renderReport(r, n);
    SD().setLabScore(r ? { score: sc, verdict: v.title, legal: !r.hard.length, partial: n < 6 } : null);
    // Celebrate a newly completed, legal, strong lineup (once per lineup + slate).
    const k = `${lab.cpt}|${[...lab.flex].sort().join(',')}|${SD().state.spread}|${SD().state.total}|${SD().state.env}`;
    if (r && n === 6 && !r.hard.length && sc >= 70 && lab.celebrated !== k) {
      lab.celebrated = k;
      const g = $('sdGauge').getBoundingClientRect();
      if (g.bottom > 0 && g.top < innerHeight) FX.confetti(g.left + g.width / 2, g.top + g.height / 2, sc >= 85 ? 140 : 70);
      $('sdGauge').classList.add('celebrate');
      SD().toast(`<b>${sc >= 85 ? 'Codex-grade' : 'Strong'} lineup · ${sc}</b> — ${SCRIPT_NAME[r.script.tag]} script, no hard-rule breaks`, 'good');
    }
    save();
  };
  const hasIds = () => engine && [lab.cpt, ...lab.flex].every(nm => nm && (engine.P.has(nm)) && idsOf(nm)[0] && idsOf(nm)[1]);
  const idsOf = nm => { const pl = players(); return (pl && pl.ids && pl.ids.get(nm)) || ['', '']; };

  const STATUS_ICON = { pass: '✓', fail: '✗', pending: '…', unknown: '?', na: '·' };
  const renderReport = (r, n) => {
    const host = $('sdLabReport'); if (!host) return;
    if (!r) { host.innerHTML = `<div class="card-title">Engine report</div><p class="sd-lede">Every rule the engine enforces lights up here as you build: ${SD().data ? Object.keys(SD().data.hard_rules).length : 21} hard rules, ${SD().data ? Object.keys(SD().data.soft_penalties).filter(k => !k.startsWith('_')).length : 15} soft penalties, the overlay adjustments for this slate, and the captain template your lineup should fit.</p>`; return; }
    const prev = FX.snapshot(host);
    const X = r.X, rules = r.rules.filter(x => x.status !== 'na');
    const order = { fail: 0, pending: 1, unknown: 2, pass: 3 };
    rules.sort((a, b) => order[a.status] - order[b.status]);
    const passN = rules.filter(x => x.status === 'pass').length;
    const t = r.template, has = engine.has;
    const ct = SD().data.inputs.contest_types.find(c => c.key === SD().state.contest);
    const own = (ct && /(\d+)\D+(\d+)/.exec(ct.own_target)) || null;
    const featChip = (k, kind) => { const on = X.feats[k]; return `<span class="${kind === 'inc' ? (on ? 'sd-chip-ok' : 'sd-chip-n dim') : (on ? 'sd-chip-no' : 'sd-chip-n dim')}">${kind === 'inc' ? (on ? '✓' : '○') : (on ? '✗' : '○')} ${esc(FEAT_LABEL[k] || k)}</span>`; };
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
          <div class="sd-tmpl">${t.avoid.map(k => featChip(k, 'avd')).join('')}<span class="${t.shapes.includes(X.split) ? 'sd-chip-ok' : 'sd-chip-no'}">shape ${esc(X.split)}${t.shapes.includes(X.split) ? '' : ` · wants ${esc(t.shapes.join('/'))}`}</span></div>`
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
          <span class="sd-lab-k" style="margin-top:10px">Ownership &amp; dupes</span>
          ${has.own ? `<div class="sd-facts">
            <div><span>Cum own</span><b>${FX.num('lab.cum', X.cum, 0, { post: '%' })}</b><small>target ${esc(ct ? ct.own_target : '')}${own ? (X.cum >= +own[1] && X.cum <= +own[2] ? ' ✓' : ' ✗') : ''}</small></div>
            <div><span>Est. dupes</span><b>${FX.num('lab.dupes', X.est_dupes, X.est_dupes < 10 ? 1 : 0)}</b><small>gate ≤ ${r.dupes.gate}${r.dupes.ok ? ' ✓' : ' ✗'}</small></div>
            <div><span>CPT own</span><b>${X.cpt.cpt_own.toFixed(1)}%</b><small>opt ${X.cpt.cpt_opt.toFixed(1)}%</small></div>
            <div><span>Field</span><b>${(engine.A.field / 1000).toFixed(engine.A.field < 10000 ? 1 : 0)}k</b><small>dupes = field × Π own × 6</small></div></div>`
          : `<div class="sd-unlock">This pool has public DraftKings fields only. Drop your Stokastic Data Hub export into <a href="nfl/showdown/#sdLabPro" data-jump="sdLabPro" class="sd-link">Your slate</a> to check ownership, dupes, CPT-optimal and the punt rule.</div>`}
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
    buildEngine();
    const pl = players();
    const key = `${lab.source}|${lab.poolId}|${lab.mine ? lab.mine.stamp : ''}|${pl ? pl.has.own : ''}|${pl ? favTeam(pl) : ''}|${pl ? [...new Set([...pl.P.values()].map(p => p.team))].sort().join() : ''}`;
    if (lab.built !== key) skeleton();
    // drop names that aren't in this pool
    if (engine) { if (lab.cpt && !engine.P.has(lab.cpt)) lab.cpt = null; lab.flex = lab.flex.map(n => n && engine.P.has(n) ? n : null); }
    renderNote(); renderPool(); renderLineup();
    const fld = $('sdLabField'); if (fld && document.activeElement !== fld) fld.value = fieldSize();
    const go = $('sdBatchGo'); if (go) go.disabled = !engine;
    const lbl = $('sdBatchLabel'); if (lbl) lbl.textContent = `${pro.lineupsName ? pro.lineupsName + ' · ' : ''}scored against ${lab.source === 'mine' && lab.mine ? 'your slate' : curPool() ? curPool().label : 'the selected pool'} and the Step 1 line`;
    syncBatch();
    FX.reveal();
  };

  /* ---------------- events ---------------- */
  const bindSkeleton = () => {
    const q = $('sdPoolQ');
    q.addEventListener('input', () => { lab.q = q.value; renderPool(); });
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { const first = $('sdPoolList').querySelector('[data-lab-add]'); if (first) { addFlex(first.dataset.labAdd); lab.q = ''; q.value = ''; render(); q.focus(); } } });
    $('sdPoolSort').addEventListener('change', e => { lab.sort = e.target.value; renderPool(); save(); });
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
    const cptB = t.closest('[data-lab-cpt]'); if (cptB) { const nm = cptB.dataset.labCpt; if (lab.cpt === nm) removeName(nm); else setCpt(nm); render(); return; }
    const flexB = t.closest('[data-lab-flex]'); if (flexB) { addFlex(flexB.dataset.labFlex); render(); return; }
    const row = t.closest('[data-lab-add]'); if (row) { addFlex(row.dataset.labAdd); render(); return; }
    const rm = t.closest('[data-lab-remove]'); if (rm) { removeName(rm.dataset.labRemove); render(); return; }
    const sg = t.closest('[data-lab-sug]'); if (sg) { if (sg.dataset.as === 'cpt') setCpt(sg.dataset.labSug); else addFlex(sg.dataset.labSug); render(); return; }
    const pos = t.closest('[data-lab-pos]'); if (pos) { lab.pos = pos.dataset.labPos; skeletonFilters(); renderPool(); return; }
    const tm = t.closest('[data-lab-team]'); if (tm) { lab.team = tm.dataset.labTeam; skeletonFilters(); renderPool(); return; }
    const pb = t.closest('[data-lab-pool]'); if (pb) { const id = pb.dataset.labPool; syncPreset(id); switchPool(id); return; }
    if (t.closest('[data-lab-mine]')) { stash(); lab.source = 'mine'; unstash(); render(); return; }
    const fv = t.closest('[data-lab-fav]'); if (fv) { lab.mineFav = fv.dataset.labFav; render(); return; }
    if (t.closest('[data-lab-sync]')) { syncPreset(lab.poolId); return; }
    const act = t.closest('[data-lab-act]'); if (act) { labAction(act.dataset.labAct, act); return; }
  };
  const skeletonFilters = () => {
    document.querySelectorAll('[data-lab-pos]').forEach(b => b.classList.toggle('on', b.dataset.labPos === lab.pos));
    document.querySelectorAll('[data-lab-team]').forEach(b => b.classList.toggle('on', b.dataset.labTeam === lab.team));
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
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addFlex(row.dataset.labAdd); render(); }
    if (e.key === 'c' || e.key === 'C') { setCpt(row.dataset.labAdd); render(); }
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
        continue;
      }
      if (pl) {
        base = SE.mergePlayers(base, pl); gotPlayers = true;
        pro.files = pro.files.filter(x => x.name !== f.name).concat({ name: f.name, kind: 'players', desc: `${pl.source === 'stokastic' ? 'Stokastic Data Hub' : 'DraftKings salaries'} · ${pl.P.size} players${pl.ids.size ? ' · DK ids ✓' : ''}${pl.has.own ? ' · ownership ✓' : ''}${pl.has.proj ? ' · projections ✓' : ''}` });
      } else {
        pro.lineupsText = text; pro.lineupsName = f.name;
        pro.files = pro.files.filter(x => x.name !== f.name).concat({ name: f.name, kind: 'lineups', desc: `${Math.max(0, text.trim().split(/\r?\n/).length - 1)} lineup rows` });
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
    if (quiet !== true) SD().toast(`<b>${rows.length} lineups scored</b> · ${rows.filter(r => !r.hard.length).length} legal`, 'good');
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
      <span class="sd-lab-k">Portfolio report <small>every cap in rules.json, for this batch</small></span>
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

  /* ---------------- boot ---------------- */
  let booted = false;
  const boot = async () => {
    if (booted || !SE || !SD() || !SD().data) return; booted = true;
    load();
    const ids = poolIds();
    const pre = SD().state.preset;
    lab.poolId = ids.includes(pre) ? pre : ids.includes(lab.poolId) ? lab.poolId : ids[ids.length - 1];
    unstash();
    document.getElementById('sdLab').addEventListener('click', onClick);
    document.getElementById('sdLabPro').addEventListener('click', onProClick);
    document.addEventListener('keydown', onKey);
    renderPro();
    if (lab.poolId) await switchPool(lab.poolId); else render();
    // Warm the other pools so switching is instant.
    ids.filter(i => i !== lab.poolId).forEach(i => fetchPool(i).catch(() => {}));
  };
  document.addEventListener('sd:ready', boot);
  document.addEventListener('sd:render', () => {
    if (!booted) return;
    const pre = SD().state.preset;
    if (lab.source === 'sample' && pre && pre !== lab.poolId && poolIds().includes(pre)) { switchPool(pre); return; }
    render();
  });
  if (SD() && SD().data) boot();

  window.BBI.showdownLab = { lab, render, codexScore, get engine() { return engine; }, readFiles, scoreBatch, pickBook };
})();
