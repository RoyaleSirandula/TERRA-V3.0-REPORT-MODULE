/* ============================================================
   TERRA – app.js
   Application entry point. Initialises the router and renders
   the first page based on URL hash.

   ROUTING: Uses hash-based routing (#/dashboard, #/submit-report)
   To add a new page:
     1. Create a module in js/pages/yourPage.js
     2. Include the script in index.html
     3. Add an entry to ROUTE_MAP below
   ============================================================ */

const Router = (() => {

    /* ── Admin-gated pages ───────────────────────────────────── */
    /* Navigating to these requires password re-confirmation      */
    const ADMIN_PAGES = new Set(['users', 'roles', 'audit-logs']);

    /* ── Route Registry ──────────────────────────────────────── */
    /* Each entry maps a page ID to a { title, render } function */
    const ROUTE_MAP = {
        'dashboard': { title: 'Dashboard', render: (c) => DashboardPage.render(c) },
        'submit-report': { title: 'Submit Report', render: (c) => SubmitReportPage.render(c) },
        'my-reports': { title: 'My Reports', render: (c) => ReportsPage.render(c, 'my-reports') },
        'pending': {
            title: 'Pending Queue', render: (c) => Auth.hasPermission('view_pending_reports')
                ? ReportsPage.render(c, 'pending')
                : renderForbidden(c)
        },
        'validated': { title: 'Validated Reports', render: (c) => ReportsPage.render(c, 'validated') },
        'report-detail': { title: 'Report Detail', render: (c, opts) => ReportDetailPage.render(c, opts || {}) },
        'site-analysis': { title: 'Site Analysis', render: (c, opts) => SiteAnalysisPage.render(c, opts || {}) },
        // Ranger shortcut — open map view then switch to the named dock tab
        'site-analysis--tracker': { title: 'Animal Tracker', render: (c) => { SiteAnalysisPage.render(c, {}); setTimeout(() => { document.querySelector('.sa-dock__tab[data-panel="tracker"]')?.click(); }, 800); } },
        'site-analysis--data':    { title: 'Upload Data',    render: (c) => { SiteAnalysisPage.render(c, {}); setTimeout(() => { document.querySelector('.sa-dock__tab[data-panel="data"]')?.click(); }, 800); } },
        // Sidebar nav targets
        'map': { title: 'Live Map', render: (c) => renderPlaceholder(c, '🗺️', 'Live Geospatial Map', 'Leaflet.js integration coming soon.') },
        'analytics': { title: 'Analytics', render: (c) => AnalyticsPage.render(c) },
        'export': { title: 'Export Data', render: (c) => renderPlaceholder(c, '📤', 'Export Datasets', 'CSV / GeoJSON export coming soon.') },
        'users': { title: 'Manage Users', render: (c) => UsersPage.render(c) },
        'roles': { title: 'Roles & Permissions', render: (c) => RolesPage.render(c) },
        'audit-logs': { title: 'Audit Logs', render: (c) => renderPlaceholder(c, '📜', 'Audit Logs', 'Immutable event log viewer coming soon.') },
    };

    /* ── Internal: placeholder for upcoming pages ────────────── */
    function renderPlaceholder(container, icon, title, subtitle) {
        container.innerHTML = `
      <div class="page-header"><h1>${title}</h1><p>${subtitle}</p></div>
      <div class="card" style="text-align:center;padding:var(--sp-16);color:var(--clr-text-muted);">
        <div style="font-size:4rem;margin-bottom:var(--sp-4);">${icon}</div>
        <p style="font-size:var(--text-lg);font-weight:var(--fw-semibold);color:var(--clr-text);">${title}</p>
        <p style="margin-top:var(--sp-3);">${subtitle}</p>
      </div>
    `;
    }

    /* ── Internal: forbidden page ────────────────────────────── */
    function renderForbidden(container) {
        renderPlaceholder(container, '🔒', 'Access Denied', 'You do not have permission to view this page.');
    }

    /* ── Internal: admin lock modal ──────────────────────────── */
    function openAdminLockModal(onUnlock) {
        const container = document.getElementById('modal-container');
        if (!container) return;

        container.innerHTML = `
          <div class="modal-backdrop" id="admin-lock-backdrop">
            <div class="modal" role="dialog" aria-modal="true" style="max-width:420px;">
              <div class="modal__header">
                <div>
                  <div style="font-family:var(--font-mono);font-size:var(--text-xs);color:var(--clr-danger);letter-spacing:.12em;margin-bottom:var(--sp-1);">&#9670; RESTRICTED ZONE</div>
                  <h2 class="modal__title">Admin Access Required</h2>
                </div>
                <button class="btn btn--icon" id="admin-lock-close" aria-label="Cancel">&#x2715;</button>
              </div>
              <div class="modal__body">
                <p style="color:var(--clr-text-muted);font-size:var(--text-sm);margin-bottom:var(--sp-6);line-height:1.6;">
                  Administration privileges require password confirmation.<br>
                  This unlock persists for the duration of your session.
                </p>
                <div class="form-group" style="margin-bottom:var(--sp-2);">
                  <label class="form-label" for="admin-lock-pw">Password</label>
                  <input type="password" id="admin-lock-pw" class="form-input"
                    placeholder="Enter your password" autocomplete="current-password" />
                </div>
                <div id="admin-lock-err"
                  style="color:var(--clr-danger);font-size:var(--text-xs);font-family:var(--font-mono);
                         min-height:1.2em;margin-bottom:var(--sp-4);letter-spacing:.04em;">
                </div>
                <div style="display:flex;gap:var(--sp-3);">
                  <button class="btn btn--primary" id="admin-lock-submit" style="flex:1;">UNLOCK</button>
                  <button class="btn btn--secondary" id="admin-lock-cancel">Cancel</button>
                </div>
              </div>
            </div>
          </div>
        `;

        const backdrop  = document.getElementById('admin-lock-backdrop');
        const pwInput   = document.getElementById('admin-lock-pw');
        const submitBtn = document.getElementById('admin-lock-submit');
        const errEl     = document.getElementById('admin-lock-err');

        function closeModal() { container.innerHTML = ''; }

        document.getElementById('admin-lock-close').addEventListener('click', closeModal);
        document.getElementById('admin-lock-cancel').addEventListener('click', closeModal);
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });

        async function submit() {
            const pw = pwInput.value;
            if (!pw) { errEl.textContent = 'ERR: Password required.'; return; }

            submitBtn.disabled = true;
            submitBtn.textContent = 'VERIFYING…';
            errEl.textContent = '';

            try {
                await API.post('/auth/verify-password', { password: pw });
                Auth.setAdminUnlocked();
                closeModal();
                onUnlock();
            } catch {
                errEl.textContent = 'ERR: Incorrect password. Access denied.';
                submitBtn.disabled = false;
                submitBtn.textContent = 'UNLOCK';
                pwInput.value = '';
                pwInput.focus();
            }
        }

        submitBtn.addEventListener('click', submit);
        pwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

        // Autofocus after mount
        setTimeout(() => pwInput.focus(), 50);
    }

    /* ── Public: navigate to a page by page ID ───────────────── */
    function navigate(pageId, options = {}) {
        console.log(`[ROUTER] Navigating to: ${pageId}`, options);

        // Admin lock gate — prompt for password if not yet unlocked
        if (ADMIN_PAGES.has(pageId) && !Auth.isAdminUnlocked()) {
            openAdminLockModal(() => navigate(pageId, options));
            return;
        }

        const route = ROUTE_MAP[pageId] || ROUTE_MAP['dashboard'];
        const container = document.getElementById('page-content');

        if (!container) {
            console.error('[ROUTER] Page content container not found!');
            return;
        }

        // Scroll to top
        container.scrollTo(0, 0);

        // Update URL hash (for bookmarking / back-button)
        let hashSuffix = '';
        if (pageId === 'report-detail' && options.reportId) {
            hashSuffix = `/${options.reportId}`;
        } else if (pageId === 'site-analysis' && options.lat != null && options.lng != null) {
            hashSuffix = `/${options.lat}/${options.lng}${options.reportId ? `/${options.reportId}` : ''}`;
        }

        const newHash = `#/${pageId}${hashSuffix}`;

        if (window.location.hash !== newHash) {
            console.log(`[ROUTER] Updating hash to ${newHash}`);
            window.location.hash = newHash;
        }

        // Render sidebar + topbar
        Sidebar.render(pageId);
        Topbar.render(pageId, route.title);

        // Render page content (pass options for pages like report-detail)
        try {
            route.render(container, options);
        } catch (err) {
            console.error(`[ROUTER] Render error for ${pageId}:`, err);
            container.innerHTML = `<div class="p-8 text-center text-danger">Critical Render Error: ${err.message}</div>`;
        }
    }

    /* ── Public: boot the app ────────────────────────────────── */
    function boot() {
        console.log('[APP] Booting TERRA...');
        // ── Auth Guard: redirect to login if no token ──────────────
        if (!Auth.isLoggedIn()) {
            console.log('[APP] Not logged in, redirecting...');
            window.location.replace('/login.html');
            return;
        }

        const fullHash = window.location.hash.replace(/^#\/?/, '');
        const segments = fullHash.split('/');
        const pageId = segments[0] || 'dashboard';

        console.log(`[APP] Initial page from hash: ${pageId}`);

        const options = {};
        if (pageId === 'report-detail' && segments[1]) {
            options.reportId = segments[1];
        } else if (pageId === 'site-analysis' && segments[1] && segments[2]) {
            options.lat = segments[1];
            options.lng = segments[2];
            if (segments[3]) options.reportId = segments[3];
        }

        navigate(pageId, options);
    }

    /* ── Listen for back/forward browser navigation ──────────── */
    window.addEventListener('hashchange', () => {
        const fullHash = window.location.hash.replace(/^#\/?/, '');
        const segments = fullHash.split('/');
        const pageId = segments[0] || 'dashboard';

        console.log(`[ROUTER] Hash changed. New Page: ${pageId}`);

        const route = ROUTE_MAP[pageId];
        if (!route) {
            console.warn(`[ROUTER] Route ${pageId} not found, redirecting to dashboard`);
            return navigate('dashboard');
        }

        // Admin gate also applies on hash change (e.g. back button)
        if (ADMIN_PAGES.has(pageId) && !Auth.isAdminUnlocked()) {
            openAdminLockModal(() => navigate(pageId));
            return;
        }

        const options = {};
        if (pageId === 'report-detail' && segments[1]) {
            options.reportId = segments[1];
        } else if (pageId === 'site-analysis' && segments[1] && segments[2]) {
            options.lat = segments[1];
            options.lng = segments[2];
            if (segments[3]) options.reportId = segments[3];
        }

        // Update active nav state without full page re-render
        Sidebar.setActivePage(pageId);
        const container = document.getElementById('page-content');
        Topbar.render(pageId, route.title);

        try {
            route.render(container, options);
        } catch (err) {
            console.error(`[ROUTER] Async Render error for ${pageId}:`, err);
        }
    });

    return { navigate, boot };
})();

/* ── Kick off the app on DOM ready ──────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    Topbar.initTheme();
    CustomScrollbar.init();
    Router.boot();
});
