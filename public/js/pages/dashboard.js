/* ============================================================
   TERRA – dashboard.js
   Renders the overview dashboard page.
   ============================================================ */

const DashboardPage = (() => {

    /* ── Stat Cards Configuration ────────────────────────────── */
    /* To add a new stat, add an object here. No HTML edits needed. */
    const STAT_CARDS = [
        { label: 'Total Reports', value: '—', icon: '📋', meta: 'All time', id: 'stat-total' },
        { label: 'Pending Validation', value: '—', icon: '⏳', meta: 'Awaiting review', id: 'stat-pending' },
        { label: 'Validated Today', value: '—', icon: '✅', meta: 'This session', id: 'stat-validated' },
        { label: 'Species Tracked', value: '—', icon: '🦏', meta: 'Unique species', id: 'stat-species' },
    ];

    /* ── Internal: build stat cards ──────────────────────────── */
    function buildStatCards() {
        return STAT_CARDS.map(card => `
      <div class="stat-card anim-fade-in-up" id="${card.id}">
        <div class="stat-card__icon">${card.icon}</div>
        <div class="stat-card__label">${card.label}</div>
        <div class="stat-card__value skeleton" style="height:2.2rem;width:5rem;"></div>
        <div class="stat-card__meta">${card.meta}</div>
      </div>
    `).join('');
    }

    /* ── Internal: build recent reports table (skeleton) ─────── */
    function buildRecentTableSkeleton() {
        const rows = Array(5).fill(`
      <tr>
        <td><span class="skeleton" style="display:inline-block;width:120px;height:14px;"></span></td>
        <td><span class="skeleton" style="display:inline-block;width:80px;height:14px;"></span></td>
        <td><span class="skeleton" style="display:inline-block;width:60px;height:14px;"></span></td>
        <td><span class="skeleton" style="display:inline-block;width:70px;height:20px;border-radius:9999px;"></span></td>
      </tr>
    `).join('');

        return `
      <div class="card mt-8 anim-fade-in-up" style="animation-delay:0.15s">
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
            <tbody id="recent-tbody">${rows}</tbody>
          </table>
        </div>
      </div>
    `;
    }

    /* ── Internal: build AI confidence summary ───────────────── */
    function buildConfidencePanel() {
        return `
      <div class="card mt-6 anim-fade-in-up" style="animation-delay:0.25s">
        <div class="card__header">
          <div>
            <div class="card__title">AI Confidence Overview</div>
            <div class="card__subtitle">Average score across pending reports</div>
          </div>
          <span class="live-dot" title="Real-time"></span>
        </div>
        <div id="ai-confidence-content" style="color:var(--clr-text-muted);font-size:var(--text-sm);">
          Awaiting data…
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

      <!-- Recent Reports Table -->
      ${buildRecentTableSkeleton()}

      <!-- AI Confidence Panel -->
      ${buildConfidencePanel()}
    `;

        // Wire up "View All" button
        container.querySelectorAll('[data-page]').forEach(btn => {
            btn.addEventListener('click', () => Router.navigate(btn.dataset.page));
        });

        // Fetch live data
        loadStats();
    }

    /* ── Internal: load live stat data from API ──────────────── */
    async function loadStats() {
        try {
            const reports = await API.get('/reports?limit=5');
            populateStats(reports);
            populateRecentTable(reports);
        } catch (err) {
            // Silently degrade — show dashes instead of skeleton
            STAT_CARDS.forEach(card => {
                const el = document.getElementById(card.id);
                if (el) {
                    const val = el.querySelector('.stat-card__value');
                    if (val) { val.classList.remove('skeleton'); val.textContent = '—'; }
                }
            });
        }
    }

    /* ── Internal: fill stat card values ────────────────────── */
    function populateStats(reports) {
        const total = reports.length;
        const pending = reports.filter(r => r.validation_status === 'PENDING').length;
        const validated = reports.filter(r => r.validation_status === 'VALIDATED').length;
        const species = new Set(reports.map(r => r.species_id).filter(Boolean)).size;

        const values = [total, pending, validated, species];
        STAT_CARDS.forEach((card, i) => {
            const el = document.getElementById(card.id);
            if (el) {
                const val = el.querySelector('.stat-card__value');
                if (val) { val.classList.remove('skeleton'); val.style = ''; val.textContent = values[i]; }
            }
        });
    }

    /* ── Internal: fill recent reports table ────────────────── */
    function populateRecentTable(reports) {
        const tbody = document.getElementById('recent-tbody');
        if (!tbody) return;

        if (reports.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--clr-text-muted)">No reports yet.</td></tr>`;
            return;
        }

        tbody.innerHTML = reports.slice(0, 5).map(r => `
      <tr>
        <td>${r.species_name || 'Unknown Species'}</td>
        <td>${r.region_id?.slice(0, 8) || '—'}</td>
        <td>${new Date(r.created_at).toLocaleDateString()}</td>
        <td><span class="badge badge--${(r.validation_status || 'pending').toLowerCase()}">${r.validation_status}</span></td>
      </tr>
    `).join('');
    }

    return { render };
})();
