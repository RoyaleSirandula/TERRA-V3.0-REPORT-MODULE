/* ============================================================
   TERRA – sidebar.js
   Tactical side navigation. Scoped prefix: sb-*
   Collapse state persisted in localStorage.
   ============================================================ */

const Sidebar = (() => {

  const COLLAPSED_KEY = 'terra_sidebar_collapsed';

  /* ── Navigation Configuration ────────────────────────────── */
  const NAV_ITEMS = [
    {
      section: 'Overview',
      items: [
        { id: 'dashboard',  label: 'Dashboard',    icon: 'DASH', permission: null },
        { id: 'map',        label: 'Ops Console',  icon: 'OPSV', permission: null },
      ],
    },
    {
      section: 'Reports',
      items: [
        { id: 'submit-report', label: 'Submit Report', icon: 'SUBM', permission: 'submit_report' },
        { id: 'my-reports',    label: 'My Reports',    icon: 'MINE', permission: 'view_own_reports' },
        { id: 'pending',       label: 'Pending Queue', icon: 'PEND', permission: 'view_pending_reports' },
        { id: 'validated',     label: 'Validated',     icon: 'VALD', permission: 'view_protected_reports' },
      ],
    },
    {
      section: 'Analysis',
      items: [
        { id: 'site-analysis',          label: 'Site Analysis',  icon: 'SITE', permission: 'export_data' },
        { id: 'test-site',              label: 'Field Intel',    icon: 'INTL', permission: 'export_data' },
        { id: 'site-analysis--tracker', label: 'Animal Tracker', icon: 'TRKR', permission: 'export_data' },
        { id: 'site-analysis--data',    label: 'Upload Data',    icon: 'UPLD', permission: 'export_data' },
        { id: 'analytics',              label: 'Analytics',      icon: 'ANLX', permission: 'export_data' },
        { id: 'export',                 label: 'Export Data',    icon: 'XPRT', permission: 'export_data' },
      ],
    },
    {
      section: 'Administration',
      items: [
        { id: 'users',      label: 'Manage Users',  icon: 'USRS', permission: 'manage_users' },
        { id: 'roles',      label: 'Roles & Perms', icon: 'ROLE', permission: 'manage_roles' },
        { id: 'audit-logs', label: 'Audit Logs',    icon: 'AUDT', permission: 'view_audit_logs' },
      ],
    },
  ];

  /* ── Single nav link ──────────────────────────────────────── */
  function renderNavLink(item, activePage) {
    const isActive = activePage === item.id;
    return `
      <button
        class="sb-link${isActive ? ' sb-link--active' : ''}"
        data-page="${item.id}"
        aria-current="${isActive ? 'page' : 'false'}"
        title="${item.label}"
      >
        <span class="sb-link__icon">${item.icon}</span>
        <span class="sb-link__label">${item.label}</span>
        ${isActive ? '<span class="sb-link__pip"></span>' : ''}
      </button>`;
  }

  /* ── Section block ────────────────────────────────────────── */
  function buildNavHTML(activePage) {
    return NAV_ITEMS.map(section => {
      const visible = section.items.filter(item =>
        !item.permission || Auth.hasPermission(item.permission)
      );
      if (!visible.length) return '';

      return `
        <div class="sb-section">
          ${visible.map(item => renderNavLink(item, activePage)).join('')}
        </div>`;
    }).join('');
  }

  /* ── User footer ─────────────────────────────────────────── */
  function buildFooterHTML(user) {
    if (!user) return '';
    const initials = (user.display_name || user.username || 'OP')
      .slice(0, 2).toUpperCase();
    const name  = (user.display_name || user.username || 'Operator').toUpperCase();
    const role  = (user.role_name || '—').toUpperCase();
    return `
      <div class="sb-footer__avatar">${initials}</div>
      <div class="sb-footer__info">
        <div class="sb-footer__name">${name}</div>
        <div class="sb-footer__role">${role}</div>
      </div>
      <div class="sb-footer__status" title="Session active">
        <span class="sb-footer__dot"></span>
      </div>`;
  }

  /* ── Public: full render ─────────────────────────────────── */
  function render(activePage = 'dashboard') {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    const user        = Auth.getUser();
    const isCollapsed = localStorage.getItem(COLLAPSED_KEY) === '1';

    sidebar.classList.toggle('sb--collapsed', isCollapsed);
    document.getElementById('app-shell')
      ?.classList.toggle('sidebar-collapsed', isCollapsed);

    sidebar.innerHTML = `
      <div class="sb-logo">
        <div class="sb-logo__mark">
          <span class="sb-logo__bracket">[</span>T<span class="sb-logo__bracket">]</span>
        </div>
        <div class="sb-logo__wordmark">TER<span class="sb-logo__accent">RA</span></div>
        <div class="sb-logo__live">
          <span class="sb-logo__live-dot"></span>
        </div>
        <button class="sb-toggle" id="sb-toggle"
          aria-label="${isCollapsed ? 'Expand' : 'Collapse'} sidebar"
          title="${isCollapsed ? 'Expand' : 'Collapse'} sidebar">
          <span class="sb-toggle__arrow">${isCollapsed ? '›' : '‹'}</span>
        </button>
      </div>

      <div class="sb-ruler">
        <span class="sb-ruler__tick"></span>
        <span class="sb-ruler__label">NAV / SYS</span>
        <span class="sb-ruler__track"><span class="sb-ruler__fill"></span></span>
      </div>

      <nav class="sb-nav" id="sb-nav" role="navigation" aria-label="Primary navigation">
        ${buildNavHTML(activePage)}
      </nav>

      <div class="sb-footer" id="sb-footer">
        ${buildFooterHTML(user)}
      </div>`;

    /* Wire navigation */
    sidebar.querySelectorAll('.sb-link').forEach(btn => {
      btn.addEventListener('click', () => Router.navigate(btn.dataset.page));
    });

    /* Wire collapse toggle */
    document.getElementById('sb-toggle')?.addEventListener('click', () => {
      const collapsed = sidebar.classList.toggle('sb--collapsed');
      document.getElementById('app-shell')
        ?.classList.toggle('sidebar-collapsed', collapsed);
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
      const toggle = document.getElementById('sb-toggle');
      if (toggle) {
        toggle.querySelector('.sb-toggle__arrow').textContent = collapsed ? '›' : '‹';
        toggle.title = (collapsed ? 'Expand' : 'Collapse') + ' sidebar';
        toggle.setAttribute('aria-label', toggle.title);
      }
    });
  }

  /* ── Public: update active without full re-render ────────── */
  function setActivePage(pageId) {
    document.querySelectorAll('.sb-link').forEach(btn => {
      const active = btn.dataset.page === pageId;
      btn.classList.toggle('sb-link--active', active);
      btn.setAttribute('aria-current', active ? 'page' : 'false');
      /* Inject / remove pip */
      btn.querySelector('.sb-link__pip')?.remove();
      if (active) {
        const pip = document.createElement('span');
        pip.className = 'sb-link__pip';
        btn.appendChild(pip);
      }
    });
  }

  return { render, setActivePage };
})();
