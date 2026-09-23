/* =====================================================================
   BIRDIEBUDDY — CLASSIC PLAYBOOK (DK main slate)
   Pure functions (band lookup → game read → lineup parsing) + the page
   renderer for nfl/classic/. Every number rendered comes from
   nfl/classic/classic_playbook.json (built by codex/build_classic_data.py);
   the lineup checker runs classic_engine.js, the parity-tested port of
   classic_engine.py. Files dropped in Step 4 are read in the browser only.
   ===================================================================== */
window.BBI = window.BBI || {};

(() => {
  'use strict';

  const DATA_PATH = 'nfl/classic/classic_playbook.json';
  const POOL_DIR  = 'nfl/classic/';
  const LS_KEY    = 'bbi_classic_inputs';
  const SMALL_N   = 15;
  const CE = window.BBI.classicEngine;
  const FX = window.BBI.fx || { num: (k, v, d = 0, o = {}) => `${o.pre || ''}${(+v).toFixed(d)}${o.post || ''}`, snapshot: () => null, morph() {}, reveal() {}, confetti() {}, reduced: () => true, keepFocus: () => () => {}, rove() {} };
  // First-party analytics (track.js); a no-op when it isn't loaded, opted out or offline.
  const track = (e, p) => { try { if (window.BBI.track) window.BBI.track(e, p); } catch {} };
  // Screen readers hear the check's verdict through one small status line (#clStatus), not the re-rendered card.
  const announce = msg => { const el = document.getElementById('clStatus'); if (el && el.textContent !== msg) el.textContent = msg; };
  let ready = false;   // set once the page has loaded its saved lineup: a restored lineup isn't a new check

  /* =================================================================
     1. PURE LOGIC
     ================================================================= */
  // Bands are contiguous: a value belongs to the first band whose `hi` it doesn't exceed (last band: hi = null).
  const bandFor = (v, bands) => bands.find(b => b.hi == null || +v <= b.hi) || bands[bands.length - 1];

  // One game row → the codex read: total-band lift, each side's spread-band lift, stack index, soft-rule eligibility.
  const gameRead = (g, data) => {
    const wg = data.winner_games, S = data.rules.soft;
    const s = Math.abs(+g.spread || 0), t = +g.total || 0;
    const fav = g.fav === g.away ? g.away : g.home, dog = fav === g.home ? g.away : g.home;
    const tb = bandFor(t, wg.total_bands);
    const side = (team, spread) => {
      const b = bandFor(spread, wg.side_bands);
      return { team, spread, band: b, implied: Math.round((t / 2 - spread / 2) * 10) / 10, index: Math.round(tb.lift * b.lift * 100) / 100,
        eligible: t >= S.qb_game_total_min && spread <= S.qb_team_dog_max };
    };
    return { g, total: t, spread: s, totalBand: tb, fav: side(fav, -s), dog: side(dog, s) };
  };

  // All sides on the slate, best stack index first (ties: higher implied total).
  const rankSides = (games, data) => games.filter(validGame).map(g => gameRead(g, data))
    .flatMap(r => [{ ...r.fav, r, isFav: true }, { ...r.dog, r, isFav: false }])
    .sort((a, b) => b.index - a.index || b.implied - a.implied);

  const TEAM_RE = /^[A-Z]{2,4}$/;
  const validGame = g => g && TEAM_RE.test(g.away || '') && TEAM_RE.test(g.home || '') && g.away !== g.home && isFinite(+g.total) && +g.total > 0 && isFinite(+g.spread);

  // Pasted lineup text → cells. Accepts one per line, comma/tab/semicolon lists, DK upload rows ("Name (id)"),
  // slot prefixes ("QB Josh Allen", "FLEX: …") and header rows (QB,RB,…).
  const SLOT_WORDS = new Set(['QB', 'RB', 'WR', 'TE', 'FLEX', 'DST', 'DEF', 'D/ST', 'UTIL']);
  const splitLineup = text => String(text || '').split(/\r?\n/).flatMap(l => l.split(/[,\t;|]/))
    .map(c => c.trim().replace(/^"+|"+$/g, '').replace(/^(QB|RB|WR|TE|FLEX|DST|DEF|D\/ST)\s*[:\-–]?\s+(?=\S)/i, '').trim())
    .filter(c => c && !SLOT_WORDS.has(c.toUpperCase()));

  const parseLineup = (text, eng) => {
    const cells = splitLineup(text), names = [], unresolved = [];
    for (const c of cells) { const n = eng.resolve(c); if (n) names.push(n); else unresolved.push(c); }
    return { cells, names, unresolved };
  };

  // Display order QB, RB, RB, WR, WR, WR, TE, FLEX, DST — FLEX is the last-listed extra RB/WR/TE.
  const slotOrder = ps => {
    const by = k => ps.filter(p => p.pos === k);
    const qb = by('QB'), rb = by('RB'), wr = by('WR'), te = by('TE'), dst = by('DST');
    const flex = rb.length > 2 ? rb.pop() : wr.length > 3 ? wr.pop() : te.length > 1 ? te.pop() : null;
    return [...qb.map(p => ['QB', p]), ...rb.map(p => ['RB', p]), ...wr.map(p => ['WR', p]), ...te.map(p => ['TE', p]), ...(flex ? [['FLEX', flex]] : []), ...dst.map(p => ['DST', p])];
  };

  // Each player's role in the build, from the engine's classification.
  const rolesFor = X => {
    const qb = X.qb, dst = X.dst, gk = p => [p.team, p.opp].sort().join('|'), qg = gk(qb);
    const other = X.ps.filter(p => ['RB', 'WR', 'TE'].includes(p.pos) && gk(p) !== qg);
    const R = new Map();
    for (const p of X.ps) {
      const tags = [];
      if (p === qb) tags.push(['qb', 'QB']);
      else if (p === dst) tags.push(['dst', 'DST']);
      else if (p.team === qb.team) tags.push(['stack', p.pos === 'RB' ? 'stack · RB' : 'stack']);
      else if (p.team === qb.opp) tags.push(['bb', 'bring-back']);
      else {
        const opp = other.some(o => o !== p && o.team === p.opp), mate = other.some(o => o !== p && o.team === p.team);
        tags.push(mate ? ['bad', 'teammate one-off'] : opp ? ['pair', 'opposing pair'] : ['one', 'one-off']);
      }
      if (p !== dst && p.team === dst.opp) tags.push(['bad', 'faces your DST']);
      R.set(p.name, tags);
    }
    return R;
  };

  // Walk "winners.catchers.naked" / "winner_checks.hard.x" / "winner_games.rows.total_ge48" (rows are keyed arrays).
  const getPath = (obj, path) => path.split('.').reduce((o, k) => o == null ? null : Array.isArray(o) ? o.find(x => x.key === k) : o[k], obj);

  const money = v => '$' + Math.round(+v).toLocaleString('en-US');
  const fmtRule = (fmt, v) => {
    if (fmt === 'money') return money(v);
    if (fmt === 'pct_raw') return `${v}%`;
    if (fmt === 'share') return `${Math.round(v * 100)}%`;
    if (fmt === 'range') return `${v[0]}–${v[1]}`;
    if (fmt === 'bool') return v ? 'required' : 'optional';
    if (fmt === 'dupes') return v.map(([lim, m]) => `≤${m} up to ${lim >= 1e6 ? lim / 1e6 + 'M' : lim / 1000 + 'k'}`).join(' · ');
    return String(v);
  };
  const cardText = (card, rules) => {
    const [tier, key] = card.path.split('.'), v = rules[tier][key];
    const f = s => s.replace(/\{v\}/g, fmtRule(card.fmt, v)).replace(/\{chalk\}/g, rules.hard.chalk_own_threshold);
    return { tier, key, value: v, title: f(card.title), rule: f(card.rule) };
  };

  /* =================================================================
     2. PAGE
     ================================================================= */
  const esc  = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nTag = n => `<span class="n${n < SMALL_N ? ' small' : ''}">n = ${n}${n < SMALL_N ? ' · small sample' : ''}</span>`;
  const kn   = r => `${r.k}/${r.n}${r.k < SMALL_N ? ' <span class="n small">small sample</span>' : ''}`;
  const $id  = id => document.getElementById(id);
  const TIER = { hard: ['HARD', 'cl-tier-hard'], soft: ['SOFT', 'cl-tier-soft'], portfolio: ['PORTFOLIO', 'cl-tier-port'] };
  const STATUS_ICON = { pass: '✓', fail: '✗', unknown: '?', flag: '!', bonus: '+' };

  let data = null;
  const state = { preset: null, games: [], text: '', sample: null };
  const lab = { pool: null, files: [], mine: null, err: '', celebrated: '', completed: '' };

  const store = {
    load() { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; } },
    save() { try { localStorage.setItem(LS_KEY, JSON.stringify({ preset: state.preset, games: state.games, text: state.text })); } catch {} },
    clear() { try { localStorage.removeItem(LS_KEY); } catch {} }
  };
  const presetById = id => (data.presets.slates || []).find(s => s.id === id) || null;
  // The default slate: this week's (the earliest main slate still to come), not a look-ahead week the lines file
  // already carries; the latest one when every slate has been played.
  const currentPresetId = (sl, now = new Date()) => {
    sl = sl || []; const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const up = sl.filter(s => s.date && s.date >= today).sort((a, b) => a.date < b.date ? -1 : 1)[0];
    return (up || sl[0] || {}).id;
  };
  const loadPreset = id => { const p = presetById(id); if (!p) return false; state.preset = id; state.games = p.games.map(g => ({ ...g })); return true; };

  /* ---------- hero + dock ---------- */
  const renderHero = () => {
    const wg = data.winner_games, ch = data.winner_checks.hard._all_checkable;
    $id('clProv').innerHTML = `
      <span><strong>${data.winners.n}</strong> Milly Maker winners 2016–25</span>
      <span><strong>${wg.baseline_games.toLocaleString('en-US')}</strong> games 2016–25</span>
      <span>rules.json <strong>v${esc(String(data.rules.version).split(' ')[0])}</strong></span>
      <span>Winners the hard rules allow: <strong class="gold">${ch.pct}%</strong> (${ch.k}/${ch.n})</span>`;
  };
  const renderDock = () => {
    const games = state.games.filter(validGame), top = rankSides(state.games, data)[0];
    const res = lastCheck;
    const chk = !res ? 'paste a lineup' : !res.roster.ok ? 'incomplete' : res.hard.some(h => h.status === 'fail') ? `${res.hard.filter(h => h.status === 'fail').length} hard fail` : `hard ✓ · ${res.soft.filter(s => s.status === 'flag').length} flags`;
    $id('clDock').innerHTML = `
      <div class="cl-dock-inner">
        ${[['step1', '1', 'Slate'], ['step2', '2', 'Games'], ['step3', '3', 'Rules'], ['step4', '4', 'Check']].map(([id, n, l]) => `<a href="nfl/classic/#${id}" data-jump="${id}" class="cl-dock-step"><b>${n}</b>${l}</a>`).join('')}
        <span class="cl-dock-read"><span>${games.length} games</span>${top ? `<span>top stack <b class="gold">${esc(top.team)}</b></span>` : ''}<span class="${res && res.roster.ok && !res.hard.some(h => h.status === 'fail') ? 'gold' : ''}">${esc(chk)}</span></span>
      </div>`;
  };

  /* ---------- Step 1: set the slate ---------- */
  const renderPresets = () => {
    $id('clPresets').innerHTML = (data.presets.slates || []).map(p => `<button type="button" class="chip${state.preset === p.id ? ' active' : ''}" data-preset="${esc(p.id)}" aria-pressed="${state.preset === p.id}">${esc(p.label)} <span class="count">${p.games.length}</span></button>`).join('')
      + `<button type="button" class="chip" data-preset="__blank" aria-pressed="false">Blank slate</button>`;
  };
  // The editor re-renders only on add / remove / preset (typing never loses focus).
  const renderEditor = () => {
    const rows = state.games.map((g, i) => `
      <div class="cl-game" data-i="${i}">
        <label class="cl-f cl-f-team"><span>Away</span><input class="sd-num" data-f="away" value="${esc(g.away)}" maxlength="4" autocomplete="off" aria-label="Away team, game ${i + 1}"></label>
        <span class="cl-at">@</span>
        <label class="cl-f cl-f-team"><span>Home</span><input class="sd-num" data-f="home" value="${esc(g.home)}" maxlength="4" autocomplete="off" aria-label="Home team, game ${i + 1}"></label>
        <label class="cl-f cl-f-fav"><span>Favorite</span><select class="sd-num" data-f="fav" aria-label="Favorite, game ${i + 1}">
          <option value="${esc(g.away)}"${g.fav === g.away ? ' selected' : ''}>${esc(g.away || 'away')}</option>
          <option value="${esc(g.home)}"${g.fav !== g.away ? ' selected' : ''}>${esc(g.home || 'home')}</option></select></label>
        <label class="cl-f cl-f-num"><span>Spread</span><input class="sd-num" data-f="spread" type="number" inputmode="decimal" step="0.5" min="0" max="30" value="${esc(g.spread)}" aria-label="Spread, game ${i + 1}"></label>
        <label class="cl-f cl-f-num"><span>Total</span><input class="sd-num" data-f="total" type="number" inputmode="decimal" step="0.5" min="20" max="80" value="${esc(g.total)}" aria-label="Total, game ${i + 1}"></label>
        <button type="button" class="cl-x" data-remove="${i}" aria-label="Remove game ${i + 1}">×</button>
      </div>`).join('');
    $id('clGames').innerHTML = rows || '<div class="cl-empty">No games yet — load a week above or add one.</div>';
    if (!state.preset || !state.games.length) $id('clEdit').open = true;
  };
  // Compact, always-visible slate summary; the editor itself sits in a fold.
  const renderChips = () => {
    const games = state.games.filter(validGame);
    $id('clChips').innerHTML = games.map(g => `<span class="cl-chip"><b>${esc(g.away)}@${esc(g.home)}</b> ${esc(g.fav)} ${+g.spread ? '−' + Math.abs(+g.spread) : 'PK'} · ${esc(g.total)}</span>`).join('');
    $id('clEditSum').textContent = `Edit games · ${state.games.length}${state.preset ? '' : ' · custom'}`;
  };
  const renderRead = () => {
    const sides = rankSides(state.games, data), S = data.rules.soft;
    const games = state.games.filter(validGame);
    const bad = state.games.length - games.length;
    if (!games.length) { $id('clRead').innerHTML = `<div class="card-title">Where to stack</div><p class="sd-lede">Add games with a spread and a total to rank the stack spots.</p>`; return; }
    const max = Math.max(...sides.map(s => s.index), 1);
    const reads = games.map(g => gameRead(g, data)).sort((a, b) => b.total - a.total);
    $id('clRead').innerHTML = `
      <div class="card-title">Where to stack · <span class="card-title-accent">${games.length} games</span></div>
      <p class="sd-lede">Each side's <strong>stack index</strong> = how often winning QB stacks came from its total band × from its spread band, relative to all games (1.0 = no edge). Sides that fail the soft rules (total ≥ ${S.qb_game_total_min}, no bigger than a +${S.qb_team_dog_max} dog) are dimmed.</p>
      <div class="cl-sides">${sides.slice(0, 8).map((s, i) => `
        <div class="cl-side${i < 3 && s.eligible ? ' top' : ''}${s.eligible ? '' : ' dim'}">
          <span class="cl-side-rank">${i + 1}</span>
          <span class="cl-side-team"><b>${esc(s.team)}</b><small>${s.spread === 0 ? 'PK' : s.isFav ? `fav −${Math.abs(s.spread)}` : `dog +${s.spread}`} · vs ${esc(s.isFav ? s.r.dog.team : s.r.fav.team)} · ${s.r.total}</small></span>
          <span class="bar"><span class="bar-fill${s.eligible ? '' : ' dim'}" data-m="side.${esc(s.team)}" style="width:${Math.min(100, s.index / max * 100).toFixed(1)}%"></span></span>
          <span class="cl-side-v">${FX.num(`side.${s.team}.v`, s.index, 2)}<small>implied ${s.implied}</small></span>
        </div>`).join('')}</div>
      <details class="sd-fold"><summary>Every game, by total <span class="sd-fold-arrow">›</span></summary>
        <div class="cl-reads">${reads.map(r => `
          <div class="cl-readrow"><b>${esc(r.g.away)} @ ${esc(r.g.home)}</b>
            <span>total ${r.total} · band ${esc(r.totalBand.label)} ×${r.totalBand.lift.toFixed(2)} (${kn(r.totalBand.winners)} winners)</span>
            <span>${esc(r.fav.team)} ${r.fav.implied} · ${esc(r.fav.band.label)} ×${r.fav.band.lift.toFixed(2)} · ${esc(r.dog.team)} ${r.dog.implied} · ${esc(r.dog.band.label)} ×${r.dog.band.lift.toFixed(2)}</span></div>`).join('')}</div>
      </details>
      <div class="sd-caption">${nTag(data.winner_games.n)} winning QB games vs ${data.winner_games.baseline_games.toLocaleString('en-US')} games (${data.winner_games.baseline_team_games.toLocaleString('en-US')} team-games) · derived · lift = winner share ÷ all-games share${bad ? ` · ${bad} incomplete row${bad > 1 ? 's' : ''} ignored` : ''}</div>`;
  };

  /* ---------- Step 2: which games the winning stacks came from ---------- */
  const pair = (key, label, w, b, note = '') => `
    <div class="cl-pair">
      <span class="cl-pair-l">${esc(label)}${note}</span>
      <span class="cl-pair-bars"><span class="bar"><span class="bar-fill" data-m="${key}.w" style="width:${w.pct}%"></span></span><span class="bar"><span class="bar-fill dim" data-m="${key}.b" style="width:${b.pct}%"></span></span></span>
      <span class="cl-pair-v"><b>${w.pct}%</b><small>${b.pct}%</small></span>
      <span class="cl-pair-n">${kn(w)}</span>
    </div>`;
  const renderGamesStep = () => {
    const wg = data.winner_games, m = wg.medians;
    $id('clWhere').innerHTML = `
      <div class="card-title">The winning QB's game · <span class="card-title-accent">vs every game</span></div>
      <div class="cl-legend"><span><i class="w"></i>Winners' QB game</span><span><i class="b"></i>All games 2016–25</span><span>right: winners k/n</span></div>
      <div class="cl-pairs">${wg.rows.map(r => pair(`wg.${r.key}`, r.label, r.winners, r.baseline, r.unit === 'team' ? ' <small>team</small>' : '')).join('')}</div>
      <div class="sd-strip cl-strip">
        <div class="sd-strip-cell"><b>${m.winners_total}</b><span>winners' median total</span></div>
        <div class="sd-strip-cell"><b>${m.baseline_total}</b><span>all games</span></div>
        <div class="sd-strip-cell"><b>${m.winners_implied}</b><span>winners' implied</span></div>
        <div class="sd-strip-cell"><b>${m.baseline_implied}</b><span>all teams</span></div>
      </div>
      <p class="sd-lede">${esc(wg.about)} Team rows count both sides of every game (${wg.baseline_team_games.toLocaleString('en-US')}).</p>
      <div class="sd-caption">${nTag(wg.n)} winners joined to lines · baseline ${wg.baseline_games.toLocaleString('en-US')} games · derived (MMT × nflverse)</div>`;
    const bandCard = (id, title, bands, sub) => {
      const mx = Math.max(...bands.map(b => b.lift));
      $id(id).innerHTML = `
        <div class="card-title">${title}</div>
        <div class="cl-bands">${bands.map(b => `
          <div class="cl-band${b.lift >= 1.25 ? ' hot' : b.lift < 0.8 ? ' cold' : ''}">
            <span class="cl-band-l">${esc(b.label)}</span>
            <span class="bar"><span class="bar-fill${b.lift < 1 ? ' dim' : ''}" data-m="${id}.${esc(b.key)}" style="width:${(b.lift / mx * 100).toFixed(1)}%"></span></span>
            <span class="cl-band-v">×${b.lift.toFixed(2)}</span>
            <span class="cl-band-n">${b.winners.pct}% vs ${b.baseline.pct}% · ${kn(b.winners)}</span>
          </div>`).join('')}</div>
        <div class="sd-caption">${sub}</div>`;
    };
    bandCard('clTotals', 'By closing total · <span class="card-title-accent">lift</span>', wg.total_bands, `lift = share of winning QB games ÷ share of all ${wg.baseline_games.toLocaleString('en-US')} games · derived`);
    bandCard('clSides', "By the QB team's spread · <span class=\"card-title-accent\">lift</span>", wg.side_bands, `vs ${wg.baseline_team_games.toLocaleString('en-US')} team-games · derived`);
  };

  /* ---------- Step 3: the rules ---------- */
  // Direction-only cohort (the study's rates withheld: build_classic_data.py PUBLISH_COHORT_RATES).
  const COH_DIR = { over: 'more in the top 1% / top 3', under: 'less in the top 1% / top 3', neutral: 'about as often as the field' };
  const cohortTable = key => {
    const t = data.cohort.tables[key]; if (!t) return '';
    const C = data.cohort.cohorts;
    if (t.rows.some(r => !Array.isArray(r.v))) return `<details class="sd-fold cl-cohort"><summary>${esc(t.title)} · top finishers vs the field <span class="sd-fold-arrow">›</span></summary>
      <div class="cl-ctab">${t.rows.map(r => `<div class="cl-crow dir ${esc(r.verdict)}"><span>${esc(r.label)}</span><em>${esc(COH_DIR[r.verdict] || r.verdict)}</em></div>`).join('')}
      <div class="cl-crow dir head"><span>n</span><em>${C.map(c => `${esc(c.label)} ${c.n >= 1e6 ? (c.n / 1e6).toFixed(2) + 'M' : c.n.toLocaleString('en-US')}`).join(' · ')}</em></div></div>
      <div class="sd-caption">curated · ${esc(data.cohort.about)}</div></details>`;
    return `<details class="sd-fold cl-cohort"><summary>${esc(t.title)} · field → top 1% → top 3 <span class="sd-fold-arrow">›</span></summary>
      <div class="cl-ctab">${t.rows.map(r => `<div class="cl-crow ${r.verdict}"><span>${esc(r.label)}</span>${r.v.map(v => `<b>${v}</b>`).join('')}</div>`).join('')}
      <div class="cl-crow head"><span>n</span>${C.map(c => `<b>${c.n >= 1e6 ? (c.n / 1e6).toFixed(2) + 'M' : c.n.toLocaleString('en-US')}</b>`).join('')}</div></div>
      <div class="sd-caption">curated · ${esc(data.cohort.about)}</div></details>`;
  };
  const ruleCard = card => {
    const t = cardText(card, data.rules), [lbl, cls] = TIER[t.tier];
    const pass = t.tier === 'portfolio' ? null : getPath(data.winner_checks, `${t.tier}.${t.key}`);
    const stat = card.stat ? getPath(data, card.stat) : null;
    return `
      <article class="card cl-rule fx-reveal">
        <div class="cl-rule-head"><span class="cl-tier ${cls}">${lbl}</span><h4>${esc(t.title)}</h4></div>
        <p class="cl-rule-text">${esc(t.rule)}</p>
        ${pass ? `<div class="sd-rate"><span>winners pass</span><span class="bar"><span class="bar-fill" data-m="rc.${esc(card.path)}" style="width:${pass.pct}%"></span></span><span class="v">${pass.pct}%</span></div>
          <div class="sd-caption">${kn(pass)} winners · derived</div>` : t.tier === 'hard' ? `<div class="sd-caption">winners not checkable — ${esc(card.needs || 'needs data the winner export lacks')}</div>` : ''}
        ${stat && stat.pct != null && !(pass && pass.k === stat.k && pass.n === stat.n) ? `<div class="cl-stat"><b>${stat.pct}%</b> ${esc(card.stat_label)} <span>${kn(stat)}</span></div>` : ''}
        <p class="cl-why">${esc(card.why)} <span class="cl-src">curated</span></p>
        ${card.cohort ? cohortTable(card.cohort) : ''}
      </article>`;
  };
  const renderRules = () => {
    const W = data.winners, all = data.winner_checks.hard._all_checkable;
    const shape = W.stack_shape;
    $id('clRulesHead').innerHTML = `
      <div class="card-title">How the winners were built · <span class="card-title-accent">${W.n} Milly Maker winners</span></div>
      <div class="cl-shape">${shape.map((s, i) => `<div class="cl-shape-seg s${Math.min(s.catchers, 3)}" data-m="shape.${i}" style="flex-basis:${s.pct}%" title="${esc(s.label)} ${s.pct}%"><span>${s.pct >= 9 ? `${esc(s.label)} <b>${s.pct}%</b>` : s.pct >= 4 ? `<b>${s.pct}</b>` : ''}</span></div>`).join('')}</div>
      <div class="sd-legend">${shape.map(s => `<span>${esc(s.label)} ${s.pct}% (${s.k})</span>`).join('')}</div>
      <div class="sd-kpis cl-kpis">
        <div class="sd-kpi"><b>${W.bring_back.any.pct}%</b><span>any bring-back · RB ${W.bring_back.RB.pct}%</span></div>
        <div class="sd-kpi"><b>${W.secondary.opp_pair_any.pct}%</b><span>secondary opposing pair</span></div>
        <div class="sd-kpi"><b>${W.ownership.cum_median}%</b><span>median cum. ownership</span></div>
        <div class="sd-kpi"><b>${W.ownership.le10_mean}</b><span>players ≤10% owned (mean)</span></div>
        <div class="sd-kpi"><b>${money(W.qb.salary_median)}</b><span>median QB · ${W.qb.own_median}% owned</span></div>
        <div class="sd-kpi"><b>${W.salary.full_cap.pct}%</b><span>used the full $50k</span></div>
      </div>
      <p class="sd-lede">The hard rules below would have let through <strong>${all.pct}%</strong> of historical winners (${all.k}/${all.n}, every rule the winner export can check). The strictest is the no-teammate one-off rule — ${data.winner_checks.hard.max_secondary_same_team_pairs.pct}% pass. Rules are a filter on a sim-ranked pool, not a lineup generator.</p>
      <div class="sd-caption">${nTag(W.n)} · derived from the Milly Maker Tracker export · rule values from rules.json v${esc(String(data.rules.version).split(' ')[0])}</div>`;
    $id('clRules').innerHTML = data.rule_groups.map(g => {
      const cards = data.rule_cards.filter(c => c.group === g.key);
      return `<section class="cl-group"><div class="cl-group-head"><h3>${esc(g.title)}</h3><span>${esc(g.sub)}</span></div><div class="cl-rules">${cards.map(ruleCard).join('')}</div></section>`;
    }).join('') + `<details class="sd-fold cl-laws"><summary>The ten laws · CLASSIC_BIBLE Part A <span class="sd-fold-arrow">›</span></summary>
      <ol>${data.laws.map(l => `<li><b>${esc(l.title)}.</b> ${esc(l.text)}</li>`).join('')}</ol><div class="sd-caption">curated</div></details>`;
  };

  // Power Sweep & Spy: a DK CLASSIC small-field study (moved here from the showdown page, where it didn't belong).
  const renderSmallField = () => {
    const host = $id('clSmallField'), S = data.small_field_study; if (!host) return;
    if (!S) { host.hidden = true; return; }
    const sf = S.study;
    host.hidden = false;
    host.innerHTML = `
      <div class="card-title">${esc(S.title)} · <span class="card-title-accent">small-field winners vs the field</span></div>
      <p class="sd-lede">${esc(S.about)} The one lever that kept separating winners: <strong>a lower-owned QB</strong>. Stack shape, TE price, defense cost and the flex spot did not.</p>
      <div class="sd-small-field" role="img" aria-label="Small-field classic study: QB under 10% owned in ${esc(sf.qb_under_10pct.winners)} of winners vs ${esc(sf.qb_under_10pct.field)} of the field">
        <div><b>${esc(sf.qb_under_10pct.winners)}</b><span>QB under 10% owned</span><em>field ${esc(sf.qb_under_10pct.field)}</em></div>
        <div><b>${esc(sf.qb_plus_2.winners)}</b><span>QB + 2 own catchers</span><em>field ${esc(sf.qb_plus_2.field)}</em></div>
        <div><b>${esc(sf.run_back.power_sweep)}</b><span>Run-back · Power Sweep</span><em>Spy: ${esc(sf.run_back.spy)}</em></div>
        <div><b>${esc(sf.total_own.power_sweep)}% / ${esc(sf.total_own.spy)}%</b><span>Total own · PS / Spy</span></div>
        <div><b>${esc(sf.te_under_4k_spy)}</b><span>TE under $4k (Spy)</span><em>flex RB ${esc(sf.flex_rb)}</em></div>
        <div><b>${esc(sf.dupes)}</b><span>Winners duplicated</span><em>sim ROI+ ${esc(sf.sim_roi_positive)}</em></div>
      </div>
      <div class="sd-caption">${esc(sf.source)} · 55 winning lineups (one per Sunday), all unique users · curated from the published study</div>`;
  };

  /* ---------- Step 4: the checker ---------- */
  let lastCheck = null;
  const players = () => lab.mine || (lab.pool ? CE.playersFromList(lab.pool.players) : null);
  // Step 1 lines, minus any whose opponent disagrees with the player pool (a Week 1 slate must not grade a Week 2 lineup).
  const slateLines = pl => {
    const L = CE.linesFromGames(state.games.filter(validGame)), oppOf = new Map();
    for (const p of pl.P.values()) if (p.opp && !oppOf.has(p.team)) oppOf.set(p.team, p.opp);
    for (const [t, l] of L) if (oppOf.has(t) && oppOf.get(t) !== l.opp) L.delete(t);
    return L;
  };
  const engine = () => { const pl = players(); return pl ? CE.createEngine(data.rules, pl, slateLines(pl)) : null; };

  const renderLabShell = () => {
    const S = data.samples;
    $id('clLab').innerHTML = `
      <div class="cl-lab-grid">
        <div class="card sd-panel cl-lab-in">
          <div class="card-title">Your lineup</div>
          <div class="cl-src-row" id="clSrc"></div>
          <div class="sd-drop cl-drop" id="clDrop" tabindex="0" role="button" aria-label="Load files: DraftKings classic salary CSV or a Stokastic Data Hub main-slate export">
            <input type="file" id="clFiles" accept=".csv,.txt" multiple hidden>
            <b>Drop your DK salary CSV</b><span>DKSalaries.csv for your slate · optional: a Stokastic Data Hub main export to check the chalk and ownership rules</span>
            <small>🔒 Read in your browser — nothing is uploaded.</small>
          </div>
          <label class="sd-lab-k" for="clText">Paste 9 players <small>one per line, comma-separated, or a DK upload row</small></label>
          <textarea id="clText" rows="9" spellcheck="false" placeholder="QB  C.J. Stroud&#10;RB  Bijan Robinson&#10;…">${esc(state.text)}</textarea>
          <div class="sd-lab-actions">${S.map(s => `<button type="button" class="btn btn-sm" data-sample="${esc(s.id)}">${esc(s.label)} sample</button>`).join('')}<button type="button" class="btn btn-sm" data-clear>Clear</button></div>
        </div>
        <div class="card sd-panel card-premium cl-lab-out" id="clOut"></div>
      </div>`;
    const inp = $id('clFiles'), drop = $id('clDrop');
    drop.addEventListener('click', () => inp.click());
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
    inp.addEventListener('change', () => readFiles([...inp.files]));
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => readFiles([...(e.dataTransfer?.files || [])]));
    let t = 0;
    $id('clText').addEventListener('input', e => { state.text = e.target.value; state.sample = null; clearTimeout(t); t = setTimeout(() => { store.save(); renderCheck(); renderDock(); }, 160); });
  };
  const renderSrc = () => {
    const pl = players();
    $id('clSrc').innerHTML = lab.mine
      ? `<span class="cl-src-pill on">Your files · ${pl.P.size} player${pl.P.size === 1 ? '' : 's'}${pl.has.own ? ' · ownership ✓' : ''}</span>${lab.files.map(f => `<span class="cl-src-file">${esc(f)}</span>`).join('')}<button type="button" class="cl-linkbtn" data-src="sample">use the sample pool</button>`
      : lab.pool ? `<span class="cl-src-pill">${esc(lab.pool.label)} · ${lab.pool.players.length} players</span><span class="cl-src-note">public DK fields only — drop your own DK salary CSV for this week</span>`
      : `<span class="cl-src-pill">Loading the sample pool…</span>`;
    if (lab.err) $id('clSrc').innerHTML += `<span class="cl-src-err">${esc(lab.err)}</span>`;
  };
  const readFiles = async files => {
    lab.err = '';
    let base = lab.mine;
    for (const f of files) {
      try {
        const pl = CE.readPlayers(await f.text());
        base = CE.mergePlayers(base, pl);
        track('file_load', { type: pl.source === 'stokastic' ? 'stokastic_classic' : 'dk_salaries_classic', card: 'classic' });
        lab.files = lab.files.filter(x => x !== f.name).concat(f.name);
      } catch (e) { lab.err = `${f.name}: ${e.message || e}`; }
    }
    if (base) lab.mine = base;
    renderSrc(); renderCheck(); renderDock();
  };

  const ruleMeta = (tier, key) => {
    const k = key === 'bring_back' ? 'bring_back_lean' : key;
    const card = data.rule_cards.find(c => c.path === `${tier}.${k}`);
    return card ? cardText(card, data.rules) : { title: key.replace(/_/g, ' '), rule: '' };
  };
  const renderCheck = () => {
    const host = $id('clOut'); if (!host) return;
    const eng = engine();
    if (!eng) { host.innerHTML = '<div class="card-title">Check</div><p class="sd-lede">Loading players…</p>'; lastCheck = null; return; }
    const P = parseLineup(state.text, eng);
    const res = P.names.length ? eng.check(P.names) : null;
    lastCheck = res;
    if (!P.cells.length) {
      host.innerHTML = `<div class="card-title">Check</div><p class="sd-lede">Paste a DK classic lineup — or load a sample — and the engine runs the ${Object.keys(data.rules.hard).length - 1} classic hard rules and ${Object.keys(data.rules.soft).length} soft rules on it, with the QB-game lines from Step 1.</p>`;
      return;
    }
    const unres = P.unresolved.length ? `<div class="sd-rule fail"><i>✗</i><span>Not in the player pool: ${P.unresolved.map(esc).join(', ')}<small>${lab.mine ? 'check the spelling or the salary file' : 'the sample pool is Week 2 main — drop your DK salary CSV for another slate'}</small></span></div>` : '';
    if (!res || !res.roster.ok) {
      const R = res ? res.roster : { issues: [], n: 0 };
      announce(`Check: ${P.names.length} of 9 players${P.unresolved.length ? ` · ${P.unresolved.length} not in the pool` : ''}`);
      host.innerHTML = `<div class="card-title">Check · <span class="card-title-accent">${P.names.length}/9 players</span></div>
        <div class="sd-rules">${unres}${R.issues.map(i => `<div class="sd-rule unknown"><i>?</i><span>DK roster: ${esc(i)}</span></div>`).join('')}${P.names.length < 9 ? `<div class="sd-rule unknown"><i>…</i><span>${9 - P.names.length} more player${9 - P.names.length > 1 ? 's' : ''} to settle the rules</span></div>` : ''}</div>`;
      return;
    }
    const X = res.X, roles = rolesFor(X), H = data.winner_checks.hard, SW = data.winner_checks.soft;
    const fails = res.hard.filter(h => h.status === 'fail'), unk = res.hard.filter(h => h.status === 'unknown');
    const flags = res.soft.filter(s => s.status === 'flag'), pen = flags.reduce((a, s) => a + s.pen, 0);
    const verdict = fails.length ? ['fail', `Rejected · ${fails.length} hard rule${fails.length > 1 ? 's' : ''} fail`] : flags.length ? ['warn', `Passes the hard rules · ${flags.length} soft flag${flags.length > 1 ? 's' : ''}`] : ['pass', 'Clean · codex-shaped'];
    const slots = slotOrder(X.ps);
    const own = players().has.own;
    host.innerHTML = `
      <div class="card-title">Check · <span class="card-title-accent">${esc(X.qb.name)} stack</span></div>
      <div class="cl-verdict ${verdict[0]}"><b>${verdict[1]}</b><span>${res.hard.length - fails.length - unk.length}/${res.hard.length} hard pass${unk.length ? ` · ${unk.length} needs ownership` : ''} · soft penalty ${pen ? FX.num('ck.pen', pen, 1, { pre: '−' }) : '0'}</span></div>
      <div class="cl-slots">${slots.map(([slot, p]) => `
        <div class="cl-slot"><span class="cl-slot-k">${slot}</span><span class="cl-slot-n">${esc(p.name)}<small>${esc(p.team)} vs ${esc(p.opp)} · ${money(p.sal)}${own ? ` · ${Math.round(p.own)}%` : ''}</small></span>
          <span class="cl-tags">${(roles.get(p.name) || []).map(([c, l]) => `<em class="cl-tag ${c}">${esc(l)}</em>`).join('')}</span></div>`).join('')}</div>
      <div class="cl-sum">
        <span>QB + <b>${X.n_catch}</b></span><span>bring-back <b>${X.bb.map(p => p.pos).join('+') || '—'}</b></span><span>sec. opp pairs <b>${X.sec_opp}</b></span>
        <span><b>${X.games}</b> games</span><span>FLEX <b>${X.flex}</b></span><span><b>${money(X.sal)}</b></span>${own ? `<span>cum <b>${Math.round(X.cum)}%</b></span>` : ''}
      </div>
      <div class="cl-ck-grid">
        <div><div class="cl-ck-h">Hard rules <small>winners that pass</small></div>
          <div class="sd-rules">${unres}${res.hard.map(h => { const m = ruleMeta('hard', h.key), w = H[h.key]; return `<div class="sd-rule ${h.status}"><i>${STATUS_ICON[h.status]}</i><span>${esc(m.title)} <em class="cl-w">${w ? `${w.pct}%` : '—'}</em><small>${esc(h.msg)} · ${esc(m.rule)}</small></span></div>`; }).join('')}</div></div>
        <div><div class="cl-ck-h">Soft rules <small>winners that pass</small></div>
          <div class="sd-rules">${res.soft.map(s => { const m = ruleMeta('soft', s.key), w = SW[s.key === 'bring_back' ? 'bring_back_lean' : s.key]; const st = s.status === 'flag' ? 'cl-flag' : s.status === 'bonus' ? 'pass' : s.status; return `<div class="sd-rule ${st}"><i>${STATUS_ICON[s.status]}</i><span>${s.key === 'rb_own_dst' ? 'RB + own DST (bonus)' : esc(m.title)} ${w ? `<em class="cl-w">${w.pct}%</em>` : ''}<small>${esc(s.msg)}${s.status === 'flag' ? ` · −${s.pen}` : s.status === 'bonus' ? ' · +0.1' : ''}</small></span></div>`; }).join('')}</div></div>
      </div>
      <div class="sd-caption">engine: ${esc(res.engineHard.join('; ') || 'no hard failures')} · ${esc(flags.map(f => f.label).join('; ') || 'no soft flags')} · classic_engine.js, parity-tested against classic_engine.py · winner pass rates ${nTag(data.winner_checks.n)}</div>`;
    const key = P.names.join('|') + state.games.length;
    announce(`Check: ${verdict[1]}`);
    if (lab.completed !== key) { if (ready) track('lab_lineup_complete', { band: verdict[0], hard_fails: fails.length, soft_flags: flags.length, pool: lab.mine ? 'mine' : 'sample', page: 'classic' }); lab.completed = key; }
    if (verdict[0] === 'pass' && lab.celebrated !== key) {
      lab.celebrated = key;
      const r = host.getBoundingClientRect(); if (r.top < innerHeight && r.bottom > 0) FX.confetti(r.left + r.width / 2, r.top + 40, 70);
      if (ready) track('celebrate', { band: 'pass', page: 'classic' });
    }
  };

  /* ---------- master render ---------- */
  const renderLive = () => { const prev = FX.snapshot(), restore = FX.keepFocus(); renderPresets(); renderChips(); renderRead(); renderCheck(); renderDock(); store.save(); restore(); FX.morph(prev); FX.reveal(); };
  const renderAll = () => { renderHero(); renderPresets(); renderEditor(); renderChips(); renderRead(); renderGamesStep(); renderRules(); renderSmallField(); renderLabShell(); renderSrc(); renderCheck(); renderDock(); FX.reveal(); };

  let toastT = 0;
  const toast = msg => { const t = $id('clToast'); if (!t) return; t.className = 'sd-toast show'; t.innerHTML = msg; clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'sd-toast'; }, 2600); };
  const jump = id => { const el = $id(id); if (el) el.scrollIntoView({ behavior: FX.reduced() ? 'auto' : 'smooth', block: 'start' }); };

  const bind = () => {
    document.addEventListener('click', e => {
      const p = e.target.closest('[data-preset]');
      if (p) {
        track('preset_select', { id: p.dataset.preset === '__blank' ? 'blank' : p.dataset.preset, from: 'classic' });
        if (p.dataset.preset === '__blank') { state.preset = null; state.games = [{ away: '', home: '', fav: '', spread: '', total: '' }]; }
        else if (loadPreset(p.dataset.preset)) { $id('clEdit').open = false; toast(`<b>${esc(presetById(p.dataset.preset).label)}</b> loaded · ${state.games.length} games`); }
        renderEditor(); renderLive(); return;
      }
      if (e.target.closest('#clAdd')) { state.games.push({ away: '', home: '', fav: '', spread: '', total: '' }); state.preset = null; renderEditor(); renderLive(); const rows = document.querySelectorAll('.cl-game'); rows[rows.length - 1]?.querySelector('input')?.focus(); return; }
      const rm = e.target.closest('[data-remove]'); if (rm) { state.games.splice(+rm.dataset.remove, 1); state.preset = null; renderEditor(); renderLive(); return; }
      const s = e.target.closest('[data-sample]');
      if (s) {
        const smp = data.samples.find(x => x.id === s.dataset.sample); if (!smp) return;
        state.text = smp.lineup.join('\n'); state.sample = smp.id; $id('clText').value = state.text;
        if (lab.mine) { lab.mine = null; lab.files = []; renderSrc(); }
        const qb = lab.pool && lab.pool.players.find(x => x.name === smp.lineup[0]);
        const onSlate = qb && state.games.some(g => (g.away === qb.team && g.home === qb.opp) || (g.home === qb.team && g.away === qb.opp));
        if (!onSlate && smp.preset && loadPreset(smp.preset)) { renderEditor(); toast(`Step 1 set to <b>${esc(presetById(smp.preset).label)}</b> to match the sample`); }
        renderLive(); return;
      }
      if (e.target.closest('[data-clear]')) { state.text = ''; $id('clText').value = ''; renderLive(); return; }
      const src = e.target.closest('[data-src]'); if (src) { lab.mine = null; lab.files = []; lab.err = ''; renderSrc(); renderLive(); return; }
      const j = e.target.closest('[data-jump]'); if (j) { e.preventDefault(); jump(j.dataset.jump); return; }
      if (e.target.closest('#clReset')) { store.clear(); state.text = ''; loadPreset(currentPresetId(data.presets.slates)); renderAll(); }
    });
    // Game editor: typing updates state + the downstream read, never the editor itself.
    const onEdit = e => {
      const el = e.target.closest('[data-f]'); if (!el) return;
      const row = el.closest('.cl-game'), g = state.games[+row.dataset.i]; if (!g) return;
      const f = el.dataset.f;
      if (f === 'away' || f === 'home') {
        const was = g[f]; g[f] = el.value.toUpperCase().replace(/[^A-Z]/g, ''); if (el.value !== g[f]) el.value = g[f];
        if (!g.fav || g.fav === was) g.fav = g.fav === was && was ? g[f] : g.home;      // the favorite follows its own box
        const sel = row.querySelector('[data-f="fav"]');
        sel.options[0].value = g.away; sel.options[0].textContent = g.away || 'away'; sel.options[1].value = g.home; sel.options[1].textContent = g.home || 'home';
        sel.selectedIndex = g.fav === g.away && g.away !== g.home ? 0 : 1;
      } else if (f === 'fav') g.fav = el.value;
      else g[f] = el.value === '' ? '' : +el.value;
      state.preset = null; renderLive();
    };
    document.addEventListener('input', onEdit); document.addEventListener('change', onEdit);
  };

  const showError = msg => {
    const host = $id('clError'); if (!host) return;
    host.hidden = false;
    host.innerHTML = `<div class="card sd-error"><h3>Classic Playbook data didn't load</h3><p class="sd-lede">${esc(msg)} — the page reads <code>${DATA_PATH}</code>. Refresh, or check the deploy.</p></div>`;
    const page = $id('clPage'); if (page) page.hidden = true;
  };

  const init = async () => {
    try {
      const res = await fetch(DATA_PATH, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
      if (!data || !data.rules || !data.winner_games || !data.winners) throw new Error('unexpected JSON shape');
      if (!CE) throw new Error('classic_engine.js did not load');
    } catch (e) { showError(e.message || String(e)); return; }
    const saved = store.load();
    if (saved && typeof saved === 'object' && Array.isArray(saved.games)) {
      state.games = saved.games.filter(g => g && typeof g === 'object').map(g => ({ away: String(g.away || ''), home: String(g.home || ''), fav: String(g.fav || ''), spread: g.spread ?? '', total: g.total ?? '' }));
      state.preset = presetById(saved.preset) ? saved.preset : null; state.text = typeof saved.text === 'string' ? saved.text : '';
    } else loadPreset(currentPresetId(data.presets.slates));
    const v = $id('clVersion'); if (v) v.textContent = data.meta.version;
    bind();
    renderAll();
    try {
      const sp = data.sample_pools[0];
      const r = await fetch(POOL_DIR + sp.file, { cache: 'no-cache' });
      if (r.ok) lab.pool = await r.json(); else lab.err = `sample pool: HTTP ${r.status}`;
    } catch (e) { lab.err = `sample pool: ${e.message || e}`; }
    renderSrc(); renderCheck(); renderDock();
    ready = true;
    const h = (location.hash || '').slice(1);
    if (/^step[1-4]$/.test(h)) setTimeout(() => { const el = $id(h); if (el) el.scrollIntoView({ block: 'start' }); }, 150);
  };

  // Public surface (tests + verification harness).
  window.BBI.classic = { currentPresetId, bandFor, gameRead, rankSides, validGame, splitLineup, parseLineup, slotOrder, rolesFor, getPath, fmtRule, cardText, state, get data() { return data; }, get lab() { return lab; }, init, renderAll };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
