/* ============================================================
   TERRA – submitReport.js
   Handles the "Submit Wildlife Report" form with an interactive
   map picker and geocoding search.
   ============================================================ */

const SubmitReportPage = (() => {

  let _map = null;
  let _marker = null;

  /* ── Field Configuration ─────────────────────────────────── */
  const SENSITIVITY_OPTIONS = [
    { value: 1, label: 'Tier 1 – Public (General Sighting)' },
    { value: 2, label: 'Tier 2 – Protected (Validated Species)' },
    { value: 3, label: 'Tier 3 – Restricted (Endangered Species)' },
    { value: 4, label: 'Tier 4 – Confidential (Anti-Poaching)' },
  ];

  /* ── Internal: build sensitivity dropdown options ─────────── */
  function buildSensitivityOptions() {
    return SENSITIVITY_OPTIONS.map(opt =>
      `<option value="${opt.value}">${opt.label}</option>`
    ).join('');
  }

  /* ── Public: render the report submission form ───────────── */
  function render(container) {
    container.innerHTML = `
      <div class="page-header anim-fade-in">
        <h1>Submit Wildlife Report</h1>
        <p>Report a sighting with location, image, and description.</p>
      </div>

      <form id="report-form" class="anim-fade-in-up" novalidate>

        <!-- Section: Species & Description -->
        <div class="card mb-6">
          <div class="card__header">
            <div class="card__title">Sighting Details</div>
          </div>

          <div class="grid-2" style="gap:var(--sp-5)">
            <div class="form-group">
              <label class="form-label" for="species-id">Species (ID or Name) <span class="required">*</span></label>
              <input class="form-input" id="species-id" name="species_id" type="text" placeholder="e.g. Cheetah, Lion, or UUID..." list="species-list" required />
              <datalist id="species-list">
                <option value="Cheetah">
                <option value="Lion">
                <option value="Elephant">
                <option value="Rhinoceros">
                <option value="Leopard">
              </datalist>
              <span class="form-hint">Select a common name or paste a Registry UUID. This field is now required to ensure accurate intelligence scoring.</span>
            </div>

            <div class="form-group">
              <label class="form-label" for="sensitivity-tier">
                Sensitivity Tier <span class="required">*</span>
              </label>
              <select class="form-select" id="sensitivity-tier" name="sensitivity_tier" required>
                ${buildSensitivityOptions()}
              </select>
            </div>
          </div>

          <div class="form-group mt-4">
            <label class="form-label" for="description">
              Description <span class="required">*</span>
            </label>
            <textarea class="form-textarea" id="description" name="description" placeholder="Describe the sighting: behaviour, count, habitat…" required></textarea>
          </div>

          <div class="form-group mt-4">
            <label class="form-label" for="sighting-timestamp">
              Date & Time of Sighting <span class="required">*</span>
            </label>
            <input class="form-input" id="sighting-timestamp" name="sighting_timestamp" type="datetime-local" required />
          </div>
        </div>

        <!-- Section: Location / Map Pin -->
        <div class="card mb-6">
          <div class="card__header">
            <div class="card__title">Pin Location</div>
            <div class="card__subtitle">Search for a place or click the map</div>
          </div>

          <!-- Location Search Bar -->
          <div class="map-search-container mb-4">
            <input type="text" id="map-search-input" class="form-input" placeholder="Search for a location (e.g. Maasai Mara, Nairobi…)" autocomplete="off" />
            <div id="map-search-results" class="map-search-results"></div>
          </div>

          <div class="map-picker" id="map-picker-container" style="height: 380px; position: relative;">
            <div id="submit-report-map" style="height: 100%; border-radius: var(--radius-lg);"></div>
            
            <!-- Floating controls on map -->
            <button type="button" class="btn btn--secondary btn--sm btn--floating" id="btn-use-gps" title="Use my current location">
              USE GPS
            </button>
          </div>

          <div class="map-picker__coords mt-4">
            <div class="form-group" style="flex:1;">
              <label class="form-label" for="latitude">Latitude <span class="required">*</span></label>
              <input class="form-input" type="number" id="latitude" name="latitude" placeholder="-1.2921" step="any" required />
            </div>
            <div class="form-group" style="flex:1;">
              <label class="form-label" for="longitude">Longitude <span class="required">*</span></label>
              <input class="form-input" type="number" id="longitude" name="longitude" placeholder="36.8219" step="any" required />
            </div>
          </div>

          <div class="form-group mt-4">
            <label class="form-label" for="region-id">
              Region ID <span class="required">*</span>
            </label>
            <input class="form-input" id="region-id" name="region_id" type="text" placeholder="Auto-populated from coordinates" required />
            <span class="form-hint">Derived from coordinates using reverse geocoding</span>
          </div>
        </div>

        <!-- Section: Media Upload -->
        <div class="card mb-6">
          <div class="card__header">
            <div class="card__title">Attach Evidence</div>
            <div class="card__subtitle">Photo or audio (max 10 MB)</div>
          </div>

          <div class="drop-zone" id="drop-zone">
            <div class="drop-zone__icon">::</div>
            <p class="drop-zone__text">Drag & drop a photo/audio, or <strong>browse files</strong></p>
            <input type="file" id="media-input" name="media" accept="image/*,audio/*" style="display:none" />
          </div>
          <div id="file-preview" style="margin-top:var(--sp-4);display:none">
            <p class="text-muted" style="font-size:var(--text-sm)">Selected: <strong id="file-name"></strong></p>
          </div>
        </div>

        <!-- Form Actions -->
        <div style="display:flex;gap:var(--sp-4);justify-content:flex-end;">
          <button type="button" class="btn btn--secondary" id="btn-cancel-report">Cancel</button>
          <button type="submit" class="btn btn--primary" id="btn-submit-report">SUBMIT REPORT</button>
        </div>

        <p id="form-error-msg" class="form-error" style="text-align:right;margin-top:var(--sp-2);display:none"></p>
      </form>
    `;

    attachFormListeners();
    initMap();
  }

  /* ── Internal: Initialize Leaflet Map ────────────────────── */
  function initMap() {
    const defaultLat = -1.2921;
    const defaultLng = 36.8219;

    requestAnimationFrame(() => {
      if (typeof L === 'undefined') {
        console.error('Leaflet.js not found');
        return;
      }

      _map = L.map('submit-report-map').setView([defaultLat, defaultLng], 12);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
        maxZoom: 19
      }).addTo(_map);

      // Custom glowing marker icon (same as mapWidget.js style)
      const icon = L.divIcon({
        className: '',
        html: `<div class="map-pin map-pin--brand" style="width:20px;height:20px;"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });

      _marker = L.marker([defaultLat, defaultLng], {
        draggable: true,
        icon: icon
      }).addTo(_map);

      // Sync marker to inputs
      _marker.on('moveend', (e) => {
        const pos = e.target.getLatLng();
        updateCoords(pos.lat, pos.lng);
      });

      // Map click to move marker
      _map.on('click', (e) => {
        const { lat, lng } = e.latlng;
        _marker.setLatLng([lat, lng]);
        updateCoords(lat, lng);
      });

      // Set initial coords
      updateCoords(defaultLat, defaultLng);
    });
  }

  /* ── Internal: Sync coordinates to inputs ────────────────── */
  function updateCoords(lat, lng) {
    document.getElementById('latitude').value = lat.toFixed(6);
    document.getElementById('longitude').value = lng.toFixed(6);

    // Reverse geocode to get a region name (placeholder for now)
    reverseGeocode(lat, lng);
  }

  /* ── Internal: Reverse Geocoding ─────────────────────────── */
  async function reverseGeocode(lat, lng) {
    const regionInput = document.getElementById('region-id');
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`);
      const data = await res.json();
      if (data && data.display_name) {
        // Try to extract a useful part (city/county/region)
        const parts = data.address;
        const region = parts.county || parts.region || parts.state || parts.city || 'Unknown Region';
        regionInput.value = region;
      }
    } catch (err) {
      console.warn('Reverse geocoding failed', err);
    }
  }

  /* ── Internal: Geocoding Search ──────────────────────────── */
  async function searchLocation(query) {
    const resultsEl = document.getElementById('map-search-results');
    if (!query || query.length < 3) {
      resultsEl.style.display = 'none';
      return;
    }

    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`);
      const data = await res.json();

      if (data.length > 0) {
        resultsEl.innerHTML = data.map(item => `
                    <div class="map-search-item" data-lat="${item.lat}" data-lon="${item.lon}">
                        ${item.display_name}
                    </div>
                `).join('');
        resultsEl.style.display = 'block';
      } else {
        resultsEl.style.display = 'none';
      }
    } catch (err) {
      console.error('Search failed', err);
    }
  }

  /* ── Internal: wire up all form interactions ─────────────── */
  function attachFormListeners() {
    const form = document.getElementById('report-form');
    const dropZone = document.getElementById('drop-zone');
    const mediaInput = document.getElementById('media-input');
    const errorMsg = document.getElementById('form-error-msg');
    const searchInput = document.getElementById('map-search-input');
    const searchResults = document.getElementById('map-search-results');

    // Geocoding Search
    let searchTimeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => searchLocation(searchInput.value), 400);
    });

    searchResults.addEventListener('click', (e) => {
      const item = e.target.closest('.map-search-item');
      if (item) {
        const lat = parseFloat(item.dataset.lat);
        const lon = parseFloat(item.dataset.lon);

        _map.setView([lat, lon], 14);
        _marker.setLatLng([lat, lon]);
        updateCoords(lat, lon);

        searchInput.value = item.textContent.trim();
        searchResults.style.display = 'none';
      }
    });

    // Hide search results if clicking outside
    document.addEventListener('click', (e) => {
      if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
        searchResults.style.display = 'none';
      }
    });

    // Coord inputs change -> update map
    ['latitude', 'longitude'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => {
        const lat = parseFloat(document.getElementById('latitude').value);
        const lng = parseFloat(document.getElementById('longitude').value);
        if (!isNaN(lat) && !isNaN(lng)) {
          _map.setView([lat, lng]);
          _marker.setLatLng([lat, lng]);
          reverseGeocode(lat, lng);
        }
      });
    });

    // File drop zone
    dropZone.addEventListener('click', () => mediaInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer?.files[0];
      if (file) showFilePreview(file);
    });
    mediaInput.addEventListener('change', () => {
      const file = mediaInput.files[0];
      if (file) showFilePreview(file);
    });

    // GPS location button
    document.getElementById('btn-use-gps')?.addEventListener('click', () => {
      if (!navigator.geolocation) {
        Toast.warning('Geolocation not supported by your browser.');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          _map.setView([latitude, longitude], 15);
          _marker.setLatLng([latitude, longitude]);
          updateCoords(latitude, longitude);
          Toast.success('Location captured successfully!');
        },
        () => Toast.error('Could not get location. Ensure GPS is enabled.')
      );
    });

    // Form buttons
    document.getElementById('btn-cancel-report')?.addEventListener('click', () => {
      Router.navigate('dashboard');
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleSubmit(form, errorMsg);
    });
  }

  function showFilePreview(file) {
    const filePreview = document.getElementById('file-preview');
    const fileNameEl = document.getElementById('file-name');
    const mediaInput = document.getElementById('media-input');
    const dt = new DataTransfer();
    dt.items.add(file);
    mediaInput.files = dt.files;
    fileNameEl.textContent = file.name;
    filePreview.style.display = 'block';
  }

  async function handleSubmit(form, errorMsg) {
    const btn = document.getElementById('btn-submit-report');
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    errorMsg.style.display = 'none';

    try {
      const formData = new FormData(form);
      await API.postForm('/reports', formData);
      Toast.success('Report submitted successfully!');
      Router.navigate('my-reports');
    } catch (err) {
      errorMsg.textContent = err.message || 'Failed to submit report.';
      errorMsg.style.display = 'block';
      Toast.error(err.message || 'Submission failed.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'SUBMIT REPORT';
    }
  }

  return { render };
})();
