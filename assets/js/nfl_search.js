/* =====================================================================
   BIRDIEBUDDY — NFL PLAYER SEARCH + PLAYER CARDS
   Reads nfl/players/players.json (codex/site/players_public.py) on first
   use, never at page load, plus nfl/classic/chill/verdicts.json
   (codex/classic/chill_classic.py) for each card's Classic Chill verdict.
   Search covers the main slate (players) and this week's upcoming
   primetime showdowns (showdown): one row per player per slate, with a
   slate badge; showdown cards show FLEX salary + captain ownership.
   Three entry points, no libraries:
     BBI.nflSearch.openPalette(opener)  search dialog (the header button)
     BBI.nflSearch.open(name)           a player's card in the dialog
     [data-nfl-search] input            inline typeahead (nfl/players/)
     [data-nfl-browse] element          position tabs + top players list
   Any element with [data-nfl-search-open] opens the dialog; "/" too.
   Combobox + modal dialog patterns: arrows, Enter, Esc, focus trap,
   focus returns to the opener. Loads its own stylesheet.
   ===================================================================== */
window.BBI = window.BBI || {};

(() => {
  'use strict';
  if (window.BBI.nflSearch) return;   // idempotent (header loader + page tag)

  const DATA_URL = 'nfl/players/players.json';
  // Classic Chill picks, one verdict per player (codex/classic/chill_classic.py): the card's verdict comes from the same
  // source as the Chill page, so the two never disagree
  const CHILL_URL = 'nfl/classic/chill/verdicts.json';
  const CHILL_PAGE = 'nfl/classic/chill/';
  const VERDICT = { play: 'play', ok: 'fine', skip: 'skip', popular: 'popular' };
  const VTAG = { play: 'Pick', skip: 'Skip' };   // list rows show only the two that change a decision
  const CSS_URL = 'assets/css/nfl_search.css?v=3';
  const SD_STALE_MS = 6 * 3600e3;   // a showdown leaves search 6 h after kickoff, as in players_public.SD_STALE_H
  const MAX_HITS = 8;
  const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'DST'];
  const STAGE = { tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun_am: 'Sunday morning', sun_check: 'Sunday', sun_late: 'Sunday' };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const num = (x) => (x == null || x === '' || Number.isNaN(+x) ? null : +x);
  const f1 = (x) => (num(x) == null ? '—' : (+x).toFixed(1));
  const pct = (x) => (num(x) == null ? '—' : (+x < 1 ? '<1%' : `${Math.round(+x)}%`));
  const money = (x) => (num(x) == null ? '—' : `$${(+x).toLocaleString('en-US')}`);
  const track = (ev, props) => { try { window.BBI.track && window.BBI.track(ev, props); } catch (e) { /* never break the page */ } };
  let uid = 0;
  const id = (p) => `${p}-${++uid}`;

  // ---------------------------------------------------------------- data
  let dataP = null;
  let D = null;
  let posMax = {};
  // the file is rebuilt with each slate update, so a played showdown can sit in it for a day: drop it here too
  const sdLive = (k) => { const t = Date.parse(k || ''); return Number.isNaN(t) || Date.now() < t + SD_STALE_MS; };
  function load() {
    if (dataP) return dataP;
    dataP = Promise.all([
      fetch(DATA_URL, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      // soft dependency: a 404 or bad JSON means no verdicts, and every card keeps its own take
      fetch(CHILL_URL, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([j, v]) => {
        const rows = (j.players || []).filter((r) => r && r.player && r.pos);
        // Chill counts only for the same season + week as players.json. r._chill: verdict object, false = Chill is
        // current but does not name him, null = no current Chill (the card says nothing about Chill)
        const ch = v && v.players && typeof v.players === 'object' && v.season === j.season && v.week === j.week ? v : null;
        const V = {};
        if (ch) Object.keys(ch.players).forEach((n) => { const x = ch.players[n]; if (x && VERDICT[x.verdict]) V[norm(n)] = x; });
        rows.forEach((r) => { r._n = norm(r.player); r._w = r._n.split(' '); r._chill = ch ? (V[r._n] || false) : null; });
        posMax = {};
        rows.forEach((r) => { posMax[r.pos] = Math.max(posMax[r.pos] || 0, num(r.p90) || 0); });
        // showdown rows: searchable + their own card variant; no Classic Chill verdict (that is the main slate's)
        const sd = (Array.isArray(j.showdown) ? j.showdown : []).filter((r) => r && r.player && r.pos && /^[a-z0-9_]+$/.test(r.slate_id || '') && sdLive(r.kickoff));
        sd.forEach((r) => { r._n = norm(r.player); r._w = r._n.split(' '); r._chill = null; r._sd = true; });
        const live = {}; sd.forEach((r) => { live[r.slate_id] = r.slate_tag || 'Showdown'; });
        // players = the main slate (browse grid, counts); all = what search + find look through, main slate first
        D = Object.assign({}, j, { players: rows, showdown: sd, all: rows.concat(sd), sdTags: Object.keys(live).map((k) => live[k]), chill: ch ? { stage: ch.stage, stamp: ch.stamp } : null });
        return D;
      })
      .catch((e) => { dataP = null; throw e; });
    return dataP;
  }

  function ensureCss() {
    if (document.querySelector('link[data-nfls-css]') || document.querySelector('link[href^="assets/css/nfl_search.css"]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = CSS_URL; l.dataset.nflsCss = '1';
    document.head.appendChild(l);
  }

  function search(q) {
    if (!D) return [];
    const n = norm(q);
    if (!n) return [];
    const T = String(q).trim().toUpperCase();   // any case: 'dal' = DAL
    const team = /^[A-Z]{2,3}$/.test(T) && D.all.some((r) => r.team === T) ? T : '';
    const hits = [];
    D.all.forEach((r) => {
      let s = 9;
      if (r._n.startsWith(n)) s = 0;
      else if (r._w.some((w) => w.startsWith(n))) s = 1;
      else if (n.length >= 3 && r._n.includes(n)) s = 2;
      if (team && r.team === team) s = -1;            // an exact team code (DAL, ne) lists that team first
      if (s < 9) hits.push([s, r]);
    });
    hits.sort((a, b) => a[0] - b[0] || (num(b[1].proj) || 0) - (num(a[1].proj) || 0));
    return hits.slice(0, team ? 12 : MAX_HITS).map((h) => h[1]);
  }

  function find(name) {
    if (!D) return null;
    const n = norm(name);
    return D.all.find((r) => r._n === n) || null;
  }

  // ---------------------------------------------------------------- text helpers
  function kickoff(k) {
    const m = /^(\d{1,2}):(\d{2})/.exec(k || '');
    if (!m) return '';
    let h = +m[1]; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    return `${h}:${m[2]} ${ap} ET`;
  }
  function asOf(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s || '');
    if (!m) return s || '';
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
    const wd = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    const mo = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
    let h = +m[4]; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    return `${wd} ${mo} ${+m[3]}, ${h}:${m[5]} ${ap} ET`;
  }
  const vs = (r) => `${esc(r.team)} ${r.matchup && r.matchup.home === false ? '@' : 'vs'} ${esc(r.opp)}`;
  function gameLine(r) {
    const m = r.matchup || {};
    const bits = [];
    const sp = num(m.spread);
    if (sp != null) bits.push(sp < 0 ? `${esc(r.team)} favored by ${Math.abs(sp).toFixed(1)}` : sp > 0 ? `${esc(r.team)} underdog by ${sp.toFixed(1)}` : 'A pick’em');
    if (num(m.team_total) != null) bits.push(`${esc(r.team)} expected to score ${(+m.team_total).toFixed(1)}`);
    if (num(m.game_total) != null) bits.push(`game total ${(+m.game_total).toFixed(1)}`);
    return bits.join(' · ');
  }

  // ---------------------------------------------------------------- Classic Chill verdict
  // Chill names him: its verdict + why replace the rank-based take. Chill is current but skips him: the neutral label, then
  // the take. No current Chill: the take only, as before.
  function verdictHtml(r) {
    const c = r._chill;
    if (!c || !VERDICT[c.verdict]) {
      const none = c === false ? `<p class="nfls-verdict-top nfls-verdict-none"><span class="nfls-pill">Not in this week’s Chill picks</span><a class="nfls-verdict-go" href="${CHILL_PAGE}" data-nfls-link="chill">See the picks →</a></p>` : '';
      return `${none}<p class="nfls-take">${esc(r.take)}</p>`;
    }
    const sec = /^[a-z]+$/.test(c.section || '') ? `#${c.section}` : '';
    return `
        <div class="nfls-verdict nfls-v-${c.verdict}">
          <p class="nfls-verdict-top"><span class="nfls-pill nfls-pill-${c.verdict}">Classic Chill: ${VERDICT[c.verdict]}</span><span class="nfls-verdict-l">${esc(c.label)}</span></p>
          <p class="nfls-take">${esc(c.why || r.take)}</p>
          <a class="nfls-verdict-go" href="${CHILL_PAGE}${sec}" data-nfls-link="chill">See it in Classic Chill →</a>
        </div>`;
  }
  const vtag = (r) => (r._chill && VTAG[r._chill.verdict] ? `<span class="nfls-vt nfls-vt-${r._chill.verdict}" title="Classic Chill: ${VERDICT[r._chill.verdict]}">${VTAG[r._chill.verdict]}</span>` : '');

  // ---------------------------------------------------------------- slate scope + badge
  // 'TNF' -> 'the TNF showdown'; 'TNF', 'SNF' -> 'the TNF and SNF showdowns'
  function sdScope() {
    const t = (D && D.sdTags) || [];
    if (!t.length) return '';
    return `the ${t.length > 1 ? `${t.slice(0, -1).map(esc).join(', ')} and ${esc(t[t.length - 1])} showdowns` : `${esc(t[0])} showdown`}`;
  }
  const scopeText = () => (sdScope() ? `this week’s DraftKings main slate and ${sdScope()}` : 'this week’s DraftKings main slate');
  // only needed once there is a second slate to tell apart
  const slateBadge = (r) => (r._sd ? `<span class="nfls-sl nfls-sl-sd">${esc(r.slate_tag || 'Showdown')} showdown</span>`
    : D && D.showdown && D.showdown.length ? '<span class="nfls-sl">Main slate</span>' : '');

  // ---------------------------------------------------------------- card
  function cardHtml(r) {
    if (r._sd) return sdCardHtml(r);
    const hid = id('nfls-h');
    const m = r.matchup || {};
    const ko = kickoff(m.kickoff);
    const max = posMax[r.pos] || num(r.p90) || 1;
    const p10 = Math.max(0, num(r.p10) || 0), pr = num(r.proj) || 0, p90 = num(r.p90) || 0;
    const L = (x) => Math.max(0, Math.min(100, (x / max) * 100)).toFixed(1);
    const st = r.status_note ? `<p class="nfls-status ${r.status ? 'is-q' : ''}"><span class="nfls-status-k">${r.status ? (r.status === 'D' ? 'Doubtful' : 'Injury tag') : 'News'}</span>${esc(r.status_note)}</p>` : '';
    const range = p90 > 0 ? `
      <div class="nfls-range" aria-label="Scoring range: bad day ${f1(p10)}, typical ${f1(pr)}, big day ${f1(p90)} DraftKings points">
        <div class="nfls-range-bar" aria-hidden="true"><span class="nfls-range-fill" style="left:${L(p10)}%;width:${(L(p90) - L(p10)).toFixed(1)}%"></span><span class="nfls-range-mid" style="left:${L(pr)}%"></span></div>
        <div class="nfls-range-lbl" aria-hidden="true"><span><b>${f1(p10)}</b> bad day</span><span><b>${f1(pr)}</b> typical</span><span><b>${f1(p90)}</b> big day</span></div>
      </div>` : '';
    const gl = gameLine(r);
    const rank = m.opp_rank_note ? `<p class="nfls-game-rank">${esc(m.opp_rank_note)}.</p>` : '';
    const q = encodeURIComponent(r.player);
    return `
      <article class="nfls-card" aria-labelledby="${hid}">
        <header class="nfls-card-head">
          <span class="nfls-pos nfls-pos-${esc(r.pos)}">${esc(r.pos)}</span>
          <div class="nfls-card-id">
            <h2 class="nfls-name" id="${hid}">${esc(r.player)}</h2>
            <p class="nfls-sub">${slateBadge(r)}${vs(r)}${ko ? ` · Sun ${esc(ko)}` : ''}</p>
          </div>
        </header>
        ${st}
        ${verdictHtml(r)}
        <dl class="nfls-stats">
          <div class="nfls-stat"><dt>Salary</dt><dd>${money(r.salary)}<small>of $50,000</small></dd></div>
          <div class="nfls-stat"><dt>Projection</dt><dd>${f1(r.proj)}<small>DK points</small></dd></div>
          <div class="nfls-stat"><dt>Value</dt><dd>${num(r.value) == null ? '—' : (+r.value).toFixed(2)}<small>points per $1K</small></dd></div>
          <div class="nfls-stat"><dt>Owned</dt><dd>${pct(r.own)}<small>in big contests</small><span class="nfls-stat-2">${pct(r.own_se)} in single entry</span></dd></div>
        </dl>
        ${range}
        ${gl || rank ? `<div class="nfls-game"><h3 class="nfls-k">The game</h3>${gl ? `<p>${gl}.</p>` : ''}${rank}</div>` : ''}
        <div class="nfls-links">
          <a class="btn btn-primary nfls-go" href="nfl/projections/?q=${q}" data-nfls-link="projections">Open in projections →</a>
          <a class="btn nfls-go" href="nfl/lab/" data-nfls-link="lab">Build a lineup in the Lab →</a>
        </div>
        <p class="nfls-foot">Our numbers${D && STAGE[D.stage] ? ` · ${esc(STAGE[D.stage])} update` : ''}${D && D.as_of ? `, ${esc(asOf(D.as_of))}` : ''}. DraftKings main slate.</p>
      </article>`;
  }

  // showdown card: one game, captain + 5 FLEX. FLEX salary, our showdown projection, FLEX + captain ownership; no range bar
  function sdCardHtml(r) {
    const hid = id('nfls-h');
    const m = r.matchup || {};
    const ko = kickoff(m.kickoff);
    const st = r.status_note ? `<p class="nfls-status ${r.status ? 'is-q' : ''}"><span class="nfls-status-k">${r.status ? (r.status === 'D' ? 'Doubtful' : 'Injury tag') : 'News'}</span>${esc(r.status_note)}</p>` : '';
    const gl = gameLine(r);
    const tag = esc(r.slate_tag || 'Showdown');
    return `
      <article class="nfls-card nfls-card-sd" aria-labelledby="${hid}">
        <header class="nfls-card-head">
          <span class="nfls-pos nfls-pos-${esc(r.pos)}">${esc(r.pos)}</span>
          <div class="nfls-card-id">
            <h2 class="nfls-name" id="${hid}">${esc(r.player)}</h2>
            <p class="nfls-sub">${slateBadge(r)}${vs(r)}${ko ? ` · ${esc(m.day || '')} ${esc(ko)}` : ''}</p>
          </div>
        </header>
        ${st}
        ${verdictHtml(r)}
        <dl class="nfls-stats">
          <div class="nfls-stat"><dt>Salary</dt><dd>${money(r.salary)}<small>FLEX · captain 1.5×</small></dd></div>
          <div class="nfls-stat"><dt>Projection</dt><dd>${f1(r.proj)}<small>DK points at FLEX</small></dd></div>
          <div class="nfls-stat"><dt>Owned</dt><dd>${pct(r.own)}<small>at FLEX</small></dd></div>
          <div class="nfls-stat"><dt>Captain</dt><dd>${pct(r.cpt_own)}<small>owned as captain</small></dd></div>
        </dl>
        ${gl ? `<div class="nfls-game"><h3 class="nfls-k">The game</h3><p>${gl}.</p></div>` : ''}
        <div class="nfls-links">
          <a class="btn btn-primary nfls-go" href="nfl/lab/?mode=showdown&amp;slate=${encodeURIComponent(r.slate_id)}" data-nfls-link="lab_showdown">Build a ${tag} lineup in the Lab →</a>
          <a class="btn nfls-go" href="nfl/showdown/chill/" data-nfls-link="showdown_chill">Showdown Chill picks →</a>
        </div>
        <p class="nfls-foot">Our numbers · DraftKings ${tag} showdown, ${esc(r.slate_label || '')}. Captain costs and scores 1.5×.</p>
      </article>`;
  }

  // ---------------------------------------------------------------- combobox (one per input)
  function optionHtml(r, i, lid) {
    return `<li role="option" id="${lid}-o${i}" class="nfls-opt" data-i="${i}" aria-selected="false">` +
      `<span class="nfls-pos nfls-pos-${esc(r.pos)}">${esc(r.pos)}</span>` +
      `<span class="nfls-opt-id"><span class="nfls-opt-name">${esc(r.player)}${r.status ? `<span class="nfls-q" title="${r.status === 'D' ? 'Doubtful' : 'Questionable'}">${esc(r.status)}</span>` : ''}${vtag(r)}</span><span class="nfls-opt-sub">${slateBadge(r)}${vs(r)} · ${money(r.salary)}</span></span>` +
      `<span class="nfls-opt-num"><b>${f1(r.proj)}</b><small>pts</small></span></li>`;
  }

  // input: <input>; list: <ul> mounted right after; onPick(row)
  function combobox(input, list, onPick) {
    const lid = list.id || (list.id = id('nfls-list'));
    let rows = [];
    let act = -1;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', lid);
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    list.setAttribute('role', 'listbox');
    list.classList.add('nfls-list');
    list.hidden = true;
    const status = document.createElement('div');
    status.className = 'nfls-sr'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    list.after(status);

    const setAct = (i) => {
      act = i;
      list.querySelectorAll('.nfls-opt').forEach((o, j) => o.setAttribute('aria-selected', String(j === i)));
      if (i >= 0) {
        input.setAttribute('aria-activedescendant', `${lid}-o${i}`);
        const o = list.querySelector(`#${lid}-o${i}`);
        if (o && o.scrollIntoView) o.scrollIntoView({ block: 'nearest' });
      } else input.removeAttribute('aria-activedescendant');
    };
    const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); setAct(-1); };
    const render = () => {
      const q = input.value;
      if (!q.trim()) { rows = []; list.innerHTML = ''; close(); status.textContent = ''; return; }
      if (!D) {
        list.innerHTML = '<li class="nfls-empty" role="presentation">Loading players…</li>';
        list.hidden = false; input.setAttribute('aria-expanded', 'true');
        load().then(render).catch(() => { list.innerHTML = '<li class="nfls-empty" role="presentation">Players did not load. Try again in a moment.</li>'; });
        return;
      }
      rows = search(q);
      list.innerHTML = rows.length ? rows.map((r, i) => optionHtml(r, i, lid)).join('')
        : `<li class="nfls-empty" role="presentation">No player matches “${esc(q.trim())}” on ${scopeText()}. Try a last name or a team like DAL.</li>`;
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
      setAct(rows.length ? 0 : -1);
      status.textContent = rows.length ? `${rows.length} player${rows.length > 1 ? 's' : ''} found. Use the arrow keys, Enter to open.` : 'No players found.';
    };
    const pick = (i) => { const r = rows[i]; if (!r) return; close(); onPick(r); };

    let t = null;
    input.addEventListener('focus', () => { ensureCss(); load().catch(() => {}); });
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(render, 60); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) render(); else if (rows.length) setAct((act + 1) % rows.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (rows.length) setAct(act <= 0 ? rows.length - 1 : act - 1); }
      else if (e.key === 'Enter') { if (!list.hidden && act >= 0) { e.preventDefault(); pick(act); } }
      else if (e.key === 'Escape') { if (!list.hidden && list.classList.contains('nfls-list-inline')) { e.preventDefault(); e.stopPropagation(); close(); } }
      else if (e.key === 'Home' && !list.hidden && rows.length && !input.value) { setAct(0); }
    });
    list.addEventListener('mousedown', (e) => e.preventDefault());   // keep focus in the input
    list.addEventListener('click', (e) => { const o = e.target.closest('.nfls-opt'); if (o) pick(+o.dataset.i); });
    input.addEventListener('blur', () => setTimeout(close, 120));
    return { render, close };
  }

  // ---------------------------------------------------------------- dialog (search view + card view)
  let dlg = null;
  let opener = null;
  let lastQuery = '';
  function dialog() {
    if (dlg) return dlg;
    ensureCss();
    // native <dialog> + showModal(): the top layer ignores transformed ancestors (body carries an animation transform,
    // which would trap a position:fixed overlay) and makes the page behind it inert
    const wrap = document.createElement('dialog');
    wrap.className = 'nfls-dialog';
    wrap.setAttribute('aria-label', 'Player search');
    const modal = typeof wrap.showModal === 'function';
    if (!modal) { wrap.classList.add('nfls-nomodal'); wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); }
    const sid = id('nfls-s');
    wrap.innerHTML = `
      <div class="nfls-inner">
        <div class="nfls-bar">
          <button type="button" class="nfls-back" hidden aria-label="Back to search">← Search</button>
          <label class="nfls-field" for="${sid}">
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M13 13l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            <span class="nfls-sr">Search players</span>
            <input type="search" id="${sid}" class="nfls-input" placeholder="Search a player or team" enterkeyhint="search" />
          </label>
          <button type="button" class="nfls-close" aria-label="Close">×</button>
        </div>
        <ul class="nfls-list nfls-list-dlg"></ul>
        <div class="nfls-hint">Type a name like <b>Allen</b> or a team like <b>DAL</b>. Our numbers for <span class="nfls-hint-scope">${scopeText()}</span>.</div>
        <div class="nfls-body" hidden></div>
      </div>`;
    (modal ? document.body : document.documentElement).appendChild(wrap);
    const box = wrap;
    const isOpen = () => (modal ? wrap.open : wrap.hasAttribute('open'));
    const input = wrap.querySelector('.nfls-input');
    const list = wrap.querySelector('.nfls-list');
    const body = wrap.querySelector('.nfls-body');
    const back = wrap.querySelector('.nfls-back');
    const hint = wrap.querySelector('.nfls-hint');
    const field = wrap.querySelector('.nfls-field');
    const cb = combobox(input, list, (r) => showCard(r, 'search'));
    // in the dialog the list stays open under the input (no blur close)
    input.addEventListener('input', () => { hint.hidden = !!input.value.trim(); });

    const showSearch = () => {
      body.hidden = true; body.innerHTML = ''; back.hidden = true; field.hidden = false; box.setAttribute('aria-label', 'Player search'); box.classList.remove('is-card');
      hint.hidden = !!input.value.trim();
      hint.querySelector('.nfls-hint-scope').innerHTML = scopeText();
      input.focus();
      if (input.value.trim()) cb.render();
    };
    const showCard = (r, via) => {
      lastQuery = input.value;
      body.innerHTML = cardHtml(r);
      body.hidden = false; list.hidden = true; hint.hidden = true; field.hidden = true; back.hidden = false; box.classList.add('is-card');
      box.setAttribute('aria-label', `${r.player} player card`);
      box.scrollTop = 0;
      back.focus({ preventScroll: true });
      track('nfl_player_card', { player: r.player, via, slate: r._sd ? r.slate_id : 'main' });
    };
    const focusables = () => Array.from(box.querySelectorAll('a[href], button:not([hidden]), input:not([hidden])')).filter((el) => !el.closest('[hidden]') && el.offsetParent !== null);
    const close = () => {
      if (!isOpen()) return;
      if (modal) wrap.close(); else wrap.removeAttribute('open');
      document.documentElement.classList.remove('nfls-lock');
      const o = opener; opener = null;
      if (o && o.focus && document.contains(o)) o.focus({ preventScroll: true });
    };
    wrap.addEventListener('cancel', (e) => { e.preventDefault(); close(); });   // native Esc -> our close (focus return)
    back.addEventListener('click', () => { input.value = lastQuery; showSearch(); });
    wrap.querySelector('.nfls-close').addEventListener('click', close);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });   // the backdrop (outside .nfls-inner)
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    });
    body.addEventListener('click', (e) => { const a = e.target.closest('[data-nfls-link]'); if (a) track('nfl_player_link', { to: a.dataset.nflsLink }); });
    const openWrap = (from) => {
      if (!isOpen()) {
        opener = from || document.activeElement;
        if (modal) wrap.showModal(); else wrap.setAttribute('open', '');
        document.documentElement.classList.add('nfls-lock');
      }
    };
    dlg = { wrap, input, isOpen, openWrap, showSearch, showCard, close };
    return dlg;
  }

  function openPalette(from) {
    const d = dialog();
    d.openWrap(from);
    d.showSearch();
    load().then(() => { const h = d.wrap.querySelector('.nfls-hint-scope'); if (h) h.innerHTML = scopeText(); }).catch(() => {});
    track('nfl_search_open', {});
  }

  function open(name, from) {
    const d = dialog();
    return load().then(() => {
      const r = typeof name === 'object' ? name : find(name);
      if (!r) { d.openWrap(from); d.input.value = typeof name === 'string' ? name : ''; d.showSearch(); return false; }
      d.openWrap(from);
      d.input.value = '';
      d.showCard(r, 'link');
      return true;
    });
  }

  // ---------------------------------------------------------------- inline typeahead + browse (nfl/players/)
  function mountInput(input) {
    if (input.dataset.nflsReady) return;
    input.dataset.nflsReady = '1';
    ensureCss();
    let list = input.parentElement.querySelector('.nfls-list');
    if (!list) { list = document.createElement('ul'); input.parentElement.appendChild(list); }
    list.classList.add('nfls-list-inline');
    combobox(input, list, (r) => { const d = dialog(); d.openWrap(input); d.showCard(r, 'inline'); });
  }

  function mountBrowse(el) {
    if (el.dataset.nflsReady) return;
    el.dataset.nflsReady = '1';
    ensureCss();
    const STEP = 24;
    const tabs = ['ALL'].concat(POS_ORDER);
    const st = { pos: 'ALL', n: STEP };
    el.innerHTML = `
      <div class="nfls-tabs" role="group" aria-label="Position">${tabs.map((p) => `<button type="button" class="nfls-tab" data-pos="${p}" aria-pressed="${p === 'ALL'}">${p === 'ALL' ? 'All' : p}</button>`).join('')}</div>
      <ul class="nfls-grid" aria-live="polite"><li class="nfls-empty">Loading players…</li></ul>
      <div class="nfls-more-wrap"><button type="button" class="btn nfls-more" hidden>Show more players</button></div>`;
    const grid = el.querySelector('.nfls-grid');
    const more = el.querySelector('.nfls-more');
    const draw = () => {
      if (!D) return;
      const all = D.players.filter((r) => st.pos === 'ALL' || r.pos === st.pos).sort((a, b) => (num(b.proj) || 0) - (num(a.proj) || 0));
      const L = all.slice(0, st.n);
      grid.innerHTML = L.map((r, i) => `<li><button type="button" class="nfls-tile" data-i="${i}">` +
        `<span class="nfls-pos nfls-pos-${esc(r.pos)}">${esc(r.pos)}</span>` +
        `<span class="nfls-opt-id"><span class="nfls-opt-name">${esc(r.player)}${r.status ? `<span class="nfls-q">${esc(r.status)}</span>` : ''}${vtag(r)}</span><span class="nfls-opt-sub">${vs(r)} · ${money(r.salary)} · ${pct(r.own)} owned</span></span>` +
        `<span class="nfls-opt-num"><b>${f1(r.proj)}</b><small>pts</small></span></button></li>`).join('');
      grid._rows = L;
      more.hidden = all.length <= st.n;
      more.textContent = `Show more players (${all.length - L.length} left)`;
    };
    el.querySelectorAll('.nfls-tab').forEach((b) => b.addEventListener('click', () => {
      st.pos = b.dataset.pos; st.n = STEP;
      el.querySelectorAll('.nfls-tab').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      draw();
      track('nfl_players_tab', { pos: st.pos });
    }));
    more.addEventListener('click', () => { st.n += STEP * 2; draw(); });
    grid.addEventListener('click', (e) => {
      const b = e.target.closest('.nfls-tile');
      if (!b || !grid._rows) return;
      const r = grid._rows[+b.dataset.i];
      const d = dialog(); d.openWrap(b); d.showCard(r, 'browse');
    });
    load().then((d) => {
      draw();
      const c = {}; d.players.forEach((r) => { c[r.pos] = (c[r.pos] || 0) + 1; });
      el.querySelectorAll('.nfls-tab').forEach((b) => { const n = b.dataset.pos === 'ALL' ? d.players.length : c[b.dataset.pos] || 0; b.insertAdjacentHTML('beforeend', `<span class="nfls-n">${n}</span>`); });
      el.dispatchEvent(new CustomEvent('nfls:ready', { bubbles: true, detail: { n: d.players.length, stage: d.stage, week: d.week, as_of: d.as_of } }));
    }).catch(() => { grid.innerHTML = '<li class="nfls-empty">Players did not load. Refresh the page to try again.</li>'; });
  }

  // ---------------------------------------------------------------- wiring
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-nfl-search-open]');
    if (b) { e.preventDefault(); openPalette(b); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (dlg && dlg.isOpen()) return;
    e.preventDefault();
    openPalette(document.activeElement);
  });
  const boot = () => {
    document.querySelectorAll('input[data-nfl-search]').forEach(mountInput);
    document.querySelectorAll('[data-nfl-browse]').forEach(mountBrowse);
    let p = null;
    try { p = new URLSearchParams(location.search).get('p'); } catch (e) { /* old browsers */ }
    if (p && document.querySelector('[data-nfl-browse]')) open(p).catch(() => {});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.BBI.nflSearch = { load, search, open, openPalette, mountInput, mountBrowse, cardHtml, close: () => dlg && dlg.close() };
})();
