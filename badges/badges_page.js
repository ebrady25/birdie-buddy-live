/* =====================================================================
   BIRDIEBUDDY — TROPHY ROOM (/badges/)
   Every visitor sees their own case (BBI.badges in assets/js/badges.js):
   header (N of 36, progress ring, tally by rarity), the rarest three,
   the collection by category, and a share card in the DFS DNA card's
   family (portrait 1080×1350 + landscape 1200×630, drawn on a canvas in
   the browser; only badge names go on it). Sharing it earns Show-Off.
   Self-test: ?selftest=badges seeds a fake case in memory (never saved),
   draws both cards and writes a JSON summary to <html data-badges-selftest>
   (&empty=1 for an empty case, &toast=1 to show an unlock toast).
   ===================================================================== */
(() => {
  'use strict';
  const BBI = window.BBI = window.BBI || {};
  const B = BBI.badges;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const Q = new URLSearchParams(location.search);
  const SELFTEST = Q.get('selftest') === 'badges';
  const P = { cat: null, st: null, fmt: 'portrait', cards: {}, sig: '' };

  if (!B) { const g = $('bcGrid'); if (g) g.innerHTML = '<p class="bc-muted">The badges script did not load. Refresh the page to try again.</p>'; return; }

  const RAR = B.RARITY;
  const fmtDate = iso => { const t = Date.parse(iso || ''); if (!t) return ''; try { return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return ''; } };
  const signedIn = () => { try { return !!(BBI.auth && BBI.auth.isLoggedIn()); } catch { return false; } };

  // the case: catalog + state -> lists the page and the card both use
  const model = () => {
    const cat = P.cat, st = P.st || B.state();
    const all = cat.badges.slice().sort((a, b) => a.order - b.order);
    const got = id => st.earned[id];
    const earned = all.filter(b => got(b.id));
    // rarest first: rarity, then verified, then earliest, then catalog order
    const rarest = earned.slice().sort((a, b) => (RAR[b.rarity].rank - RAR[a.rarity].rank) || ((got(b.id).verified ? 1 : 0) - (got(a.id).verified ? 1 : 0)) || (Date.parse(got(a.id).at || 0) - Date.parse(got(b.id).at || 0)) || (a.order - b.order));
    // what to try next: easy, earnable, not coming soon
    const NEXT = ['dna_taken', 'quiz_stacks', 'first_build', 'orientation', 'glossary_grad', 'hype_man', 'card_shark', 'bookworm', 'regular', 'chalk_watcher', 'by_the_book', 'showdown_ace'];
    const next = NEXT.map(id => cat.byId[id]).filter(b => b && !got(b.id));
    const tally = Object.keys(RAR).map(k => ({ id: k, label: RAR[k].label, color: RAR[k].color, n: earned.filter(b => b.rarity === k).length }));
    return { all, earned, rarest, next, tally, got, total: all.length };
  };

  /* ---------------- header ---------------- */
  const drawHeader = M => {
    const n = M.earned.length, pct = M.total ? n / M.total : 0, R = 52, C = 2 * Math.PI * R;
    $('bcRing').setAttribute('aria-label', `${n} of ${M.total} badges collected`);
    $('bcRing').innerHTML = `<svg viewBox="0 0 128 128" width="168" height="168" aria-hidden="true">
        <defs><linearGradient id="bcRingG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F2D688"/><stop offset="1" stop-color="#B8912F"/></linearGradient></defs>
        <circle cx="64" cy="64" r="${R}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="11"/>
        ${n ? `<circle cx="64" cy="64" r="${R}" fill="none" stroke="url(#bcRingG)" stroke-width="11" stroke-linecap="round" stroke-dasharray="${(C * pct).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 64 64)"/>` : ''}
      </svg><span class="bc-ring-t"><b class="num">${n}</b><span>of ${M.total}</span><small>collected</small></span>`;
    $('bcTally').innerHTML = M.tally.map(t => `<li style="--c:${t.color}"><span class="bc-dot" aria-hidden="true"></span>${esc(t.label)} <b class="num">${t.n}</b></li>`).join('');
    $('bcSignin').hidden = signedIn();
  };

  /* ---------------- spotlight + empty state ---------------- */
  const startCards = [
    { id: 'dna_taken', href: 'dna/', t: 'Check your DFS DNA', s: 'Ten seconds with your contest history file.' },
    { id: 'quiz_stacks', href: 'nfl/learn/#test-yourself', t: 'Take a quiz', s: 'Four questions on how we stack. Pass three.' },
    { id: 'first_build', href: 'nfl/lab/', t: 'Grade a lineup', s: 'Build or paste one in the Lineup Lab.' }
  ];
  const drawSpot = M => {
    const top = M.rarest.slice(0, 3);
    const spot = $('bcSpot'), start = $('bcStart');
    if (!top.length) {
      spot.hidden = true; start.hidden = false;
      $('bcStartGrid').innerHTML = startCards.map(c => { const b = P.cat.byId[c.id]; return `<a class="bc-start-card" href="${c.href}"><span class="bc-start-m">${B.medalSvg(b, { earned: false, size: 52 })}</span><span><b>${esc(c.t)}</b><small>${esc(c.s)}</small><em>Earns ${esc(b.name)}</em></span></a>`; }).join('');
      return;
    }
    spot.hidden = false; start.hidden = true;
    const fill = M.next.slice(0, 3 - top.length);
    spot.innerHTML = top.map(b => { const e = M.got(b.id), r = RAR[b.rarity]; return `<li class="bc-spot-i is-on" style="--c:${r.color}">
        <span class="bc-spot-m">${B.medalSvg(b, { earned: true, size: 104 })}</span>
        <b>${esc(b.name)}</b><span class="bc-rar">${esc(r.label)}${e.verified ? ' · Verified' : ''}</span><small>Earned ${esc(fmtDate(e.at))}</small></li>`; }).join('') +
      fill.map(b => `<li class="bc-spot-i is-next"><span class="bc-spot-m">${B.medalSvg(b, { earned: false, size: 104 })}</span>
        <b>Up next: ${esc(b.name)}</b><small>${esc(b.how)}</small></li>`).join('');
  };

  /* ---------------- the collection ---------------- */
  const NOTE = {
    learn: '<a href="nfl/learn/#test-yourself">The quizzes are on How it works →</a>',
    member: '',
    compete: 'The weekly Challenge is on its way.'
  };
  const tile = (b, M) => {
    const e = M.got(b.id), r = RAR[b.rarity], on = !!e, soon = !!b.coming_soon;
    const pr = !on && B.progressFor(b.id);
    const prog = pr && pr.n > 0 ? `<span class="bc-prog" aria-label="${pr.n} of ${pr.at}"><span style="width:${Math.min(100, pr.n / pr.at * 100).toFixed(0)}%"></span></span><small class="bc-prog-t num">${Math.min(pr.n, pr.at)} of ${pr.at}</small>` : '';
    const sub = on ? `Earned ${esc(fmtDate(e.at))}` : esc(b.how);
    return `<li class="bc-tile ${on ? 'is-on' : 'is-locked'} ${soon ? 'is-soon' : ''}" style="--c:${r.color}">
      <span class="bc-tile-m">${B.medalSvg(b, { earned: on, size: 64 })}</span>
      <span class="bc-tile-t">
        <b>${esc(b.name)}</b>
        <span class="bc-tile-tags"><span class="bc-rar">${esc(r.label)}</span>${b.verified ? `<span class="bc-ver">${on && e.verified ? 'Verified' : 'Verified badge'}</span>` : ''}${soon ? '<span class="bc-soon">Coming soon</span>' : ''}</span>
        <small>${sub}</small>${prog}
      </span>
      <span class="sr-only">${on ? 'Earned.' : soon ? 'Coming soon.' : 'Not earned yet.'}</span>
    </li>`;
  };
  const drawGrid = M => {
    $('bcGrid').innerHTML = P.cat.categories.map(c => {
      const list = M.all.filter(b => b.category === c.id), n = list.filter(b => M.got(b.id)).length;
      return `<section class="bc-cat" aria-labelledby="bcCat-${c.id}">
        <div class="bc-cat-head">
          <h3 id="bcCat-${c.id}">${esc(c.label)} <span class="num">${n} of ${list.length}</span></h3>
          <p>${esc(c.blurb)}${NOTE[c.id] ? ` ${NOTE[c.id]}` : ''}</p>
        </div>
        <ul class="bc-tiles">${list.map(b => tile(b, M)).join('')}</ul>
      </section>`;
    }).join('');
  };

  /* =================================================================
     SHARE CARD (same system as the DFS DNA card: offscreen canvas,
     site fonts, the site's own mark, nothing uploaded)
     ================================================================= */
  const SIZES = { portrait: [1080, 1350], landscape: [1200, 630] };
  const CK = { bg: '#0a0a0f', card: '#141419', sunk: '#101017', gold: '#d4a843', ink: '#f4f4f8', body: '#c0c0cc', muted: '#8a8a98', dim: '#5a5a68' };
  const C_SANS = "'Inter', -apple-system, 'Segoe UI', Helvetica, sans-serif", C_MONO = "'JetBrains Mono', Menlo, monospace";
  const CARD_FONTS = ['800 120px Inter', '700 26px Inter', '600 26px Inter', '500 30px Inter', '600 16px "JetBrains Mono"', '700 26px "JetBrains Mono"'];
  let markP = null;
  const cardMark = () => markP || (markP = new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = 'assets/img/mark-gold.svg'; }));
  const rgba = (hex, a) => { const v = parseInt(hex.replace('#', ''), 16); return `rgba(${v >> 16 & 255},${v >> 8 & 255},${v & 255},${a})`; };

  const drawCard = async (M, fmt) => {
    try { await Promise.all(CARD_FONTS.map(f => document.fonts.load(f))); } catch {}
    try { await document.fonts.ready; } catch {}
    const mark = await cardMark();
    const [W, H] = SIZES[fmt], port = fmt === 'portrait', PD = port ? 72 : 56, IW = W - PD * 2;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const font = (o = {}) => `${o.weight || 400} ${o.size || 14}px ${o.mono ? C_MONO : C_SANS}`;
    const LS = 'letterSpacing' in g;
    const fit = (t, maxW, o) => { t = String(t ?? ''); g.font = font(o); if (g.measureText(t).width <= maxW) return t; while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; };
    const txt = (t, x, y, o = {}) => { g.font = font(o); g.fillStyle = o.color || CK.ink; g.textAlign = o.align || 'left'; g.textBaseline = 'alphabetic'; if (LS) g.letterSpacing = o.ls || '0px'; g.fillText(o.maxW ? fit(t, o.maxW, o) : String(t ?? ''), x, y); if (LS) g.letterSpacing = '0px'; };
    const measure = (t, o = {}) => { g.font = font(o); t = String(t ?? ''); return g.measureText(t).width + (LS && o.ls ? parseFloat(o.ls) * t.length : 0); };
    const rr = (x, y, w, h, r, fill, stroke, lw = 1) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); } };

    const n = M.earned.length, top = M.rarest.slice(0, 3);
    const acc = top.length ? RAR[top[0].rarity].color : CK.gold;
    const topIds = new Set(top.map(b => b.id));
    const slots = top.map(b => ({ b, on: true })).concat(M.next.filter(b => !topIds.has(b.id)).slice(0, 3 - top.length).map(b => ({ b, on: false })));
    const slotIds = new Set(slots.map(x => x.b.id));
    const rest = M.all.filter(b => !slotIds.has(b.id));   // always 33: the three big slots + the rest = the whole case

    // background: page color, a gold glow top-left, the rarest badge's glow on the right, a gold rule on top
    g.fillStyle = CK.bg; g.fillRect(0, 0, W, H);
    let gl = g.createRadialGradient(0, 0, 0, 0, 0, W * 0.85); gl.addColorStop(0, 'rgba(212,168,67,0.12)'); gl.addColorStop(1, 'rgba(212,168,67,0)'); g.fillStyle = gl; g.fillRect(0, 0, W, H);
    gl = g.createRadialGradient(W * (port ? 0.5 : 0.28), port ? 720 : 430, 0, W * (port ? 0.5 : 0.28), port ? 720 : 430, port ? 620 : 380); gl.addColorStop(0, rgba(acc, 0.16)); gl.addColorStop(1, rgba(acc, 0)); g.fillStyle = gl; g.fillRect(0, 0, W, H);
    g.fillStyle = CK.gold; g.fillRect(0, 0, W, port ? 8 : 6);

    // header: mark + name (left), count (right)
    const hdr = port ? { mh: 46, my: 52, name: 36, ny: 90, sub: 16, sy: 118, rs: 16, ry: 82, rv: 26, rvy: 116, div: 150 } : { mh: 38, my: 32, name: 28, ny: 62, sub: 13, sy: 84, rs: 13, ry: 54, rv: 20, rvy: 82, div: 112 };
    let bx = PD;
    if (mark && mark.naturalWidth) { const h = hdr.mh, w = h * mark.naturalWidth / mark.naturalHeight; g.drawImage(mark, PD, hdr.my, w, h); bx = PD + w + 14; }
    txt('BirdieBuddy', bx, hdr.ny, { size: hdr.name, weight: 800 });
    txt('TROPHY ROOM', bx, hdr.sy, { mono: true, size: hdr.sub, weight: 600, color: CK.gold, ls: '2px' });
    txt('NFL · DFS', W - PD, hdr.ry, { mono: true, size: hdr.rs, weight: 600, color: CK.gold, align: 'right', ls: '2px' });
    txt(`${Math.round(n / M.total * 100)}% complete`, W - PD, hdr.rvy, { size: hdr.rv, weight: 700, align: 'right' });
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(PD, hdr.div, IW, 1);

    // the count
    const L = port ? { ey: 220, cy: 404, cs: 200, ss: 76, ly: 452, by: 486, bh: 18, tw: IW } : { ey: 152, cy: 262, cs: 124, ss: 46, ly: 296, by: 314, bh: 12, tw: 500 };
    txt('MY TROPHY ROOM', PD, L.ey, { mono: true, size: port ? 20 : 14, weight: 700, color: acc, ls: '2px' });
    txt(String(n), PD - L.cs * 0.03, L.cy, { size: L.cs, weight: 800 });
    const cw = measure(String(n), { size: L.cs, weight: 800 });
    txt(`/ ${M.total}`, PD + cw + (port ? 18 : 12), L.cy, { size: L.ss, weight: 600, color: CK.muted });
    txt(n === 1 ? 'badge collected' : 'badges collected', PD, L.ly, { size: port ? 30 : 20, weight: 500, color: CK.body });
    // progress bar, split by rarity
    rr(PD, L.by, L.tw, L.bh, L.bh / 2, CK.sunk);
    if (n) {
      g.save(); g.beginPath(); if (g.roundRect) g.roundRect(PD, L.by, L.tw, L.bh, L.bh / 2); else g.rect(PD, L.by, L.tw, L.bh); g.clip();
      let x = PD;
      M.tally.filter(t => t.n).forEach(t => { const w = L.tw * t.n / M.total; g.fillStyle = t.color; g.fillRect(x, L.by, w, L.bh); x += w; });
      g.restore();
    }
    // tally chips (portrait: under the bar; landscape: under the grid)
    const chips = (x0, y0, maxX, s) => {
      let x = x0;
      M.tally.forEach(t => {
        const label = `${t.n} ${t.label}`, w = measure(label, { size: 17 * s, weight: 600 }) + 44 * s;
        if (x + w > maxX) return;
        rr(x, y0, w, 38 * s, 19 * s, rgba(t.color, t.n ? 0.12 : 0.04), rgba(t.color, t.n ? 0.6 : 0.2), 1.5 * s);
        g.fillStyle = t.n ? t.color : rgba(t.color, 0.4); g.beginPath(); g.arc(x + 19 * s, y0 + 19 * s, 5.5 * s, 0, Math.PI * 2); g.fill();
        txt(label, x + 32 * s, y0 + 25.5 * s, { size: 17 * s, weight: 600, color: t.n ? CK.ink : CK.dim });
        x += w + 10 * s;
      });
    };
    if (port) chips(PD, 532, W - PD, 1);

    // the three rarest, big (or the next ones to get, dimmed)
    const T = port ? { y: 616, ms: 212, ny: 878, ns: 30, ry: 912, rs: 18, colW: IW / 3, x0: PD } : { y: 340, ms: 118, ny: 488, ns: 18, ry: 512, rs: 12, colW: 520 / 3, x0: PD };
    if (!top.length) txt('START WITH', PD, T.y - (port ? 18 : 10), { mono: true, size: port ? 15 : 11, weight: 600, color: CK.dim, ls: '2px' });
    slots.forEach((sl, i) => {
      const cx = T.x0 + T.colW * i + T.colW / 2, r = RAR[sl.b.rarity];
      g.save(); if (!sl.on) g.globalAlpha = 0.55;
      B.drawMedal(g, cx - T.ms / 2, T.y, T.ms, sl.b, { earned: sl.on, glowScale: port ? 1.6 : 1 });
      g.restore();
      txt(sl.b.name, cx, T.ny, { size: T.ns, weight: 700, align: 'center', maxW: T.colW - 16, color: sl.on ? CK.ink : CK.muted });
      txt(sl.on ? `${r.label.toUpperCase()}${sl.b.verified ? ' · VERIFIED' : ''}` : 'UP NEXT', cx, T.ry, { mono: true, size: T.rs, weight: 700, align: 'center', color: sl.on ? r.color : CK.dim, ls: '1.5px', maxW: T.colW - 16 });
    });

    // mini grid: the rest of the case (earned in color, the rest dimmed)
    const G = port ? { x: PD, y: 996, w: IW, cols: 11, gap: 11, ly: 978 } : { x: 620, y: 168, w: W - PD - 620, cols: 9, gap: 10, ly: 152 };
    txt('THE REST OF THE CASE', G.x, G.ly, { mono: true, size: port ? 15 : 11, weight: 600, color: CK.dim, ls: '2px' });
    const ms = (G.w - G.gap * (G.cols - 1)) / G.cols;
    rest.forEach((b, i) => {
      const x = G.x + (i % G.cols) * (ms + G.gap), y = G.y + Math.floor(i / G.cols) * (ms + G.gap);
      const on = !!M.got(b.id);
      g.save(); if (!on) g.globalAlpha = 0.5;
      B.drawMedal(g, x, y, ms, b, { earned: on, glow: on, glowScale: 0.6 });
      g.restore();
    });
    if (!port) chips(G.x, G.y + Math.ceil(rest.length / G.cols) * (ms + G.gap) + 6, W - PD, 0.62);

    // footer
    const fy = port ? 1280 : 556;
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(PD, fy, IW, 1);
    txt('Collect yours · birdiebuddy.io/badges', PD, fy + (port ? 44 : 38), { mono: true, size: port ? 24 : 18, weight: 600, color: CK.gold });
    return cv;
  };
  const cardBlob = cv => new Promise(res => { try { cv.toBlob(res, 'image/png'); } catch { res(null); } });
  const canCopyImg = () => !!(navigator.clipboard && navigator.clipboard.write && window.ClipboardItem);
  const canShareFile = f => { try { return !!(f && navigator.share && navigator.canShare && navigator.canShare({ files: [f] })); } catch { return false; } };

  const renderCard = async fmt => {
    const M = model(), key = `${P.sig}|${fmt}`;
    if (P.cards[key]) return P.cards[key];
    const canvas = await drawCard(M, fmt), blob = await cardBlob(canvas);
    const name = `birdiebuddy-trophy-room-${fmt}.png`;
    let file = null; try { file = blob ? new File([blob], name, { type: 'image/png' }) : null; } catch {}
    const top = M.rarest.slice(0, 3);
    const alt = `Trophy Room card: ${M.earned.length} of ${M.total} badges collected.${top.length ? ` Rarest: ${top.map(b => `${b.name} (${RAR[b.rarity].label})`).join(', ')}.` : ''}`;
    return (P.cards[key] = { canvas, blob, file, name, alt, url: blob ? URL.createObjectURL(blob) : '' });
  };
  const cardStatus = t => { const s = $('bcCardSt'); if (s) s.textContent = t; };
  let drawSeq = 0;
  const drawCardPreview = async () => {
    const img = $('bcCardImg'), wait = $('bcCardWait'), well = $('bcCardPrev'), fmt = P.fmt, seq = ++drawSeq;
    well.dataset.fmt = fmt;
    document.querySelectorAll('[data-fmt]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.fmt === fmt)));
    const acts = document.querySelectorAll('[data-card-act]'); acts.forEach(b => { b.disabled = true; });
    if (img.hidden) { wait.hidden = false; wait.textContent = 'Drawing your card…'; }
    const r = await renderCard(fmt);
    if (seq !== drawSeq) return;
    if (!r || !r.blob) { wait.hidden = false; img.hidden = true; wait.textContent = "Your browser couldn't draw the card."; return; }
    const [w, h] = SIZES[fmt]; img.width = w; img.height = h;
    img.src = r.url; img.alt = r.alt; img.hidden = false; wait.hidden = true;
    document.querySelector('[data-card-act="share"]').hidden = !canShareFile(r.file);
    document.querySelector('[data-card-act="copy"]').hidden = !canCopyImg();
    acts.forEach(b => { b.disabled = false; });
  };
  const cardAct = async act => {
    const r = P.cards[`${P.sig}|${P.fmt}`]; if (!r || !r.blob) return;
    if (act === 'download') {
      const a = document.createElement('a'); a.href = URL.createObjectURL(r.blob); a.download = r.name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      cardStatus('Downloaded.'); B.earn('show_off'); return;
    }
    if (act === 'copy') {
      try { await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': r.blob })]); cardStatus('Image copied: paste it into a post or a message.'); B.earn('show_off'); }
      catch { cardStatus('Your browser blocked the copy: use Download PNG instead.'); }
      return;
    }
    if (act === 'share') {
      try { await navigator.share({ files: [r.file], title: 'My Trophy Room', text: 'Collect yours · birdiebuddy.io/badges' }); cardStatus('Shared.'); B.earn('show_off'); }
      catch (e) { cardStatus(e && e.name === 'AbortError' ? '' : "Sharing didn't work here: use Download PNG instead."); }
    }
  };

  /* ---------------- draw everything ---------------- */
  const sigOf = st => Object.entries(st.earned).map(([k, e]) => `${k}${e.verified ? '+' : ''}`).sort().join(',');
  const drawAll = () => {
    if (!P.cat) return;
    P.st = B.state();
    const M = model();
    drawHeader(M); drawSpot(M); drawGrid(M);
    const sig = sigOf(P.st);
    if (sig !== P.sig || !P.cards[`${sig}|${P.fmt}`]) { P.sig = sig; drawCardPreview(); }
  };

  const bind = () => {
    document.addEventListener('click', e => {
      const f = e.target.closest('[data-fmt]'); if (f) { P.fmt = f.dataset.fmt; drawCardPreview(); return; }
      const c = e.target.closest('[data-card-act]'); if (c) { cardAct(c.dataset.cardAct); return; }
      const s = e.target.closest('[data-bc="signin"]');
      if (s && BBI.auth && BBI.auth.openLogin) { e.preventDefault(); BBI.auth.openLogin(); }
    });
    B.onChange(() => drawAll());
    // auth.js loads async (brand.js injects it): redraw the sign-in banner when it lands and on sign-in/out
    const t0 = Date.now();
    const poll = () => { const a = BBI.auth; if (a && a.onChange) { a.onChange(() => setTimeout(drawAll, 0)); drawAll(); return; } if (Date.now() - t0 < 20000) setTimeout(poll, 300); };
    poll();
  };

  /* ?selftest=badges (a check, not a feature): a fake case in memory only, both cards, a JSON summary */
  const FAKE = () => {
    const d = k => new Date(Date.now() - k * 864e5).toISOString();
    const e = (at, ver) => ({ at: d(at), verified: !!ver, source: ver ? 'server' : 'self' });
    return {
      earned: {
        finish_legendary: e(9), finish_epic: e(9), finish_rare: e(9), day_one: e(30, 1), film_study: e(2, 1),
        quiz_stacks: e(3, 1), quiz_ownership: e(3, 1), quiz_captain: e(2, 1), quiz_fields: e(2, 1),
        dna_taken: e(9), sniper: e(9), first_build: e(20), by_the_book: e(12), bookworm: e(6), hype_man: e(9), regular: e(1), chalk_watcher: e(1)
      },
      counters: { articles: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'], graded: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9'], weeks: ['2026-w41', '2026-w42', '2026-w43', '2026-w44', '2026-w45'], glossary: ['stack', 'chalk', 'pivot', 'fade'], dna_sports: ['NFL'] },
      migrated: { dna: 1 }
    };
  };
  const selfTest = async () => {
    const out = { ok: false };
    try {
      const empty = Q.get('empty') === '1';
      B._seed(empty ? { earned: {}, counters: {} } : FAKE(), { toasts: Q.get('toast') === '1' });
      drawAll();
      const M = model();
      out.empty = empty;
      out.earned = M.earned.length; out.total = M.total; out.catalog = P.cat.badges.length;
      out.rarest = M.rarest.slice(0, 3).map(b => `${b.name} (${RAR[b.rarity].label}${M.got(b.id).verified ? ', verified' : ''})`);
      out.tally = Object.fromEntries(M.tally.map(t => [t.id, t.n]));
      out.categories = Object.fromEntries(P.cat.categories.map(c => { const l = M.all.filter(b => b.category === c.id); return [c.id, `${l.filter(b => M.got(b.id)).length}/${l.length}`]; }));
      out.tiles = document.querySelectorAll('.bc-tile').length;
      out.tilesEarned = document.querySelectorAll('.bc-tile.is-on').length;
      out.comingSoon = document.querySelectorAll('.bc-tile.is-soon').length;
      out.verifiedTags = document.querySelectorAll('.bc-ver').length;
      out.progressBars = document.querySelectorAll('.bc-prog').length;
      out.startCards = document.querySelectorAll('.bc-start-card').length;
      out.signinBanner = !$('bcSignin').hidden;
      for (const fmt of ['portrait', 'landscape']) {
        const r = await renderCard(fmt);
        const url = r ? r.canvas.toDataURL('image/png') : '';
        out[`png_${fmt}`] = url.length; out[`size_${fmt}`] = r ? `${r.canvas.width}x${r.canvas.height}` : null;
        document.documentElement.setAttribute(`data-badges-png-${fmt}`, url);
      }
      out.saved = (() => { try { return localStorage.getItem('bbi_badges_v1') !== null; } catch { return null; } })();
      if (Q.get('toast') === '1') B._toast(empty ? 'dna_taken' : 'finish_legendary');
      await new Promise(r => setTimeout(r, 400));
      out.noHScroll = document.documentElement.scrollWidth <= window.innerWidth;
      out.ok = true;
    } catch (e) { out.error = String(e && e.message || e); }
    document.documentElement.dataset.badgesSelftest = JSON.stringify(out);
  };

  const boot = async () => {
    P.cat = await B.catalog();
    if (!P.cat) { $('bcGrid').innerHTML = '<p class="bc-muted">The badge list did not load. Refresh the page to try again.</p>'; return; }
    bind();
    if (SELFTEST) { selfTest(); return; }
    drawAll();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
