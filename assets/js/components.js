/* =====================================================================
   BIRDIEBUDDY — COMPONENT JS
   Sortable tables, filter chips, tabs, hover player cards, sparklines.
   ===================================================================== */

(() => {
  // ---------- SORTABLE TABLE ----------
  // Usage: <table data-sortable> <th data-sort="key" data-type="num|text"> ... </th>
  // Rows must carry data-{key} attrs OR cells must be in column order.
  window.makeSortable = (table, opts = {}) => {
    if (!table) return;
    const ths = $$('thead th[data-sort]', table);
    const tbody = $('tbody', table);
    let sortKey = opts.defaultSort || null;
    let sortDir = opts.defaultDir || 'desc';

    const apply = () => {
      const rows = $$('tbody > tr[data-row]', table);
      const get = (row, key) => {
        const v = row.dataset[key];
        if (v === undefined) return null;
        const n = parseFloat(v);
        return isNaN(n) ? v : n;
      };
      rows.sort((a, b) => {
        const va = get(a, sortKey);
        const vb = get(b, sortKey);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        const cmp = (typeof va === 'number' && typeof vb === 'number')
          ? va - vb
          : String(va).localeCompare(String(vb));
        return sortDir === 'asc' ? cmp : -cmp;
      });
      // Reattach in new order, also re-attach any expansion rows belonging to each row
      const expansions = new Map();
      $$('tbody > tr.table-row-expand', table).forEach(r => {
        const owner = r.previousElementSibling;
        if (owner) expansions.set(owner, r);
      });
      rows.forEach(r => {
        tbody.appendChild(r);
        const ex = expansions.get(r);
        if (ex) tbody.appendChild(ex);
      });
      // header arrows
      ths.forEach(th => {
        th.classList.toggle('sorted', th.dataset.sort === sortKey);
        th.classList.toggle('asc', th.dataset.sort === sortKey && sortDir === 'asc');
      });
    };

    ths.forEach(th => {
      th.classList.add('sortable');
      th.addEventListener('click', () => {
        const k = th.dataset.sort;
        if (sortKey === k) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        else { sortKey = k; sortDir = th.dataset.type === 'text' ? 'asc' : 'desc'; }
        apply();
      });
    });

    if (sortKey) apply();
    return { sort: (k, dir) => { sortKey = k; sortDir = dir || 'desc'; apply(); } };
  };

  // ---------- FILTER CHIPS ----------
  // Usage: <div data-chips data-target="#tableSel"> <button class="chip" data-filter="all">…</button> ...
  // Rows must carry data-tier or matching data attribute named in data-key (default 'tier').
  window.makeChips = (group, opts = {}) => {
    if (!group) return;
    const key = group.dataset.key || 'tier';
    const target = group.dataset.target ? document.querySelector(group.dataset.target) : null;
    const chips = $$('.chip', group);
    let active = opts.default || 'all';

    const apply = () => {
      chips.forEach(c => c.setAttribute('aria-pressed', c.dataset.filter === active));
      if (!target) return;
      $$('tr[data-row]', target).forEach(row => {
        const v = (row.dataset[key] || '').toLowerCase();
        const want = active.toLowerCase();
        const show = (active === 'all') || v === want;
        row.style.display = show ? '' : 'none';
        const ex = row.nextElementSibling;
        if (ex && ex.classList.contains('table-row-expand')) ex.style.display = show ? ex.style.display : 'none';
      });
      if (typeof opts.onChange === 'function') opts.onChange(active);
    };

    chips.forEach(c => c.addEventListener('click', () => { active = c.dataset.filter; apply(); }));
    apply();
    return { set: v => { active = v; apply(); } };
  };

  // ---------- SEARCH ----------
  window.makeSearch = (input, opts = {}) => {
    if (!input) return;
    const target = opts.target || (input.dataset.target && document.querySelector(input.dataset.target));
    const fields = (opts.fields || (input.dataset.fields || 'name').split(',')).map(s => s.trim());
    const apply = () => {
      const q = input.value.trim().toLowerCase();
      $$('tr[data-row]', target).forEach(row => {
        if (!q) { row.style.display = ''; return; }
        const hay = fields.map(f => (row.dataset[f] || '')).join(' ').toLowerCase();
        const show = hay.includes(q);
        row.style.display = show ? '' : 'none';
        const ex = row.nextElementSibling;
        if (ex && ex.classList.contains('table-row-expand') && !show) ex.style.display = 'none';
      });
    };
    input.addEventListener('input', apply);
  };

  // ---------- TABS ----------
  // Usage: <div data-tabs> <button class="tab" data-tab="id"> ... </div>
  //        <div data-panels> <div data-panel="id">...</div> ... </div>
  window.makeTabs = (group, panelsRoot, opts = {}) => {
    if (!group) return;
    const tabs = $$('.tab', group);
    const set = id => {
      tabs.forEach(t => t.setAttribute('aria-selected', t.dataset.tab === id));
      $$('[data-panel]', panelsRoot || document).forEach(p => p.classList.toggle('hidden', p.dataset.panel !== id));
      if (typeof opts.onChange === 'function') opts.onChange(id);
    };
    tabs.forEach(t => t.addEventListener('click', () => set(t.dataset.tab)));
    set(opts.default || (tabs[0] && tabs[0].dataset.tab));
    return { set };
  };

  // ---------- SPARKLINE BUILDER ----------
  // values: array of numbers; w/h optional; returns SVG element.
  window.makeSparkline = (values, opts = {}) => {
    const w = opts.w || 96;
    const h = opts.h || 28;
    const stroke = opts.stroke || 'var(--gold-500)';
    const fillId = opts.fillId || `spark-grad-${Math.random().toString(36).slice(2, 7)}`;
    const showDot = opts.dot !== false;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.classList.add('sparkline');

    const defs = document.createElementNS(svgNS, 'defs');
    const grad = document.createElementNS(svgNS, 'linearGradient');
    grad.setAttribute('id', fillId);
    grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
    const stop1 = document.createElementNS(svgNS, 'stop');
    stop1.setAttribute('offset', '0%'); stop1.setAttribute('stop-color', stroke); stop1.setAttribute('stop-opacity', '0.5');
    const stop2 = document.createElementNS(svgNS, 'stop');
    stop2.setAttribute('offset', '100%'); stop2.setAttribute('stop-color', stroke); stop2.setAttribute('stop-opacity', '0');
    grad.append(stop1, stop2);
    defs.append(grad);
    svg.append(defs);

    if (!values || values.length < 2) {
      const t = document.createElementNS(svgNS, 'line');
      t.setAttribute('x1', 0); t.setAttribute('y1', h / 2);
      t.setAttribute('x2', w); t.setAttribute('y2', h / 2);
      t.setAttribute('stroke', 'var(--text-faint)'); t.setAttribute('stroke-dasharray', '2 3');
      svg.append(t);
      return svg;
    }
    const lo = Math.min(...values), hi = Math.max(...values);
    const span = (hi - lo) || 1;
    const pad = 2;
    const stepX = (w - pad * 2) / (values.length - 1);
    const pts = values.map((v, i) => [pad + i * stepX, h - pad - ((v - lo) / span) * (h - pad * 2)]);
    const linePath = pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ');
    const fillPath = `${linePath} L ${(w - pad).toFixed(2)} ${h - pad} L ${pad} ${h - pad} Z`;

    const fill = document.createElementNS(svgNS, 'path');
    fill.setAttribute('d', fillPath);
    fill.setAttribute('fill', `url(#${fillId})`);
    svg.append(fill);

    const line = document.createElementNS(svgNS, 'path');
    line.setAttribute('d', linePath);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', stroke);
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('stroke-linecap', 'round');
    svg.append(line);

    if (showDot) {
      const last = pts[pts.length - 1];
      const dot = document.createElementNS(svgNS, 'circle');
      dot.setAttribute('cx', last[0]); dot.setAttribute('cy', last[1]);
      dot.setAttribute('r', '2.5'); dot.setAttribute('fill', stroke);
      svg.append(dot);
    }
    return svg;
  };

  // ---------- INLINE FACTOR DECOMPOSITION ----------
  // factors: { label: value } or array of {key, value}
  window.makeFactorBars = (factors, opts = {}) => {
    const arr = Array.isArray(factors) ? factors : Object.entries(factors).map(([key, value]) => ({ key, value }));
    const max = Math.max(...arr.map(f => Math.abs(f.value)), 1);
    const root = el('div', { class: 'factor-bars' });
    arr.forEach(f => {
      const w = (Math.abs(f.value) / max) * 100;
      root.append(el('div', { class: 'factor-row' },
        el('div', { class: 'factor-label' }, f.key),
        el('div', { class: 'bar bar-thin' },
          el('div', { class: 'bar-fill', style: { width: `${w}%` } })
        ),
        el('div', { class: 'factor-value' }, fmt.num(f.value, 1))
      ));
    });
    return root;
  };
})();
