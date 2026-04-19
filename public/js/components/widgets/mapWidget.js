/* ============================================================
   TERRA – mapWidget.js
   Geospatial map widget using Leaflet.js with a dark tile layer,
   a glowing location pin, and a configurable radius circle
   representing the observation zone.

   Requires: Leaflet.js and its CSS loaded in index.html
   ============================================================ */

const MapWidget = (() => {

    /* ── Leaflet dark tile URL ───────────────────────────────── */
    const DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    const ATTRIBUTION = '&copy; <a href="https://carto.com/">CARTO</a>';

    /* ── Internal: build custom Leaflet HTML marker ──────────── */
    function buildMarker(colorClass = 'brand') {
        return L.divIcon({
            className: '',
            html: `<div class="map-pin map-pin--${colorClass}"></div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9],
            popupAnchor: [0, -12],
        });
    }

    /* ── Definition ──────────────────────────────────────────── */
    const mapDefinition = {
        id: 'map-location',
        name: 'Geospatial Map',
        icon: '🗺️',
        desc: 'Interactive dark map showing the sighting location and observation radius.',
        defaultSpan: 8,
        flush: true,   // No body padding so map fills edge-to-edge

        render(container, report) {
            const lat = Number(report?.latitude ?? -1.2921);
            const lng = Number(report?.longitude ?? 36.8219);
            const uid = `map-${report?.report_id?.slice(0, 8) || Date.now()}`;

            container.innerHTML = `
        <div class="map-widget-container">
          <!-- Glassmorphic overlay badge -->
          <div class="map-overlay-badge">
            📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}
            &nbsp;|&nbsp;
            ${report?.region_id ? `Region: ${report.region_id.slice(0, 8)}` : 'Region: —'}
          </div>

          <!-- Map mount point -->
          <div id="${uid}" class="leaflet-map"></div>
        </div>
      `;

            // Defer so container is in DOM before Leaflet mounts
            requestAnimationFrame(() => {
                if (typeof L === 'undefined') {
                    document.getElementById(uid).innerHTML = `
            <div style="height:380px;display:flex;align-items:center;justify-content:center;color:var(--clr-text-muted);flex-direction:column;gap:var(--sp-3);">
              <span style="font-size:2rem">🗺️</span>
              <p style="font-size:var(--text-sm)">Leaflet.js not loaded — include it in index.html</p>
            </div>
          `;
                    return;
                }

                // Remove existing map if widget is re-rendered
                const existing = document.getElementById(uid)._leaflet_id;
                if (existing) return;

                const map = L.map(uid, {
                    center: [lat, lng],
                    zoom: 13,
                    zoomControl: true,
                    attributionControl: true,
                });

                L.tileLayer(DARK_TILES, {
                    attribution: ATTRIBUTION,
                    maxZoom: 19,
                    subdomains: 'abcd',
                }).addTo(map);

                const statusKey = (report?.validation_status || 'pending').toLowerCase();
                const dateStr = new Date(report?.created_at || Date.now()).toLocaleString();
                const coordStr = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

                // Primary sighting pin
                L.marker([lat, lng], { icon: buildMarker('brand') })
                    .addTo(map)
                    .bindPopup(`
                        <div class="terra-popup">
                            <div class="terra-popup__header">
                                <span class="terra-popup__species">${report?.species_name || 'Unknown Species'}</span>
                                <span class="badge badge--${statusKey}">${report?.validation_status || 'PENDING'}</span>
                            </div>
                            <div class="terra-popup__body">
                                <div class="terra-popup__row">
                                    <span class="terra-popup__label">Coords</span>
                                    <span class="terra-popup__value">${coordStr}</span>
                                </div>
                                <div class="terra-popup__row">
                                    <span class="terra-popup__label">Date</span>
                                    <span class="terra-popup__value">${dateStr}</span>
                                </div>
                                ${report?.region_id ? `
                                <div class="terra-popup__row">
                                    <span class="terra-popup__label">Region</span>
                                    <span class="terra-popup__value">${report.region_id.slice(0, 8)}</span>
                                </div>` : ''}
                            </div>
                        </div>
                    `, { maxWidth: 280 });

                // Observation radius circle (1 km default)
                L.circle([lat, lng], {
                    radius: 1000,
                    color: '#b8f000',
                    fillColor: '#b8f000',
                    fillOpacity: 0.04,
                    weight: 1,
                    dashArray: '4 6',
                    opacity: 0.5,
                }).addTo(map);

                // Nearby sighting markers (placeholder)
                const nearbyMock = [
                    { lat: lat + 0.008, lng: lng - 0.012, color: 'warning', label: 'Nearby sighting' },
                    { lat: lat - 0.011, lng: lng + 0.009, color: 'accent',  label: 'Nearby sighting' },
                ];

                nearbyMock.forEach(pt => {
                    L.marker([pt.lat, pt.lng], { icon: buildMarker(pt.color) })
                        .addTo(map)
                        .bindPopup(`
                            <div class="terra-popup">
                                <div class="terra-popup__header">
                                    <span class="terra-popup__species">Nearby Sighting</span>
                                </div>
                                <div class="terra-popup__body">
                                    <div class="terra-popup__row">
                                        <span class="terra-popup__label">Coords</span>
                                        <span class="terra-popup__value">${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}</span>
                                    </div>
                                    <div class="terra-popup__row">
                                        <span class="terra-popup__label">Type</span>
                                        <span class="terra-popup__value">Cluster point</span>
                                    </div>
                                </div>
                            </div>
                        `, { maxWidth: 240 });
                });

                // Move attribution to bottom-left to avoid crowding actions
                map.attributionControl.setPrefix('');
            });
        }
    };

    WidgetRegistry.register(mapDefinition);
    return {};
})();
