/* ============================================================
   TERRA – topbar.js
   Tactical top bar: page identity, live breadcrumb, actions.
   ============================================================ */

const Topbar = (() => {

  const THEME_KEY = 'terra_theme';

  function applyTheme(theme) {
    document.body.classList.toggle('light', theme === 'light');
  }

  function toggleTheme() {
    const next = document.body.classList.contains('light') ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    const icon = document.getElementById('tb-theme-icon');
    if (icon) icon.textContent = next === 'light' ? '◑' : '◐';
    window.dispatchEvent(new CustomEvent('terra:themechange', { detail: { theme: next } }));
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY) || 'dark';
    applyTheme(saved);
  }

  /* ── Page-specific CTA buttons ───────────────────────────── */
  function getActions(pageId) {
    const map = {
      'dashboard':    `<button class="tb-btn tb-btn--primary" data-page="submit-report">+ NEW REPORT</button>`,
      'my-reports':   `<button class="tb-btn tb-btn--primary" data-page="submit-report">+ SUBMIT</button>`,
      'validated':    `<button class="tb-btn" id="btn-export">↓ EXPORT</button>`,
      'users':        `<button class="tb-btn tb-btn--primary" id="btn-invite-user">+ INVITE</button>`,
      'analytics':    `<button class="tb-btn" id="btn-export">↓ EXPORT CSV</button>`,
    };
    return map[pageId] || '';
  }

  /* ── Section breadcrumb label per page ───────────────────── */
  function getSection(pageId) {
    if (['dashboard', 'map'].includes(pageId))                          return 'OVERVIEW';
    if (['submit-report','my-reports','pending','validated'].includes(pageId)) return 'REPORTS';
    if (['site-analysis','test-site','analytics','site-analysis--tracker','site-analysis--data','export'].includes(pageId)) return 'ANALYSIS';
    if (['users','roles','audit-logs'].includes(pageId))                return 'ADMINISTRATION';
    return 'TERRA';
  }

  /* ── Public: render ──────────────────────────────────────── */
  function render(pageId, pageTitle) {
    const topbar = document.getElementById('topbar');
    if (!topbar) return;

    const user       = Auth.getUser();
    const actions    = getActions(pageId);
    const section    = getSection(pageId);
    const themeIcon  = document.body.classList.contains('light') ? '◑' : '◐';
    const initials   = user ? (user.display_name || user.username || 'OP').slice(0, 2).toUpperCase() : '?';
    const username   = user ? (user.display_name || user.username || 'Operator').toUpperCase() : '';

    topbar.innerHTML = `
      <div class="tb-left">
        <div class="tb-identity">
          <span class="tb-identity__section">${section}</span>
          <span class="tb-identity__sep">/</span>
          <span class="tb-identity__page">${pageTitle.toUpperCase()}</span>
        </div>
      </div>

      <div class="tb-right">
        ${actions}
        <div class="tb-divider"></div>
        <button class="tb-icon-btn" id="tb-theme-btn" title="Toggle theme">
          <span id="tb-theme-icon">${themeIcon}</span>
        </button>
        <div class="tb-user" title="${username}">
          <div class="tb-user__avatar">${initials}</div>
          <span class="tb-user__name">${username}</span>
        </div>
        <button class="tb-btn tb-btn--ghost" id="tb-logout-btn">⏻ OUT</button>
      </div>`;

    topbar.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', () => Router.navigate(btn.dataset.page));
    });

    document.getElementById('tb-theme-btn')?.addEventListener('click', toggleTheme);

    document.getElementById('tb-logout-btn')?.addEventListener('click', () => {
      Auth.clearSession();
      window.location.replace('/login.html');
    });
  }

  return { render, initTheme };
})();
