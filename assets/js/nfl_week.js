/* =====================================================================
   BIRDIEBUDDY NFL HUB: "This week" card (nfl/index.html, #nfl-week)
   Client-side so it never goes stale: reads nfl/slate/slate.json and
   nfl/articles/articles.json, checks which results weeks exist, and
   works out what is new and when the next update lands (US Eastern).
   If anything fails, the static card in the page stays as it is.
   No external scripts. Times below = the weekly publish schedule.
   ===================================================================== */
(() => {
  'use strict';
  const mount = document.getElementById('nfl-week');
  if (!mount || !window.fetch || !window.Intl) return;

  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const H = 3600e3, D = 24 * H;
  // stage order (slate.json "stage")
  const RANK = { tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun_am: 6, sun_check: 7, sun_late: 8 };
  const STAGE_NEW = {
    tue: 'early numbers are up', wed: 'Wednesday numbers are up', thu: 'Thursday numbers are up',
    fri: 'Friday final numbers are up', sat: 'Saturday numbers are up', sun_am: 'Sunday morning update is up',
    sun_check: 'Sunday inactives update is up', sun_late: 'Sunday late update is up'
  };
  // [days before Sunday lock, hour, minute, rank, what]
  const SLATE_SCHED = [[4, 19, 0, 2, 'Wednesday numbers', 'are'], [2, 18, 45, 4, 'Friday final numbers', 'are'], [0, 9, 15, 6, 'Sunday morning update', 'is']];
  const ART_SCHED = [[4, 19, 30, 1, 'Wednesday first look'], [2, 19, 0, 2, 'Friday final call'], [0, 10, 30, 3, 'Sunday morning update', true]];
  const ART_RANK = { wed: 1, thu: 1.5, fri: 2, sat: 2.5, sun: 3, sun_am: 3 };
  const ART_NAME = { wed: 'first look', thu: 'Thursday update', fri: 'final call', sat: 'final read', sun: 'Sunday update', sun_am: 'Sunday update' };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Eastern wall-clock time held in a Date's UTC fields (all math below stays in that space).
  const etNow = () => {
    const q = /[?&]now=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/.exec(location.search);   // preview/testing only
    if (q) return parseET(q[1]);
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
    return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute));
  };
  const parseET = s => {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ''));
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : null;
  };
  const dayNum = t => Math.floor(t.getTime() / D);
  const clock = t => {
    const h = t.getUTCHours(), m = t.getUTCMinutes();
    return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`;
  };
  // "tonight at 7 PM ET" / "tomorrow at 6:45 PM ET" / "Fri at 6:45 PM ET"
  const when = (t, now, by) => {
    const dd = dayNum(t) - dayNum(now);
    const day = dd === 0 ? (t.getUTCHours() >= 17 ? 'tonight' : 'today') : dd === 1 ? 'tomorrow' : DAY[t.getUTCDay()];
    return `${day} ${by ? 'by' : 'at'} ${clock(t)} ET`;
  };
  // Sunday 1 PM ET lock of the slate's week (the as-of day itself when it is a Sunday)
  const lockOf = asof => new Date(Date.UTC(asof.getUTCFullYear(), asof.getUTCMonth(), asof.getUTCDate() + (7 - asof.getUTCDay()) % 7, 13, 0));
  const dueOf = (lock, e) => new Date(Date.UTC(lock.getUTCFullYear(), lock.getUTCMonth(), lock.getUTCDate() - e[0], e[1], e[2]));

  const getJSON = url => fetch(url, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  // clean article URL (Cloudflare 308s /x.html -> /x): the path of articles.json 'url', else nfl/articles/<href>
  const artLink = a => {
    if (a && a.url) { try { const p = new URL(a.url, document.baseURI).pathname.replace(/^\/+/, ''); if (p) return p; } catch (e) {} }
    return 'nfl/articles/' + String((a && a.href) || '');
  };
  const exists = url => fetch(url, { method: 'HEAD', cache: 'no-cache' }).then(r => r.ok).catch(() => false);

  const render = (slate, artsJson, results) => {
    const S = +slate.season, W = +slate.week, stage = String(slate.stage || '');
    const asof = parseET(slate.as_of), now = etNow();
    if (!S || !W || !asof) return;
    const lock = lockOf(asof);
    const phase = now < lock ? 'live' : now < new Date(lock.getTime() + 12 * H) ? 'in_play' : 'final';

    const arts = ((artsJson && artsJson.articles) || []).filter(a => a && a.href && +a.season === S && +a.week >= W)
      .sort((a, b) => String(b.published_utc || b.date || '').localeCompare(String(a.published_utc || a.date || '')));
    const art = arts[0] || null;

    let head, sub, note = '';
    const btns = [];
    const slateBtn = primary => btns.push(`<a class="btn${primary ? ' btn-primary' : ''}" href="nfl/slate/">${phase === 'final' ? `Week ${W} slate` : 'This week\'s slate'} →</a>`);
    const artBtn = () => { if (art) btns.push(`<a class="btn" href="${esc(artLink(art))}">Read the Week ${esc(art.week)} ${esc(ART_NAME[art.slot] || 'article')} →</a>`); };
    const resBtn = r => { if (r) btns.push(`<a class="btn${r.primary ? ' btn-primary' : ''}" href="${esc(r.href)}">${esc(r.label)} →</a>`); };
    const lastRes = results.find(r => r.week === W - 1) || null, thisRes = results.find(r => r.week === W) || null;
    const allRes = results.find(r => r.index) || null;

    if (phase === 'live') {
      head = `Week ${W}: ${STAGE_NEW[stage] || 'new numbers are up'}`;
      const rank = RANK[stage] || 0;
      const todo = SLATE_SCHED.filter(e => e[3] > rank).map(e => ({ e, t: dueOf(lock, e) })).filter(x => x.t < lock);
      const late = todo.filter(x => x.t <= now).pop(), next = todo.find(x => x.t > now);
      sub = late ? `${late.e[4]} ${late.e[5]} on the way (due ${DAY[late.t.getUTCDay()]} ${clock(late.t)} ET). Check back soon.`
        : next ? `Next: ${next.e[4]}, ${when(next.t, now)}.`
        : 'These are our final numbers for the week. The main slate locks Sunday at 1 PM ET.';
      const aRank = art ? (ART_RANK[art.slot] || 1) : 0;
      const nextArt = ART_SCHED.filter(e => e[3] > aRank).map(e => ({ e, t: dueOf(lock, e) })).find(x => x.t > now && x.t < lock);
      if (!art) note = nextArt ? `This week's first article lands ${when(nextArt.t, now, nextArt.e[5])}.` : 'This week\'s article is on the way.';
      else if (nextArt) note = `Next article: ${nextArt.e[4]}, ${when(nextArt.t, now, nextArt.e[5])}.`;
      slateBtn(true); artBtn(); resBtn(lastRes || allRes);
    } else if (phase === 'in_play') {
      head = `Week ${W} is underway`;
      sub = `The main slate locked Sunday at 1 PM ET. We grade our numbers Monday.`;
      slateBtn(true); artBtn(); resBtn(lastRes || allRes);
    } else {
      head = `Week ${W} is final`;
      const firstNext = dueOf(new Date(lock.getTime() + 7 * D), SLATE_SCHED[0]);   // next week's Wednesday numbers
      const nw = now > new Date(firstNext.getTime() + 0.5 * H)
        ? `Week ${W + 1} numbers are running a little late. Check back soon.`
        : `Week ${W + 1} numbers land Wednesday evening.`;
      const r0 = thisRes ? '' : now.getUTCDay() === 1 ? `Week ${W} results post later today. ` : `Week ${W} results are on the way. `;
      sub = (thisRes ? 'See how our numbers did. ' : r0) + nw;
      if (thisRes) resBtn(Object.assign({}, thisRes, { primary: true, label: `How we did in Week ${W}` }));
      slateBtn(!thisRes); artBtn();
      if (!thisRes) resBtn(lastRes || allRes);
    }

    const stamp = `Numbers as of ${DAY[asof.getUTCDay()]} ${clock(asof)} ET`;
    mount.innerHTML = `
      <div class="nfl-week-top"><span class="badge badge-gold">This week</span><span class="nfl-week-stamp">${esc(stamp)}</span></div>
      <h2 class="nfl-week-h">${esc(head)}</h2>
      <p class="nfl-week-sub">${esc(sub)}</p>
      ${btns.length ? `<div class="nfl-week-btns">${btns.join('')}</div>` : ''}
      ${note ? `<p class="nfl-week-note">${esc(note)}</p>` : ''}`;
    mount.dataset.phase = phase;
  };

  getJSON('nfl/slate/slate.json').then(slate => {
    if (!slate || !slate.week || !slate.season) return;
    const S = +slate.season, W = +slate.week;
    const cands = [W, W - 1].filter(n => n > 0).map(n => ({ week: n, href: `nfl/results/${S}-w${n}/`, label: `Week ${n} results`, url: `nfl/results/${S}-w${n}/results.json` }));
    cands.push({ index: true, href: 'nfl/results/', label: 'Past results', url: 'nfl/results/' });
    return Promise.all([getJSON('nfl/articles/articles.json'), Promise.all(cands.map(c => exists(c.url).then(ok => (ok ? c : null))))])
      .then(([arts, res]) => render(slate, arts, res.filter(Boolean)));
  }).catch(() => {});
})();
