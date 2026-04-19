/* ============================================================
   TERRA – dashboard.js
   Renders the overview dashboard page.
   ============================================================ */

const DashboardPage = (() => {

  /* ── Stat Cards Configuration ────────────────────────────── */
  const STAT_CARDS = [
    { label: 'Total Reports', meta: 'All time',        id: 'stat-total' },
    { label: 'Pending',       meta: 'Awaiting review', id: 'stat-pending' },
    { label: 'Validated',     meta: 'Confirmed sightings', id: 'stat-validated' },
    { label: 'Species',       meta: 'Unique tracked',  id: 'stat-species' },
  ];

  /* ── Internal: build stat cards ─────────────────────────── */
  function buildStatCards() {
    return STAT_CARDS.map((card, i) => `
      <div class="stat-card anim-fade-in-up anim-delay-${i + 1}" id="${card.id}">
        <div class="stat-card__label">${card.label}</div>
        <div class="stat-card__value skeleton" style="height:2.8rem;width:4rem;"></div>
        <div class="stat-card__meta">${card.meta}</div>
      </div>
    `).join('');
  }

  /* ── Internal: build recent reports table ────────────────── */
  function buildRecentTable() {
    const skeletonRow = `
      <tr>
        <td><span class="skeleton" style="display:inline-block;width:130px;height:13px;"></span></td>
        <td><span class="skeleton" style="display:inline-block;width:80px;height:13px;"></span></td>
        <td><span class="skeleton" style="display:inline-block;width:64px;height:13px;"></span></td>
        <td><span class="skeleton" style="display:inline-block;width:72px;height:18px;"></span></td>
      </tr>
    `;

    return `
      <div class="card anim-fade-in-up anim-delay-2">
        <div class="card__header">
          <div>
            <div class="card__title">Recent Reports</div>
            <div class="card__subtitle">Latest sightings submitted to Terra</div>
          </div>
          <button class="btn btn--secondary btn--sm" data-page="my-reports">View All</button>
        </div>
        <div class="table-wrap">
          <table class="data-table" id="recent-reports-table">
            <thead>
              <tr>
                <th>Species</th>
                <th>Region</th>
                <th>Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="recent-tbody">
              ${Array(5).fill(skeletonRow).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  /* ── Internal: AI confidence panel skeleton ──────────────── */
  function buildConfidencePanel() {
    return `
      <div class="card anim-fade-in-up anim-delay-3">
        <div class="card__header">
          <div>
            <div class="card__title">AI Confidence Overview</div>
            <div class="card__subtitle">Score distribution across all processed reports</div>
          </div>
          <span class="live-dot" title="Derived from live report data"></span>
        </div>
        <div id="ai-confidence-content">
          <div class="skeleton" style="height:14px;width:180px;margin-bottom:var(--sp-3);"></div>
          <div class="skeleton" style="height:6px;width:100%;margin-bottom:var(--sp-5);"></div>
          <div class="skeleton" style="height:10px;width:100%;margin-bottom:var(--sp-3);"></div>
          <div class="skeleton" style="height:10px;width:75%;margin-bottom:var(--sp-3);"></div>
          <div class="skeleton" style="height:10px;width:50%;"></div>
        </div>
      </div>
    `;
  }

  /* ── Internal: confidence distribution row ───────────────── */
  function confRow(label, count, pct, color) {
    return `
      <div style="display:grid;grid-template-columns:72px 1fr 90px;align-items:center;gap:var(--sp-3);">
        <span style="font-family:var(--font-mono);font-size:var(--text-xs);color:${color};letter-spacing:.06em;">${label}</span>
        <div style="height:5px;background:var(--clr-border);overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${color};transition:width .8s ease;"></div>
        </div>
        <span style="font-family:var(--font-mono);font-size:var(--text-xs);color:var(--clr-text-muted);text-align:right;">${count} &middot; ${pct}%</span>
      </div>
    `;
  }

  /* ── Internal: populate AI confidence section ────────────── */
  function populateConfidence(stats) {
    const el = document.getElementById('ai-confidence-content');
    if (!el) return;

    const { total, avg_confidence, conf_high, conf_medium, conf_low } = stats;

    if (!total) {
      el.innerHTML = `
        <p style="color:var(--clr-text-muted);font-size:var(--text-sm);font-family:var(--font-mono);">
          No reports processed yet.
        </p>`;
      return;
    }

    const pct = (n) => total ? Math.round((n / total) * 100) : 0;
    const hPct = pct(conf_high), mPct = pct(conf_medium), lPct = pct(conf_low);
    const score = avg_confidence || 0;
    const scoreColor = score >= 70 ? 'var(--clr-brand)' : score >= 40 ? '#f59e0b' : 'var(--clr-danger)';

    el.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:var(--sp-5);">

        <!-- Average score -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:var(--sp-2);">
            <span style="font-family:var(--font-mono);font-size:var(--text-xs);color:var(--clr-text-muted);letter-spacing:.08em;">
              AVG CONFIDENCE SCORE
            </span>
            <span style="font-family:var(--font-mono);font-size:1.9rem;font-weight:700;color:${scoreColor};line-height:1;">
              ${score}<span style="font-size:var(--text-sm);opacity:.55;">%</span>
            </span>
          </div>
          <div style="height:4px;background:var(--clr-border);overflow:hidden;">
            <div style="height:100%;width:${score}%;background:${scoreColor};transition:width .7s ease;"></div>
          </div>
        </div>

        <!-- Distribution -->
        <div style="display:flex;flex-direction:column;gap:var(--sp-3);">
          ${confRow('HIGH  ≥70', conf_high,  hPct, 'var(--clr-brand)')}
          ${confRow('MED  40–69', conf_medium, mPct, '#f59e0b')}
          ${confRow('LOW   <40', conf_low,   lPct, 'var(--clr-danger)')}
        </div>

        <!-- Footer meta -->
        <div style="font-family:var(--font-mono);font-size:var(--text-xs);color:var(--clr-text-dim);border-top:1px solid var(--clr-border);padding-top:var(--sp-3);letter-spacing:.04em;">
          POPULATION: ${total} report${total !== 1 ? 's' : ''} &nbsp;·&nbsp; ENGINE: Terra Core Heuristics v1.0
        </div>
      </div>
    `;
  }

  /* ── Public: render ──────────────────────────────────────── */
  function render(container) {
    container.innerHTML = `
      <div class="page-header anim-fade-in">
        <h1>Dashboard</h1>
        <p>Welcome back. Here's what's happening across Terra today.</p>
      </div>

      <!-- Stats Grid -->
      <div class="grid-4">
        ${buildStatCards()}
      </div>

      <!-- Recent Reports -->
      <div class="mt-6">${buildRecentTable()}</div>

      <!-- AI Confidence -->
      <div class="mt-6">${buildConfidencePanel()}</div>
    `;

    container.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', () => Router.navigate(btn.dataset.page));
    });

    loadData();
  }

  /* ── Internal: fetch stats + recent reports ──────────────── */
  async function loadData() {
    try {
      const [stats, recent] = await Promise.all([
        API.get('/reports/stats'),
        API.get('/reports?limit=5'),
      ]);

      populateStats(stats);
      populateConfidence(stats);
      populateRecentTable(recent);
    } catch (err) {
      console.error('[Dashboard] Load error:', err);
      // Degrade gracefully — clear skeletons
      STAT_CARDS.forEach(card => {
        const el = document.getElementById(card.id);
        if (!el) return;
        const val = el.querySelector('.stat-card__value');
        if (val) { val.classList.remove('skeleton'); val.textContent = '—'; }
      });
      const confEl = document.getElementById('ai-confidence-content');
      if (confEl) confEl.innerHTML = `<p style="color:var(--clr-text-muted);font-size:var(--text-sm);font-family:var(--font-mono);">Failed to load data.</p>`;
    }
  }

  /* ── Internal: populate stat values ─────────────────────── */
  function populateStats(stats) {
    const values = [stats.total, stats.pending, stats.validated, stats.species_count];
    values.forEach((v, i) => {
      const el = document.getElementById(STAT_CARDS[i].id);
      if (!el) return;
      const val = el.querySelector('.stat-card__value');
      if (val) { val.classList.remove('skeleton'); val.style = ''; val.textContent = v ?? '—'; }
    });
  }

  /* ── Internal: populate recent table ────────────────────── */
  function populateRecentTable(reports) {
    const tbody = document.getElementById('recent-tbody');
    if (!tbody) return;

    if (!reports.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align:center;color:var(--clr-text-muted);font-family:var(--font-mono);font-size:var(--text-xs);">
            No reports yet.
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = reports.slice(0, 5).map(r => `
      <tr>
        <td>${r.species_name || 'Unknown Species'}</td>
        <td style="font-family:var(--font-mono);font-size:var(--text-xs);color:var(--clr-text-muted);">${r.region_id?.slice(0, 20) || '—'}</td>
        <td style="font-family:var(--font-mono);font-size:var(--text-xs);color:var(--clr-text-muted);">${new Date(r.created_at).toLocaleDateString()}</td>
        <td><span class="badge badge--${(r.validation_status || 'pending').toLowerCase()}">${r.validation_status}</span></td>
      </tr>
    `).join('');
  }

  return { render };
})();
