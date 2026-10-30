/* =====================================================================
   BIRDIEBUDDY NFL HOMEPAGE (nfl/)
   Motion comes from the shared include assets/js/home_fx.js (load it
   first). This file fills this week's numbers, read client-side from
   nfl/home.json, the small public teaser (week, stage, slate counts,
   latest article, newest graded week) that codex/site/home_teaser.py
   writes with every slate / article / results push. The two preview cards
   (top stacks, top projections) still read nfl/slate/slate.json, which goes
   members-only with the server gate (see SLATE_PUBLIC). No nfl/home.json →
   the old reads: nfl/slate/slate.json, nfl/articles/articles.json and the
   results weeks that exist (same fetch pattern + Eastern-time lock math as
   assets/js/nfl_week.js). If a file is missing, the static copy in the
   page stays as it is. No external scripts.
   ===================================================================== */
(() => {
  'use strict';

  // count-up from home_fx.js; plain number if the include is missing
  function setCount(id, n) {
    const fx = window.BBI && window.BBI.homeFx;
    if (fx) return fx.setCount(id, n);
    const el = document.getElementById(id);
    if (el && n >= 0) el.textContent = String(n);
  }

  /* =================== THIS WEEK'S NUMBERS =================== */
  if (!window.fetch) return;
  // slate.json is public today. Set false in the deploy that turns the server gate on (auth.js GATE_MODE 'server'):
  // then only signed-in visitors (the bb-access cookie) fetch it, and everyone else keeps the cards' static copy.
  const SLATE_PUBLIC = true;
  const canReadSlate = () => SLATE_PUBLIC || /(?:^|;\s*)bb-access=/.test(document.cookie || '');
  // clean article URL (Cloudflare 308s /x.html -> /x): the path of articles.json 'url', else nfl/articles/<href>
  const artLink = a => {
    if (a && a.url) { try { const p = new URL(a.url, document.baseURI).pathname.replace(/^\/+/, ''); if (p) return p; } catch (e) {} }
    return 'nfl/articles/' + String((a && a.href) || '');
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const getJSON = url => fetch(url, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const STAGE = {
    tue: 'Early numbers', wed: 'Wednesday numbers', thu: 'Thursday numbers', fri: 'Friday final numbers',
    sat: 'Saturday numbers', sun_am: 'Sunday AM update', sun_check: 'Inactives update', sun_late: 'Sunday late update'
  };
  const ART_NAME = { wed: 'First look', thu: 'Thursday update', fri: 'Final call', sat: 'Final read', sun: 'Sunday update', sun_am: 'Sunday update' };
  const H = 3600e3;
  // Eastern wall-clock time held in a Date's UTC fields (as in nfl_week.js)
  const parseET = s => {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ''));
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : null;
  };
  const etNow = () => {
    if (!window.Intl) return null;
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
    return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute));
  };
  // Sunday 1 PM ET lock of the slate's week (the as-of day itself when it is a Sunday)
  const lockOf = asof => new Date(Date.UTC(asof.getUTCFullYear(), asof.getUTCMonth(), asof.getUTCDate() + (7 - asof.getUTCDay()) % 7, 13, 0));
  const shortDate = t => `${DAY[t.getUTCDay()]} ${MON[t.getUTCMonth()]} ${t.getUTCDate()}`;
  const last = name => {
    const parts = String(name || '').replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i, '').trim().split(/\s+/);
    return parts[parts.length - 1] || String(name || '');
  };
  const row = (a, b, cls) => `<div class="data-row${cls ? ' ' + cls : ''}"><span>${a}</span><span>${b}</span></div>`;

  // hero badge + closing countdown. t = home.json or slate.json (season, week, as_of, stage[, stage_label])
  function renderWeek(t) {
    const S = +t.season, W = +t.week;
    if (!S || !W) return;
    const asof = parseET(t.as_of), now = etNow();
    const lock = asof ? lockOf(asof) : null;
    const phase = !lock || !now ? 'live' : now < lock ? 'live' : now < new Date(lock.getTime() + 12 * H) ? 'in_play' : 'final';

    // hero badge
    const badge = document.getElementById('weekBadgeText');
    if (badge) {
      badge.textContent = phase === 'live'
        ? `Live · Week ${W} · ${t.stage_label || STAGE[t.stage] || 'New numbers'}`
        : phase === 'in_play' ? `Week ${W} · Locked · Results Monday`
        : `Week ${W} final · Week ${W + 1} on Wednesday`;
    }

    // final block line
    const cd = document.getElementById('countdown');
    if (cd && lock) {
      cd.textContent = phase === 'live' ? `Week ${W} locks ${shortDate(lock)} · 1 PM ET`
        : phase === 'in_play' ? `Week ${W} is underway · We grade it Monday`
        : `Week ${W + 1} numbers land Wednesday evening`;
    }
    return { S, W };
  }

  // the two preview cards (members' numbers: top stacks, top projections)
  function renderPreviews(slate) {
    const W = +slate.week;
    if (!W) return;

    // This week card: best stack per QB, by how often it clears the stack line
    const line = +slate.stack_line || 0;
    const seen = new Set();
    const stacks = (slate.stacks || []).filter(s => s && s.qb && s.p_line != null)
      .sort((a, b) => b.p_line - a.p_line)
      .filter(s => (seen.has(s.qb) ? false : (seen.add(s.qb), true)))
      .slice(0, 3);
    const sp = document.getElementById('stackPreview');
    if (sp && stacks.length && line) {
      sp.innerHTML = row(`Week ${W} top stacks`, `Sims ${line}+ pts`, 'data-head')
        + stacks.map((s, i) => row(`${i + 1}. ${esc([s.qb].concat(s.catchers || []).map(last).join(' + '))}`, `${Math.round(s.p_line)}%`)).join('');
    }

    // Projections card: top projection at QB / RB / WR
    const players = slate.players || {};
    const pp = document.getElementById('projPreview');
    const tops = ['QB', 'RB', 'WR'].map(pos => {
      const list = (players[pos] || []).filter(p => p && p.player && p.proj != null);
      return list.length ? { pos, p: list.reduce((a, b) => (b.proj > a.proj ? b : a)) } : null;
    }).filter(Boolean);
    if (pp && tops.length) {
      pp.innerHTML = row(`Week ${W} top projections`, 'DK pts', 'data-head')
        + tops.map(x => row(`${x.pos} · ${esc(x.p.player)}`, (+x.p.proj).toFixed(1))).join('');
    }

  }

  // proof strip (counts only)
  function renderCounts(c) {
    if (!c) return;
    setCount('numGames', +c.games);
    setCount('numPlayers', +c.players);
    setCount('numStacks', +c.stacks);
    setCount('numChalk', +c.chalk);
  }
  const slateCounts = slate => ({
    games: (slate.games || []).length,
    players: Object.values(slate.players || {}).reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0),
    stacks: (slate.stacks || []).length,
    chalk: ((slate.ownership || {}).chalk || []).length
  });

  const latestArticle = artsJson => ((artsJson && artsJson.articles) || []).filter(a => a && a.href && a.title)
    .sort((a, b) => String(b.published_utc || b.date || '').localeCompare(String(a.published_utc || a.date || '')))[0];

  function renderArticle(a) {
    const box = document.getElementById('articlePreview');
    if (!a || !a.title || !box) return;
    const card = document.getElementById('articleCard');
    if (card) card.setAttribute('href', artLink(a));
    const d = parseET((a.date || '') + ' 12:00');
    box.innerHTML = row('Latest article', d ? shortDate(d) : '', 'data-head')
      + row(esc(a.title), '→', 'wrap')
      + row(`Week ${esc(a.week)} · ${esc(ART_NAME[a.slot] || 'Article')}`, 'Read');
  }

  function renderResults(found) {
    if (!found) return;
    const v = document.getElementById('resultsValue'), l = document.getElementById('resultsLabel'), c = document.getElementById('resultsCard');
    if (v) v.textContent = `Week ${found.week}`;
    if (l) l.textContent = 'latest week graded';
    if (c) c.setAttribute('href', found.href);
  }

  // the old reads, used when nfl/home.json is missing
  const legacy = () => Promise.all([getJSON('nfl/slate/slate.json'), getJSON('nfl/articles/articles.json')]).then(([slate, arts]) => {
    renderArticle(latestArticle(arts));
    const sw = slate ? renderWeek(slate) : null;
    if (!sw) return;
    renderPreviews(slate);
    renderCounts(slateCounts(slate));
    // newest results week that exists: this week, then last week
    const weeks = [sw.W, sw.W - 1].filter(n => n > 0);
    return Promise.all(weeks.map(n => getJSON(`nfl/results/${sw.S}-w${n}/results.json`).then(j => (j ? { week: n, href: `nfl/results/${sw.S}-w${n}/` } : null))))
      .then(res => renderResults(res.find(Boolean)));
  });

  getJSON('nfl/home.json').then(home => {
    if (!home || !+home.week) return legacy();
    renderArticle(home.article);
    if (!renderWeek(home)) return;
    renderCounts(home.counts);
    renderResults(home.results);
    if (canReadSlate()) return getJSON('nfl/slate/slate.json').then(slate => { if (slate && +slate.week === +home.week) renderPreviews(slate); });
  }).catch(() => {});
})();
