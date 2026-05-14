/* ============================================================
   TERRA – testSite.js  (Field Intelligence View)
   Route: #/test-site  ·  Sidebar: "Test Site"

   ARCHITECTURE
   ────────────
   Single IIFE module (TestSitePage) exposing one public method:
     TestSitePage.render(container)

   Lifecycle per render():
     1. Destroy any previous Leaflet instance (_renderId guard
        aborts stale async renders from the router double-fire).
     2. Decode URL hash state (kinds / conf / time / heat / flows
        / focus / zoom / lat / lng).
     3. Fetch live sightings from GET /analysis/sightings.
        Falls back to FALLBACK_MARKERS if API returns nothing.
     4. mountMarkers() → runIntroSequence() → collapseToTriangle()
     5. restoreState() re-applies decoded URL params.
     6. wireKeyboard() registers the keydown handler.
     7. Filter bar event listeners wired once per render.

   STATE
   ─────
   filterState   – active kinds, confidence threshold, time window,
                   heatmapOn, flowsOn. Source of truth for applyFilters().
   _mountedRefs  – [{card, svg, tri, meta, latlng, leafletMarker,
                    markerData, scale}] — one entry per visible marker.
   _leafletMap   – the single live L.Map instance.
   _heatLayer    – L.heatLayer instance (hidden until heatmapOn).
   _flowGroup    – L.layerGroup holding flow polylines + arrowheads.
   _renderId     – monotonic counter; stale async renders bail after await.
   _focusedIndex – index into _mountedRefs for keyboard focus; -1 = none.
   _kbHandler    – current document keydown listener; swapped on re-render.

   KIND MAPPING (from sighting record)
   ────────────────────────────────────
   sensitivity_tier >= 3              → threat  (red)
   validation_status VALIDATED + species known → report (cyan)
   species_id null / free-text only   → default (white)
   asset kind reserved for future ranger/sensor objects

   INTERACTION MODEL (mouse)
   ─────────────────────────
   On load       → reticles animate in (grid → report → asset → threat)
   After anim    → all collapse to mini triangles
   Hover △       → info panel slides in
   Click △       → restore reticle + fly to marker
   Click reticle → expand detail panel + fly
   Dbl-click     → max zoom + all panels open
   DETAIL button → open right-side dock panel

   KEYBOARD SHORTCUTS
   ──────────────────
   Tab / →↓       cycle forward through visible markers
   Shift+Tab / ←↑ cycle backward
   Enter          restore reticle (1st press) → expand panel (2nd press)
   Escape         collapse focused marker back to triangle
   D              open detail dock for focused marker

   URL STATE SCHEMA
   ────────────────
   #/test-site?kinds=report,threat&conf=20&time=7D
               &heat=1&flows=1&focus=ts-abc
               &zoom=14&lat=-1.265&lng=36.842
   history.replaceState is used (NOT pushState) so back-button
   still navigates at the router level, not inside the page.
   ============================================================ */

const TestSitePage = (() => {

    /* ── Sector key: coarse grid cell derived from coordinates ── */
    /* Groups nearby markers into the same sector for grid sizing  */
    function latLngToSector(lat, lng) {
        const latGrid = Math.round(lat * 20) / 20;   // ~5.5 km cells
        const lngGrid = Math.round(lng * 20) / 20;
        return `${latGrid.toFixed(2)},${lngGrid.toFixed(2)}`;
    }

    /* ── Map a sightings API record → internal marker shape ───── */
    function sightingToMarker(r) {
        const tier = r.sensitivity_tier || 1;
        const status = (r.validation_status || 'PENDING').toUpperCase();
        const species = r.species_name || r.species_id || 'UNKNOWN';
        const lat = parseFloat(r.latitude);
        const lng = parseFloat(r.longitude);
        const coordStr = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        const sector = latLngToSector(lat, lng);
        const sectorLabel = `SECTOR ${sector}`;
        const tierLabel = `TIER ${tier}`;

        // Classify kind
        let kind = 'report';
        if (tier >= 3) kind = 'threat';
        else if (!r.species_id && !r.species_name) kind = 'default';

        const titleMap = {
            threat:  'THREAT DETECTED.',
            report:  'REPORT ORIGIN',
            default: 'GRID CELL',
            asset:   'FIELD ASSET',
        };
        const expTitleMap = {
            threat:  species.toUpperCase(),
            report:  species.toUpperCase(),
            default: 'GRID CELL',
            asset:   species.toUpperCase(),
        };

        return {
            id: `ts-${r.report_id || Math.random().toString(36).slice(2)}`,
            kind,
            lat,
            lng,
            sector,
            title: titleMap[kind],
            subs: [sectorLabel, coordStr, tierLabel],
            expTitle: expTitleMap[kind],
            expSubs: [sectorLabel, coordStr, tierLabel, `Status: ${status}`],
            // Keep raw record for future detail panel use
            _raw: r,
        };
    }

    /* ── Fallback mock data (used when API returns 0 records) ─── */
    const FALLBACK_MARKERS = [
        {
            id: 'ts-default-1', kind: 'default',
            lat: -1.2860, lng: 36.8200, sector: '-1.29,36.82',
            title: 'GRID CELL', subs: ['SECTOR -1.29,36.82', '-1.2860, 36.8200', 'TIER 1'],
            expTitle: 'GRID CELL', expSubs: ['SECTOR -1.29,36.82', '-1.2860, 36.8200', 'TIER 1', 'Status: UNCONFIRMED'],
        },
        {
            id: 'ts-threat-1', kind: 'threat',
            lat: -1.2650, lng: 36.8420, sector: '-1.27,36.85',
            title: 'THREAT DETECTED.', subs: ['SECTOR -1.27,36.85', '-1.2650, 36.8420', 'TIER 3'],
            expTitle: 'WILDFIRE CLUSTER', expSubs: ['SECTOR -1.27,36.85', '-1.2650, 36.8420', 'TIER 3', 'Status: VALIDATED'],
        },
        {
            id: 'threat-1', kind: 'threat',
            lat: -1.3140, lng: 36.8975, sector: '-1.31,36.90',
            title: 'THREAT DETECTED.', subs: ['SECTOR -1.31,36.90', '-1.3140, 36.8975', 'TIER 3'],
            expTitle: 'POACHING ACTIVITY', expSubs: ['SECTOR -1.31,36.90', '-1.3140, 36.8975', 'TIER 3', 'Status: ALERT'],
        },
        {
            id: 'ts-report-1', kind: 'report',
            lat: -1.2950, lng: 36.8560, sector: '-1.30,36.86',
            title: 'REPORT ORIGIN', subs: ['SECTOR -1.30,36.86', '-1.2950, 36.8560', 'TIER 2'],
            expTitle: 'ELEPHANT', expSubs: ['SECTOR -1.30,36.86', '-1.2950, 36.8560', 'TIER 2', 'Status: VALIDATED'],
        },
        {
            id: 'ranger-1', kind: 'ranger',
            lat: -1.2740, lng: 36.8812, sector: '17B',
            title: 'FIELD ASSET', subs: ['SECTOR 17B', '-1.2740, 36.8812', 'RANGER'],
            expTitle: 'ADWOA K.', expSubs: ['SECTOR 17B', '-1.2740, 36.8812', 'Status: ON PATROL'],
        },
        {
            id: 'ranger-2', kind: 'ranger',
            lat: -1.2880, lng: 36.8864, sector: '17B',
            title: 'FIELD ASSET', subs: ['SECTOR 17B', '-1.2880, 36.8864', 'RANGER'],
            expTitle: 'KOFI M.', expSubs: ['SECTOR 17B', '-1.2880, 36.8864', 'Status: ON PATROL'],
        },
        {
            id: 'ranger-3', kind: 'ranger',
            lat: -1.2540, lng: 36.9040, sector: '21A',
            title: 'FIELD ASSET', subs: ['SECTOR 21A', '-1.2540, 36.9040', 'RANGER'],
            expTitle: 'LINNET O.', expSubs: ['SECTOR 21A', '-1.2540, 36.9040', 'Status: CAUTION'],
        },
        {
            id: 'ranger-4', kind: 'ranger',
            lat: -1.2600, lng: 36.8900, sector: '21A',
            title: 'FIELD ASSET', subs: ['SECTOR 21A', '-1.2600, 36.8900', 'RANGER'],
            expTitle: 'BOATENG S.', expSubs: ['SECTOR 21A', '-1.2600, 36.8900', 'Status: LOST SIGNAL'],
        },
        {
            id: 'ranger-5', kind: 'ranger',
            lat: -1.2700, lng: 36.9200, sector: '09C',
            title: 'FIELD ASSET', subs: ['SECTOR 09C', '-1.2700, 36.9200', 'RANGER'],
            expTitle: 'ADJEI P.', expSubs: ['SECTOR 09C', '-1.2700, 36.9200', 'Status: STANDING BY'],
        },
        {
            id: 'sensor-1', kind: 'sensor',
            lat: -1.2510, lng: 36.8720, sector: '7B',
            title: 'FIELD ASSET', subs: ['SECTOR 7B', '-1.2510, 36.8720', 'SENSOR'],
            expTitle: 'ACOUSTIC 14', expSubs: ['SECTOR 7B', '-1.2510, 36.8720', 'Status: ONLINE'],
        },
        {
            id: 'sensor-2', kind: 'sensor',
            lat: -1.3040, lng: 36.9090, sector: '21A',
            title: 'FIELD ASSET', subs: ['SECTOR 21A', '-1.3040, 36.9090', 'SENSOR'],
            expTitle: 'ACOUSTIC 09', expSubs: ['SECTOR 21A', '-1.3040, 36.9090', 'Status: ONLINE'],
        },
        {
            id: 'sensor-3', kind: 'sensor',
            lat: -1.2700, lng: 36.9200, sector: '09C',
            title: 'FIELD ASSET', subs: ['SECTOR 09C', '-1.2700, 36.9200', 'SENSOR'],
            expTitle: 'CAMERA 03', expSubs: ['SECTOR 09C', '-1.2700, 36.9200', 'Status: OFFLINE'],
        },
        {
            id: 'sensor-4', kind: 'sensor',
            lat: -1.2800, lng: 36.8780, sector: '17B',
            title: 'FIELD ASSET', subs: ['SECTOR 17B', '-1.2800, 36.8780', 'SENSOR'],
            expTitle: 'LORA NODE 7', expSubs: ['SECTOR 17B', '-1.2800, 36.8780', 'Status: ONLINE'],
        },
        {
            id: 'ranger-6', kind: 'ranger',
            lat: -1.2921, lng: 36.8380, sector: '17B',
            title: 'FIELD ASSET', subs: ['SECTOR 17B', '-1.2921, 36.8380', 'RANGER'],
            expTitle: 'NIA Z.', expSubs: ['SECTOR 17B', '-1.2921, 36.8380', 'Status: ON PATROL'],
            _raw: { created_at: new Date().toISOString(), sensitivity_tier: 1 }
        },
        {
            id: 'sensor-5', kind: 'sensor',
            lat: -1.2950, lng: 36.8400, sector: '17B',
            title: 'FIELD ASSET', subs: ['SECTOR 17B', '-1.2950, 36.8400', 'SENSOR'],
            expTitle: 'SATELLITE LINK 1', expSubs: ['SECTOR 17B', '-1.2950, 36.8400', 'Status: ONLINE'],
            _raw: { created_at: new Date().toISOString(), sensitivity_tier: 1 }
        },
    ];

    /* ── Variant palette ──────────────────────────────────────── */
    const VARIANT_META = {
        default: { bracket: '#ffffff', bar: '#ffffff', fill: 'rgba(255,255,255,0.07)', titleColor: '#ffffff', statusColor: '#aaaaaa' },
        report:  { bracket: '#ffffff', bar: '#66ccff', fill: 'rgba(80,180,255,0.08)',  titleColor: '#66ccff', statusColor: '#66ccff' },
        ranger:  { bracket: 'rgba(255,255,255,0.9)', bar: '#b8f000', fill: 'rgba(184,240,0,0.07)',  titleColor: '#b8f000', statusColor: '#b8f000' },
        sensor:  { bracket: 'rgba(255,255,255,0.8)', bar: '#00e5ff', fill: 'rgba(0,229,255,0.07)',  titleColor: '#00e5ff', statusColor: '#00e5ff' },
        command: { bracket: 'rgba(255,255,255,0.6)', bar: '#ffffff', fill: 'rgba(255,255,255,0.05)', titleColor: '#ffffff', statusColor: '#aaaaaa' },
        caution: { bracket: 'rgba(255,255,255,0.9)', bar: '#ffcc44', fill: 'rgba(255,204,68,0.08)',  titleColor: '#ffcc44', statusColor: '#ffcc44' },
        threat:  { bracket: '#ffffff', bar: '#ff3333', fill: 'rgba(255,40,40,0.09)',   titleColor: '#ff3333', statusColor: '#ff3333' },
    };

    /* ── Animation load order ─────────────────────────────────── */
    const KIND_ORDER = ['default', 'report', 'ranger', 'sensor', 'command', 'caution', 'threat'];

    /* ── SVG namespace ────────────────────────────────────────── */
    const NS = 'http://www.w3.org/2000/svg';

    /* ── Grid sizing: base cell and columns; rows scale with     */
    /* sector marker count so grids with many markers get more    */
    /* image slots. Count is passed in from mountMarkers.         */
    /* Base: 3×2 (6 cells). Dense sector: 4×3 (12 cells).        */
    function gridDims(markerCountInSector) {
        if (markerCountInSector >= 3) return { cols: 4, rows: 3, cell: 65 };
        if (markerCountInSector === 2) return { cols: 4, rows: 2, cell: 70 };
        return { cols: 3, rows: 2, cell: 75 };
    }

    /* ── Graduated scale factor from sensitivity tier ────────── */
    /* tier 1 → 1.0×  tier 2 → 1.28×  tier 3 → 1.6×            */
    /* Scale is applied to both the reticle SVG and the triangle  */
    /* so high-threat markers are physically larger on the map.   */
    function tierScale(tier) {
        return 1.0 + (Math.min(tier, 3) - 1) * 0.3;
    }

    /* ── Temporal decay opacity from created_at timestamp ─────── */
    /* Exponential curve (not linear) so intel feels "fresh" for  */
    /* the first 6h, then noticeably fades after 24h.             */
    /* Floors at 0.25 so old markers remain discoverable.         */
    /* No date (fallback markers) → neutral 0.6.                  */
    const DECAY_MAX_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
    const DECAY_MIN    = 0.25;
    const DECAY_MAX    = 1.0;
    const DECAY_K      = 3.5; // steepness — higher = sharper mid-drop
    function decayOpacity(createdAt) {
        if (!createdAt) return 0.6;
        const age = Date.now() - new Date(createdAt).getTime();
        if (age <= 0) return DECAY_MAX;
        const ratio = Math.min(age / DECAY_MAX_MS, 1);
        // Exponential ease: f(x) = 1 - (e^(k*x) - 1)/(e^k - 1)
        const exp = (Math.exp(DECAY_K * ratio) - 1) / (Math.exp(DECAY_K) - 1);
        return Math.max(DECAY_MIN, DECAY_MAX - exp * (DECAY_MAX - DECAY_MIN));
    }

    /* ── Human-readable age string + freshness color ────────────── */
    /* Returns { label, color, isFresh } where isFresh = age < 2h   */
    function formatAge(createdAt) {
        if (!createdAt) return { label: 'UNKNOWN', color: '#555', isFresh: false };
        const ms  = Date.now() - new Date(createdAt).getTime();
        const h   = ms / 3_600_000;
        const d   = ms / 86_400_000;
        let label;
        if (ms < 0)          label = 'JUST NOW';
        else if (h < 1)      label = `${Math.round(h * 60)}m AGO`;
        else if (h < 24)     label = `${Math.floor(h)}h AGO`;
        else if (d < 30)     label = `${Math.floor(d)}d AGO`;
        else                 label = `${Math.floor(d / 30)}mo AGO`;
        const color = h < 6 ? '#00ff88' : h < 48 ? '#ffcc44' : '#ff5533';
        return { label, color, isFresh: h < 2 };
    }

    /* ── Build mini triangle SVG ──────────────────────────────── */
    function makeMiniTriangle(meta, scale = 1) {
        const w = Math.round(20 * scale);
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 20 20');
        svg.setAttribute('width', `${w}`);
        svg.setAttribute('height', `${w}`);
        svg.style.display = 'block';
        svg.style.flexShrink = '0';
        svg.classList.add('ts-mini-tri');

        const tri = document.createElementNS(NS, 'polygon');
        tri.setAttribute('points', '10,2 18,18 2,18');
        tri.setAttribute('fill', 'none');
        tri.setAttribute('stroke', meta.bar);
        tri.setAttribute('stroke-width', '1.5');
        tri.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(tri);

        const dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('cx', '10');
        dot.setAttribute('cy', '13');
        dot.setAttribute('r', '1.5');
        dot.setAttribute('fill', meta.bar);
        svg.appendChild(dot);

        return svg;
    }

    /* ── Build reticle SVG ────────────────────────────────────── */
    function makeSVG(meta, scale = 1) {
        const w = Math.round(78 * scale);
        const h = Math.round(72 * scale);
        const offset = Math.round(-26 * scale);
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 130 120');
        svg.setAttribute('width', `${w}`);
        svg.setAttribute('height', `${h}`);
        svg.style.display = 'block';
        svg.style.position = 'absolute';
        svg.style.left = `${offset}px`;
        svg.style.top = `${offset}px`;
        svg.classList.add('ts-reticle-svg');

        const fillBox = document.createElementNS(NS, 'rect');
        fillBox.setAttribute('x', '10'); fillBox.setAttribute('y', '10');
        fillBox.setAttribute('width', '100'); fillBox.setAttribute('height', '100');
        fillBox.setAttribute('fill', meta.fill);
        fillBox.setAttribute('opacity', '0');
        fillBox.style.transition = 'opacity 0.4s ease';
        fillBox.classList.add('fill-box');
        svg.appendChild(fillBox);

        [
            { points: '10,25 10,10 25,10',     cls: 'tl' },
            { points: '95,110 110,110 110,95', cls: 'br' },
            { points: '95,10 110,10 110,25',   cls: 'tr' },
            { points: '10,95 10,110 25,110',   cls: 'bl' },
        ].forEach(c => {
            const pl = document.createElementNS(NS, 'polyline');
            pl.setAttribute('stroke', meta.bracket);
            pl.setAttribute('stroke-width', '1.5');
            pl.setAttribute('fill', 'none');
            pl.setAttribute('points', c.points);
            pl.setAttribute('opacity', '0');
            pl.classList.add('corner', c.cls);
            svg.appendChild(pl);
        });

        const track = document.createElementNS(NS, 'rect');
        track.setAttribute('x', '116'); track.setAttribute('y', '10');
        track.setAttribute('width', '5'); track.setAttribute('height', '100');
        track.setAttribute('rx', '1');
        track.setAttribute('stroke', meta.bar);
        track.setAttribute('stroke-width', '0.8');
        track.setAttribute('fill', 'none');
        track.setAttribute('opacity', '0');
        track.classList.add('bar-track');
        svg.appendChild(track);

        const barFill = document.createElementNS(NS, 'rect');
        barFill.setAttribute('x', '116'); barFill.setAttribute('y', '38');
        barFill.setAttribute('width', '5'); barFill.setAttribute('height', '72');
        barFill.setAttribute('rx', '1');
        barFill.setAttribute('fill', meta.bar);
        barFill.setAttribute('opacity', '0');
        barFill.classList.add('bar-fill');
        svg.appendChild(barFill);

        [35, 60, 85].forEach(ty => {
            const tick = document.createElementNS(NS, 'line');
            tick.setAttribute('x1', '114'); tick.setAttribute('x2', '116');
            tick.setAttribute('y1', ty);    tick.setAttribute('y2', ty);
            tick.setAttribute('stroke', meta.bar);
            tick.setAttribute('stroke-width', '0.6');
            tick.setAttribute('opacity', '0');
            tick.classList.add('bar-tick');
            svg.appendChild(tick);
        });

        return svg;
    }

    /* ── Flicker helper ───────────────────────────────────────── */
    function flicker(el, finalOpacity, onDone) {
        let count = 0;
        const max = 2; // fixed 2 cycles — faster than random
        function step() {
            el.setAttribute('opacity', count % 2 === 0 ? finalOpacity : '0');
            count++;
            if (count <= max * 2) setTimeout(step, 25 + Math.random() * 25);
            else { el.setAttribute('opacity', finalOpacity); if (onDone) onDone(); }
        }
        step();
    }

    /* ── Animate entry sequence; returns Promise that resolves   */
    /* when bar fill appears (total ~620ms at faster timing)      */
    function animateReticle(svg) {
        const fillBox  = svg.querySelector('.fill-box');
        const tl       = svg.querySelector('.corner.tl');
        const br       = svg.querySelector('.corner.br');
        const tr       = svg.querySelector('.corner.tr');
        const bl       = svg.querySelector('.corner.bl');
        const barTrack = svg.querySelector('.bar-track');
        const barFill  = svg.querySelector('.bar-fill');
        const barTicks = svg.querySelectorAll('.bar-tick');

        return new Promise(resolve => {
            setTimeout(() => fillBox.setAttribute('opacity', '1'), 40);
            const d = 160; // corners start sooner
            setTimeout(() => flicker(tl, '1'), d);
            setTimeout(() => flicker(br, '1'), d + 80);
            setTimeout(() => flicker(tr, '1'), d + 160);
            setTimeout(() => flicker(bl, '1', () => {
                flicker(barTrack, '0.3');
                setTimeout(() => {
                    barFill.setAttribute('opacity', '0.85');
                    barTicks.forEach(t => t.setAttribute('opacity', '0.4'));
                    setTimeout(resolve, 80);
                }, 80);
            }), d + 240);
        });
    }

    /* ── Restore bar element opacities to their resting state ─── */
    function restoreBarOpacity(svg) {
        svg.querySelector('.bar-track')?.setAttribute('opacity', '0.3');
        svg.querySelector('.bar-fill')?.setAttribute('opacity', '0.85');
        svg.querySelectorAll('.bar-tick').forEach(t => t.setAttribute('opacity', '0.4'));
    }

    /* ── Restore all SVG elements to their post-animation state ─ */
    function restoreSVGState(svg) {
        svg.querySelector('.fill-box')?.setAttribute('opacity', '1');
        svg.querySelectorAll('.corner').forEach(c => c.setAttribute('opacity', '1'));
        restoreBarOpacity(svg);
    }

    /* ── Reset all SVG elements to opacity 0 ─────────────────── */
    function resetSVGOpacity(svg) {
        svg.querySelectorAll('.fill-box, .corner, .bar-track, .bar-fill, .bar-tick')
            .forEach(el => el.setAttribute('opacity', '0'));
    }

    /* ── Flicker grid cells ───────────────────────────────────── */
    function flickerGridCells(cells) {
        const order = [...cells].sort(() => Math.random() - 0.5);
        order.forEach((cell, i) => {
            setTimeout(() => {
                let count = 0;
                const max = Math.floor(Math.random() * 2) + 2;
                function step() {
                    cell.style.opacity = count % 2 === 0 ? '1' : '0';
                    count++;
                    if (count <= max * 2) setTimeout(step, 35 + Math.random() * 50);
                    else cell.style.opacity = '1';
                }
                step();
            }, i * (55 + Math.random() * 70));
        });
    }

    /* ── Shared: status badge ─────────────────────────────────── */
    function makeStatusBadge(status, color) {
        const badge = document.createElement('div');
        badge.className = 'ts-status-badge';
        badge.style.borderColor = color;
        badge.style.color = color;
        badge.textContent = status;
        return badge;
    }

    /* ── Shared: labelled data row ────────────────────────────── */
    function makeRow(label, value, valueColor) {
        const row = document.createElement('div');
        row.className = 'ts-data-row';
        row.innerHTML = `<span class="ts-data-label">${label}</span><span class="ts-data-value"${valueColor ? ` style="color:${valueColor}"` : ''}>${value}</span>`;
        return row;
    }

    /* ── Shared: confidence bar ───────────────────────────────── */
    function makeConfBar(score, color) {
        const pct = Math.round((score || 0) * 100);
        const wrap = document.createElement('div');
        wrap.className = 'ts-conf-wrap';
        wrap.innerHTML = `
            <div class="ts-conf-label"><span style="color:#555;font-size:9px;letter-spacing:.1em;">AI CONF</span><span style="color:${color};font-size:9px;font-weight:600;letter-spacing:.06em;">${pct}%</span></div>
            <div class="ts-conf-track"><div class="ts-conf-fill" style="width:${pct}%;background:${color};"></div></div>`;
        return wrap;
    }

    /* ── Shared: divider line ─────────────────────────────────── */
    function makeDivider() {
        const d = document.createElement('div');
        d.className = 'ts-exp-divider';
        return d;
    }

    /* ── Shared: detail dock trigger button ───────────────────── */
    function makeDetailBtn(color) {
        const btn = document.createElement('button');
        btn.className = 'ts-detail-btn';
        btn.dataset.action = 'open-dock';
        btn.style.borderColor = color;
        btn.style.color = color;
        btn.innerHTML = 'DETAIL &rsaquo;';
        return btn;
    }

    /* ── Info panel (hover) ───────────────────────────────────── */
    function makeInfoPanel(marker, meta) {
        const panel = document.createElement('div');
        panel.className = 'ts-info-panel';

        const inner = document.createElement('div');
        inner.className = 'ts-info-inner';

        inner.appendChild(Object.assign(document.createElement('div'), { className: 'ts-corner-tr' }));

        const title = document.createElement('div');
        title.className = 'ts-info-title';
        title.style.color = meta.titleColor;
        title.textContent = marker.title;
        inner.appendChild(title);

        // Kind eyebrow
        const eyebrow = document.createElement('div');
        eyebrow.className = 'ts-info-eyebrow';
        eyebrow.textContent = marker.kind.toUpperCase();
        eyebrow.style.color = meta.bar;
        inner.appendChild(eyebrow);

        marker.subs.forEach(s => {
            const sub = document.createElement('div');
            sub.className = 'ts-info-sub';
            sub.textContent = s;
            inner.appendChild(sub);
        });

        // Status badge at bottom of hover panel
        const raw = marker._raw;
        if (raw) {
            inner.appendChild(makeStatusBadge(
                (raw.validation_status || 'PENDING').toUpperCase(),
                meta.statusColor
            ));
            inner.appendChild(makeDivider());
        }

        panel.appendChild(inner);
        return panel;
    }

    /* ── Expanded panel builders per kind ────────────────────── */

    function buildReportContent(inner, marker, meta, sectorCount) {
        const raw = marker._raw || {};
        const { cols, rows, cell } = gridDims(sectorCount);
        const gridW = cols * cell;
        const gridH = rows * cell;

        // Left: detail block
        const detail = document.createElement('div');
        detail.className = 'ts-exp-detail';

        const kindLabel = document.createElement('div');
        kindLabel.className = 'ts-exp-kind';
        kindLabel.textContent = 'SIGHTING REPORT';
        kindLabel.style.color = meta.bar;
        detail.appendChild(kindLabel);

        const speciesTitle = document.createElement('div');
        speciesTitle.className = 'ts-exp-species';
        speciesTitle.style.color = meta.titleColor;
        speciesTitle.textContent = marker.expTitle;
        detail.appendChild(speciesTitle);

        detail.appendChild(makeDivider());
        detail.appendChild(makeRow('COORDS', `${parseFloat(marker.lat).toFixed(4)}, ${parseFloat(marker.lng).toFixed(4)}`));
        detail.appendChild(makeRow('SECTOR', marker.sector));
        detail.appendChild(makeRow('TIER', `${raw.sensitivity_tier || 1}`));
        if (raw.created_at) {
            const age = formatAge(raw.created_at);
            const ageEl = document.createElement('div');
            ageEl.className = 'ts-data-row';
            ageEl.innerHTML = `<span class="ts-data-label">AGE</span><span class="ts-age-value" style="color:${age.color};">${age.label}</span>`;
            detail.appendChild(ageEl);
        }
        detail.appendChild(makeDivider());

        detail.appendChild(makeStatusBadge(
            (raw.validation_status || 'PENDING').toUpperCase(),
            meta.statusColor
        ));
        detail.appendChild(makeDetailBtn(meta.bar));
        inner.appendChild(detail);

        // Right: photo + conf bar stacked below
        const rightCol = document.createElement('div');
        rightCol.style.cssText = 'display:flex;flex-direction:column;flex-shrink:0;gap:6px;';

        const mediaUrl = raw.media_url ? '/' + raw.media_url.replace(/^\//, '') : null;
        const imgWrap = document.createElement('div');
        imgWrap.className = 'ts-exp-media';
        imgWrap.style.width = gridW + 'px';
        imgWrap.style.height = gridH + 'px';

        if (mediaUrl) {
            imgWrap.classList.add('ts-exp-media--photo');
            const img = document.createElement('img');
            img.src = mediaUrl;
            img.alt = marker.expTitle;
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity 0.4s ease;';
            img.onload = () => { img.style.opacity = '1'; };
            img.onerror = () => { imgWrap.classList.add('ts-exp-media--no-photo'); imgWrap.innerHTML = '<span class="ts-no-photo">NO PHOTO</span>'; };
            imgWrap.appendChild(img);
        } else {
            imgWrap.classList.add('ts-exp-media--no-photo');
            imgWrap.innerHTML = '<span class="ts-no-photo">NO PHOTO</span>';
        }

        const mediaCorner = document.createElement('div');
        mediaCorner.className = 'ts-corner-bl';
        imgWrap.appendChild(mediaCorner);
        rightCol.appendChild(imgWrap);

        if (raw.ai_confidence_score != null) {
            rightCol.appendChild(makeConfBar(raw.ai_confidence_score, meta.bar));
        }

        inner.appendChild(rightCol);
    }

    function buildThreatContent(inner, marker, meta, sectorCount) {
        const raw = marker._raw || {};
        const tier = raw.sensitivity_tier || 3;
        const { cols, rows, cell } = gridDims(sectorCount);
        const gridW = cols * cell;
        const gridH = rows * cell;

        // Left: threat detail
        const detail = document.createElement('div');
        detail.className = 'ts-exp-detail';

        const kindLabel = document.createElement('div');
        kindLabel.className = 'ts-exp-kind';
        kindLabel.textContent = '⚠ THREAT DETECTED';
        kindLabel.style.color = meta.bar;
        detail.appendChild(kindLabel);

        const speciesTitle = document.createElement('div');
        speciesTitle.className = 'ts-exp-species';
        speciesTitle.style.color = meta.titleColor;
        speciesTitle.textContent = marker.expTitle;
        detail.appendChild(speciesTitle);

        detail.appendChild(makeDivider());
        detail.appendChild(makeRow('COORDS', `${parseFloat(marker.lat).toFixed(4)}, ${parseFloat(marker.lng).toFixed(4)}`));
        detail.appendChild(makeRow('SECTOR', marker.sector));

        // Threat level indicators
        const tierRow = document.createElement('div');
        tierRow.className = 'ts-data-row';
        const tierDots = Array.from({ length: 3 }, (_, i) => {
            const dot = document.createElement('span');
            dot.className = 'ts-threat-dot';
            dot.style.background = i < tier ? meta.bar : 'rgba(255,51,51,0.15)';
            dot.style.borderColor = meta.bar;
            return dot.outerHTML;
        }).join('');
        tierRow.innerHTML = `<span class="ts-data-label">SEVERITY</span><span class="ts-threat-dots">${tierDots}</span>`;
        detail.appendChild(tierRow);

        if (raw.created_at) {
            const age = formatAge(raw.created_at);
            const ageEl = document.createElement('div');
            ageEl.className = 'ts-data-row';
            ageEl.innerHTML = `<span class="ts-data-label">AGE</span><span class="ts-age-value" style="color:${age.color};">${age.label}</span>`;
            detail.appendChild(ageEl);
        }
        detail.appendChild(makeDivider());

        detail.appendChild(makeStatusBadge(
            (raw.validation_status || 'PENDING').toUpperCase(),
            meta.statusColor
        ));
        detail.appendChild(makeDetailBtn(meta.bar));
        inner.appendChild(detail);

        // Right: severity matrix + conf bar stacked below
        const rightCol = document.createElement('div');
        rightCol.style.cssText = 'display:flex;flex-direction:column;flex-shrink:0;gap:6px;';

        const matrixWrap = document.createElement('div');
        matrixWrap.className = 'ts-exp-media ts-threat-matrix';
        matrixWrap.style.width = gridW + 'px';
        matrixWrap.style.height = gridH + 'px';

        const grid = document.createElement('div');
        grid.className = 'ts-grid';
        grid.style.gridTemplateColumns = `repeat(${cols}, ${cell}px)`;
        grid.style.gridTemplateRows = `repeat(${rows}, ${cell}px)`;

        const total = cols * rows;
        const filled = Math.round(total * (tier / 3));
        for (let i = 0; i < total; i++) {
            const c = document.createElement('div');
            c.className = 'ts-grid-cell ts-threat-cell';
            c.style.width = cell + 'px';
            c.style.height = cell + 'px';
            if (i < filled) {
                const intensity = 0.08 + (i / total) * 0.18;
                c.style.background = `rgba(255,51,51,${intensity.toFixed(2)})`;
                c.style.borderColor = `rgba(255,51,51,0.25)`;
            }
            grid.appendChild(c);
        }
        matrixWrap.appendChild(grid);
        matrixWrap.appendChild(Object.assign(document.createElement('div'), { className: 'ts-corner-bl' }));
        rightCol.appendChild(matrixWrap);

        if (raw.ai_confidence_score != null) {
            rightCol.appendChild(makeConfBar(raw.ai_confidence_score, meta.bar));
        }

        inner.appendChild(rightCol);
    }

    function buildDefaultContent(inner, marker, meta, sectorCount) {
        const { cols, rows, cell } = gridDims(sectorCount);
        const gridW = cols * cell;
        const gridH = rows * cell;

        // Left: grid cell info
        const detail = document.createElement('div');
        detail.className = 'ts-exp-detail';

        const kindLabel = document.createElement('div');
        kindLabel.className = 'ts-exp-kind';
        kindLabel.textContent = 'GRID CELL';
        kindLabel.style.color = meta.bar;
        detail.appendChild(kindLabel);

        const speciesTitle = document.createElement('div');
        speciesTitle.className = 'ts-exp-species';
        speciesTitle.style.color = meta.titleColor;
        speciesTitle.textContent = marker.expTitle;
        detail.appendChild(speciesTitle);

        detail.appendChild(makeDivider());
        detail.appendChild(makeRow('COORDS', `${parseFloat(marker.lat).toFixed(4)}, ${parseFloat(marker.lng).toFixed(4)}`));
        detail.appendChild(makeRow('SECTOR', marker.sector));
        detail.appendChild(makeRow('TIER', `${marker._raw?.sensitivity_tier || 1}`));
        detail.appendChild(makeRow('MARKERS', `${sectorCount} in sector`));
        detail.appendChild(makeDivider());
        detail.appendChild(makeStatusBadge('UNCONFIRMED', meta.statusColor));
        detail.appendChild(makeDetailBtn(meta.bar));
        inner.appendChild(detail);

        // Right: coordinate grid overlay (ticks + label)
        const gridWrap = document.createElement('div');
        gridWrap.className = 'ts-exp-media ts-coord-grid';
        gridWrap.style.width = gridW + 'px';
        gridWrap.style.height = gridH + 'px';

        const grid = document.createElement('div');
        grid.className = 'ts-grid';
        grid.style.gridTemplateColumns = `repeat(${cols}, ${cell}px)`;
        grid.style.gridTemplateRows = `repeat(${rows}, ${cell}px)`;

        for (let i = 0; i < cols * rows; i++) {
            const c = document.createElement('div');
            c.className = 'ts-grid-cell';
            c.style.width = cell + 'px';
            c.style.height = cell + 'px';
            grid.appendChild(c);
        }
        gridWrap.appendChild(grid);
        gridWrap.appendChild(Object.assign(document.createElement('div'), { className: 'ts-corner-bl' }));
        inner.appendChild(gridWrap);
    }

    function buildAssetContent(inner, marker, meta, sectorCount) {
        // Asset shares report layout — tel metadata in place of species
        buildReportContent(inner, marker, meta, sectorCount);
        // Overwrite kind label
        const kindEl = inner.querySelector('.ts-exp-kind');
        const labelMap = { ranger: 'FIELD RANGER', sensor: 'FIELD SENSOR', command: 'BASE COMMAND', caution: 'CAUTION' };
        if (kindEl) { 
            kindEl.textContent = labelMap[marker.kind] || 'FIELD ASSET'; 
            kindEl.style.color = meta.bar; 
        }
    }

    /* ── Expanded panel (click) ───────────────────────────────── */
    function makeExpandedPanel(marker, meta, sectorCount) {
        const { cols, cell } = gridDims(sectorCount);
        const gridW = cols * cell;
        const DETAIL_W = 148, EXP_PAD = 10, EXP_GAP = 12;
        const expW = EXP_PAD + DETAIL_W + EXP_GAP + gridW;

        const panel = document.createElement('div');
        panel.className = 'ts-exp-panel';
        panel.style.width = expW + 'px';

        const inner = document.createElement('div');
        inner.className = 'ts-exp-inner';
        inner.style.width = expW + 'px';

        inner.appendChild(Object.assign(document.createElement('div'), { className: 'ts-corner-tr' }));

        const builders = {
            report:  buildReportContent,
            threat:  buildThreatContent,
            default: buildDefaultContent,
            ranger:  buildAssetContent,
            sensor:  buildAssetContent,
            command: buildAssetContent,
            caution: buildAssetContent,
            asset:   buildAssetContent,
        };
        (builders[marker.kind] || buildDefaultContent)(inner, marker, meta, sectorCount);

        panel.appendChild(inner);
        return panel;
    }

    /* ── Collapse a card to triangle state ────────────────────── */
    function collapseToTriangle(card, svg) {
        // Ensure any expanded state is cleared
        card.classList.remove('ts-expanded');
        const ip = card.querySelector('.ts-info-panel');
        if (ip) { ip.style.width = '0'; ip.style.opacity = '0'; }
        card.querySelectorAll('.ts-grid-cell').forEach(c => { c.style.opacity = '0'; });

        // Fade SVG out then hide it
        svg.style.transition = 'opacity 0.25s ease';
        svg.style.opacity = '0';
        setTimeout(() => {
            svg.style.display = 'none';
            svg.style.opacity = '';
            svg.style.transition = '';
            resetSVGOpacity(svg);

            // Show triangle
            card.classList.add('ts-mini');
            const existing = card.querySelector('.ts-mini-tri');
            if (existing) {
                existing.style.display = 'block';
                existing.style.opacity = '1';
            }
        }, 260);
    }

    /* ── Restore card from triangle to full reticle ───────────── */
    function restoreReticle(card, svg) {
        card.classList.remove('ts-mini');
        const tri = card.querySelector('.ts-mini-tri');
        if (tri) tri.style.display = 'none';

        // Restore internal element opacities before fading in so they're visible
        restoreSVGState(svg);

        svg.style.display = 'block';
        svg.style.opacity = '0';
        svg.style.transition = 'opacity 0.22s ease';
        requestAnimationFrame(() => {
            svg.style.opacity = '1';
            setTimeout(() => { svg.style.transition = ''; }, 240);
        });
    }

    /* ── Bind interactions ────────────────────────────────────── */
    /* pointer-events: none on the card wrapper; only the SVG and */
    /* triangle elements are interactive hit targets.             */
    function bindInteractions(card, svg, map, latlng, markerData, mapWrap) {
        const barEls = [
            svg.querySelector('.bar-track'),
            svg.querySelector('.bar-fill'),
            ...svg.querySelectorAll('.bar-tick'),
        ];
        const infoPanel = card.querySelector('.ts-info-panel');
        const tri = card.querySelector('.ts-mini-tri');

        /* ── Smooth zoom + center to this marker ─────────────── */
        function flyToMarker() {
            if (!map || !latlng) return;
            const targetZoom = Math.max(map.getZoom(), 14);
            map.flyTo(latlng, targetZoom, { animate: true, duration: 0.6 });
        }

        /* ── Max zoom + open all panels ──────────────────────── */
        function focusMarker() {
            document.querySelectorAll('.ts-reticle-card').forEach(c => {
                if (c === card) return;
                const s = c.querySelector('.ts-reticle-svg');
                if (s) collapseToTriangle(c, s);
            });

            if (card.classList.contains('ts-mini')) restoreReticle(card, svg);

            card.classList.add('ts-expanded');
            if (infoPanel) { infoPanel.style.width = '200px'; infoPanel.style.opacity = '1'; }
            barEls.forEach(el => el.setAttribute('opacity', '0'));
            setTimeout(() => flickerGridCells(card.querySelectorAll('.ts-grid-cell')), 180);

            setTimeout(() => {
                if (!map || !latlng) return;
                map.flyTo(latlng, map.getMaxZoom(), { animate: true, duration: 0.9 });
            }, 60);
            pushState(map);
        }

        /* ── Double-click detection (300 ms window) ──────────── */
        /* Native dblclick is unreliable on Leaflet DivIcons because */
        /* Leaflet consumes the event before it reaches the SVG.     */
        /* We use a manual timer: first click arms it; second click  */
        /* within 300 ms cancels it and fires focusMarker() instead. */
        let clickTimer = null;
        function handleClick(singleFn) {
            if (clickTimer) {
                clearTimeout(clickTimer);
                clickTimer = null;
                focusMarker();
            } else {
                clickTimer = setTimeout(() => {
                    clickTimer = null;
                    singleFn();
                }, 300);
            }
        }

        function showInfo() {
            if (card.classList.contains('ts-expanded')) return;
            if (!card.classList.contains('ts-mini')) {
                barEls.forEach(el => { el.style.transition = 'opacity 0.15s'; el.setAttribute('opacity', '0'); });
            }
            if (infoPanel) {
                infoPanel.style.width = '200px';
                infoPanel.style.opacity = '1';
                infoPanel.style.pointerEvents = 'none';
            }
        }

        function hideInfo() {
            if (card.classList.contains('ts-expanded')) return;
            if (!card.classList.contains('ts-mini')) {
                if (svg.querySelector('.corner.bl')?.getAttribute('opacity') === '1') {
                    restoreBarOpacity(svg);
                }
            }
            if (infoPanel) { infoPanel.style.width = '0'; infoPanel.style.opacity = '0'; }
        }

        /* ── Triangle: hover = info, click = fly + restore ───── */
        if (tri) {
            tri.addEventListener('mouseenter', showInfo);
            tri.addEventListener('mouseleave', hideInfo);
            tri.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                hideInfo();
                handleClick(() => {
                    restoreReticle(card, svg);
                    setTimeout(flyToMarker, 50);
                    pushState(map);
                });
            });
        }

        /* ── Reticle SVG: hover = info, click = fly + expand ─── */
        svg.addEventListener('mouseenter', showInfo);
        svg.addEventListener('mouseleave', hideInfo);

        svg.addEventListener('click', (e) => {
            if (card.classList.contains('ts-mini')) return;
            e.stopPropagation();
            e.preventDefault();

            const wasExpanded = card.classList.contains('ts-expanded');

            handleClick(() => {
                // Collapse all other expanded cards fully to triangle
                document.querySelectorAll('.ts-reticle-card.ts-expanded').forEach(c => {
                    if (c === card) return;
                    const s = c.querySelector('.ts-reticle-svg');
                    if (s) collapseToTriangle(c, s);
                });

                if (wasExpanded) {
                    collapseToTriangle(card, svg);
                    closeDock(mapWrap, map);
                } else {
                    flyToMarker();
                    card.classList.add('ts-expanded');
                    if (infoPanel) { infoPanel.style.width = '0'; infoPanel.style.opacity = '0'; }
                    barEls.forEach(el => el.setAttribute('opacity', '0'));
                    setTimeout(() => flickerGridCells(card.querySelectorAll('.ts-grid-cell')), 180);
                }
                pushState(map);
            });
        });

        /* ── DETAIL button: open dock, collapse to info-only ──── */
        card.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action="open-dock"]');
            if (!btn) return;
            e.stopPropagation();

            // Collapse expanded panel, show info panel (box mode)
            card.classList.remove('ts-expanded');
            if (infoPanel) { infoPanel.style.width = '200px'; infoPanel.style.opacity = '1'; }
            restoreBarOpacity(svg);

            openDock(mapWrap, map, markerData);
        });
    }

    /* ── Dock ─────────────────────────────────────────────────── */
    const DOCK_W = 300; // px

    function buildDockContent(marker) {
        const raw = marker._raw || {};
        const meta = VARIANT_META[marker.kind] || VARIANT_META.default;
        const score = raw.ai_confidence_score;
        const pct = score != null ? Math.round(score * 100) : null;
        const tier = raw.sensitivity_tier || 1;
        const status = (raw.validation_status || 'PENDING').toUpperCase();
        const species = raw.species_name || raw.species_id || null;
        const sciName = raw.species_scientific || null;
        const iucn = raw.iucn_status || null;
        const trend = raw.population_trend || null;
        const rangerId = raw.ranger_id || raw.submitted_by || null;
        const regionId = raw.region_id || null;
        const submitted = raw.created_at ? new Date(raw.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;

        function row(label, value, color) {
            if (value == null || value === '') return '';
            return `<div class="ts-dock-row">
                <span class="ts-dock-label">${label}</span>
                <span class="ts-dock-value"${color ? ` style="color:${color}"` : ''}>${value}</span>
            </div>`;
        }

        function section(title, body) {
            return `<div class="ts-dock-section">
                <div class="ts-dock-section-title">${title}</div>
                ${body}
            </div>`;
        }

        const mediaUrl = raw.media_url ? '/' + raw.media_url.replace(/^\//, '') : null;
        const mediaBlock = mediaUrl ? `
            <div class="ts-dock-media">
                <img src="${mediaUrl}" alt="${marker.expTitle}"
                    onload="this.style.opacity='1'"
                    onerror="this.parentElement.innerHTML='<span class=ts-no-photo>NO PHOTO</span>'"
                    style="width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity 0.4s ease;" />
            </div>` : '';

        const confBlock = pct != null ? `
            <div class="ts-dock-conf">
                <div class="ts-dock-conf-row">
                    <span style="color:#555;font-size:9px;letter-spacing:.1em;">AI CONFIDENCE</span>
                    <span style="color:${meta.bar};font-size:9px;font-weight:600;">${pct}%</span>
                </div>
                <div class="ts-conf-track" style="margin-top:4px;">
                    <div class="ts-conf-fill" style="width:${pct}%;background:${meta.bar};"></div>
                </div>
            </div>` : '';

        const threatDots = marker.kind === 'threat' ? `
            <div class="ts-dock-row">
                <span class="ts-dock-label">SEVERITY</span>
                <div class="ts-threat-dots">
                    ${[1,2,3].map(i => `<span class="ts-threat-dot" style="background:${i <= tier ? `rgba(255,51,51,${0.3 + i*0.2})` : 'transparent'};border-color:rgba(255,51,51,0.3);"></span>`).join('')}
                </div>
            </div>` : '';

        return `
            <div class="ts-dock-header">
                <div class="ts-dock-kind" style="color:${meta.bar}">${marker.kind.toUpperCase()}</div>
                <div class="ts-dock-title" style="color:${meta.titleColor}">${marker.expTitle}</div>
                ${sciName ? `<div class="ts-dock-sci">${sciName}</div>` : ''}
            </div>
            ${mediaBlock}
            ${section('LOCATION', `
                ${row('COORDS', `${parseFloat(marker.lat).toFixed(5)}, ${parseFloat(marker.lng).toFixed(5)}`)}
                ${row('SECTOR', marker.sector)}
                ${row('REGION', regionId)}
            `)}
            ${section('REPORT', `
                ${row('STATUS', status, meta.statusColor)}
                ${row('TIER', `${tier}`)}
                ${threatDots}
                ${row('SUBMITTED', submitted)}
                ${row('RANGER', rangerId)}
            `)}
            ${species || iucn || trend ? section('SPECIES', `
                ${row('SPECIES', species)}
                ${row('IUCN', iucn)}
                ${row('TREND', trend)}
            `) : ''}
            ${confBlock}
        `;
    }

    function openDock(mapWrap, map, marker) {
        let dock = mapWrap.querySelector('.ts-dock');

        if (!dock) {
            dock = document.createElement('div');
            dock.className = 'ts-dock';

            const collapseBtn = document.createElement('button');
            collapseBtn.className = 'ts-dock-collapse';
            collapseBtn.title = 'Collapse';
            collapseBtn.innerHTML = '›';
            collapseBtn.addEventListener('click', () => closeDock(mapWrap, map));
            dock.appendChild(collapseBtn);

            const body = document.createElement('div');
            body.className = 'ts-dock-body';
            dock.appendChild(body);

            mapWrap.appendChild(dock);

            // Slide in after paint
            requestAnimationFrame(() => {
                requestAnimationFrame(() => { dock.classList.add('ts-dock--open'); });
            });

            // Auto-pan map left by half dock width
            if (map) {
                setTimeout(() => {
                    map.panBy([DOCK_W / 2, 0], { animate: true, duration: 0.3 });
                }, 60);
            }
        }

        // Swap content (crossfade)
        const body = dock.querySelector('.ts-dock-body');
        body.style.opacity = '0';
        setTimeout(() => {
            body.innerHTML = buildDockContent(marker);
            body.style.opacity = '1';
        }, 150);
    }

    function closeDock(mapWrap, map) {
        const dock = mapWrap.querySelector('.ts-dock');
        if (!dock) return;
        dock.classList.remove('ts-dock--open');
        if (map) map.panBy([-DOCK_W / 2, 0], { animate: true, duration: 0.3 });
        setTimeout(() => dock.remove(), 300);
    }

    /* ── Filter state ─────────────────────────────────────────── */
    const filterState = {
        activeKinds: new Set(['default', 'report', 'asset', 'threat']),
        minConfidence: 0,
        timeWindow: 'ALL',   // NOW | 24H | 7D | ALL
        heatmapOn: false,
        flowsOn: false,
    };

    /* ── Mounted marker refs (populated by mountMarkers) ─────── */
    let _mountedRefs = [];
    let _heatLayer = null;
    let _leafletMap = null;
    let _flowGroup = null;       // L.LayerGroup holding all flow arrows
    let _allMarkers = [];        // full marker list for flow recompute
    let _renderId = 0;           // increments each render; stale async renders abort
    let _focusedIndex = -1;      // keyboard-focused marker index into _mountedRefs
    let _kbHandler = null;       // current keydown handler; replaced on each render
    let _wildebeestLayer = null; // L.LayerGroup of wildebeest GPS points
    let _wildebeestOn = false;   // toggle state

    /* ── Apply current filterState to all mounted markers ─────── */
    function applyFilters() {
        const now = Date.now();
        const windowMs = { NOW: 2 * 60 * 60 * 1000, '24H': 24 * 60 * 60 * 1000, '7D': 7 * 24 * 60 * 60 * 1000, ALL: Infinity };
        const cutoff = windowMs[filterState.timeWindow] ?? Infinity;

        _mountedRefs.forEach(({ card, svg, leafletMarker, markerData }) => {
            const raw = markerData._raw;
            const kind = markerData.kind;

            // Kind filter
            const kindOk = filterState.activeKinds.has(kind);

            // Confidence filter — pass if no score (fallback markers)
            const score = raw?.ai_confidence_score;
            const confOk = score == null || score * 100 >= filterState.minConfidence;

            // Time filter — pass if no timestamp (fallback markers)
            const ts = raw?.created_at ? new Date(raw.created_at).getTime() : null;
            const timeOk = ts == null || (now - ts) <= cutoff;

            const visible = kindOk && confOk && timeOk;

            const el = leafletMarker.getElement();
            if (el) {
                el.style.opacity = visible ? '1' : '0';
                el.style.pointerEvents = visible ? '' : 'none';
            }

            // Collapse hidden expanded cards cleanly
            if (!visible && card.classList.contains('ts-expanded')) {
                collapseToTriangle(card, svg);
            }
        });

        // Heatmap sync
        if (_heatLayer && _leafletMap) {
            if (filterState.heatmapOn) {
                const points = _mountedRefs
                    .filter(({ markerData }) => filterState.activeKinds.has(markerData.kind))
                    .map(({ markerData }) => [markerData.lat, markerData.lng, (markerData._raw?.sensitivity_tier || 1) / 3]);
                _heatLayer.setLatLngs(points);
                if (!_leafletMap.hasLayer(_heatLayer)) _leafletMap.addLayer(_heatLayer);
                // Prevent the heat canvas from swallowing pointer events
                if (_heatLayer._canvas) _heatLayer._canvas.style.pointerEvents = 'none';
            } else {
                if (_leafletMap.hasLayer(_heatLayer)) _leafletMap.removeLayer(_heatLayer);
            }
        }

        // Flow arrows sync
        if (_leafletMap) {
            if (filterState.flowsOn) {
                buildFlowArrows(_leafletMap, _allMarkers.filter(m => filterState.activeKinds.has(m.kind)));
            } else {
                clearFlowArrows(_leafletMap);
            }
        }
    }

    /* ── Flow arrow colour per dominant kind ─────────────────── */
    const FLOW_COLORS = {
        threat:  'rgba(255,51,51,0.55)',
        report:  'rgba(102,204,255,0.45)',
        asset:   'rgba(57,255,20,0.45)',
        default: 'rgba(255,255,255,0.25)',
    };

    /* ── Clear existing flow layer ───────────────────────────── */
    function clearFlowArrows(map) {
        if (_flowGroup) { map.removeLayer(_flowGroup); _flowGroup = null; }
    }

    /* ── Build & render Sankey-style sector flow arrows ─────── */
    /* Algorithm:
       1. Group markers by sector → compute centroid per sector
       2. For each same-kind pair of sectors, accumulate a flow
          count weighted by average sensitivity tier
       3. For each flow with count ≥ 1, draw a tapered polyline
          with an SVG arrowhead; stroke-width ∝ count           */
    function buildFlowArrows(map, markers) {
        clearFlowArrows(map);
        if (markers.length < 2) return;

        // Step 1 — sector centroids and kind tallies
        const sectors = {};
        markers.forEach(m => {
            if (!sectors[m.sector]) sectors[m.sector] = { lat: 0, lng: 0, count: 0, kinds: {} };
            const s = sectors[m.sector];
            s.lat += m.lat; s.lng += m.lng; s.count++;
            s.kinds[m.kind] = (s.kinds[m.kind] || 0) + 1;
        });
        Object.values(sectors).forEach(s => { s.lat /= s.count; s.lng /= s.count; });

        const sectorKeys = Object.keys(sectors);
        if (sectorKeys.length < 2) return;

        // Step 2 — build flows between every sector pair that share a kind
        // Flow direction: earlier created_at → later (fallback: alphabetical sector key)
        const flows = [];
        for (let i = 0; i < sectorKeys.length; i++) {
            for (let j = i + 1; j < sectorKeys.length; j++) {
                const keyA = sectorKeys[i], keyB = sectorKeys[j];
                const sA = sectors[keyA], sB = sectors[keyB];

                // Find shared kinds between the two sectors
                const sharedKinds = Object.keys(sA.kinds).filter(k => sB.kinds[k]);
                if (sharedKinds.length === 0) continue;

                // Dominant kind = highest count across both sectors
                const dominant = sharedKinds.reduce((best, k) =>
                    (sA.kinds[k] + sB.kinds[k]) > (sA.kinds[best] + sB.kinds[best]) ? k : best
                );

                const volume = sA.kinds[dominant] + sB.kinds[dominant];

                // Direction: sector with more events is the source
                const [from, to] = sA.count >= sB.count
                    ? [sA, sB] : [sB, sA];

                flows.push({ from, to, volume, kind: dominant });
            }
        }

        if (flows.length === 0) return;

        // Step 3 — render as uniform 2px lines; brightness encodes volume
        _flowGroup = L.layerGroup().addTo(map);
        const maxVol = Math.max(...flows.map(f => f.volume));

        flows.forEach(({ from, to, volume, kind }) => {
            // Brightness via opacity: low volume = dim, high volume = vivid
            const brightness = 0.2 + (volume / maxVol) * 0.75;

            // Parse base RGBA and apply brightness as opacity
            // FLOW_COLORS values are rgba(r,g,b,a) — replace alpha with brightness
            const baseColor = (FLOW_COLORS[kind] || FLOW_COLORS.default)
                .replace(/[\d.]+\)$/, `${brightness.toFixed(2)})`);

            // Arrowhead uses same color but fully opaque for legibility
            const arrowColor = (FLOW_COLORS[kind] || FLOW_COLORS.default)
                .replace(/[\d.]+\)$/, `${Math.min(brightness + 0.15, 1).toFixed(2)})`);

            // Lines originate and terminate exactly at sector centroids
            const fromLL = L.latLng(from.lat, from.lng);
            const toLL   = L.latLng(to.lat,   to.lng);

            // Main flow line — uniform 2px
            const line = L.polyline([fromLL, toLL], {
                color: baseColor,
                weight: 2,
                opacity: 1,  // opacity baked into color; keep Leaflet opacity at 1
                lineCap: 'round',
                lineJoin: 'round',
                interactive: false,
                pane: 'overlayPane',
            }).addTo(_flowGroup);

            // Arrowhead at exact destination centroid
            // Angle computed in screen space via map projection
            const fromPx = map.latLngToContainerPoint(fromLL);
            const toPx   = map.latLngToContainerPoint(toLL);
            const angle  = Math.atan2(toPx.y - fromPx.y, toPx.x - fromPx.x) * (180 / Math.PI);

            const arrowIcon = L.divIcon({
                className: '',
                html: `<svg width="16" height="16" viewBox="0 0 20 20"
                    style="overflow:visible;display:block;">
                    <polygon points="10,2 18,18 10,14 2,18"
                        fill="${arrowColor}"
                        transform="rotate(${angle + 90}, 10, 10)" />
                </svg>`,
                iconSize: [16, 16],
                iconAnchor: [8, 8],
            });

            L.marker(toLL, { icon: arrowIcon, interactive: false }).addTo(_flowGroup);

            // Volume label at midpoint for flows carrying 3+ events
            if (volume >= 3) {
                const midLat = (fromLL.lat + toLL.lat) / 2;
                const midLng = (fromLL.lng + toLL.lng) / 2;
                const labelIcon = L.divIcon({
                    className: 'ts-flow-label',
                    html: `<span>${volume}</span>`,
                    iconSize: [24, 14],
                    iconAnchor: [12, 7],
                });
                L.marker([midLat, midLng], { icon: labelIcon, interactive: false }).addTo(_flowGroup);
            }

            line._flowMeta = { from, to, volume, kind };
        });
    }

    /* ── Mount all markers; run sequenced intro animation ─────── */
    function mountMarkers(map, markerDataList) {
        _leafletMap = map;
        _mountedRefs = [];
        _allMarkers = markerDataList;

        // Count markers per sector for grid sizing
        const sectorCounts = {};
        markerDataList.forEach(m => {
            sectorCounts[m.sector] = (sectorCounts[m.sector] || 0) + 1;
        });

        // Sort by KIND_ORDER for animation sequencing
        const sorted = [...markerDataList].sort((a, b) => {
            return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
        });

        const refs = [];

        sorted.forEach(m => {
            const meta = VARIANT_META[m.kind] || VARIANT_META.default;
            const sectorCount = sectorCounts[m.sector] || 1;
            const scale = tierScale(m._raw?.sensitivity_tier || 1);

            const wrapper = document.createElement('div');
            wrapper.className = 'ts-reticle-card ts-mini';
            wrapper.dataset.markerId = m.id;
            wrapper.dataset.barColor = meta.bar;
            wrapper.dataset.kind = m.kind;

            const svg = makeSVG(meta, scale);
            svg.style.display = 'none';

            const triSvg = makeMiniTriangle(meta, scale);
            triSvg.style.display = 'none';

            wrapper.appendChild(triSvg);
            wrapper.appendChild(svg);
            wrapper.appendChild(makeInfoPanel(m, meta));
            wrapper.appendChild(makeExpandedPanel(m, meta, sectorCount));

            // Icon anchor scales with reticle so the pin point stays on the coord
            // iconSize is intentionally oversized so the expanded panel and
            // info panel (which overflow the reticle bounds) don't get clipped
            // by Leaflet's marker bounding box. pointer-events:none on the card
            // ensures the invisible overflow area never captures clicks.
            const icon = L.divIcon({
                className: 'ts-leaflet-icon',
                html: wrapper,
                iconSize: [520, 230],
                iconAnchor: [Math.round(10 * scale), Math.round(10 * scale)],
            });

            const latlng = L.latLng(m.lat, m.lng);
            const leafletMarker = L.marker(latlng, { icon, interactive: true }).addTo(map);
            refs.push({ card: wrapper, svg, tri: triSvg, meta, latlng, leafletMarker, markerData: m, scale });
        });

        _mountedRefs = refs;

        // Init heatmap layer (hidden until toggled on)
        if (typeof L.heatLayer !== 'undefined') {
            _heatLayer = L.heatLayer([], { radius: 35, blur: 25, maxZoom: 17, gradient: { 0.3: '#ff3333', 0.6: '#ff8800', 1.0: '#ffff00' } });
        }

        requestAnimationFrame(() => { runIntroSequence(refs); });
        const mapWrap = _leafletMap.getContainer().parentElement;
        refs.forEach(({ card, svg, latlng, markerData }) => bindInteractions(card, svg, map, latlng, markerData, mapWrap));
    }

    /* ── Intro animation: animate each group in KIND_ORDER,      */
    /* staggered within group, then collapse all to triangles     */
    function runIntroSequence(refs) {
        // Group by kind in display order
        const groups = KIND_ORDER.map(kind => refs.filter(r => r.card.dataset.kind === kind));

        let groupDelay = 0;
        const STAGGER = 100;       // ms between markers in same group
        const ANIM_DUR = 620;      // approximate duration of animateReticle
        const GROUP_GAP = 150;     // pause between groups
        const allPromises = [];

        groups.forEach(group => {
            group.forEach((ref, i) => {
                const startAt = groupDelay + i * STAGGER;
                const p = new Promise(resolve => {
                    setTimeout(() => {
                        ref.card.classList.remove('ts-mini');
                        ref.svg.style.display = 'block';
                        animateReticle(ref.svg).then(resolve);
                    }, startAt);
                });
                allPromises.push(p);
            });
            // Next group starts after last marker's stagger + animation completes
            groupDelay += (group.length - 1) * STAGGER + ANIM_DUR + GROUP_GAP;
        });

        // After all animations complete, collapse everything to triangles
        Promise.all(allPromises).then(() => {
            setTimeout(() => {
                refs.forEach(({ card, svg, tri, leafletMarker, markerData }) => {
                    // Fade out SVG then show triangle
                    svg.style.transition = 'opacity 0.3s ease';
                    svg.style.opacity = '0';
                    setTimeout(() => {
                        svg.style.display = 'none';
                        svg.style.opacity = '';
                        svg.style.transition = '';
                        resetSVGOpacity(svg);
                        card.classList.add('ts-mini');
                        tri.style.display = 'block';

                        // Apply temporal decay — fade in to the decayed opacity
                        const decay = decayOpacity(markerData._raw?.created_at);
                        const { isFresh } = formatAge(markerData._raw?.created_at);
                        let c = 0;
                        function flickerTri() {
                            tri.style.opacity = c % 2 === 0 ? String(decay) : '0';
                            c++;
                            if (c <= 5) setTimeout(flickerTri, 40 + Math.random() * 40);
                            else {
                                tri.style.opacity = String(decay);
                                // Store decay on the element for applyFilters to reference
                                const el = leafletMarker.getElement();
                                if (el) el.dataset.decayOpacity = String(decay);
                                // Fresh intel gets a slow pulse ring
                                if (isFresh) tri.classList.add('ts-fresh');
                            }
                        }
                        flickerTri();
                    }, 320);
                });
            }, 400);
        });
    }

    /* ── Legend overlay ───────────────────────────────────────── */
    function buildLegend() {
        const items = [
            { label: 'Grid',    color: '#ffffff' },
            { label: 'Report',  color: '#66ccff' },
            { label: 'Ranger',  color: '#b8f000' },
            { label: 'Sensor',  color: '#00e5ff' },
            { label: 'Caution', color: '#ffcc44' },
            { label: 'Threat',  color: '#ff3333' },
        ];
        return `
        <div class="ts-legend">
            <div class="ts-legend__title">RETICLE VARIANTS</div>
            ${items.map(i => `
            <div class="ts-legend__row">
                <span class="ts-legend__dot" style="border-color:${i.color}"></span>
                <span class="ts-legend__label">${i.label}</span>
            </div>`).join('')}
            <div class="ts-legend__scale-row">
                <span class="ts-legend__dot" style="border-color:#666;width:6px;height:6px;"></span>
                <span class="ts-legend__dot" style="border-color:#888;width:9px;height:9px;"></span>
                <span class="ts-legend__dot" style="border-color:#aaa;width:13px;height:13px;"></span>
                <span class="ts-legend__label" style="color:#444;">TIER SCALE</span>
            </div>
            <div class="ts-legend__decay-row">
                <span class="ts-legend__decay-swatch" style="opacity:0.25;"></span>
                <span class="ts-legend__decay-swatch" style="opacity:0.55;"></span>
                <span class="ts-legend__decay-swatch" style="opacity:1;"></span>
                <span class="ts-legend__label" style="color:#444;">OPACITY = AGE</span>
            </div>
            <div class="ts-legend__age-row">
                <span class="ts-legend__age-dot" style="background:#00ff88;"></span>
                <span class="ts-legend__age-tick">&lt;6h</span>
                <span class="ts-legend__age-dot" style="background:#ffcc44;"></span>
                <span class="ts-legend__age-tick">&lt;48h</span>
                <span class="ts-legend__age-dot" style="background:#ff5533;"></span>
                <span class="ts-legend__age-tick">OLD</span>
            </div>
            <div class="ts-legend__flow-row">
                <span class="ts-legend__flow-line ts-legend__flow-line--dim"></span>
                <span class="ts-legend__flow-line ts-legend__flow-line--mid"></span>
                <span class="ts-legend__flow-line ts-legend__flow-line--bright"></span>
                <span class="ts-legend__label" style="color:#444;">BRIGHTNESS = VOLUME</span>
            </div>
            <div class="ts-legend__hint">Hover △ to inspect · Click △ to restore · Size = tier · Opacity = age · ● = fresh · FLOWS = corridors</div>
        </div>`;
    }

    /* ── Loading overlay helpers ──────────────────────────────── */
    function showLoadingOverlay(mapEl) {
        const el = document.createElement('div');
        el.id = 'ts-loading';
        el.style.cssText = `
            position:absolute;inset:0;z-index:2000;display:flex;flex-direction:column;
            align-items:center;justify-content:center;background:rgba(11,15,12,0.82);
            font-family:var(--font-mono,'JetBrains Mono',monospace);color:#555;
            font-size:11px;letter-spacing:0.12em;gap:10px;pointer-events:none;`;
        el.innerHTML = `
            <div style="width:32px;height:32px;border:1.5px solid #333;border-top-color:#b8f000;
                border-radius:50%;animation:ts-spin 0.8s linear infinite;"></div>
            <span>FETCHING SIGHTINGS…</span>`;
        mapEl.appendChild(el);

        if (!document.getElementById('ts-spin-style')) {
            const s = document.createElement('style');
            s.id = 'ts-spin-style';
            s.textContent = '@keyframes ts-spin{to{transform:rotate(360deg)}}';
            document.head.appendChild(s);
        }
        return el;
    }

    function hideLoadingOverlay(el) {
        if (el) el.remove();
    }

    /* ── Fit map to markers, or default to Mara ──────────────── */
    function fitMapToMarkers(map, markers) {
        if (markers.length === 0) {
            map.setView([-1.2921, 36.8380], 13);
            return;
        }
        if (markers.length === 1) {
            map.setView([markers[0].lat, markers[0].lng], 14);
            return;
        }
        const lats = markers.map(m => m.lat);
        const lngs = markers.map(m => m.lng);
        const bounds = L.latLngBounds(
            [Math.min(...lats), Math.min(...lngs)],
            [Math.max(...lats), Math.max(...lngs)]
        );
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
    }

    /* ── URL state: encode / decode / push ──────────────────────
       Hash scheme: #/test-site?kinds=report,threat&conf=20&time=7D
                               &heat=1&flows=1&focus=ts-abc
                               &zoom=14&lat=-1.265&lng=36.842
       replaceState keeps the entry in history without a new push,
       so back-button still works (the router owns pushState).      */

    function encodeStateToHash(map) {
        const params = new URLSearchParams();

        // Kind filter — only write when something is deselected
        const allKinds = ['default', 'report', 'ranger', 'sensor', 'command', 'caution', 'threat'];
        const active = allKinds.filter(k => filterState.activeKinds.has(k));
        if (active.length !== allKinds.length) params.set('kinds', active.join(','));

        if (filterState.minConfidence > 0) params.set('conf', String(filterState.minConfidence));
        if (filterState.timeWindow !== 'ALL') params.set('time', filterState.timeWindow);
        if (filterState.heatmapOn) params.set('heat', '1');
        if (filterState.flowsOn)   params.set('flows', '1');

        // Focused marker
        const focused = document.querySelector('.ts-reticle-card.ts-expanded');
        if (focused?.dataset.markerId) params.set('focus', focused.dataset.markerId);

        // Map viewport
        if (map) {
            const c = map.getCenter();
            params.set('zoom', String(map.getZoom()));
            params.set('lat',  c.lat.toFixed(5));
            params.set('lng',  c.lng.toFixed(5));
        }

        const qs = params.toString();
        return `#/test-site${qs ? '?' + qs : ''}`;
    }

    function decodeStateFromHash() {
        const raw = window.location.hash; // e.g. "#/test-site?kinds=report&zoom=14"
        const qIdx = raw.indexOf('?');
        if (qIdx === -1) return {};
        const params = new URLSearchParams(raw.slice(qIdx + 1));

        const out = {};
        if (params.has('kinds')) out.kinds = params.get('kinds').split(',').filter(Boolean);
        if (params.has('conf'))  out.conf  = parseInt(params.get('conf'), 10);
        if (params.has('time'))  out.time  = params.get('time');
        if (params.has('heat'))  out.heat  = params.get('heat') === '1';
        if (params.has('flows')) out.flows = params.get('flows') === '1';
        if (params.has('focus')) out.focus = params.get('focus');
        if (params.has('zoom'))  out.zoom  = parseInt(params.get('zoom'), 10);
        if (params.has('lat') && params.has('lng')) {
            out.lat = parseFloat(params.get('lat'));
            out.lng = parseFloat(params.get('lng'));
        }
        return out;
    }

    // Debounced at 120 ms — map moveend fires on every animation frame
    // during flyTo, so without debouncing we'd replaceState ~60×/sec.
    // 120 ms is short enough to feel immediate after a filter change
    // but long enough to coalesce an entire flyTo animation into one write.
    let _pushStateTimer = null;
    function pushState(map) {
        clearTimeout(_pushStateTimer);
        _pushStateTimer = setTimeout(() => {
            const newHash = encodeStateToHash(map);
            if (window.location.hash !== newHash) {
                history.replaceState(null, '', newHash);
            }
        }, 120);
    }

    /* ── Restore state after markers are mounted ─────────────── */
    /* Applies decoded URL params to filterState, filter bar UI,  */
    /* and focused marker. Called once after mountMarkers resolves.*/
    function restoreState(savedState, map, container) {
        if (!savedState || Object.keys(savedState).length === 0) return;

        const allKinds = ['default', 'report', 'ranger', 'sensor', 'command', 'caution', 'threat'];

        // Kinds
        if (savedState.kinds) {
            const restored = new Set(savedState.kinds.filter(k => allKinds.includes(k)));
            if (restored.size > 0) {
                filterState.activeKinds = restored;
                container.querySelectorAll('.ts-filter-kind').forEach(btn => {
                    btn.classList.toggle('ts-filter-kind--active', restored.has(btn.dataset.kind));
                });
            }
        }

        // Confidence
        if (savedState.conf != null && !isNaN(savedState.conf)) {
            filterState.minConfidence = savedState.conf;
            const slider = document.getElementById('ts-conf-slider');
            const val    = document.getElementById('ts-conf-val');
            if (slider) slider.value = String(savedState.conf);
            if (val)    val.textContent = `${savedState.conf}%`;
        }

        // Time window
        if (savedState.time) {
            const valid = ['NOW', '24H', '7D', 'ALL'];
            if (valid.includes(savedState.time)) {
                filterState.timeWindow = savedState.time;
                container.querySelectorAll('.ts-filter-time').forEach(btn => {
                    btn.classList.toggle('ts-filter-time--active', btn.dataset.window === savedState.time);
                });
            }
        }

        // Toggles
        if (savedState.heat) {
            filterState.heatmapOn = true;
            document.getElementById('ts-heat-toggle')?.classList.add('ts-filter-heat--active');
        }
        if (savedState.flows) {
            filterState.flowsOn = true;
            document.getElementById('ts-flow-toggle')?.classList.add('ts-filter-flow--active');
        }

        // Apply filter visibility changes before restoring focus
        applyFilters();

        // Focused marker — find by markerId, restore reticle and expand
        if (savedState.focus) {
            const ref = _mountedRefs.find(r => r.markerData.id === savedState.focus);
            if (ref) {
                setTimeout(() => {
                    restoreReticle(ref.card, ref.svg);
                    ref.card.classList.add('ts-expanded');
                    const ip = ref.card.querySelector('.ts-info-panel');
                    if (ip) { ip.style.width = '200px'; ip.style.opacity = '1'; }
                    const barEls = [
                        ref.svg.querySelector('.bar-track'),
                        ref.svg.querySelector('.bar-fill'),
                    ].filter(Boolean);
                    barEls.forEach(el => el.setAttribute('opacity', '0'));
                    setTimeout(() => flickerGridCells(ref.card.querySelectorAll('.ts-grid-cell')), 180);
                }, 80);
            }
        }

        // Viewport — only override fitBounds if we have explicit saved coords
        if (map && savedState.zoom != null && savedState.lat != null && savedState.lng != null) {
            map.setView([savedState.lat, savedState.lng], savedState.zoom, { animate: false });
        }
    }

    /* ── Keyboard navigation ─────────────────────────────────── */

    function kbClearFocus() {
        if (_focusedIndex < 0) return;
        const ref = _mountedRefs[_focusedIndex];
        if (!ref) return;
        const tri = ref.card.querySelector('.ts-mini-tri');
        if (tri) {
            tri.classList.remove('ts-kb-focus');
            tri.querySelector('.ts-kb-focus-ring')?.remove();
        }
    }

    function kbSetFocus(index) {
        kbClearFocus();
        // Skip hidden markers
        const visible = _mountedRefs.filter((r) => {
            const el = r.leafletMarker.getElement();
            return el && el.style.opacity !== '0';
        });
        if (visible.length === 0) return;

        // Clamp into visible array
        const wrappedI = ((index % visible.length) + visible.length) % visible.length;
        const ref = visible[wrappedI];
        _focusedIndex = _mountedRefs.indexOf(ref);

        const tri = ref.card.querySelector('.ts-mini-tri');
        if (tri) {
            tri.classList.add('ts-kb-focus');
            // Insert focus ring element if not already present
            if (!tri.querySelector('.ts-kb-focus-ring')) {
                const ring = document.createElement('div');
                ring.className = 'ts-kb-focus-ring';
                tri.style.position = 'relative';
                tri.appendChild(ring);
            }
        }

        // Pan map softly to focused marker
        if (_leafletMap) {
            _leafletMap.panTo(ref.latlng, { animate: true, duration: 0.25 });
        }
    }

    function kbActivateEnter() {
        if (_focusedIndex < 0) return;
        const ref = _mountedRefs[_focusedIndex];
        if (!ref) return;
        const { card, svg, latlng } = ref;
        if (card.classList.contains('ts-mini')) {
            // Restore reticle, fly to marker
            restoreReticle(card, svg);
            if (_leafletMap && latlng) {
                const targetZoom = Math.max(_leafletMap.getZoom(), 14);
                _leafletMap.flyTo(latlng, targetZoom, { animate: true, duration: 0.6 });
            }
        } else {
            // Already restored — expand panel
            const wasExpanded = card.classList.contains('ts-expanded');
            if (wasExpanded) {
                collapseToTriangle(card, svg);
            } else {
                // Collapse others
                document.querySelectorAll('.ts-reticle-card.ts-expanded').forEach(c => {
                    if (c === card) return;
                    const s = c.querySelector('.ts-reticle-svg');
                    if (s) collapseToTriangle(c, s);
                });
                card.classList.add('ts-expanded');
                const ip = card.querySelector('.ts-info-panel');
                if (ip) { ip.style.width = '0'; ip.style.opacity = '0'; }
                const barEls = [svg.querySelector('.bar-track'), svg.querySelector('.bar-fill'), ...svg.querySelectorAll('.bar-tick')];
                barEls.forEach(el => el?.setAttribute('opacity', '0'));
                setTimeout(() => flickerGridCells(card.querySelectorAll('.ts-grid-cell')), 180);
            }
        }
        pushState(_leafletMap);
    }

    function kbActivateEscape() {
        if (_focusedIndex < 0) return;
        const ref = _mountedRefs[_focusedIndex];
        if (!ref) return;
        const { card, svg } = ref;
        if (!card.classList.contains('ts-mini')) {
            collapseToTriangle(card, svg);
            pushState(_leafletMap);
        }
    }

    function kbActivateDock() {
        if (_focusedIndex < 0) return;
        const ref = _mountedRefs[_focusedIndex];
        if (!ref) return;
        const mapWrap = _leafletMap?.getContainer().parentElement;
        if (mapWrap) openDock(mapWrap, _leafletMap, ref.markerData);
    }

    function wireKeyboard() {
        // Remove old handler from any previous render
        if (_kbHandler) document.removeEventListener('keydown', _kbHandler);

        // Track iteration index within visible set
        let _kbVisibleIndex = 0;

        _kbHandler = (e) => {
            // Don't intercept when focus is inside an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            const visible = _mountedRefs.filter(r => {
                const el = r.leafletMarker.getElement();
                return el && el.style.opacity !== '0';
            });
            if (visible.length === 0) return;

            const currentVisibleIdx = _focusedIndex >= 0
                ? visible.indexOf(_mountedRefs[_focusedIndex])
                : -1;

            switch (e.key) {
                case 'Tab':
                    e.preventDefault();
                    _kbVisibleIndex = e.shiftKey
                        ? (currentVisibleIdx <= 0 ? visible.length - 1 : currentVisibleIdx - 1)
                        : (currentVisibleIdx + 1) % visible.length;
                    kbSetFocus(_kbVisibleIndex);
                    break;
                case 'ArrowRight':
                case 'ArrowDown':
                    e.preventDefault();
                    _kbVisibleIndex = (currentVisibleIdx + 1) % visible.length;
                    kbSetFocus(_kbVisibleIndex);
                    break;
                case 'ArrowLeft':
                case 'ArrowUp':
                    e.preventDefault();
                    _kbVisibleIndex = (currentVisibleIdx <= 0 ? visible.length - 1 : currentVisibleIdx - 1);
                    kbSetFocus(_kbVisibleIndex);
                    break;
                case 'Enter':
                    e.preventDefault();
                    kbActivateEnter();
                    break;
                case 'Escape':
                    kbActivateEscape();
                    break;
                case 'd':
                case 'D':
                    kbActivateDock();
                    break;
            }
        };

        document.addEventListener('keydown', _kbHandler);
    }

    /* ── Public render ────────────────────────────────────────── */
    async function render(container) {
        // Guard against double-render: router calls render() directly AND
        // window.location.hash assignment fires hashchange → second render.
        // Increment the render ID; any in-flight render that sees its ID
        // is stale will abort before wiring any event listeners.
        const myId = ++_renderId;

        // Destroy the previous Leaflet instance so the map div is reusable
        if (_leafletMap) {
            try { _leafletMap.remove(); } catch (_) { /* already removed */ }
            _leafletMap = null;
            _heatLayer = null;
            _flowGroup = null;
            _mountedRefs = [];
            _allMarkers = [];
        }
        // Wildebeest layer is owned by the map instance; nulled here so
        // buildWildebeestLayer() recreates it fresh on the next render.
        _wildebeestLayer = null;
        _wildebeestOn = false;
        _focusedIndex = -1;

        container.style.padding = '0';
        container.style.overflow = 'hidden';
        container.style.position = 'relative';
        container.style.height = '100%';

        // Decode URL state before resetting — so we can restore after mount
        const savedState = decodeStateFromHash();

        // Reset filter state on each render
        filterState.activeKinds = new Set(['default', 'report', 'ranger', 'sensor', 'command', 'caution', 'threat']);
        filterState.minConfidence = 0;
        filterState.timeWindow = 'ALL';
        filterState.heatmapOn = false;
        filterState.flowsOn   = false;

        const KIND_COLORS = { default: '#ffffff', report: '#66ccff', ranger: '#b8f000', sensor: '#00e5ff', command: '#ffffff', caution: '#ffcc44', threat: '#ff3333' };
        const KIND_LABELS = { default: 'GRID', report: 'REPORT', ranger: 'RANGER', sensor: 'SENSOR', command: 'BASE', caution: 'CAUTION', threat: 'THREAT' };

        container.innerHTML = `
            <div class="ts-shell">
                <div class="ts-header">
                    <div class="ts-header__eyebrow" id="ts-eyebrow">FIELD INTELLIGENCE · LOADING</div>
                    <h1 class="ts-header__title">Field Intel View</h1>
                    <p class="ts-header__sub" id="ts-sub">Fetching live sightings…</p>
                    <div class="ts-filter-bar" id="ts-filter-bar">
                        <div class="ts-filter-group">
                            ${['default','report','ranger','sensor','caution','threat'].map(k => `
                            <button class="ts-filter-kind ts-filter-kind--active" data-kind="${k}"
                                style="--kind-color:${KIND_COLORS[k]}">
                                <span class="ts-filter-kind__dot"></span>${KIND_LABELS[k]}
                            </button>`).join('')}
                        </div>
                        <div class="ts-filter-divider"></div>
                        <div class="ts-filter-group ts-filter-group--conf">
                            <span class="ts-filter-label">CONF</span>
                            <input type="range" class="ts-filter-slider" id="ts-conf-slider"
                                min="0" max="100" step="5" value="0" />
                            <span class="ts-filter-slider-val" id="ts-conf-val">0%</span>
                        </div>
                        <div class="ts-filter-divider"></div>
                        <div class="ts-filter-group">
                            ${['NOW','24H','7D','ALL'].map((w, i) => `
                            <button class="ts-filter-time${i === 3 ? ' ts-filter-time--active' : ''}" data-window="${w}">${w}</button>`).join('')}
                        </div>
                        <div class="ts-filter-divider"></div>
                        <button class="ts-filter-heat" id="ts-heat-toggle">HEAT</button>
                        <button class="ts-filter-flow" id="ts-flow-toggle">FLOWS</button>
                        <button class="ts-filter-flow" id="ts-wildebeest-toggle" title="Wildebeest GPS corridors · Mara 2017–2021">GNU</button>
                        <div class="ts-filter-divider"></div>
                        <span class="ts-filter-cache" id="ts-cache-badge">···</span>
                    </div>
                </div>
                <div class="ts-map-wrap" style="position:relative;">
                    <div id="ts-map" style="position:absolute;inset:0;"></div>
                    ${buildLegend()}
                </div>
            </div>`;

        if (typeof L === 'undefined') {
            document.getElementById('ts-map').innerHTML =
                '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:#555;">Leaflet not loaded</div>';
            return;
        }

        const map = L.map('ts-map', {
            center: [-1.2921, 36.8380],
            zoom: 13,
            zoomControl: true,
            attributionControl: true,
        });

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
            maxZoom: 19,
            subdomains: 'abcd',
        }).addTo(map);
        map.attributionControl.setPrefix('');

        /* ── Wildebeest GPS corridor layer (lazy-built on first toggle) ── */
        function buildWildebeestLayer() {
            if (_wildebeestLayer) return _wildebeestLayer;
            const data = typeof WILDEBEEST_GPS !== 'undefined' ? WILDEBEEST_GPS : null;
            if (!data || !data.points.length) return null;
            const renderer = L.canvas({ padding: 0.5 });
            const group = L.layerGroup();
            data.points.forEach(([lat, lng]) => {
                L.circleMarker([lat, lng], {
                    renderer,
                    radius: 2,
                    color: 'transparent',
                    fillColor: '#c8ff00',
                    fillOpacity: 0.28,
                    interactive: false,
                }).addTo(group);
            });
            _wildebeestLayer = group;
            return group;
        }

        // Show spinner over the map while fetching
        const mapWrap = container.querySelector('.ts-map-wrap');
        const loadingEl = showLoadingOverlay(mapWrap);

        let markers = FALLBACK_MARKERS;
        let usingLive = false;

        try {
            const raw = await API.get('/analysis/sightings');
            if (Array.isArray(raw) && raw.length > 0) {
                const liveMarkers = raw
                    .filter(r => r.latitude != null && r.longitude != null)
                    .map(sightingToMarker);
                
                // Always inject mock assets (rangers & sensors) into the live stream
                const mockAssets = FALLBACK_MARKERS.filter(m => m.id.startsWith('ranger-') || m.id.startsWith('sensor-'));
                markers = [...liveMarkers, ...mockAssets];
                usingLive = true;
            }
        } catch (err) {
            console.warn('[TestSitePage] Sightings fetch failed, using fallback markers.', err);
        }

        // A newer render started while we were awaiting — bail out now.
        // Without this, both renders would wire duplicate event listeners
        // onto the same DOM buttons, causing every click to double-toggle.
        if (myId !== _renderId) return;

        hideLoadingOverlay(loadingEl);

        // Update header to reflect data source and count
        const eyebrow = document.getElementById('ts-eyebrow');
        const sub = document.getElementById('ts-sub');
        if (eyebrow) eyebrow.textContent = usingLive
            ? `FIELD INTELLIGENCE · LIVE · ${markers.length} SIGHTINGS`
            : 'FIELD INTELLIGENCE · FALLBACK DATA';
        if (sub) sub.textContent = usingLive
            ? `Live sightings — Greater Mara Ecosystem. Grid → Report → Asset → Threat load sequence.`
            : `API unavailable — displaying fallback markers. Grid → Report → Asset → Threat load sequence.`;

        // Only fit to markers if URL has no saved viewport
        if (savedState.zoom == null) {
            fitMapToMarkers(map, markers);
        }
        mountMarkers(map, markers);
        wireKeyboard();

        // Restore URL state after markers are mounted
        restoreState(savedState, map, container);

        // Track map viewport changes → push to URL
        map.on('moveend zoomend', () => pushState(map));

        // ── Wire filter bar ──────────────────────────────────────

        // Kind toggles
        container.querySelectorAll('.ts-filter-kind').forEach(btn => {
            btn.addEventListener('click', () => {
                const kind = btn.dataset.kind;
                if (filterState.activeKinds.has(kind)) {
                    if (filterState.activeKinds.size === 1) return;
                    filterState.activeKinds.delete(kind);
                    btn.classList.remove('ts-filter-kind--active');
                } else {
                    filterState.activeKinds.add(kind);
                    btn.classList.add('ts-filter-kind--active');
                }
                applyFilters();
                pushState(map);
            });
        });

        // Confidence slider
        const confSlider = document.getElementById('ts-conf-slider');
        const confVal = document.getElementById('ts-conf-val');
        confSlider?.addEventListener('input', () => {
            filterState.minConfidence = parseInt(confSlider.value, 10);
            if (confVal) confVal.textContent = `${confSlider.value}%`;
            applyFilters();
            pushState(map);
        });

        // Time window presets
        container.querySelectorAll('.ts-filter-time').forEach(btn => {
            btn.addEventListener('click', () => {
                container.querySelectorAll('.ts-filter-time').forEach(b => b.classList.remove('ts-filter-time--active'));
                btn.classList.add('ts-filter-time--active');
                filterState.timeWindow = btn.dataset.window;
                applyFilters();
                pushState(map);
            });
        });

        // Heatmap toggle
        document.getElementById('ts-heat-toggle')?.addEventListener('click', (e) => {
            filterState.heatmapOn = !filterState.heatmapOn;
            e.currentTarget.classList.toggle('ts-filter-heat--active', filterState.heatmapOn);
            applyFilters();
            pushState(map);
        });

        // Flow arrows toggle
        document.getElementById('ts-flow-toggle')?.addEventListener('click', (e) => {
            filterState.flowsOn = !filterState.flowsOn;
            e.currentTarget.classList.toggle('ts-filter-flow--active', filterState.flowsOn);
            applyFilters();
            pushState(map);
        });

        // Wildebeest GPS corridor toggle
        document.getElementById('ts-wildebeest-toggle')?.addEventListener('click', (e) => {
            _wildebeestOn = !_wildebeestOn;
            e.currentTarget.classList.toggle('ts-filter-flow--active', _wildebeestOn);
            if (_wildebeestOn) {
                const layer = buildWildebeestLayer();
                if (layer) layer.addTo(map);
            } else if (_wildebeestLayer) {
                map.removeLayer(_wildebeestLayer);
            }
        });

        // Cache / data source badge
        const cacheBadge = document.getElementById('ts-cache-badge');
        if (cacheBadge) {
            if (usingLive) {
                cacheBadge.textContent = 'LIVE';
                cacheBadge.style.color = '#39ff14';
            } else {
                cacheBadge.textContent = 'FALLBACK';
                cacheBadge.style.color = '#555';
            }
        }
    }

    return { render };
})();
