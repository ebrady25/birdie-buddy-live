/* =====================================================================
   BIRDIEBUDDY — SHOWDOWN FOLDS
   Every step and every section in it is a native <details> fold.
     • Game day (default) opens the Answer and Tool sections of Steps 3–5;
       Study opens everything. Evidence and Reference stay one click away.
     • The page always opens with every fold shut (Ethan, 2026-09-24); the
       picked mode is remembered on this device and applies when clicked.
       What the reader opens or closes holds for the visit, not across loads.
     • openTo(el) opens every fold around an element, for jumps and deep
       links; a closed fold's summary line (data-ans) carries its answer.
     • Phones: one step open at a time (Game day); open step headers stick.
   Native <details>, so Chrome's find-in-page opens a fold that holds a match.
   ===================================================================== */
window.BBI = window.BBI || {};
(() => {
  'use strict';
  const LS = 'bbi_showdown_folds';
  const INPUTS = 'bbi_showdown_inputs';           // showdown.js: present once a slate has been set
  const GAME_STEPS = ['step3', 'step4', 'step5'];
  const OPEN_TIERS = ['answer', 'tool'];
  const phone = () => window.matchMedia && window.matchMedia('(max-width: 767px)').matches;

  const load = () => { try { const j = JSON.parse(localStorage.getItem(LS)); return j && typeof j === 'object' && j.v === 1 ? j : null; } catch { return null; } };
  // Only the mode is stored; open/closed state lives for this visit.
  let st = { v: 1, mode: (load() || {}).mode === 'study' ? 'study' : 'game', open: {} };
  const save = () => { try { localStorage.setItem(LS, JSON.stringify({ v: 1, mode: st.mode })); } catch {} };
  const firstVisit = (() => { try { return !localStorage.getItem(INPUTS); } catch { return true; } })();

  const idOf = d => d.id || d.dataset.foldId || '';
  // The mode's default for one fold. Recipe cards pass their own default (in the batch or not).
  const modeDefault = (d, own) => {
    if (st.mode === 'study') return true;
    if (d.classList.contains('sd-step')) {
      if (d.id === 'step1') return firstVisit;
      return phone() ? d.id === 'step3' : GAME_STEPS.includes(d.id);
    }
    if (own != null) return own;
    if (d.dataset.default === 'closed') return false;
    return OPEN_TIERS.includes(d.dataset.tier);
  };
  // For renderers that draw folds (recipe cards): the reader's choice, else the mode's default.
  const isOpen = (id, own) => {
    if (id in st.open) return !!st.open[id];
    return st.mode === 'study' ? true : !!own;
  };
  const folds = () => [...document.querySelectorAll('.sd-main details.sd-step, .sd-main details.sd-sec')];
  const apply = () => folds().forEach(d => { const id = idOf(d); d.open = id in st.open ? !!st.open[id] : modeDefault(d); });
  const closeAll = () => folds().forEach(d => { d.open = false; });

  const paintMode = () => {
    document.querySelectorAll('[data-fold-mode]').forEach(b => {
      const on = b.dataset.foldMode === st.mode;
      b.setAttribute('aria-pressed', on); b.classList.toggle('active', on);
    });
    const n = document.getElementById('sdModeNote');
    if (n) n.textContent = st.mode === 'study'
      ? 'Everything starts closed. Study opens every section: the evidence, the reference and the tools.'
      : 'Everything starts closed. Game day opens the answers and tools; Study opens everything.';
  };
  const setMode = mode => {
    st = { v: 1, mode, open: {} }; save(); apply(); paintMode();
    const S = window.BBI.showdown; if (S && S.render && S.data) S.render();   // recipe cards follow the mode
  };

  // Open every fold that holds el (el itself included when it is a fold).
  const openTo = el => {
    for (let d = el && el.closest ? el.closest('details') : null; d; d = d.parentElement && d.parentElement.closest('details')) {
      if (!d.open) { d.open = true; const id = idOf(d); if (id) st.open[id] = true; }
    }
    save();
  };

  // Record a reader's toggle from the summary click (before the default action flips it).
  const record = (d, open) => {
    const id = idOf(d); if (!id) return;
    st.open[id] = open;
    if (open && st.mode === 'game' && phone() && d.classList.contains('sd-step')) {
      folds().filter(x => x !== d && x.classList.contains('sd-step') && x.open).forEach(x => { x.open = false; st.open[idOf(x)] = false; });
    }
    save();
  };

  const bind = () => {
    document.addEventListener('click', e => {
      const m = e.target.closest('[data-fold-mode]'); if (m) { setMode(m.dataset.foldMode); return; }
      const all = e.target.closest('[data-fold-all]');
      if (all) { const open = all.dataset.foldAll === 'open'; folds().forEach(d => { d.open = open; const id = idOf(d); if (id) st.open[id] = open; }); save(); return; }
      const sum = e.target.closest('summary'); if (!sum) return;
      // Buttons and links inside a summary act on their own; they never toggle the fold.
      const ctl = e.target.closest('button, a, input, select, label');
      if (ctl && sum.contains(ctl)) { e.preventDefault(); return; }
      const d = sum.parentElement;
      if (d && d.tagName === 'DETAILS' && d.closest('.sd-main')) record(d, !d.open);
    }, true);
    // Keyboard toggles on a summary arrive as clicks, so record() sees them too.
    // Print everything, then put the folds back.
    let before = null;
    window.addEventListener('beforeprint', () => { before = [...document.querySelectorAll('.sd-main details')].map(d => [d, d.open]); before.forEach(([d]) => { d.open = true; }); });
    window.addEventListener('afterprint', () => { if (before) before.forEach(([d, o]) => { d.open = o; }); before = null; });
    // Dragging a file onto the page opens Score your own files, unless a drop zone is already on screen.
    document.addEventListener('dragenter', e => {
      const t = e.dataTransfer && [...(e.dataTransfer.types || [])];
      if (!t || !t.includes('Files')) return;
      const files = document.getElementById('files'); if (!files || files.open) return;
      const visible = [...document.querySelectorAll('.sd-main details[open] [data-dropzone], .sd-main details[open] .sd-drop')].some(z => {
        const r = z.getBoundingClientRect(); return r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
      });
      if (visible) return;
      openTo(files);
      files.scrollIntoView({ block: 'start', behavior: window.BBI.fx && window.BBI.fx.reduced() ? 'auto' : 'smooth' });
    });
  };

  // Summary lines: renderers hand over the answer for a fold.
  const ans = (key, html) => document.querySelectorAll(`[data-ans="${key}"]`).forEach(el => { if (el.innerHTML !== html) el.innerHTML = html; });

  // Every fold starts shut; a deep link (#dials, #step4 …) opens its own target via showdown.js.
  const init = () => { closeAll(); paintMode(); bind(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.BBI.showdownFolds = { openTo, isOpen, ans, setMode, get mode() { return st.mode; }, _test: { modeDefault, load, LS } };
})();
