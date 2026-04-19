/* ============================================================
   TERRA – analytics.js
   Analytics & Data Intelligence page.

   Fetches all validated sightings and renders client-side:
     ✦ Hero strip   — headline figures + date context
     ✦ KPI grid     — 4 top-line stats, card-grid pattern
     ✦ Trend chart  — 12-month validated records, line + fill
     ✦ Species chart — top-10 frequency, horizontal bars
     ✦ Tier donut   — sensitivity classification breakdown
     ✦ Conf. histogram — AI confidence score distribution
     ✦ Coverage panel — data freshness + span
     ✦ Species table — all taxa ranked, inline bar + % share

   Data source: GET /analysis/sightings (validated only)

   Navigation: Router.navigate('analytics')
   ============================================================ */

const AnalyticsPage = (() => {

    /* ── Chart instance tracker — destroyed on every re-render ── */
    let _charts = [];

    function destroyCharts() {
        _charts.forEach(c => { try { c.destroy(); } catch (e) {} });
        _charts = [];
    }

    function makeChart(ctx, config) {
        const c = new Chart(ctx, config);
        _charts.push(c);
        return c;
    }

    /* ── Number helpers ──────────────────────────────────────── */
    function fmtNum(n) {
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return String(n);
    }

    function toMonth(dateStr) {
        const d = new Date(dateStr);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }

    /* Returns an array of YYYY-MM strings for the last n calendar months */
    function lastNMonths(n) {
        const out = [];
        const now = new Date();
        for (let i = n - 1; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }
        return out;
    }

    /* ── Shared Chart.js aesthetic config ───────────────────── */
    function applyChartDefaults() {
        Chart.defaults.color = '#7d8693';
        Chart.defaults.font.family = "'JetBrains Mono', monospace";
        Chart.defaults.font.size = 10;
    }

    const TOOLTIP = {
        backgroundColor: '#161b22',
        borderColor: 'rgba(255,255,255,0.10)',
        borderWidth: 1,
        titleColor: '#b8f000',
        bodyColor: '#7d8693',
        padding: 10,
        cornerRadius: 0,
    };

    const GRID  = { color: 'rgba(255,255,255,0.05)', borderColor: 'transparent', drawTicks: false };
    const TICKS = { padding: 8, color: 'rgba(255,255,255,0.25)' };

    /* ══════════════════════════════════════════════════════════
       DATA ANALYSIS
       All derived stats are computed from the raw API array so
       the page works offline once data is fetched.
    ══════════════════════════════════════════════════════════ */

    function analyse(records) {
        const total = records.length;

        /* ── Unique species ── */
        const speciesSet = new Set();
        records.forEach(r => {
            const key = r.species_id || r.species_name;
            if (key && key !== 'Unknown Species') speciesSet.add(key);
        });

        /* ── Average AI confidence ── */
        const confs = records.map(r => parseFloat(r.ai_confidence_score)).filter(n => !isNaN(n));
        const avgConf = confs.length
            ? (confs.reduce((a, b) => a + b, 0) / confs.length).toFixed(1)
            : '—';

        /* ── Date range ── */
        const dates = records.map(r => new Date(r.created_at)).filter(d => !isNaN(d));
        const oldest = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : null;
        const newest = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : null;

        /* ── Monthly trend (last 12 months) ── */
        const months = lastNMonths(12);
        const monthCounts = {};
        months.forEach(m => { monthCounts[m] = 0; });
        records.forEach(r => {
            const m = toMonth(r.created_at);
            if (Object.prototype.hasOwnProperty.call(monthCounts, m)) monthCounts[m]++;
        });

        /* ── Species frequency map ── */
        const speciesFreq = {};
        records.forEach(r => {
            const key = r.species_name || r.species_id || 'Unknown';
            if (key === 'Unknown Species' || key === 'Unknown') return;
            speciesFreq[key] = (speciesFreq[key] || 0) + 1;
        });
        const allSpecies = Object.entries(speciesFreq).sort((a, b) => b[1] - a[1]);
        const topSpecies = allSpecies.slice(0, 10);

        /* ── Sensitivity tier distribution ── */
        const tierCount = { 1: 0, 2: 0, 3: 0, 4: 0 };
        records.forEach(r => {
            const t = parseInt(r.sensitivity_tier) || 1;
            if (tierCount[t] !== undefined) tierCount[t]++;
        });

        /* ── AI confidence histogram (5 × 20-point buckets) ── */
        const confBuckets = [0, 0, 0, 0, 0];
        confs.forEach(c => { confBuckets[Math.min(Math.floor(c / 20), 4)]++; });

        /* ── 30-day activity ── */
        const cutoff30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const recent30 = records.filter(r => new Date(r.created_at).getTime() >= cutoff30).length;

        return {
            total, speciesCount: speciesSet.size, avgConf,
            oldest, newest, months, monthCounts,
            topSpecies, allSpecies, tierCount, confBuckets, recent30,
        };
    }

    /* ══════════════════════════════════════════════════════════
       HTML BUILDERS
    ══════════════════════════════════════════════════════════ */

    function buildHero(stats) {
        const range = (stats.oldest && stats.newest)
            ? `${stats.oldest.toLocaleDateString()} – ${stats.newest.toLocaleDateString()}`
            : 'No date range available';

        return `
        <div class="an-hero anim-fade-in">
            <div class="an-hero__left">
                <div class="an-hero__eyebrow">Terra Intelligence Layer</div>
                <h1 class="an-hero__title">Analytics<br>&amp; Trends</h1>
                <div class="an-hero__range">${range}</div>
            </div>
            <div class="an-hero__right">
                <div class="an-hero__fig">
                    <div class="an-hero__fig-val">${fmtNum(stats.total)}</div>
                    <div class="an-hero__fig-label">Validated Records</div>
                </div>
                <div class="an-hero__divider"></div>
                <div class="an-hero__fig">
                    <div class="an-hero__fig-val">${stats.speciesCount}</div>
                    <div class="an-hero__fig-label">Species Tracked</div>
                </div>
                <div class="an-hero__divider"></div>
                <div class="an-hero__fig">
                    <div class="an-hero__fig-val">${stats.avgConf}<span class="an-hero__fig-unit">%</span></div>
                    <div class="an-hero__fig-label">Avg Confidence</div>
                </div>
            </div>
        </div>
        `;
    }

    function buildKPIs(stats) {
        const kpis = [
            {
                label: 'Total Validated',
                value: fmtNum(stats.total),
                sub: 'All-time records',
                accent: false,
            },
            {
                label: 'Unique Species',
                value: stats.speciesCount,
                sub: 'Taxa tracked',
                accent: true,
            },
            {
                label: 'Avg AI Confidence',
                value: `${stats.avgConf}%`,
                sub: 'Intelligence score',
                accent: false,
            },
            {
                label: 'Last 30 Days',
                value: stats.recent30,
                sub: 'New sightings',
                accent: stats.recent30 > 0,
            },
        ];

        return `
        <div class="an-kpi-grid">
            ${kpis.map((k, i) => `
            <div class="an-kpi reveal ${i > 0 ? 'd' + i : ''}">
                <div class="an-kpi__label">${k.label}</div>
                <div class="an-kpi__value ${k.accent ? 'an-kpi__value--accent' : ''}">${k.value}</div>
                <div class="an-kpi__sub">${k.sub}</div>
            </div>
            `).join('')}
        </div>
        `;
    }

    function buildChartsSection() {
        return `
        <!-- Primary 2-col charts -->
        <div class="an-chart-row">
            <div class="an-chart-panel reveal">
                <div class="an-chart-panel__eyebrow">Sighting Trend</div>
                <div class="an-chart-panel__title">Monthly Validated Records — 12-Month Window</div>
                <div class="an-chart-wrap">
                    <canvas id="an-chart-trend"></canvas>
                </div>
            </div>
            <div class="an-chart-panel reveal d1">
                <div class="an-chart-panel__eyebrow">Species Intelligence</div>
                <div class="an-chart-panel__title">Top 10 Species by Sighting Frequency</div>
                <div class="an-chart-wrap">
                    <canvas id="an-chart-species"></canvas>
                </div>
            </div>
        </div>

        <!-- Secondary 3-col charts -->
        <div class="an-sub-row">
            <div class="an-chart-panel reveal">
                <div class="an-chart-panel__eyebrow">Sensitivity Classification</div>
                <div class="an-chart-panel__title">Tier Distribution</div>
                <div class="an-chart-wrap an-chart-wrap--sm">
                    <canvas id="an-chart-tier"></canvas>
                </div>
            </div>
            <div class="an-chart-panel reveal d1">
                <div class="an-chart-panel__eyebrow">Model Performance</div>
                <div class="an-chart-panel__title">AI Confidence Score Histogram</div>
                <div class="an-chart-wrap an-chart-wrap--sm">
                    <canvas id="an-chart-conf"></canvas>
                </div>
            </div>
            <div class="an-chart-panel reveal d2">
                <div class="an-chart-panel__eyebrow">Dataset Coverage</div>
                <div class="an-chart-panel__title">Record Span &amp; Freshness</div>
                <div id="an-coverage"></div>
            </div>
        </div>
        `;
    }

    function buildTable(stats) {
        const maxCount = stats.allSpecies[0]?.[1] || 1;
        const rows = stats.allSpecies.map(([species, count], i) => {
            const pct   = ((count / stats.total) * 100).toFixed(1);
            const barW  = Math.max(2, (count / maxCount) * 100);
            return `
            <div class="an-tr reveal" style="animation-delay:${Math.min(i * 0.025, 0.6)}s">
                <div class="an-tr__rank">${String(i + 1).padStart(2, '0')}</div>
                <div class="an-tr__species">${species}</div>
                <div class="an-tr__bar">
                    <div class="an-tr__bar-fill" style="width:${barW}%"></div>
                </div>
                <div class="an-tr__count">${count}</div>
                <div class="an-tr__pct">${pct}%</div>
            </div>
            `;
        }).join('') || `<div class="an-empty">No species data available.</div>`;

        return `
        <div class="an-table-section reveal">
            <div class="an-table-header">
                <div>
                    <div class="an-table-header__eyebrow">Species Intelligence Matrix</div>
                    <div class="an-table-header__title">All Tracked Taxa — Ranked by Frequency</div>
                </div>
                <div class="an-table-header__meta">${stats.allSpecies.length} species · ${fmtNum(stats.total)} records</div>
            </div>
            <div class="an-th">
                <div>#</div>
                <div>Species</div>
                <div>Frequency</div>
                <div>Count</div>
                <div>Share</div>
            </div>
            <div class="an-tbody">
                ${rows}
            </div>
        </div>
        `;
    }

    /* ══════════════════════════════════════════════════════════
       CHART MOUNTING
    ══════════════════════════════════════════════════════════ */

    function mountCharts(stats) {
        /* ── Month axis labels ── */
        const monthLabels = stats.months.map(m => {
            const [y, mo] = m.split('-');
            return new Date(parseInt(y), parseInt(mo) - 1, 1)
                .toLocaleString('en', { month: 'short', year: '2-digit' });
        });

        /* ── Trend line ── */
        const trendCanvas = document.getElementById('an-chart-trend');
        if (trendCanvas) {
            makeChart(trendCanvas.getContext('2d'), {
                type: 'line',
                data: {
                    labels: monthLabels,
                    datasets: [{
                        data: stats.months.map(m => stats.monthCounts[m] || 0),
                        borderColor: '#b8f000',
                        backgroundColor: 'rgba(184,240,0,0.06)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 3,
                        pointHoverRadius: 5,
                        pointBackgroundColor: '#b8f000',
                        pointBorderColor: '#0d1117',
                        pointBorderWidth: 2,
                        borderWidth: 2,
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            ...TOOLTIP,
                            callbacks: {
                                title: items => items[0].label,
                                label: item => `  ${item.raw} sightings`,
                            }
                        },
                    },
                    scales: {
                        x: { grid: GRID, ticks: TICKS, border: { display: false } },
                        y: { grid: GRID, ticks: { ...TICKS, precision: 0 }, border: { display: false }, beginAtZero: true },
                    },
                }
            });
        }

        /* ── Species horizontal bars ── */
        const speciesCanvas = document.getElementById('an-chart-species');
        if (speciesCanvas && stats.topSpecies.length > 0) {
            const maxC = stats.topSpecies[0]?.[1] || 1;
            makeChart(speciesCanvas.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: stats.topSpecies.map(([s]) => s.length > 20 ? s.slice(0, 18) + '…' : s),
                    datasets: [{
                        data: stats.topSpecies.map(([, c]) => c),
                        backgroundColor: stats.topSpecies.map(([, c]) =>
                            `rgba(184,240,0,${0.20 + (c / maxC) * 0.70})`
                        ),
                        borderColor: 'rgba(184,240,0,0.30)',
                        borderWidth: 1,
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            ...TOOLTIP,
                            callbacks: {
                                label: item => `  ${item.raw} sightings`,
                            }
                        },
                    },
                    scales: {
                        x: { grid: GRID, ticks: { ...TICKS, precision: 0 }, border: { display: false }, beginAtZero: true },
                        y: { grid: { display: false }, ticks: { ...TICKS, font: { size: 9 } }, border: { display: false } },
                    },
                }
            });
        }

        /* ── Sensitivity tier donut ── */
        const tierCanvas = document.getElementById('an-chart-tier');
        if (tierCanvas) {
            const tierLabels = ['T1 Public', 'T2 Protected', 'T3 Restricted', 'T4 Confidential'];
            const tierColors = ['#b8f000', '#00c8e0', '#d98c00', '#e03c3c'];
            makeChart(tierCanvas.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: tierLabels,
                    datasets: [{
                        data: [
                            stats.tierCount[1], stats.tierCount[2],
                            stats.tierCount[3], stats.tierCount[4]
                        ],
                        backgroundColor: tierColors.map(c => c + 'cc'),
                        borderColor: tierColors,
                        borderWidth: 1,
                        hoverOffset: 4,
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '60%',
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: { boxWidth: 8, padding: 14, color: '#7d8693', font: { size: 9 } }
                        },
                        tooltip: { ...TOOLTIP },
                    },
                }
            });
        }

        /* ── Confidence histogram ── */
        const confCanvas = document.getElementById('an-chart-conf');
        if (confCanvas) {
            makeChart(confCanvas.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: ['0–20', '20–40', '40–60', '60–80', '80–100'],
                    datasets: [{
                        label: 'Records',
                        data: stats.confBuckets,
                        backgroundColor: [
                            'rgba(224,60,60,0.75)',
                            'rgba(217,140,0,0.75)',
                            'rgba(0,200,224,0.65)',
                            'rgba(184,240,0,0.55)',
                            'rgba(184,240,0,0.90)',
                        ],
                        borderColor: 'rgba(255,255,255,0.04)',
                        borderWidth: 1,
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            ...TOOLTIP,
                            callbacks: {
                                title: items => `Confidence: ${items[0].label}%`,
                                label: item => `  ${item.raw} records`,
                            }
                        },
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: TICKS, border: { display: false } },
                        y: { grid: GRID, ticks: { ...TICKS, precision: 0 }, border: { display: false }, beginAtZero: true },
                    },
                }
            });
        }

        /* ── Coverage / freshness panel ── */
        const covEl = document.getElementById('an-coverage');
        if (covEl) {
            if (stats.oldest && stats.newest) {
                const spanDays    = Math.round((stats.newest - stats.oldest) / 86400000);
                const staleDays   = Math.round((Date.now() - stats.newest) / 86400000);
                const freshPct    = Math.max(0, Math.min(100, 100 - staleDays * 3));
                const staleColor  = staleDays < 7  ? 'var(--clr-brand)'
                                  : staleDays < 30 ? 'var(--clr-warning)'
                                  : 'var(--clr-danger)';
                covEl.innerHTML = `
                    <div class="an-cov">
                        <div class="an-cov__row">
                            <span class="an-cov__label">First Record</span>
                            <span class="an-cov__val">${stats.oldest.toLocaleDateString()}</span>
                        </div>
                        <div class="an-cov__row">
                            <span class="an-cov__label">Latest Record</span>
                            <span class="an-cov__val" style="color:var(--clr-brand)">${stats.newest.toLocaleDateString()}</span>
                        </div>
                        <div class="an-cov__row">
                            <span class="an-cov__label">Dataset Span</span>
                            <span class="an-cov__val">${spanDays}d</span>
                        </div>
                        <div class="an-cov__row">
                            <span class="an-cov__label">Last Sighting</span>
                            <span class="an-cov__val" style="color:${staleColor}">${staleDays}d ago</span>
                        </div>
                        <div class="an-cov__progress-wrap">
                            <div class="an-cov__progress-label">Data Freshness</div>
                            <div class="an-progress">
                                <div class="an-progress__fill" style="width:${freshPct}%"></div>
                            </div>
                            <div class="an-cov__progress-pct">${freshPct.toFixed(0)}%</div>
                        </div>
                    </div>
                `;
            } else {
                covEl.innerHTML = '<p class="an-empty">No date range data.</p>';
            }
        }
    }

    /* ── Scroll-reveal via IntersectionObserver ──────────────── */
    function initReveals() {
        const obs = new IntersectionObserver(entries => {
            entries.forEach(e => {
                if (e.isIntersecting) {
                    e.target.classList.add('visible');
                    obs.unobserve(e.target);
                }
            });
        }, { threshold: 0.06 });
        document.querySelectorAll('#an-page-root .reveal').forEach(el => obs.observe(el));
    }

    /* ══════════════════════════════════════════════════════════
       PUBLIC ENTRY POINT
    ══════════════════════════════════════════════════════════ */

    async function render(container) {
        destroyCharts();

        /* Loading state */
        container.innerHTML = `
        <div id="an-page-root" class="an-page anim-fade-in">
            <div class="an-loading">
                <div class="spinner"></div>
                <span>Loading analytics…</span>
            </div>
        </div>
        `;

        let records = [];
        try {
            records = await API.get('/analysis/sightings');
        } catch (err) {
            container.innerHTML = `
            <div class="an-page">
                <div class="page-header">
                    <h1>Analytics &amp; Trends</h1>
                </div>
                <div class="card" style="padding:var(--sp-8);text-align:center;color:var(--clr-text-muted)">
                    <p class="form-error">Failed to load analytics data: ${err.message}</p>
                </div>
            </div>`;
            return;
        }

        if (records.length === 0) {
            container.innerHTML = `
            <div class="an-page">
                <div class="page-header">
                    <h1>Analytics &amp; Trends</h1>
                    <p>Validate some reports to generate analytics data.</p>
                </div>
            </div>`;
            return;
        }

        const stats = analyse(records);
        applyChartDefaults();

        /* Full page render */
        container.innerHTML = `
        <div id="an-page-root" class="an-page anim-fade-in">
            ${buildHero(stats)}
            <div class="an-content">
                ${buildKPIs(stats)}
                ${buildChartsSection()}
                ${buildTable(stats)}
            </div>
        </div>
        `;

        /*
         * Small delay before mounting charts so the browser has laid out the
         * canvas elements and Chart.js can correctly read their dimensions.
         */
        setTimeout(() => {
            mountCharts(stats);
            initReveals();
        }, 60);
    }

    return { render };
})();
