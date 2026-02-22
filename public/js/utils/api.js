/* ============================================================
   TERRA – api.js
   Centralised HTTP client. All API calls go through this module.
   Change the BASE_URL once to update all requests.
   ============================================================ */

const API = (() => {
    /* ── Configuration ───────────────────────────────────────── */
    const BASE_URL = '/api';

    /* ── Internal helper: build request ─────────────────────── */
    async function request(endpoint, options = {}) {
        const token = Auth.getToken();
        console.log(`[API] Request to ${endpoint}. Token found:`, token ? 'YES (truncated)' : 'NO');

        const defaultHeaders = {
            'Content-Type': 'application/json',
        };

        // Attach JWT if available
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

        const response = await fetch(`${BASE_URL}${endpoint}`, config);

        // Parse response
        const data = response.headers.get('Content-Type')?.includes('application/json')
            ? await response.json()
            : await response.text();

        if (!response.ok) {
            const errorMsg = data?.error || `HTTP ${response.status}`;
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
        postForm: (endpoint, formData) => request(endpoint, { method: 'POST', body: formData }),
    };
})();
