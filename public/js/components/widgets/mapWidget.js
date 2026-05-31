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

    /* ── Internal: build reticle icon (corner-bracket targeting box) ── */
    const RETICLE_COLORS = {
        brand:   { stroke: 'rgba(255,255,255,0.85)', fill: 'rgba(255,255,255,0.07)' },
        warning: { stroke: 'rgba(255,51,51,0.9)',    fill: 'rgba(255,40,40,0.09)'   },
        accent:  { stroke: 'rgba(0,255,136,0.9)',    fill: 'rgba(0,255,120,0.07)'   },
        report:  { stroke: 'rgba(102,204,255,0.9)',  fill: 'rgba(80,180,255,0.08)'  },
    };

    function buildMarker(colorClass = 'brand', size = 44) {
        const s = size;
        const h = s / 2;
        const pad = 2;
        const arm = s * 0.28;
        const t = s * 0.025;
        const c = RETICLE_COLORS[colorClass] || RETICLE_COLORS.brand;

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" style="display:block;overflow:visible">
  <rect x="${pad}" y="${pad}" width="${s - pad * 2}" height="${s - pad * 2}" fill="${c.fill}"/>
  <polyline points="${arm},${pad} ${pad},${pad} ${pad},${arm}" fill="none" stroke="${c.stroke}" stroke-width="${t}" stroke-linecap="square"/>
  <polyline points="${s - arm},${pad} ${s - pad},${pad} ${s - pad},${arm}" fill="none" stroke="${c.stroke}" stroke-width="${t}" stroke-linecap="square"/>
  <polyline points="${pad},${s - arm} ${pad},${s - pad} ${arm},${s - pad}" fill="none" stroke="${c.stroke}" stroke-width="${t}" stroke-linecap="square"/>
  <polyline points="${s - pad},${s - arm} ${s - pad},${s - pad} ${s - arm},${s - pad}" fill="none" stroke="${c.stroke}" stroke-width="${t}" stroke-linecap="square"/>
</svg>`;

        return L.divIcon({
            className: 'terra-reticle-icon',
            html: svg,
            iconSize: [s, s],
            iconAnchor: [h, h],
            popupAnchor: [h, 0],
        });
    }

    /* ── Definition ──────────────────────────────────────────── */
    const mapDefinition = {
        id: 'map-location',
        name: 'Geospatial Map',
        icon: 'MAP',
        desc: 'Interactive dark map showing the sighting location and observation radius.',
        defaultSpan: 8,
        flush: true,      // No body padding so map fills edge-to-edge
        extraClass: 'widget--map',  // Overrides uniform bento height for map

        render(container, report) {
            const lat = Number(report?.latitude ?? -1.2921);
            const lng = Number(report?.longitude ?? 36.8219);
            const uid = `map-${report?.report_id?.slice(0, 8) || Date.now()}`;

            container.innerHTML = `
        <div class="map-widget-container">
          <!-- Glassmorphic overlay badge -->
          <div class="map-overlay-badge">
            ◈ ${lat.toFixed(4)}, ${lng.toFixed(4)}
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
              <span style="font-family:'JetBrains Mono',monospace;font-size:0.7rem;letter-spacing:0.2em;color:rgba(255,255,255,0.2);">MAP//ERR</span>
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

                // Move attribution to bottom-left to avoid crowding actions
                map.attributionControl.setPrefix('');
            });
        }
    };

    WidgetRegistry.register(mapDefinition);
    return {};
})();
