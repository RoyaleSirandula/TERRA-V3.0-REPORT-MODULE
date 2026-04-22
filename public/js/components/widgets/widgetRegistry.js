/* ============================================================
   TERRA – widgetRegistry.js
   Core widget engine. Manages the registered widget catalogue,
   the active widget layout for a report, and "Add Widget" flow.

   HOW TO ADD A NEW WIDGET TYPE:
   1. Create a new file in js/components/widgets/
   2. Define an object matching the WidgetDefinition shape below
   3. Call WidgetRegistry.register(yourDefinition) at the bottom
      of your new file (after this script loads)
   ============================================================ */

const WidgetRegistry = (() => {

    /* ── Private: catalogue of all registered widget types ───── */
    const _catalogue = new Map(); // id → WidgetDefinition

    /* ── Private: active widget instances per report view ─────── */
    let _activeWidgets = [];      // Array of { id, span, instanceId }
    let _gridContainer = null;
    let _currentReport = null;

    /* ──────────────────────────────────────────────────────────
       WidgetDefinition shape:
       {
         id:       string,         // Unique slug, e.g. 'chart-activity'
         name:     string,         // Human label for picker
         icon:     string,         // Emoji or SVG string
         desc:     string,         // Short description for picker
         defaultSpan: number,      // Default column span (3,4,6,8,12)
         render:   (container, report, options) => void
       }
    ─────────────────────────────────────────────────────────── */

    /* ── Public: register a widget type into the catalogue ───── */
    function register(definition) {
        if (!definition.id || !definition.render) {
            console.warn('[WidgetRegistry] Widget definition missing id or render():', definition);
            return;
        }
        _catalogue.set(definition.id, definition);
    }

    /* ── Public: initialize the registry for a given report ──── */
    function init(gridContainer, report, defaultWidgetIds = []) {
        _gridContainer = gridContainer;
        _currentReport = report;

        // Default layout if nothing stored yet
        const stored = _loadLayout(report.report_id);
        _activeWidgets = stored || defaultWidgetIds.map((id, i) => ({
            id,
            span: _catalogue.get(id)?.defaultSpan || 6,
            instanceId: `${id}-${i}`,
        }));

        renderAll();
    }

    /* ── Public: add a widget to the active layout ───────────── */
    function addWidget(widgetId) {
        const def = _catalogue.get(widgetId);
        if (!def) return;

        const instanceId = `${widgetId}-${Date.now()}`;
        _activeWidgets.push({ id: widgetId, span: def.defaultSpan, instanceId });
        _saveLayout();
        renderAll();
    }

    /* ── Public: remove a specific widget instance ───────────── */
    function removeWidget(instanceId) {
        _activeWidgets = _activeWidgets.filter(w => w.instanceId !== instanceId);
        _saveLayout();
        renderAll();
    }

    /* ── Public: return a copy of the catalogue (for picker UI) ─ */
    function getCatalogue() {
        return Array.from(_catalogue.values());
    }

    /* ── Internal: render all active widgets into the grid ────── */
    function renderAll() {
        if (!_gridContainer) return;
        _gridContainer.innerHTML = '';

        _activeWidgets.forEach((w, delay) => {
            const def = _catalogue.get(w.id);
            if (!def) return;

            // Widget shell element
            // def.extraClass (optional) adds modifier classes, e.g. 'widget--map'
            const shell = document.createElement('div');
            shell.className = `widget widget--span-${w.span}${def.extraClass ? ' ' + def.extraClass : ''}`;
            shell.dataset.instanceId = w.instanceId;
            shell.style.animationDelay = `${delay * 0.07}s`;

            shell.innerHTML = `
        <div class="widget__header">
          <div class="widget__title-group">
            <div>
              <div class="widget__title">${def.name}</div>
            </div>
          </div>
          <div class="widget__actions">
            <button class="btn btn--icon btn--sm"
              title="Remove widget"
              data-remove="${w.instanceId}"
              aria-label="Remove ${def.name} widget"
            >✕</button>
          </div>
        </div>
        <div class="widget__body${def.flush ? ' widget--flush' : ''}"></div>
      `;

            // Attach listeners
            shell.querySelector('[data-remove]').addEventListener('click', () => {
                removeWidget(w.instanceId);
            });

            _gridContainer.appendChild(shell);

            // Delegate rendering to widget definition
            const body = shell.querySelector('.widget__body');
            try {
                def.render(body, _currentReport, { span: w.span });
            } catch (err) {
                body.innerHTML = `<p style="color:var(--clr-danger);font-size:var(--text-xs)">⚠ Widget failed to render: ${err.message}</p>`;
            }
        });

        // Always append the "Add Widget" button at the end
        _appendAddWidgetButton();
    }

    /* ── Internal: append the "+" add widget button ──────────── */
    function _appendAddWidgetButton() {
        const btn = document.createElement('button');
        btn.className = 'add-widget-btn widget--span-12';
        btn.innerHTML = `
      <span class="add-widget-btn__icon">＋</span>
      <span>Add Widget</span>
    `;
        btn.addEventListener('click', openWidgetPicker);
        _gridContainer.appendChild(btn);
    }

    /* ── Internal: open the modal to pick a widget ───────────── */
    function openWidgetPicker() {
        const catalogue = getCatalogue();
        const options = catalogue.map(def => `
      <div class="widget-picker-option" data-widget-id="${def.id}" role="button" tabindex="0">
        <span class="widget-picker-option__icon">${def.icon}</span>
        <span class="widget-picker-option__name">${def.name}</span>
        <span class="widget-picker-option__desc">${def.desc}</span>
      </div>
    `).join('');

        Modal.open({
            title: '➕ Add Visualization Widget',
            body: `
        <p style="font-size:var(--text-sm);color:var(--clr-text-muted);margin-bottom:var(--sp-4);">
          Select a widget to add to this report's dashboard.
        </p>
        <div class="widget-picker-grid">${options}</div>
      `,
            onConfirm: null,   // Handled by option click
        });

        // Wire option clicks
        document.querySelectorAll('.widget-picker-option').forEach(el => {
            const activate = () => {
                addWidget(el.dataset.widgetId);
                Modal.close();
                Toast.success(`Widget added!`);
            };
            el.addEventListener('click', activate);
            el.addEventListener('keydown', e => { if (e.key === 'Enter') activate(); });
        });
    }

    /* ── Internal: cycle width spans (3->4->6->8->12) ────────── */
    function _cycleSpan(instanceId) {
        const spans = [3, 4, 6, 8, 12];
        const widget = _activeWidgets.find(w => w.instanceId === instanceId);
        if (!widget) return;

        const currentIdx = spans.indexOf(widget.span);
        const nextIdx = (currentIdx + 1) % spans.length;
        widget.span = spans[nextIdx];

        _saveLayout();
        renderAll();
    }

    /* ── Internal: persist layout to localStorage ─────────────── */
    function _saveLayout() {
        if (!_currentReport) return;
        localStorage.setItem(
            `terra_layout_${_currentReport.report_id}`,
            JSON.stringify(_activeWidgets)
        );
    }

    /* ── Internal: load layout from localStorage ─────────────── */
    function _loadLayout(reportId) {
        try {
            const raw = localStorage.getItem(`terra_layout_${reportId}`);
            return raw ? JSON.parse(raw) : null;
        } catch { return null; }
    }

    /* ── Public API ──────────────────────────────────────────── */
    return { register, init, addWidget, removeWidget, getCatalogue };
})();
