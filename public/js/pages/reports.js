/* ============================================================
   TERRA – reports.js
   Renders the reports list for My Reports, Pending Queue, Validated.
   Controlled by the `mode` parameter passed during render().
   ============================================================ */

const ReportsPage = (() => {

  /* ── Column Configuration ────────────────────────────────── */
  const COLUMNS = ['Species', 'Region', 'Tier', 'Date', 'Confidence', 'Status', 'Actions'];

  /* ── Internal: column cells for a single row ─────────────── */
  function buildRowCells(report, mode) {
    const date = new Date(report.created_at).toLocaleDateString();
    const status = report.validation_status || 'PENDING';
    const tier = report.sensitivity_tier || 1;

    // Technical Confidence Score
    const score = report.ai_confidence_score != null
      ? `<span class="tech-value tech-value--brand">${Number(report.ai_confidence_score).toFixed(1)}%</span>`
      : '—';

    // Show validate/reject buttons only in pending mode
    const actions = (mode === 'pending' && Auth.hasPermission('validate_report'))
      ? `<button class="btn btn--primary btn--sm" data-action="validate" data-id="${report.report_id}">VALIDATE</button>
         <button class="btn btn--danger btn--sm" data-action="reject"   data-id="${report.report_id}">REJECT</button>`
      : `<button class="btn btn--secondary btn--sm" data-action="view" data-id="${report.report_id}">View</button>`;

    return `
      <td class="tech-label">${report.species_name || 'Unknown Species'}</td>
      <td class="tech-meta">${report.region_id || 'Global Sector'}</td>
      <td><span class="badge badge--tier-${tier}">Tier ${tier}</span></td>
      <td class="tech-meta">${date}</td>
      <td>${score}</td>
      <td><span class="badge badge--${status.toLowerCase()}">${status}</span></td>
      <td style="display:flex;gap:var(--sp-2);">${actions}</td>
    `;
  }

  /* ── Internal: build full HTML including filters + table ──── */
  function buildPageHTML(mode) {
    const titles = { 'my-reports': 'My Reports', pending: 'Pending Queue', validated: 'Validated Reports' };
    const subtitles = { 'my-reports': 'All reports you have submitted.', pending: 'Reports awaiting ranger validation.', validated: 'Reports marked as verified.' };

    const colHeaders = COLUMNS.map(c => `<th>${c}</th>`).join('');
    const skeleton = Array(6).fill(`<tr>${COLUMNS.map(() => '<td><span class="skeleton" style="display:inline-block;width:80%;height:14px;"></span></td>').join('')}</tr>`).join('');

    return `
      <div class="page-header anim-fade-in">
        <h1 class="tech-header">${titles[mode] || 'Reports'}</h1>
        <p>${subtitles[mode] || ''}</p>
      </div>

      <!-- Filters Bar -->
      <div class="card mb-6 anim-fade-in-up table-tactical-controls">
        <div style="display:flex;gap:var(--sp-4);align-items:center;flex-wrap:wrap;">
          <div class="form-group" style="flex:1;min-width:180px;">
            <label class="form-label" for="filter-status">Filter by Status</label>
            <select class="form-select tech-input" id="filter-status">
              <option value="">All</option>
              <option value="PENDING">Pending</option>
              <option value="VALIDATED">Validated</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>
          <div class="form-group" style="flex:1;min-width:180px;">
            <label class="form-label" for="filter-search">Search Species</label>
            <input class="form-input tech-input" id="filter-search" type="text" placeholder="e.g. Lion, Elephant…" />
          </div>
          <button class="btn btn--secondary btn--sm tech-btn" id="btn-refresh-reports" style="margin-top:auto;">
            REFRESH
          </button>
        </div>
      </div>

      <!-- Reports Table -->
      <div class="table-wrap anim-fade-in-up" style="animation-delay:0.1s; border: 2px solid var(--clr-border);">
        <table class="data-table table-tactical" id="reports-table">
          <thead><tr>${colHeaders}</tr></thead>
          <tbody id="reports-tbody">${skeleton}</tbody>
        </table>
      </div>

      <p id="reports-error" class="form-error mt-4" style="display:none;"></p>
    `;
  }

  /* ── Public: render ──────────────────────────────────────── */
  function render(container, mode = 'my-reports') {
    container.innerHTML = buildPageHTML(mode);
    attachListeners(mode);
    loadReports(mode);
  }

  /* ── Internal: fetch and fill table ──────────────────────── */
  async function loadReports(mode) {
    const tbody = document.getElementById('reports-tbody');
    const errEl = document.getElementById('reports-error');
    if (!tbody) return;

    try {
      /*
       * Query-param strategy per mode:
       *
       * my-reports  → always ?mine=true regardless of role.
       *               This ensures Rangers/Analysts/Admins also see only
       *               their own submissions on the My Reports view.
       *               Community accounts are additionally scoped server-side
       *               by the isCommunityTier gate in reportController.getReports().
       *
       * pending     → ?status=PENDING (role-gated by view_pending_reports permission)
       * validated   → ?status=VALIDATED
       */
      let params = '';
      if (mode === 'my-reports') params = '?mine=true';
      else if (mode === 'pending')   params = '?status=PENDING';
      else if (mode === 'validated') params = '?status=VALIDATED';

      const reports = await API.get(`/reports${params}`);
      console.log(`[REPORTS] Mode: ${mode}, count: ${reports.length}`);
      renderRows(tbody, reports, mode);
    } catch (err) {
      console.error(`[REPORTS] Failed to load:`, err);
      tbody.innerHTML = `<tr><td colspan="${COLUMNS.length}" style="text-align:center;color:var(--clr-text-muted)">Could not load reports: ${err.message}</td></tr>`;
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  }

  /* ── Internal: build table rows from report data ─────────── */
  function renderRows(tbody, reports, mode) {
    if (!reports.length) {
      tbody.innerHTML = `<tr><td colspan="${COLUMNS.length}" style="text-align:center;padding:var(--sp-8);color:var(--clr-text-muted);">No reports found.</td></tr>`;
      return;
    }
    tbody.innerHTML = reports.map(r => `<tr>${buildRowCells(r, mode)}</tr>`).join('');
    attachRowActions();
  }

  /* ── Internal: validate / reject row actions ─────────────── */
  function attachRowActions() {
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { action, id } = btn.dataset;

        if (action === 'validate' || action === 'reject') {
          const status = action === 'validate' ? 'VALIDATED' : 'REJECTED';
          Modal.open({
            title: `${action === 'validate' ? 'Validate' : 'Reject'} Report`,
            body: `<p>Are you sure you want to <strong>${action}</strong> this report?</p>`,
            confirmLabel: action === 'validate' ? 'VALIDATE' : 'REJECT',
            onConfirm: async () => {
              try {
                await API.patch(`/reports/${id}/validate`, { status });
                Toast.success(`Report ${status.toLowerCase()} successfully.`);
                loadReports('pending'); // Refresh
              } catch (err) {
                Toast.error(err.message);
              }
            }
          });
        } else if (action === 'view') {
          Router.navigate('report-detail', { reportId: id });
        }
      });
    });
  }

  /* ── Internal: wire up filters & refresh ─────────────────── */
  function attachListeners(mode) {
    document.getElementById('btn-refresh-reports')?.addEventListener('click', () => loadReports(mode));
  }

  return { render };
})();
