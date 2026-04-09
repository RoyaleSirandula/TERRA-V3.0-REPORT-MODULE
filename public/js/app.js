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
        // Sidebar nav targets
        'map': { title: 'Live Map', render: (c) => renderPlaceholder(c, '🗺️', 'Live Geospatial Map', 'Leaflet.js integration coming soon.') },
        'analytics': { title: 'Analytics', render: (c) => renderPlaceholder(c, '📊', 'Analytics & Trends', 'Chart.js visualisations coming soon.') },
        'export': { title: 'Export Data', render: (c) => renderPlaceholder(c, '📤', 'Export Datasets', 'CSV / GeoJSON export coming soon.') },
        'users': { title: 'Manage Users', render: (c) => renderPlaceholder(c, '👥', 'User Management', 'User CRUD panel coming soon.') },
        'roles': { title: 'Roles & Permissions', render: (c) => renderPlaceholder(c, '🔐', 'Role-Permission Matrix', 'Dynamic RBAC editor coming soon.') },
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

    /* ── Public: navigate to a page by page ID ───────────────── */
    function navigate(pageId, options = {}) {
        console.log(`[ROUTER] Navuating to: ${pageId}`, options);
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
            container.innerHTML = `<div class="p-8 text-center text-danger">Critial Render Error: ${err.message}</div>`;
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
    Router.boot();
});
