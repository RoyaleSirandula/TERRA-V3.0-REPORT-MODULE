/* ============================================================
   TERRA – statsWidget.js
   Key monitoring statistics widget, styled to match kpi.html
   impact stats: Bebas Neue headline numbers, Syne labels,
   JetBrains Mono unit tags.
   ============================================================ */

const StatsWidget = (() => {

    /* ── Internal: render a single impact-stat cell ──────────── */
    function statCell(label, num, unit, accent = false) {
        return `
            <div class="stat-cell" style="
                background: var(--clr-surface);
                padding: 28px 24px;
                transition: background var(--transition-normal);
                border-bottom: 1px solid var(--clr-border);
                border-right: 1px solid var(--clr-border);
            ">
                <div style="
                    font-family: var(--font-label);
                    font-size: 10px;
                    font-weight: var(--fw-bold);
                    letter-spacing: 0.16em;
                    text-transform: uppercase;
                    color: var(--clr-text-muted);
                    margin-bottom: 10px;
                ">${label}</div>
                <div style="
                    font-family: var(--font-display);
                    font-size: clamp(36px, 4vw, 52px);
                    line-height: 0.9;
                    color: var(--clr-text);
                    margin-bottom: 8px;
                    letter-spacing: 0.02em;
                ">${num}</div>
                <div style="
                    font-family: var(--font-mono);
                    font-size: 10px;
                    letter-spacing: 0.06em;
                    color: ${accent ? 'var(--clr-brand)' : 'var(--clr-text-muted)'};
                    text-transform: uppercase;
                ">${unit}</div>
            </div>
        `;
    }

    /* ── Internal: derive stat values from report ────────────── */
    function deriveStats(report) {
        const score   = Number(report?.ai_confidence_score ?? 0);
        const tier    = Number(report?.sensitivity_tier ?? 1);
        const tierMap = { 1: 'Public', 2: 'Protected', 3: 'Restricted', 4: 'Confidential' };
        const status  = (report?.validation_status || 'PENDING').toUpperCase();
        const validatedAt = report?.validated_at ? new Date(report.validated_at) : null;
        const createdAt   = report?.created_at   ? new Date(report.created_at)   : new Date();
        const elapsedHrs  = ((Date.now() - createdAt.getTime()) / 3_600_000).toFixed(1);

        const passedCount = Array.isArray(report?.confidence_breakdown)
            ? report.confidence_breakdown.filter(i => i.status === 'PASSED').length
            : 0;

        const riskLabel = score >= 70 ? 'Low Risk' : score >= 40 ? 'Moderate' : 'High Risk';

        return { score, tier, tierMap, status, elapsedHrs, passedCount, riskLabel, validatedAt };
    }

    /* ── Definition ──────────────────────────────────────────── */
    function createDefinition(opts = {}) {
        return {
            id:          opts.id   || 'monitoring-stats',
            name:        opts.name || 'Monitoring Stats',
            icon:        '',
            desc:        'Key monitoring metrics and AI confidence indicators.',
            defaultSpan: opts.defaultSpan || 4,
            flush:       false,

            render(container, report) {
                const { score, tier, tierMap, status, elapsedHrs, passedCount, riskLabel } = deriveStats(report);

                container.innerHTML = `
                    <div style="
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 1px;
                        background: var(--clr-border);
                        height: 100%;
                    ">
                        ${statCell('ICE Confidence', score.toFixed(1), '% Score', true)}
                        ${statCell('Sensitivity', `T${tier}`, tierMap[tier] || 'Classified', false)}
                        ${statCell('Intel Criteria', passedCount, 'Criteria Passed', passedCount > 0)}
                        ${statCell('Field Time', elapsedHrs, 'Hours Active', false)}
                    </div>
                `;
            },
        };
    }

    WidgetRegistry.register(createDefinition());

    return { createDefinition };
})();
