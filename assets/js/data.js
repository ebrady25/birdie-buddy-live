/* =====================================================================
   BIRDIEBUDDY — DATA LOADER
   Fetches /data/*.json with a memory cache and graceful errors.
   Also exposes BBI.currentEvent + helpers every page relies on.
   ===================================================================== */

window.BBI = window.BBI || {};

(() => {
  const cache = new Map();

  const load = async (path) => {
    if (cache.has(path)) return cache.get(path);
    try {
      const res = await fetch(path, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      cache.set(path, json);
      return json;
    } catch (e) {
      console.warn(`[data] failed: ${path}`, e);
      cache.set(path, null);
      return null;
    }
  };

  const loadMany = async (paths) => {
    const entries = await Promise.all(paths.map(async ([key, path]) => [key, await load(path)]));
    return Object.fromEntries(entries);
  };

  window.BBI.data = {
    load,
    loadMany,
    paths: {
      currentEvent:   './data/current_event.json',
      bbiRankings:    './data/bbi_rankings.json',
      dfsLineups:     './data/dfs_lineups.json',
      themis:         './data/themis.json',
      omnia:          './data/omnia.json',
      persephone:     './data/persephone.json',
      shadowModels:   './data/shadow_models.json',
      spearman:       './data/spearman_tracker.json',
      calibration:    './data/calibration_tracker.json',
      modelCompetition: './data/model_competition.json',
      prometheus:     './data/prometheus_backtest.json',
      archiveIndex:   './data/archive_index.json',
      athenaPool:     './data/athena_pool.json',
      nikeBankroll:   './data/nike_bankroll.json',
      changelog:      './data/changelog.json',
      performanceWeeklyRecaps: './data/performance_weekly_recaps.json',
      performanceAttribution: './data/performance_attribution.json',
      playerLookup:   './data/player_lookup.json',
      playerCourseHistory: './data/player_course_history.json',
      playerRecentForm: './data/player_recent_form.json',
      playerPressureMetrics: './data/player_pressure_metrics.json',
      tourSgBaselines: './data/tour_sg_baselines.json',
      courseLibrary:  './data/course_library.json'
    }
  };

  // ---------- HEADER: shared nav + status bar ----------
  window.BBI.renderHeader = async (activeKey) => {
    const mount = document.getElementById('site-header');
    if (!mount) return;

    const current = await load(BBI.data.paths.currentEvent);
    const spear   = await load(BBI.data.paths.spearman);

    const eventName = current?.event_name || current?.event || 'Live Event';
    const week = current?.week_num ? `Week ${current.week_num}` : '';
    const lastUpdated = current?.last_updated || current?.generated_at;

    // Marquee ticker content
    const edges = (await load(BBI.data.paths.omnia))?.markets?.win?.top_10_edges || [];
    const persephone = await load(BBI.data.paths.persephone);
    const tickerItems = [];
    edges.slice(0, 6).forEach(e => {
      const name = fmt.abbrevName(e.name);
      const pp = e.edge_consensus_pp;
      tickerItems.push(`<span><strong>${name}</strong> <span class="up">+${pp?.toFixed(2)}pp</span> market edge</span>`);
    });
    const movers = persephone?.sections?.probability_shifts?.top_10_movers || [];
    movers.slice(0, 4).forEach(m => {
      const name = fmt.abbrevName(m.name);
      const shift = m.win_shift_pp;
      const cls = shift >= 0 ? 'up' : 'down';
      tickerItems.push(`<span><strong>${name}</strong> <span class="${cls}">${shift >= 0 ? '↑' : '↓'} ${Math.abs(shift).toFixed(1)}pp</span> live</span>`);
    });
    if (!tickerItems.length) {
      tickerItems.push(
        `<span><strong>BBI v8.5</strong> — 10-factor predictive engine</span>`,
        `<span><strong>15 agents</strong> running Monday through Sunday</span>`,
        `<span><strong>DataGolf</strong> · 26 endpoints · 10k Monte Carlo simulations</span>`
      );
    }

    // Shadow leader
    const shadow = await load(BBI.data.paths.shadowModels);
    const leader = shadow?.variants ? Object.entries(shadow.variants).reduce((acc, [k, v]) =>
      (acc == null || (v.spearman_vs_baseline_top20 || 0) > (acc[1].spearman_vs_baseline_top20 || 0)) ? [k, v] : acc, null) : null;

    // Grouped nav: top-level flat items + dropdown groups.
    // Each group has: label, items[{href, label, sub?}].
    // Flat items are rendered as .nav-link; groups as .nav-group with .nav-group-menu.
    const navSchema = [
      { type: 'group', id: 'predict', label: 'Predict', items: [
        { href: 'rankings.html',   label: 'Rankings',    sub: 'Full field' },
        { href: 'compare.html',    label: 'Compare',     sub: 'Head-to-head' },
        { href: 'lineups.html',    label: 'DFS Lineups', sub: '12 optimized' },
        { href: 'live.html',       label: 'Live pivots', sub: 'Thu–Sun' },
        { href: 'simulator.html',  label: 'Simulator',   sub: '10k Monte Carlo' }
      ]},
      { type: 'group', id: 'measure', label: 'Measure', items: [
        { href: 'performance.html', label: 'Performance', sub: 'Season report card' },
        { href: 'recap.html',       label: 'Event recaps', sub: 'Weekly grade' },
        { href: 'archive.html',     label: 'Archive',      sub: '47 scored events' },
        { href: 'methodology.html', label: 'Methodology',  sub: 'How BBI scores' }
      ]},
      { type: 'link', href: 'courses.html', label: 'Courses' },
      { type: 'link', href: 'market.html',  label: 'Market' }
    ];

    mount.innerHTML = `
      <nav class="site-nav">
        <div class="site-nav-inner">
          <a href="index.html" class="brand">
            <span class="brand-mark">B</span>
            <span class="brand-lockup">
              BirdieBuddy
              <small>PANTHEON · v8.5</small>
            </span>
          </a>
          <div class="nav-links" id="navLinks">
            ${navSchema.map(entry => {
              if (entry.type === 'link') {
                const isActive = activeKey === entry.href;
                return `
                  <a class="nav-link ${isActive ? 'active' : ''}" href="${entry.href}">
                    ${entry.label}
                  </a>`;
              }
              // group
              const anyActive = entry.items.some(it => activeKey === it.href);
              return `
                <div class="nav-group" data-group="${entry.id}" aria-expanded="false">
                  <button type="button" class="nav-group-trigger ${anyActive ? 'has-active' : ''}" aria-haspopup="true" aria-expanded="false">
                    ${entry.label}
                    <svg class="nav-group-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 5l3 3 3-3" stroke-linecap="round"/></svg>
                  </button>
                  <div class="nav-group-menu" role="menu">
                    ${entry.items.map(it => {
                      const isActive = activeKey === it.href;
                      return `
                        <a class="nav-group-item ${isActive ? 'active' : ''}" href="${it.href}" role="menuitem">
                          <span style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
                            <span>${it.label}</span>
                            ${it.sub ? `<span class="item-sub">${it.sub}</span>` : ''}
                          </span>
                        </a>`;
                    }).join('')}
                  </div>
                </div>`;
            }).join('')}
          </div>
          <div class="row-tight">
            <label class="search-input" title="Search (⌘K)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input type="text" placeholder="Search players…" data-search aria-label="Search"/>
              <span class="kbd">⌘K</span>
            </label>
            <span class="event-pill">
              <span class="pulse-dot"></span>
              <strong>${eventName}</strong>${week ? ` · ${week}` : ''}
            </span>
          </div>
        </div>
      </nav>
      <div class="status-bar">
        <div class="status-bar-inner">
          <span class="status-item" title="ARGUS preflight system">
            <span class="status-dots">
              <span class="status-dot green"></span>
              <span class="status-dot green"></span>
              <span class="status-dot green"></span>
              <span class="status-dot green"></span>
              <span class="status-dot green"></span>
            </span>
            <span>ARGUS</span>
          </span>
          <span class="status-item"><strong>${current?.course || 'Harbour Town Golf Links'}</strong></span>
          <span class="status-item">Model <strong>v8.5</strong></span>
          ${leader ? `<span class="status-item">Shadow leader <strong class="gold">${leader[0]}</strong> ρ=${(leader[1].spearman_vs_baseline_top20 || 0).toFixed(2)}</span>` : ''}
          <div class="marquee"><div class="marquee-track" id="tickerTrack"></div></div>
          <span class="status-item">${lastUpdated ? 'Updated ' + fmt.ago(lastUpdated) : 'Live'}</span>
        </div>
      </div>
    `;

    // Fill marquee with seamless duplicated track
    const track = document.getElementById('tickerTrack');
    if (track) {
      const html = tickerItems.map(t => `<span class="marquee-item">${t}</span>`).join('');
      track.innerHTML = html + html;
    }

    // ---------- Nav group dropdown interactions ----------
    const groups = document.querySelectorAll('.nav-group');
    if (!groups.length) return;

    const closeAllGroups = (except) => {
      groups.forEach(g => {
        if (g !== except) {
          g.setAttribute('aria-expanded', 'false');
          g.querySelector('.nav-group-trigger')?.setAttribute('aria-expanded', 'false');
        }
      });
    };

    const openGroup = (g) => {
      g.setAttribute('aria-expanded', 'true');
      g.querySelector('.nav-group-trigger')?.setAttribute('aria-expanded', 'true');
    };

    const isTouch = typeof window.matchMedia === 'function'
      ? window.matchMedia('(hover: none), (max-width: 880px)').matches
      : false;

    groups.forEach(g => {
      const trigger = g.querySelector('.nav-group-trigger');
      if (!trigger) return;

      // Desktop: hover opens, leave closes (with short delay so user can move to menu)
      let leaveTimer = null;
      const onEnter = () => {
        if (isTouch) return;
        clearTimeout(leaveTimer);
        closeAllGroups(g);
        openGroup(g);
      };
      const onLeave = () => {
        if (isTouch) return;
        leaveTimer = setTimeout(() => {
          g.setAttribute('aria-expanded', 'false');
          trigger.setAttribute('aria-expanded', 'false');
        }, 180);
      };
      g.addEventListener('mouseenter', onEnter);
      g.addEventListener('mouseleave', onLeave);

      // Click / keyboard (touch + a11y): toggle
      trigger.addEventListener('click', (e) => {
        e.preventDefault();
        const isOpen = g.getAttribute('aria-expanded') === 'true';
        closeAllGroups();
        if (!isOpen) openGroup(g);
      });

      // Keyboard: Escape closes; ArrowDown opens + focuses first item
      trigger.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          g.setAttribute('aria-expanded', 'false');
          trigger.setAttribute('aria-expanded', 'false');
          trigger.blur();
        } else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          closeAllGroups();
          openGroup(g);
          g.querySelector('.nav-group-item')?.focus();
        }
      });

      // Arrow navigation within menu
      g.querySelectorAll('.nav-group-item').forEach((item, idx, arr) => {
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            g.setAttribute('aria-expanded', 'false');
            trigger.setAttribute('aria-expanded', 'false');
            trigger.focus();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            arr[(idx + 1) % arr.length].focus();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            arr[(idx - 1 + arr.length) % arr.length].focus();
          }
        });
      });
    });

    // Click outside closes any open group
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.nav-group')) closeAllGroups();
    });

    // Escape from anywhere closes
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAllGroups();
    });
  };

  // ---------- FOOTER ----------
  window.BBI.renderFooter = async () => {
    const mount = document.getElementById('site-footer');
    if (!mount) return;
    const current = await load(BBI.data.paths.currentEvent);
    const updated = current?.last_updated || current?.generated_at;
    mount.innerHTML = `
      <footer class="site-footer">
        <div class="site-footer-inner">
          <div>
            <a href="index.html" class="brand">
              <span class="brand-mark">B</span>
              <span class="brand-lockup">BirdieBuddy<small>PANTHEON · v8.5</small></span>
            </a>
            <p class="muted" style="margin-top: var(--space-3); font-size: var(--fs-xs); line-height: 1.6; max-width: 42ch;">
              A 15-agent predictive engine for PGA Tour tournaments.
              BBI scores every player across 10 factors, simulates 10k tournaments per event,
              and surfaces +EV mispricings against 15 live sportsbooks.
            </p>
          </div>
          <div>
            <div class="footer-heading">Predictions</div>
            <div class="footer-links">
              <a class="footer-link" href="rankings.html">Live Rankings</a>
              <a class="footer-link" href="lineups.html">DFS Lineups</a>
              <a class="footer-link" href="simulator.html">THEMIS Simulator</a>
              <a class="footer-link" href="market.html">Market Edges</a>
              <a class="footer-link" href="live.html">Live Pivot</a>
            </div>
          </div>
          <div>
            <div class="footer-heading">Model</div>
            <div class="footer-links">
              <a class="footer-link" href="performance.html">Performance</a>
              <a class="footer-link" href="performance.html#shadow">Shadow Models</a>
              <a class="footer-link" href="performance.html#calibration">Calibration</a>
              <a class="footer-link" href="methodology.html">Methodology</a>
              <a class="footer-link" href="archive.html">Archive</a>
            </div>
          </div>
          <div>
            <div class="footer-heading">System</div>
            <div class="footer-links">
              <span class="footer-link"><span class="pulse-dot"></span> 15 agents nominal</span>
              <span class="footer-link">Tour-wide data · 26 endpoints</span>
              <span class="footer-link">10,000 sims / event</span>
              <span class="footer-link">Updated ${updated ? fmt.ago(updated) : 'Live'}</span>
            </div>
          </div>
        </div>
        <div class="footer-credit">
          <span>© 2026 BirdieBuddy · Built by Ethan Brady</span>
          <span>BBI v8.5 · Pantheon Pro · Private preview</span>
        </div>
      </footer>
    `;
  };
})();
