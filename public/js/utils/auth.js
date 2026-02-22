/* ============================================================
   TERRA – auth.js
   Manages the session token and current user context.
   ============================================================ */

const Auth = (() => {
    /* ── Internal State ──────────────────────────────────────── */
    const TOKEN_KEY = 'terra_token';
    const USER_KEY = 'terra_user';

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
    };
})();
