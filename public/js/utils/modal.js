/* ============================================================
   TERRA – modal.js
   Global modal dialog utility.
   Usage: Modal.open({ title, body (HTML string), onConfirm })
          Modal.close()
   ============================================================ */

const Modal = (() => {
    function open({ title = '', body = '', onConfirm = null, confirmLabel = 'Confirm' }) {
        const container = document.getElementById('modal-container');
        if (!container) return;

        const confirmBtn = onConfirm
            ? `<button class="btn btn--primary" id="modal-confirm-btn">${confirmLabel}</button>`
            : '';

        container.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div class="modal__header">
            <h2 class="modal__title" id="modal-title">${title}</h2>
            <button class="btn btn--icon" id="modal-close-btn" aria-label="Close modal">✕</button>
          </div>
          <div class="modal__body">${body}</div>
          ${confirmBtn ? `<div class="modal__footer mt-6" style="display:flex;gap:var(--sp-3);justify-content:flex-end">
            <button class="btn btn--secondary" id="modal-cancel-btn">Cancel</button>
            ${confirmBtn}
          </div>` : ''}
        </div>
      </div>
    `;

        // Event listeners
        document.getElementById('modal-close-btn').addEventListener('click', Modal.close);
        document.getElementById('modal-cancel-btn')?.addEventListener('click', Modal.close);
        document.getElementById('modal-backdrop').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) Modal.close();
        });

        if (onConfirm) {
            document.getElementById('modal-confirm-btn').addEventListener('click', () => {
                onConfirm();
                Modal.close();
            });
        }
    }

    function close() {
        const container = document.getElementById('modal-container');
        if (container) container.innerHTML = '';
    }

    return { open, close };
})();
