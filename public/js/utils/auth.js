/* ============================================================
   TERRA – auth.js
   Manages the session token and current user context.
   ============================================================ */

const Auth = (() => {
    /* ── Internal State ──────────────────────────────────────── */
    const TOKEN_KEY  = 'terra_token';
    const USER_KEY   = 'terra_user';
    const ADMIN_KEY  = 'terra_admin_unlocked';

    /* ── Public API ──────────────────────────────────────────── */
    return {

        /* Save token + user after successful login */
        setSession(token, user) {
            sessionStorage.setItem(TOKEN_KEY, token);
            sessionStorage.setItem(USER_KEY, JSON.stringify(user));
        },

        /* Clear session on logout */
        clearSession() {
            sessionStorage.removeItem(TOKEN_KEY);
            sessionStorage.removeItem(USER_KEY);
            sessionStorage.removeItem(ADMIN_KEY);
        },

        /* Raw token string */
        getToken() {
            return sessionStorage.getItem(TOKEN_KEY);
        },

        /* Parsed user object { user_id, role_name, permissions[], ... } */
        getUser() {
            const raw = sessionStorage.getItem(USER_KEY);
            try { return raw ? JSON.parse(raw) : null; }
            catch { return null; }
        },

        /* Is the user currently logged in? */
        isLoggedIn() {
            return !!this.getToken();
        },

        /* Does the user hold a specific permission slug? */
        hasPermission(permissionSlug) {
            const user = this.getUser();
            if (!user) return false;
            return Array.isArray(user.permissions) && user.permissions.includes(permissionSlug);
        },

        /* Admin privilege elevation — persists for the browser session */
        setAdminUnlocked() {
            sessionStorage.setItem(ADMIN_KEY, '1');
        },
        isAdminUnlocked() {
            return sessionStorage.getItem(ADMIN_KEY) === '1';
        },
        clearAdminUnlocked() {
            sessionStorage.removeItem(ADMIN_KEY);
        },

        /*
         * getCaps()
         *
         * Returns the client-side capability object derived from the
         * current user's role_name.  This mirrors the server-side
         * CAPABILITY_MATRIX in src/utils/capabilities.js — the server
         * always enforces the real gates; this is for UI rendering only.
         *
         * Falls back to the most restrictive (COMMUNITY) set for any
         * unknown or missing role, applying least-privilege by default.
         */
        getCaps() {
            const role = (this.getUser()?.role_name || 'COMMUNITY').toUpperCase();

            const MATRIX = {
                COMMUNITY: {
                    siteAnalysis: {
                        mode: 'restricted',
                        allowedBasemaps: ['satellite'],
                        ownReportsOnly: true,
                        geeAccess: false,
                        drawingTools: false,
                        waterLayer: false,
                        bufferAnalysis: false,
                        ndviAnalysis: false,
                        timelineControl: false,
                        gridResolution: false,
                    },
                    myReports:      { scope: 'own' },
                    sharing:        { canShare: false, canReceive: false, canForward: false },
                    teams:          { canJoin: false, canCreate: false, canManage: false },
                    administration: false,
                },
                RANGER: {
                    siteAnalysis: {
                        mode: 'full',
                        allowedBasemaps: ['satellite', 'aesthetic'],
                        ownReportsOnly: false,
                        geeAccess: true,
                        drawingTools: true,
                        waterLayer: true,
                        bufferAnalysis: true,
                        ndviAnalysis: true,
                        timelineControl: true,
                        gridResolution: true,
                    },
                    myReports:      { scope: 'all' },
                    sharing:        { canShare: true, canReceive: true, canForward: false },
                    teams:          { canJoin: true, canCreate: false, canManage: false },
                    administration: false,
                },
                ANALYST: {
                    siteAnalysis: {
                        mode: 'full',
                        allowedBasemaps: ['satellite', 'aesthetic'],
                        ownReportsOnly: false,
                        geeAccess: true,
                        drawingTools: true,
                        waterLayer: true,
                        bufferAnalysis: true,
                        ndviAnalysis: true,
                        timelineControl: true,
                        gridResolution: true,
                    },
                    myReports:      { scope: 'all' },
                    sharing:        { canShare: true, canReceive: true, canForward: true },
                    teams:          { canJoin: true, canCreate: true, canManage: false },
                    administration: false,
                },
                ADMIN: {
                    siteAnalysis: {
                        mode: 'full',
                        allowedBasemaps: ['satellite', 'aesthetic'],
                        ownReportsOnly: false,
                        geeAccess: true,
                        drawingTools: true,
                        waterLayer: true,
                        bufferAnalysis: true,
                        ndviAnalysis: true,
                        timelineControl: true,
                        gridResolution: true,
                    },
                    myReports:      { scope: 'all' },
                    sharing:        { canShare: true, canReceive: true, canForward: true },
                    teams:          { canJoin: true, canCreate: true, canManage: true },
                    administration: true,
                },
            };

            return MATRIX[role] || MATRIX['COMMUNITY'];
        },

        /*
         * can(capPath)
         *
         * Checks a dot-path capability, e.g.:
         *   Auth.can('siteAnalysis.geeAccess')   → true for RANGER
         *   Auth.can('siteAnalysis.bufferAnalysis') → false for COMMUNITY
         *   Auth.can('sharing.canShare')          → true for RANGER+
         *
         * Returns boolean.  Used in UI components to decide whether to
         * mount (not merely hide) restricted sections.
         */
        can(capPath) {
            const caps   = this.getCaps();
            const actual = capPath.split('.').reduce((obj, key) => obj?.[key], caps);
            return !!actual;
        },
    };
})();
