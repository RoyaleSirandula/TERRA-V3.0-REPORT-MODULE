/* ============================================================
   TERRA – topbar.js
   Tactical top bar: page identity, live breadcrumb, actions,
   and operator preferences panel.

   The user-avatar button opens a floating panel that exposes:
     • Display theme   — Dark / Light
     • Font size       — Normal / Large / X-Large
     • Session logout

   All preference state is delegated to UserPrefs (userPrefs.js).
   The panel is self-contained: it renders into the topbar element,
   registers its own listeners, and tears itself down on outside
   clicks or Escape.
   ============================================================ */

const Topbar = (() => {

    /* ── Preference panel ────────────────────────────────────── */

    /**
     * Builds the inner HTML for the floating preferences panel.
     * Uses aria-pressed on each option button to convey current
     * selection to assistive technologies.
     *
     * @param {string} username  — display name shown in panel header
     * @returns {string}
     */
    function _buildPanelHTML(username) {
        const { theme, fontSize } = UserPrefs.getAll();

        const themeOpts = [
            { value: 'dark',  label: '◐ DARK'  },
            { value: 'light', label: '◑ LIGHT' },
        ].map(o => `
            <button class="tb-pref-btn"
                    data-pref="theme"
                    data-value="${o.value}"
                    aria-pressed="${theme === o.value}">${o.label}</button>
        `).join('');

        const sizeOpts = [
            { value: 'normal', label: 'A',  cls: 'tb-pref-btn--font-normal' },
            { value: 'large',  label: 'A+', cls: 'tb-pref-btn--font-large'  },
            { value: 'xlarge', label: 'A⁺⁺', cls: 'tb-pref-btn--font-xlarge' },
        ].map(o => `
            <button class="tb-pref-btn ${o.cls}"
                    data-pref="fontSize"
                    data-value="${o.value}"
                    aria-pressed="${fontSize === o.value}"
                    title="${o.value.charAt(0).toUpperCase() + o.value.slice(1)} text size">${o.label}</button>
        `).join('');

        return `
        <div class="tb-prefs-panel" id="tb-prefs-panel" role="dialog" aria-label="Operator preferences">
            <div class="tb-prefs-panel__head">
                <div class="tb-prefs-panel__label">Operator</div>
                <div class="tb-prefs-panel__name">${username}</div>
            </div>

            <div class="tb-prefs-section">
                <div class="tb-prefs-section__title">Display Theme</div>
                <div class="tb-prefs-group">${themeOpts}</div>
            </div>

            <div class="tb-prefs-section">
                <div class="tb-prefs-section__title">Font Size</div>
                <div class="tb-prefs-group">${sizeOpts}</div>
            </div>

            <div class="tb-prefs-panel__footer">
                <button class="tb-prefs-panel__logout" id="tb-panel-logout">⏻ END SESSION</button>
            </div>
        </div>`;
    }

    /**
     * Opens the preferences panel.
     * Idempotent — if a panel is already open, nothing happens.
     *
     * @param {HTMLElement} topbarEl   — the <header id="topbar"> element
     * @param {string}      username   — display name for the panel header
     * @param {HTMLElement} triggerBtn — the button that opened the panel
     */
    function _openPanel(topbarEl, username, triggerBtn) {
        if (document.getElementById('tb-prefs-panel')) return;

        topbarEl.insertAdjacentHTML('beforeend', _buildPanelHTML(username));
        triggerBtn.setAttribute('aria-expanded', 'true');

        const panel = document.getElementById('tb-prefs-panel');

        /* Preference option buttons */
        panel.querySelectorAll('[data-pref]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const key   = btn.dataset.pref;
                const value = btn.dataset.value;
                UserPrefs.set(key, value);

                /* Update aria-pressed on sibling buttons in the same group */
                panel.querySelectorAll(`[data-pref="${key}"]`).forEach(b => {
                    b.setAttribute('aria-pressed', String(b.dataset.value === value));
                });
            });
        });

        /* Logout */
        document.getElementById('tb-panel-logout')?.addEventListener('click', () => {
            Auth.clearSession();
            window.location.replace('/login.html');
        });

        /* Close on outside click */
        function _onOutside(e) {
            const panel = document.getElementById('tb-prefs-panel');
            if (!panel) { document.removeEventListener('click', _onOutside, true); return; }
            if (!panel.contains(e.target) && e.target !== triggerBtn && !triggerBtn.contains(e.target)) {
                _closePanel(triggerBtn);
                document.removeEventListener('click', _onOutside, true);
            }
        }

        /* Close on Escape */
        function _onKeydown(e) {
            if (e.key === 'Escape') {
                _closePanel(triggerBtn);
                document.removeEventListener('keydown', _onKeydown);
                document.removeEventListener('click',   _onOutside, true);
                triggerBtn.focus();
            }
        }

        /* Defer listener registration by one tick so the click
           that opened the panel doesn't immediately close it. */
        setTimeout(() => {
            document.addEventListener('click',   _onOutside, true);
            document.addEventListener('keydown', _onKeydown);
        }, 0);
    }

    /**
     * Closes the preferences panel and resets the trigger button state.
     * @param {HTMLElement} triggerBtn
     */
    function _closePanel(triggerBtn) {
        const panel = document.getElementById('tb-prefs-panel');
        if (panel) panel.remove();
        triggerBtn?.setAttribute('aria-expanded', 'false');
    }

    /* ── Page-specific CTA buttons ───────────────────────────── */

    function _getActions(pageId) {
        const map = {
            'dashboard':   `<button class="tb-btn tb-btn--primary" data-page="submit-report">+ NEW REPORT</button>`,
            'my-reports':  `<button class="tb-btn tb-btn--primary" data-page="submit-report">+ SUBMIT</button>`,
            'validated':   `<button class="tb-btn" id="btn-export">↓ EXPORT</button>`,
            'users':       `<button class="tb-btn tb-btn--primary" id="btn-invite-user">+ INVITE</button>`,
            'analytics':   `<button class="tb-btn" id="btn-export">↓ EXPORT CSV</button>`,
        };
        return map[pageId] || '';
    }

    /* ── Section breadcrumb label per page ───────────────────── */

    function _getSection(pageId) {
        if (['dashboard', 'map'].includes(pageId))
            return 'OVERVIEW';
        if (['submit-report', 'my-reports', 'pending', 'validated'].includes(pageId))
            return 'REPORTS';
        if (['site-analysis', 'test-site', 'analytics', 'site-analysis--tracker', 'site-analysis--data', 'export'].includes(pageId))
            return 'ANALYSIS';
        if (['users', 'roles', 'audit-logs'].includes(pageId))
            return 'ADMINISTRATION';
        return 'TERRA';
    }

    /* ── Public: apply stored prefs to DOM (call on boot) ────── */

    /**
     * Must be invoked once, before the first render, so that the
     * correct theme class and font-size attribute are in place
     * before any CSS paint occurs.
     */
    function initTheme() {
        UserPrefs.applyAll();
    }

    /* ── Public: render ──────────────────────────────────────── */

    /**
     * Renders the topbar HTML and wires up all event listeners.
     * Called by the Router on every page navigation.
     *
     * @param {string} pageId
     * @param {string} pageTitle
     */
    function render(pageId, pageTitle) {
        const topbar = document.getElementById('topbar');
        if (!topbar) return;

        /* Close any open panel before re-rendering */
        document.getElementById('tb-prefs-panel')?.remove();

        const user      = Auth.getUser();
        const actions   = _getActions(pageId);
        const section   = _getSection(pageId);
        const username  = user
            ? (user.display_name || user.username || 'Operator').toUpperCase()
            : 'OPERATOR';
        const initials  = username.slice(0, 2);

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
                <button class="tb-user-btn"
                        id="tb-user-btn"
                        aria-expanded="false"
                        aria-haspopup="dialog"
                        aria-label="Operator preferences — ${username}">
                    <div class="tb-user__avatar" aria-hidden="true">${initials}</div>
                    <span class="tb-user__name">${username}</span>
                </button>
            </div>`;

        /* Page CTA buttons */
        topbar.querySelectorAll('[data-page]').forEach(btn => {
            btn.addEventListener('click', () => Router.navigate(btn.dataset.page));
        });

        /* User button → preferences panel toggle */
        const userBtn = document.getElementById('tb-user-btn');
        userBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            const existingPanel = document.getElementById('tb-prefs-panel');
            if (existingPanel) {
                _closePanel(userBtn);
            } else {
                _openPanel(topbar, username, userBtn);
            }
        });
    }

    return { render, initTheme };

})();
