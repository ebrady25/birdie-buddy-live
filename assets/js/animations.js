/* =====================================================================
   BIRDIEBUDDY — ANIMATIONS
   Number count-up, stagger observers, reveal-on-scroll, bar-fill reveal.
   ===================================================================== */

(() => {
  // ---------- COUNT-UP ----------
  // <span data-countup="74.15" data-decimals="2" data-prefix="" data-suffix="%"></span>
  const countUp = (node) => {
    if (node.dataset.countupDone) return;
    const to = parseFloat(node.dataset.countup);
    if (isNaN(to)) return;
    const decimals = parseInt(node.dataset.decimals || '0', 10);
    const prefix = node.dataset.prefix || '';
    const suffix = node.dataset.suffix || '';
    const dur = parseInt(node.dataset.dur || '700', 10);
    const start = performance.now();
    const from = 0;
    const ease = t => 1 - Math.pow(1 - t, 3);
    const step = now => {
      const t = Math.min(1, (now - start) / dur);
      const v = from + (to - from) * ease(t);
      node.textContent = `${prefix}${v.toFixed(decimals)}${suffix}`;
      if (t < 1) requestAnimationFrame(step);
      else node.dataset.countupDone = '1';
    };
    requestAnimationFrame(step);
  };
  window.countUp = countUp;

  // ---------- INTERSECTION-BASED TRIGGERS ----------
  // Defensive: IntersectionObserver may be unavailable in SSR/test envs.
  // Falls back to immediately activating all eligible nodes.
  const hasIO = typeof IntersectionObserver !== 'undefined';
  const activate = (node) => {
    if (node.hasAttribute && node.hasAttribute('data-countup')) countUp(node);
    if (node.classList && node.classList.contains('bar-fill') && node.dataset.to) {
      node.style.width = `${node.dataset.to}%`;
    }
    if (node.hasAttribute && node.hasAttribute('data-reveal')) node.classList.add('revealed');
  };
  const io = hasIO ? new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      activate(e.target);
      io.unobserve(e.target);
    });
  }, { threshold: 0.2, rootMargin: '0px 0px -40px 0px' }) : null;

  window.observeAnimations = (root = document) => {
    const targets = [
      ...$$('[data-countup]', root),
      ...$$('[data-reveal]', root),
      ...$$('.bar-fill[data-to]', root),
    ];
    if (io) targets.forEach(n => io.observe(n));
    else targets.forEach(activate);
  };

  // Reveal helpers via CSS: add default to base
  const style = document.createElement('style');
  style.textContent = `
    [data-reveal] { opacity: 0; transform: translateY(10px); transition: opacity 500ms cubic-bezier(0.22,1,0.36,1), transform 500ms cubic-bezier(0.22,1,0.36,1); }
    [data-reveal].revealed { opacity: 1; transform: none; }
    [data-reveal][data-delay="1"].revealed { transition-delay: 50ms; }
    [data-reveal][data-delay="2"].revealed { transition-delay: 100ms; }
    [data-reveal][data-delay="3"].revealed { transition-delay: 150ms; }
    [data-reveal][data-delay="4"].revealed { transition-delay: 200ms; }
    [data-reveal][data-delay="5"].revealed { transition-delay: 260ms; }
    [data-reveal][data-delay="6"].revealed { transition-delay: 320ms; }
  `;
  document.head.append(style);

  // Auto-run after DOM loaded
  document.addEventListener('DOMContentLoaded', () => window.observeAnimations(document));
})();
