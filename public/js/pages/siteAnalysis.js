/* ============================================================
   TERRA – siteAnalysis.js
   Entry point bifurcates:
     • Sidebar click  → renderSessionsDashboard()  (list of saved sessions)
     • Router with lat/lng options → renderMapView() (full tactical map)
   ============================================================ */


const SiteAnalysisPage = (() => {

    /* ── Module-level Map State ──────────────────────────────── */
    let _map = null;
    let _reports = [];
    let _filteredReports = [];
    let _gridLayer = null;
    let _sightingsLayer = null;
    let _heatmapLayer = null;
    let _bufferLayer = null;
    let _drawnItems = null;
    let _activeMode = 'aesthetic';
    let _pendingFlyTo = null; // Queued flyTo once map is confirmed ready

    const SESSIONS_KEY = 'terra-sa-sessions';

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

        const renderCard = (s) => `
            <div class="sa-session-card ${s.isStarred ? 'sa-session-card--starred' : ''}" data-id="${s.id}">
                <div class="sa-session-card__star" data-action="star" data-id="${s.id}" title="${s.isStarred ? 'Unstar' : 'Star'}">
                    ${s.isStarred ? '★' : '☆'}
                </div>
                <div class="sa-session-card__body">
                    <div class="sa-session-card__name">${escapeHtml(s.name)}</div>
                    <div class="sa-session-card__meta">
                        <span>${new Date(s.savedAt).toLocaleString()}</span>
                        <span class="sa-session-card__dot">·</span>
                        <span>${s.mode === 'satellite' ? 'Satellite' : 'Minimal'} Mode</span>
                        <span class="sa-session-card__dot">·</span>
                        <span>Zoom ${s.viewport?.zoom ?? '–'}</span>
                    </div>
                    <div class="sa-session-card__coords">
                        ${s.viewport ? `${Number(s.viewport.lat).toFixed(4)}, ${Number(s.viewport.lng).toFixed(4)}` : '–'}
                        ${s.reportId ? `<span class="sa-session-card__badge">From Report</span>` : ''}
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
        `;

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
        attachSessionListeners(container);
    }

    function attachSessionListeners(container) {
        const wrap = document.getElementById('sa-sessions-wrap');
        if (!wrap) return;

        // Open session
        wrap.querySelectorAll('[data-action="open"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                const session = loadSessions().find(s => s.id === id);
                if (session) renderMapView(container, session);
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
            layers: {
                grid: document.getElementById('layer-grid')?.checked ?? true,
                tactical: document.getElementById('layer-tactical')?.checked ?? true,
                sightings: document.getElementById('layer-sightings')?.checked ?? true,
                heatmap: document.getElementById('layer-heatmap')?.checked ?? true
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

    /* ═══════════════════════════════════════════════════════════
       MAP VIEW
       options can be { lat, lng, reportId } (from report detail)
       OR a full session object (from sessions list)
    ═══════════════════════════════════════════════════════════ */
    function renderMapView(container, options = {}) {
        // Store flyTo target before the map exists
        if (options.lat != null && options.lng != null) {
            _pendingFlyTo = {
                lat: parseFloat(options.lat),
                lng: parseFloat(options.lng),
                zoom: options.viewport?.zoom || 14,
                reportId: options.reportId || null
            };
        } else {
            _pendingFlyTo = null;
        }

        // Restore mode from session if present
        if (options.mode) _activeMode = options.mode;

        container.innerHTML = `
        <div class="site-analysis anim-fade-in">
            <div class="sa-header">
                <div style="display:flex;align-items:center;gap:var(--sp-5);">
                    <button class="sa-back-btn" id="btn-back-dashboard" title="Back to Sessions">← Sessions</button>
                    <div class="sa-header__title">Site Analysis // Tactical Overview</div>
                </div>
                <div class="sa-header__right">
                    <div class="sa-header__meta" id="sa-meta">
                        ${options.reportId ? `Origin: Report ${String(options.reportId).slice(0, 8)}` : 'Mara-Serengeti Sector'}
                    </div>
                    <button class="sa-session-save" id="btn-save-session">SAVE SESSION</button>
                </div>
            </div>

            <div class="sa-map-wrap">
                <div id="sa-map"></div>

                <div class="sa-controls">
                    <button class="sa-btn" id="btn-mode-aesthetic">Minimal Mode</button>
                    <button class="sa-btn" id="btn-mode-satellite">Satellite Layer</button>
                </div>

                <div class="sa-overlay-bottom-left">
                    <div class="sa-compass">N</div>
                    <div class="sa-scale-bar"></div>
                </div>

                <div class="sa-tool-results" id="sa-tool-results">
                    <div class="sa-tool-results__header">
                        <h3 id="sa-tool-title">Analysis Results</h3>
                        <button class="sa-tool-results__close" id="btn-close-results">&times;</button>
                    </div>
                    <div id="sa-tool-content">Select or draw an area to analyze.</div>
                </div>

                <div class="sa-layer-panel">
                    <h3>Active Layers</h3>
                    <div class="sa-layer-item">
                        <input type="checkbox" id="layer-grid" ${options.layers?.grid !== false ? 'checked' : ''}>
                        <label for="layer-grid">Density Grid</label>
                    </div>
                    <div class="sa-layer-item">
                        <input type="checkbox" id="layer-tactical" ${options.layers?.tactical !== false ? 'checked' : ''}>
                        <label for="layer-tactical">Tactical Lines</label>
                    </div>
                    <div class="sa-layer-item">
                        <input type="checkbox" id="layer-sightings" ${options.layers?.sightings !== false ? 'checked' : ''}>
                        <label for="layer-sightings">Sightings Data</label>
                    </div>
                    <div class="sa-layer-item">
                        <input type="checkbox" id="layer-heatmap" ${options.layers?.heatmap !== false ? 'checked' : ''}>
                        <label for="layer-heatmap">Density Heatmap</label>
                    </div>
                </div>

                <div class="sa-buffer-panel" id="sa-buffer-panel">
                    <h3>Buffer Analysis</h3>
                    <div class="sa-buffer-row">
                        <label>Radius</label>
                        <span class="sa-buffer-val" id="buffer-radius-display">5km</span>
                    </div>
                    <input type="range" id="buffer-radius-slider" min="500" max="50000" step="500" value="5000" />
                    <div class="sa-buffer-row" style="margin-top:8px;"><label>Center</label></div>
                    <div style="display:flex;gap:4px;margin-bottom:6px;">
                        <input type="number" id="buffer-lat" class="sa-buffer-input" placeholder="Lat" step="0.0001" ${_pendingFlyTo ? `value="${_pendingFlyTo.lat.toFixed(5)}"` : ''} />
                        <input type="number" id="buffer-lng" class="sa-buffer-input" placeholder="Lng" step="0.0001" ${_pendingFlyTo ? `value="${_pendingFlyTo.lng.toFixed(5)}"` : ''} />
                    </div>
                    <button class="sa-btn" id="btn-run-buffer" style="width:100%;margin-top:4px;">Run Buffer</button>
                    <div style="font-size:9px;opacity:0.5;margin-top:4px;text-align:center;">OR draw a marker / line on map</div>
                </div>

                <div class="sa-timeline">
                    <button class="sa-btn" id="btn-timeline-play">PLAY</button>
                    <div class="sa-timeline-val" id="timeline-val-start">--</div>
                    <input type="range" id="timeline-slider" min="0" max="100" value="100" step="1" />
                    <div class="sa-timeline-val" id="timeline-val-current" style="color:#E31B23">--</div>
                </div>
            </div>

            <div class="sa-analysis-panel">
                <div class="sa-stat">
                    <div class="sa-stat__label">Sector Density</div>
                    <div class="sa-stat__value" id="sa-val-density">0.0</div>
                    <div class="sa-stat__delta">INTENSITY INDEX</div>
                </div>
                <div class="sa-stat">
                    <div class="sa-stat__label">Active Points</div>
                    <div class="sa-stat__value" id="sa-val-points">0</div>
                    <div class="sa-stat__delta">FILTERED SIGHTINGS</div>
                </div>
                <div class="sa-stat">
                    <div class="sa-stat__label">Grid Resolution</div>
                    <div class="sa-stat__value">~500m</div>
                    <div class="sa-stat__delta">ADAPTIVE CELLS</div>
                </div>
                <div class="sa-stat">
                    <div class="sa-stat__label">Total Records</div>
                    <div class="sa-stat__value" id="sa-val-total">0</div>
                    <div class="sa-stat__delta">ALL VALIDATED</div>
                </div>
            </div>
        </div>
        `;

        attachMapListeners(container, options);
        initMap(options);
        loadData();
    }

    /* ══════════════ Map Initialization ═══════════════════════ */
    function initMap(sessionOptions = {}) {
        const defaultLat = -1.2921;
        const defaultLng = 36.8219;

        requestAnimationFrame(() => {
            const mapEl = document.getElementById('sa-map');
            if (!mapEl) return;

            if (_map) { _map.remove(); _map = null; }

            _map = L.map('sa-map', {
                zoomControl: true,
                attributionControl: false,
                preferCanvas: false
            }).setView([defaultLat, defaultLng], 10);

            _map.createPane('gridPane');
            _map.getPane('gridPane').style.zIndex = 999;
            _map.getPane('gridPane').style.pointerEvents = 'auto';

            LAYERS[_activeMode].addTo(_map);

            _gridLayer = L.featureGroup({ pane: 'gridPane' }).addTo(_map);
            _sightingsLayer = L.featureGroup().addTo(_map);
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

            // Wait for DOM layout, then invalidate + apply pending flyTo
            setTimeout(() => {
                if (!_map) return;
                _map.invalidateSize();
                updateModeUI();

                // ── Apply flyTo from pending options ──────────────
                if (_pendingFlyTo) {
                    const { lat, lng, zoom, reportId } = _pendingFlyTo;
                    _map.setView([lat, lng], zoom || 14);

                    // Origin highlight marker
                    L.circleMarker([lat, lng], {
                        radius: 16,
                        color: '#E31B23',
                        weight: 3,
                        fillColor: '#E31B23',
                        fillOpacity: 0.2
                    }).bindPopup(`
                        <div style="font-family:var(--font-mono);font-size:10px;">
                            <strong style="color:#E31B23;">REPORT ORIGIN</strong><br/>
                            ${lat.toFixed(5)}, ${lng.toFixed(5)}<br/>
                            ${reportId ? `ID: ${reportId.slice(0, 8)}` : ''}
                        </div>
                    `).addTo(_bufferLayer).openPopup();

                    _pendingFlyTo = null;
                } else if (sessionOptions.viewport) {
                    // Restore saved viewport from a session
                    const { lat, lng, zoom } = sessionOptions.viewport;
                    _map.setView([lat, lng], zoom);

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
                }

                try {
                    const geoJSON = layer.toGeoJSON();
                    const res = await API.post('/api/analysis/user-objects', { type, geometry: geoJSON.geometry, meta_data: {} });
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
                        try { await API.delete('/api/analysis/user-objects/' + layer._dbId); } catch (e) { }
                    }
                });
                _bufferLayer.clearLayers();
                hideResults();
            });
        });
    }

    /* ══════════════ Data Loading ══════════════════════════════ */
    async function loadData() {
        try {
            _reports = await API.get('/api/analysis/sightings');
            const totalEl = document.getElementById('sa-val-total');
            if (totalEl) totalEl.textContent = _reports.length;

            if (_reports.length > 0) {
                const dates = _reports.map(r => new Date(r.created_at).getTime()).filter(t => !isNaN(t));
                if (dates.length > 0) {
                    _timeline.minDate = Math.min(...dates);
                    _timeline.maxDate = Math.max(...dates);
                    _timeline.currentDate = _timeline.maxDate;
                }
                updateTimelineUI();
                applyTemporalFilter();

                // If no specific flyTo, auto-fit to sightings
                if (!_pendingFlyTo) {
                    const points = _reports.map(r => [r.latitude, r.longitude]);
                    setTimeout(() => {
                        if (_map && points.length > 0 && !document.getElementById('sa-map')?._hasFlyTarget) {
                            try { _map.fitBounds(L.latLngBounds(points), { padding: [80, 80], maxZoom: 13 }); } catch (e) { }
                        }
                    }, 700);
                }
            }
        } catch (err) {
            console.error('[SITE ANALYSIS] Data fetch failed:', err);
        }
    }

    /* ══════════════ Layer Rendering ═══════════════════════════ */
    function renderLayers() {
        if (!_map) return;
        const showGrid = document.getElementById('layer-grid')?.checked;
        const showTactical = document.getElementById('layer-tactical')?.checked;
        const showSightings = document.getElementById('layer-sightings')?.checked;
        const showHeatmap = document.getElementById('layer-heatmap')?.checked;

        if (showGrid || showTactical) renderGrid(showGrid, showTactical);
        else _gridLayer.clearLayers();

        if (showSightings) renderSightings();
        else _sightingsLayer.clearLayers();

        if (showHeatmap) renderHeatmap();
        else { if (_heatmapLayer) { _map.removeLayer(_heatmapLayer); _heatmapLayer = null; } }
    }

    function renderGrid(showDensityCells = true, showTacticalLines = true) {
        if (!_gridLayer) return;
        _gridLayer.clearLayers();

        if (showDensityCells && _filteredReports.length > 0) {
            const cellSize = 0.005;
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
                    <div style="font-family:var(--font-mono);font-size:10px;min-width:160px;">
                        <strong style="color:#E31B23;display:block;margin-bottom:4px;">GRID CELL</strong>
                        <span>Sightings: <b>${count}</b></span><br/>
                        <span>Intensity: <b>${(intensity * 100).toFixed(0)}%</b></span><br/>
                        <span style="opacity:0.7;font-size:9px;">${species.slice(0, 4).join(', ')}</span>
                    </div>
                `);
                rect.addTo(_gridLayer);
            });

            const densityEl = document.getElementById('sa-val-density');
            if (densityEl) densityEl.textContent = (maxCount / 5).toFixed(1);
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
        _filteredReports.forEach(r => {
            const marker = L.circleMarker([r.latitude, r.longitude], { radius: 4, fillColor: '#E31B23', color: '#000', weight: 1, opacity: 0.8, fillOpacity: 0.8 });
            const speciesName = (window.SpeciesRegistry && window.SpeciesRegistry[r.species_id]?.common_name) || r.species_id || 'Unknown';
            marker.bindPopup(`<div style="font-family:var(--font-mono);font-size:10px;"><strong>${speciesName}</strong><br/>${new Date(r.created_at).toLocaleDateString()}<br/>Tier: ${r.sensitivity_tier || '–'} | Conf: ${r.ai_confidence_score || 'N/A'}%</div>`);
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
    async function handleAnalysis(type, geometry) {
        showResultsLoading();
        const radius = parseInt(document.getElementById('buffer-radius-slider')?.value || 5000, 10);
        try {
            if (type === 'polygon') {
                const data = await API.post('/api/analysis/ndvi-zonal', { polygon: geometry });
                const trendRows = Array.isArray(data.trend)
                    ? data.trend.map(t => `<p><span>${t.date}:</span><span class="val">${parseFloat(t.value).toFixed(3)}</span></p>`).join('')
                    : '';
                showResults('NDVI Zonal Stats', `
                    <p><span>Mean NDVI:</span><span class="val">${data.mean}</span></p>
                    <p><span>Min NDVI:</span><span class="val">${data.min}</span></p>
                    <p><span>Max NDVI:</span><span class="val">${data.max}</span></p>
                    <p><span>30d Change:</span><span class="val">${data.change_30_days > 0 ? '+' : ''}${data.change_30_days}</span></p>
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
        _bufferLayer.clearLayers();

        try {
            const data = await API.post('/api/analysis/buffer', { geometry, radius_meters: radiusMeters });
            const radiusKm = (radiusMeters / 1000).toFixed(1);
            const coords = geometry.coordinates;
            let center;
            if (geometry.type === 'Point') center = [coords[1], coords[0]];
            else if (geometry.type === 'LineString') { const m = Math.floor(coords.length / 2); center = [coords[m][1], coords[m][0]]; }

            if (center) {
                L.circle(center, { radius: radiusMeters, color: '#E31B23', weight: 2, dashArray: '8, 6', fillColor: '#E31B23', fillOpacity: 0.06 }).addTo(_bufferLayer);
            }

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

    function showResultsLoading() {
        const p = document.getElementById('sa-tool-results');
        const t = document.getElementById('sa-tool-title');
        const c = document.getElementById('sa-tool-content');
        if (p) p.classList.add('active');
        if (t) t.textContent = 'Analyzing…';
        if (c) c.innerHTML = '<p>Computing spatial statistics…</p>';
    }

    function showResults(title, html) {
        const p = document.getElementById('sa-tool-results');
        const t = document.getElementById('sa-tool-title');
        const c = document.getElementById('sa-tool-content');
        if (p) p.classList.add('active');
        if (t) t.textContent = title;
        if (c) c.innerHTML = html;
    }

    function hideResults() {
        document.getElementById('sa-tool-results')?.classList.remove('active');
    }

    /* ══════════════ Map Listeners ═════════════════════════════ */
    function attachMapListeners(container, options) {
        // Back to dashboard
        document.getElementById('btn-back-dashboard')?.addEventListener('click', () => {
            if (_map) { _map.remove(); _map = null; }
            window.location.hash = '#/site-analysis';
        });

        // Mode toggles
        document.getElementById('btn-mode-aesthetic')?.addEventListener('click', () => setMode('aesthetic'));
        document.getElementById('btn-mode-satellite')?.addEventListener('click', () => setMode('satellite'));

        // Layer checkboxes
        ['layer-grid', 'layer-tactical', 'layer-sightings', 'layer-heatmap'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', renderLayers);
        });

        // Close results
        document.getElementById('btn-close-results')?.addEventListener('click', hideResults);

        // Timeline
        document.getElementById('timeline-slider')?.addEventListener('input', (e) => {
            _timeline.currentDate = parseInt(e.target.value, 10);
            updateTimelineUI();
            applyTemporalFilter();
            if (_timeline.playing) togglePlayback();
        });
        document.getElementById('btn-timeline-play')?.addEventListener('click', togglePlayback);

        // Buffer radius display
        const bSlider = document.getElementById('buffer-radius-slider');
        const bDisp = document.getElementById('buffer-radius-display');
        if (bSlider && bDisp) {
            bSlider.addEventListener('input', () => {
                const v = parseInt(bSlider.value, 10);
                bDisp.textContent = v >= 1000 ? `${(v / 1000).toFixed(1)}km` : `${v}m`;
            });
        }

        // Buffer run button
        document.getElementById('btn-run-buffer')?.addEventListener('click', async () => {
            const lat = parseFloat(document.getElementById('buffer-lat')?.value);
            const lng = parseFloat(document.getElementById('buffer-lng')?.value);
            const radius = parseInt(document.getElementById('buffer-radius-slider')?.value || 5000, 10);
            if (isNaN(lat) || isNaN(lng)) {
                Toast.error('Enter valid lat/lng coordinates or draw a marker on the map first.');
                return;
            }
            await runBufferOnGeometry({ type: 'Point', coordinates: [lng, lat] }, radius);
        });

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
        _filteredReports = !_timeline.minDate
            ? [..._reports]
            : _reports.filter(r => { const t = new Date(r.created_at).getTime(); return !isNaN(t) && t <= _timeline.currentDate; });
        const el = document.getElementById('sa-val-points');
        if (el) el.textContent = _filteredReports.length;
        renderLayers();
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
        document.getElementById('btn-mode-aesthetic')?.classList.toggle('active', _activeMode === 'aesthetic');
        document.getElementById('btn-mode-satellite')?.classList.toggle('active', _activeMode === 'satellite');
        renderLayers();
    }

    return { render };
})();
