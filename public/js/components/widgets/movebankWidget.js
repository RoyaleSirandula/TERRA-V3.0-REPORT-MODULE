/* ============================================================
   TERRA – movebankWidget.js
   Plugin widget: link a Movebank study to a report, then
   auto-pull the relevant track segment (filtered by the
   report's time window and geographic scope) and render it
   on a Leaflet map with direction arrows, per-individual
   colour coding, and a CRW-based prediction overlay.

   Requires: Leaflet.js, WidgetRegistry, API, Toast, Modal
   ============================================================ */

const MovebankWidget = (() => {

    /* ── Track colours (cycles across individuals) ───────────── */
    const COLORS     = ['#b8f000', '#00c8e0', '#d98c00', '#9b59b6', '#2ecc71', '#e67e22', '#e74c3c', '#3498db'];
    const DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

    /* ── Geometry helpers ────────────────────────────────────── */

    function _toRad(d) { return d * Math.PI / 180; }

    function _haversineM(lat1, lng1, lat2, lng2) {
        const R = 6_371_000;
        const a = Math.sin(_toRad(lat2 - lat1) / 2) ** 2
                + Math.cos(_toRad(lat1)) * Math.cos(_toRad(lat2))
                * Math.sin(_toRad(lng2 - lng1) / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function _bearing(lat1, lng1, lat2, lng2) {
        const dLng = _toRad(lng2 - lng1);
        const y    = Math.sin(dLng) * Math.cos(_toRad(lat2));
        const x    = Math.cos(_toRad(lat1)) * Math.sin(_toRad(lat2))
                   - Math.sin(_toRad(lat1)) * Math.cos(_toRad(lat2)) * Math.cos(dLng);
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }

    // Project a point given bearing (°) and distance (m) using spherical Earth
    function _project(lat, lng, bearingDeg, distM) {
        const R  = 6_371_000;
        const δ  = distM / R;
        const φ1 = _toRad(lat);
        const λ1 = _toRad(lng);
        const b  = _toRad(bearingDeg);
        const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ)
                            + Math.cos(φ1) * Math.sin(δ) * Math.cos(b));
        const λ2 = λ1 + Math.atan2(Math.sin(b) * Math.sin(δ) * Math.cos(φ1),
                                    Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
        return { lat: φ2 * 180 / Math.PI, lng: λ2 * 180 / Math.PI };
    }

    // Weighted circular mean of bearings
    function _circularMean(bearings, weights) {
        let sinSum = 0, cosSum = 0;
        bearings.forEach((b, i) => {
            const w = weights ? weights[i] : 1;
            sinSum += w * Math.sin(_toRad(b));
            cosSum += w * Math.cos(_toRad(b));
        });
        return (Math.atan2(sinSum, cosSum) * 180 / Math.PI + 360) % 360;
    }

    /* ── CRW prediction ──────────────────────────────────────── */
    // Correlated Random Walk: last N fixes → project STEPS steps forward.
    // Returns array of { lat, lng, ts, radiusM } prediction points.
    function _predictCRW(fixes, steps = 3) {
        if (fixes.length < 2) return [];

        const recent  = fixes.slice(-Math.min(6, fixes.length));
        const vectors = [];
        for (let i = 1; i < recent.length; i++) {
            const p = recent[i - 1], c = recent[i];
            vectors.push({
                bearing: _bearing(p.lat, p.lng, c.lat, c.lng),
                dist:    _haversineM(p.lat, p.lng, c.lat, c.lng),
                dt:      c.ts - p.ts,
            });
        }

        // Weight recent vectors more (linear ramp)
        const weights   = vectors.map((_, i) => i + 1);
        const wSum      = weights.reduce((s, w) => s + w, 0);
        const meanBear  = _circularMean(vectors.map(v => v.bearing), weights);
        const meanDist  = vectors.reduce((s, v, i) => s + v.dist * weights[i], 0) / wSum;
        const meanDt    = vectors.reduce((s, v, i) => s + v.dt   * weights[i], 0) / wSum;

        const last        = recent[recent.length - 1];
        const predictions = [];
        let   cur         = { lat: last.lat, lng: last.lng };

        for (let s = 0; s < steps; s++) {
            // CRW: small random perturbation in bearing (±20°)
            const bPerturbed = meanBear + (Math.random() - 0.5) * 40;
            cur = _project(cur.lat, cur.lng, bPerturbed, meanDist);
            predictions.push({
                ...cur,
                ts:      last.ts + meanDt * (s + 1),
                radiusM: meanDist * Math.sqrt(s + 1) * 1.5, // uncertainty grows as √N
                step:    s + 1,
            });
        }

        return predictions;
    }

    /* ── Map rendering ───────────────────────────────────────── */

    function _buildMarker(colorClass) {
        return L.divIcon({
            className: '',
            html:      `<div class="map-pin map-pin--${colorClass}"></div>`,
            iconSize:  [18, 18],
            iconAnchor:[9, 9],
        });
    }

    function _renderTrack(map, fixes, repLat, repLng) {
        // Group fixes by individual
        const byInd = {};
        fixes.forEach(f => { (byInd[f.individual] ??= []).push(f); });

        Object.keys(byInd).forEach((ind, idx) => {
            const color = COLORS[idx % COLORS.length];
            const track = byInd[ind].sort((a, b) => a.ts - b.ts);
            const latlngs = track.map(f => [f.lat, f.lng]);

            // Historical polyline
            L.polyline(latlngs, { color, weight: 2, opacity: 0.85 })
                .addTo(map)
                .bindPopup(`<b style="color:${color}">${ind}</b><br>${track.length} fixes`);

            // Direction arrows every ~8 fixes
            const arrowInterval = Math.max(1, Math.floor(track.length / 8));
            for (let i = arrowInterval; i < track.length; i += arrowInterval) {
                const b = _bearing(track[i-1].lat, track[i-1].lng, track[i].lat, track[i].lng);
                L.marker([track[i].lat, track[i].lng], {
                    icon: L.divIcon({
                        className: '',
                        html: `<div style="color:${color};font-size:9px;transform:rotate(${b}deg);line-height:1;opacity:.85">▶</div>`,
                        iconSize:  [10, 10],
                        iconAnchor:[5, 5],
                    }),
                    interactive: false,
                }).addTo(map);
            }

            // Sparse fix markers with popup detail
            const ptInterval = Math.max(1, Math.floor(track.length / 20));
            track.filter((_, i) => i % ptInterval === 0).forEach(f => {
                L.circleMarker([f.lat, f.lng], {
                    radius:      3,
                    color,
                    fillColor:   color,
                    fillOpacity: 0.75,
                    weight:      1,
                }).addTo(map).bindPopup(
                    `<div class="terra-popup__body">
                        <div class="terra-popup__row">
                            <span class="terra-popup__label">Individual</span>
                            <span class="terra-popup__value">${ind}</span>
                        </div>
                        <div class="terra-popup__row">
                            <span class="terra-popup__label">Time</span>
                            <span class="terra-popup__value">${new Date(f.ts).toLocaleString()}</span>
                        </div>
                        <div class="terra-popup__row">
                            <span class="terra-popup__label">Sensor</span>
                            <span class="terra-popup__value">${f.sensor || 'Unknown'}</span>
                        </div>
                        <div class="terra-popup__row">
                            <span class="terra-popup__label">Coords</span>
                            <span class="terra-popup__value">${f.lat.toFixed(5)}, ${f.lng.toFixed(5)}</span>
                        </div>
                    </div>`,
                    { maxWidth: 260 }
                );
            });

            // CRW prediction overlay (dashed line + growing confidence circles)
            const predictions = _predictCRW(track);
            if (predictions.length > 0) {
                const predLine = [[track[track.length-1].lat, track[track.length-1].lng],
                                  ...predictions.map(p => [p.lat, p.lng])];
                L.polyline(predLine, {
                    color,
                    weight:    1.5,
                    opacity:   0.5,
                    dashArray: '6 6',
                }).addTo(map);

                predictions.forEach(p => {
                    L.circle([p.lat, p.lng], {
                        radius:      p.radiusM,
                        color,
                        fillColor:   color,
                        fillOpacity: 0.04,
                        weight:      1,
                        dashArray:   '4 4',
                        opacity:     0.35,
                    }).addTo(map).bindPopup(
                        `<div class="terra-popup__body">
                            <div class="terra-popup__row">
                                <span class="terra-popup__label">Prediction</span>
                                <span class="terra-popup__value" style="color:${color}">Step ${p.step}</span>
                            </div>
                            <div class="terra-popup__row">
                                <span class="terra-popup__label">Est. Time</span>
                                <span class="terra-popup__value">${new Date(p.ts).toLocaleString()}</span>
                            </div>
                            <div class="terra-popup__row">
                                <span class="terra-popup__label">Uncertainty</span>
                                <span class="terra-popup__value">${(p.radiusM / 1000).toFixed(1)} km radius</span>
                            </div>
                        </div>`,
                        { maxWidth: 240 }
                    );
                });
            }
        });

        // Report location pin
        L.marker([repLat, repLng], { icon: _buildMarker('brand') })
            .addTo(map)
            .bindPopup('<div class="terra-popup__body"><b>Report Sighting Location</b></div>');
    }

    /* ── Stats bar ───────────────────────────────────────────── */
    function _buildStats(result) {
        const inds     = new Set(result.fixes.map(f => f.individual)).size;
        const sensors  = [...new Set(result.fixes.map(f => f.sensor).filter(Boolean))].join(', ') || 'Unknown';
        const sorted   = [...result.fixes].sort((a, b) => a.ts - b.ts);
        const dateRng  = sorted.length
            ? `${new Date(sorted[0].ts).toLocaleDateString()} – ${new Date(sorted[sorted.length-1].ts).toLocaleDateString()}`
            : 'No data';

        return `
          <div class="mb-track-stats">
            <span class="mb-stat"><b>${result.fixes.length}</b> fixes</span>
            <span class="mb-stat"><b>${inds}</b> individual${inds !== 1 ? 's' : ''}</span>
            <span class="mb-stat">Sensor: <b>${sensors}</b></span>
            <span class="mb-stat">${dateRng}</span>
            <span class="mb-stat">±${result.window.days}d window</span>
            <span class="mb-stat">${result.radiusKm} km radius</span>
          </div>`;
    }

    /* ── Load and display track ──────────────────────────────── */
    async function _loadTrack(container, report, studyId, windowDays, radiusKm) {
        const mapId = `mb-map-${report.report_id.slice(0, 8)}-${Date.now()}`;

        container.innerHTML = `
          <div class="mb-loading">
            <div class="spinner"></div>
            <span>Fetching Movebank track data…</span>
          </div>`;

        try {
            const result = await API.get(
                `/movebank/track?study_id=${encodeURIComponent(studyId)}`
                + `&report_id=${encodeURIComponent(report.report_id)}`
                + `&window_days=${windowDays}&radius_km=${radiusKm}`
            );

            if (result.fixes.length === 0) {
                container.innerHTML = `
                  <div class="mb-empty">
                    No fixes found within ±${windowDays} days and ${radiusKm} km of this sighting.
                    <p class="mb-hint">Try a wider time window or radius using the controls above.</p>
                  </div>
                  ${_buildStats(result)}`;
                return;
            }

            container.innerHTML = `
              ${_buildStats(result)}
              <div id="${mapId}" class="mb-map"></div>
              <div class="mb-legend">
                <span class="mb-legend-item">
                  <span class="mb-legend-line mb-legend-line--solid"></span> Track
                </span>
                <span class="mb-legend-item">
                  <span class="mb-legend-line mb-legend-line--dashed"></span> CRW Prediction
                </span>
                <span class="mb-legend-item">
                  <div class="map-pin map-pin--brand" style="display:inline-block"></div> Sighting
                </span>
              </div>`;

            requestAnimationFrame(() => {
                const el = document.getElementById(mapId);
                if (!el || el._leaflet_id) return;

                const map = L.map(mapId, {
                    center:           [report.latitude, report.longitude],
                    zoom:             7,
                    zoomControl:      true,
                    attributionControl: true,
                });

                L.tileLayer(DARK_TILES, {
                    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
                    maxZoom:     19,
                    subdomains:  'abcd',
                }).addTo(map);

                _renderTrack(map, result.fixes, report.latitude, report.longitude);

                // Fit map to all points
                try {
                    const pts = result.fixes.map(f => [f.lat, f.lng]);
                    pts.push([report.latitude, report.longitude]);
                    map.fitBounds(L.latLngBounds(pts).pad(0.1));
                } catch (_) {}
            });

        } catch (err) {
            container.innerHTML = `
              <div class="mb-error">
                <b>Track fetch failed:</b> ${err.message}
                <p class="mb-hint">Ensure MOVEBANK_USERNAME and MOVEBANK_PASSWORD are set, and that
                this study's licence permits data access.</p>
              </div>`;
        }
    }

    /* ── Study search + attach panel ─────────────────────────── */
    function _renderAttachPanel(container, report, onAttached) {
        const species = report.species_name || '';

        container.innerHTML = `
          <div class="mb-attach-panel">
            <div class="mb-attach-header">
              <span class="mb-icon">🦓</span>
              <div>
                <div class="mb-attach-title">Link a Movebank Study</div>
                <div class="mb-attach-sub">
                  Search for studies tracking <em>${species || 'this species'}</em>
                  and attach one to auto-pull track data.
                </div>
              </div>
            </div>

            <div class="mb-search-row">
              <input class="form-input mb-search-input" id="mb-search-input"
                type="text" placeholder="Species name…" value="${species}" />
              <button class="btn btn--primary btn--sm" id="mb-search-btn">SEARCH</button>
            </div>

            <div id="mb-results"></div>
          </div>`;

        const input     = container.querySelector('#mb-search-input');
        const searchBtn = container.querySelector('#mb-search-btn');
        const results   = container.querySelector('#mb-results');
        let   selected  = null;
        let   windowDays = 30;
        let   radiusKm   = 500;

        async function doSearch() {
            const taxon = input.value.trim();
            if (!taxon) return;

            results.innerHTML = `<div class="mb-loading"><div class="spinner"></div><span>Searching…</span></div>`;
            searchBtn.disabled = true;

            try {
                const studies = await API.get(`/movebank/studies?taxon=${encodeURIComponent(taxon)}`);

                if (!studies.length) {
                    results.innerHTML = `<div class="mb-empty">No public studies found for "${taxon}".</div>`;
                    return;
                }

                results.innerHTML = `
                  <div class="mb-results-header">${studies.length} stud${studies.length === 1 ? 'y' : 'ies'} found</div>
                  <div class="mb-results-list">
                    ${studies.slice(0, 25).map(s => `
                      <label class="mb-result-item" data-id="${s.id}">
                        <input type="radio" name="mb-study" value="${s.id}" class="mb-result-radio" />
                        <div class="mb-result-info">
                          <div class="mb-result-name">${s.name}</div>
                          <div class="mb-result-meta">
                            ${s.numberOfIndividuals ? `${s.numberOfIndividuals} ind.` : ''}
                            ${s.sensorTypes ? ` · ${s.sensorTypes}` : ''}
                            ${s.licenseType  ? ` · ${s.licenseType}`  : ''}
                          </div>
                        </div>
                      </label>`).join('')}
                  </div>

                  <div class="mb-attach-row">
                    <div class="mb-window-controls">
                      <span class="mb-label">Window</span>
                      ${[7, 14, 30, 60].map(d => `
                        <button class="btn btn--sm btn--secondary mb-window-btn ${d === 30 ? 'active' : ''}"
                          data-days="${d}">±${d}d</button>`).join('')}
                    </div>
                    <div class="mb-radius-controls">
                      <span class="mb-label">Radius</span>
                      ${[100, 250, 500].map(r => `
                        <button class="btn btn--sm btn--secondary mb-radius-btn ${r === 500 ? 'active' : ''}"
                          data-radius="${r}">${r}km</button>`).join('')}
                    </div>
                    <button class="btn btn--primary mb-attach-btn" id="mb-attach-btn" disabled>
                      ATTACH STUDY
                    </button>
                  </div>`;

                // Window toggle
                results.querySelectorAll('.mb-window-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        results.querySelectorAll('.mb-window-btn').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        windowDays = parseInt(btn.dataset.days);
                    });
                });

                // Radius toggle
                results.querySelectorAll('.mb-radius-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        results.querySelectorAll('.mb-radius-btn').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        radiusKm = parseInt(btn.dataset.radius);
                    });
                });

                // Study radio selection
                results.querySelectorAll('.mb-result-radio').forEach(radio => {
                    radio.addEventListener('change', () => {
                        selected = radio.value;
                        results.querySelector('#mb-attach-btn').disabled = false;
                        results.querySelectorAll('.mb-result-item').forEach(item => {
                            item.classList.toggle('selected', item.dataset.id === selected);
                        });
                    });
                });

                // Attach
                results.querySelector('#mb-attach-btn').addEventListener('click', async () => {
                    if (!selected) return;
                    const btn = results.querySelector('#mb-attach-btn');
                    btn.disabled = true;
                    btn.textContent = 'ATTACHING…';

                    try {
                        await API.patch('/movebank/attach', {
                            report_id:   report.report_id,
                            study_id:    selected,
                            window_days: windowDays,
                            radius_km:   radiusKm,
                        });
                        report.movebank_study_id = selected;
                        report.movebank_config   = { window_days: windowDays, radius_km: radiusKm };
                        Toast.success('Movebank study linked.');
                        onAttached(selected, windowDays, radiusKm);
                    } catch (err) {
                        Toast.error('Attach failed: ' + err.message);
                        btn.disabled = false;
                        btn.textContent = 'ATTACH STUDY';
                    }
                });

            } catch (err) {
                results.innerHTML = `<div class="mb-error"><b>Search failed:</b> ${err.message}</div>`;
            } finally {
                searchBtn.disabled = false;
            }
        }

        searchBtn.addEventListener('click', doSearch);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    }

    /* ── Main render ─────────────────────────────────────────── */
    function render(container, report) {
        const studyId    = report.movebank_study_id;
        const config     = report.movebank_config || {};
        const windowDays = config.window_days || 30;
        const radiusKm   = config.radius_km   || 500;

        if (!studyId) {
            _renderAttachPanel(container, report, () => render(container, report));
            return;
        }

        // Study attached — show controls + track map
        container.innerHTML = `
          <div class="mb-study-bar">
            <div class="mb-study-info">
              <span class="mb-icon">🦓</span>
              <span class="mb-study-name" id="mb-study-name">Study ${studyId}</span>
              <span class="mb-study-meta" id="mb-study-meta">Loading…</span>
            </div>
            <div class="mb-study-controls">
              <div class="mb-window-controls">
                <span class="mb-label">Window</span>
                ${[7, 14, 30, 60].map(d => `
                  <button class="btn btn--sm btn--secondary mb-window-btn ${d === windowDays ? 'active' : ''}"
                    data-days="${d}">±${d}d</button>`).join('')}
              </div>
              <div class="mb-radius-controls">
                <span class="mb-label">Radius</span>
                ${[100, 250, 500].map(r => `
                  <button class="btn btn--sm btn--secondary mb-radius-btn ${r === radiusKm ? 'active' : ''}"
                    data-radius="${r}">${r}km</button>`).join('')}
              </div>
              <button class="btn btn--danger btn--sm" id="mb-detach-btn">DETACH</button>
            </div>
          </div>
          <div class="mb-track-container" id="mb-track-container"></div>`;

        let curWindow = windowDays;
        let curRadius = radiusKm;

        // Populate study name async
        API.get(`/movebank/study/${studyId}`).then(info => {
            const nameEl = container.querySelector('#mb-study-name');
            const metaEl = container.querySelector('#mb-study-meta');
            if (nameEl) nameEl.textContent = info.name;
            if (metaEl) metaEl.textContent =
                `${info.numberOfIndividuals || '?'} individuals · ${info.sensorTypes || 'Unknown sensor'}`;
        }).catch(() => {});

        const trackEl = container.querySelector('#mb-track-container');
        _loadTrack(trackEl, report, studyId, curWindow, curRadius);

        // Window controls
        container.querySelectorAll('.mb-window-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                container.querySelectorAll('.mb-window-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                curWindow = parseInt(btn.dataset.days);
                _loadTrack(trackEl, report, studyId, curWindow, curRadius);
            });
        });

        // Radius controls
        container.querySelectorAll('.mb-radius-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                container.querySelectorAll('.mb-radius-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                curRadius = parseInt(btn.dataset.radius);
                _loadTrack(trackEl, report, studyId, curWindow, curRadius);
            });
        });

        // Detach
        container.querySelector('#mb-detach-btn').addEventListener('click', () => {
            Modal.open({
                title:        'Detach Movebank Study',
                body:         '<p>Remove the Movebank study link from this report? The track overlay will be removed.</p>',
                confirmLabel: 'Detach',
                onConfirm:    async () => {
                    try {
                        await API.delete(`/movebank/detach/${report.report_id}`);
                        report.movebank_study_id = null;
                        report.movebank_config   = {};
                        Toast.success('Study detached.');
                        render(container, report);
                    } catch (err) {
                        Toast.error('Detach failed: ' + err.message);
                    }
                },
            });
        });
    }

    /* ── Widget definition ───────────────────────────────────── */
    WidgetRegistry.register({
        id:          'movebank-tracker',
        name:        'Movebank Movement Tracker',
        icon:        '🦓',
        desc:        'Link a Movebank study to visualise animal tracks, trajectories, and CRW predictions around this sighting.',
        defaultSpan: 12,
        flush:       false,
        render,
    });

    return {};
})();
