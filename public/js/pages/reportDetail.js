/* ============================================================
   TERRA – reportDetail.js
   Report Detail page coordinator.

   Renders the full detail view for a single report:
   ✦ Header (species, status, meta, actions)
   ✦ Tab navigation (Overview / Analytics / Map / Timeline / Raw)
   ✦ Widget grid (powered by WidgetRegistry)

   Navigation:
   Router.navigate('report-detail', { reportId: 'uuid' })

   ============================================================ */

const ReportDetailPage = (() => {

  /* ── Tab Configuration ───────────────────────────────────── */
  /* To add a new tab, add an entry here.
     defaultWidgets: array of widget IDs to display on initial load */
  const TABS = [
    {
      id: 'overview',
      label: 'Overview',
      defaultWidgets: ['monitoring-stats', 'map-location', 'timeline-lifecycle'],
    },
    {
      id: 'analytics',
      label: 'Analytics',
      defaultWidgets: ['chart-activity', 'chart-distribution', 'monitoring-stats'],
    },
    {
      id: 'map',
      label: 'Map View',
      defaultWidgets: ['map-location', 'timeline-lifecycle'],
    },
    {
      id: 'timeline',
      label: 'Timeline',
      defaultWidgets: ['timeline-lifecycle', 'timeline-audit'],
    },
    {
      id: 'raw',
      label: 'Raw Data',
      defaultWidgets: [],  // Special: renders JSON viewer.
    },
  ];

  /* ── Internal: build page header HTML ───────────────────── */
  function buildHeader(report) {
    const status = (report.validation_status || 'PENDING').toUpperCase();
    const tier = report.sensitivity_tier || 1;
    const tierLabels = ['', 'Public', 'Protected', 'Restricted', 'Confidential'];
    const tierClasses = ['', 'validated', 'warning', 'pending', 'danger'];

    const canValidate = Auth.hasPermission('validate_report') && status === 'PENDING';

    return `
      <div class="report-detail-header anim-fade-in">
        <!-- Left: metadata -->
        <div style="flex:1">
          <div class="report-detail-header__id">REPORT ID: ${report.report_id}</div>
          <h1 class="report-detail-header__title">
            ${report.species_name || 'Unknown Species'}
          </h1>
          <div class="report-detail-header__meta">
            <span class="badge badge--${status.toLowerCase()}">${status}</span>
            <span class="badge badge--${tierClasses[tier]}">Tier ${tier} – ${tierLabels[tier]}</span>
            <span class="report-detail-header__meta-item">
              ${new Date(report.created_at).toLocaleDateString()}
            </span>
            <span class="report-detail-header__meta-item">
              ${Number(report.latitude || 0).toFixed(4)},
                 ${Number(report.longitude || 0).toFixed(4)}
            </span>
            <span class="report-detail-header__meta-item">
              ${Number(report.ai_confidence_score || 0).toFixed(1)}% AI confidence
            </span>
          </div>

          <!-- Intelligence Engine Breakdown -->
          <div class="mt-4 anim-fade-in-up" style="animation-delay: 0.2s">
            <div style="font-size:var(--text-xs); text-transform:uppercase; color:var(--clr-brand); font-weight:var(--fw-bold); margin-bottom:var(--sp-2); letter-spacing:0.05em">
              Intelligence Breakdown
            </div>
            <div style="display:flex; flex-direction:column; gap: var(--sp-2);">
              ${(Array.isArray(report.confidence_breakdown) ? report.confidence_breakdown : [])
        .filter(item => item.status === 'PASSED')
        .map((item, idx) => `
                  <div class="card p-2 px-3 anim-fade-in-up" style="
                    display:flex; 
                    justify-content:space-between; 
                    align-items:center; 
                    background: rgba(0,255,153,0.05); 
                    border: 1px solid var(--clr-brand);
                    animation-delay: ${0.3 + (idx * 0.1)}s;
                  ">
                    <span style="font-size:var(--text-xs); color:var(--clr-text)">
                      <span style="color:var(--clr-brand); margin-right:var(--sp-2)">+</span> ${item.label}
                    </span>
                    <span style="font-family:var(--font-mono); font-size:var(--text-xs); font-weight:var(--fw-bold); color:var(--clr-brand)">
                      ${item.boost}
                    </span>
                  </div>
                `).join('')}

              ${(Array.isArray(report.confidence_breakdown) ? report.confidence_breakdown : []).filter(item => item.status === 'PASSED').length === 0 ? `
                <div class="text-muted" style="font-size:var(--text-xs); font-style:italic">No intelligence criteria met yet.</div>
              ` : ''}
            </div>
          </div>

          <!-- Sighting Description -->
          <div class="mt-4" style="
            max-width: 800px;
            color: var(--clr-text);
            line-height: 1.6;
            font-size: 0.95rem;
            background: var(--clr-surface-2);
            padding: var(--sp-4);
            border-radius: var(--radius-md);
            border-left: 3px solid var(--clr-brand);
          ">
            <div style="font-size:var(--text-xs); text-transform:uppercase; color:var(--clr-text-muted); font-weight:var(--fw-bold); margin-bottom:var(--sp-2)">
              Sighting Description by ${report.submitter_name || 'Anonymous'} in ${report.region_id}
            </div>
            ${report.description || '<em style="color:var(--clr-text-muted)">No description provided.</em>'}
          </div>
        </div>

        <!-- Right: actions -->
        <div class="report-detail-header__actions">
          ${canValidate ? `
            <button class="btn btn--primary" id="btn-validate-report" data-id="${report.report_id}">
              VALIDATE
            </button>
            <button class="btn btn--danger" id="btn-reject-report" data-id="${report.report_id}">
              REJECT
            </button>
          ` : ''}
          ${Auth.hasPermission('export_data') ? `
            <button class="btn btn--secondary" id="btn-export-report">
              EXPORT
            </button>
          ` : ''}
          <button class="btn btn--secondary" id="btn-analyse-site" title="Open this location in Site Analysis">
            ANALYSE SITE
          </button>
          <button class="btn btn--secondary" id="btn-back-reports">
            BACK
          </button>
        </div>
      </div>
    `;
  }

  /* ── Internal: build tab nav HTML ────────────────────────── */
  function buildTabs(activeTabId) {
    return `
      <div class="detail-tabs" id="detail-tabs" role="tablist">
        ${TABS.map(tab => `
          <button
            class="detail-tab ${tab.id === activeTabId ? 'active' : ''}"
            role="tab"
            data-tab="${tab.id}"
            aria-selected="${tab.id === activeTabId}"
          >${tab.label}</button>
        `).join('')}
      </div>
    `;
  }

  /* ── Internal: render Raw Data JSON viewer ───────────────── */
  function renderRawTab(container, report) {
    const sanitized = { ...report };
    // Never show raw geom WKB in frontend
    delete sanitized.geom;

    container.innerHTML = `
      <div class="card" style="grid-column: 1 / -1; width: 100%;">
        <div class="card__header">
          <div class="card__title">Raw Report Data</div>
          <div class="card__subtitle">Sanitized JSON (geometry field excluded)</div>
        </div>
        <pre style="
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          color: var(--clr-text-muted);
          overflow-x: auto;
          white-space: pre-wrap;
          word-break: break-all;
          max-height: 800px;
          overflow-y: auto;
          background: var(--clr-surface-2);
          border-radius: var(--radius-md);
          padding: var(--sp-5);
          width: 100%;
        ">${JSON.stringify(sanitized, null, 2)}</pre>
      </div>
    `;
  }

  /* ── Internal: activate a tab and render its widget grid ──── */
  function activateTab(tabId, widgetGrid, report) {
    // Update tab visual state
    document.querySelectorAll('.detail-tab').forEach(btn => {
      const isActive = btn.dataset.tab === tabId;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive);
    });

    const tab = TABS.find(t => t.id === tabId);
    if (!tab) return;

    if (tabId === 'raw') {
      renderRawTab(widgetGrid, report);
      return;
    }

    // Init widget registry for this tab's default layout
    WidgetRegistry.init(widgetGrid, report, tab.defaultWidgets);
  }

  /* ── Internal: wire up validate/reject buttons ───────────── */
  function attachActionListeners(report) {
    document.getElementById('btn-back-reports')?.addEventListener('click', () => {
      Router.navigate('my-reports');
    });

    document.getElementById('btn-analyse-site')?.addEventListener('click', () => {
      Router.navigate('site-analysis', {
        lat: report.latitude,
        lng: report.longitude,
        reportId: report.report_id
      });
    });

    document.getElementById('btn-validate-report')?.addEventListener('click', () => {
      Modal.open({
        title: 'Validate Report',
        body: `<p>Confirm validation of this report? This will feed data into the AI model.</p>`,
        confirmLabel: 'Validate',
        onConfirm: async () => {
          try {
            await API.patch(`/reports/${report.report_id}/validate`, { status: 'VALIDATED' });
            Toast.success('Report validated successfully.');
            Router.navigate('pending');
          } catch (err) {
            Toast.error(err.message);
          }
        }
      });
    });

    document.getElementById('btn-reject-report')?.addEventListener('click', () => {
      Modal.open({
        title: 'Reject Report',
        body: `<p>Are you sure you want to reject this report? This action will be logged.</p>`,
        confirmLabel: 'Reject',
        onConfirm: async () => {
          try {
            await API.patch(`/reports/${report.report_id}/validate`, { status: 'REJECTED' });
            Toast.success('Report rejected.');
            Router.navigate('pending');
          } catch (err) {
            Toast.error(err.message);
          }
        }
      });
    });

    document.getElementById('btn-export-report')?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `terra-report-${report.report_id.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      Toast.success('Report exported as JSON.');
    });
  }

  /* ── Public: render ──────────────────────────────────────── */
  async function render(container, options = {}) {
    const { reportId } = options;

    if (!reportId) {
      console.error('[REPORT-DETAIL] No reportId provided to render function', options);
      container.innerHTML = '<div class="p-8 text-center text-muted">No report ID provided. Entering through list view?</div>';
      return;
    }

    console.log(`[REPORT-DETAIL] Loading report: ${reportId}`);

    // Loading state
    container.innerHTML = `
      <div class="page-header anim-fade-in">
        <div class="skeleton" style="height:1.5rem;width:300px;"></div>
      </div>
      <div style="height:200px;display:flex;align-items:center;justify-content:center;color:var(--clr-text-muted);">
        <div class="spinner mr-3"></div> Loading report detail ${reportId.slice(0, 8)}…
      </div>
    `;

    let report;
    try {
      report = await API.get(`/reports/${reportId}`);
    } catch (err) {
      container.innerHTML = `
                <div class="p-8 text-center">
                    <p class="form-error">Error loading report: ${err.message}</p>
                    <button class="btn btn--secondary mt-4" onclick="Router.navigate('my-reports')">Back to Reports</button>
                </div>
            `;
      return;
    }

    // Parse coordinates from PostGIS geom_json if available
    if (report.geom_json && report.geom_json.coordinates) {
      report.longitude = report.geom_json.coordinates[0];
      report.latitude = report.geom_json.coordinates[1];
    } else if (report.geom && typeof report.geom === 'string' && report.geom.startsWith('{')) {
      try {
        const geo = JSON.parse(report.geom);
        report.longitude = geo.coordinates?.[0];
        report.latitude = geo.coordinates?.[1];
      } catch (e) { }
    }

    // Ensure we have numbers
    report.latitude = parseFloat(report.latitude || 0);
    report.longitude = parseFloat(report.longitude || 0);

    // Ensure fallback
    report.species_name = report.species_name || 'Unknown Species';

    console.log('[REPORT-DETAIL] Report data loaded:', report.report_id, report.species_name);

    // Full page render
    container.innerHTML = `
      ${buildHeader(report)}
      ${buildTabs('overview')}
      <div class="widget-grid" id="widget-grid"></div>
    `;

    const widgetGrid = document.getElementById('widget-grid');

    // Tab clicks
    document.getElementById('detail-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.detail-tab');
      if (tab) activateTab(tab.dataset.tab, widgetGrid, report);
    });

    // Action buttons
    attachActionListeners(report);

    // Render default Overview tab
    activateTab('overview', widgetGrid, report);
  }

  return { render };
})();
