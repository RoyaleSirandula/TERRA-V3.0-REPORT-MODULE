/* ============================================================
   TERRA – analytics.js
   Analytics & Data Intelligence — Dark tactical redesign.

   Dark navy background (#07111a), white/grey type, neon accents.
   Sections:
     • Frame A   — hero KV stats + freshness strip
     • Sankey    — tier → classification flow (canvas)
     • Rings     — 4 thin donut gauges (canvas)
     • Trend     — 12-month bar matrix
     • Species   — ranked taxa table
     • Frame B   — summary data panel

   Data: GET /analysis/sightings (validated only)
   ============================================================ */

const AnalyticsPage = (() => {

    let _charts = [];
    let _themeListener = null;

    function destroyCharts() {
        _charts.forEach(c => { try { c.destroy(); } catch(e){} });
        _charts = [];
    }

    /* ── Helpers ─────────────────────────────────────────────── */
    function fmtNum(n) {
        if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
        return String(n);
    }
    function pad2(n) { return String(n).padStart(2, '0'); }
    function toMonth(s) {
        const d = new Date(s);
        return `${d.getFullYear()}-${pad2(d.getMonth()+1)}`;
    }
    function lastNMonths(n) {
        const out = [], now = new Date();
        for (let i = n-1; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
            out.push(`${d.getFullYear()}-${pad2(d.getMonth()+1)}`);
        }
        return out;
    }

    /* ── Data analysis ───────────────────────────────────────── */
    function analyse(records) {
        const total = records.length;

        const speciesSet = new Set();
        records.forEach(r => {
            const k = r.species_id || r.species_name;
            if (k && k !== 'Unknown Species') speciesSet.add(k);
        });

        const confs = records.map(r => parseFloat(r.ai_confidence_score)).filter(n => !isNaN(n));
        const avgConf = confs.length
            ? (confs.reduce((a,b)=>a+b,0)/confs.length).toFixed(1) : '—';

        const dates = records.map(r => new Date(r.created_at)).filter(d => !isNaN(d));
        const oldest = dates.length ? new Date(Math.min(...dates)) : null;
        const newest = dates.length ? new Date(Math.max(...dates)) : null;

        const months = lastNMonths(12);
        const monthCounts = Object.fromEntries(months.map(m => [m, 0]));
        records.forEach(r => {
            const m = toMonth(r.created_at);
            if (m in monthCounts) monthCounts[m]++;
        });

        const speciesFreq = {};
        records.forEach(r => {
            const k = r.species_name || r.species_id || 'Unknown';
            if (k === 'Unknown Species' || k === 'Unknown') return;
            speciesFreq[k] = (speciesFreq[k] || 0) + 1;
        });
        const allSpecies = Object.entries(speciesFreq).sort((a,b) => b[1]-a[1]);

        const tierCount = {1:0, 2:0, 3:0};
        records.forEach(r => {
            const t = Math.min(3, parseInt(r.sensitivity_tier) || 1);
            tierCount[t]++;
        });

        const confBuckets = [0,0,0,0,0];
        confs.forEach(c => { confBuckets[Math.min(Math.floor(c/20),4)]++; });

        const cutoff30 = Date.now() - 30*24*60*60*1000;
        const recent30 = records.filter(r => new Date(r.created_at) >= cutoff30).length;

        /* Tier→kind flows for Sankey */
        const tierKind = {};
        records.forEach(r => {
            const t = Math.min(3, parseInt(r.sensitivity_tier) || 1);
            let kind;
            if (t >= 3) kind = 'THREAT';
            else if (r.validation_status === 'VALIDATED' && r.species_name && r.species_name !== 'Unknown Species') kind = 'REPORT';
            else kind = 'DEFAULT';
            const key = `T${t}→${kind}`;
            tierKind[key] = (tierKind[key] || 0) + 1;
        });

        const spanDays  = (oldest && newest) ? Math.round((newest-oldest)/86400000) : 0;
        const staleDays = newest ? Math.round((Date.now()-newest)/86400000) : 0;
        const freshPct  = Math.max(8, Math.min(100, 100 - staleDays*3));

        return {
            total, speciesCount: speciesSet.size, avgConf,
            oldest, newest, months, monthCounts,
            allSpecies, tierCount, confBuckets, recent30,
            tierKind, spanDays, staleDays, freshPct,
        };
    }

    /* ══════════════════════════════════════════════════════════
       HTML BUILDERS
    ══════════════════════════════════════════════════════════ */

    function ruler(label = '', ver = '') {
        return `
        <div class="an2-ruler">
            <span class="an2-ruler__tick"></span>
            <span class="an2-ruler__label">${label}</span>
            <div class="an2-ruler__track">
                <span class="an2-ruler__pip"></span>
                <span class="an2-ruler__pip"></span>
            </div>
            ${ver ? `<span class="an2-ruler__ver">${ver}</span>` : ''}
            <span class="an2-ruler__tick"></span>
        </div>`;
    }

    function pill(text) {
        return `<div class="an2-pill">${text}</div>`;
    }

    function kvRow(label, v1, v2 = '') {
        return `
        <div class="an2-kv">
            <span class="an2-kv__dot"></span>
            <span class="an2-kv__label">${label}</span>
            <span class="an2-kv__v1">${v1}</span>
            ${v2 !== '' ? `<span class="an2-kv__sep">·</span><span class="an2-kv__v2">${v2}</span>` : ''}
        </div>`;
    }

    /* ── Frame A — hero ── */
    function buildFrameA(stats) {
        const staleColor = stats.staleDays < 7 ? 'green'
                         : stats.staleDays < 30 ? 'amber' : 'red';

        return `
        <div class="an2-frame an2-frame--a">
            ${ruler('TERRA ANALYTICS · INTELLIGENCE LAYER', 'AN-4.2')}

            <div class="an2-frame-a__body">
                <div class="an2-frame-a__left">
                    ${pill(`AN/${stats.total} · ${stats.speciesCount}SPX · ${stats.avgConf}%`)}
                    <div class="an2-id-large">AN${pad2(stats.speciesCount)}</div>
                    <div class="an2-id-sub">Intelligence Layer</div>
                    <div class="an2-id-meta">REF NO. 990-22-2.11</div>
                </div>

                <div class="an2-frame-a__centre">
                    <div class="an2-kv-block">
                        ${kvRow('Total Validated',    fmtNum(stats.total),         '')}
                        ${kvRow('Species Tracked',    stats.speciesCount,           '')}
                        ${kvRow('Avg AI Confidence',  `${stats.avgConf}%`,          '')}
                        ${kvRow('Last 30 Days',       stats.recent30 + ' REC',      '')}
                        ${kvRow('Dataset Span',       stats.spanDays + 'd',         '')}
                        ${kvRow('Last Sighting',      stats.staleDays + 'd ago',    '')}
                    </div>
                    <button class="an2-processing-btn">ANALYSE DATASET</button>
                </div>
            </div>

            <!-- Freshness strip -->
            <div class="an2-fresh-strip">
                <div class="an2-fresh-cell">
                    <div class="an2-fresh-cell__label">Total Records</div>
                    <div class="an2-fresh-cell__val">${fmtNum(stats.total)}</div>
                </div>
                <div class="an2-fresh-cell">
                    <div class="an2-fresh-cell__label">Species</div>
                    <div class="an2-fresh-cell__val an2-fresh-cell__val--green">${stats.speciesCount}</div>
                </div>
                <div class="an2-fresh-cell">
                    <div class="an2-fresh-cell__label">30-Day Activity</div>
                    <div class="an2-fresh-cell__val an2-fresh-cell__val--${staleColor}">${stats.recent30}</div>
                </div>
                <div class="an2-fresh-cell">
                    <div class="an2-fresh-bar-label">Data Freshness</div>
                    <div class="an2-fresh-bar-track">
                        <div class="an2-fresh-bar-fill" style="width:${stats.freshPct}%"></div>
                    </div>
                    <div class="an2-fresh-bar-pct">${stats.freshPct}%</div>
                </div>
            </div>

            ${ruler('', '')}
        </div>`;
    }

    /* ── Sankey ── */
    function buildSankeySection() {
        return `
        <div class="an2-sankey-section">
            ${ruler('FLOW ANALYSIS · SENSITIVITY TIER → CLASSIFICATION', 'SYN-4.1')}
            <div class="an2-sankey-wrap">
                <canvas id="an2-sankey" class="an2-sankey-canvas"></canvas>
                <div class="an2-sankey-legend">
                    <div class="an2-sankey-legend__row"><span class="an2-sankey-legend__dot" style="background:#39ff8a"></span>T1 PUBLIC</div>
                    <div class="an2-sankey-legend__row"><span class="an2-sankey-legend__dot" style="background:#00d4ff"></span>T2 PROTECTED</div>
                    <div class="an2-sankey-legend__row"><span class="an2-sankey-legend__dot" style="background:#ff4455"></span>T3 RESTRICTED</div>
                    <div class="an2-sankey-legend__row"><span class="an2-sankey-legend__dot" style="background:#00d4ff"></span>REPORT</div>
                    <div class="an2-sankey-legend__row"><span class="an2-sankey-legend__dot" style="background:#6b7d8f"></span>DEFAULT</div>
                    <div class="an2-sankey-legend__row"><span class="an2-sankey-legend__dot" style="background:#ff4455"></span>THREAT</div>
                </div>
            </div>
            ${ruler('', '')}
        </div>`;
    }

    /* ── Rings ── */
    function buildRingsSection(stats) {
        const tierTotal = (stats.tierCount[1]||0)+(stats.tierCount[2]||0)+(stats.tierCount[3]||0);
        const confTotal = stats.confBuckets.reduce((a,b)=>a+b,0) || 1;
        const confHigh  = stats.confBuckets[3] + stats.confBuckets[4];

        const rings = [
            {
                id:'an2-ring-t1',
                pct: Math.round((stats.tierCount[1]||0)/Math.max(1,tierTotal)*100),
                label:'T1 PUBLIC', sub:`${stats.tierCount[1]||0} records`,
                color:'#39ff8a', track:'rgba(57,255,138,0.12)',
            },
            {
                id:'an2-ring-t2',
                pct: Math.round((stats.tierCount[2]||0)/Math.max(1,tierTotal)*100),
                label:'T2 PROTECTED', sub:`${stats.tierCount[2]||0} records`,
                color:'#ffb800', track:'rgba(255,184,0,0.12)',
            },
            {
                id:'an2-ring-t3',
                pct: Math.round((stats.tierCount[3]||0)/Math.max(1,tierTotal)*100),
                label:'T3 RESTRICTED', sub:`${stats.tierCount[3]||0} records`,
                color:'#ff4455', track:'rgba(255,68,85,0.12)',
            },
            {
                id:'an2-ring-conf',
                pct: Math.round(confHigh/confTotal*100),
                label:'HIGH CONFIDENCE', sub:`${confHigh} of ${confTotal}`,
                color:'#00d4ff', track:'rgba(0,212,255,0.12)',
            },
        ];

        return `
        <div class="an2-rings-section">
            ${ruler('CLASSIFICATION DISTRIBUTION · SENSITIVITY RINGS', 'CLS-3.2')}
            <div class="an2-rings-grid">
                ${rings.map(r => `
                <div class="an2-ring-cell">
                    <div class="an2-ring-wrap">
                        <canvas id="${r.id}" class="an2-ring-canvas"
                            data-pct="${r.pct}" data-color="${r.color}" data-track="${r.track}">
                        </canvas>
                        <div class="an2-ring-center">
                            <div class="an2-ring-pct" style="color:${r.color}">${r.pct}</div>
                            <div class="an2-ring-pct-sym">%</div>
                        </div>
                    </div>
                    <div class="an2-ring-label">${r.label}</div>
                    <div class="an2-ring-sub">${r.sub}</div>
                </div>`).join('')}
            </div>
            ${ruler('', '')}
        </div>`;
    }

    /* ── Trend bars ── */
    function buildTrendSection(stats) {
        const MONTH_ABB = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
        const vals = stats.months.map(m => stats.monthCounts[m] || 0);
        const maxVal = Math.max(...vals, 1);
        const sum    = vals.reduce((a,b)=>a+b,0);

        return `
        <div class="an2-trend-section">
            ${ruler('TEMPORAL SIGNAL · MONTHLY VALIDATED RECORDS — 12-MONTH WINDOW', 'TMP-1.0')}
            <div class="an2-trend-body">
                <div class="an2-trend-bars">
                    ${vals.map((v,i) => {
                        const h = Math.max(2, Math.round((v/maxVal)*100));
                        const mo = MONTH_ABB[parseInt(stats.months[i].split('-')[1])-1];
                        return `
                        <div class="an2-trend-col">
                            <div class="an2-trend-val">${v > 0 ? v : ''}</div>
                            <div class="an2-trend-bar-wrap">
                                <div class="an2-trend-bar" style="height:${h}%"></div>
                            </div>
                            <div class="an2-trend-lbl">${mo}</div>
                        </div>`;
                    }).join('')}
                </div>
                <div class="an2-trend-meta">
                    ${kvRow('Peak / Month', Math.max(...vals), '')}
                    ${kvRow('Window', `${stats.months.length}MO`, '')}
                    ${kvRow('Total', fmtNum(sum), '')}
                    ${kvRow('Avg / Mo', (sum/stats.months.length).toFixed(1), '')}
                </div>
            </div>
            ${ruler('', '')}
        </div>`;
    }

    /* ── Species table ── */
    function buildSpeciesSection(stats) {
        const maxC = stats.allSpecies[0]?.[1] || 1;
        return `
        <div class="an2-species-section">
            ${ruler('SPECIES INTELLIGENCE MATRIX · ALL TAXA RANKED BY FREQUENCY', 'SPX-2.2')}
            <div class="an2-species-th">
                <span>#</span>
                <span>Taxon</span>
                <span>Signal Freq</span>
                <span>Count</span>
                <span>Share</span>
            </div>
            <div class="an2-species-body">
                ${stats.allSpecies.map(([sp, cnt], i) => {
                    const pct  = ((cnt/stats.total)*100).toFixed(1);
                    const barW = Math.max(2, Math.round((cnt/maxC)*100));
                    return `
                    <div class="an2-sp-row" style="animation-delay:${Math.min(i*0.018,0.45)}s">
                        <span class="an2-sp-rank">${pad2(i+1)}</span>
                        <span class="an2-sp-name">${sp}</span>
                        <span class="an2-sp-bar-wrap">
                            <span class="an2-sp-bar" style="width:${barW}%"></span>
                        </span>
                        <span class="an2-sp-count">${cnt}</span>
                        <span class="an2-sp-pct">${pct}%</span>
                    </div>`;
                }).join('') || `<div class="an2-empty">No species data in dataset</div>`}
            </div>
            ${ruler('MATRIX END', '')}
        </div>`;
    }

    /* ── Frame B — summary ── */
    function buildFrameB(stats) {
        return `
        <div class="an2-frame an2-frame--b">
            ${ruler('SUMMARY BLOCK · DATASET METADATA', 'SUM-1.1')}
            <div class="an2-frame-b__body">
                <div class="an2-frame-b__left">
                    <div class="an2-vpn-log">DATA LOG ·${fmtNum(stats.total)}·${stats.speciesCount}</div>
                    <div class="an2-pn-row">REF NO. 990-22-2.11 · TERRA INTELLIGENCE PLATFORM</div>
                    ${pill(`AN/${stats.total} PL-M`)}
                </div>
                <div class="an2-frame-b__right">
                    <div class="an2-ds-row">
                        <span class="an2-ds-label">Data State</span>
                        <span class="an2-ds-val">${fmtNum(stats.total)}</span>
                    </div>
                    <div class="an2-ds-row">
                        <span class="an2-ds-label">Avg Confidence</span>
                        <span class="an2-ds-val">${stats.avgConf}%</span>
                    </div>
                    <div class="an2-ds-row">
                        <span class="an2-ds-label">30-Day Activity</span>
                        <span class="an2-ds-val">${stats.recent30}</span>
                    </div>
                    <div class="an2-ds-row">
                        <span class="an2-ds-label">Span</span>
                        <span class="an2-ds-val">${stats.spanDays}d</span>
                    </div>
                    <div class="an2-ds-row">
                        <span class="an2-ds-label">Freshness</span>
                        <span class="an2-ds-val" style="color:${stats.freshPct > 50 ? '#39ff8a' : stats.freshPct > 20 ? '#ffb800' : '#ff4455'}">${stats.freshPct}%</span>
                    </div>
                </div>
            </div>
        </div>`;
    }

    /* ══════════════════════════════════════════════════════════
       CANVAS RENDERERS
    ══════════════════════════════════════════════════════════ */

    function drawSankey(canvas, tierKind, tierCount) {
        const W = canvas.offsetWidth || 680;
        const H = canvas.offsetHeight || 280;
        canvas.width  = W * devicePixelRatio;
        canvas.height = H * devicePixelRatio;
        const ctx = canvas.getContext('2d');
        ctx.scale(devicePixelRatio, devicePixelRatio);

        const total = (tierCount[1]||0) + (tierCount[2]||0) + (tierCount[3]||0);
        if (!total) {
            ctx.fillStyle = '#374553';
            ctx.font = '11px JetBrains Mono, monospace';
            ctx.fillText('NO FLOW DATA AVAILABLE', 20, H/2);
            return;
        }

        const PAD = 28, NW = 14, GAP = 12;
        const usableH = H - PAD*2;

        const tierColors = { 1:'#39ff8a', 2:'#ffb800', 3:'#ff4455' };
        const tierLabels = { 1:'T1 PUBLIC', 2:'T2 PROTECTED', 3:'T3 RESTRICTED' };

        const srcNodes = [1,2,3].map(t => ({
            t, color: tierColors[t],
            h: Math.max(8, (tierCount[t]/total)*usableH - GAP),
        }));
        let sy = PAD;
        srcNodes.forEach(n => { n.y = sy; sy += n.h + GAP; });

        /* Dest totals */
        const kindTotals = { REPORT:0, DEFAULT:0, THREAT:0 };
        Object.entries(tierKind).forEach(([k,v]) => {
            const kind = k.split('→')[1];
            if (kind in kindTotals) kindTotals[kind] += v;
        });
        const kindColors = { REPORT:'#00d4ff', DEFAULT:'#6b7d8f', THREAT:'#ff4455' };
        const destData = ['REPORT','DEFAULT','THREAT']
            .filter(k => kindTotals[k] > 0)
            .map(k => ({ label:k, n:kindTotals[k], color:kindColors[k],
                         h: Math.max(8, (kindTotals[k]/total)*usableH - GAP) }));
        let dy = PAD;
        destData.forEach(n => { n.y = dy; dy += n.h + GAP; });

        /* Flows */
        srcNodes.forEach(src => {
            const srcMid = src.y + src.h/2;
            destData.forEach(dst => {
                const key = `T${src.t}→${dst.label}`;
                const val = tierKind[key] || 0;
                if (!val) return;
                const dstMid = dst.y + dst.h/2;
                const fh = Math.max(2, (val/total)*usableH*0.55);
                const cpx1 = PAD + NW + (W-PAD*2-NW*2)*0.38;
                const cpx2 = PAD + NW + (W-PAD*2-NW*2)*0.62;
                const g = ctx.createLinearGradient(PAD+NW,0,W-PAD-NW,0);
                g.addColorStop(0, src.color+'55');
                g.addColorStop(1, dst.color+'55');
                ctx.beginPath();
                ctx.moveTo(PAD+NW, srcMid-fh/2);
                ctx.bezierCurveTo(cpx1, srcMid-fh/2, cpx2, dstMid-fh/2, W-PAD-NW, dstMid-fh/2);
                ctx.lineTo(W-PAD-NW, dstMid+fh/2);
                ctx.bezierCurveTo(cpx2, dstMid+fh/2, cpx1, srcMid+fh/2, PAD+NW, srcMid+fh/2);
                ctx.closePath();
                ctx.fillStyle = g;
                ctx.fill();
            });
        });

        /* Source bars + labels */
        ctx.font = '10px JetBrains Mono, monospace';
        srcNodes.forEach(n => {
            ctx.fillStyle = n.color;
            ctx.fillRect(n.x = PAD, n.y, NW, n.h);
            ctx.fillStyle = '#6b7d8f';
            ctx.fillText(tierLabels[n.t], PAD+NW+6, n.y+n.h/2+4);
            ctx.fillStyle = '#e8edf2';
            ctx.font = '9px JetBrains Mono, monospace';
            ctx.fillText(tierCount[n.t], PAD+NW+6, n.y+n.h/2+16);
            ctx.font = '10px JetBrains Mono, monospace';
        });

        /* Dest bars + labels */
        destData.forEach(n => {
            ctx.fillStyle = n.color;
            ctx.fillRect(W-PAD-NW, n.y, NW, n.h);
            const lw = ctx.measureText(n.label).width;
            ctx.fillStyle = '#6b7d8f';
            ctx.fillText(n.label, W-PAD-NW-lw-6, n.y+n.h/2+4);
            ctx.fillStyle = '#e8edf2';
            ctx.font = '9px JetBrains Mono, monospace';
            ctx.fillText(n.n, W-PAD-NW-ctx.measureText(String(n.n)).width-6, n.y+n.h/2+16);
            ctx.font = '10px JetBrains Mono, monospace';
        });
    }

    function drawRing(canvas) {
        const pct   = parseInt(canvas.dataset.pct) || 0;
        const color = canvas.dataset.color || '#39ff8a';
        const track = canvas.dataset.track || 'rgba(57,255,138,0.10)';
        const S = 120;
        canvas.width  = S * devicePixelRatio;
        canvas.height = S * devicePixelRatio;
        canvas.style.width  = S+'px';
        canvas.style.height = S+'px';
        const ctx = canvas.getContext('2d');
        ctx.scale(devicePixelRatio, devicePixelRatio);
        const cx = S/2, cy = S/2, r = 46, lw = 6;
        const start = -Math.PI/2;
        const end   = start + (pct/100)*Math.PI*2;

        ctx.clearRect(0,0,S,S);

        /* Track ring */
        ctx.beginPath();
        ctx.arc(cx,cy,r,0,Math.PI*2);
        ctx.strokeStyle = track;
        ctx.lineWidth = lw;
        ctx.stroke();

        /* Value arc */
        if (pct > 0) {
            ctx.beginPath();
            ctx.arc(cx,cy,r,start,end);
            ctx.strokeStyle = color;
            ctx.lineWidth = lw;
            ctx.lineCap = 'butt';
            ctx.stroke();
        }

        /* Quarter tick marks */
        [0,0.25,0.5,0.75].forEach(f => {
            const a = start + f*Math.PI*2;
            const x1 = cx + Math.cos(a)*(r-lw-1);
            const y1 = cy + Math.sin(a)*(r-lw-1);
            const x2 = cx + Math.cos(a)*(r+lw+1);
            const y2 = cy + Math.sin(a)*(r+lw+1);
            ctx.beginPath();
            ctx.moveTo(x1,y1); ctx.lineTo(x2,y2);
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.lineWidth = 1;
            ctx.stroke();
        });
    }

    function mountCanvases(stats) {
        const sankeyEl = document.getElementById('an2-sankey');
        if (sankeyEl) drawSankey(sankeyEl, stats.tierKind, stats.tierCount);
        document.querySelectorAll('.an2-ring-canvas').forEach(c => drawRing(c));
    }

    /* ── Scroll-reveal ── */
    function initReveals() {
        const obs = new IntersectionObserver(entries => {
            entries.forEach(e => {
                if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); }
            });
        }, { threshold: 0.04 });
        document.querySelectorAll('#an2-root .reveal').forEach(el => obs.observe(el));
    }

    /* ══════════════════════════════════════════════════════════
       PUBLIC ENTRY
    ══════════════════════════════════════════════════════════ */

    async function render(container) {
        destroyCharts();

        container.innerHTML = `
        <div id="an2-root" class="an2-page">
            <div class="an2-loading">
                <span class="an2-loading__dot"></span>
                <span class="an2-loading__dot"></span>
                <span class="an2-loading__dot"></span>
                <span class="an2-loading__text">Acquiring data…</span>
            </div>
        </div>`;

        let records = [];
        try {
            records = await API.get('/analysis/sightings');
        } catch(err) {
            container.innerHTML = `<div class="an2-page"><div class="an2-error">ERR: ${err.message}</div></div>`;
            return;
        }

        if (!records.length) {
            container.innerHTML = `
            <div class="an2-page">
                <div class="an2-error">NO VALIDATED RECORDS — VALIDATE REPORTS TO GENERATE ANALYTICS</div>
            </div>`;
            return;
        }

        const stats = analyse(records);

        container.innerHTML = `
        <div id="an2-root" class="an2-page">
            <div class="reveal">${buildFrameA(stats)}</div>
            <div class="reveal d1">${buildSankeySection()}</div>
            <div class="reveal d2">${buildRingsSection(stats)}</div>
            <div class="reveal">${buildTrendSection(stats)}</div>
            <div class="reveal d1">${buildSpeciesSection(stats)}</div>
            <div class="reveal d2">${buildFrameB(stats)}</div>
        </div>`;

        setTimeout(() => {
            mountCanvases(stats);
            initReveals();

            if (_themeListener) window.removeEventListener('terra:themechange', _themeListener);
            _themeListener = () => {
                if (!document.getElementById('an2-root')) {
                    window.removeEventListener('terra:themechange', _themeListener);
                    _themeListener = null;
                    return;
                }
                mountCanvases(stats);
            };
            window.addEventListener('terra:themechange', _themeListener);
        }, 80);
    }

    return { render };
})();
