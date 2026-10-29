/* =====================================================================
   BIRDIEBUDDY — NFL PROJECTIONS (/nfl/projections/)
   Reads nfl/projections/projections.json (written by the slate page
   step, codex/dashboard/slate_page.py) and renders one sortable table:
   position tabs (All, QB, RB, WR, TE, FLEX, DST), player/team search,
   big-GPP vs single-entry ownership, header tooltips. No libraries.
   ===================================================================== */
(() => {
  'use strict';

  const DATA_URL = 'nfl/projections/projections.json';
  const POS_TABS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'DST'];
  const FLEX = new Set(['RB', 'WR', 'TE']);
  const STAGE = { tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun_am: 'Sunday morning', sun_check: 'Sunday', sun_late: 'Sunday' };
  const LEV_HI = 2;          // leverage of +2 or better gets the gold pill
  const LEV_LO = -5;         // -5 or worse is shown in muted red
  const VALUE_TOP = 0.15;    // top 15% value at the position is gold

  const OWN_TIP = {
    gpp: 'The share of lineups we expect to play him in big tournaments (large-field GPPs). Our own ownership model.',
    se: 'The share of lineups we expect to play him in single-entry contests. Those fields play the popular players more.'
  };
  const COLS = [
    { k: 'player', l: 'Player', t: 1, c1: 1, tip: 'Q next to a name = questionable. His projection already includes the chance he sits.' },
    { k: 'pos', l: 'Pos', t: 1, cx: 1, tip: 'Position on DraftKings. FLEX can be any RB, WR or TE.' },
    { k: 'team', l: 'Team', t: 1, cx: 1, tip: 'His team.' },
    { k: 'opp', l: 'Opp', t: 1, cx: 1, tip: 'The team he plays this week.' },
    { k: 'salary', l: 'Salary', s: 'Salary', tip: 'His DraftKings salary. You get $50,000 for nine players.' },
    { k: 'proj', l: 'Projection', s: 'Proj', tip: 'Our average DraftKings points for him across 10,000 simulated games.' },
    { k: 'p90', l: 'Ceiling', s: 'Ceiling', tip: 'His big-game score: he beats this in only 1 of every 10 simulated games. Tournaments are won by ceilings.' },
    { k: 'own', l: 'Ownership %', s: 'Own %', tip: OWN_TIP.gpp },
    { k: 'opt', l: 'Optimal %', s: 'Opt %', tip: 'How often he is in the best possible lineup across our simulated slates.' },
    { k: 'lev', l: 'Leverage', s: 'Lev', tip: 'Optimal % minus Ownership %. Positive means he lands in winning lineups more often than the field plays him.' },
    { k: 'value', l: 'Value', s: 'Value', tip: 'Projected points per $1,000 of salary. Higher means more points for the money.' }
  ];

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (x) => (x == null || x === '' || Number.isNaN(+x) ? null : +x);
  const fx = (x, d) => (num(x) == null ? '—' : (+x).toFixed(d));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const track = (ev, props) => { try { window.BBI && BBI.track && BBI.track(ev, props); } catch (e) { /* never break the page */ } };

  const state = { rows: [], pos: 'ALL', q: '', own: 'gpp', key: 'proj', dir: -1 };
  let valueCut = {};
  let teams = new Set();

  // ---------------------------------------------------------------- header + tooltips
  function buildHead() {
    const tr = $('#pj-head-row');
    tr.innerHTML = COLS.map((c) => {
      const cls = [c.t ? 't' : '', c.c1 ? 'c1' : '', c.cx ? 'cx' : ''].filter(Boolean).join(' ');
      const label = c.s ? `<span class="l">${c.l}</span><span class="s">${c.s}</span>` : c.l;
      return `<th scope="col" class="${cls}" data-k="${c.k}"><button type="button" aria-label="${esc(c.l)}: sort">${label}<span class="pj-arrow" aria-hidden="true"></span></button></th>`;
    }).join('');
    tr.querySelectorAll('th').forEach((th) => {
      const btn = th.querySelector('button');
      const k = th.dataset.k;
      btn.addEventListener('click', () => sortBy(k));
      btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showTip(th); });
      btn.addEventListener('pointerleave', hideTip);
      btn.addEventListener('focus', () => { try { if (btn.matches(':focus-visible')) showTip(th); } catch (e) { /* old browsers */ } });
      btn.addEventListener('blur', hideTip);
    });
  }

  let tipEl = null;
  function showTip(th) {
    const c = COLS.find((x) => x.k === th.dataset.k);
    if (!c) return;
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'pj-tip'; tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(tipEl); }
    tipEl.innerHTML = `<b>${esc(c.l)}</b>${esc(c.tip)}`;
    const r = th.getBoundingClientRect();
    tipEl.style.left = '0px'; tipEl.style.top = '0px';
    tipEl.classList.add('on');
    const w = tipEl.offsetWidth;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${r.bottom + 8}px`;
  }
  function hideTip() { if (tipEl) tipEl.classList.remove('on'); }

  function buildDefs() {
    const dl = $('#pj-defs');
    if (!dl) return;
    dl.innerHTML = COLS.filter((c) => !['pos', 'team', 'opp'].includes(c.k)).map((c) => {
      const tip = c.k === 'own' ? `${OWN_TIP.gpp} Switch to "Single entry" for single-entry contests.` : c.tip;
      return `<div><dt>${esc(c.l)}</dt><dd>${esc(tip)}</dd></div>`;
    }).join('');
  }

  // ---------------------------------------------------------------- data shaping
  function ownOf(r) { return state.own === 'se' ? num(r.own_se) : num(r.own); }
  function levOf(r) {
    if (state.own !== 'se') return num(r.lev);
    const o = num(r.opt), s = num(r.own_se);
    return o == null || s == null ? null : Math.round((o - s) * 10) / 10;
  }
  function val(r, k) {
    if (k === 'own') return ownOf(r);
    if (k === 'lev') return levOf(r);
    return r[k];
  }
  function computeValueCuts(rows) {
    const by = {};
    rows.forEach((r) => { if (num(r.value) != null) (by[r.pos] = by[r.pos] || []).push(+r.value); });
    valueCut = {};
    Object.keys(by).forEach((p) => {
      const v = by[p].sort((a, b) => b - a);
      valueCut[p] = v[Math.max(0, Math.ceil(v.length * VALUE_TOP) - 1)];
    });
  }

  function visible() {
    const q = norm(state.q).trim();
    const Q = q.toUpperCase();
    return state.rows.filter((r) => {
      if (state.pos === 'FLEX' ? !FLEX.has(r.pos) : state.pos !== 'ALL' && r.pos !== state.pos) return false;
      if (!q) return true;
      if (teams.has(Q)) return r.team === Q;          // an exact team code ("dal") = that team's players
      return norm(r.player).includes(q) || (Q.length >= 2 && Q.length <= 3 && r.team.startsWith(Q));
    });
  }

  function sorted(L) {
    const k = state.key, d = state.dir;
    const text = COLS.find((c) => c.k === k)?.t;
    return L.slice().sort((a, b) => {
      let x = val(a, k), y = val(b, k);
      if (text) { x = norm(x); y = norm(y); } else { x = num(x); y = num(y); }
      if (x == null && y == null) return (b.proj - a.proj) || a.player.localeCompare(b.player);
      if (x == null) return 1;            // blanks always last
      if (y == null) return -1;
      if (x < y) return -d;
      if (x > y) return d;
      return (b.proj - a.proj) || a.player.localeCompare(b.player);
    });
  }

  // ---------------------------------------------------------------- render
  function cell(r, c) {
    const cls = [c.t ? 't' : '', c.c1 ? 'c1' : '', c.cx ? 'cx' : ''].filter(Boolean);
    let h;
    switch (c.k) {
      case 'player': {
        const q = r.status ? `<span class="pj-q" title="${r.status === 'D' ? 'Doubtful' : 'Questionable'}">${esc(r.status)}</span>` : '';
        h = `<span class="pj-name">${esc(r.player)}${q}</span><span class="pj-sub">${esc(r.pos)} · ${esc(r.team)} v ${esc(r.opp)}</span>`;
        break;
      }
      case 'pos': h = `<span class="pj-pos">${esc(r.pos)}</span>`; break;
      case 'team': h = `<span class="pj-team">${esc(r.team)}</span>`; break;
      case 'opp': h = `<span class="pj-opp">${esc(r.opp)}</span>`; break;
      case 'salary': h = num(r.salary) == null ? '—' : `$${(+r.salary).toLocaleString('en-US')}`; break;
      case 'proj': h = `<span class="pj-proj">${fx(r.proj, 1)}</span>`; break;
      case 'p90': h = fx(r.p90, 1); break;
      case 'own': { const o = ownOf(r); h = o == null ? '<span class="pj-dim">—</span>' : `${o.toFixed(1)}%`; break; }
      case 'opt': { const o = num(r.opt); h = o == null ? '<span class="pj-dim">—</span>' : `${o.toFixed(1)}%`; break; }
      case 'lev': {
        const v = levOf(r);
        if (v == null) h = '<span class="pj-dim">—</span>';
        else if (v >= LEV_HI) h = `<span class="pj-lev-pos">+${v.toFixed(1)}</span>`;
        else if (v <= LEV_LO) h = `<span class="pj-lev-neg">${v.toFixed(1).replace('-', '−')}</span>`;
        else h = v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1).replace('-', '−');
        break;
      }
      case 'value': {
        const v = num(r.value);
        h = v == null ? '—' : (valueCut[r.pos] != null && v >= valueCut[r.pos] ? `<span class="pj-val-hi">${v.toFixed(2)}</span>` : v.toFixed(2));
        break;
      }
      default: h = esc(r[c.k]);
    }
    return `<td${cls.length ? ` class="${cls.join(' ')}"` : ''}>${h}</td>`;
  }

  function render() {
    const L = sorted(visible());
    const body = $('#pj-body');
    if (!L.length) {
      const what = state.q ? `No ${state.pos === 'ALL' ? '' : state.pos + ' '}players match “${esc(state.q)}”.` : 'No players at this position yet.';
      body.innerHTML = `<tr><td class="pj-empty" colspan="${COLS.length}">${what}</td></tr>`;
    } else {
      body.innerHTML = L.map((r) => `<tr>${COLS.map((c) => cell(r, c)).join('')}</tr>`).join('');
    }
    document.querySelectorAll('#pj-head-row th').forEach((th) => {
      const on = th.dataset.k === state.key;
      if (on) th.setAttribute('aria-sort', state.dir > 0 ? 'ascending' : 'descending'); else th.removeAttribute('aria-sort');
      th.querySelector('.pj-arrow').textContent = on ? (state.dir > 0 ? '▲' : '▼') : '▼';
    });
    const total = state.rows.length;
    $('#pj-count').textContent = L.length === total ? `${total} players` : `Showing ${L.length} of ${total} players`;
  }

  function sortBy(k) {
    const text = COLS.find((c) => c.k === k)?.t;
    if (state.key === k) state.dir = -state.dir;
    else { state.key = k; state.dir = text ? 1 : -1; }
    hideTip();
    render();
    track('proj_sort', { key: k, dir: state.dir > 0 ? 'asc' : 'desc' });
  }

  function setPos(p, push) {
    if (!POS_TABS.includes(p)) p = 'ALL';
    state.pos = p;
    document.querySelectorAll('.pj-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.pos === p)));
    render();
    if (push) {
      // <base href="/"> would resolve a bare '#qb' against the site root: keep the page path explicit
      try { history.replaceState(null, '', location.pathname + (p === 'ALL' ? '' : `#${p.toLowerCase()}`)); } catch (e) { /* file:// */ }
      track('proj_tab', { pos: p });
    }
  }

  function setOwn(mode) {
    state.own = mode === 'se' ? 'se' : 'gpp';
    document.querySelectorAll('.pj-seg-b').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.own === state.own)));
    COLS.find((c) => c.k === 'own').tip = OWN_TIP[state.own];
    render();
    track('proj_own', { mode: state.own });
  }

  // ---------------------------------------------------------------- header text
  function asOfText(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s || '');
    if (!m) return s || '';
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
    const wd = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    const mo = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
    let h = +m[4]; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    return `${wd} ${mo} ${+m[3]}, ${h}:${m[5]} ${ap} ET`;
  }

  function fillHead(D) {
    if (D.week) {
      $('#pj-title').textContent = `Week ${D.week} projections`;
      $('#pj-eyebrow').textContent = `${D.season || ''} · Week ${D.week} · DraftKings main slate`;
    }
    const stage = STAGE[D.stage] ? `${STAGE[D.stage]} numbers` : 'Our numbers';
    $('#pj-asof').innerHTML = `<span><strong>${esc(stage)}</strong>, as of ${esc(asOfText(D.as_of))}. New numbers Wednesday and Friday evening, plus a Sunday morning update.</span>`;
  }

  function fillCounts() {
    const n = { ALL: state.rows.length, FLEX: 0 };
    state.rows.forEach((r) => { n[r.pos] = (n[r.pos] || 0) + 1; if (FLEX.has(r.pos)) n.FLEX += 1; });
    document.querySelectorAll('.pj-tab').forEach((b) => { b.querySelector('.pj-n').textContent = n[b.dataset.pos] || ''; });
  }

  // ---------------------------------------------------------------- boot
  function wire() {
    document.querySelectorAll('.pj-tab').forEach((b) => b.addEventListener('click', () => setPos(b.dataset.pos, true)));
    $('#pj-tabs').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = POS_TABS.indexOf(state.pos) + (e.key === 'ArrowRight' ? 1 : -1);
      const p = POS_TABS[(i + POS_TABS.length) % POS_TABS.length];
      setPos(p, true);
      document.querySelector(`.pj-tab[data-pos="${p}"]`).focus();
    });
    document.querySelectorAll('.pj-seg-b').forEach((b) => b.addEventListener('click', () => setOwn(b.dataset.own)));
    const q = $('#pj-q');
    let t = null;
    q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.q = q.value; render(); }, 80); });
    const sc = $('#pj-scroll');
    sc.addEventListener('scroll', () => {
      sc.classList.toggle('is-scrolled', sc.scrollLeft > 2);
      if (sc.scrollLeft > 40) { const h = $('#pj-swipe'); if (h) h.classList.add('gone'); }   // they found it: drop the hint
      hideTip();
    }, { passive: true });
    window.addEventListener('scroll', hideTip, { passive: true });
    window.addEventListener('hashchange', () => setPos((location.hash || '').slice(1).toUpperCase() || 'ALL', false));
  }

  async function boot() {
    buildHead();
    buildDefs();
    wire();
    try {
      const res = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const D = await res.json();
      state.rows = (D.players || []).filter((r) => r && r.player && r.pos);
      computeValueCuts(state.rows);
      teams = new Set(state.rows.map((r) => r.team));
      fillHead(D);
      fillCounts();
      setPos((location.hash || '').slice(1).toUpperCase() || 'ALL', false);
    } catch (e) {
      $('#pj-asof').textContent = 'Our numbers could not load right now.';
      $('#pj-body').innerHTML = `<tr><td class="pj-empty" colspan="${COLS.length}">The projections did not load. Refresh the page to try again.</td></tr>`;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
