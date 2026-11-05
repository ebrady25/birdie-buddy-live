/* =====================================================================
   BIRDIEBUDDY — "TEST YOURSELF" QUIZZES (nfl/learn/, BBI.badgesQuiz)
   Four quizzes from badges/quizzes.json (questions only: the answer key
   lives in the database). Answers go to the grade_quiz RPC through
   BBI.badges.quiz(); it returns pass + how many were right, never the
   key. After grading, every question shows its one-line "why", but not
   which choice was right. A pass puts the verified badge in the case.
   Signed out: "Sign in to take the quiz and keep the badge".
   ===================================================================== */
(() => {
  'use strict';
  const BBI = window.BBI = window.BBI || {};
  if (BBI.badgesQuiz) return;
  const QUIZ_URL = 'badges/quizzes.json?v=20261105d';
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const signedIn = () => { try { return !!(BBI.auth && BBI.auth.isLoggedIn()); } catch { return false; } };
  const signIn = () => { if (BBI.auth && BBI.auth.openLogin) BBI.auth.openLogin(); else window.location.href = 'login.html'; };

  let data = null, cat = null, host = null;
  const B = () => BBI.badges;
  const have = id => { const b = B(); const e = b && b.state().earned[id]; return !!(e && e.verified); };

  const cardHtml = q => {
    const badge = cat && cat.byId[q.badge], r = B().rarityOf(badge), passed = have(q.badge), n = q.questions.length;
    const form = q.questions.map((x, i) => `
      <fieldset class="qz-q">
        <legend><span>${i + 1}/${n}</span>${esc(x.q)}</legend>
        <div class="qz-choices">${x.choices.map((c, j) => `<label class="qz-choice"><input type="radio" name="${q.id}-q${i}" value="${j}"><span>${esc(c)}</span></label>`).join('')}</div>
        <p class="qz-why" hidden></p>
      </fieldset>`).join('');
    return `<article class="qz-card ${passed ? 'is-passed' : ''}" data-quiz="${q.id}" style="--c:${r.color}" aria-labelledby="${q.id}-h">
      <div class="qz-head">
        <span data-qz="medal">${B().medalSvg(badge, { earned: passed, size: 56 })}</span>
        <div>
          <div class="qz-badge-k">${esc(badge ? badge.name : q.badge_name)} · ${esc(r.label)} · verified</div>
          <h3 id="${q.id}-h">${esc(q.title)}</h3>
          <p>${esc(q.blurb)} ${n} questions, pass with ${data.pass_at}.</p>
        </div>
      </div>
      <div class="qz-acts" data-qz="acts"></div>
      <form class="qz-form" id="${q.id}-form" hidden novalidate>
        ${form}
        <div class="qz-acts">
          <button type="submit" class="btn btn-primary" data-qz="grade">Grade my answers</button>
          <button type="button" class="btn" data-qz="retry" hidden>Try again</button>
        </div>
        <p class="qz-result" data-qz="result" role="status" aria-live="polite"></p>
      </form>
    </article>`;
  };

  // the buttons under the card's header: depends on sign-in, open/closed and passed
  const drawActs = card => {
    const id = card.dataset.quiz, open = card.classList.contains('is-open'), passed = have(id), acts = card.querySelector('[data-qz="acts"]');
    const toggle = `<button type="button" class="btn ${signedIn() && !passed ? 'btn-primary' : ''}" data-qz="toggle" aria-expanded="${open}" aria-controls="${id}-form">${open ? 'Hide the questions' : passed ? 'Take it again' : signedIn() ? 'Take the quiz' : 'See the questions'}</button>`;
    acts.innerHTML = passed
      ? `${toggle}<span class="qz-state"><b>Passed.</b> The badge is in your <a href="badges/">Trophy Room</a>.</span>`
      : signedIn()
        ? toggle
        : `<button type="button" class="btn btn-primary" data-qz="signin">Sign in</button>${toggle}<span class="qz-state">Sign in to take the quiz and keep the badge.</span>`;
    const m = card.querySelector('[data-qz="medal"]'); if (m && cat) m.innerHTML = B().medalSvg(cat.byId[id], { earned: passed, size: 56 });
    card.classList.toggle('is-passed', passed);
  };
  const drawAll = () => { if (host) host.querySelectorAll('.qz-card').forEach(drawActs); };

  const setResult = (card, html, cls) => { const r = card.querySelector('[data-qz="result"]'); r.className = `qz-result ${cls || ''}`; r.innerHTML = html; };
  const lock = (card, on) => card.querySelectorAll('input[type=radio]').forEach(i => { i.disabled = on; });
  // the explanations come back from the grader (never shipped in quizzes.json, so the file can't give answers away)
  const showWhy = (card, on, whys) => card.querySelectorAll('.qz-why').forEach((w, i) => {
    const t = on && whys && whys[i]; w.innerHTML = t ? `<b>Why:</b> ${esc(t)}` : ''; w.hidden = !t;
  });

  const grade = async card => {
    const id = card.dataset.quiz, q = data.quizzes.find(x => x.id === id);
    const answers = q.questions.map((_, i) => { const c = card.querySelector(`input[name="${id}-q${i}"]:checked`); return c ? +c.value : null; });
    const miss = answers.findIndex(a => a == null);
    if (miss >= 0) { setResult(card, `Answer all ${q.questions.length} questions first.`, 'is-warn'); const f = card.querySelector(`input[name="${id}-q${miss}"]`); if (f) f.focus(); return; }
    if (!signedIn()) { setResult(card, '<b>Sign in to take the quiz and keep the badge.</b> Your answers stay right here. <button type="button" class="qz-link" data-qz="signin">Sign in</button>', 'is-warn'); return; }
    const btn = card.querySelector('[data-qz="grade"]');
    btn.disabled = true; btn.textContent = 'Grading…';
    let r;
    try { r = await B().quiz(id, answers); } catch { r = { error: 'failed' }; }
    btn.disabled = false; btn.textContent = 'Grade my answers';
    const badge = cat.byId[id];
    if (r.needsSignIn) { setResult(card, '<b>Sign in to take the quiz and keep the badge.</b> <button type="button" class="qz-link" data-qz="signin">Sign in</button>', 'is-warn'); return; }
    if (r.unavailable) { setResult(card, "<b>Quiz grading isn't switched on yet.</b> Check back soon. Nothing was saved.", 'is-warn'); return; }
    if (r.limited) { setResult(card, "<b>That's today's 5 tries for this quiz.</b> Come back tomorrow and give it another go.", 'is-warn'); return; }
    if (r.error) { setResult(card, "<b>Couldn't reach the grader.</b> Check your connection and try again.", 'is-warn'); return; }
    // graded: every question's "why" (never which choice was right)
    lock(card, true); showWhy(card, true, r.whys);
    btn.hidden = true; card.querySelector('[data-qz="retry"]').hidden = false;
    const tot = r.total || q.questions.length, ok = r.correct == null ? '' : `${r.correct} of ${tot} right. `;
    if (r.passed) setResult(card, `<b>${ok}Passed.</b> ${esc(badge.name)} is in your <a href="badges/">Trophy Room</a>.`, 'is-pass');
    else setResult(card, `<b>${ok}You need ${data.pass_at} to pass.</b> Read the why under each question, then try again (up to 5 tries a day).`, '');
    drawActs(card);
  };
  const retry = card => {
    card.querySelectorAll('input[type=radio]').forEach(i => { i.checked = false; });
    lock(card, false); showWhy(card, false); setResult(card, '');
    card.querySelector('[data-qz="retry"]').hidden = true; card.querySelector('[data-qz="grade"]').hidden = false;
    const f = card.querySelector('input[type=radio]'); if (f) f.focus();
  };

  const bind = () => {
    host.addEventListener('click', e => {
      const card = e.target.closest('.qz-card'); if (!card) return;
      const t = e.target.closest('[data-qz]'); if (!t) return;
      const k = t.dataset.qz;
      if (k === 'signin') { e.preventDefault(); signIn(); return; }
      if (k === 'toggle') {
        const form = card.querySelector('.qz-form'), open = form.hidden;
        form.hidden = !open; card.classList.toggle('is-open', open); drawActs(card);
        if (open) { const f = card.querySelector('input[type=radio]:not(:disabled)'); if (f) f.focus({ preventScroll: true }); try { card.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } catch {} }
        else { const b = card.querySelector('[data-qz="toggle"]'); if (b) b.focus(); }
        return;
      }
      if (k === 'retry') { retry(card); }
    });
    host.addEventListener('submit', e => { const card = e.target.closest('.qz-card'); if (card) { e.preventDefault(); grade(card); } });
    if (B()) B().onChange(() => drawAll());
    // auth.js lands async: redraw the buttons when it does, and on sign-in/out
    const t0 = Date.now();
    const poll = () => { const a = BBI.auth; if (a && a.onChange) { a.onChange(() => setTimeout(drawAll, 0)); drawAll(); return; } if (Date.now() - t0 < 20000) setTimeout(poll, 300); };
    poll();
  };

  const mount = async el => {
    host = el; if (!host || !B()) return;
    try {
      const [q, c] = await Promise.all([fetch(QUIZ_URL, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)), B().catalog()]);
      if (!q || !Array.isArray(q.quizzes) || !c) throw new Error('load');
      data = q; cat = c;
    } catch { host.innerHTML = '<p class="qz-state">The quizzes did not load. Refresh the page to try again.</p>'; return; }
    host.innerHTML = data.quizzes.map(cardHtml).join('');
    drawAll(); bind();
  };

  BBI.badgesQuiz = { mount };
})();
