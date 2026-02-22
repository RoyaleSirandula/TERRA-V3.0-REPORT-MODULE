/* ============================================================
   TERRA – toast.js
   Global toast notification system.
   Usage: Toast.show('Message text', 'success' | 'error' | 'warning')
   ============================================================ */

const Toast = (() => {
    /* ── Internal: create and auto-dismiss a toast element ───── */
    function show(message, type = 'success', durationMs = 4000) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const icons = { success: '✅', error: '❌', warning: '⚠️' };

        const toast = document.createElement('div');
        toast.className = `toast toast--${type}`;
        toast.innerHTML = `
      <span class="toast-icon">${icons[type] || '🔔'}</span>
      <span class="toast-message">${message}</span>
    `;

        container.appendChild(toast);

        // Auto-remove after duration
        setTimeout(() => {
            toast.style.animation = 'fadeIn 0.25s reverse both';
            setTimeout(() => toast.remove(), 250);
        }, durationMs);
    }

    /* ── Public API ──────────────────────────────────────────── */
    return {
        success: (msg, ms) => show(msg, 'success', ms),
        error: (msg, ms) => show(msg, 'error', ms),
        warning: (msg, ms) => show(msg, 'warning', ms),
    };
})();
