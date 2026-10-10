/* =====================================================================
   BIRDIEBUDDY — CLASSIC PLAYBOOK · THIS WEEK'S BOOK (Step 0)
   Renders our published main-slate lineups from nfl/classic/books/index.json
   → the latest <season>-w<N>-main.json (built by codex/classic/classic_site_book.py).
   Public-data rule: ownership appears as a tier only (no third-party numbers);
   sim figures are BirdieBuddy's own (copula sim + calibrated field model).
   ===================================================================== */
window.BBI = window.BBI || {};

(() => {
  'use strict';
  const DIR = 'nfl/classic/books/';
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $id = id => document.getElementById(id);
  const track = (e, p) => { try { if (window.BBI.track) window.BBI.track(e, p); } catch {} };
  const money = n => '$' + Number(n).toLocaleString('en-US');
  const OWN = { chalk: ['Chalk', 'own-chalk'], popular: ['Popular', 'own-pop'], mid: ['Mid', 'own-mid'], low: ['Low', 'own-low'] };
  const ROLE = { 'QB': 'role-qb', 'Stack': 'role-stack', 'Bring-back': 'role-bb', '2nd game': 'role-2nd', 'One-off': 'role-one', 'DST': 'role-dst' };
  const lastName = n => { const p = String(n).split(' '); return p.length > 1 && /^(Jr\.|Sr\.|II|III|IV)$/.test(p[p.length - 1]) ? p[p.length - 2] : p[p.length - 1]; };

  // A bar against the field's 1% baseline: the track spans 0–4%, the tick marks the field average.
  const rateBar = (v, base, max, label, sub) => `
    <div class="bk-rate">
      <div class="bk-rate-top"><span>${esc(label)}</span><b class="${v >= base * 2 ? 'gold' : ''}">${v.toFixed(v < 5 ? 2 : 1)}%</b></div>
      <div class="bk-bar"><i style="width:${Math.min(100, v / max * 100).toFixed(1)}%"></i><s style="left:${(base / max * 100).toFixed(1)}%" title="field average ${base}%"></s></div>
      <div class="bk-rate-sub">${sub}</div>
    </div>`;

  const card = (L, open) => {
    const s = L.shape, x = L.sim;
    const chips = [
      `<span class="bk-chip on">${esc(s.stack)} · ${esc(s.stack_players.map(lastName).join(' + '))}</span>`,
      s.bring_back.length ? `<span class="bk-chip on">Bring-back · ${esc(s.bring_back.map(b => lastName(b.replace(/ \(.*/, '')) + ' ' + b.replace(/.*\(/, '(')).join(', '))}</span>` : '',
      s.second_game.length ? `<span class="bk-chip">2nd game · ${esc(s.second_game.join(', '))}</span>` : '',
      `<span class="bk-chip">${s.games} games</span>`,
      `<span class="bk-chip">${s.chalk} chalk · ${s.low} low-owned</span>`,
      `<span class="bk-chip">${s.watch_game_players} from ARI–DET</span>`
    ].join('');
    const rows = L.players.map(p => `
      <div class="bk-p">
        <span class="bk-slot">${esc(p.slot)}</span>
        <span class="bk-name">${esc(p.name)}${p.status ? ` <em class="bk-q" title="Questionable">Q</em>` : ''}</span>
        <span class="bk-team">${esc(p.team)} <small>v ${esc(p.opp)}</small></span>
        <span class="bk-role ${ROLE[p.role] || ''}">${esc(p.role)}</span>
        <span class="bk-own ${OWN[p.own][1]}">${OWN[p.own][0]}</span>
        <span class="bk-sal">${money(p.salary)}</span>
      </div>`).join('');
    const swaps = (L.swaps || []).map(w => `<li><b>${esc(w.out)}</b> questionable → if out, swap in <b>${esc(w.swap_in)}</b></li>`).join('');
    const names = L.players.map(p => p.name).join(', ');
    return `
    <details class="bk-card card" ${open ? 'open' : ''} data-rank="${L.rank}">
      <summary class="bk-sum">
        <span class="bk-rank">${L.rank}</span>
        <span class="bk-head">
          <span class="bk-title">${esc(L.title)}</span>
          <span class="bk-meta">${esc(L.qb)} · ${esc(s.qb_game)} · ${esc(L.tier)} · ${money(L.salary)}</span>
        </span>
        <span class="bk-top1" title="Top-1% rate in our sim (field average 1%)"><b>${x.top1.toFixed(2)}%</b><small>top-1%</small></span>
        <span class="sd-fold-arrow">›</span>
      </summary>
      <div class="bk-body">
        <div class="bk-chips">${chips}</div>
        <div class="bk-grid">
          <div class="bk-players" role="table" aria-label="Lineup">${rows}</div>
          <div class="bk-side">
            ${rateBar(x.top1, 1, 4, 'Top 1%', `${(x.top1 / 1).toFixed(1)}× the field average (1%)`)}
            ${rateBar(x.top01, 0.1, 0.5, 'Top 0.1%', `${(x.top01 / 0.1).toFixed(1)}× the field average (0.1%)`)}
            ${rateBar(x.top5, 5, 15, 'Top 5%', 'the cash-ish line in satellites')}
            <div class="bk-dupe">Est. duplicates in a 160k field: <b>${esc(x.dupes)}</b></div>
          </div>
        </div>
        <p class="bk-story">${esc(L.story)}</p>
        ${swaps ? `<ul class="bk-swaps">${swaps}</ul>` : ''}
        <div class="bk-acts"><button type="button" class="btn btn-sm" data-copy="${esc(names)}">Copy lineup</button><span class="sd-caption">Book #${L.book_no} in our 24-lineup set</span></div>
      </div>
    </details>`;
  };

  const render = b => {
    const n = b.note || {}, set = b.set;
    const maxS = Math.max(...set.scenarios.map(s => s.p_top1), 1);
    const expo = Object.entries(set.watch_exposure);
    const games = [...b.games].sort((a, c) => (c.total || 0) - (a.total || 0));
    $id('clBook').innerHTML = `
      <div class="card sd-panel card-premium bk-intro">
        <h3 class="bk-headline">${esc(n.headline)}</h3>
        <p class="sd-lede">${esc(n.lede)}</p>
        <div class="bk-kpis">
          <div class="bk-kpi"><b>${set.n}</b><span>lineups</span></div>
          <div class="bk-kpi"><b class="gold">${set.p_top1}%</b><span>chance ≥1 finishes top 1%</span></div>
          <div class="bk-kpi"><b>${set.p_top01}%</b><span>chance ≥1 finishes top 0.1%</span></div>
          <div class="bk-kpi"><b>${set.p_top5}%</b><span>chance ≥1 finishes top 5%</span></div>
        </div>
        <div class="bk-scen">
          <div class="bk-scen-h">If ${esc(set.watch_game)} … <small>chance at least one of the ten finishes top 1%</small></div>
          ${set.scenarios.map(s => `<div class="bk-scen-row"><span>${esc(s.name)}</span><div class="bk-bar"><i style="width:${(s.p_top1 / maxS * 100).toFixed(1)}%"></i></div><b>${s.p_top1}%</b></div>`).join('')}
          <div class="sd-caption">Busts / booms = the bottom / top 20% of simulated ${esc(set.watch_game)} output. ${expo.map(([k, v]) => `${v} lineup${v === 1 ? '' : 's'} with ${k}`).join(' · ')} from the game.</div>
        </div>
        <div class="bk-lines">${games.map(g => `<span class="cl-chip"><b>${esc(g.away)} @ ${esc(g.home)}</b> ${g.total != null ? `${esc(g.fav)} −${g.spread} · ${g.total}` : ''}</span>`).join('')}</div>
      </div>
      <div class="bk-concepts">
        ${(n.concepts || []).map(c => `
          <div class="card bk-concept">
            <div class="bk-concept-k">${esc(c.k)}</div>
            <div class="bk-concept-stat">${esc(c.stat)}</div>
            <p>${esc(c.body)}</p>
          </div>`).join('')}
      </div>
      <div class="bk-legend">
        <span>Roles:</span>${Object.entries(ROLE).map(([k, c]) => `<span class="bk-role ${c}">${esc(k)}</span>`).join('')}
        <span class="bk-legend-gap">Ownership:</span>${Object.values(OWN).map(([l, c]) => `<span class="bk-own ${c}">${l}</span>`).join('')}
      </div>
      <div class="bk-cards">${b.lineups.map((L, i) => card(L, i < 3)).join('')}</div>
      <p class="sd-caption bk-method">${esc(n.method)} Field model: top-1% line ≈ ${b.method.top1_line} DK pts, top-0.1% ≈ ${b.method.top01_line}. Updated ${esc(new Date(b.updated).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}.</p>`;
    const h = $id('clBookTitle'); if (h) h.textContent = `This week's book · Week ${b.week} main slate`;
    $id('clBook').addEventListener('click', e => {
      const btn = e.target.closest('[data-copy]'); if (!btn) return;
      const txt = btn.getAttribute('data-copy');
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => { btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = 'Copy lineup'), 1400); }).catch(() => {});
      track('classic_book_copy', { rank: btn.closest('[data-rank]')?.dataset.rank });
    });
  };

  const init = async () => {
    const host = $id('clBook'); if (!host) return;
    try {
      const idx = await (await fetch(DIR + 'index.json', { cache: 'no-cache' })).json();
      const b = await (await fetch(DIR + idx.latest, { cache: 'no-cache' })).json();
      render(b);
    } catch (err) {
      host.innerHTML = `<div class="card sd-error"><p class="sd-lede">This week's lineups didn't load (${esc(err.message)}). Refresh to try again.</p></div>`;
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
