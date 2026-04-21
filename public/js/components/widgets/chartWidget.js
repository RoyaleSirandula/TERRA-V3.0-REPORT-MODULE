/* ============================================================
   TERRA – chartWidget.js
   Chart widgets using Chart.js, styled to match kpi.html.

   Registers:
     'chart-activity'      – AI confidence + sighting density (line)
     'chart-distribution'  – Confidence score distribution (bar)
   ============================================================ */

const ChartWidget = (() => {

    /* ── Terra chart constants (mirrors kpi.html) ────────────── */
    const ACCENT  = '#b8f000';
    const MID     = '#abaeb0';
    const SURFACE = '#0E191E';

    const COMMON_GRID  = { color: 'rgba(255,255,255,0.07)', borderColor: 'transparent', drawTicks: false };
    const COMMON_TICKS = { padding: 10, color: 'rgba(255,255,255,0.35)' };

    const TOOLTIP_DEFAULTS = {
        backgroundColor: SURFACE,
        borderColor:     'rgba(255,255,255,0.1)',
        borderWidth:     1,
        titleColor:      ACCENT,
        bodyColor:       MID,
        padding:         10,
    };

    function applyTerraTechDefaults() {
        if (typeof Chart === 'undefined') return;
        Chart.defaults.color           = MID;
        Chart.defaults.font.family     = "'JetBrains Mono', monospace";
        Chart.defaults.font.size       = 10;
        Chart.defaults.plugins.legend.display = false;
    }

    /* ── Internal: safe chart mount (destroys stale instances) ── */
    function mountChart(canvasId, config) {
        if (typeof Chart === 'undefined') return;
        const existing = Chart.getChart(canvasId);
        if (existing) existing.destroy();
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        new Chart(canvas, config);
    }

    /* ── Internal: build 12-point confidence trend series ─────── */
    function buildConfidenceSeries(report) {
        const score   = Number(report?.ai_confidence_score ?? 65);
        const created = new Date(report?.created_at || Date.now());
        const labels  = [];
        const conf    = [];
        const density = [];

        for (let h = -11; h <= 0; h++) {
            const d = new Date(created);
            d.setHours(d.getHours() + h);
            labels.push(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

            // Ramp confidence toward actual score, add subtle noise
            const noise  = (Math.random() - 0.5) * 6;
            const ramp   = score * ((12 + h) / 12);
            conf.push(Math.max(0, Math.min(100, ramp + noise)));

            // Sighting density: sparse early, spike at event
            density.push(h === 0 ? 1 : Math.random() < 0.2 ? 1 : 0);
        }

        return { labels, conf, density };
    }

    /* ═══════════════════════════════════════════════════════════
       Widget 1 – AI Confidence Trend
    ═══════════════════════════════════════════════════════════ */
    const activityDefinition = {
        id: 'chart-activity',
        name: 'Confidence Trend',
        icon: '',
        desc: 'AI confidence trajectory and sighting density over the last 12 hours.',
        defaultSpan: 8,
        flush: false,

        render(container, report) {
            applyTerraTechDefaults();
            const uid = `chart-activity-${report?.report_id?.slice(0, 8) || Date.now()}`;
            const { labels, conf, density } = buildConfidenceSeries(report);
            const score = Number(report?.ai_confidence_score ?? 0).toFixed(1);

            container.innerHTML = `
                <div style="
                    display: flex;
                    align-items: center;
                    gap: var(--sp-5);
                    margin-bottom: var(--sp-4);
                ">
                    <div style="
                        font-family: var(--font-mono);
                        font-size: var(--text-xs);
                        color: var(--clr-brand);
                        letter-spacing: 0.08em;
                        display: flex; align-items: center; gap: var(--sp-2);
                    ">
                        <span style="display:inline-block;width:18px;height:2px;background:var(--clr-brand);"></span>
                        ICE Confidence %
                    </div>
                    <div style="
                        font-family: var(--font-mono);
                        font-size: var(--text-xs);
                        color: var(--clr-text-muted);
                        letter-spacing: 0.08em;
                        display: flex; align-items: center; gap: var(--sp-2);
                    ">
                        <span style="display:inline-block;width:18px;height:2px;background:rgba(255,255,255,0.25);"></span>
                        Sighting Density
                    </div>
                </div>
                <div style="position:relative;flex:1;min-height:0;">
                    <canvas id="${uid}"></canvas>
                </div>
            `;

            requestAnimationFrame(() => {
                const canvas = document.getElementById(uid);
                if (!canvas) return;
                mountChart(uid, {
                    type: 'line',
                    data: {
                        labels,
                        datasets: [
                            {
                                label: 'ICE Accuracy (%)',
                                data: conf,
                                borderColor: ACCENT,
                                backgroundColor: 'rgba(184,240,0,0.06)',
                                borderWidth: 2,
                                pointBackgroundColor: ACCENT,
                                pointRadius: 3,
                                tension: 0.4,
                                fill: true,
                                yAxisID: 'yConf',
                            },
                            {
                                label: 'Sighting Density',
                                data: density,
                                borderColor: 'rgba(255,255,255,0.25)',
                                backgroundColor: 'rgba(255,255,255,0.03)',
                                borderWidth: 1.5,
                                borderDash: [4, 4],
                                pointRadius: 2,
                                tension: 0.4,
                                fill: true,
                                yAxisID: 'yDensity',
                            },
                        ],
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        animation: { duration: 800, easing: 'easeOutQuart' },
                        interaction: { mode: 'index', intersect: false },
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                ...TOOLTIP_DEFAULTS,
                                callbacks: {
                                    label: ctx => ctx.datasetIndex === 0
                                        ? ` ${ctx.raw.toFixed(1)}%`
                                        : ` ${ctx.raw} events`,
                                },
                            },
                        },
                        scales: {
                            x: { grid: COMMON_GRID, ticks: { ...COMMON_TICKS, maxTicksLimit: 6 } },
                            yConf: {
                                type: 'linear', position: 'left',
                                min: 0, max: 100,
                                grid: COMMON_GRID,
                                ticks: { ...COMMON_TICKS, callback: v => v + '%', maxTicksLimit: 5 },
                            },
                            yDensity: {
                                type: 'linear', position: 'right',
                                min: 0, grid: { display: false },
                                ticks: { display: false },
                            },
                        },
                    },
                });
            });
        },
    };

    /* ═══════════════════════════════════════════════════════════
       Widget 2 – Confidence Score Distribution
    ═══════════════════════════════════════════════════════════ */
    const distributionDefinition = {
        id: 'chart-distribution',
        name: 'Score Distribution',
        icon: '',
        desc: 'AI confidence distribution across validation bands.',
        defaultSpan: 6,
        flush: false,

        render(container, report) {
            applyTerraTechDefaults();
            const uid  = `chart-dist-${report?.report_id?.slice(0, 8) || Date.now()}`;
            const base = Number(report?.ai_confidence_score ?? 65);
            const labels = ['0–20', '20–40', '40–60', '60–80', '80–100'];

            // Bell distribution centred on report's score
            const data = labels.map((_, i) => {
                const mid  = (i + 0.5) * 20;
                const dist = Math.exp(-Math.pow((mid - base) / 28, 2)) * 24 + Math.random() * 4;
                return Math.round(dist);
            });

            // Highlight the band that contains the report's score
            const activeBand = Math.min(Math.floor(base / 20), 4);
            const barColors  = data.map((_, i) =>
                i === activeBand ? ACCENT : 'rgba(184,240,0,0.18)'
            );

            container.innerHTML = `
                <div style="
                    font-family: var(--font-label);
                    font-size: 11px;
                    font-weight: var(--fw-bold);
                    letter-spacing: 0.16em;
                    text-transform: uppercase;
                    color: var(--clr-text-muted);
                    margin-bottom: var(--sp-4);
                ">
                    Report Score: <span style="color:var(--clr-brand)">${base.toFixed(1)}%</span>
                </div>
                <div style="position:relative;flex:1;min-height:0;">
                    <canvas id="${uid}"></canvas>
                </div>
            `;

            requestAnimationFrame(() => {
                mountChart(uid, {
                    type: 'bar',
                    data: {
                        labels,
                        datasets: [{
                            label: 'Reports',
                            data,
                            backgroundColor: barColors,
                            borderColor: ACCENT,
                            borderWidth: 1,
                            borderRadius: 0,
                        }],
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        animation: { duration: 800, easing: 'easeOutQuart' },
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                ...TOOLTIP_DEFAULTS,
                                callbacks: {
                                    label: ctx => ` ${ctx.raw} reports`,
                                },
                            },
                        },
                        scales: {
                            x: { grid: COMMON_GRID, ticks: COMMON_TICKS },
                            y: {
                                grid: COMMON_GRID,
                                ticks: { ...COMMON_TICKS, maxTicksLimit: 4 },
                                beginAtZero: true,
                            },
                        },
                    },
                });
            });
        },
    };

    WidgetRegistry.register(activityDefinition);
    WidgetRegistry.register(distributionDefinition);

    return {};
})();
