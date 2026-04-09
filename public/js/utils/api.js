/* ============================================================
   TERRA – api.js
   Centralised HTTP client. All API calls go through this module.
   ============================================================ */

const API = (() => {
    /* ── Configuration ───────────────────────────────────────── */
    const BASE_URL = '/api';

    /* ── Internal helper: build request ─────────────────────── */
    async function request(endpoint, options = {}) {
        const token = Auth.getToken();

        const defaultHeaders = {
            'Content-Type': 'application/json',
        };

        if (token) {
            defaultHeaders['Authorization'] = `Bearer ${token}`;
        }

        // For multipart (file uploads) let browser set Content-Type boundary
        if (options.body instanceof FormData) {
            delete defaultHeaders['Content-Type'];
        }

        const config = {
            ...options,
            headers: {
                ...defaultHeaders,
                ...(options.headers || {}),
            },
        };

        let response;
        try {
            response = await fetch(`${BASE_URL}${endpoint}`, config);
        } catch (networkErr) {
            throw new Error('Network error – server may be unreachable.');
        }

        // ── Global 401 Interceptor ──────────────────────────────
        // Any 401 response means the session is invalid/expired.
        // Clear storage and redirect to login so the user isn't
        // trapped on a broken page with a confusing error message.
        if (response.status === 401) {
            Auth.clearSession();
            // Give the current call stack a chance to finish, then redirect
            setTimeout(() => {
                window.location.replace('/login.html');
            }, 100);
            throw new Error('Session expired. Please log in again.');
        }

        // Parse response body
        const contentType = response.headers.get('Content-Type') || '';
        const data = contentType.includes('application/json')
            ? await response.json()
            : await response.text();

        if (!response.ok) {
            const errorMsg = (typeof data === 'object' && data?.error) || `HTTP ${response.status}`;
            throw new Error(errorMsg);
        }

        return data;
    }

    /* ── Public Methods ──────────────────────────────────────── */
    return {
        get: (endpoint) => request(endpoint, { method: 'GET' }),
        post: (endpoint, body) => request(endpoint, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body) }),
        patch: (endpoint, body) => request(endpoint, { method: 'PATCH', body: JSON.stringify(body) }),
        delete: (endpoint) => request(endpoint, { method: 'DELETE' }),
        postForm: (endpoint, form) => request(endpoint, { method: 'POST', body: form }),
    };
})();
