/* ============================================================
   TERRA – siteAnalysis.js
   Entry point bifurcates:
     • Sidebar click  → renderSessionsDashboard()  (list of saved sessions)
     • Router with lat/lng options → renderMapView() (full tactical map)
   ============================================================ */


const SiteAnalysisPage = (() => {

    /* ── Module-level Map State ──────────────────────────────── */
    let _container = null;  // Reference to the page container element
    let _skipAutofit = false; // True when a specific viewport is already set (session restore or report flyTo)
    let _map = null;
    let _reports = [];
    let _filteredReports = [];
    let _gridLayer = null;
    let _sightingsLayer = null;
    let _heatmapLayer = null;
    let _bufferLayer = null;
    let _drawnItems = null;
    let _activeMode = 'aesthetic';

    /* ── Animal Tracker State ────────────────────────────────── */
    let _trackerLayer       = null;
    let _trackerCanvas      = null;   // shared L.canvas() renderer
    let _trackerData        = [];     // raw parsed fixes (decimated)
    let _trackerByInd       = {};     // pre-grouped & pre-sorted by individual
    let _trackerVisible     = true;
    let _trackerIndividuals = {};
    let _trackerIntensity   = 'speed'; // 'speed' | 'error' | 'time_gap'
    let _trackerShowArrows  = true;
    let _trackerShowNodes   = true;
    let _trackerShowHeatmap = false;
    // Playback: null = show all; otherwise ISO date ceiling
    let _trackerPlayDate    = null;
    let _trackerPlaying     = false;
    let _trackerPlayTimer   = null;
    let _trackerMinTs       = 0;
    let _trackerMaxTs       = 0;
    let _pendingFlyTo = null;     // Queued flyTo once map is confirmed ready

    /* ── CSV / Portal Data Layer State ──────────────────────── */
    let _csvLayer   = null;   // L.featureGroup for uploaded CSV points
    let _csvRows    = [];     // parsed rows from active CSV
    let _csvColumns = [];     // column names from header row

    /* ── GEE Layer State ─────────────────────────────────────── */
    let _geeLayers = {};          // { vegetation: L.tileLayer, water: L.tileLayer, ... }
    let _geeMapIds = {};          // Cache: { 'vegetation-high': { urlTemplate }, ... }
    let _activeGeeTypes = new Set(); // Currently enabled GEE layer types

    /*
     * _originMarker — the red circle placed at the report's coordinates when
     * the view was opened from a report detail page.  Stored so its popup
     * content can be updated with the species name once loadData() resolves
     * it (the 550 ms map-init delay means species is not yet known when the
     * marker is first created).
     */
    let _originMarker = null;

    /*
     * _bufferRing — the live L.circle that visualises the buffer zone.
     * Added directly to _map (not _bufferLayer) so it survives
     * _bufferLayer.clearLayers() calls from runBufferOnGeometry().
     * Managed exclusively by updateBufferRing().
     */
    let _bufferRing = null;

    /*
     * _sessionReportId — the report_id that originally opened this view.
     * Stored so loadData() can look up the species after the API responds
     * (by which point _pendingFlyTo may already have been cleared by initMap).
     *
     * _sessionSpeciesId / _sessionSpeciesName — the species tied to this
     * session.  Once set, "Total Records" filters to this species inside the
     * buffer zone.  Both are null for fresh sessions with no report context.
     */
    let _sessionReportId   = null;
    let _sessionSpeciesId  = null;
    let _sessionSpeciesName = null;
    let _sessionRegionId   = null;  // Set when opened via a Report Detail region chip

    /*
     * _viewportSpeciesFilter — governs whether "Active Points" and
     * "Sector Density" count every species visible in the viewport
     * ('all') or only sightings matching the session species ('same').
     *
     * Defaults to 'all' for every fresh session.  Persisted to and
     * restored from saved sessions so the panel reads identically
     * when the session is re-opened.
     *
     * 'same' is only actionable when _sessionSpeciesId is set; the
     * dropdown option is disabled otherwise to prevent phantom filtering.
     */
    let _viewportSpeciesFilter = 'all';

    /*
     * _gridResolution — the currently active resolution preset key.
     * Starts on 'standard' for every new map view; can be changed by
     * authorized users via the resolution selector in the layer panel.
     * Also persisted to / restored from saved sessions.
     */
    let _gridResolution = 'standard';

    const SESSIONS_KEY = 'terra-sa-sessions';

    /*
     * _isCommunityRestricted
     *
     * Set once in render() from Auth.getCaps().siteAnalysis.mode.
     * When true the map view applies the Community tier restrictions:
     *   • Basemap locked to satellite, Minimal option is hidden.
     *   • Sightings API called with ?own_only=true.
     *   • GEE, Buffer, and Results panels are not mounted.
     *   • Drawing tools are disabled.
     *   • A non-dismissable info banner is shown.
     * The server enforces all gates independently; this flag is
     * purely for UI rendering — not a security boundary.
     */
    let _isCommunityRestricted = false;

    /*
     * GRID_RESOLUTIONS — all available density-grid presets.
     *
     * cellSize   : the width/height of one grid square in decimal degrees.
     *              At the equator, 0.001° ≈ 111m, so multiply to get metres.
     * display    : human-readable string shown in the stat panel and tooltips.
     * maxCells   : safety cap — if rendering this preset at the current zoom
     *              would produce more than this many cells, we auto-step up
     *              to the next coarser resolution instead of freezing the browser.
     */
    const GRID_RESOLUTIONS = {
        fine:     { label: 'Fine',     cellSize: 0.001, display: '~100m',  maxCells: 300 },
        standard: { label: 'Standard', cellSize: 0.005, display: '~500m',  maxCells: 400 },
        medium:   { label: 'Medium',   cellSize: 0.010, display: '~1km',   maxCells: 500 },
        coarse:   { label: 'Coarse',   cellSize: 0.025, display: '~2.5km', maxCells: 600 },
        regional: { label: 'Regional', cellSize: 0.050, display: '~5km',   maxCells: Infinity },
    };

    /*
     * RESOLUTION_ORDER — keys in coarsest-to-finest order, used when stepping
     * up (fallback) or down (recommendation) during the performance guard.
     */
    const RESOLUTION_ORDER = ['regional', 'coarse', 'medium', 'standard', 'fine'];

    let _timeline = {
        minDate: null,
        maxDate: null,
        currentDate: null,
        playing: false,
        interval: null,
        speedDays: 1
    };

    const LAYERS = {
        aesthetic: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://carto.com/">CARTO</a>'
        }),
        satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri'
        })
    };

    /* ═══════════════════════════════════════════════════════════
       PUBLIC ENTRY POINT
       options = { lat, lng, reportId }  → map view
       (no options)                      → sessions dashboard
    ═══════════════════════════════════════════════════════════ */
    function render(container, options = {}) {
        // Derive tier restriction once per render; all sub-functions read _isCommunityRestricted.
        _isCommunityRestricted = !Auth.can('siteAnalysis.geeAccess');

        const hasCoords = options && options.lat != null && options.lng != null && !isNaN(parseFloat(options.lat));
        if (hasCoords) {
            renderMapView(container, options);
        } else {
            renderSessionsDashboard(container);
        }
    }

    /* ═══════════════════════════════════════════════════════════
       SESSIONS DASHBOARD
    ═══════════════════════════════════════════════════════════ */
    function renderSessionsDashboard(container) {
        _container = container;
        container.innerHTML = `
            <div class="sa-dashboard anim-fade-in">
                <div class="sa-dashboard__header">
                    <div>
                        <h1 class="sa-dashboard__title">Site Analysis Sessions</h1>
                        <p class="sa-dashboard__subtitle">Continue a saved analysis or start a new session.</p>
                    </div>
                    <button class="btn btn--primary sa-dashboard__new" id="btn-new-session">+ New Session</button>
                </div>

                <div class="sa-sessions-wrap" id="sa-sessions-wrap">
                    <!-- Injected by JS -->
                </div>
            </div>
        `;

        document.getElementById('btn-new-session')?.addEventListener('click', () => {
            renderMapView(container, {});
        });

        renderSessionsList();
    }

    function renderSessionsList() {
        const wrap = document.getElementById('sa-sessions-wrap');
        if (!wrap) return;

        const sessions = loadSessions();
        const active = sessions.filter(s => !s.isArchived);
        const archived = sessions.filter(s => s.isArchived);

        if (sessions.length === 0) {
            wrap.innerHTML = `
                <div class="sa-sessions-empty">
                    <div class="sa-sessions-empty__icon">◎</div>
                    <div class="sa-sessions-empty__title">No Saved Sessions</div>
                    <div class="sa-sessions-empty__sub">Start a new analysis session and save it to see it here.</div>
                </div>
            `;
            return;
        }

        // Sort: starred first, then by date
        active.sort((a, b) => (b.isStarred ? 1 : 0) - (a.isStarred ? 1 : 0) || new Date(b.savedAt) - new Date(a.savedAt));

        const renderCard = (s) => {
            const metaLine = s.isTrackerSession && s.trackerMeta
                ? `${s.trackerMeta.individuals} individuals · ${s.trackerMeta.fixes.toLocaleString()} fixes · ${new Date(s.trackerMeta.minTs).toLocaleDateString()} – ${new Date(s.trackerMeta.maxTs).toLocaleDateString()}`
                : `${new Date(s.savedAt).toLocaleString()} · ${s.mode === 'satellite' ? 'Satellite' : 'Minimal'} · Zoom ${s.viewport?.zoom ?? '–'}`;
            const badge = s.isTrackerSession
                ? `<span class="sa-session-card__badge sa-session-card__badge--tracker">Animal Tracker</span>`
                : s.reportId ? `<span class="sa-session-card__badge">From Report</span>` : '';
            return `
            <div class="sa-session-card ${s.isStarred ? 'sa-session-card--starred' : ''} ${s.isTrackerSession ? 'sa-session-card--tracker' : ''}" data-id="${s.id}">
                <div class="sa-session-card__star" data-action="star" data-id="${s.id}" title="${s.isStarred ? 'Unstar' : 'Star'}">
                    ${s.isStarred ? '★' : '☆'}
                </div>
                <div class="sa-session-card__body">
                    <div class="sa-session-card__name">${escapeHtml(s.name)}</div>
                    <div class="sa-session-card__meta">${metaLine}</div>
                    <div class="sa-session-card__coords">
                        ${s.viewport ? `${Number(s.viewport.lat).toFixed(4)}, ${Number(s.viewport.lng).toFixed(4)}` : '–'}
                        ${badge}
                    </div>
                </div>
                <div class="sa-session-card__actions">
                    <button class="sa-session-open btn btn--primary" data-action="open" data-id="${s.id}">Open</button>
                    <div class="sa-session-dropdown-wrap">
                        <button class="sa-session-more" data-id="${s.id}" title="More options">⋮</button>
                        <div class="sa-session-dropdown" id="dropdown-${s.id}">
                            <button class="sa-dd-item" data-action="star" data-id="${s.id}">${s.isStarred ? 'Unstar' : 'Star'}</button>
                            <button class="sa-dd-item" data-action="rename" data-id="${s.id}">Rename</button>
                            <button class="sa-dd-item" data-action="archive" data-id="${s.id}">${s.isArchived ? 'Unarchive' : 'Archive'}</button>
                            <button class="sa-dd-item sa-dd-item--danger" data-action="delete" data-id="${s.id}">Delete</button>
                        </div>
                    </div>
                </div>
            </div>
        `; };

        let html = `<div class="sa-sessions-list">` + active.map(renderCard).join('') + `</div>`;

        if (archived.length > 0) {
            html += `
                <details class="sa-sessions-archived">
                    <summary>Archived (${archived.length})</summary>
                    <div class="sa-sessions-list sa-sessions-list--archived">
                        ${archived.map(renderCard).join('')}
                    </div>
                </details>
            `;
        }

        wrap.innerHTML = html;
        attachSessionListeners();
    }

    function attachSessionListeners() {
        const wrap = document.getElementById('sa-sessions-wrap');
        if (!wrap) return;

        // Open session
        wrap.querySelectorAll('[data-action="open"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                const session = loadSessions().find(s => s.id === id);
                if (session) renderMapView(_container, session);
            });
        });

        // Star toggle (in card body)
        wrap.querySelectorAll('[data-action="star"]').forEach(btn => {
            btn.addEventListener('click', () => {
                mutateSession(btn.dataset.id, s => { s.isStarred = !s.isStarred; });
                renderSessionsList();
            });
        });

        // Archive toggle
        wrap.querySelectorAll('[data-action="archive"]').forEach(btn => {
            btn.addEventListener('click', () => {
                mutateSession(btn.dataset.id, s => { s.isArchived = !s.isArchived; });
                renderSessionsList();
            });
        });

        // Delete
        wrap.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', () => {
                Modal.open({
                    title: 'Delete Session',
                    body: '<p>Permanently delete this session? This cannot be undone.</p>',
                    confirmLabel: 'Delete',
                    onConfirm: () => {
                        deleteSes(btn.dataset.id);
                        renderSessionsList();
                    }
                });
            });
        });

        // Rename
        wrap.querySelectorAll('[data-action="rename"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const session = loadSessions().find(s => s.id === btn.dataset.id);
                if (!session) return;
                Modal.open({
                    title: 'Rename Session',
                    body: `<input id="modal-rename-input" class="form-input" value="${escapeHtml(session.name)}" style="width:100%" />`,
                    confirmLabel: 'Save',
                    onConfirm: () => {
                        const newName = document.getElementById('modal-rename-input')?.value?.trim();
                        if (newName) {
                            mutateSession(btn.dataset.id, s => { s.name = newName; });
                            renderSessionsList();
                        }
                    }
                });
            });
        });

        // Dropdown "⋮" toggle
        wrap.querySelectorAll('.sa-session-more').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                // Close all others
                wrap.querySelectorAll('.sa-session-dropdown.open').forEach(d => {
                    if (d.id !== `dropdown-${id}`) d.classList.remove('open');
                });
                document.getElementById(`dropdown-${id}`)?.classList.toggle('open');
            });
        });

        // Click outside → close dropdowns
        document.addEventListener('click', () => {
            wrap.querySelectorAll('.sa-session-dropdown.open').forEach(d => d.classList.remove('open'));
        }, { once: false });
    }

    /* ── Session localStorage helpers ───────────────────────── */
    function loadSessions() {
        try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]'); }
        catch (e) { return []; }
    }

    function saveSessions(sessions) {
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    }

    function mutateSession(id, mutatorFn) {
        const sessions = loadSessions();
        const s = sessions.find(s => s.id === id);
        if (s) { mutatorFn(s); saveSessions(sessions); }
    }

    function deleteSes(id) {
        saveSessions(loadSessions().filter(s => s.id !== id));
    }

    function createSessionFromMap(name) {
        if (!_map) return null;
        const center = _map.getCenter();

        // Extract drawn geometries
        const drawnFeatures = [];
        if (_drawnItems) {
            _drawnItems.eachLayer(layer => {
                const geoJson = layer.toGeoJSON();
                if (layer._dbId) {
                    geoJson.properties = geoJson.properties || {};
                    geoJson.properties._dbId = layer._dbId;
                }
                
                let drawType = 'unknown';
                if (layer instanceof L.Polygon) drawType = 'polygon';
                else if (layer instanceof L.Polyline) drawType = 'polyline';
                else if (layer instanceof L.Marker) drawType = 'marker';
                
                geoJson.properties = geoJson.properties || {};
                geoJson.properties.drawType = drawType;
                
                drawnFeatures.push(geoJson);
            });
        }

        return {
            id: `sa-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: name || `Session – ${new Date().toLocaleDateString()}`,
            savedAt: new Date().toISOString(),
            isStarred: false,
            isArchived: false,
            viewport: { lat: center.lat, lng: center.lng, zoom: _map.getZoom() },
            mode: _activeMode,
            // Persist the active resolution so opening this session restores the exact view
            gridResolution: _gridResolution,
            // Persist species context so "Total Records" restores to the same species filter
            speciesId:   _sessionSpeciesId,
            speciesName: _sessionSpeciesName,
            // Persist viewport species filter so Active Points / Density restore identically
            viewportSpeciesFilter: _viewportSpeciesFilter,
            layers: {
                grid: document.getElementById('layer-grid')?.checked ?? true,
                tactical: document.getElementById('layer-tactical')?.checked ?? true,
                sightings: document.getElementById('layer-sightings')?.checked ?? true,
                heatmap: document.getElementById('layer-heatmap')?.checked ?? true,
                geeVegetation:    document.getElementById('layer-gee-vegetation')?.checked    ?? false,
                geeWater:         document.getElementById('layer-gee-water')?.checked         ?? false,
                geeElevation:     document.getElementById('layer-gee-elevation')?.checked     ?? false,
                geeLandCover:     document.getElementById('layer-gee-land-cover')?.checked    ?? false,
                geePrecipitation: document.getElementById('layer-gee-precipitation')?.checked ?? false,
                geeTemperature:   document.getElementById('layer-gee-temperature')?.checked   ?? false,
                geeNdviTrend:     document.getElementById('layer-gee-ndvi-trend')?.checked    ?? false,
                geeHabitat:       document.getElementById('layer-gee-habitat')?.checked       ?? false
            },
            timeline: { currentDate: _timeline.currentDate },
            drawnItems: drawnFeatures,
            buffer: {
                radius: document.getElementById('buffer-radius-slider')?.value,
                lat: document.getElementById('buffer-lat')?.value,
                lng: document.getElementById('buffer-lng')?.value
            }
        };
    }

    function escapeHtml(str) {
        return String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    }

    /* ── Grid Resolution Helpers ─────────────────────────────────
     *
     * These three functions work together to make resolution changes
     * safe, smooth, and role-gated.
     * ────────────────────────────────────────────────────────── */

    /*
     * canControlGridResolution()
     *
     * Checks the currently logged-in user's role against the list of
     * roles that are permitted to change the density-grid resolution.
     * Called once when building the layer panel HTML — if the user is
     * not authorised the resolution selector is simply not rendered,
     * so there is nothing to click and no client-side bypass is needed.
     */
    function canControlGridResolution() {
        const role = (Auth.getUser()?.role_name || '').toLowerCase();
        return ['admin', 'ranger', 'analyst'].includes(role);
    }

    /*
     * estimateCellCount(cellSize)
     *
     * Before we commit to a full grid re-render, this gives us a cheap
     * upper-bound on how many rectangles Leaflet would need to draw.
     * We multiply the degree-spans of the current viewport by the inverse
     * of cellSize — i.e. how many cells fit along each axis — then multiply
     * the two axes together.
     *
     * This is intentionally an over-estimate (it counts the full bounding
     * box, not just cells that contain sightings), which keeps us safely
     * conservative about performance.
     */
    function estimateCellCount(cellSize) {
        if (!_map) return 0;
        const b = _map.getBounds();
        const latSpan = b.getNorth() - b.getSouth();
        const lngSpan = b.getEast()  - b.getWest();
        return Math.ceil(latSpan / cellSize) * Math.ceil(lngSpan / cellSize);
    }

    /*
     * getNextCoarserResolution(currentKey)
     *
     * Returns the key of the next coarser preset in RESOLUTION_ORDER.
     * Used by the performance guard inside renderGrid() to step up
     * automatically when the current resolution would produce too many
     * cells.  Returns null when we are already at the coarsest level
     * ('regional'), meaning the guard should just render without stepping.
     *
     * Example:  getNextCoarserResolution('standard') → 'medium'
     *           getNextCoarserResolution('regional')  → null
     */
    function getNextCoarserResolution(currentKey) {
        const idx = RESOLUTION_ORDER.indexOf(currentKey);
        // RESOLUTION_ORDER goes coarsest → finest; a higher index means finer.
        // We want one step coarser, so we move towards index 0.
        return idx > 0 ? RESOLUTION_ORDER[idx - 1] : null;
    }

    /* ── Live Analysis Panel Helpers ────────────────────────────
     *
     * Seven functions that collectively own the bottom stat bar:
     *
     *   haversineDistanceMeters  — pure maths, no deps
     *   getViewportAreaKm2       — map geometry, no deps
     *   getViewportSightings     — data × map bounds, honours species filter
     *   computeViewportStats     — writes sa-val-points + sa-val-density
     *   computeBufferRecords     — writes sa-val-total + sa-delta-total
     *   setSessionSpecies        — sets species context, triggers recompute
     *   syncActivePointsFilter   — keeps the Active Points dropdown in sync
     *                              with the current species context
     *
     * All are called from renderLayers() or the relevant input listeners,
     * so every pan, zoom, filter change, or dropdown selection keeps the
     * panel in sync.
     * ────────────────────────────────────────────────────────── */

    /*
     * matchesSessionSpecies(report)
     *
     * Returns true when the given report belongs to the current session
     * species, handling both storage modes:
     *
     *   UUID-registered species  → report.species_id === _sessionSpeciesId
     *   Free-text species        → report.species_name === _sessionSpeciesId
     *     (free-text entries have species_id = null in the DB; the controller
     *      stores the user's text to species_name_custom, and the sightings
     *      API surfaces it via COALESCE as species_name.  We use species_name
     *      as the effective key for these records.)
     *
     * Called from computeBufferRecords() and getViewportSightings() wherever
     * a species-filtered pool is needed.
     */
    function matchesSessionSpecies(r) {
        if (!_sessionSpeciesId) return false;
        return r.species_id === _sessionSpeciesId
            || r.species_name === _sessionSpeciesId;
    }

    /*
     * haversineDistanceMeters(lat1, lng1, lat2, lng2)
     *
     * Great-circle distance between two WGS-84 points, in metres.
     * Used to test whether a sighting falls inside the buffer zone without
     * a server round-trip, so "Total Records" updates instantly as the user
     * drags the radius slider or types new coordinates.
     *
     * Accuracy ≈ 0.3 % for distances under 300 km — sufficient for
     * buffer radii up to 50 km.
     */
    function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
        const R      = 6371000;                          // Earth mean radius, metres
        const toRad  = deg => deg * Math.PI / 180;
        const dLat   = toRad(lat2 - lat1);
        const dLng   = toRad(lng2 - lng1);
        const a      = Math.sin(dLat / 2) ** 2
                     + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
                     * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /*
     * getViewportAreaKm2()
     *
     * Approximate area of the current map viewport in km², used to
     * normalise the sighting count into a meaningful density value.
     *
     *   Height = latSpan° × 111.32 km/°
     *   Width  = lngSpan° × 111.32 km/° × cos(centreLat)
     *   (cos correction accounts for longitude convergence near the poles)
     *
     * Returns at least 0.001 km² to prevent division by zero at extreme zoom.
     */
    function getViewportAreaKm2() {
        if (!_map) return 1;
        const b          = _map.getBounds();
        const latSpan    = b.getNorth() - b.getSouth();
        const lngSpan    = b.getEast()  - b.getWest();
        const centreLat  = (b.getNorth() + b.getSouth()) / 2;
        const heightKm   = latSpan * 111.32;
        const widthKm    = lngSpan * 111.32 * Math.abs(Math.cos(centreLat * Math.PI / 180));
        return Math.max(heightKm * widthKm, 0.001);
    }

    /*
     * getViewportSightings()
     *
     * Returns the subset of _filteredReports whose coordinates fall inside
     * the current Leaflet viewport bounds.  This is the data source for
     * both "Active Points" and "Sector Density", giving the user a reading
     * that reflects exactly what is visible on screen right now — not the
     * full dataset which may extend far outside the current view.
     *
     * Respects _viewportSpeciesFilter:
     *   'all'  — every record in bounds (default)
     *   'same' — only records whose species_id matches _sessionSpeciesId
     *
     * Density is derived from the same filtered pool, so both stats are
     * always consistent with whichever filter the user has selected.
     */
    function getViewportSightings() {
        if (!_map || _filteredReports.length === 0) return [];

        const bufLat = parseFloat(document.getElementById('buffer-lat')?.value);
        const bufLng = parseFloat(document.getElementById('buffer-lng')?.value);
        const radius = parseInt(document.getElementById('buffer-radius-slider')?.value || 5000, 10);

        /*
         * Active Points now reflects the user's buffer zone rather than the
         * visible viewport.  This makes "SAME SP" meaningful: the user sees
         * exactly how many same-species sightings fall inside the ring they
         * have drawn.  Falls back to viewport bounds when no buffer is set yet.
         */
        let pool;
        if (!isNaN(bufLat) && !isNaN(bufLng)) {
            pool = _filteredReports.filter(r =>
                haversineDistanceMeters(bufLat, bufLng, r.latitude, r.longitude) <= radius
            );
        } else {
            const b = _map.getBounds();
            pool = _filteredReports.filter(r =>
                r.latitude  >= b.getSouth() && r.latitude  <= b.getNorth() &&
                r.longitude >= b.getWest()  && r.longitude <= b.getEast()
            );
        }

        // Apply species filter when SAME SP mode is active
        if (_viewportSpeciesFilter === 'same' && _sessionSpeciesId) {
            pool = pool.filter(matchesSessionSpecies);
        }

        return pool;
    }

    /*
     * computeViewportStats()
     *
     * Recalculates and writes "Active Points" and "Sector Density" using
     * only the sightings that are currently visible in the viewport.
     *
     * Called at the end of renderLayers(), which fires on every moveend,
     * zoomend, layer toggle, and temporal filter change — keeping both
     * stats live without any extra event wiring.
     *
     *   Active Points  : raw viewport sighting count  (whole number)
     *   Sector Density : count ÷ viewport km²         (2 d.p. below 10, 1 d.p. above)
     *
     * Both stats honour the _viewportSpeciesFilter chosen by the user, since
     * they both derive from getViewportSightings().  The Sector Density sub-
     * label updates to reflect which pool is being measured.
     */
    function computeViewportStats() {
        const viewport = getViewportSightings();
        const count    = viewport.length;
        const density  = count / getViewportAreaKm2();

        const pointsEl      = document.getElementById('sa-val-points');
        const densityEl     = document.getElementById('sa-val-density');
        const densityDeltaEl = document.getElementById('sa-delta-density');

        if (pointsEl)  pointsEl.textContent  = count;
        if (densityEl) densityEl.textContent = density < 10
            ? density.toFixed(2)
            : density.toFixed(1);

        // Reflect the active filter in the Sector Density sub-label so both
        // panels clearly communicate that they share the same species scope.
        if (densityDeltaEl) {
            densityDeltaEl.textContent = (_viewportSpeciesFilter === 'same' && _sessionSpeciesId)
                ? 'SAME SP / KM²'
                : 'PTS / KM²';
        }
    }

    /*
     * computeBufferRecords()
     *
     * Counts sightings within the currently configured buffer zone,
     * optionally restricted to the session species.
     *
     * Data source: _filteredReports — so the reading already honours the
     * active temporal filter (timeline slider position).
     *
     * Reads from the DOM at call time so it is always consistent with
     * whatever the user has typed / dragged:
     *   #buffer-lat / #buffer-lng   — buffer centre
     *   #buffer-radius-slider       — radius in metres
     *
     * If no valid centre is set yet (user hasn't placed a buffer), the
     * stat falls back to the total count of species-matching records
     * across all loaded data so the field is never left empty.
     *
     * Writes:
     *   #sa-val-total    — the count
     *   #sa-delta-total  — small descriptor label (species + radius context)
     */
    function computeBufferRecords() {
        const bufLat   = parseFloat(document.getElementById('buffer-lat')?.value);
        const bufLng   = parseFloat(document.getElementById('buffer-lng')?.value);
        const radius   = parseInt(document.getElementById('buffer-radius-slider')?.value || 5000, 10);

        // If a session species is set, narrow the candidate pool to that species only
        const pool = _sessionSpeciesId
            ? _filteredReports.filter(matchesSessionSpecies)
            : _filteredReports;

        let count, label;

        if (!isNaN(bufLat) && !isNaN(bufLng)) {
            // Buffer centre is valid — count how many candidates fall within radius
            count = pool.filter(r =>
                haversineDistanceMeters(bufLat, bufLng, r.latitude, r.longitude) <= radius
            ).length;

            const radiusLabel = radius >= 1000
                ? `${(radius / 1000).toFixed(0)}km`
                : `${radius}m`;

            // Label: include a truncated species tag when the session has species context
            label = _sessionSpeciesName
                ? `${radiusLabel} · ${_sessionSpeciesName.toUpperCase().slice(0, 14)}`
                : `${radiusLabel} BUFFER ZONE`;
        } else {
            // No buffer centre — show total matching records as a fallback
            count = pool.length;
            label = _sessionSpeciesName
                ? `ALL · ${_sessionSpeciesName.toUpperCase().slice(0, 14)}`
                : 'ALL VALIDATED';
        }

        const valEl   = document.getElementById('sa-val-total');
        const deltaEl = document.getElementById('sa-delta-total');
        if (valEl)   valEl.textContent   = count;
        if (deltaEl) deltaEl.textContent = label;
    }

    /*
     * setSessionSpecies(speciesId, speciesName)
     *
     * Stores the species context for the current session.  Once set,
     * computeBufferRecords() will restrict "Total Records" to sightings
     * of this species only.
     *
     * Called from:
     *   - loadData()  : after the report list resolves, when a reportId is
     *                   present and its matching report is found in the data
     *   - initMap()   : during session restore, when speciesId was persisted
     *
     * Passing null clears the filter (all-species mode).
     */
    function setSessionSpecies(speciesId, speciesName) {
        _sessionSpeciesId   = speciesId  || null;
        _sessionSpeciesName = speciesName || null;
        // Recompute immediately so the stat reflects the new species context
        computeBufferRecords();
        // Enable/disable "SAME SP" button and refresh the species badge
        syncActivePointsFilter();
        updateSpeciesDisplay();
        // If the origin marker exists and a species is now known, update its
        // popup so the species row appears without recreating the marker.
        if (_originMarker && _originMarker._updatePopup && _sessionSpeciesName) {
            _originMarker._updatePopup(_sessionSpeciesName);
        }
    }

    /*
     * syncActivePointsFilter()
     *
     * Keeps the Active Points species-filter dropdown aligned with the
     * current session state.  Should be called whenever _sessionSpeciesId
     * or _viewportSpeciesFilter changes.
     *
     * Responsibilities:
     *   1. Enable the "Same Species" option only when _sessionSpeciesId is set.
     *   2. If the species was cleared while the filter was on 'same', silently
     *      fall back to 'all' so the stat panel never shows a phantom filter.
     *   3. Set the select's displayed value to match _viewportSpeciesFilter.
     *   4. Trigger a computeViewportStats() recompute so the numbers are
     *      immediately consistent with the new dropdown state.
     */
    function syncActivePointsFilter() {
        const allBtn  = document.querySelector('#sa-ap-filter-btns [data-filter="all"]');
        const sameBtn = document.getElementById('sa-ap-btn-same');
        if (!allBtn || !sameBtn) return;

        const hasSpecies = !!_sessionSpeciesId;

        // 'SAME SP' is only actionable when a species has been selected
        sameBtn.disabled = !hasSpecies;

        // Guard: if the species was cleared while the filter was on 'same', reset
        if (!hasSpecies && _viewportSpeciesFilter === 'same') {
            _viewportSpeciesFilter = 'all';
        }

        // Reflect active state visually on the two buttons
        allBtn.classList.toggle('active',  _viewportSpeciesFilter === 'all');
        sameBtn.classList.toggle('active', _viewportSpeciesFilter === 'same');

        // Recompute so Active Points and Sector Density immediately match
        computeViewportStats();
    }

    /*
     * populateSpeciesSelector()
     *
     * Builds the species <select> in the Buffer Analysis panel from the
     * unique species found in the loaded _reports array.
     *
     * Called once from loadData() after sightings are fetched, so every
     * species that exists in the dataset is available — regardless of
     * whether the session was opened from a report or created fresh.
     *
     * Uses window.SpeciesRegistry common names when available; falls back
     * to the species_name field on the report, then to the raw species_id.
     *
     * The current _sessionSpeciesId (if any) is pre-selected so restored
     * sessions show the correct species immediately.
     */
    function populateSpeciesSelector() {
        const sel  = document.getElementById('buffer-species-filter');
        if (!sel || _reports.length === 0) return;

        /*
         * Collect unique species from the loaded data.
         *
         * Reports submitted with a free-text species name (e.g. "Cheetah")
         * are stored with species_id = null and species_name_custom = "Cheetah".
         * The API's COALESCE returns species_name = "Cheetah" for those rows, but
         * species_id remains null — so we cannot use species_id as the sole key.
         *
         * Solution: use species_id when present (UUID-registered species), falling
         * back to species_name (the COALESCE display value) for free-text entries.
         * This effective key is stored as the <option> value so the change listener
         * can pass it to setSessionSpecies() for filtering.
         */
        const speciesMap = {};
        _reports.forEach(r => {
            const effectiveKey = r.species_id || r.species_name;
            const displayName  = (window.SpeciesRegistry && r.species_id &&
                                  window.SpeciesRegistry[r.species_id]?.common_name)
                               || r.species_name
                               || r.species_id;
            // Skip blank keys and the generic fallback produced by the DB COALESCE
            if (!effectiveKey || effectiveKey === 'Unknown Species') return;
            if (!speciesMap[effectiveKey]) {
                speciesMap[effectiveKey] = displayName || effectiveKey;
            }
        });

        // Rebuild the option list; "All Species" stays pinned at the top
        sel.innerHTML = '<option value="">All Species</option>';
        Object.entries(speciesMap)
            .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
            .forEach(([key, name]) => {
                const opt = document.createElement('option');
                opt.value = key;
                opt.textContent = name;
                // Pre-select the current session species (report-opened or restored)
                if (key === _sessionSpeciesId) opt.selected = true;
                sel.appendChild(opt);
            });

        // Sync the display badge to the current selection
        updateSpeciesDisplay();
    }

    /*
     * updateSpeciesDisplay()
     *
     * Refreshes the small species badge (#buffer-species-display) next to
     * the "Species" label in the buffer panel to match the current
     * _sessionSpeciesName.  Truncated to stay within the panel width.
     */
    function updateSpeciesDisplay() {
        const disp = document.getElementById('buffer-species-display');
        if (!disp) return;
        disp.textContent = _sessionSpeciesName
            ? _sessionSpeciesName.toUpperCase().slice(0, 12)
            : 'ALL';
    }

    /*
     * setGridResolution(key)
     *
     * Public-facing setter for the active resolution.  Updates module
     * state, refreshes every resolution button's active class, syncs the
     * stat-panel display text, then triggers a full layer re-render so
     * the new cell size is visible immediately.
     *
     * Called from the resolution-button click handler wired up in
     * attachMapListeners(), and also from the performance guard inside
     * renderGrid() when it needs to auto-step coarser.
     */
    function setGridResolution(key) {
        if (!GRID_RESOLUTIONS[key]) return; // Silently ignore unknown keys

        _gridResolution = key;
        const preset = GRID_RESOLUTIONS[key];

        // Reflect active state on every resolution button
        document.querySelectorAll('[data-resolution]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.resolution === key);
        });

        // Update the small meta line inside the layer panel
        const metaEl = document.getElementById('sa-resolution-display');
        if (metaEl) metaEl.textContent = preset.display;

        // Update the bottom stat panel so the field stays in sync
        const statEl = document.getElementById('sa-val-resolution');
        if (statEl) statEl.textContent = preset.display;

        // Re-render the grid layer with the new cell size
        renderLayers();
    }

    /*
     * updateBufferRing()
     *
     * Creates or updates the live red dashed circle that visualises the
     * buffer zone on the map.  Called on every radius-slider input and
     * lat/lng coordinate change so the ring tracks user inputs in real
     * time — no "Run Buffer" click required.
     *
     * The ring lives directly on _map (not _bufferLayer) so it is never
     * accidentally cleared by runBufferOnGeometry()'s layer housekeeping.
     *
     * After updating the ring this function re-renders sightings (so dots
     * inside the ring appear/disappear as the zone changes) and refreshes
     * both the buffer stat and Active Points count.
     */
    function updateBufferRing() {
        if (!_map) return;

        const lat    = parseFloat(document.getElementById('buffer-lat')?.value);
        const lng    = parseFloat(document.getElementById('buffer-lng')?.value);
        const radius = parseInt(document.getElementById('buffer-radius-slider')?.value || 5000, 10);

        if (isNaN(lat) || isNaN(lng)) {
            // No valid centre — remove the ring if present
            if (_bufferRing) { _map.removeLayer(_bufferRing); _bufferRing = null; }
        } else if (_bufferRing) {
            // Smooth in-place update: Leaflet just repositions the SVG path
            _bufferRing.setLatLng([lat, lng]);
            _bufferRing.setRadius(radius);
        } else {
            _bufferRing = L.circle([lat, lng], {
                radius,
                color: '#E31B23',
                weight: 1.5,
                dashArray: '8, 6',
                fillColor: '#E31B23',
                fillOpacity: 0.04
            }).addTo(_map);
        }

        // Keep dots, buffer-zone stat, and Active Points count in sync
        if (document.getElementById('layer-sightings')?.checked) {
            renderSightings();
        } else if (_sightingsLayer) {
            _sightingsLayer.clearLayers();
        }
        computeBufferRecords();
        computeViewportStats();
    }

    /* ═══════════════════════════════════════════════════════════
       MAP VIEW
       options can be { lat, lng, reportId } (from report detail)
       OR a full session object (from sessions list)
    ═══════════════════════════════════════════════════════════ */
    function renderMapView(container, options = {}) {
        _container = container;

        // Reset session state for the new view so stale data never bleeds in.
        _sessionReportId    = options.reportId  || null;
        _sessionSpeciesId   = options.speciesId  || null;
        _sessionSpeciesName = options.speciesName || null;
        _sessionRegionId    = options.regionId   || null;

        // Restore viewport species filter from session, or default to 'all'
        // for every fresh session so the dropdown starts in a clean state.
        _viewportSpeciesFilter = options.viewportSpeciesFilter || 'all';

        // Store flyTo target before the map exists
        if (options.lat != null && options.lng != null) {
            _pendingFlyTo = {
                lat: parseFloat(options.lat),
                lng: parseFloat(options.lng),
                zoom: options.viewport?.zoom || 14,
                reportId: options.reportId || null
            };
            _skipAutofit = true;
        } else {
            _pendingFlyTo = null;
            _skipAutofit = options.viewport != null; // session restore has its own viewport
        }

        // Restore mode from session if present, but Community is always satellite
        if (_isCommunityRestricted) {
            _activeMode = 'satellite';
        } else if (options.mode) {
            _activeMode = options.mode;
        }

        container.innerHTML = `
        <div class="site-analysis anim-fade-in">
            <div class="sa-header">
                <div style="display:flex;align-items:center;gap:var(--sp-5);">
                    <button class="sa-back-btn" id="btn-back-dashboard" title="Back to Sessions">← Sessions</button>
                    ${options.reportId
                        ? `<button class="sa-back-btn sa-back-btn--report" id="btn-back-report"
                                   title="Back to originating report">← Report</button>`
                        : ''}
                    <div class="sa-header__title">Site Analysis // Tactical Overview</div>
                </div>
                <div class="sa-header__right">
                    <div class="sa-header__meta" id="sa-meta">
                        ${options.reportId
                            ? `Origin: Report ${String(options.reportId).slice(0, 8)}${_sessionRegionId ? ` · ${escapeHtml(_sessionRegionId)}` : ''}`
                            : 'Mara-Serengeti Sector'
                        }
                    </div>
                    <button class="sa-session-save" id="btn-save-session">SAVE SESSION</button>
                </div>
            </div>

            ${_isCommunityRestricted ? `
            <div class="sa-tier-banner">
                <span class="sa-tier-banner__icon">◈</span>
                <span>Community view — showing your reports in satellite mode only. Upgrade to Ranger for full analytical tools.</span>
            </div>` : ''}

            ${_sessionRegionId ? `
            <div class="sa-tier-banner" style="
                background: rgba(184,240,0,0.06);
                border-color: rgba(184,240,0,0.2);
                color: var(--clr-brand);
            ">
                <span>◉</span>
                <span>Region context: <strong>${escapeHtml(_sessionRegionId)}</strong> — navigated from Report Detail</span>
            </div>` : ''}

            <div class="sa-map-wrap">
                <div id="sa-map"></div>


                <div class="sa-overlay-bottom-left">
                    <div class="sa-compass">N</div>
                    <div class="sa-scale-bar"></div>
                </div>

                <!-- ══ RIGHT DOCK: tab strip + sliding drawer ══ -->
                <div class="sa-dock" id="sa-dock">

                    <!-- Drawer slides open to the left of the tab strip -->
                    <div class="sa-dock__drawer" id="sa-dock-drawer">

                        <!-- LAYERS PANEL -->
                        <div class="sa-dock__panel" id="sa-panel-layers">

                            <!-- ① Base Map -->
                            <div class="sa-dock__panel-hdr">Base Map</div>
                            <div class="sa-basemap-group">
                                ${!_isCommunityRestricted ? `
                                <label class="sa-basemap-opt">
                                    <input type="radio" name="basemap" id="basemap-minimal" value="aesthetic" ${_activeMode !== 'satellite' ? 'checked' : ''}>
                                    <span class="sa-basemap-label">Minimal</span>
                                    <span class="sa-basemap-desc">Clean contrast for data layers</span>
                                </label>` : ''}
                                <label class="sa-basemap-opt">
                                    <input type="radio" name="basemap" id="basemap-satellite" value="satellite" checked ${_isCommunityRestricted ? 'disabled' : ''}>
                                    <span class="sa-basemap-label">Satellite</span>
                                    <span class="sa-basemap-desc">Real-world imagery${_isCommunityRestricted ? '' : ' + GEE intel'}</span>
                                </label>
                            </div>

                            <!-- ② Data Layers -->
                            <div class="sa-layer-divider"></div>
                            <div class="sa-dock__panel-hdr">Data Layers</div>
                            <div class="sa-layer-item">
                                <input type="checkbox" id="layer-sightings" ${options.layers?.sightings !== false ? 'checked' : ''}>
                                <label for="layer-sightings">Sightings Data</label>
                            </div>
                            <div class="sa-layer-item">
                                <input type="checkbox" id="layer-heatmap" ${options.layers?.heatmap !== false ? 'checked' : ''}>
                                <label for="layer-heatmap">Density Heatmap</label>
                            </div>
                            <div class="sa-layer-item">
                                <input type="checkbox" id="layer-grid" ${options.layers?.grid !== false ? 'checked' : ''}>
                                <label for="layer-grid">Density Grid</label>
                            </div>
                            <div class="sa-layer-item">
                                <input type="checkbox" id="layer-tactical" ${options.layers?.tactical !== false ? 'checked' : ''}>
                                <label for="layer-tactical">Tactical Lines</label>
                            </div>

                            <!-- ③ Environmental Intelligence (GEE) -->
                            <div class="sa-layer-divider"></div>
                            ${_isCommunityRestricted ? `
                            <div class="sa-tier-lock">
                                <div class="sa-tier-lock__icon">◈</div>
                                <div class="sa-tier-lock__text">Environmental Intelligence layers require Ranger tier or above.</div>
                            </div>` : `
                            <div class="sa-dock__panel-hdr">Environmental Intelligence
                                <span class="sa-dock__panel-hdr-note">GEE</span>
                            </div>

                            <div class="sa-gee-item">
                                <div class="sa-layer-item">
                                    <input type="checkbox" id="layer-gee-vegetation">
                                    <label for="layer-gee-vegetation">Vegetation (NDVI)</label>
                                    <div class="sa-layer-badge" id="badge-gee-veg" style="display:none;">HIGH-RES</div>
                                </div>
                                <div class="sa-gee-opacity" id="gee-opacity-row-vegetation" style="display:none;">
                                    <span class="sa-gee-opacity-lbl">Opacity</span>
                                    <input type="range" id="gee-opacity-vegetation" class="sa-gee-opacity-slider" min="10" max="100" step="5" value="70">
                                    <span class="sa-gee-opacity-val" id="gee-opacity-val-vegetation">70%</span>
                                </div>
                            </div>

                            <div class="sa-gee-item">
                                <div class="sa-layer-item">
                                    <input type="checkbox" id="layer-gee-water">
                                    <label for="layer-gee-water">Water Features</label>
                                </div>
                                <div class="sa-gee-opacity" id="gee-opacity-row-water" style="display:none;">
                                    <span class="sa-gee-opacity-lbl">Opacity</span>
                                    <input type="range" id="gee-opacity-water" class="sa-gee-opacity-slider" min="10" max="100" step="5" value="70">
                                    <span class="sa-gee-opacity-val" id="gee-opacity-val-water">70%</span>
                                </div>
                            </div>

                            <div class="sa-gee-item">
                                <div class="sa-layer-item">
                                    <input type="checkbox" id="layer-gee-elevation">
                                    <label for="layer-gee-elevation">Elevation (Hillshade)</label>
                                </div>
                                <div class="sa-gee-opacity" id="gee-opacity-row-elevation" style="display:none;">
                                    <span class="sa-gee-opacity-lbl">Opacity</span>
                                    <input type="range" id="gee-opacity-elevation" class="sa-gee-opacity-slider" min="10" max="100" step="5" value="70">
                                    <span class="sa-gee-opacity-val" id="gee-opacity-val-elevation">70%</span>
                                </div>
                            </div>

                            <div class="sa-gee-item">
                                <div class="sa-layer-item">
                                    <input type="checkbox" id="layer-gee-land-cover">
                                    <label for="layer-gee-land-cover">Land Cover (ESA)</label>
                                    <div class="sa-layer-badge" style="display:block;">10m</div>
                                </div>
                                <div class="sa-gee-opacity" id="gee-opacity-row-land-cover" style="display:none;">
                                    <span class="sa-gee-opacity-lbl">Opacity</span>
                                    <input type="range" id="gee-opacity-land-cover" class="sa-gee-opacity-slider" min="10" max="100" step="5" value="70">
                                    <span class="sa-gee-opacity-val" id="gee-opacity-val-land-cover">70%</span>
                                </div>
                            </div>

                            <div class="sa-gee-item">
                                <div class="sa-layer-item">
                                    <input type="checkbox" id="layer-gee-precipitation">
                                    <label for="layer-gee-precipitation">Precipitation (CHIRPS)</label>
                                </div>
                                <div class="sa-gee-opacity" id="gee-opacity-row-precipitation" style="display:none;">
                                    <span class="sa-gee-opacity-lbl">Opacity</span>
                                    <input type="range" id="gee-opacity-precipitation" class="sa-gee-opacity-slider" min="10" max="100" step="5" value="65">
                                    <span class="sa-gee-opacity-val" id="gee-opacity-val-precipitation">65%</span>
                                </div>
                            </div>

                            <div class="sa-gee-item">
                                <div class="sa-layer-item">
                                    <input type="checkbox" id="layer-gee-temperature">
                                    <label for="layer-gee-temperature">Temperature · LST</label>
                                </div>
                                <div class="sa-gee-opacity" id="gee-opacity-row-temperature" style="display:none;">
                                    <span class="sa-gee-opacity-lbl">Opacity</span>
                                    <input type="range" id="gee-opacity-temperature" class="sa-gee-opacity-slider" min="10" max="100" step="5" value="65">
                                    <span class="sa-gee-opacity-val" id="gee-opacity-val-temperature">65%</span>
                                </div>
                            </div>

                            <div class="sa-gee-item">
                                <div class="sa-layer-item">
                                    <input type="checkbox" id="layer-gee-ndvi-trend">
                                    <label for="layer-gee-ndvi-trend">NDVI Trend (2018–23)</label>
                                    <div class="sa-layer-badge sa-layer-badge--trend" style="display:block;">REG</div>
                                </div>
                                <div class="sa-gee-opacity" id="gee-opacity-row-ndvi-trend" style="display:none;">
                                    <span class="sa-gee-opacity-lbl">Opacity</span>
                                    <input type="range" id="gee-opacity-ndvi-trend" class="sa-gee-opacity-slider" min="10" max="100" step="5" value="80">
                                    <span class="sa-gee-opacity-val" id="gee-opacity-val-ndvi-trend">80%</span>
                                </div>
                            </div>

                            <div class="sa-gee-item">
                                <div class="sa-layer-item">
                                    <input type="checkbox" id="layer-gee-habitat">
                                    <label for="layer-gee-habitat">Habitat Suitability</label>
                                    <div class="sa-layer-badge sa-layer-badge--habitat" style="display:block;">IDX</div>
                                </div>
                                <div class="sa-gee-opacity" id="gee-opacity-row-habitat" style="display:none;">
                                    <span class="sa-gee-opacity-lbl">Opacity</span>
                                    <input type="range" id="gee-opacity-habitat" class="sa-gee-opacity-slider" min="10" max="100" step="5" value="75">
                                    <span class="sa-gee-opacity-val" id="gee-opacity-val-habitat">75%</span>
                                </div>
                            </div>
                            `}

                            <!-- ④ Grid Resolution -->
                            ${canControlGridResolution() ? `
                            <div class="sa-layer-divider"></div>
                            <div class="sa-dock__panel-hdr">Grid Resolution</div>
                            <div class="sa-resolution-wrap">
                                <div class="sa-resolution-btns" id="sa-resolution-btns">
                                    ${Object.entries(GRID_RESOLUTIONS).map(([key, preset]) => `
                                        <button
                                            class="sa-res-btn ${key === _gridResolution ? 'active' : ''}"
                                            data-resolution="${key}"
                                            title="${preset.display} cell size">
                                            ${preset.label}
                                        </button>
                                    `).join('')}
                                </div>
                                <div class="sa-resolution-meta">
                                    Cell: <span id="sa-resolution-display">${GRID_RESOLUTIONS[_gridResolution].display}</span>
                                    &nbsp;·&nbsp;
                                    <span id="sa-cell-count">—</span> cells
                                </div>
                            </div>` : ''}
                        </div>

                        <!-- BUFFER / PROXIMITY PANEL -->
                        <div class="sa-dock__panel" id="sa-panel-buffer">
                            <div class="sa-dock__panel-hdr">Buffer / Proximity</div>
                            <div class="sa-buffer-row">
                                <label>Radius</label>
                                <span class="sa-buffer-val" id="buffer-radius-display">5km</span>
                            </div>
                            <input type="range" id="buffer-radius-slider" min="500" max="50000" step="500" value="5000" />
                            <div class="sa-buffer-row" style="margin-top:8px;">
                                <label>Species</label>
                                <span class="sa-buffer-val" id="buffer-species-display" style="font-size:8px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">ALL</span>
                            </div>
                            <select id="buffer-species-filter" class="sa-buffer-species-sel">
                                <option value="">All Species</option>
                            </select>
                            <div class="sa-buffer-row" style="margin-top:8px;"><label>Center</label></div>
                            <div style="display:flex;gap:4px;margin-bottom:6px;">
                                <input type="number" id="buffer-lat" class="sa-buffer-input" placeholder="Lat" step="0.0001" ${_pendingFlyTo ? `value="${_pendingFlyTo.lat.toFixed(5)}"` : ''} />
                                <input type="number" id="buffer-lng" class="sa-buffer-input" placeholder="Lng" step="0.0001" ${_pendingFlyTo ? `value="${_pendingFlyTo.lng.toFixed(5)}"` : ''} />
                            </div>
                            <button class="sa-btn" id="btn-run-buffer" style="width:100%;margin-top:4px;">Run Buffer</button>
                            <div style="font-size:9px;opacity:0.5;margin-top:6px;text-align:center;">OR draw a marker / line on map</div>
                        </div>

                        <!-- TRACKER PANEL -->
                        <div class="sa-dock__panel" id="sa-panel-tracker">
                            <div class="sa-dock__panel-hdr">Animal Tracker</div>

                            <!-- Playback controls -->
                            <div class="trk-play-row">
                                <button class="trk-play-btn" id="trk-play-btn" title="Play / Pause track evolution">▶</button>
                                <button class="trk-mini-btn" id="trk-play-reset" title="Reset to start">↺</button>
                                <span class="trk-play-date" id="trk-play-date">—</span>
                            </div>
                            <input type="range" id="trk-play-slider" class="trk-play-slider" min="0" max="100" value="100" step="1" />

                            <div class="trk-section-lbl" style="margin-top:8px;">Intensity metric</div>
                            <select id="trk-intensity" class="trk-sel">
                                <option value="speed">Speed (m/s)</option>
                                <option value="error">GPS Error (m)</option>
                                <option value="time_gap">Time Gap (h)</option>
                            </select>

                            <div style="display:flex;gap:10px;margin-top:8px;margin-bottom:8px;">
                                <label class="trk-radio-lbl"><input type="checkbox" id="trk-show-arrows" checked> Arrows</label>
                                <label class="trk-radio-lbl"><input type="checkbox" id="trk-show-nodes" checked> Nodes</label>
                                <label class="trk-radio-lbl"><input type="checkbox" id="trk-show-heatmap"> Heatmap</label>
                            </div>

                            <div class="trk-section-lbl">Individuals</div>
                            <div style="display:flex;gap:6px;margin-bottom:4px;">
                                <button class="trk-mini-btn" id="trk-sel-all">All</button>
                                <button class="trk-mini-btn" id="trk-sel-none">None</button>
                            </div>
                            <div id="trk-individuals" class="trk-individuals"></div>
                        </div>

                        <!-- CSV DATA UPLOAD PANEL -->
                        <div class="sa-dock__panel" id="sa-panel-data">
                            <div class="sa-dock__panel-hdr">Portal Data</div>

                            <!-- Drop zone -->
                            <div class="csv-dropzone" id="csv-dropzone" title="Drop a CSV file here or click to browse">
                                <div class="csv-dropzone__icon">⇪</div>
                                <div class="csv-dropzone__label">Drop CSV or click to upload</div>
                                <input type="file" id="csv-file-input" accept=".csv,text/csv" style="display:none" />
                            </div>

                            <!-- Uploaded files list -->
                            <div class="trk-section-lbl" style="margin-top:10px;">Uploaded Datasets</div>
                            <div id="csv-file-list" class="csv-file-list">
                                <div style="color:#666;font-size:10px;font-style:italic;">Loading…</div>
                            </div>

                            <!-- Active CSV layer controls (shown when a CSV is active) -->
                            <div id="csv-layer-controls" style="display:none;margin-top:10px;">
                                <div class="trk-section-lbl">Active: <span id="csv-active-name" style="color:#f5a623;"></span></div>
                                <div class="trk-section-lbl" style="margin-top:6px;">Lat column</div>
                                <select id="csv-col-lat" class="trk-sel"></select>
                                <div class="trk-section-lbl" style="margin-top:6px;">Lng column</div>
                                <select id="csv-col-lng" class="trk-sel"></select>
                                <div class="trk-section-lbl" style="margin-top:6px;">Label column (optional)</div>
                                <select id="csv-col-label" class="trk-sel"></select>
                                <button class="sa-btn" id="btn-csv-render" style="width:100%;margin-top:8px;">Show on Map</button>
                                <button class="sa-btn" id="btn-csv-clear" style="width:100%;margin-top:4px;opacity:0.6;">Clear Layer</button>
                            </div>
                        </div>

                        <!-- ANALYSIS RESULTS PANEL -->
                        <div class="sa-dock__panel" id="sa-panel-results">
                            <div class="sa-dock__panel-hdr" id="sa-tool-title">Analysis Results</div>
                            <div id="sa-tool-content" style="font-family:var(--font-mono);font-size:10px;color:#aaa;margin-top:8px;line-height:1.6;">
                                Select or draw an area to analyze.
                            </div>
                        </div>

                    </div><!-- /drawer -->

                    <!-- Tab strip (rightmost column) -->
                    <div class="sa-dock__tabs">
                        <button class="sa-dock__tab active" data-panel="layers" title="Active Layers">
                            <span class="sa-dock__tab-icon">≡</span>
                            <span class="sa-dock__tab-label">LAYERS</span>
                        </button>
                        <button class="sa-dock__tab" data-panel="tracker" title="Animal Tracker">
                            <span class="sa-dock__tab-icon">⟳</span>
                            <span class="sa-dock__tab-label">TRACK</span>
                        </button>
                        <button class="sa-dock__tab" data-panel="data" title="Upload CSV Data">
                            <span class="sa-dock__tab-icon">↑</span>
                            <span class="sa-dock__tab-label">DATA</span>
                        </button>
                        ${!_isCommunityRestricted ? `
                        <button class="sa-dock__tab" data-panel="buffer" title="Buffer / Proximity">
                            <span class="sa-dock__tab-icon">◎</span>
                            <span class="sa-dock__tab-label">BUFFER</span>
                        </button>
                        <button class="sa-dock__tab" data-panel="results" title="Analysis Results">
                            <span class="sa-dock__tab-icon">◈</span>
                            <span class="sa-dock__tab-label">RESULTS</span>
                        </button>
                        <div class="sa-dock__tab-sep"></div>
                        <button class="sa-dock__tab" id="btn-timeline-tab" title="Toggle Timeline">
                            <span class="sa-dock__tab-icon">▶</span>
                            <span class="sa-dock__tab-label">TIME</span>
                        </button>` : ''}
                    </div>

                </div><!-- /dock -->

                <!-- Timeline strip — hidden by default, toggled via TIME tab -->
                <div class="sa-timeline" id="sa-timeline">
                    <button class="sa-btn" id="btn-timeline-play">PLAY</button>
                    <div class="sa-timeline-val" id="timeline-val-start">--</div>
                    <input type="range" id="timeline-slider" min="0" max="100" value="100" step="1" />
                    <div class="sa-timeline-val" id="timeline-val-current" style="color:#E31B23">--</div>
                </div>
            </div>

            <div class="sa-analysis-panel">
                <!-- Sector Density: sightings per km² in current viewport.
                     Value and label (#sa-delta-density) are both updated by
                     computeViewportStats().  The label switches between
                     "PTS / KM²" and "SAME SP / KM²" to mirror the species
                     filter chosen on the Active Points panel. -->
                <div class="sa-stat">
                    <div class="sa-stat__label">Sector Density</div>
                    <div class="sa-stat__value" id="sa-val-density">0.00</div>
                    <div class="sa-stat__delta" id="sa-delta-density">PTS / KM²</div>
                </div>
                <!-- Active Points: count of sightings visible in current viewport.
                     Updated by computeViewportStats() on every pan/zoom/filter.
                     Toggle buttons (#sa-ap-filter-btns) scope the count to the
                     session species or all species.  Sector Density shares the
                     same filter so both panels are always consistent.
                     "SAME SP" button becomes active once a species is selected
                     in the Buffer Analysis panel. -->
                <div class="sa-stat">
                    <div class="sa-stat__label">Active Points</div>
                    <div class="sa-stat__value" id="sa-val-points">0</div>
                    <div class="sa-ap-filter-btns" id="sa-ap-filter-btns">
                        <button class="sa-ap-btn active" data-filter="all">ALL</button>
                        <button class="sa-ap-btn" data-filter="same" id="sa-ap-btn-same" disabled>SAME SP</button>
                    </div>
                </div>
                <!-- Grid Resolution: the cell size currently being rendered.
                     Updated by renderGrid() / setGridResolution(). -->
                <div class="sa-stat">
                    <div class="sa-stat__label">Grid Resolution</div>
                    <div class="sa-stat__value" id="sa-val-resolution">${GRID_RESOLUTIONS[_gridResolution].display}</div>
                    <div class="sa-stat__delta">ADAPTIVE CELLS</div>
                </div>
                <!-- Total Records: sightings of the session species within the
                     current buffer zone radius.  Both value and descriptor label
                     (#sa-delta-total) are updated by computeBufferRecords(). -->
                <div class="sa-stat">
                    <div class="sa-stat__label">Total Records</div>
                    <div class="sa-stat__value" id="sa-val-total">0</div>
                    <div class="sa-stat__delta" id="sa-delta-total">ALL VALIDATED</div>
                </div>
            </div>
        </div>
        `;

        attachMapListeners(container, options);
        initMap(options);
        loadData();
    }

    /* ══════════════ Map Initialization ═══════════════════════ */

    /*
     * buildOriginPopupHtml(lat, lng, reportId, speciesName)
     *
     * Returns the HTML string for the report-origin circle-marker popup.
     * Separated from the marker creation so it can be called again from
     * setSessionSpecies() once the species name is available — the popup
     * content is updated in-place without recreating the marker.
     */
    function buildOriginPopupHtml(lat, lng, reportId, speciesName, mediaUrl) {
        const imgUrl = mediaUrl ? '/' + mediaUrl.replace(/^\//, '') : null;
        return `
            <div class="terra-popup" style="min-width:200px;">
                ${imgUrl ? `<div class="terra-popup__photo-stem">
                    <img src="${imgUrl}" alt="Field evidence" class="terra-popup__photo"
                         onclick="(function(src){var b=document.createElement('div');b.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';var i=document.createElement('img');i.src=src;i.style.cssText='max-width:92vw;max-height:88vh;border-radius:4px;box-shadow:0 0 60px rgba(0,0,0,0.9);';b.appendChild(i);b.addEventListener('click',function(){b.remove();});document.body.appendChild(b);})(this.src)" />
                </div>` : ''}
                <div class="terra-popup__header">
                    <span class="terra-popup__species" style="color:var(--clr-danger);">Report Origin</span>
                </div>
                <div class="terra-popup__body">
                    ${speciesName ? `
                    <div class="terra-popup__row">
                        <span class="terra-popup__label">Species</span>
                        <span class="terra-popup__value terra-popup__value--highlight">${escapeHtml(speciesName)}</span>
                    </div>` : ''}
                    <div class="terra-popup__row">
                        <span class="terra-popup__label">Coords</span>
                        <span class="terra-popup__value">${lat.toFixed(5)}, ${lng.toFixed(5)}</span>
                    </div>
                    ${reportId ? `
                    <div class="terra-popup__row">
                        <span class="terra-popup__label">Report ID</span>
                        <span class="terra-popup__value">${reportId.slice(0, 8)}</span>
                    </div>` : ''}
                </div>
            </div>
        `;
    }

    function initMap(sessionOptions = {}) {
        const defaultLat = -1.2921;
        const defaultLng = 36.8219;

        requestAnimationFrame(() => {
            const mapEl = document.getElementById('sa-map');
            if (!mapEl) return;

            if (_map) { _map.remove(); _map = null; }
            _originMarker = null;
            _bufferRing   = null;
            _trackerCanvas = null; // Reset canvas renderer on map reinit

            _map = L.map('sa-map', {
                zoomControl: true,
                attributionControl: false,
                preferCanvas: false
            }).setView([defaultLat, defaultLng], 10);

            _map.createPane('geePane');
            _map.getPane('geePane').style.zIndex = 250;   // above base tile (200), below all data overlays
            _map.getPane('geePane').style.pointerEvents = 'none';

            _map.createPane('gridPane');
            _map.getPane('gridPane').style.zIndex = 450;  // below popupPane (700) so popups render above
            _map.getPane('gridPane').style.pointerEvents = 'auto';

            LAYERS[_activeMode].addTo(_map);

            _gridLayer = L.featureGroup({ pane: 'gridPane' }).addTo(_map);
            _sightingsLayer = L.featureGroup().addTo(_map);
            _trackerLayer = L.featureGroup().addTo(_map);
            _drawnItems = new L.FeatureGroup().addTo(_map);
            _bufferLayer = new L.FeatureGroup().addTo(_map);

            if (L.Control.Draw) {
                const drawControl = new L.Control.Draw({
                    edit: { featureGroup: _drawnItems, remove: true },
                    draw: {
                        polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: '#E31B23', weight: 2 } },
                        polyline: { shapeOptions: { color: '#000000', weight: 3 } },
                        circle: false, circlemarker: false, rectangle: false,
                        marker: { icon: L.divIcon({ className: 'sa-draw-marker', html: '<div class="sa-draw-marker-inner"></div>' }) }
                    }
                });
                _map.addControl(drawControl);
            }

            // GEE Hybrid Zoom Listener
            _map.on('zoomend', handleGeeZoomChange);
            _map.on('moveend', computeViewportStats);

            // Wait for DOM layout, then invalidate + apply pending flyTo
            setTimeout(() => {
                if (!_map) return;
                _map.invalidateSize();
                updateModeUI();

                /*
                 * Initialise the Active Points filter dropdown.
                 * At this point _viewportSpeciesFilter has already been set
                 * in renderMapView() (restored from session or defaulted to
                 * 'all').  syncActivePointsFilter() sets the select's value,
                 * disables "Same Species" if no species context exists yet,
                 * and runs an initial computeViewportStats() pass.
                 */
                syncActivePointsFilter();

                // ── Apply flyTo from pending options ──────────────
                if (_pendingFlyTo) {
                    const { lat, lng, zoom, reportId } = _pendingFlyTo;
                    _map.setView([lat, lng], zoom || 14);

                    /*
                     * Origin highlight marker — species is not known yet at this
                     * point (loadData() may still be in-flight), so the popup is
                     * built with speciesName = null.  setSessionSpecies() holds a
                     * reference via _originMarker and will call _updatePopup() once
                     * the species is resolved, filling in the species row.
                     */
                    _originMarker = L.circleMarker([lat, lng], {
                        radius: 16,
                        color: '#E31B23',
                        weight: 3,
                        fillColor: '#E31B23',
                        fillOpacity: 0.2
                    });
                    // Attach an update helper that re-sets popup content without
                    // recreating the marker or losing its position on the map.
                    _originMarker._mediaUrl = null; // populated by loadData() once report is found
                    _originMarker._updatePopup = (speciesName) => {
                        _originMarker.setPopupContent(
                            buildOriginPopupHtml(lat, lng, reportId, speciesName, _originMarker._mediaUrl)
                        );
                    };
                    _originMarker
                        .bindPopup(buildOriginPopupHtml(lat, lng, reportId, null, null), { maxWidth: 260 })
                        .addTo(_bufferLayer)
                        .openPopup();

                    _pendingFlyTo = null;
                } else if (sessionOptions.viewport) {
                    // Restore saved viewport from a session
                    const { lat, lng, zoom } = sessionOptions.viewport;
                    _map.setView([lat, lng], zoom);

                    /*
                     * Restore the grid resolution the user had when they saved.
                     * We validate the key against GRID_RESOLUTIONS so a stale
                     * or corrupted session value can never break the render loop.
                     * setGridResolution() also updates the button UI and stat panel.
                     */
                    if (sessionOptions.gridResolution && GRID_RESOLUTIONS[sessionOptions.gridResolution]) {
                        setGridResolution(sessionOptions.gridResolution);
                    }

                    /*
                     * Restore species context — this re-enables the species filter
                     * on "Total Records" so the stat reads the same as when the
                     * session was saved.  setSessionSpecies() triggers an immediate
                     * recompute so the stat is correct before the user interacts.
                     */
                    if (sessionOptions.speciesId) {
                        setSessionSpecies(sessionOptions.speciesId, sessionOptions.speciesName);
                    }

                    // Restore GEE layers from session
                    if (sessionOptions.layers) {
                        const geeMapping = {
                            geeVegetation:    'vegetation',
                            geeWater:         'water',
                            geeElevation:     'elevation',
                            geeLandCover:     'land-cover',
                            geePrecipitation: 'precipitation',
                            geeTemperature:   'temperature',
                            geeNdviTrend:     'ndvi-trend',
                            geeHabitat:       'habitat'
                        };
                        Object.entries(geeMapping).forEach(([optKey, geeType]) => {
                            if (sessionOptions.layers[optKey]) {
                                const el = document.getElementById(`layer-gee-${geeType}`);
                                if (el) el.checked = true;
                                const opacityRow = document.getElementById(`gee-opacity-row-${geeType}`);
                                if (opacityRow) opacityRow.style.display = 'flex';
                                _activeGeeTypes.add(geeType);
                                updateGeeLayer(geeType);
                            }
                        });
                    }

                    // Restore buffer inputs
                    if (sessionOptions.buffer) {
                        const { radius, lat: bLat, lng: bLng } = sessionOptions.buffer;
                        if (radius) {
                            const bSlider = document.getElementById('buffer-radius-slider');
                            const bDisp = document.getElementById('buffer-radius-display');
                            if (bSlider) bSlider.value = radius;
                            if (bDisp) bDisp.textContent = radius >= 1000 ? `${(radius / 1000).toFixed(1)}km` : `${radius}m`;
                        }
                        if (bLat) { const el = document.getElementById('buffer-lat'); if (el) el.value = bLat; }
                        if (bLng) { const el = document.getElementById('buffer-lng'); if (el) el.value = bLng; }
                    }

                    // Restore drawn items
                    if (sessionOptions.drawnItems && Array.isArray(sessionOptions.drawnItems)) {
                        let lastGeometry = null;
                        let lastType = null;

                        sessionOptions.drawnItems.forEach(geoJson => {
                            try {
                                const type = geoJson.properties?.drawType || 'unknown';
                                const gjLayer = L.geoJSON(geoJson);
                                
                                gjLayer.eachLayer(layer => {
                                    if (type === 'marker') {
                                        layer.setIcon(L.divIcon({ className: 'sa-draw-marker', html: '<div class="sa-draw-marker-inner"></div>' }));
                                    } else if (type === 'polygon') {
                                        layer.setStyle({ color: '#E31B23', weight: 2 });
                                    } else if (type === 'polyline') {
                                        layer.setStyle({ color: '#000000', weight: 3 });
                                    }

                                    if (geoJson.properties && geoJson.properties._dbId) {
                                        layer._dbId = geoJson.properties._dbId;
                                    }
                                    
                                    _drawnItems.addLayer(layer);
                                    lastGeometry = geoJson.geometry;
                                    lastType = type;
                                });
                            } catch(err) {
                                console.error('[SiteAnalysis] Failed to restore drawn item:', err);
                            }
                        });

                        // Re-run analysis for the last drawn item to restore the results window and map effects
                        if (lastGeometry && lastType) {
                            handleAnalysis(lastType, lastGeometry);
                        }
                    }
                }

                // Draw the initial buffer ring if coordinates are already set —
                // report flyTo fills them above; session restore fills them above too.
                updateBufferRing();
            }, 550);

            _map.on('moveend zoomend', () => renderLayers());

            _map.on(L.Draw.Event.CREATED, async function (event) {
                const layer = event.layer;
                const type = event.layerType;
                _drawnItems.addLayer(layer);

                if (type === 'marker') {
                    const latlng = layer.getLatLng();
                    const latInput = document.getElementById('buffer-lat');
                    const lngInput = document.getElementById('buffer-lng');
                    if (latInput) latInput.value = latlng.lat.toFixed(5);
                    if (lngInput) lngInput.value = latlng.lng.toFixed(5);
                    updateBufferRing(); // Draw / reposition the ring at the placed marker
                }

                try {
                    const geoJSON = layer.toGeoJSON();
                    const res = await API.post('/analysis/user-objects', { type, geometry: geoJSON.geometry, meta_data: {} });
                    if (res && res.object_id) layer._dbId = res.object_id;
                    handleAnalysis(type, geoJSON.geometry);
                } catch (e) {
                    const geoJSON = layer.toGeoJSON();
                    handleAnalysis(type, geoJSON.geometry);
                }
            });

            _map.on(L.Draw.Event.DELETED, async function (event) {
                event.layers.eachLayer(async (layer) => {
                    if (layer._dbId) {
                        try { await API.delete('/analysis/user-objects/' + layer._dbId); } catch (e) { }
                    }
                });
                _bufferLayer.clearLayers();
                hideResults();
            });
        });
    }

    /* ── GEE Layer Management ────────────────────────────────── */
    function attachGeeListeners() {
        ['vegetation', 'water', 'elevation', 'land-cover', 'precipitation', 'temperature', 'ndvi-trend', 'habitat'].forEach(type => {
            // Checkbox — toggle layer on/off and show/hide opacity row
            document.getElementById(`layer-gee-${type}`)?.addEventListener('change', (e) => {
                const enabled = e.target.checked;
                const opacityRow = document.getElementById(`gee-opacity-row-${type}`);
                if (opacityRow) opacityRow.style.display = enabled ? 'flex' : 'none';
                if (enabled) _activeGeeTypes.add(type);
                else _activeGeeTypes.delete(type);
                updateGeeLayer(type);
            });

            // Opacity slider — live update without reloading tiles
            document.getElementById(`gee-opacity-${type}`)?.addEventListener('input', (e) => {
                const val = parseInt(e.target.value, 10);
                const label = document.getElementById(`gee-opacity-val-${type}`);
                if (label) label.textContent = `${val}%`;
                if (_geeLayers[type]) _geeLayers[type].setOpacity(val / 100);
            });
        });
    }

    async function updateGeeLayer(type) {
        if (!_map) return;

        const enabled = _activeGeeTypes.has(type);

        if (!enabled) {
            if (_geeLayers[type]) {
                _map.removeLayer(_geeLayers[type]);
                delete _geeLayers[type];
            }
            if (type === 'vegetation') document.getElementById('badge-gee-veg').style.display = 'none';
            return;
        }

        // Determine specific GEE subtype (e.g. high vs low res vegetation)
        let geeType = type;
        if (type === 'vegetation') {
            const zoom = _map.getZoom();
            geeType = zoom >= 12 ? 'vegetation-high' : 'vegetation-low';
            document.getElementById('badge-gee-veg').style.display = 'block';
            document.getElementById('badge-gee-veg').textContent = zoom >= 12 ? 'S2 HIGH-RES' : 'MODIS LOW-RES';
        }

        try {
            // Get MapID if not cached or if type changed (veg hybrid)
            if (!_geeMapIds[geeType]) {
                const data = await API.post('/gee/mapid', { layerType: geeType });
                _geeMapIds[geeType] = data;
            }

            const { urlTemplate } = _geeMapIds[geeType];

            // Remove existing layer for this type to replace it
            if (_geeLayers[type]) _map.removeLayer(_geeLayers[type]);

            const opacitySlider = document.getElementById(`gee-opacity-${type}`);
            const opacity = opacitySlider ? parseInt(opacitySlider.value, 10) / 100 : 0.7;

            _geeLayers[type] = L.tileLayer(urlTemplate, {
                attribution: 'Google Earth Engine',
                opacity,
                pane: 'geePane'
            }).addTo(_map);

        } catch (err) {
            console.error(`[GEE] Failed to load layer ${type}:`, err);
            Toast.error(`GEE: Failed to load ${type} insights.`);
            // Uncheck the box if it failed
            const el = document.getElementById(`layer-gee-${type}`);
            if (el) el.checked = false;
            _activeGeeTypes.delete(type);
        }
    }

    function handleGeeZoomChange() {
        if (_activeGeeTypes.has('vegetation')) {
            const zoom = _map.getZoom();
            const currentSubtype = _geeLayers['vegetation']?.options?.urlTemplate?.includes('vegetation-high') ? 'high' : 'low';
            const neededSubtype = zoom >= 12 ? 'high' : 'low';

            if (currentSubtype !== neededSubtype) {
                console.log(`[GEE] Auto-switching vegetation resolution for zoom ${zoom}`);
                updateGeeLayer('vegetation');
            }
        }
    }

    /* ══════════════ Data Loading ══════════════════════════════ */
    async function loadData() {
        try {
            // Community tier: scope to own reports only (server also enforces this).
            const ownOnly = _isCommunityRestricted ? '?own_only=true' : '';
            _reports = await API.get(`/analysis/sightings${ownOnly}`);

            /*
             * Species auto-detection from report context.
             *
             * When this view was opened from a report detail page, _sessionReportId
             * is set.  Now that _reports is populated we can find the matching
             * record and extract its species — allowing "Total Records" to filter
             * to that species automatically without any extra API call.
             *
             * If no matching report is found (e.g. the report is not yet validated
             * and therefore not in the sightings endpoint), the stat gracefully
             * falls back to counting all validated records.
             *
             * If speciesId was already set (restored from a saved session), we
             * skip detection so the saved value is not overwritten.
             */
            if (_sessionReportId && !_sessionSpeciesId) {
                const origin = _reports.find(r => r.report_id === _sessionReportId);
                if (origin) {
                    /*
                     * Use species_id when present (UUID-registered species).
                     * For reports where the user typed a free-text name, species_id
                     * is null in the DB — fall back to species_name (the COALESCE
                     * value from the API) so the filter key is never null.
                     * Skip the generic 'Unknown Species' fallback — it is not a
                     * meaningful filter target.
                     */
                    const effectiveKey = origin.species_id || origin.species_name;
                    if (effectiveKey && effectiveKey !== 'Unknown Species') {
                        setSessionSpecies(effectiveKey, origin.species_name || origin.species_id);
                    }

                    // Attach photo evidence to the origin marker popup if available
                    if (origin.media_url && _originMarker) {
                        _originMarker._mediaUrl = origin.media_url;
                        _originMarker._updatePopup(_sessionSpeciesName);
                    }
                }
            }

            if (_reports.length > 0) {
                const dates = _reports.map(r => new Date(r.created_at).getTime()).filter(t => !isNaN(t));
                if (dates.length > 0) {
                    _timeline.minDate = Math.min(...dates);
                    _timeline.maxDate = Math.max(...dates);
                    _timeline.currentDate = _timeline.maxDate;
                }
                updateTimelineUI();
                applyTemporalFilter();

                /*
                 * Populate the species selector in the Buffer Analysis panel now
                 * that _reports is available.  This makes the species filter
                 * usable in any session, not just ones opened from a report.
                 */
                populateSpeciesSelector();

                // If no specific viewport is set, auto-fit to sightings
                if (!_skipAutofit) {
                    const points = _reports.map(r => [r.latitude, r.longitude]);
                    setTimeout(() => {
                        if (_map && points.length > 0) {
                            try { _map.fitBounds(L.latLngBounds(points), { padding: [80, 80], maxZoom: 13 }); } catch (e) { }
                        }
                    }, 700);
                }
            }
        } catch (err) {
            console.error('[SITE ANALYSIS] Data fetch failed:', err);
        }

        // Load animal tracker data from CSV
        try {
            const csvText = await fetch('/data/wild_pigs.csv').then(r => r.text());
            const lines   = csvText.trim().split('\n');
            const hdrs    = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
            const col     = name => hdrs.indexOf(name);
            const iTs = col('timestamp'), iLat = col('location-lat'), iLng = col('location-long');
            const iInd = col('individual-local-identifier'), iErr = col('location-error-numerical');
            const iTag = col('tag-local-identifier'), iSen = col('sensor-type');

            _trackerData = [];
            for (let i = 1; i < lines.length; i++) {
                const c   = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
                const lat = parseFloat(c[iLat]), lng = parseFloat(c[iLng]);
                if (isNaN(lat) || isNaN(lng)) continue;
                const ts = new Date(c[iTs]).getTime();
                if (isNaN(ts)) continue;
                _trackerData.push({ lat, lng, ts,
                    individual: c[iInd] || 'unknown',
                    error: parseFloat(c[iErr]) || 0,
                    tag_id: c[iTag] || '', sensor: c[iSen] || '' });
            }

            // Pre-group and sort by individual
            _trackerByInd = {};
            _trackerData.forEach(d => { (_trackerByInd[d.individual] ??= []).push(d); });
            Object.values(_trackerByInd).forEach(arr => arr.sort((a, b) => a.ts - b.ts));

            // Global time bounds for playback slider
            const allTs = _trackerData.map(d => d.ts);
            _trackerMinTs = Math.min(...allTs);
            _trackerMaxTs = Math.max(...allTs);

            // Default play cursor to start
            _trackerPlayDate = null; // null = show all

            // Seed individual visibility
            const inds = Object.keys(_trackerByInd).sort();
            inds.forEach(id => { _trackerIndividuals[id] = true; });

            // Create/update the tracker saved session so it appears on the Sessions page
            _ensureTrackerSession();

            populateTrackerPanel();
            renderTracker();

            // Auto-fit map to pig bounding box on first load
            if (!_skipAutofit && _trackerData.length > 0) {
                const lats = _trackerData.map(d => d.lat);
                const lngs = _trackerData.map(d => d.lng);
                const bounds = [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]];
                setTimeout(() => { if (_map) { try { _map.fitBounds(bounds, { padding: [60, 60], maxZoom: 12 }); } catch (_) {} } }, 800);
            }
        } catch (e) {
            console.warn('[Tracker] CSV load failed:', e.message);
        }
    }

    /* ══════════════ Layer Rendering ═══════════════════════════ */
    function renderLayers() {
        if (!_map) return;
        const showGrid     = document.getElementById('layer-grid')?.checked;
        const showTactical = document.getElementById('layer-tactical')?.checked;
        const showSightings = document.getElementById('layer-sightings')?.checked;
        const showHeatmap  = document.getElementById('layer-heatmap')?.checked;

        if (showGrid || showTactical) renderGrid(showGrid, showTactical);
        else _gridLayer.clearLayers();

        if (showSightings) renderSightings();
        else _sightingsLayer.clearLayers();

        if (showHeatmap) renderHeatmap();
        else { if (_heatmapLayer) { _map.removeLayer(_heatmapLayer); _heatmapLayer = null; } }

        /*
         * Always recompute viewport stats after any layer change, pan, or zoom.
         * renderLayers() is the single choke-point for all visual updates, so
         * calling here guarantees Active Points and Sector Density are always
         * current without needing separate moveend/zoomend wiring.
         */
        computeViewportStats();
    }

    function renderGrid(showDensityCells = true, showTacticalLines = true) {
        if (!_gridLayer) return;
        _gridLayer.clearLayers();

        if (showDensityCells && _filteredReports.length > 0) {
            /*
             * Performance guard — before building any Leaflet rectangles,
             * estimate how many grid cells the current resolution would produce
             * across the visible viewport.  If that count exceeds the preset's
             * maxCells threshold, step up to the next coarser resolution and
             * inform the user via a toast.  This prevents the browser from
             * stalling on zoom levels where tiny cells produce hundreds of rects.
             *
             * We loop (instead of stepping once) in case even the next level is
             * still over budget — e.g. extreme zoom-out on 'fine' resolution.
             */
            let activeKey = _gridResolution;
            while (activeKey) {
                const preset = GRID_RESOLUTIONS[activeKey];
                const estimated = estimateCellCount(preset.cellSize);
                if (estimated <= preset.maxCells) break; // Safe to render at this level

                const coarser = getNextCoarserResolution(activeKey);
                if (!coarser) break; // Already at 'regional' — just render whatever we have

                // Step coarser without saving to _gridResolution, so the user's
                // chosen setting is preserved and they can zoom back in.
                activeKey = coarser;
            }

            // Only notify once, and only when the rendered resolution differs from
            // the user's chosen resolution — avoids repeated toasts on every pan/zoom.
            if (activeKey !== _gridResolution) {
                const _lastAutoStep = renderGrid._lastAutoStep;
                if (_lastAutoStep !== activeKey) {
                    Toast.warning(
                        `Grid auto-stepped to ${GRID_RESOLUTIONS[activeKey].label} — zoom in for finer detail.`
                    );
                }
            }
            // Track which auto-stepped key was last notified so we don't repeat the toast.
            renderGrid._lastAutoStep = (activeKey !== _gridResolution) ? activeKey : null;
            const cellSize = GRID_RESOLUTIONS[activeKey].cellSize;

            // Update the cell count badge in the layer panel with the estimated value
            const cellCountEl = document.getElementById('sa-cell-count');
            if (cellCountEl) cellCountEl.textContent = estimateCellCount(cellSize);

            // Also keep the stat panel in sync with whatever is actually being rendered
            const statEl = document.getElementById('sa-val-resolution');
            if (statEl) statEl.textContent = GRID_RESOLUTIONS[activeKey].display;

            const cells = {};
            let maxCount = 0;

            _filteredReports.forEach(r => {
                const latIdx = Math.floor(r.latitude / cellSize);
                const lngIdx = Math.floor(r.longitude / cellSize);
                const key = `${latIdx},${lngIdx}`;
                if (!cells[key]) cells[key] = { count: 0, reports: [] };
                cells[key].count++;
                cells[key].reports.push(r);
                if (cells[key].count > maxCount) maxCount = cells[key].count;
            });

            Object.keys(cells).forEach(key => {
                const [latIdx, lngIdx] = key.split(',').map(Number);
                const { count, reports } = cells[key];
                const intensity = 0.08 + (count / maxCount) * 0.38;
                const bounds = [
                    [latIdx * cellSize, lngIdx * cellSize],
                    [(latIdx + 1) * cellSize, (lngIdx + 1) * cellSize]
                ];
                const rect = L.rectangle(bounds, {
                    color: '#E31B23', weight: 1.2, fillColor: '#E31B23',
                    fillOpacity: intensity, pane: 'gridPane', interactive: true, bubblingMouseEvents: false
                });

                rect.on('mouseover', function () { this.setStyle({ fillOpacity: Math.min(intensity + 0.35, 0.85), weight: 2, color: '#ff0000' }); });
                rect.on('mouseout', function () { this.setStyle({ fillOpacity: intensity, weight: 1.2, color: '#E31B23' }); });

                const species = [...new Set(reports.map(r =>
                    (window.SpeciesRegistry && window.SpeciesRegistry[r.species_id]?.common_name) || r.species_id || 'Unknown'
                ))];
                rect.bindPopup(`
                    <div class="terra-popup">
                        <div class="terra-popup__header">
                            <span class="terra-popup__species">Grid Cell</span>
                            <span class="terra-popup__value terra-popup__value--highlight">${count} sighting${count !== 1 ? 's' : ''}</span>
                        </div>
                        <div class="terra-popup__body">
                            <div class="terra-popup__row">
                                <span class="terra-popup__label">Intensity</span>
                                <span class="terra-popup__value terra-popup__value--highlight">${(intensity * 100).toFixed(0)}%</span>
                            </div>
                            ${species.length ? `<div class="terra-popup__row">
                                <span class="terra-popup__label">Species</span>
                                <span class="terra-popup__value">${species.slice(0, 3).join(', ')}</span>
                            </div>` : ''}
                        </div>
                    </div>
                `, { maxWidth: 260 });
                rect.addTo(_gridLayer);
            });

            // sa-val-density is now owned by computeViewportStats(), called
            // from renderLayers() after renderGrid() returns — no write here.
        }

        if (showTacticalLines) renderTacticalGrid();
    }

    function renderTacticalGrid() {
        if (!_map || !_gridLayer) return;
        const bounds = _map.getBounds();
        const west = bounds.getWest(), east = bounds.getEast(),
            north = bounds.getNorth(), south = bounds.getSouth();
        const zoom = _map.getZoom();

        let step = 1.0;
        if (zoom >= 15) step = 0.0025;
        else if (zoom >= 14) step = 0.005;
        else if (zoom >= 13) step = 0.01;
        else if (zoom >= 12) step = 0.02;
        else if (zoom >= 11) step = 0.05;
        else if (zoom >= 9) step = 0.1;

        const color = _activeMode === 'satellite' ? '#FFFFFF' : '#000000';
        const lineOpacity = _activeMode === 'satellite' ? 0.4 : 0.15;
        const dotOpacity = _activeMode === 'satellite' ? 0.75 : 0.4;

        for (let lng = Math.floor(west / step) * step; lng <= east + step; lng += step) {
            L.polyline([[south, lng], [north, lng]], { color, weight: 0.8, opacity: lineOpacity, dashArray: '5, 8', pane: 'gridPane', interactive: false }).addTo(_gridLayer);
        }
        for (let lat = Math.floor(south / step) * step; lat <= north + step; lat += step) {
            L.polyline([[lat, west], [lat, east]], { color, weight: 0.8, opacity: lineOpacity, dashArray: '5, 8', pane: 'gridPane', interactive: false }).addTo(_gridLayer);
        }
        for (let lat = Math.floor(south / step) * step; lat <= north + step; lat += step) {
            for (let lng = Math.floor(west / step) * step; lng <= east + step; lng += step) {
                L.circleMarker([lat, lng], { radius: 2, color, fillColor: color, fillOpacity: dotOpacity, weight: 0, pane: 'gridPane', interactive: false }).addTo(_gridLayer);
            }
        }
    }

    function renderSightings() {
        if (!_sightingsLayer) return;
        _sightingsLayer.clearLayers();

        const bufLat = parseFloat(document.getElementById('buffer-lat')?.value);
        const bufLng = parseFloat(document.getElementById('buffer-lng')?.value);
        const radius = parseInt(document.getElementById('buffer-radius-slider')?.value || 5000, 10);

        /*
         * Other-report dots are hidden by default.  They only appear once the
         * user has defined a buffer centre (typed coords or placed a marker).
         * This satisfies both reveal cases:
         *   Case 1 – same-species: _sessionSpeciesId set from report context →
         *            pool is narrowed to matching species below.
         *   Case 2 – chosen species: user picks from buffer-species-filter →
         *            setSessionSpecies() stores it and _sessionSpeciesId is set.
         * When no species is selected (all-species mode), all sightings within
         * the buffer ring are shown.
         */
        if (isNaN(bufLat) || isNaN(bufLng)) return;

        let pool = _filteredReports.filter(r =>
            haversineDistanceMeters(bufLat, bufLng, r.latitude, r.longitude) <= radius
        );

        if (_sessionSpeciesId) {
            pool = pool.filter(matchesSessionSpecies);
        }

        pool.forEach(r => {
            const marker = L.circleMarker([r.latitude, r.longitude], {
                radius: 4, fillColor: '#E31B23', color: '#000',
                weight: 1, opacity: 0.8, fillOpacity: 0.8
            });
            // Prefer the API's COALESCE species_name (handles free-text entries)
            const speciesDisplay = r.species_name
                || (window.SpeciesRegistry && window.SpeciesRegistry[r.species_id]?.common_name)
                || r.species_id || 'Unknown';
            const sImgUrl = r.media_url ? '/' + r.media_url.replace(/^\//, '') : null;
            marker.bindPopup(`
                <div class="terra-popup" style="min-width:180px;">
                    ${sImgUrl ? `<div class="terra-popup__photo-stem"><img src="${sImgUrl}" alt="Evidence" class="terra-popup__photo" onclick="(function(src){var b=document.createElement('div');b.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';var i=document.createElement('img');i.src=src;i.style.cssText='max-width:92vw;max-height:88vh;border-radius:4px;box-shadow:0 0 60px rgba(0,0,0,0.9);';b.appendChild(i);b.addEventListener('click',function(){b.remove();});document.body.appendChild(b);})(this.src)" /></div>` : ''}
                    <div class="terra-popup__header">
                        <span class="terra-popup__species">${escapeHtml(speciesDisplay)}</span>
                    </div>
                    <div class="terra-popup__body">
                        <div class="terra-popup__row">
                            <span class="terra-popup__label">Date</span>
                            <span class="terra-popup__value">${new Date(r.created_at).toLocaleDateString()}</span>
                        </div>
                        <div class="terra-popup__row">
                            <span class="terra-popup__label">Tier</span>
                            <span class="terra-popup__value">${r.sensitivity_tier || '—'}</span>
                        </div>
                        <div class="terra-popup__row">
                            <span class="terra-popup__label">Confidence</span>
                            <span class="terra-popup__value terra-popup__value--highlight">${r.ai_confidence_score != null ? r.ai_confidence_score + '%' : 'N/A'}</span>
                        </div>
                    </div>
                </div>
            `, { maxWidth: 260 });
            marker.addTo(_sightingsLayer);
        });
    }

    function renderHeatmap() {
        if (!_map || !L.heatLayer) return;
        if (_heatmapLayer) { _map.removeLayer(_heatmapLayer); _heatmapLayer = null; }
        if (_filteredReports.length === 0) return;

        _heatmapLayer = L.heatLayer(_filteredReports.map(r => [r.latitude, r.longitude, 1.0]), {
            radius: 28, blur: 18, maxZoom: 15,
            gradient: { 0.2: '#1e3a8a', 0.45: '#3b82f6', 0.65: '#84cc16', 0.82: '#facc15', 1.0: '#E31B23' }
        }).addTo(_map);
    }

    /* ══════════════ Analysis Handlers ═════════════════════════ */

    /*
     * buildTimeSeriesChart(data)
     *
     * Renders a compact inline bar chart for monthly NDVI values.
     * data = Array<{ month: 1-12, ndvi: number|null }>
     * Demonstrates: Visualization — data exploration within the app UI.
     */
    function buildTimeSeriesChart(data) {
        if (!Array.isArray(data) || data.length === 0) return '';
        const MONTH_LABELS = ['J','F','M','A','M','J','J','A','S','O','N','D'];
        const vals = data.map(d => d.ndvi);
        const maxVal = Math.max(...vals.filter(v => v != null), 0.01);

        const bars = vals.map((val, i) => {
            const pct  = val != null ? Math.round((val / maxVal) * 100) : 0;
            const color = val == null ? '#333'
                : val > 0.5 ? '#56a800'
                : val > 0.3 ? '#b8f000'
                : val > 0.1 ? '#fcd163'
                : '#CE7E45';
            const tip = val != null ? val.toFixed(3) : 'N/A';
            return `<div class="sa-chart-col">
                <div class="sa-chart-bar" style="height:${pct}%;background:${color};" title="${MONTH_LABELS[i]}: ${tip}"></div>
                <span class="sa-chart-lbl">${MONTH_LABELS[i]}</span>
            </div>`;
        }).join('');

        return `<div class="sa-tool-section-label">MONTHLY NDVI 2023</div>
                <div class="sa-chart">${bars}</div>`;
    }

    async function handleAnalysis(type, geometry) {
        showResultsLoading();
        const radius = parseInt(document.getElementById('buffer-radius-slider')?.value || 5000, 10);
        try {
            if (type === 'polygon') {
                // Parallel: zonal stats (cloud-masked S2) + monthly time series (MODIS)
                const [data, tsData] = await Promise.all([
                    API.post('/analysis/ndvi-zonal', { polygon: geometry }),
                    API.post('/gee/timeseries', { polygon: geometry }).catch(() => null)
                ]);

                const change = parseFloat(data.change_30_days);
                const changeStr = !isNaN(change)
                    ? `${change > 0 ? '+' : ''}${change}`
                    : '—';

                const trendRows = Array.isArray(data.trend) && data.trend.length > 0
                    ? data.trend.map(t =>
                        `<p><span>${t.date}:</span><span class="val">${t.value != null ? parseFloat(t.value).toFixed(3) : '—'}</span></p>`
                      ).join('')
                    : '';

                const chartHtml = tsData ? buildTimeSeriesChart(tsData) : '';

                showResults('NDVI Zonal Stats', `
                    <p><span>Mean NDVI:</span><span class="val">${data.mean ?? '—'}</span></p>
                    <p><span>Min NDVI:</span><span class="val">${data.min  ?? '—'}</span></p>
                    <p><span>Max NDVI:</span><span class="val">${data.max  ?? '—'}</span></p>
                    ${data.stdDev ? `<p><span>Std Dev:</span><span class="val">${data.stdDev}</span></p>` : ''}
                    <p><span>6mo Δ:</span><span class="val">${changeStr}</span></p>
                    ${chartHtml}
                    ${trendRows ? `<div class="sa-tool-section-label">6-MONTH TREND</div>${trendRows}` : ''}
                `);
            } else {
                await runBufferOnGeometry(geometry, radius);
            }
        } catch (e) {
            showResults('Analysis Error', '<p>Failed to compute stats.</p>');
        }
    }

    async function runBufferOnGeometry(geometry, radiusMeters) {
        showResultsLoading();
        // Note: _bufferRing (the live ring) is managed by updateBufferRing() and
        // lives on _map directly — do NOT clear _bufferLayer here or it removes
        // the origin marker.  The ring already reflects the correct zone.

        try {
            const data = await API.post('/analysis/buffer', { geometry, radius_meters: radiusMeters });
            const radiusKm = (radiusMeters / 1000).toFixed(1);

            let speciesHtml = '';
            if (Array.isArray(data.sightings_list) && data.sightings_list.length > 0) {
                const counts = {};
                data.sightings_list.forEach(s => { counts[s.species_id || 'Unknown'] = (counts[s.species_id || 'Unknown'] || 0) + 1; });
                speciesHtml = `<div class="sa-tool-section-label">SPECIES</div>` +
                    Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6)
                        .map(([sp, cnt]) => `<p><span>${sp}</span><span class="val">${cnt}</span></p>`).join('');
            }
            showResults('Buffer / Proximity', `
                <p><span>Radius:</span><span class="val">${radiusKm}km</span></p>
                <p><span>Sightings:</span><span class="val">${data.total_sightings || 0}</span></p>
                ${speciesHtml}
            `);
        } catch (e) {
            showResults('Buffer Error', '<p>Proximity analysis failed.</p>');
        }
    }

    /* ── Dock panel switcher ─────────────────────────────────── */
    function openDockTab(panelId) {
        const drawer = document.getElementById('sa-dock-drawer');
        if (!drawer) return;
        const tabs   = document.querySelectorAll('.sa-dock__tab[data-panel]');
        const panels = document.querySelectorAll('.sa-dock__panel');
        const targetId = `sa-panel-${panelId}`;
        const alreadyOpen = drawer.classList.contains('open')
            && document.getElementById(targetId)?.classList.contains('active');

        if (alreadyOpen) {
            drawer.classList.remove('open');
            tabs.forEach(t => t.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));
        } else {
            drawer.classList.add('open');
            tabs.forEach(t => t.classList.toggle('active', t.dataset.panel === panelId));
            panels.forEach(p => p.classList.toggle('active', p.id === targetId));
        }
    }

    function showResultsLoading() {
        const t = document.getElementById('sa-tool-title');
        const c = document.getElementById('sa-tool-content');
        if (t) t.textContent = 'Analyzing…';
        if (c) c.innerHTML = '<p style="font-family:var(--font-mono);font-size:10px;color:#aaa;">Computing spatial statistics…</p>';
        openDockTab('results');
    }

    function showResults(title, html) {
        const t = document.getElementById('sa-tool-title');
        const c = document.getElementById('sa-tool-content');
        if (t) t.textContent = title;
        if (c) c.innerHTML = html;
        openDockTab('results');
    }

    function hideResults() {
        // Results live in the dock panel — no element to toggle
    }

    /* ══════════════ Map Listeners ═════════════════════════════ */
    /* ══════════════ Animal Tracker ════════════════════════════ */

    function _haversineM(lat1, lng1, lat2, lng2) {
        const R = 6_371_000, toR = d => d * Math.PI / 180;
        const dLat = toR(lat2 - lat1), dLng = toR(lng2 - lng1);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function _bearing(lat1, lng1, lat2, lng2) {
        const toR = d => d * Math.PI / 180;
        const y = Math.sin(toR(lng2 - lng1)) * Math.cos(toR(lat2));
        const x = Math.cos(toR(lat1)) * Math.sin(toR(lat2)) - Math.sin(toR(lat1)) * Math.cos(toR(lat2)) * Math.cos(toR(lng2 - lng1));
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }

    // Map intensity 0→1 to orange scale: dark burnt (#7a2e00) → pale amber (#ffe8b0)
    // Higher value = lighter/brighter shade
    function _intensityColor(t) {
        const r = Math.round(122 + t * (255 - 122));
        const g = Math.round(46  + t * (232 - 46));
        const b = Math.round(0   + t * (176 - 0));
        return `rgb(${r},${g},${b})`;
    }

    // Decimate a sorted track: keep one fix per `bucketMs` per individual
    function _decimate(track, bucketMs = 60_000) {
        const out = [];
        let lastTs = -Infinity;
        for (const fix of track) {
            if (fix.ts - lastTs >= bucketMs) { out.push(fix); lastTs = fix.ts; }
        }
        // Always include last fix
        if (out[out.length - 1] !== track[track.length - 1]) out.push(track[track.length - 1]);
        return out;
    }

    // Pre-compute per-fix intensity on a sorted, decimated track; return max
    function _annotateIntensity(track) {
        let max = 0;
        track.forEach((fix, i) => {
            if (i === 0) { fix._iv = 0; return; }
            const prev = track[i - 1];
            const dt   = (fix.ts - prev.ts) / 1000;
            if (_trackerIntensity === 'speed') {
                fix._iv = dt > 0 ? _haversineM(prev.lat, prev.lng, fix.lat, fix.lng) / dt : 0;
            } else if (_trackerIntensity === 'error') {
                fix._iv = fix.error;
            } else {
                fix._iv = dt / 3600;
            }
            if (fix._iv > max) max = fix._iv;
        });
        return max;
    }

    // Create (or refresh) the pinned Wild Pigs tracker session in localStorage
    function _ensureTrackerSession() {
        const TRACKER_SESSION_ID = 'sa-tracker-wild-pigs';
        const sessions = loadSessions();
        const existing = sessions.find(s => s.id === TRACKER_SESSION_ID);

        const bounds = _trackerData.length > 0 ? (() => {
            const lats = _trackerData.map(d => d.lat);
            const lngs = _trackerData.map(d => d.lng);
            return {
                lat: (Math.min(...lats) + Math.max(...lats)) / 2,
                lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
            };
        })() : { lat: 34.7, lng: -82.8 };

        const session = {
            id:          TRACKER_SESSION_ID,
            name:        'Wild Pigs — Clemson Forest Tracker',
            savedAt:     existing?.savedAt || new Date().toISOString(),
            isStarred:   existing?.isStarred ?? true,
            isArchived:  false,
            isTrackerSession: true,
            viewport:    { lat: bounds.lat, lng: bounds.lng, zoom: 11 },
            mode:        'satellite',
            gridResolution: 'standard',
            speciesId:   null, speciesName: null,
            viewportSpeciesFilter: 'all',
            layers:      { grid: false, tactical: false, sightings: false, heatmap: false,
                           geeVegetation: false, geeWater: false, geeElevation: false,
                           geeLandCover: false, geePrecipitation: false, geeTemperature: false,
                           geeNdviTrend: false, geeHabitat: false },
            timeline:    { currentDate: _trackerMaxTs },
            drawnItems:  [], buffer: { radius: 5000, lat: '', lng: '' },
            trackerMeta: {
                individuals: Object.keys(_trackerByInd).length,
                fixes:       _trackerData.length,
                minTs:       _trackerMinTs,
                maxTs:       _trackerMaxTs,
            }
        };

        if (existing) {
            Object.assign(existing, session);
        } else {
            sessions.unshift(session);
        }
        saveSessions(sessions);
    }

    function populateTrackerPanel() {
        const wrap = document.getElementById('trk-individuals');
        if (!wrap) return;
        const inds = Object.keys(_trackerIndividuals).sort();
        wrap.innerHTML = inds.map(id => {
            return `<label class="trk-ind-row">
                <input type="checkbox" class="trk-ind-cb" data-id="${id}" ${_trackerIndividuals[id] ? 'checked' : ''}>
                <span class="trk-ind-swatch"></span>
                <span class="trk-ind-name">${id}</span>
            </label>`;
        }).join('');
        // Update tracker play range display
        if (_trackerMinTs && _trackerMaxTs) {
            const el = document.getElementById('trk-play-date');
            if (el) el.textContent = new Date(_trackerMinTs).toLocaleDateString();
        }
    }

    function renderTracker() {
        if (!_trackerLayer) return;
        _trackerLayer.clearLayers();
        if (!_trackerVisible || _trackerData.length === 0) return;

        // Ceiling timestamp for playback — null means show everything
        const ceiling = _trackerPlayDate;

        // Build per-individual decimated tracks (1 fix/min), apply time ceiling
        const byInd = {};
        for (const fix of _trackerData) {
            if (!_trackerIndividuals[fix.individual]) continue;
            if (ceiling !== null && fix.ts > ceiling) continue;
            (byInd[fix.individual] ??= []).push(fix);
        }
        // Sort and decimate
        for (const id of Object.keys(byInd)) {
            byInd[id].sort((a, b) => a.ts - b.ts);
            byInd[id] = _decimate(byInd[id], 60_000);
        }

        // Compute global max intensity for normalisation
        let globalMax = 0;
        for (const track of Object.values(byInd)) {
            const m = _annotateIntensity(track);
            if (m > globalMax) globalMax = m;
        }
        if (globalMax === 0) globalMax = 1;

        // Heatmap (canvas-backed, single layer)
        if (_trackerShowHeatmap && window.L && L.heatLayer) {
            const pts = [];
            for (const track of Object.values(byInd)) {
                for (const f of track) pts.push([f.lat, f.lng, (f._iv || 0) / globalMax]);
            }
            L.heatLayer(pts, {
                radius: 20, blur: 24, maxZoom: 17,
                gradient: { 0.0: '#7a2e00', 0.4: '#c85a00', 0.75: '#f5a623', 1.0: '#ffe8b0' }
            }).addTo(_trackerLayer);
        }

        const zoom = _map ? _map.getZoom() : 10;
        const showArrowsAtZoom = zoom >= 12;
        const showNodesAtZoom  = zoom >= 11;

        // One canvas renderer shared across all vector layers — critical for perf
        if (!_trackerCanvas) _trackerCanvas = L.canvas({ padding: 0.5 });

        for (const [id, track] of Object.entries(byInd)) {
            if (track.length < 2) {
                // Single fix — just a node
                if (_trackerShowNodes && showNodesAtZoom && track.length === 1) {
                    const f = track[0];
                    L.circleMarker([f.lat, f.lng], {
                        renderer: _trackerCanvas, radius: 4,
                        color: '#ffe8b0', weight: 1, fillColor: '#ffe8b0', fillOpacity: 0.9,
                        interactive: false
                    }).addTo(_trackerLayer);
                }
                continue;
            }

            // Build one multi-segment polyline per individual (single DOM element)
            const latlngs = track.map(f => [f.lat, f.lng]);
            L.polyline(latlngs, {
                renderer: _trackerCanvas,
                color: '#c85a00', weight: 2, opacity: 0.55,
                lineCap: 'round', lineJoin: 'round', interactive: false
            }).addTo(_trackerLayer);

            // Intensity-shaded segments (draw only every Nth for perf)
            const step = Math.max(1, Math.floor(track.length / 80));
            for (let i = 1; i < track.length; i += step) {
                const prev = track[i - 1], curr = track[i];
                const t = Math.min(1, (curr._iv || 0) / globalMax);
                const col = _intensityColor(t);

                // Glow aura
                L.polyline([[prev.lat, prev.lng], [curr.lat, curr.lng]], {
                    renderer: _trackerCanvas,
                    color: col, weight: 5 + t * 6, opacity: 0.18 + t * 0.22,
                    lineCap: 'round', interactive: false
                }).addTo(_trackerLayer);

                // Core
                L.polyline([[prev.lat, prev.lng], [curr.lat, curr.lng]], {
                    renderer: _trackerCanvas,
                    color: col, weight: 1.5, opacity: 0.55 + t * 0.45,
                    lineCap: 'round', interactive: false
                }).addTo(_trackerLayer);

                // Arrow chevron (every 10th visible segment, only when zoomed in)
                if (_trackerShowArrows && showArrowsAtZoom && i % 10 === 0) {
                    const b   = _bearing(prev.lat, prev.lng, curr.lat, curr.lng);
                    const mid = [(prev.lat + curr.lat) / 2, (prev.lng + curr.lng) / 2];
                    L.marker(mid, {
                        icon: L.divIcon({
                            className: '',
                            html: `<svg width="10" height="10" viewBox="0 0 10 10" style="transform:rotate(${b}deg);display:block;overflow:visible"><polygon points="5,0 0,10 10,10" fill="${col}" opacity="${0.5 + t * 0.5}"/></svg>`,
                            iconSize: [10, 10], iconAnchor: [5, 5]
                        }),
                        interactive: false
                    }).addTo(_trackerLayer);
                }
            }

            // Nodes: start, end, and thinned intermediates
            if (_trackerShowNodes && showNodesAtZoom) {
                const nodeStep = Math.max(1, Math.floor(track.length / 40));
                track.forEach((fix, i) => {
                    const isEndpoint = i === 0 || i === track.length - 1;
                    if (!isEndpoint && i % nodeStep !== 0) return;
                    const t   = Math.min(1, (fix._iv || 0) / globalMax);
                    const col = _intensityColor(t);
                    const r   = isEndpoint ? 5 : 3;
                    const ts  = new Date(fix.ts).toLocaleString();
                    const val = _trackerIntensity === 'speed'    ? `${(fix._iv || 0).toFixed(1)} m/s`
                              : _trackerIntensity === 'error'    ? `${(fix.error || 0).toFixed(0)} m GPS err`
                              :                                    `${(fix._iv || 0).toFixed(1)} h gap`;
                    L.circleMarker([fix.lat, fix.lng], {
                        renderer: _trackerCanvas,
                        radius: r, color: col, weight: 1.5,
                        fillColor: col, fillOpacity: 0.35 + t * 0.55
                    }).bindTooltip(`<b>${id}</b> · ${ts}<br>${val}`, { sticky: true })
                      .addTo(_trackerLayer);
                });
            }
        }

        // Update play date label
        const el = document.getElementById('trk-play-date');
        if (el) {
            el.textContent = ceiling
                ? new Date(ceiling).toLocaleDateString()
                : (_trackerMaxTs ? new Date(_trackerMaxTs).toLocaleDateString() : '—');
        }
    }

    /* ── Tracker playback ──────────────────────────────────── */
    function _trackerStep() {
        if (!_trackerPlaying) return;
        const window7d = 7 * 86_400_000;
        _trackerPlayDate = Math.min((_trackerPlayDate || _trackerMinTs) + window7d, _trackerMaxTs);
        renderTracker();
        if (_trackerPlayDate >= _trackerMaxTs) {
            _stopTrackerPlay();
        } else {
            _trackerPlayTimer = setTimeout(_trackerStep, 350);
        }
    }

    function _startTrackerPlay() {
        if (_trackerMinTs === 0) return;
        _trackerPlaying  = true;
        _trackerPlayDate = _trackerPlayDate ?? _trackerMinTs;
        document.getElementById('trk-play-btn')?.classList.add('active');
        _trackerStep();
    }

    function _stopTrackerPlay() {
        _trackerPlaying = false;
        clearTimeout(_trackerPlayTimer);
        document.getElementById('trk-play-btn')?.classList.remove('active');
    }

    function _toggleTrackerPlay() {
        if (_trackerPlaying) { _stopTrackerPlay(); } else { _startTrackerPlay(); }
    }

    function attachMapListeners(_container, options) {
        // Back to sessions dashboard
        document.getElementById('btn-back-dashboard')?.addEventListener('click', () => {
            if (_map) { _map.remove(); _map = null; }
            _originMarker = null;
            window.location.hash = '#/site-analysis';
        });

        /*
         * Back to Report — only rendered when this view was opened from (or
         * saved with) a report.  Navigates to that report's detail page so
         * the user can continue their workflow without going via My Reports.
         */
        document.getElementById('btn-back-report')?.addEventListener('click', () => {
            if (_map) { _map.remove(); _map = null; }
            _originMarker = null;
            Router.navigate('report-detail', { reportId: _sessionReportId });
        });

        // Base map radio buttons (in Layers panel)
        document.querySelectorAll('input[name="basemap"]').forEach(radio => {
            radio.addEventListener('change', () => setMode(radio.value));
        });

        // Layer checkboxes — each toggle triggers a full layer re-render
        ['layer-grid', 'layer-tactical', 'layer-sightings', 'layer-heatmap'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', renderLayers);
        });

        // GEE Layers
        attachGeeListeners();

        /*
         * Active Points filter buttons — clicking ALL or SAME SP updates
         * _viewportSpeciesFilter and immediately recomputes both Active Points
         * and Sector Density.  Event delegation on the button group container
         * so we only need one listener regardless of button count.
         */
        document.getElementById('sa-ap-filter-btns')?.addEventListener('click', (e) => {
            const btn = e.target.closest('.sa-ap-btn');
            if (!btn || btn.disabled) return;
            _viewportSpeciesFilter = btn.dataset.filter;
            syncActivePointsFilter();
        });

        /*
         * Buffer panel species selector — changing the selected species sets
         * the session species context, which:
         *   1. Enables the "SAME SP" viewport filter button
         *   2. Recomputes "Total Records" (buffer zone count for that species)
         *   3. Updates the species badge in the buffer panel header
         *
         * Selecting "All Species" (empty value) clears the context and
         * disables the "SAME SP" button, resetting both stats to all-species.
         */
        document.getElementById('buffer-species-filter')?.addEventListener('change', (e) => {
            const key = e.target.value;
            if (!key) {
                setSessionSpecies(null, null);
                return;
            }
            /*
             * The option's text content is already the resolved display name
             * (set by populateSpeciesSelector) — use it directly rather than
             * doing a second lookup that might fail for free-text species.
             */
            const name = e.target.options[e.target.selectedIndex].text;
            setSessionSpecies(key, name);
        });

        /*
         * Resolution button clicks — use event delegation on the container
         * rather than attaching one listener per button.  The container
         * is only present when canControlGridResolution() returned true,
         * so the optional-chain handles the case where the panel was not
         * rendered (read-only roles).
         *
         * e.target.closest('[data-resolution]') lets us click anywhere
         * inside the button (including its text node) and still get the
         * button element with its dataset.
         */
        document.getElementById('sa-resolution-btns')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-resolution]');
            if (btn) setGridResolution(btn.dataset.resolution);
        });

        // Close results
        // Dock tab switching (layers / buffer / results)
        document.querySelectorAll('.sa-dock__tab[data-panel]').forEach(tab => {
            tab.addEventListener('click', () => openDockTab(tab.dataset.panel));
        });
        // Open layers panel by default
        openDockTab('layers');

        // Timeline tab toggle
        document.getElementById('btn-timeline-tab')?.addEventListener('click', () => {
            const tl  = document.getElementById('sa-timeline');
            const btn = document.getElementById('btn-timeline-tab');
            if (!tl) return;
            tl.classList.toggle('open');
            if (btn) btn.classList.toggle('active', tl.classList.contains('open'));
        });

        // Timeline
        document.getElementById('timeline-slider')?.addEventListener('input', (e) => {
            _timeline.currentDate = parseInt(e.target.value, 10);
            updateTimelineUI();
            applyTemporalFilter();
            if (_timeline.playing) togglePlayback();
        });
        document.getElementById('btn-timeline-play')?.addEventListener('click', togglePlayback);

        // Buffer radius display + live Total Records recompute
        const bSlider = document.getElementById('buffer-radius-slider');
        const bDisp   = document.getElementById('buffer-radius-display');
        if (bSlider && bDisp) {
            bSlider.addEventListener('input', () => {
                const v = parseInt(bSlider.value, 10);
                bDisp.textContent = v >= 1000 ? `${(v / 1000).toFixed(1)}km` : `${v}m`;
                // Live ring resize + sightings + stats — no "Run Buffer" needed
                updateBufferRing();
            });
        }

        /*
         * Buffer coordinate inputs — recompute Total Records as the user types
         * so the stat is always consistent with the current buffer centre,
         * even before they click "Run Buffer".
         */
        document.getElementById('buffer-lat')?.addEventListener('input', updateBufferRing);
        document.getElementById('buffer-lng')?.addEventListener('input', updateBufferRing);

        // Buffer run button
        document.getElementById('btn-run-buffer')?.addEventListener('click', async () => {
            const lat = parseFloat(document.getElementById('buffer-lat')?.value);
            const lng = parseFloat(document.getElementById('buffer-lng')?.value);
            const radius = parseInt(document.getElementById('buffer-radius-slider')?.value || 5000, 10);
            if (isNaN(lat) || isNaN(lng)) {
                Toast.error('Enter valid lat/lng coordinates or draw a marker on the map first.');
                return;
            }
            updateBufferRing(); // Ensure ring is current before backend analysis
            await runBufferOnGeometry({ type: 'Point', coordinates: [lng, lat] }, radius);
        });

        // Tracker controls
        document.getElementById('trk-play-btn')?.addEventListener('click', _toggleTrackerPlay);

        document.getElementById('trk-play-reset')?.addEventListener('click', () => {
            _stopTrackerPlay();
            _trackerPlayDate = null;
            const slider = document.getElementById('trk-play-slider');
            if (slider) slider.value = 100;
            renderTracker();
        });

        // Manual scrub via slider
        const trkSlider = document.getElementById('trk-play-slider');
        if (trkSlider) {
            trkSlider.addEventListener('input', () => {
                _stopTrackerPlay();
                const pct = parseInt(trkSlider.value, 10) / 100;
                _trackerPlayDate = pct >= 1
                    ? null
                    : _trackerMinTs + pct * (_trackerMaxTs - _trackerMinTs);
                renderTracker();
            });
        }

        document.getElementById('trk-intensity')?.addEventListener('change', e => {
            _trackerIntensity = e.target.value;
            renderTracker();
        });
        document.getElementById('trk-show-arrows')?.addEventListener('change', e => {
            _trackerShowArrows = e.target.checked; renderTracker();
        });
        document.getElementById('trk-show-nodes')?.addEventListener('change', e => {
            _trackerShowNodes = e.target.checked; renderTracker();
        });
        document.getElementById('trk-show-heatmap')?.addEventListener('change', e => {
            _trackerShowHeatmap = e.target.checked; renderTracker();
        });
        document.getElementById('trk-sel-all')?.addEventListener('click', () => {
            Object.keys(_trackerIndividuals).forEach(id => { _trackerIndividuals[id] = true; });
            document.querySelectorAll('.trk-ind-cb').forEach(cb => { cb.checked = true; });
            renderTracker();
        });
        document.getElementById('trk-sel-none')?.addEventListener('click', () => {
            Object.keys(_trackerIndividuals).forEach(id => { _trackerIndividuals[id] = false; });
            document.querySelectorAll('.trk-ind-cb').forEach(cb => { cb.checked = false; });
            renderTracker();
        });
        document.getElementById('trk-individuals')?.addEventListener('change', e => {
            const cb = e.target.closest('.trk-ind-cb');
            if (!cb) return;
            _trackerIndividuals[cb.dataset.id] = cb.checked;
            renderTracker();
        });
        // Re-render on zoom changes so arrow/node density adapts
        if (_map) _map.on('zoomend', () => { if (_trackerData.length > 0) renderTracker(); });

        // ── CSV / Portal Data panel ───────────────────────────
        _initCsvPanel();

        // Save session
        document.getElementById('btn-save-session')?.addEventListener('click', () => {
            Modal.open({
                title: 'Save Session',
                body: `<label style="font-size:var(--text-sm);font-weight:600;display:block;margin-bottom:8px;">Session Name</label>
                       <input id="modal-session-name" class="form-input" style="width:100%" placeholder="e.g. Mara Buffalo Study 2026" value="Session – ${new Date().toLocaleDateString()}" />`,
                confirmLabel: 'Save',
                onConfirm: () => {
                    const name = document.getElementById('modal-session-name')?.value?.trim() || `Session – ${new Date().toLocaleDateString()}`;
                    const session = createSessionFromMap(name);
                    if (!session) return;
                    if (options.reportId) session.reportId = options.reportId;
                    const sessions = loadSessions();
                    sessions.unshift(session);
                    saveSessions(sessions);
                    Toast.success(`Session "${name}" saved. Find it in Site Analysis.`);
                }
            });
        });
    }

    /* ══════════════ Temporal Filter & Playback ════════════════ */
    function updateTimelineUI() {
        if (!_timeline.minDate || !_timeline.maxDate) return;
        const slider = document.getElementById('timeline-slider');
        const startLabel = document.getElementById('timeline-val-start');
        const currentLabel = document.getElementById('timeline-val-current');
        if (slider) { slider.min = _timeline.minDate; slider.max = _timeline.maxDate; slider.value = _timeline.currentDate; slider.step = 86400000; }
        if (startLabel) startLabel.textContent = new Date(_timeline.minDate).toISOString().split('T')[0];
        if (currentLabel) currentLabel.textContent = new Date(_timeline.currentDate).toISOString().split('T')[0];
    }

    function applyTemporalFilter() {
        /*
         * Rebuild _filteredReports from the full _reports array using the
         * current timeline position.  When no timeline data is available
         * (e.g. all reports share the same date), all records pass through.
         */
        _filteredReports = !_timeline.minDate
            ? [..._reports]
            : _reports.filter(r => {
                const t = new Date(r.created_at).getTime();
                return !isNaN(t) && t <= _timeline.currentDate;
              });

        // renderLayers() calls computeViewportStats() which owns sa-val-points
        // and sa-val-density.  computeBufferRecords() re-reads _filteredReports
        // so Total Records stays in sync with the new temporal slice.
        renderLayers();
        computeBufferRecords();
    }

    function togglePlayback() {
        const btn = document.getElementById('btn-timeline-play');
        if (_timeline.playing) {
            _timeline.playing = false;
            clearInterval(_timeline.interval);
            if (btn) btn.textContent = 'PLAY';
        } else {
            _timeline.playing = true;
            if (btn) btn.textContent = 'PAUSE';
            if (_timeline.currentDate >= _timeline.maxDate) _timeline.currentDate = _timeline.minDate;
            _timeline.interval = setInterval(() => {
                _timeline.currentDate += _timeline.speedDays * 86400000;
                if (_timeline.currentDate >= _timeline.maxDate) { _timeline.currentDate = _timeline.maxDate; togglePlayback(); }
                updateTimelineUI();
                applyTemporalFilter();
            }, 300);
        }
    }

    /* ══════════════ Mode Switching ════════════════════════════ */
    function setMode(mode) {
        if (_activeMode === mode) return;
        _map.removeLayer(LAYERS[_activeMode]);
        _activeMode = mode;
        LAYERS[_activeMode].addTo(_map);
        updateModeUI();
    }

    function updateModeUI() {
        document.querySelectorAll('input[name="basemap"]').forEach(radio => {
            radio.checked = radio.value === _activeMode;
        });
        renderLayers();
    }

    /* ═══════════════════════════════════════════════════════════
       CSV / PORTAL DATA PANEL
    ═══════════════════════════════════════════════════════════ */

    function _parseCsv(text) {
        const lines = text.trim().split(/\r?\n/);
        if (lines.length < 2) return { columns: [], rows: [] };
        const columns = lines[0].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        const rows = lines.slice(1).map(line => {
            const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
            const obj = {};
            columns.forEach((col, i) => { obj[col] = vals[i] ?? ''; });
            return obj;
        });
        return { columns, rows };
    }

    function _populateCsvColumnSelects(columns) {
        const latSel   = document.getElementById('csv-col-lat');
        const lngSel   = document.getElementById('csv-col-lng');
        const labelSel = document.getElementById('csv-col-label');
        if (!latSel || !lngSel || !labelSel) return;
        const opts = columns.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
        const none = `<option value="">— none —</option>`;
        latSel.innerHTML   = opts;
        lngSel.innerHTML   = opts;
        labelSel.innerHTML = none + opts;
        // Auto-detect common column names
        const tryPick = (sel, candidates) => {
            for (const c of candidates) {
                const opt = [...sel.options].find(o => o.value.toLowerCase() === c);
                if (opt) { sel.value = opt.value; return; }
            }
        };
        tryPick(latSel,   ['lat', 'latitude', 'location-lat', 'y']);
        tryPick(lngSel,   ['lng', 'lon', 'long', 'longitude', 'location-long', 'x']);
        tryPick(labelSel, ['name', 'label', 'individual-local-identifier', 'id', 'species']);
    }

    function _renderCsvOnMap() {
        if (_csvLayer) { _csvLayer.clearLayers(); }
        else {
            _csvLayer = L.featureGroup().addTo(_map);
        }

        const latCol   = document.getElementById('csv-col-lat')?.value;
        const lngCol   = document.getElementById('csv-col-lng')?.value;
        const labelCol = document.getElementById('csv-col-label')?.value;

        let count = 0;
        for (const row of _csvRows) {
            const lat = parseFloat(row[latCol]);
            const lng = parseFloat(row[lngCol]);
            if (isNaN(lat) || isNaN(lng)) continue;
            const label = labelCol ? (row[labelCol] || '') : '';
            const marker = L.circleMarker([lat, lng], {
                radius: 5,
                color: '#f5a623',
                fillColor: '#f5a623',
                fillOpacity: 0.7,
                weight: 1,
            });
            if (label) marker.bindPopup(`<div style="font-family:monospace;font-size:12px;">${escapeHtml(label)}</div>`);
            _csvLayer.addLayer(marker);
            count++;
        }

        if (count === 0) {
            Toast.error('No valid lat/lng rows found. Check column selection.');
            return;
        }

        _map.fitBounds(_csvLayer.getBounds().pad(0.1));
        Toast.success(`${count.toLocaleString()} points plotted from CSV.`);
    }

    async function _loadCsvFileList() {
        const listEl = document.getElementById('csv-file-list');
        if (!listEl) return;
        try {
            const { files } = await API.get('/portal-data/list');
            if (!files || files.length === 0) {
                listEl.innerHTML = `<div style="color:#666;font-size:10px;font-style:italic;">No uploads yet.</div>`;
                return;
            }
            listEl.innerHTML = files.map(f => `
                <div class="csv-file-row" data-url="${escapeHtml(f.url)}" data-name="${escapeHtml(f.originalName)}">
                    <span class="csv-file-row__name" title="${escapeHtml(f.originalName)}">${escapeHtml(f.originalName)}</span>
                    <span class="csv-file-row__size">${(f.size / 1024).toFixed(0)}KB</span>
                    <button class="csv-file-row__load" data-url="${escapeHtml(f.url)}" data-name="${escapeHtml(f.originalName)}" title="Load onto map">▶</button>
                    <button class="csv-file-row__del" data-filename="${escapeHtml(f.filename)}" title="Delete">✕</button>
                </div>
            `).join('');

            // Load button
            listEl.querySelectorAll('.csv-file-row__load').forEach(btn => {
                btn.addEventListener('click', async () => {
                    try {
                        const resp = await fetch(btn.dataset.url);
                        const text = await resp.text();
                        const { columns, rows } = _parseCsv(text);
                        _csvRows    = rows;
                        _csvColumns = columns;
                        const nameEl = document.getElementById('csv-active-name');
                        if (nameEl) nameEl.textContent = btn.dataset.name;
                        _populateCsvColumnSelects(columns);
                        document.getElementById('csv-layer-controls').style.display = '';
                        Toast.success(`Loaded ${rows.length.toLocaleString()} rows.`);
                    } catch (e) {
                        Toast.error('Failed to load CSV.');
                    }
                });
            });

            // Delete button
            listEl.querySelectorAll('.csv-file-row__del').forEach(btn => {
                btn.addEventListener('click', async () => {
                    try {
                        await API.delete(`/portal-data/${encodeURIComponent(btn.dataset.filename)}`);
                        Toast.success('File deleted.');
                        _loadCsvFileList();
                    } catch (e) {
                        Toast.error('Delete failed.');
                    }
                });
            });
        } catch (e) {
            listEl.innerHTML = `<div style="color:#e55;font-size:10px;">Failed to load file list.</div>`;
        }
    }

    function _initCsvPanel() {
        const dropzone = document.getElementById('csv-dropzone');
        const fileInput = document.getElementById('csv-file-input');

        if (!dropzone || !fileInput) return;

        // Click to browse
        dropzone.addEventListener('click', () => fileInput.click());

        // Drag-over highlight
        dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('csv-dropzone--over'); });
        dropzone.addEventListener('dragleave', ()  => dropzone.classList.remove('csv-dropzone--over'));
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('csv-dropzone--over');
            const file = e.dataTransfer.files[0];
            if (file) _uploadCsvFile(file);
        });

        fileInput.addEventListener('change', () => {
            if (fileInput.files[0]) _uploadCsvFile(fileInput.files[0]);
            fileInput.value = '';
        });

        document.getElementById('btn-csv-render')?.addEventListener('click', _renderCsvOnMap);

        document.getElementById('btn-csv-clear')?.addEventListener('click', () => {
            if (_csvLayer) { _csvLayer.clearLayers(); }
            _csvRows = [];
            _csvColumns = [];
            document.getElementById('csv-layer-controls').style.display = 'none';
            const nameEl = document.getElementById('csv-active-name');
            if (nameEl) nameEl.textContent = '';
            Toast.success('CSV layer cleared.');
        });

        // Load file list on first open of this tab
        document.querySelector('.sa-dock__tab[data-panel="data"]')?.addEventListener('click', () => {
            _loadCsvFileList();
        }, { once: true });
    }

    async function _uploadCsvFile(file) {
        if (!file.name.endsWith('.csv')) {
            Toast.error('Only CSV files are accepted.');
            return;
        }
        const formData = new FormData();
        formData.append('csvfile', file);
        try {
            const token = Auth.getToken();
            const resp = await fetch('/api/portal-data/upload', {
                method: 'POST',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                body: formData,
            });
            if (!resp.ok) throw new Error(await resp.text());
            const data = await resp.json();
            Toast.success(`Uploaded: ${data.file.originalName}`);
            _loadCsvFileList();
        } catch (e) {
            Toast.error('Upload failed: ' + e.message);
        }
    }

    return { render };
})();
