/* ============================================================
   TERRA – chartWidget.js
   Multi-series area/line chart widget powered by Chart.js.
   Registers two variants:
     'chart-activity'  – Report activity over time (area)
     'chart-confidence'– AI confidence distribution (line)

   Requires: Chart.js loaded from CDN in index.html
   ============================================================ */

const ChartWidget = (() => {

    /* ── Terra Chart Defaults ────────────────────────────────── */
    /* Override Chart.js defaults to match Terra's design language */
    function applyTerraTechDefaults() {
        if (typeof Chart === 'undefined') return;
        Chart.defaults.color = 'rgba(200,210,220,0.6)';
        Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
        Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
        Chart.defaults.font.size = 11;
        Chart.defaults.plugins.legend.display = false; // We use custom legend
        Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(13,17,23,0.92)';
        Chart.defaults.plugins.tooltip.borderColor = 'rgba(52,211,153,0.3)';
        Chart.defaults.plugins.tooltip.borderWidth = 1;
        Chart.defaults.plugins.tooltip.padding = 10;
        Chart.defaults.plugins.tooltip.titleColor = '#e6edf3';
        Chart.defaults.plugins.tooltip.bodyColor = 'rgba(200,210,220,0.8)';
        Chart.defaults.plugins.tooltip.cornerRadius = 8;
    }

    /* ── Terra Colour Palette for series ────────────────────── */
    const PALETTE = [
        { line: '#34d399', area: 'rgba(52,211,153,0.15)' },   // brand-green
        { line: '#818cf8', area: 'rgba(129,140,248,0.12)' },   // purple
        { line: '#f97316', area: 'rgba(249,115,22,0.12)' },    // orange
        { line: '#38bdf8', area: 'rgba(56,189,248,0.10)' },    // cyan
    ];

    /* ── Internal: build a gradient for area fills ───────────── */
    function buildGradient(ctx, hex, canvasHeight) {
        const gradient = ctx.createLinearGradient(0, 0, 0, canvasHeight);
        gradient.addColorStop(0, hex.replace('0.15', '0.28').replace('0.12', '0.22').replace('0.10', '0.18'));
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        return gradient;
    }

    /* ── Internal: generate fake report activity data ─────────── */
    function generateActivityData(report) {
        const createdAt = new Date(report?.created_at || Date.now());
        const labels = [];
        const datasets = {
            sightings: [],
            confidence: [],
            anomalies: [],
        };

        // Align chart to show 12 hours leading up to and including the sighting
        for (let h = -11; h <= 0; h++) {
            const d = new Date(createdAt);
            d.setHours(d.getHours() + h);
            labels.push(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

            // Actual score is stable, sightings is 0 except for the actual event
            const baseConf = Number(report?.ai_confidence_score ?? 65);

            // Sighting occurs at index 11 (the 'current' hour)
            datasets.sightings.push(h === 0 ? 1 : 0);

            // Confidence is only relevant at point of sighting, but showing a stable trend is clearer
            datasets.confidence.push(baseConf);

            // No anomalies for new/single reports
            datasets.anomalies.push(0);
        }

        return { labels, datasets };
    }

    /* ── Internal: mount a Chart.js chart ───────────────────── */
    function mountChart(canvasId, config) {
        if (typeof Chart === 'undefined') return;
        const existing = Chart.getChart(canvasId);
        if (existing) existing.destroy();
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        new Chart(canvas, config);
    }

    /* ── Widget Definition: Activity Area Chart ─────────────── */
    const activityDefinition = {
        id: 'chart-activity',
        name: 'Activity Chart',
        icon: '📈',
        desc: 'Multi-series area chart: sightings, AI confidence, and anomalies over time.',
        defaultSpan: 8,
        flush: false,

        render(container, report) {
            applyTerraTechDefaults();
            const uid = `chart-activity-${report?.report_id?.slice(0, 8) || Date.now()}`;
            const { labels, datasets } = generateActivityData(report);

            container.innerHTML = `
        <div class="chart-legend">
          <div class="chart-legend__item">
            <span class="chart-legend__dot" style="background:#34d399"></span>Sightings
          </div>
          <div class="chart-legend__item">
            <span class="chart-legend__dot" style="background:#818cf8"></span>AI Confidence %
          </div>
          <div class="chart-legend__item">
            <span class="chart-legend__dot" style="background:#f97316"></span>Anomalies
          </div>
        </div>
        <div class="chart-canvas-wrap">
          <canvas id="${uid}" height="200"></canvas>
        </div>
      `;

            // Defer to let the canvas render in the DOM
            requestAnimationFrame(() => {
                const canvas = document.getElementById(uid);
                if (!canvas) return;
                const ctx = canvas.getContext('2d');
                const h = canvas.offsetHeight || 200;

                mountChart(uid, {
                    type: 'line',
                    data: {
                        labels,
                        datasets: [
                            {
                                label: 'Sightings',
                                data: datasets.sightings,
                                borderColor: PALETTE[0].line,
                                backgroundColor: buildGradient(ctx, PALETTE[0].area, h),
                                fill: true,
                                tension: 0.45,
                                pointRadius: 3,
                                pointBackgroundColor: PALETTE[0].line,
                                borderWidth: 2,
                            },
                            {
                                label: 'AI Confidence',
                                data: datasets.confidence,
                                borderColor: PALETTE[1].line,
                                backgroundColor: buildGradient(ctx, PALETTE[1].area, h),
                                fill: true,
                                tension: 0.45,
                                pointRadius: 2,
                                pointBackgroundColor: PALETTE[1].line,
                                borderWidth: 1.5,
                                yAxisID: 'yConf',
                            },
                            {
                                label: 'Anomalies',
                                data: datasets.anomalies,
                                borderColor: PALETTE[2].line,
                                backgroundColor: 'transparent',
                                fill: false,
                                tension: 0.2,
                                pointRadius: 5,
                                pointBackgroundColor: PALETTE[2].line,
                                borderWidth: 1.5,
                                type: 'bar',
                                yAxisID: 'yAnomaly',
                            },
                        ],
                    },
                    options: {
                        responsive: true,
                        interaction: { mode: 'index', intersect: false },
                        animation: { duration: 700, easing: 'easeOutQuart' },
                        scales: {
                            x: {
                                grid: { color: 'rgba(255,255,255,0.04)' },
                                ticks: { maxTicksLimit: 6 },
                            },
                            y: {
                                position: 'left',
                                grid: { color: 'rgba(255,255,255,0.04)' },
                                ticks: { maxTicksLimit: 5 },
                            },
                            yConf: {
                                position: 'right',
                                min: 0, max: 100,
                                grid: { display: false },
                                ticks: { callback: v => v + '%', maxTicksLimit: 4 },
                            },
                            yAnomaly: {
                                display: false,
                                min: 0,
                            },
                        },
                    },
                });
            });
        }
    };

    /* ── Widget Definition: Distribution Bar Chart ───────────── */
    const distributionDefinition = {
        id: 'chart-distribution',
        name: 'Confidence Distribution',
        icon: '📊',
        desc: 'Bar chart showing AI confidence distribution across report validations.',
        defaultSpan: 6,
        flush: false,

        render(container, report) {
            applyTerraTechDefaults();
            const uid = `chart-dist-${report?.report_id?.slice(0, 8) || Date.now()}`;
            const labels = ['0-20', '20-40', '40-60', '60-80', '80-100'];
            const base = Number(report?.ai_confidence_score ?? 65);

            // Generate a simulated bell distribution centred around the report's score
            const data = labels.map((_, i) => {
                const mid = (i + 0.5) * 20;
                const dist = Math.exp(-Math.pow((mid - base) / 25, 2)) * 30 + Math.random() * 5;
                return Math.round(dist);
            });

            container.innerHTML = `
        <div class="chart-legend">
          <div class="chart-legend__item">
            <span class="chart-legend__dot" style="background:#34d399"></span>Report confidence %
          </div>
        </div>
        <div class="chart-canvas-wrap">
          <canvas id="${uid}" height="180"></canvas>
        </div>
      `;

            requestAnimationFrame(() => {
                mountChart(uid, {
                    type: 'bar',
                    data: {
                        labels,
                        datasets: [{
                            label: 'Count',
                            data,
                            backgroundColor: data.map((_, i) => PALETTE[i % PALETTE.length].line + 'cc'),
                            borderColor: data.map((_, i) => PALETTE[i % PALETTE.length].line),
                            borderWidth: 1,
                            borderRadius: 4,
                        }],
                    },
                    options: {
                        responsive: true,
                        animation: { duration: 700, easing: 'easeOutQuart' },
                        scales: {
                            x: { grid: { color: 'rgba(255,255,255,0.04)' } },
                            y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { maxTicksLimit: 4 } },
                        },
                    },
                });
            });
        }
    };

    /* ── Register both on load ───────────────────────────────── */
    WidgetRegistry.register(activityDefinition);
    WidgetRegistry.register(distributionDefinition);

    return {};
})();
