/* ============================================================
   TERRA – sidebar.js
   Renders the sidebar navigation based on the user's permissions.
   NAV_ITEMS defines all possible navigation entries; each entry
   can require a specific permission to be shown.
   ============================================================ */

const Sidebar = (() => {

  /* ── Navigation Configuration ────────────────────────────── */
  /* To add a new nav item, add an entry here. No HTML changes needed. */
  const NAV_ITEMS = [
    {
      section: 'Overview',
      items: [
        { id: 'dashboard', label: 'Dashboard', permission: null },
        { id: 'map', label: 'Live Map', permission: null },
      ],
    },
    {
      section: 'Reports',
      items: [
        { id: 'submit-report', label: 'Submit Report', permission: 'submit_report' },
        { id: 'my-reports', label: 'My Reports', permission: 'view_own_reports' },
        { id: 'pending', label: 'Pending Queue', permission: 'view_pending_reports' },
        { id: 'validated', label: 'Validated', permission: 'view_protected_reports' },
      ],
    },
    {
      section: 'Analysis',
      items: [
        { id: 'site-analysis', label: 'Site Analysis', permission: 'export_data' },
        { id: 'analytics', label: 'Analytics', permission: 'export_data' },
        { id: 'export', label: 'Export Data', permission: 'export_data' },
      ],
    },
    {
      section: 'Administration',
      items: [
        { id: 'users', label: 'Manage Users', permission: 'manage_users' },
        { id: 'roles', label: 'Roles & Perms', permission: 'manage_roles' },
        { id: 'audit-logs', label: 'Audit Logs', permission: 'view_audit_logs' },
      ],
    },
  ];

  /* ── Internal: render a single nav link ─────────────────── */
  function renderNavLink(item, activePage) {
    const isActive = activePage === item.id ? 'active' : '';
    return `
      <button
        class="nav-link nav-link--tactical ${isActive}"
        data-page="${item.id}"
        aria-current="${isActive ? 'page' : 'false'}"
      >
        <span class="nav-label">> ${item.label}</span>
      </button>
    `;
  }

  /* ── Internal: build sections, filtering by permission ───── */
  function buildNavHTML(activePage) {
    return NAV_ITEMS.map(section => {
      // Filter items by permission
      const visibleItems = section.items.filter(item =>
        !item.permission || Auth.hasPermission(item.permission)
      );
      if (visibleItems.length === 0) return ''; // Hide empty sections

      const isAdmin = section.section === 'Administration';
      const lockBadge = isAdmin
        ? `<span class="sidebar__admin-lock" title="Secured – Admin access only">&#9670; ADM</span>`
        : '';

      return `
        <div class="sidebar__section">
          <span class="sidebar__section-label">${section.section}${lockBadge}</span>
          ${visibleItems.map(item => renderNavLink(item, activePage)).join('')}
        </div>
      `;
    }).join('');
  }

  /* ── Internal: render user footer ───────────────────────── */
  function buildFooterHTML(user) {
    if (!user) return '';
    const initials = (user.username || 'U').slice(0, 2).toUpperCase();
    return `
      <div class="sidebar__avatar">${initials}</div>
      <div class="sidebar__user-info">
        <div class="sidebar__user-name">${user.username || 'User'}</div>
        <div class="sidebar__user-role">${user.role_name || 'Loading...'}</div>
      </div>
    `;
  }

  /* ── Public: render the sidebar into #sidebar ────────────── */
  function render(activePage = 'dashboard') {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    const user = Auth.getUser();

    sidebar.innerHTML = `
      <!-- Logo -->
      <div class="sidebar__logo">
        <div class="sidebar__logo-icon">::</div>
        <span class="sidebar__logo-text">TER<span>RA</span></span>
      </div>

      <!-- Nav -->
      <nav class="sidebar__nav" id="sidebar-nav">
        ${buildNavHTML(activePage)}
      </nav>

      <!-- User Footer -->
      <div class="sidebar__footer">
        ${buildFooterHTML(user)}
      </div>
    `;

    // Attach click listeners for page routing
    sidebar.querySelectorAll('.nav-link').forEach(btn => {
      btn.addEventListener('click', () => {
        const pageId = btn.dataset.page;
        Router.navigate(pageId);
      });
    });
  }

  /* ── Public: update active state without full re-render ──── */
  function setActivePage(pageId) {
    document.querySelectorAll('.nav-link').forEach(btn => {
      const isActive = btn.dataset.page === pageId;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-current', isActive ? 'page' : 'false');
    });
  }

  return { render, setActivePage };
})();
