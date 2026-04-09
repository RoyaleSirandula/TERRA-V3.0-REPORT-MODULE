/* ============================================================
  TERRA – statsWidget.js
  "Monitoring Statistics" widget — shows a large metric value,
  a progress range bar, and a secondary count.

  Usage: WidgetRegistry.register(StatsWidget.definition(options))
  ============================================================ */

const StatsWidget = (() => {

  /* ── Internal: render the SVG confidence ring ────────────── */
  function renderRing(container, score) {
    const R = 44;
    const C = 2 * Math.PI * R;
    const fill = (score / 100) * C;

    container.innerHTML = `
      <div class="confidence-ring">
        <svg class="confidence-ring__svg" width="110" height="110" viewBox="0 0 110 110">
          <circle class="confidence-ring__track"  cx="55" cy="55" r="${R}" />
          <circle
            class="confidence-ring__fill"
            cx="55" cy="55" r="${R}"
            stroke-dasharray="${fill} ${C}"
          />
          <text class="confidence-ring__value" x="55" y="51" text-anchor="middle" dominant-baseline="middle">
            ${Math.round(score)}
          </text>
          <text class="confidence-ring__unit"  x="55" y="67" text-anchor="middle">%</text>
        </svg>
        <span class="confidence-ring__label">AI Confidence</span>
      </div>
    `;
  }

  /* ── Internal: build a single monitoring stat block ──────── */
  function buildStatBlock(icon, value, unit, label, percent, rangeMin, rangeMax) {
    const clampedPct = Math.max(0, Math.min(100, percent));
    return `
      <div>
        <div style="display:flex;align-items:baseline;gap:var(--sp-2)">
          <span style="font-size:1.2rem">${icon}</span>
          <span class="monitor-value">${value}</span>
          <span class="monitor-unit">${unit}</span>
        </div>
        <div class="monitor-label">${label}</div>
        <div class="monitor-range mt-3">
          <div class="monitor-range__track">
            <div class="monitor-range__fill" style="width:${clampedPct}%"></div>
            <div class="monitor-range__thumb" style="left:${clampedPct}%"></div>
          </div>
          <div class="monitor-range__labels">
            <span>${rangeMin}</span><span>${rangeMax}</span>
          </div>
        </div>
      </div>
    `;
  }

  /* ── Definition template factory ─────────────────────────── */
  /* Each call creates an independent stats widget definition.  */
  function createDefinition(opts = {}) {
    return {
      id: opts.id || 'monitoring-stats',
      name: opts.name || 'Monitoring Stats',
      icon: opts.icon || '📡',
      desc: opts.desc || 'Key monitoring metrics and AI confidence score.',
      defaultSpan: opts.defaultSpan || 4,
      flush: false,

      render(container, report) {
        const score = Number(report?.ai_confidence_score ?? 0);
        const validatedAt = report?.validated_at ? new Date(report.validated_at) : null;
        const monitoringHours = validatedAt
          ? ((Date.now() - new Date(report.created_at).getTime()) / 3_600_000).toFixed(1)
          : '—';

        container.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:var(--sp-6)">

            <!-- AI Confidence Ring -->
            <div id="conf-ring-${report?.report_id || 'x'}"></div>

            <!-- Time Monitoring -->
            ${buildStatBlock(
          '🕐',
          monitoringHours === '—' ? '—' : monitoringHours,
          'Hrs',
          'Total monitoring duration',
          Math.min((parseFloat(monitoringHours) / 72) * 100 || 0, 100),
          '0', '72h'
        )}

            <!-- Confidence numeric -->
            ${buildStatBlock(
          '🎯',
          Math.round(score),
          '%',
          'AI Confidence Score',
          score,
          '0', '100'
        )}
          </div>
        `;

        // Render ring into its container
        const ringContainer = container.querySelector(`#conf-ring-${report?.report_id || 'x'}`);
        if (ringContainer) renderRing(ringContainer, score);
      }
    };
  }

  /* ── Register default instance on load ───────────────────── */
  WidgetRegistry.register(createDefinition());

  return { createDefinition };
})();
