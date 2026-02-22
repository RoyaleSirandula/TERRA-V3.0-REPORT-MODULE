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

                // Primary sighting pin
                L.marker([lat, lng], { icon: buildMarker('brand') })
                    .addTo(map)
                    .bindPopup(`
            <strong>${report?.species_name || 'Unknown Species'}</strong><br/>
            ${new Date(report?.created_at || Date.now()).toLocaleString()}<br/>
            <span class="badge badge--${(report?.validation_status || 'pending').toLowerCase()}">
              ${report?.validation_status || 'PENDING'}
            </span>
          `);

                // Observation radius circle (1 km default)
                L.circle([lat, lng], {
                    radius: 1000,
                    color: 'rgba(52,211,153,0.9)',
                    fillColor: 'rgba(52,211,153,0.07)',
                    fillOpacity: 1,
                    weight: 1.5,
                    dashArray: '4 4',
                }).addTo(map);

                // If there are nearby sighting coords, plot them (placeholder)
                const nearbyMock = [
                    { lat: lat + 0.008, lng: lng - 0.012, color: 'warning' },
                    { lat: lat - 0.011, lng: lng + 0.009, color: 'accent' },
                ];

                nearbyMock.forEach(pt => {
                    L.marker([pt.lat, pt.lng], { icon: buildMarker(pt.color) })
                        .addTo(map)
                        .bindPopup('Nearby sighting (cluster)');
                });

                // Move attribution to bottom-left to avoid crowding actions
                map.attributionControl.setPrefix('');
            });
        }
    };

    WidgetRegistry.register(mapDefinition);
    return {};
})();
