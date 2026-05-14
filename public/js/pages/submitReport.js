/* ============================================================
   TERRA – submitReport.js
   Submit Wildlife Report — frame-GUI / tactical aesthetic.
   ============================================================ */

const SubmitReportPage = (() => {

  let _map = null;
  let _marker = null;

  const SENSITIVITY_OPTIONS = [
    { value: 1, label: 'Tier 1 – Public (General Sighting)' },
    { value: 2, label: 'Tier 2 – Protected (Validated Species)' },
    { value: 3, label: 'Tier 3 – Restricted (Endangered Species)' },
    { value: 4, label: 'Tier 4 – Confidential (Anti-Poaching)' },
  ];

  /* ── Frame ruler ─────────────────────────────────────────── */
  function ruler(label, ver) {
    return `
      <div class="sr-ruler">
        <div class="sr-ruler__tick"></div>
        <span class="sr-ruler__label">${label}</span>
        <div class="sr-ruler__track">
          <div class="sr-ruler__pip"></div>
          <div class="sr-ruler__pip"></div>
          <div class="sr-ruler__pip"></div>
        </div>
        <span class="sr-ruler__ver">${ver}</span>
      </div>`;
  }

  /* ── Form field helpers ──────────────────────────────────── */
  function field(id, label, inputHtml, hint = '') {
    return `
      <div class="sr-field" id="field-${id}">
        <label class="sr-label" for="${id}">${label}</label>
        ${inputHtml}
        ${hint ? `<span class="sr-hint">${hint}</span>` : ''}
        <span class="sr-field__error"></span>
      </div>`;
  }

  function input(id, name, type = 'text', placeholder = '', extra = '') {
    return `<input class="sr-input" id="${id}" name="${name}" type="${type}" placeholder="${placeholder}" ${extra} />`;
  }

  function select(id, name, options) {
    const opts = options.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    return `<select class="sr-select" id="${id}" name="${name}">${opts}</select>`;
  }

  function textarea(id, name, placeholder) {
    return `<textarea class="sr-textarea" id="${id}" name="${name}" placeholder="${placeholder}"></textarea>`;
  }

  /* ── Build full page HTML ────────────────────────────────── */
  function buildHTML() {
    return `
      <div id="sr-root">
        <div class="sr-page">

          ${ruler('FIELD REPORT INTAKE', 'SR-2.1')}

          <!-- HERO -->
          <div class="sr-hero reveal d1">
            <div class="sr-hero__body">
              <div class="sr-hero__left">
                <span class="sr-pill">New Report</span>
                <div class="sr-id-large">SUBMIT</div>
                <div class="sr-id-sub">Wildlife Intelligence Form</div>
              </div>
              <div class="sr-hero__right">
                <div></div>
                <p class="sr-hero__desc">
                  Document a wildlife sighting with species identification, GPS coordinates,
                  evidence media, and sensitivity classification. All fields marked
                  <span style="color:var(--sr-amber)">*</span> are required.
                </p>
              </div>
            </div>
          </div>

          <!-- FORM BODY -->
          <form id="sr-form" novalidate>
            <div class="sr-form-body">

              <!-- MAIN COLUMN -->
              <div class="sr-form-main">

                <!-- §1 Sighting Details -->
                <div class="sr-section reveal d1">
                  <div class="sr-section__head">
                    <span class="sr-section__num">01</span>
                    <span class="sr-section__title">Sighting Details</span>
                  </div>
                  <div class="sr-section__body">
                    <div class="sr-field--row">
                      ${field('species-id', 'Species ID or Name <span class="sr-label__req">*</span>',
                        `<input class="sr-input" id="species-id" name="species_id" type="text"
                          placeholder="Cheetah, Lion, or Registry UUID…" list="sr-species-list" required />
                         <datalist id="sr-species-list">
                           <option value="Cheetah"><option value="Lion">
                           <option value="Elephant"><option value="Rhinoceros"><option value="Leopard">
                         </datalist>`,
                        'Select a common name or paste a Registry UUID.'
                      )}
                      ${field('sensitivity-tier', 'Sensitivity Tier <span class="sr-label__req">*</span>',
                        select('sensitivity-tier', 'sensitivity_tier', SENSITIVITY_OPTIONS)
                      )}
                    </div>
                    ${field('description', 'Description <span class="sr-label__req">*</span>',
                      textarea('description', 'description', 'Describe behaviour, count, habitat conditions…'),
                      ''
                    )}
                    ${field('sighting-timestamp', 'Date & Time of Sighting <span class="sr-label__req">*</span>',
                      input('sighting-timestamp', 'sighting_timestamp', 'datetime-local', '', 'required')
                    )}
                  </div>
                </div>

                <!-- §2 Location -->
                <div class="sr-section reveal d2">
                  <div class="sr-section__head">
                    <span class="sr-section__num">02</span>
                    <span class="sr-section__title">Pin Location</span>
                  </div>
                  <div class="sr-section__body">
                    <div class="sr-map-search">
                      <input type="text" id="sr-map-search-input" class="sr-input"
                        placeholder="Search — Maasai Mara, Nairobi…" autocomplete="off" />
                      <div id="sr-map-results" class="sr-map-results"></div>
                    </div>
                    <div class="sr-map-wrap">
                      <div id="sr-map"></div>
                      <button type="button" class="sr-map-gps" id="sr-btn-gps">USE GPS</button>
                    </div>
                    <div class="sr-coord-row">
                      ${field('latitude', 'Latitude <span class="sr-label__req">*</span>',
                        input('latitude', 'latitude', 'number', '-1.2921', 'step="any" required')
                      )}
                      ${field('longitude', 'Longitude <span class="sr-label__req">*</span>',
                        input('longitude', 'longitude', 'number', '36.8219', 'step="any" required')
                      )}
                    </div>
                    ${field('region-id', 'Region ID <span class="sr-label__req">*</span>',
                      input('region-id', 'region_id', 'text', 'Auto-populated from coordinates', 'required'),
                      'Derived from coordinates via reverse geocoding'
                    )}
                  </div>
                </div>

                <!-- §3 Evidence -->
                <div class="sr-section reveal d3">
                  <div class="sr-section__head">
                    <span class="sr-section__num">03</span>
                    <span class="sr-section__title">Attach Evidence</span>
                    <span style="margin-left:auto;font-size:9px;color:var(--sr-dim);">PHOTO / AUDIO · MAX 10 MB</span>
                  </div>
                  <div class="sr-section__body">
                    <div class="sr-drop" id="sr-drop">
                      <div class="sr-drop__icon">DRAG &amp; DROP</div>
                      <p class="sr-drop__text">Drop a photo or audio file here, or <strong>browse files</strong></p>
                      <input type="file" id="sr-media-input" name="media"
                        accept="image/*,audio/*" style="display:none" />
                    </div>
                    <div class="sr-file-preview" id="sr-file-preview">
                      Attached: <strong id="sr-file-name"></strong>
                    </div>
                  </div>
                </div>

              </div><!-- /sr-form-main -->

              <!-- ASIDE -->
              <div class="sr-form-aside">

                <!-- Sensitivity Reference -->
                <div class="sr-aside-panel reveal d2">
                  <div class="sr-aside-panel__head">
                    <div class="sr-aside-panel__head-dot"></div>
                    Sensitivity Reference
                  </div>
                  <div class="sr-aside-panel__body">
                    <div class="sr-tier-row">
                      <span class="sr-tier-badge sr-tier-badge--1">T1</span>
                      <span class="sr-tier-desc">Public — General sighting, no restrictions</span>
                    </div>
                    <div class="sr-tier-row">
                      <span class="sr-tier-badge sr-tier-badge--2">T2</span>
                      <span class="sr-tier-desc">Protected — Validated species, ranger access</span>
                    </div>
                    <div class="sr-tier-row">
                      <span class="sr-tier-badge sr-tier-badge--3">T3</span>
                      <span class="sr-tier-desc">Restricted — Endangered, limited disclosure</span>
                    </div>
                    <div class="sr-tier-row">
                      <span class="sr-tier-badge sr-tier-badge--4">T4</span>
                      <span class="sr-tier-desc">Confidential — Anti-poaching, encrypted</span>
                    </div>
                  </div>
                </div>

                <!-- Submission Info -->
                <div class="sr-aside-panel reveal d3">
                  <div class="sr-aside-panel__head">
                    <div class="sr-aside-panel__head-dot"></div>
                    Submission Info
                  </div>
                  <div class="sr-aside-panel__body">
                    <div class="sr-kv">
                      <div class="sr-kv__dot"></div>
                      <span class="sr-kv__label">Status</span>
                      <span class="sr-kv__val">PENDING REVIEW</span>
                    </div>
                    <div class="sr-kv">
                      <div class="sr-kv__dot"></div>
                      <span class="sr-kv__label">AI Scoring</span>
                      <span class="sr-kv__val">AUTO</span>
                    </div>
                    <div class="sr-kv">
                      <div class="sr-kv__dot"></div>
                      <span class="sr-kv__label">Validation</span>
                      <span class="sr-kv__val">QUEUED</span>
                    </div>
                    <div class="sr-kv">
                      <div class="sr-kv__dot"></div>
                      <span class="sr-kv__label">Encryption</span>
                      <span class="sr-kv__val" style="color:var(--sr-green)">AES-256</span>
                    </div>
                  </div>
                </div>

              </div><!-- /sr-form-aside -->
            </div><!-- /sr-form-body -->

            <!-- FOOTER -->
            <div class="sr-footer reveal d4">
              <span class="sr-footer__status" id="sr-status">Ready to submit</span>
              <div class="sr-footer__actions">
                <button type="button" class="sr-btn sr-btn--cancel" id="sr-btn-cancel">Cancel</button>
                <button type="submit"  class="sr-btn sr-btn--submit" id="sr-btn-submit">SUBMIT REPORT</button>
              </div>
            </div>
            <div class="sr-form-error" id="sr-form-error"></div>
          </form>

        </div>
      </div>`;
  }

  /* ── Public render ───────────────────────────────────────── */
  function render(container) {
    if (_map) { try { _map.remove(); } catch (_) {} _map = null; }

    container.innerHTML = buildHTML();

    requestAnimationFrame(() => {
      document.querySelectorAll('#sr-root .reveal').forEach(el => {
        setTimeout(() => el.classList.add('visible'), 60);
      });
    });

    initMap();
    attachListeners();
  }

  /* ── Map ─────────────────────────────────────────────────── */
  function initMap() {
    const defaultLat = -1.2921;
    const defaultLng = 36.8219;

    requestAnimationFrame(() => {
      if (typeof L === 'undefined') return;

      _map = L.map('sr-map').setView([defaultLat, defaultLng], 12);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CARTO',
        maxZoom: 19,
      }).addTo(_map);

      const icon = L.divIcon({
        className: '',
        html: `<div style="width:12px;height:12px;border:2px solid #c3ff00;border-radius:50%;background:rgba(195,255,0,0.2);box-shadow:0 0 6px rgba(195,255,0,0.5);"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });

      _marker = L.marker([defaultLat, defaultLng], { draggable: true, icon }).addTo(_map);
      _marker.on('moveend', e => { const p = e.target.getLatLng(); syncCoords(p.lat, p.lng); });
      _map.on('click', e => { const { lat, lng } = e.latlng; _marker.setLatLng([lat, lng]); syncCoords(lat, lng); });

      syncCoords(defaultLat, defaultLng);
    });
  }

  function syncCoords(lat, lng) {
    const latEl = document.getElementById('latitude');
    const lngEl = document.getElementById('longitude');
    if (latEl) latEl.value = lat.toFixed(6);
    if (lngEl) lngEl.value = lng.toFixed(6);
    reverseGeocode(lat, lng);
  }

  async function reverseGeocode(lat, lng) {
    const regionEl = document.getElementById('region-id');
    if (!regionEl) return;
    try {
      const res  = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`);
      const data = await res.json();
      if (data?.address) {
        const a = data.address;
        regionEl.value = a.county || a.region || a.state || a.city || 'Unknown Region';
      }
    } catch (_) {}
  }

  async function geocodeSearch(query) {
    const resultsEl = document.getElementById('sr-map-results');
    if (!resultsEl) return;
    if (!query || query.length < 3) { resultsEl.style.display = 'none'; return; }
    try {
      const res  = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`);
      const data = await res.json();
      if (data.length) {
        resultsEl.innerHTML = data.map(item =>
          `<div class="sr-map-result" data-lat="${item.lat}" data-lon="${item.lon}">${item.display_name}</div>`
        ).join('');
        resultsEl.style.display = 'block';
      } else {
        resultsEl.style.display = 'none';
      }
    } catch (_) {}
  }

  /* ── Listeners ───────────────────────────────────────────── */
  function attachListeners() {
    const form      = document.getElementById('sr-form');
    const drop      = document.getElementById('sr-drop');
    const mediaIn   = document.getElementById('sr-media-input');
    const searchIn  = document.getElementById('sr-map-search-input');
    const searchRes = document.getElementById('sr-map-results');
    const errorEl   = document.getElementById('sr-form-error');

    /* Search */
    let searchTimer;
    searchIn?.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => geocodeSearch(searchIn.value), 400);
    });
    searchRes?.addEventListener('click', e => {
      const item = e.target.closest('.sr-map-result');
      if (!item) return;
      const lat = parseFloat(item.dataset.lat);
      const lon = parseFloat(item.dataset.lon);
      _map?.setView([lat, lon], 14);
      _marker?.setLatLng([lat, lon]);
      syncCoords(lat, lon);
      searchIn.value = item.textContent.trim();
      searchRes.style.display = 'none';
    });
    document.addEventListener('click', e => {
      if (!searchIn?.contains(e.target) && !searchRes?.contains(e.target)) {
        if (searchRes) searchRes.style.display = 'none';
      }
    });

    /* Coord inputs → map */
    ['latitude', 'longitude'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        const lat = parseFloat(document.getElementById('latitude')?.value);
        const lng = parseFloat(document.getElementById('longitude')?.value);
        if (!isNaN(lat) && !isNaN(lng)) {
          _map?.setView([lat, lng]);
          _marker?.setLatLng([lat, lng]);
          reverseGeocode(lat, lng);
        }
      });
    });

    /* GPS */
    document.getElementById('sr-btn-gps')?.addEventListener('click', () => {
      if (!navigator.geolocation) { Toast.warning('Geolocation not supported.'); return; }
      navigator.geolocation.getCurrentPosition(
        pos => {
          const { latitude, longitude } = pos.coords;
          _map?.setView([latitude, longitude], 15);
          _marker?.setLatLng([latitude, longitude]);
          syncCoords(latitude, longitude);
          Toast.success('Location captured.');
        },
        () => Toast.error('Could not get location. Ensure GPS is enabled.')
      );
    });

    /* Drop zone */
    drop?.addEventListener('click', () => mediaIn?.click());
    drop?.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag-over'); });
    drop?.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
    drop?.addEventListener('drop', e => {
      e.preventDefault(); drop.classList.remove('drag-over');
      const file = e.dataTransfer?.files[0];
      if (file) showPreview(file, mediaIn);
    });
    mediaIn?.addEventListener('change', () => {
      if (mediaIn.files[0]) showPreview(mediaIn.files[0], mediaIn);
    });

    /* Cancel */
    document.getElementById('sr-btn-cancel')?.addEventListener('click', () => {
      Router.navigate('dashboard');
    });

    /* Submit */
    form?.addEventListener('submit', async e => {
      e.preventDefault();
      if (!validateForm()) return;
      await handleSubmit(form, errorEl);
    });
  }

  function showPreview(file, mediaIn) {
    const preview = document.getElementById('sr-file-preview');
    const nameEl  = document.getElementById('sr-file-name');
    const dt = new DataTransfer();
    dt.items.add(file);
    if (mediaIn) mediaIn.files = dt.files;
    if (nameEl)  nameEl.textContent = file.name;
    if (preview) preview.style.display = 'block';
  }

  /* ── Client-side validation ──────────────────────────────── */
  function validateForm() {
    const required = [
      { id: 'species-id',          msg: 'Species is required' },
      { id: 'sensitivity-tier',    msg: 'Select a sensitivity tier' },
      { id: 'description',         msg: 'Description is required' },
      { id: 'sighting-timestamp',  msg: 'Date and time are required' },
      { id: 'latitude',            msg: 'Latitude is required' },
      { id: 'longitude',           msg: 'Longitude is required' },
      { id: 'region-id',           msg: 'Region is required' },
    ];
    let valid = true;
    required.forEach(({ id, msg }) => {
      const el      = document.getElementById(id);
      const fieldEl = document.getElementById(`field-${id}`);
      const errEl   = fieldEl?.querySelector('.sr-field__error');
      const empty   = !el?.value?.trim();
      fieldEl?.classList.toggle('has-error', empty);
      if (errEl) errEl.textContent = empty ? msg : '';
      if (empty) valid = false;
    });
    return valid;
  }

  /* ── Submit ──────────────────────────────────────────────── */
  async function handleSubmit(form, errorEl) {
    const btn    = document.getElementById('sr-btn-submit');
    const status = document.getElementById('sr-status');

    btn.disabled = true;
    btn.textContent = 'Submitting…';
    if (status) status.textContent = 'Uploading…';
    if (errorEl) errorEl.style.display = 'none';

    try {
      const formData = new FormData(form);
      await API.postForm('/reports', formData);
      Toast.success('Report submitted successfully.');
      Router.navigate('my-reports');
    } catch (err) {
      const msg = err.message || 'Failed to submit report.';
      if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
      if (status)  status.textContent = 'Submission failed';
      Toast.error(msg);
    } finally {
      btn.disabled = false;
      btn.textContent = 'SUBMIT REPORT';
    }
  }

  return { render };
})();
