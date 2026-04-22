/* ============================================================
   TERRA – topbar.js
   Renders the top header bar with page title and action buttons.
   Called by the router when a page changes.
   ============================================================ */

const Topbar = (() => {

  /* ── Theme persistence ───────────────────────────────────── */
  const THEME_KEY = 'terra_theme';

  function applyTheme(theme) {
    document.body.classList.toggle('light', theme === 'light');
  }

  function toggleTheme() {
    const next = document.body.classList.contains('light') ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    const btn = document.getElementById('topbar-theme-btn');
    if (btn) btn.textContent = next === 'light' ? '☾' : '☀';
    window.dispatchEvent(new CustomEvent('terra:themechange', { detail: { theme: next } }));
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY) || 'dark';
    applyTheme(saved);
  }

  /* ── Internal: build action buttons based on context ─────── */
  function getActionsForPage(pageId) {
    const actionMap = {
      'dashboard': `<button class="btn btn--primary btn--sm" data-page="submit-report">+ New Report</button>`,
      'my-reports': `<button class="btn btn--primary btn--sm" data-page="submit-report">+ Submit</button>`,
      'pending': ``,
      'validated': `<button class="btn btn--secondary btn--sm" id="btn-export">⬇ Export</button>`,
      'users': `<button class="btn btn--primary btn--sm" id="btn-invite-user">+ Invite User</button>`,
      'roles': ``,
      'audit-logs': ``,
      'submit-report': ``,
      'analytics': `<button class="btn btn--secondary btn--sm" id="btn-export">⬇ Export CSV</button>`,
    };
    return actionMap[pageId] || '';
  }

  /* ── Internal: user profile pill ────────────────────────── */
  function buildProfilePill(user) {
    if (!user) return '';
    const initials = (user.username || '?').slice(0, 2).toUpperCase();
    return `
      <button class="btn btn--icon" id="topbar-profile-btn" title="${user.username}">
        <span style="font-size:var(--text-sm);font-weight:var(--fw-bold)">${initials}</span>
      </button>
    `;
  }

  /* ── Public: render topbar ───────────────────────────────── */
  function render(pageId, pageTitle) {
    const topbar = document.getElementById('topbar');
    if (!topbar) return;

    const user = Auth.getUser();
    const actions = getActionsForPage(pageId);

    topbar.innerHTML = `
      <div class="topbar__left">
        <span class="topbar__page-title">${pageTitle}</span>
      </div>
      <div class="topbar__right">
        ${actions}
        <button class="btn btn--icon" id="topbar-theme-btn" title="Toggle light / dark mode">${document.body.classList.contains('light') ? '☾' : '☀'}</button>
        ${buildProfilePill(user)}
        <button class="btn btn--secondary btn--sm" id="topbar-logout-btn" title="Sign out">⏻ Sign Out</button>
      </div>
    `;

    // Wire up any action buttons that route to pages
    topbar.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', () => Router.navigate(btn.dataset.page));
    });

    // Theme toggle
    document.getElementById('topbar-theme-btn')?.addEventListener('click', toggleTheme);

    // Logout
    document.getElementById('topbar-logout-btn')?.addEventListener('click', () => {
      Auth.clearSession();
      window.location.replace('/login.html');
    });
  }

  return { render, initTheme };
})();
