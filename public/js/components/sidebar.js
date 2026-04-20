/* ============================================================
   TERRA – sidebar.js
   Renders the sidebar navigation. Supports collapse/expand via
   a toggle button; state is persisted in localStorage.
   ============================================================ */

const Sidebar = (() => {

  const COLLAPSED_KEY = 'terra_sidebar_collapsed';

  /* ── Navigation Configuration ────────────────────────────── */
  const NAV_ITEMS = [
    {
      section: 'Overview',
      items: [
        { id: 'dashboard',     label: 'Dashboard',    icon: '■', permission: null },
        { id: 'map',           label: 'Live Map',     icon: '○', permission: null },
      ],
    },
    {
      section: 'Reports',
      items: [
        { id: 'submit-report', label: 'Submit Report', icon: '+', permission: 'submit_report' },
        { id: 'my-reports',    label: 'My Reports',    icon: '≡', permission: 'view_own_reports' },
        { id: 'pending',       label: 'Pending Queue', icon: '◷', permission: 'view_pending_reports' },
        { id: 'validated',     label: 'Validated',     icon: '✓', permission: 'view_protected_reports' },
      ],
    },
    {
      section: 'Analysis',
      items: [
        { id: 'site-analysis', label: 'Site Analysis', icon: '◈', permission: 'export_data' },
        { id: 'analytics',     label: 'Analytics',     icon: '◆', permission: 'export_data' },
        { id: 'export',        label: 'Export Data',   icon: '↗', permission: 'export_data' },
      ],
    },
    {
      section: 'Administration',
      items: [
        { id: 'users',      label: 'Manage Users', icon: '⊕', permission: 'manage_users' },
        { id: 'roles',      label: 'Roles & Perms', icon: '⊛', permission: 'manage_roles' },
        { id: 'audit-logs', label: 'Audit Logs',   icon: '≣', permission: 'view_audit_logs' },
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
        title="${item.label}"
      >
        <span class="nav-icon">${item.icon}</span>
        <span class="nav-label">${item.label}</span>
      </button>
    `;
  }

  /* ── Internal: build sections, filtering by permission ───── */
  function buildNavHTML(activePage) {
    return NAV_ITEMS.map(section => {
      const visibleItems = section.items.filter(item =>
        !item.permission || Auth.hasPermission(item.permission)
      );
      if (visibleItems.length === 0) return '';

      const isAdmin = section.section === 'Administration';
      const lockBadge = isAdmin
        ? `<span class="sidebar__admin-lock" title="Secured – Admin access only">&#9670; ADM</span>`
        : '';

      return `
        <div class="sidebar__section">
          <span class="sidebar__section-label">
            <span class="sidebar__section-text">${section.section}</span>${lockBadge}
          </span>
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
    const isCollapsed = localStorage.getItem(COLLAPSED_KEY) === '1';

    // Apply collapse state to sidebar and app-shell immediately
    sidebar.classList.toggle('sidebar--collapsed', isCollapsed);
    document.getElementById('app-shell')?.classList.toggle('sidebar-collapsed', isCollapsed);

    sidebar.innerHTML = `
      <div class="sidebar__logo">
        <div class="sidebar__logo-icon">::</div>
        <span class="sidebar__logo-text">TER<span>RA</span></span>
        <button class="sidebar__toggle" id="sidebar-toggle"
          title="${isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}"
          aria-label="${isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}"
        >${isCollapsed ? '»' : '«'}</button>
      </div>

      <nav class="sidebar__nav" id="sidebar-nav">
        ${buildNavHTML(activePage)}
      </nav>

      <div class="sidebar__footer">
        ${buildFooterHTML(user)}
      </div>
    `;

    // Route navigation
    sidebar.querySelectorAll('.nav-link').forEach(btn => {
      btn.addEventListener('click', () => Router.navigate(btn.dataset.page));
    });

    // Collapse toggle
    document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
      const collapsed = sidebar.classList.toggle('sidebar--collapsed');
      document.getElementById('app-shell')?.classList.toggle('sidebar-collapsed', collapsed);
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
      const toggle = document.getElementById('sidebar-toggle');
      if (toggle) {
        toggle.textContent = collapsed ? '»' : '«';
        toggle.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
        toggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
      }
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
