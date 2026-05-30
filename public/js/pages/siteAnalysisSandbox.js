/* ============================================================
   TERRA – siteAnalysisSandbox.js
   Reference implementation of TSA-001: Scoped Session
   Architecture for Site Analysis.

   Architecture implemented here:
     - SessionBoundary  : polygon model, point-in-polygon filter
     - LayerStream      : independent lifecycle per data type
     - DeltaQueue       : batched rAF render, one paint per frame
     - SessionController: lifecycle (DORMANT → BOUNDARY SET → ACTIVE → TEARDOWN)

   Data is simulated. All architectural patterns are
   production-identical to the specification.
   ============================================================ */

const SiteAnalysisSandboxPage = (() => {

    /* ── Constants ───────────────────────────────────────────── */
    const MOCK_CENTER   = { lat: -0.36, lng: 36.95 }; // Laikipia, Kenya
    const MOCK_SPREAD   = 0.18;   // ~20km radius for mock data scatter
    const MAX_TRAIL_PTS = 50;
    const LAYER_COLORS  = {
        gps:       '#b8f000',
        acoustic:  '#00c8e0',
        reports:   '#66ccff',
        vegetation:'#00ff88',
    };

    /* ── Session states (TSA-001 §4) ─────────────────────────── */
    const STATE = { DORMANT: 'DORMANT', BOUNDARY: 'BOUNDARY SET', ACTIVE: 'ACTIVE', TEARDOWN: 'TEARDOWN' };

    /* ── Module state ────────────────────────────────────────── */
    let _container  = null;
    let _map        = null;
    let _canvas     = null;         // shared L.canvas renderer
    let _drawControl= null;
    let _drawLayer  = null;
    let _boundary   = null;         // SessionBoundary instance
    let _session    = null;         // active session object
    let _state      = STATE.DORMANT;
    let _streams    = {};           // { gps, acoustic, reports, vegetation }
    let _deltaQueue = null;
    let _logEl      = null;

    /* ── Confidence normaliser (mirrors testSite.js) ────────── */
    function normaliseConf(score) {
        if (score == null) return null;
        return score > 1 ? score / 100 : score;
    }

    /* ── Mock data ───────────────────────────────────────────── */
    const MOCK_ANIMALS = [
        { id: 'A1', lat: -0.31, lng: 36.88, name: 'LION-F-04',    speed: 0.0008 },
        { id: 'A2', lat: -0.34, lng: 36.97, name: 'ELEPHANT-M-12',speed: 0.0005 },
        { id: 'A3', lat: -0.40, lng: 36.90, name: 'LEOPARD-M-07', speed: 0.0010 },
        { id: 'A4', lat: -0.28, lng: 37.08, name: 'WILD-DOG-03',  speed: 0.0012 }, // will often be outside
        { id: 'A5', lat: -0.55, lng: 36.75, name: 'BUFFALO-F-22', speed: 0.0006 }, // far outside
        { id: 'A6', lat: -0.38, lng: 36.93, name: 'CHEETAH-M-01', speed: 0.0014 },
    ];

    const MOCK_SENSORS = [
        { id: 'S01', lat: -0.32, lng: 36.90, label: 'ACO-NW-01' },
        { id: 'S02', lat: -0.35, lng: 36.95, label: 'ACO-CTR-02' },
        { id: 'S03', lat: -0.38, lng: 36.88, label: 'ACO-SW-03' },
        { id: 'S04', lat: -0.33, lng: 37.01, label: 'ACO-NE-04' },
        { id: 'S05', lat: -0.41, lng: 36.96, label: 'ACO-SE-05' },
        { id: 'S06', lat: -0.29, lng: 36.84, label: 'ACO-FAR-06' }, // likely outside
        { id: 'S07', lat: -0.48, lng: 37.10, label: 'ACO-FAR-07' }, // likely outside
        { id: 'S08', lat: -0.36, lng: 36.92, label: 'ACO-CTR-08' },
        { id: 'S09', lat: -0.34, lng: 36.98, label: 'ACO-NE-09' },
        { id: 'S10', lat: -0.39, lng: 36.91, label: 'ACO-CTR-10' },
    ];

    /* ═══════════════════════════════════════════════════════════
       SESSION BOUNDARY (TSA-001 §5)
    ═══════════════════════════════════════════════════════════ */
    class SessionBoundary {
        constructor(latlngs) {
            this.latlngs = latlngs;
            this._bounds = L.latLngBounds(latlngs);
        }

        /* Ray-casting point-in-polygon (Jordan curve theorem) */
        contains(latlng) {
            const x = latlng.lng !== undefined ? latlng.lng : latlng[1];
            const y = latlng.lat !== undefined ? latlng.lat : latlng[0];
            const poly = this.latlngs;
            let inside = false;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                const xi = poly[i].lng, yi = poly[i].lat;
                const xj = poly[j].lng, yj = poly[j].lat;
                const intersect = ((yi > y) !== (yj > y)) &&
                    (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
            return inside;
        }

        /* True if any point in array is within boundary */
        intersectsPath(latlngsArr) {
            return latlngsArr.some(pt => this.contains(pt));
        }

        toBounds() { return this._bounds; }

        /* Approximate area in km² using shoelace + haversine */
        areaKm2() {
            const R = 6371;
            const poly = this.latlngs;
            let area = 0;
            for (let i = 0; i < poly.length; i++) {
                const j = (i + 1) % poly.length;
                const xi = poly[i].lng * Math.PI / 180;
                const yi = poly[i].lat * Math.PI / 180;
                const xj = poly[j].lng * Math.PI / 180;
                const yj = poly[j].lat * Math.PI / 180;
                area += (xj - xi) * (2 + Math.sin(yi) + Math.sin(yj));
            }
            return Math.abs(area * R * R / 2).toFixed(1);
        }
    }

    /* ═══════════════════════════════════════════════════════════
       DELTA QUEUE (TSA-001 §7.1)
       Batches all layer updates into one rAF flush per frame.
    ═══════════════════════════════════════════════════════════ */
    class DeltaQueue {
        constructor() {
            this._pending = new Map();
            this._rafId   = null;
        }

        push(id, fn) {
            this._pending.set(id, fn); // latest write wins
            if (!this._rafId) {
                this._rafId = requestAnimationFrame(() => this._flush());
            }
        }

        _flush() {
            this._rafId = null;
            this._pending.forEach(fn => fn());
            this._pending.clear();
        }

        destroy() {
            if (this._rafId) cancelAnimationFrame(this._rafId);
            this._pending.clear();
        }
    }

    /* ═══════════════════════════════════════════════════════════
       GPS LAYER STREAM (TSA-001 §6.1)
    ═══════════════════════════════════════════════════════════ */
    class GPSLayerStream {
        constructor() {
            this._layer    = null;
            this._timer    = null;
            this._markers  = {};  // id → { marker, trail, positions, heading }
            this._boundary = null;
            this._stats    = { rendered: 0, blocked: 0 };
        }

        activate(boundary, map, canvas, queue, onStats) {
            this._boundary = boundary;
            this._queue    = queue;
            this._onStats  = onStats;
            this._layer    = L.layerGroup().addTo(map);

            // Full draw: add all animals, filter by boundary
            MOCK_ANIMALS.forEach(a => {
                const inBounds = boundary.contains({ lat: a.lat, lng: a.lng });
                const marker = L.circleMarker([a.lat, a.lng], {
                    renderer: canvas, radius: 5,
                    color: LAYER_COLORS.gps, weight: 1.5,
                    fillColor: LAYER_COLORS.gps, fillOpacity: inBounds ? 0.5 : 0.1,
                    opacity: inBounds ? 1 : 0.2,
                }).addTo(this._layer);
                marker.bindTooltip(a.name, { permanent: false, className: 'sasb-veg-tooltip', direction: 'right' });

                const trail = L.polyline([[a.lat, a.lng]], {
                    renderer: canvas, color: LAYER_COLORS.gps,
                    weight: 1, opacity: inBounds ? 0.5 : 0.1,
                }).addTo(this._layer);

                this._markers[a.id] = {
                    marker, trail,
                    positions: [{ lat: a.lat, lng: a.lng }],
                    lat: a.lat, lng: a.lng,
                    speed: a.speed, inBounds,
                };

                if (inBounds) this._stats.rendered++;
                else this._stats.blocked++;
            });

            this._onStats({ ...this._stats });

            // Independent tick — 2 000ms (TSA-001 §6.1)
            this._timer = setInterval(() => this._tick(), 2000);
        }

        _tick() {
            this._stats.rendered = 0;
            this._stats.blocked  = 0;

            MOCK_ANIMALS.forEach(a => {
                const state = this._markers[a.id];
                if (!state) return;

                // Simulate random walk
                const dlat = (Math.random() - 0.5) * a.speed;
                const dlng = (Math.random() - 0.5) * a.speed;
                state.lat += dlat;
                state.lng += dlng;

                const newPos  = { lat: state.lat, lng: state.lng };
                const inBounds = this._boundary.contains(newPos);
                state.inBounds = inBounds;

                if (inBounds) this._stats.rendered++;
                else this._stats.blocked++;

                // Delta: push update to queue (O(1) per animal)
                this._queue.push(`gps-${a.id}`, () => {
                    state.marker.setLatLng([state.lat, state.lng]);
                    state.marker.setStyle({
                        fillOpacity: inBounds ? 0.5 : 0.08,
                        opacity:     inBounds ? 1    : 0.15,
                    });

                    // Extend trail — FIFO, max MAX_TRAIL_PTS
                    state.positions.push(newPos);
                    if (state.positions.length > MAX_TRAIL_PTS) state.positions.shift();
                    state.trail.setLatLngs(state.positions.map(p => [p.lat, p.lng]));
                    state.trail.setStyle({ opacity: inBounds ? 0.45 : 0.08 });
                });
            });

            this._onStats({ ...this._stats });
        }

        deactivate() {
            clearInterval(this._timer);
            this._timer = null;
            if (this._layer) { this._layer.clearLayers(); this._layer.remove(); this._layer = null; }
            this._markers  = {};
            this._boundary = null;
            this._stats    = { rendered: 0, blocked: 0 };
        }
    }

    /* ═══════════════════════════════════════════════════════════
       ACOUSTIC LAYER STREAM (TSA-001 §6.2)
    ═══════════════════════════════════════════════════════════ */
    class AcousticLayerStream {
        constructor() {
            this._layer    = null;
            this._timer    = null;
            this._markers  = {};
            this._boundary = null;
            this._stats    = { rendered: 0, blocked: 0 };
        }

        activate(boundary, map, _canvas, queue, onStats) {
            this._boundary = boundary;
            this._queue    = queue;
            this._onStats  = onStats;
            this._layer    = L.layerGroup().addTo(map);

            // Activation: only sensors within boundary are rendered (TSA-001 §6.2)
            MOCK_SENSORS.forEach(s => {
                const inBounds = boundary.contains({ lat: s.lat, lng: s.lng });
                if (inBounds) {
                    const icon = L.divIcon({
                        className: '',
                        html: `<div class="sasb-sensor-marker" data-sid="${s.id}">
                                 <div class="sasb-sensor-core"></div>
                                 <div class="sasb-sensor-ring"></div>
                               </div>`,
                        iconSize: [14, 14], iconAnchor: [7, 7],
                    });
                    const marker = L.marker([s.lat, s.lng], { icon, interactive: false }).addTo(this._layer);
                    marker.bindTooltip(s.label, { permanent: false, className: 'sasb-veg-tooltip', direction: 'right' });
                    this._markers[s.id] = { marker, inBounds: true };
                    this._stats.rendered++;
                } else {
                    this._stats.blocked++;
                }
            });

            this._onStats({ ...this._stats });

            // Independent tick — 3 000ms (TSA-001 §6.2)
            this._timer = setInterval(() => this._tick(), 3000);
        }

        _tick() {
            const ids = Object.keys(this._markers);
            if (!ids.length) return;

            // Simulate random sensor event — delta: animate one sensor only
            const id = ids[Math.floor(Math.random() * ids.length)];
            this._queue.push(`acoustic-${id}`, () => {
                const el = document.querySelector(`.sasb-sensor-marker[data-sid="${id}"]`);
                if (!el) return;
                el.classList.remove('is-firing');
                void el.offsetWidth; // reflow to restart animation
                el.classList.add('is-firing');
                setTimeout(() => el.classList.remove('is-firing'), 950);
            });
        }

        deactivate() {
            clearInterval(this._timer);
            this._timer = null;
            if (this._layer) { this._layer.clearLayers(); this._layer.remove(); this._layer = null; }
            this._markers  = {};
            this._boundary = null;
            this._stats    = { rendered: 0, blocked: 0 };
        }
    }

    /* ═══════════════════════════════════════════════════════════
       REPORTS LAYER STREAM (TSA-001 §6.3)
       Fetches real user-submitted reports from /analysis/sightings.
       Initial load renders all reports within boundary; subsequent
       5s ticks poll for new arrivals (delta by report ID).
    ═══════════════════════════════════════════════════════════ */
    class ReportsLayerStream {
        constructor() {
            this._layer    = null;
            this._timer    = null;
            this._markers  = {};   // id → L.Marker
            this._seen     = new Set(); // report IDs already rendered
            this._boundary = null;
            this._stats    = { rendered: 0, blocked: 0 };
            this._destroyed= false;
        }

        activate(boundary, map, _canvas, queue, onStats) {
            this._boundary = boundary;
            this._queue    = queue;
            this._onStats  = onStats;
            this._layer    = L.layerGroup().addTo(map);

            // Initial fetch — load all existing reports
            this._fetchAndRender().then(() => {
                if (this._destroyed) return;
                // Independent tick — 5 000ms (TSA-001 §6.3)
                this._timer = setInterval(() => this._fetchAndRender(), 5000);
            });

            this._onStats({ ...this._stats });
        }

        async _fetchAndRender() {
            let records;
            try {
                records = await API.get('/analysis/sightings');
            } catch {
                return; // network failure — skip tick silently
            }

            if (this._destroyed || !this._boundary) return;

            (records || []).forEach(raw => {
                const id = String(raw.id || raw.report_id || raw._id);
                if (this._seen.has(id)) return; // already rendered

                const lat = parseFloat(raw.latitude  ?? raw.lat);
                const lng = parseFloat(raw.longitude ?? raw.lng ?? raw.lon);
                if (isNaN(lat) || isNaN(lng)) return;

                const inBounds = this._boundary.contains({ lat, lng });

                if (!inBounds) {
                    this._stats.blocked++;
                    this._seen.add(id); // mark seen so we don't re-count next tick
                    this._onStats({ ...this._stats });
                    return; // spatial filter: do not render (TSA-001 P-01)
                }

                this._seen.add(id);
                this._stats.rendered++;

                // Determine kind / colour (mirrors testSite.js kind mapping)
                const tier = raw.sensitivity_tier ?? 0;
                const isValidated = (raw.validation_status || '').toUpperCase() === 'VALIDATED';
                let color;
                if (tier >= 3) {
                    color = '#ff3333';      // threat — red
                } else if (isValidated && raw.species_name) {
                    color = '#66ccff';      // validated report — cyan
                } else {
                    color = '#ffffff';      // default
                }

                const conf = normaliseConf(raw.ai_confidence_score);
                const species = raw.species_name || raw.sighting_type || raw.description || 'UNKNOWN';
                const confPct = conf != null ? Math.round(conf * 100) : null;

                // Delta: add new marker only (never redraw existing)
                const markerId = `rpt-${id}`;
                this._queue.push(markerId, () => {
                    if (!this._layer) return;
                    const icon = L.divIcon({
                        className: '',
                        html: this._makeReticleHTML(color, conf ?? 0),
                        iconSize: [26, 22], iconAnchor: [13, 11],
                    });
                    const marker = L.marker([lat, lng], { icon }).addTo(this._layer);
                    const confStr = confPct != null ? `<br><span style="color:${color};font-size:9px">${confPct}% CONF</span>` : '';
                    const label = `${species}${confStr}`;
                    marker.bindTooltip(label, { className: 'sasb-veg-tooltip', direction: 'right' });
                    this._markers[markerId] = marker;
                });

                this._onStats({ ...this._stats });
            });
        }

        _makeReticleHTML(color, conf) {
            const trackH = 18;
            const fillH  = Math.round((conf ?? 0) * trackH);
            const fillY  = 2 + (trackH - fillH); // top of fill (bottom-up)
            return `<svg viewBox="0 0 26 22" width="26" height="22" style="overflow:visible">
              <polyline points="2,6 2,2 6,2"      fill="none" stroke="${color}" stroke-width="1.2"/>
              <polyline points="20,2 24,2 24,6"    fill="none" stroke="${color}" stroke-width="1.2"/>
              <polyline points="2,16 2,20 6,20"    fill="none" stroke="${color}" stroke-width="1.2"/>
              <polyline points="20,20 24,20 24,16" fill="none" stroke="${color}" stroke-width="1.2"/>
              <rect x="21" y="2" width="2.5" height="${trackH}" rx="0.5"
                    stroke="${color}" stroke-width="0.6" fill="none" opacity="0.35"/>
              <rect x="21" y="${fillY}" width="2.5" height="${fillH}"
                    rx="0.5" fill="${color}" opacity="0.85"/>
            </svg>`;
        }

        deactivate() {
            this._destroyed = true;
            clearInterval(this._timer);
            this._timer = null;
            if (this._layer) { this._layer.clearLayers(); this._layer.remove(); this._layer = null; }
            this._markers  = {};
            this._seen.clear();
            this._boundary = null;
            this._stats    = { rendered: 0, blocked: 0 };
        }
    }

    /* ═══════════════════════════════════════════════════════════
       VEGETATION LAYER STREAM (TSA-001 §6.4)
    ═══════════════════════════════════════════════════════════ */
    class VegetationLayerStream {
        constructor() {
            this._layer    = null;
            this._polygon  = null;
            this._timer    = null;
            this._ndvi     = 0.55; // simulated NDVI start value
            this._stats    = { rendered: 1, blocked: 0 };
        }

        activate(boundary, map, _canvas, queue, onStats) {
            this._boundary = boundary;
            this._queue    = queue;
            this._onStats  = onStats;
            this._layer    = L.layerGroup().addTo(map);

            const latlngs = boundary.latlngs.map(p => [p.lat, p.lng]);
            this._polygon = L.polygon(latlngs, {
                color:       LAYER_COLORS.vegetation,
                weight:      1,
                opacity:     0.5,
                fillColor:   this._ndviColor(this._ndvi),
                fillOpacity: this._ndvi * 0.25,
                dashArray:   '4 6',
            }).addTo(this._layer);

            this._polygon.bindTooltip(this._ndviLabel(), {
                permanent: true, className: 'sasb-veg-tooltip', direction: 'center',
            });

            onStats({ ...this._stats });

            // Independent tick — 10 000ms (TSA-001 §6.4)
            this._timer = setInterval(() => this._tick(), 10000);
        }

        _ndviColor(v) {
            // 0 = yellow/brown, 1 = deep green
            const r = Math.round(255 * (1 - v));
            const g = Math.round(160 + 95 * v);
            return `rgb(${r},${g},0)`;
        }

        _ndviLabel() {
            return `NDVI: ${this._ndvi.toFixed(2)} · VEG LAYER ACTIVE`;
        }

        _tick() {
            // Simulate slow vegetation change
            this._ndvi = Math.max(0.1, Math.min(0.95,
                this._ndvi + (Math.random() - 0.48) * 0.04
            ));

            // Delta: update fill only (TSA-001 §6.4 — no full redraw)
            this._queue.push('veg-polygon', () => {
                if (!this._polygon) return;
                this._polygon.setStyle({
                    fillColor:   this._ndviColor(this._ndvi),
                    fillOpacity: this._ndvi * 0.25,
                });
                this._polygon.setTooltipContent(this._ndviLabel());
            });
        }

        deactivate() {
            clearInterval(this._timer);
            this._timer = null;
            if (this._layer) { this._layer.clearLayers(); this._layer.remove(); this._layer = null; }
            this._polygon  = null;
            this._boundary = null;
            this._stats    = { rendered: 1, blocked: 0 };
        }
    }

    /* ═══════════════════════════════════════════════════════════
       SESSION CONTROLLER (TSA-001 §4)
    ═══════════════════════════════════════════════════════════ */
    function _setState(newState) {
        _state = newState;
        const badge = document.getElementById('sasb-session-badge');
        if (!badge) return;

        badge.className = 'badge';
        if (newState === STATE.ACTIVE) {
            badge.classList.add('badge--validated');
        } else if (newState === STATE.BOUNDARY || newState === STATE.TEARDOWN) {
            badge.classList.add('badge--pending');
        }
        badge.textContent = newState;
    }

    function _log(msg, type = '') {
        if (!_logEl) return;
        const now = new Date();
        const ts  = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
        const entry = document.createElement('div');
        entry.className = 'sasb-log-entry';
        entry.innerHTML = `<span class="sasb-log-ts">${ts}</span><span class="sasb-log-msg ${type ? 'is-'+type : ''}">${msg}</span>`;
        _logEl.prepend(entry);
        // Keep log to last 60 entries
        while (_logEl.children.length > 60) _logEl.removeChild(_logEl.lastChild);
    }

    function _activateSession() {
        if (!_boundary || _state === STATE.ACTIVE) return;

        _setState(STATE.ACTIVE);
        _log('Session activated · boundary locked · subscriptions open', 'ok');

        _deltaQueue = new DeltaQueue();

        const activeTypes = _getEnabledLayers();
        activeTypes.forEach(type => _activateStream(type));

        _updateButtons();
    }

    function _deactivateSession() {
        if (_state !== STATE.ACTIVE) return;

        _log('Session deactivating · tearing down streams…', 'warn');
        _setState(STATE.TEARDOWN);

        // TSA-001 §11: teardown order
        Object.values(_streams).forEach(s => { if (s) s.deactivate(); });
        _streams = {};

        if (_deltaQueue) { _deltaQueue.destroy(); _deltaQueue = null; }

        _setState(STATE.BOUNDARY);
        _log('Teardown complete · all subscriptions closed', 'ok');
        _resetStats();
        _updateButtons();
        _updateLayerRows();
    }

    function _activateStream(type) {
        const StreamClass = {
            gps:       GPSLayerStream,
            acoustic:  AcousticLayerStream,
            reports:   ReportsLayerStream,
            vegetation:VegetationLayerStream,
        }[type];
        if (!StreamClass) return;

        _streams[type] = new StreamClass();
        _streams[type].activate(_boundary, _map, _canvas, _deltaQueue, (stats) => {
            _updateStatRow(type, stats);
        });

        _log(`${type.toUpperCase()} stream activated · spatial filter: boundary`, 'info');
        _updateLayerRows();
    }

    function _deactivateStream(type) {
        if (!_streams[type]) return;
        _streams[type].deactivate();
        delete _streams[type];
        _updateStatRow(type, { rendered: 0, blocked: 0 });
        _log(`${type.toUpperCase()} stream deactivated`, 'warn');
        _updateLayerRows();
    }

    /* ── Boundary draw flow ──────────────────────────────────── */
    function _initDrawControl() {
        _drawLayer = new L.FeatureGroup().addTo(_map);

        _drawControl = new L.Control.Draw({
            draw: {
                polygon:   { shapeOptions: { color: '#00c8e0', weight: 2, fillOpacity: 0.05, dashArray: '6 4' } },
                rectangle: false, circle: false, marker: false,
                polyline:  false, circlemarker: false,
            },
            edit: { featureGroup: _drawLayer, edit: false, remove: false },
        });

        _map.on(L.Draw.Event.CREATED, (e) => {
            _drawLayer.clearLayers();
            _drawLayer.addLayer(e.layer);

            const latlngs = e.layer.getLatLngs()[0];
            _boundary = new SessionBoundary(latlngs);

            _log(`Boundary set · ${latlngs.length} vertices · ~${_boundary.areaKm2()} km²`, 'info');
            _setState(STATE.BOUNDARY);

            _updateBoundaryInfo();
            _updateButtons();
            _enableLayerRows();

            // Hide the overlay instruction
            const overlay = document.getElementById('sasb-map-overlay');
            if (overlay) overlay.classList.add('is-hidden');
        });
    }

    function _clearBoundary() {
        if (_state === STATE.ACTIVE) _deactivateSession();
        if (_drawLayer) _drawLayer.clearLayers();
        _boundary = null;
        _setState(STATE.DORMANT);
        _log('Boundary cleared · session reset to DORMANT', 'warn');
        _updateBoundaryInfo();
        _updateButtons();
        _disableLayerRows();

        const overlay = document.getElementById('sasb-map-overlay');
        if (overlay) overlay.classList.remove('is-hidden');
    }

    /* ── UI helpers ──────────────────────────────────────────── */
    function _updateBoundaryInfo() {
        const areaEl   = document.getElementById('sasb-bound-area');
        const vertsEl  = document.getElementById('sasb-bound-verts');
        const stateEl  = document.getElementById('sasb-bound-state');
        if (!_boundary) {
            if (areaEl)  areaEl.textContent  = '—';
            if (vertsEl) vertsEl.textContent = '—';
            if (stateEl) { stateEl.textContent = 'NONE'; stateEl.className = 'sasb-boundary-val'; }
        } else {
            if (areaEl)  areaEl.textContent  = `${_boundary.areaKm2()} km²`;
            if (vertsEl) vertsEl.textContent = `${_boundary.latlngs.length}`;
            if (stateEl) { stateEl.textContent = 'SET'; stateEl.className = 'sasb-boundary-val is-set'; }
        }
    }

    function _updateButtons() {
        const drawBtn   = document.getElementById('sasb-btn-draw');
        const clearBtn  = document.getElementById('sasb-btn-clear');
        const activBtn  = document.getElementById('sasb-btn-activate');
        const deactivBtn= document.getElementById('sasb-btn-deactivate');

        if (drawBtn)    drawBtn.disabled    = _state === STATE.ACTIVE;
        if (clearBtn)   clearBtn.disabled   = !_boundary;
        if (activBtn)   activBtn.disabled   = !_boundary || _state === STATE.ACTIVE;
        if (deactivBtn) deactivBtn.disabled = _state !== STATE.ACTIVE;
    }

    function _getEnabledLayers() {
        return ['gps','acoustic','reports','vegetation'].filter(type => {
            const row = document.querySelector(`.sasb-layer-row[data-type="${type}"]`);
            return row && row.classList.contains('is-on');
        });
    }

    function _enableLayerRows() {
        document.querySelectorAll('.sasb-layer-row').forEach(row => row.classList.add('is-available'));
    }

    function _disableLayerRows() {
        document.querySelectorAll('.sasb-layer-row').forEach(row => row.classList.remove('is-available'));
    }

    function _updateLayerRows() {
        document.querySelectorAll('.sasb-layer-row').forEach(row => {
            const type = row.dataset.type;
            const statusEl = row.querySelector('.sasb-layer-status');
            if (!statusEl) return;
            const streaming = !!_streams[type];
            statusEl.className = `sasb-layer-status${streaming ? ' is-streaming' : ''}`;
            statusEl.textContent = streaming ? 'LIVE' : 'OFF';
        });
    }

    function _updateStatRow(type, stats) {
        const inEl  = document.getElementById(`sasb-stat-in-${type}`);
        const blkEl = document.getElementById(`sasb-stat-blk-${type}`);
        if (inEl)  inEl.textContent  = stats.rendered;
        if (blkEl) blkEl.textContent = `${stats.blocked} BLOCKED`;
    }

    function _resetStats() {
        ['gps','acoustic','reports','vegetation'].forEach(type => {
            _updateStatRow(type, { rendered: 0, blocked: 0 });
        });
    }

    /* ── HTML render ─────────────────────────────────────────── */
    function _buildHTML() {
        const layerDefs = [
            { type: 'gps',        name: 'GPS Tracking',     cadence: '2s',  color: LAYER_COLORS.gps },
            { type: 'acoustic',   name: 'Acoustic Sensors', cadence: '3s',  color: LAYER_COLORS.acoustic },
            { type: 'reports',    name: 'Reports',           cadence: '5s',  color: LAYER_COLORS.reports },
            { type: 'vegetation', name: 'Vegetation',        cadence: '10s', color: LAYER_COLORS.vegetation },
        ];

        return `
        <div class="sasb-shell">

          <!-- ── LEFT PANEL ── -->
          <div class="sasb-panel">

            <!-- Header -->
            <div class="sasb-panel-header">
              <div class="sasb-panel-eyebrow">TSA-001 · SANDBOX</div>
              <div class="sasb-panel-title">Scoped Session<br>Analysis</div>
              <div class="sasb-panel-status-row">
                <span class="sasb-panel-status-label">SESSION</span>
                <span class="badge" id="sasb-session-badge">DORMANT</span>
              </div>
            </div>

            <!-- 01 Boundary -->
            <div class="sasb-section">
              <div class="sasb-section-header">
                <span class="card__title">Boundary</span>
                <span class="sasb-section-num">01</span>
              </div>
              <div class="sasb-kv-list">
                <div class="sasb-kv-row">
                  <span class="sasb-kv-key">State</span>
                  <span class="sasb-kv-val" id="sasb-bound-state">NONE</span>
                </div>
                <div class="sasb-kv-row">
                  <span class="sasb-kv-key">Area</span>
                  <span class="sasb-kv-val" id="sasb-bound-area">—</span>
                </div>
                <div class="sasb-kv-row">
                  <span class="sasb-kv-key">Vertices</span>
                  <span class="sasb-kv-val" id="sasb-bound-verts">—</span>
                </div>
              </div>
              <div class="sasb-btn-stack">
                <button class="btn btn--secondary sasb-btn-full" id="sasb-btn-draw">◈ Draw Region</button>
                <button class="btn btn--danger sasb-btn-full" id="sasb-btn-clear" disabled>✕ Clear</button>
              </div>
            </div>

            <!-- 02 Session -->
            <div class="sasb-section">
              <div class="sasb-section-header">
                <span class="card__title">Session</span>
                <span class="sasb-section-num">02</span>
              </div>
              <div class="sasb-btn-stack">
                <button class="btn btn--primary sasb-btn-full" id="sasb-btn-activate" disabled>▶ Activate</button>
                <button class="btn btn--danger sasb-btn-full" id="sasb-btn-deactivate" disabled>■ Deactivate</button>
              </div>
            </div>

            <!-- 03 Layers -->
            <div class="sasb-section">
              <div class="sasb-section-header">
                <span class="card__title">Layers</span>
                <span class="sasb-section-num">03</span>
              </div>
              <div class="sasb-layer-list">
                ${layerDefs.map(l => `
                <div class="sasb-layer-row is-on" data-type="${l.type}" style="--layer-color:${l.color}">
                  <div class="sasb-layer-toggle"></div>
                  <div class="sasb-layer-meta">
                    <div class="sasb-layer-name">${l.name}</div>
                    <div class="sasb-layer-cadence">${l.cadence} tick · independent</div>
                  </div>
                  <div class="sasb-layer-status">OFF</div>
                </div>`).join('')}
              </div>
            </div>

            <!-- 04 Stats -->
            <div class="sasb-section">
              <div class="sasb-section-header">
                <span class="card__title">Boundary Stats</span>
                <span class="sasb-section-num">04</span>
              </div>
              <div class="sasb-stats-grid">
                ${layerDefs.map(l => `
                <div class="sasb-stat-row" style="--layer-color:${l.color}">
                  <span class="sasb-stat-label">${l.type.toUpperCase()}</span>
                  <div class="sasb-stat-counts">
                    <span class="sasb-stat-in" id="sasb-stat-in-${l.type}">0</span>
                    <span class="sasb-stat-blocked" id="sasb-stat-blk-${l.type}">0 blocked</span>
                  </div>
                </div>`).join('')}
              </div>
            </div>

            <!-- 05 Log -->
            <div class="sasb-section" style="border-bottom:none; padding-bottom:0; flex-shrink:0">
              <div class="sasb-section-header">
                <span class="card__title">Session Log</span>
                <span class="sasb-section-num">05</span>
              </div>
            </div>
            <div class="sasb-log" id="sasb-log"></div>

            <div class="sasb-spec-link">
              <a href="docs/TSA-001-scoped-session-spec.md" target="_blank">TSA-001 · Specification →</a>
            </div>

          </div><!-- /panel -->

          <!-- ── MAP ── -->
          <div class="sasb-map-wrap">
            <div id="sasb-map"></div>
            <div class="sasb-map-overlay" id="sasb-map-overlay">
              <div class="sasb-overlay-icon">◈ · TERRA · SITE ANALYSIS SANDBOX</div>
              <div class="sasb-overlay-msg">Draw a boundary to begin session</div>
            </div>
          </div>

        </div>`;
    }

    function _bindControls() {
        // Draw button — activates Leaflet.Draw polygon tool
        document.getElementById('sasb-btn-draw')?.addEventListener('click', () => {
            new L.Draw.Polygon(_map, _drawControl.options.draw.polygon).enable();
            _log('Draw mode active · click map to place vertices · double-click to close', 'info');
        });

        document.getElementById('sasb-btn-clear')?.addEventListener('click', _clearBoundary);
        document.getElementById('sasb-btn-activate')?.addEventListener('click', _activateSession);
        document.getElementById('sasb-btn-deactivate')?.addEventListener('click', _deactivateSession);

        // Layer row toggles (only effective when session is not active yet)
        document.querySelectorAll('.sasb-layer-row').forEach(row => {
            row.addEventListener('click', () => {
                const type = row.dataset.type;
                const isOn = row.classList.toggle('is-on');

                if (_state === STATE.ACTIVE) {
                    // Hot-swap: activate or deactivate stream without session teardown
                    if (isOn) {
                        _activateStream(type);
                    } else {
                        _deactivateStream(type);
                    }
                }
            });
        });
    }

    function _initMap() {
        _map = L.map('sasb-map', {
            center:          [MOCK_CENTER.lat, MOCK_CENTER.lng],
            zoom:            11,
            zoomControl:     true,
            attributionControl: false,
        });

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            subdomains: 'abcd', maxZoom: 19,
        }).addTo(_map);

        _canvas = L.canvas({ padding: 0.5 });
        _initDrawControl();
    }

    /* ── Public render ───────────────────────────────────────── */
    function render(container) {
        _container = container;
        container.innerHTML = _buildHTML();

        _logEl = document.getElementById('sasb-log');
        _log('Sandbox initialised · session state: DORMANT', 'info');
        _log('Draw a boundary polygon on the map to begin', '');

        requestAnimationFrame(() => {
            _initMap();
            _bindControls();
            _updateButtons();
            _setState(STATE.DORMANT);
        });
    }

    /* ── Cleanup when navigating away ────────────────────────── */
    function destroy() {
        if (_state === STATE.ACTIVE) _deactivateSession();
        if (_map) { _map.remove(); _map = null; }
        _boundary  = null;
        _streams   = {};
        _deltaQueue= null;
        _logEl     = null;
    }

    return { render, destroy };

})();
