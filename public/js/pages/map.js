/* ============================================================
   TERRA – map.js   Ops Console / Threat Console
   Full-viewport tactical dashboard. Mounts into #page-content,
   zeroes its padding on mount and restores it on teardown.
   Navigation: Router.navigate('map')
   ============================================================ */

const MapPage = (() => {

  /* ── Mock data ───────────────────────────────────────────── */
  const MARKERS = [
    { id: 'ranger-1', kind: 'ranger', x: 31, y: 45, label: 'Adwoa K.', lat: -1.2740, lng: 36.8812 },
    { id: 'ranger-2', kind: 'ranger', x: 38, y: 63, label: 'Kofi M.', lat: -1.2880, lng: 36.8864 },
    { id: 'ranger-3', kind: 'ranger', x: 65, y: 37, label: 'Linnet O.', lat: -1.2540, lng: 36.9040 },
    { id: 'ranger-4', kind: 'ranger', x: 45, y: 40, label: 'Boateng S.', lat: -1.2600, lng: 36.8900 },
    { id: 'ranger-5', kind: 'ranger', x: 85, y: 45, label: 'Adjei P.', lat: -1.2700, lng: 36.9200 },
    { id: 'sensor-1', kind: 'sensor', x: 23, y: 25, label: 'Acoustic 14', lat: -1.2510, lng: 36.8720 },
    { id: 'sensor-2', kind: 'sensor', x: 71, y: 71, label: 'Acoustic 09', lat: -1.3040, lng: 36.9090 },
    { id: 'sensor-3', kind: 'sensor', x: 85, y: 45, label: 'Camera 03', lat: -1.2700, lng: 36.9200 },
    { id: 'sensor-4', kind: 'sensor', x: 35, y: 55, label: 'LoRa Node 7', lat: -1.2800, lng: 36.8780 },
    { id: 'ranger-6', kind: 'ranger', x: 50, y: 50, label: 'Nia Z.', lat: -1.2921, lng: 36.8380 },
    { id: 'sensor-5', kind: 'sensor', x: 52, y: 55, label: 'Satellite Link 1', lat: -1.2950, lng: 36.8400 },
    { id: 'command-1', kind: 'command', x: 50, y: 79, label: 'Base Karoo', lat: -1.3180, lng: 36.8950 },
    { id: 'threat-1', kind: 'threat', x: 58, y: 78, label: 'T-1', lat: -1.3140, lng: 36.8975 },
    { id: 'ts-threat-1', kind: 'threat', x: 15, y: 25, label: 'T-3', lat: -1.2650, lng: 36.8420 },
    { id: 'ts-report-1', kind: 'caution', x: 20, y: 65, label: 'R-1', lat: -1.2950, lng: 36.8560 },
  ];

  const ALL_ALERTS = [
    { id: 'threat-1', kind: 'alert', sector: 'SECTOR 21A', time: '02:14', title: 'Poaching Activity', conf: '0.92', source: 'acoustic array 09' },
    { id: 'ts-threat-1', kind: 'alert', sector: 'SECTOR 17B', time: '04:10', title: 'Wildfire Cluster', conf: '0.98', source: 'satellite imagery' },
    { id: 'ts-report-1', kind: 'warn', sector: 'SECTOR 17B', time: '05:45', title: 'Elephant Sighting', conf: '0.85', source: 'field report' },
  ];

  const RANGERS = [
    { id: 'ranger-1', name: 'Adwoa K.', sector: '17B', lastPing: '04:21', status: 'go', label: 'On patrol' },
    { id: 'ranger-2', name: 'Kofi M.', sector: '17B', lastPing: '04:18', status: 'go', label: 'On patrol' },
    { id: 'ranger-3', name: 'Linnet O.', sector: '21A', lastPing: '03:49', status: 'warn', label: 'Caution' },
    { id: 'ranger-4', name: 'Boateng S.', sector: '21A', lastPing: '02:14', status: 'alert', label: 'Lost signal' },
    { id: 'ranger-5', name: 'Adjei P.', sector: '09C', lastPing: '04:20', status: 'idle', label: 'Standing by' },
    { id: 'ranger-6', name: 'Nia Z.', sector: '17B', lastPing: 'NOW', status: 'go', label: 'On patrol' },
  ];

  const SENSORS = [
    { id: 'sensor-1', name: 'Acoustic 14', type: 'Acoustic Array', sector: '7B', status: 'online', battery: '78%', lastSync: '04:20:12', lat: -1.2510, lng: 36.8720 },
    { id: 'sensor-2', name: 'Acoustic 09', type: 'Acoustic Array', sector: '21A', status: 'online', battery: '62%', lastSync: '04:19:44', lat: -1.3040, lng: 36.9090 },
    { id: 'sensor-3', name: 'Camera 03', type: 'Camera Trap', sector: '09C', status: 'offline', battery: '12%', lastSync: '01:04:22', lat: -1.2700, lng: 36.9200 },
    { id: 'sensor-4', name: 'LoRa Node 7', type: 'LoRa Gateway', sector: '17B', status: 'online', battery: '91%', lastSync: '04:21:00', lat: -1.2800, lng: 36.8780 },
    { id: 'sensor-5', name: 'Satellite Link 1', type: 'VSAT Station', sector: '17B', status: 'online', battery: '100%', lastSync: 'NOW', lat: -1.2950, lng: 36.8400 },
  ];

  /* ── Inner nav tabs ──────────────────────────────────────── */
  const INNER_NAV = [
    { id: 'live-map', label: 'Live Map', icon: '◉' },
    { id: 'alerts', label: 'Alerts', icon: '⚑' },
    { id: 'roster', label: 'Roster', icon: '≡' },
    { id: 'sensors', label: 'Sensors', icon: '◈' },
    { id: 'drone', label: 'Drone Feed', icon: '⟳' },
    { id: 'help', label: 'Help', icon: '?' },
  ];

  const DRAWER_COLLAPSED_KEY = 'terra_ops_drawer_collapsed';

  /* ── State ───────────────────────────────────────────────── */
  let state = {
    ackedIds: [],
    selectedMarkerId: 'threat-1',
    selectedRangerId: null,
    selectedAlertId: 'threat-1',
    callout: null,   // { markerId, x, y } — callout anchor
    activeTab: 'live-map',
    utcTime: '--:--:--',
    drawerCollapsed: localStorage.getItem(DRAWER_COLLAPSED_KEY) === '1',
  };

  let _clockId = null;
  let _container = null;

  /* ── Derived ─────────────────────────────────────────────── */
  function activeAlerts() {
    return ALL_ALERTS.filter(a => !state.ackedIds.includes(a.id));
  }

  function resolveEntity(markerId) {
    const id = markerId || state.selectedMarkerId;
    if (!id) return null;

    const m = MARKERS.find(x => x.id === id);
    if (!m) return null;

    if (m.kind === 'threat' || m.kind === 'caution') {
      const alert = ALL_ALERTS.find(a => a.id === m.id);
      const isHot = m.kind === 'threat';
      const name = alert ? alert.title : (isHot ? 'Threat' : 'Caution');
      const sector = alert ? alert.sector : 'Unknown';
      const conf = alert ? alert.conf : (isHot ? '0.85' : '0.60');
      const source = alert ? alert.source : 'System';
      const time = alert ? alert.time : '00:00';

      return {
        kind: 'threat',
        marker: m,
        name: `${name} · ${sector}`,
        fields: [
          ['Confidence', conf],
          ['Source', source],
          ['Sector', sector],
          ['Coords', `${m.lat}, ${m.lng}`],
          ['Detected', `${time} UTC`],
        ],
        detail: alert && alert.title.includes('Wildfire')
          ? 'Thermal anomaly detected via satellite. Spread rate: 2.4 hectares/hr. Wind direction: NE. Critical habitat proximity: 1.2km.'
          : 'Suspicious acoustic signature detected. Possible unauthorized entry or poaching activity. Pattern matches prior incursions.',
      };
    }
    if (m.kind === 'ranger') {
      const r = RANGERS.find(x => x.id === m.id);
      return {
        kind: 'ranger',
        marker: m,
        name: r ? r.name : m.label,
        fields: [
          ['Operator', r ? r.name : m.label],
          ['Sector', r ? r.sector : '—'],
          ['Last ping', r ? r.lastPing : '—'],
          ['Status', r ? r.label : '—'],
          ['Coords', `${m.lat}, ${m.lng}`],
        ],
      };
    }
    if (m.kind === 'sensor') {
      const s = SENSORS.find(x => x.id === m.id);
      return {
        kind: 'sensor',
        marker: m,
        name: m.label,
        fields: [
          ['Type', s ? s.type : 'Acoustic'],
          ['Status', s ? s.status : 'Online'],
          ['Battery', s ? s.battery : '—'],
          ['Last sync', s ? s.lastSync : '—'],
          ['Coords', `${m.lat}, ${m.lng}`],
        ],
      };
    }
    return {
      kind: 'asset',
      marker: m,
      name: m.label,
      fields: [
        ['Type', 'Command Base'],
        ['Status', 'Active'],
        ['Coords', `${m.lat}, ${m.lng}`],
        ['Sector', 'Central'],
      ],
    };
  }

  /* ── Clock ───────────────────────────────────────────────── */
  function tickClock() {
    const d = new Date();
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    state.utcTime = `${hh}:${mm}:${ss}`;
    const el = document.getElementById('ops-utc-clock');
    if (el) el.textContent = `UTC ${state.utcTime}`;
    const badge = document.getElementById('ops-alert-badge');
    if (badge) {
      const n = activeAlerts().length;
      badge.textContent = n;
      badge.style.display = n > 0 ? '' : 'none';
    }
  }

  /* ═══════════════════════════════════════════════════════════
     HTML BUILDERS
  ═══════════════════════════════════════════════════════════ */

  /* ── Topbar strip ────────────────────────────────────────── */
  function buildTopbarStrip(alerts) {
    return `
        <div class="ops-topbar-strip">
          <span class="ops-live-dot"></span>
          <span>LIVE · GRID 17B</span>
          <span class="ops-topbar-sep">·</span>
          <span style="color:var(--clr-text-dim)">SECTOR 7B · NORTH RIDGE</span>
          <span class="ops-topbar-sep">·</span>
          <span id="ops-utc-clock" style="font-variant-numeric:tabular-nums">UTC --:--:--</span>
          <span class="ops-topbar-sep" style="margin-left:4px">·</span>
          <span class="ops-badge-wrap">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:middle">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <span class="ops-alert-badge" id="ops-alert-badge" style="display:${alerts.length > 0 ? '' : 'none'}">${alerts.length}</span>
          </span>
        </div>`;
  }

  /* ── Inner sidebar nav ───────────────────────────────────── */
  function buildInnerNav() {
    const items = INNER_NAV.map(tab => `
          <button class="ops-nav__item ${state.activeTab === tab.id ? 'is-active' : ''}"
                  data-tab="${tab.id}" title="${tab.label}">
            <span class="ops-nav__icon">${tab.icon}</span>
            <span class="ops-nav__label">${tab.label}</span>
          </button>`).join('');
    return `<nav class="ops-nav">${items}</nav>`;
  }

  /* ── Alert panel ─────────────────────────────────────────── */
  function buildAlertPanel(alerts) {
    const rows = alerts.length > 0 ? alerts.map(a => `
          <li class="ops-alert-row ops-alert-row--${a.kind} ${state.selectedAlertId === a.id ? 'is-selected' : ''}"
              data-alert-id="${a.id}" role="button" tabindex="0">
            <span class="ops-alert-pulse ops-alert-pulse--${a.kind}"></span>
            <div>
              <div class="ops-alert-eyebrow">${a.kind === 'alert' ? 'HOSTILE' : 'CAUTION'} · ${a.sector} · ${a.time}</div>
              <div class="ops-alert-title">${a.title}</div>
              <div class="ops-alert-meta">conf ${a.conf} · ${a.source}</div>
            </div>
            <button class="ops-ack-btn" data-ack-id="${a.id}">Ack</button>
          </li>`).join('')
      : `<li class="ops-empty">No active threats. Last clear: 04:21.</li>`;

    return `
        <div class="ops-tab-panel" data-panel="alerts">
          <header class="ops-panel__head">
            <span class="ops-eyebrow">Active threats</span>
            <span class="ops-count">${alerts.length}</span>
          </header>
          <ul class="ops-alert-list">${rows}</ul>
        </div>`;
  }

  /* ── Roster panel ────────────────────────────────────────── */
  function buildRosterPanel() {
    const rows = RANGERS.map(r => `
          <li class="ops-roster-row ${state.selectedRangerId === r.id ? 'is-selected' : ''}"
              data-ranger-id="${r.id}" role="button" tabindex="0">
            <span class="ops-status-dot ops-status-dot--${r.status}"></span>
            <div>
              <div class="ops-roster-name">${r.name}</div>
              <div class="ops-roster-meta">${r.sector} · last ping ${r.lastPing}</div>
            </div>
            <span class="ops-chip ops-chip--${r.status}">${r.label}</span>
          </li>`).join('');

    return `
        <div class="ops-tab-panel" data-panel="roster">
          <header class="ops-panel__head">
            <span class="ops-eyebrow">Rangers · on duty</span>
            <span class="ops-count">${RANGERS.length}</span>
          </header>
          <ul class="ops-roster-list">${rows}</ul>
        </div>`;
  }

  /* ── Sensors panel ───────────────────────────────────────── */
  function buildSensorsPanel() {
    const rows = SENSORS.map(s => `
          <li class="ops-sensor-row ops-sensor-row--${s.status}">
            <span class="ops-status-dot ops-status-dot--${s.status === 'online' ? 'go' : 'alert'}"></span>
            <div>
              <div class="ops-roster-name">${s.name}</div>
              <div class="ops-roster-meta">${s.type} · ${s.sector} · ${s.lastSync}</div>
            </div>
            <div class="ops-sensor-right">
              <div class="ops-sensor-battery">
                <span class="ops-sensor-battery__bar" style="width:${parseInt(s.battery)}%"></span>
              </div>
              <span class="ops-chip ops-chip--${s.status === 'online' ? 'go' : 'alert'}">${s.status}</span>
            </div>
          </li>`).join('');

    return `
        <div class="ops-tab-panel" data-panel="sensors">
          <header class="ops-panel__head">
            <span class="ops-eyebrow">Sensors · network</span>
            <span class="ops-count">${SENSORS.length}</span>
          </header>
          <ul class="ops-sensor-list">${rows}</ul>
        </div>`;
  }

  /* ── Drone feed panel ────────────────────────────────────── */
  function buildDronePanel() {
    return `
        <div class="ops-tab-panel ops-tab-panel--drone" data-panel="drone">
          <header class="ops-panel__head">
            <span class="ops-eyebrow">Drone Feed</span>
            <span class="ops-chip ops-chip--alert">No Signal</span>
          </header>
          <div class="ops-drone-empty">
            <div class="ops-drone-empty__icon">⟳</div>
            <div class="ops-eyebrow" style="margin-bottom:6px">No active drone</div>
            <p style="font-size:11.5px;color:var(--clr-text-dim);line-height:1.5;margin:0">
              Deploy a drone unit from the roster to stream live telemetry here.
            </p>
          </div>
        </div>`;
  }

  /* ── Help panel ──────────────────────────────────────────── */
  function buildHelpPanel() {
    const items = [
      ['Click a marker', 'Open callout overlay with entity detail'],
      ['Click alert row', 'Jump to marker and open callout'],
      ['Ack button', 'Acknowledge alert and dismiss marker pulse'],
      ['Roster row', 'Select ranger and open callout on map'],
      ['ESC', 'Dismiss active callout'],
      ['Callout → Deploy', 'Acknowledge threat and assign ranger team'],
    ];
    return `
        <div class="ops-tab-panel" data-panel="help">
          <header class="ops-panel__head">
            <span class="ops-eyebrow">Help · keyboard &amp; interactions</span>
          </header>
          <ul class="ops-help-list">
            ${items.map(([k, v]) => `
            <li class="ops-help-row">
              <span class="ops-help-key">${k}</span>
              <span class="ops-help-val">${v}</span>
            </li>`).join('')}
          </ul>
        </div>`;
  }

  /* ── Map canvas ──────────────────────────────────────────── */
  function buildMap() {
    return `
        <div class="ops-map-bg">
          <div class="ops-map-scanline"></div>
          <div class="ops-map-grid"></div>

          <!-- Main SVG layer: topo contours + scan diagonal + radar -->
          <svg class="ops-map-svg" viewBox="0 0 1000 700" preserveAspectRatio="none">
            <!-- Topographic contour lines (monochrome, very dim) -->
            <g fill="none" stroke="rgba(255,255,255,0.055)" stroke-width="0.8">
              <path d="M0,580 C80,560 160,610 240,580 C320,548 400,600 480,565 C560,530 640,575 720,545 C800,515 880,555 1000,530"/>
              <path d="M0,540 C80,515 160,565 250,530 C340,495 420,545 500,510 C580,475 660,520 740,490 C820,460 900,500 1000,475"/>
              <path d="M0,500 C90,470 180,520 270,484 C360,448 440,498 520,462 C600,426 680,470 760,440 C840,410 920,450 1000,420"/>
              <path d="M0,460 C95,428 190,478 285,440 C380,402 460,448 540,415 C620,382 700,424 780,392 C860,360 940,402 1000,374"/>
              <path d="M0,420 C100,385 200,432 300,395 C400,358 480,402 560,368 C640,334 720,378 800,344 C880,310 960,352 1000,326"/>
              <path d="M0,380 C110,342 210,390 315,352 C420,314 500,360 580,324 C660,288 740,332 820,296 C900,260 970,302 1000,280"/>
              <path d="M0,340 C120,298 220,348 330,308 C440,268 520,316 600,278 C680,240 760,286 840,248 C920,210 980,250 1000,232"/>
              <path d="M0,300 C130,256 230,308 345,265 C460,222 540,272 620,232 C700,192 780,240 860,200 C940,160 990,198 1000,184"/>
              <!-- Upper region contours -->
              <path d="M0,260 C140,212 250,268 365,222 C480,176 560,228 640,186 C720,144 800,194 875,152 C950,110 990,146 1000,136"/>
              <path d="M0,220 C150,168 260,228 380,180 C500,132 580,184 660,140 C740,96 818,148 890,104 C962,60 995,96 1000,88"/>
            </g>

            <!-- Dashed survey / path line -->
            <g fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="0.6" stroke-dasharray="4 6">
              <path d="M0,620 C150,590 280,540 420,500 C560,460 680,430 820,400 C880,385 950,370 1000,358"/>
            </g>

            <!-- Diagonal scan line (like reference image top frame) -->
            <line x1="0" y1="0"    x2="1000" y2="700" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
            <line x1="120" y1="0"  x2="1000" y2="620" stroke="rgba(255,255,255,0.025)" stroke-width="0.6"/>

            <!-- Radar circle (right side) — matches reference circular reticle -->
            <g transform="translate(830,350)">
              <!-- Outer ring -->
              <circle cx="0" cy="0" r="200" fill="none" stroke="rgba(255,255,255,0.09)" stroke-width="0.6"/>
              <!-- Mid rings -->
              <circle cx="0" cy="0" r="150" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="0.5"/>
              <circle cx="0" cy="0" r="100" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="0.5"/>
              <circle cx="0" cy="0" r="50"  fill="none" stroke="rgba(255,255,255,0.09)" stroke-width="0.5"/>
              <!-- Cross hairs -->
              <line x1="-210" y1="0" x2="210" y2="0" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>
              <line x1="0" y1="-210" x2="0" y2="210" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>
              <!-- Diagonal cross hairs (45°) -->
              <line x1="-148" y1="-148" x2="148" y2="148" stroke="rgba(255,255,255,0.04)" stroke-width="0.4"/>
              <line x1="148" y1="-148" x2="-148" y2="148" stroke="rgba(255,255,255,0.04)" stroke-width="0.4"/>
              <!-- Tick marks around outer ring -->
              <g stroke="rgba(255,255,255,0.18)" stroke-width="0.6">
                <line x1="0" y1="-200" x2="0" y2="-192"/>
                <line x1="0" y1="200"  x2="0" y2="192"/>
                <line x1="-200" y1="0" x2="-192" y2="0"/>
                <line x1="200" y1="0"  x2="192" y2="0"/>
              </g>
              <!-- Small corner bracket at top-right of radar -->
              <polyline points="20,-180 30,-180 30,-170" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="0.8"/>
              <!-- Range label -->
              <text x="6" y="-158" font-family="JetBrains Mono,monospace" font-size="8" fill="rgba(255,255,255,0.25)" letter-spacing="0.1em">200</text>
              <!-- Sweep line (static, ~40°) -->
              <line x1="0" y1="0" x2="153" y2="-129" stroke="rgba(255,255,255,0.12)" stroke-width="0.6"/>
            </g>

            <!-- Corner bracket frame marks (reference: small squares at corners) -->
            <g fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="0.7">
              <!-- TL -->
              <polyline points="8,20 8,8 20,8"/>
              <!-- TR -->
              <polyline points="980,8 992,8 992,20"/>
              <!-- BL -->
              <polyline points="8,680 8,692 20,692"/>
              <!-- BR -->
              <polyline points="980,692 992,692 992,680"/>
            </g>

            <!-- Small square dots at mid-edges (reference image decorative nodes) -->
            <g fill="rgba(255,255,255,0.3)">
              <rect x="498" y="4"   width="4" height="4"/>
              <rect x="498" y="692" width="4" height="4"/>
              <rect x="4"   y="348" width="4" height="4"/>
              <rect x="992" y="348" width="4" height="4"/>
            </g>
          </svg>

          <!-- Corner data labels (reference: small text in corners / edges) -->
          <span class="ops-map-coord ops-map-coord--tl">36M VC 11320 67890</span>
          <span class="ops-map-coord ops-map-coord--tr">SAT · LOCK</span>
          <span class="ops-map-coord ops-map-coord--bl">FRAC · 0.10969</span>
          <span class="ops-map-coord ops-map-coord--br">GRID 17B · 1000M</span>

          <!-- Sector watermark -->
          <div class="ops-map-sector-label">[ SECTOR 17B ]</div>

          <!-- Scale bar -->
          <div class="ops-map-scale">
            <span class="ops-map-scale__bar"></span>
            <span class="ops-map-scale__lbl">2 km</span>
          </div>

          <div class="ops-reticle-layer" id="ops-reticle-layer"></div>
        </div>`;
  }

  /* ── Reticle marker system (from reticle-preview design) ─── */
  const _RETICLE_NS = 'http://www.w3.org/2000/svg';

  const _MARKER_META = {
    ranger:  { bracket: 'rgba(255,255,255,0.7)', bar: 'rgba(255,255,255,0.5)', fill: 'rgba(255,255,255,0.03)', titleColor: 'rgba(255,255,255,0.85)' },
    sensor:  { bracket: 'rgba(255,255,255,0.55)', bar: 'rgba(255,255,255,0.4)', fill: 'rgba(255,255,255,0.025)', titleColor: 'rgba(255,255,255,0.7)' },
    command: { bracket: 'rgba(255,255,255,0.5)', bar: 'rgba(255,255,255,0.35)', fill: 'rgba(255,255,255,0.02)', titleColor: 'rgba(255,255,255,0.65)' },
    threat:  { bracket: 'rgba(255,50,50,0.9)',  bar: 'rgba(255,50,50,0.75)',  fill: 'rgba(255,30,30,0.07)',  titleColor: 'rgba(255,80,80,0.95)' },
    caution: { bracket: 'rgba(210,140,0,0.85)', bar: 'rgba(200,130,0,0.7)',  fill: 'rgba(200,120,0,0.06)', titleColor: 'rgba(220,155,0,0.9)' },
  };

  function _makeReticleSVG(meta) {
    const svg = document.createElementNS(_RETICLE_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 130 120');
    svg.setAttribute('width', '52');
    svg.setAttribute('height', '48');

    const fillBox = document.createElementNS(_RETICLE_NS, 'rect');
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
      const pl = document.createElementNS(_RETICLE_NS, 'polyline');
      pl.setAttribute('stroke', meta.bracket);
      pl.setAttribute('stroke-width', '2');
      pl.setAttribute('fill', 'none');
      pl.setAttribute('points', c.points);
      pl.setAttribute('opacity', '0');
      pl.classList.add('corner', c.cls);
      svg.appendChild(pl);
    });

    const track = document.createElementNS(_RETICLE_NS, 'rect');
    track.setAttribute('x', '116'); track.setAttribute('y', '10');
    track.setAttribute('width', '5'); track.setAttribute('height', '100');
    track.setAttribute('rx', '1');
    track.setAttribute('stroke', meta.bar);
    track.setAttribute('stroke-width', '0.8');
    track.setAttribute('fill', 'none');
    track.setAttribute('opacity', '0');
    track.classList.add('bar-track');
    svg.appendChild(track);

    const barFill = document.createElementNS(_RETICLE_NS, 'rect');
    barFill.setAttribute('x', '116'); barFill.setAttribute('y', '38');
    barFill.setAttribute('width', '5'); barFill.setAttribute('height', '72');
    barFill.setAttribute('rx', '1');
    barFill.setAttribute('fill', meta.bar);
    barFill.setAttribute('opacity', '0');
    barFill.classList.add('bar-fill');
    svg.appendChild(barFill);

    [35, 60, 85].forEach(ty => {
      const tick = document.createElementNS(_RETICLE_NS, 'line');
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

  function _flickerEl(el, finalOpacity, onDone) {
    let count = 0;
    const max = Math.floor(Math.random() * 2) + 2;
    function step() {
      el.setAttribute('opacity', count % 2 === 0 ? finalOpacity : '0');
      count++;
      if (count <= max * 2) setTimeout(step, 35 + Math.random() * 45);
      else { el.setAttribute('opacity', finalOpacity); if (onDone) onDone(); }
    }
    step();
  }

  function _animateReticle(svg) {
    const fillBox  = svg.querySelector('.fill-box');
    const tl       = svg.querySelector('.corner.tl');
    const br       = svg.querySelector('.corner.br');
    const tr       = svg.querySelector('.corner.tr');
    const bl       = svg.querySelector('.corner.bl');
    const barTrack = svg.querySelector('.bar-track');
    const barFill  = svg.querySelector('.bar-fill');
    const barTicks = svg.querySelectorAll('.bar-tick');

    setTimeout(() => fillBox.setAttribute('opacity', '1'), 80);
    const d = 320;
    setTimeout(() => _flickerEl(tl, '1'), d);
    setTimeout(() => _flickerEl(br, '1'), d + 160);
    setTimeout(() => _flickerEl(tr, '1'), d + 320);
    setTimeout(() => _flickerEl(bl, '1', () => {
      setTimeout(() => {
        _flickerEl(barTrack, '0.3');
        setTimeout(() => {
          barFill.setAttribute('opacity', '0.85');
          barTicks.forEach(t => t.setAttribute('opacity', '0.4'));
        }, 120);
      }, 120);
    }), d + 480);
  }

  function _makeReticleInfoPanel(m, meta) {
    const kindLabel = { ranger: 'RANGER', sensor: 'SENSOR', command: 'COMMAND', threat: 'THREAT DETECTED.', caution: 'CAUTION' };
    const panel = document.createElement('div');
    panel.className = 'ops-rp-info';

    const inner = document.createElement('div');
    inner.className = 'ops-rp-info__inner';

    const cornerTR = document.createElement('div');
    cornerTR.className = 'ops-rp-corner-tr';
    inner.appendChild(cornerTR);

    const title = document.createElement('div');
    title.className = 'ops-rp-title';
    title.style.color = meta.titleColor;
    title.textContent = kindLabel[m.kind] || m.kind.toUpperCase();
    inner.appendChild(title);

    [m.label, `${m.lat?.toFixed(4)}, ${m.lng?.toFixed(4)}`].forEach(s => {
      const sub = document.createElement('div');
      sub.className = 'ops-rp-sub';
      sub.textContent = s;
      inner.appendChild(sub);
    });

    panel.appendChild(inner);
    return panel;
  }

  function mountReticleMarkers(root) {
    const layer = root.querySelector('#ops-reticle-layer');
    if (!layer) return;
    layer.innerHTML = '';

    MARKERS.forEach((m, idx) => {
      const meta = _MARKER_META[m.kind] || _MARKER_META.command;

      const card = document.createElement('div');
      card.className = 'ops-rp-card';
      card.style.left = m.x + '%';
      card.style.top  = m.y + '%';
      card.dataset.markerId = m.id;

      const svg = _makeReticleSVG(meta);
      card.appendChild(svg);
      card.appendChild(_makeReticleInfoPanel(m, meta));

      layer.appendChild(card);

      // Hover: hide/show bar
      const barEls = [
        svg.querySelector('.bar-track'),
        svg.querySelector('.bar-fill'),
        ...svg.querySelectorAll('.bar-tick'),
      ];
      card.addEventListener('mouseenter', () => {
        barEls.forEach(el => { el.style.transition = 'opacity 0.15s'; el.setAttribute('opacity', '0'); });
      });
      card.addEventListener('mouseleave', () => {
        if (svg.querySelector('.corner.bl').getAttribute('opacity') === '1') {
          svg.querySelector('.bar-track').setAttribute('opacity', '0.3');
          svg.querySelector('.bar-fill').setAttribute('opacity', '0.85');
          svg.querySelectorAll('.bar-tick').forEach(t => t.setAttribute('opacity', '0.4'));
        }
      });

      setTimeout(() => _animateReticle(svg), idx * 140);
    });
  }

  /* ── Non-diegetic callout overlay ────────────────────────── */
  /*
     Visual design (from reference images):
     - Corner bracket reticle around the marker
     - Straight diagonal leader line from bracket corner to text block
     - No card/box — raw floating text on the map
     - Breached/threat = danger red; ranger = brand lime; sensor = accent cyan; caution = warning amber
     - Two-line label: large mono TITLE, smaller subtitle underneath
     - Actions float below subtitle as minimal text links
  */
  /* ── Right detail drawer ─────────────────────────────────── */
  function buildDrawer(entity) {
    if (!entity) {
      return `
            <div class="ops-drawer__empty">
              <div class="ops-eyebrow">No selection</div>
              <p style="font-size:12.5px;color:var(--clr-text-dim);line-height:1.55;margin:0">
                Select a marker on the map or a row in the panel to inspect.
              </p>
            </div>`;
    }

    const kindLabel = { threat: 'Threat', caution: 'Caution', ranger: 'Ranger', sensor: 'Sensor', asset: 'Asset' }[entity.kind] || 'Entity';
    const kvRows = entity.fields.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

    let sectionHtml = '';
    if (entity.kind === 'threat' || entity.kind === 'caution') {
      sectionHtml = `
            <div class="ops-section">
              <div class="ops-section__label">Detection</div>
              <p class="ops-section__text">${entity.detail}</p>
            </div>
            <div class="ops-actions">
              <button class="ops-btn ops-btn--ghost" id="ops-btn-cleared">Mark cleared</button>
              <button class="ops-btn ops-btn--primary" id="ops-btn-deploy">Deploy team</button>
            </div>`;
    } else if (entity.kind === 'ranger') {
      sectionHtml = `
            <div class="ops-section">
              <div class="ops-section__label">Last 6 pings</div>
              <div class="ops-ping-strip">
                ${[1, 1, 1, 1, 0, 1].map(p => `<span class="ops-ping${p ? ' ops-ping--on' : ''}"></span>`).join('')}
              </div>
            </div>
            <div class="ops-actions">
              <button class="ops-btn ops-btn--ghost">Open comms</button>
              <button class="ops-btn ops-btn--primary">Send waypoint</button>
            </div>`;
    }

    return `
        <header class="ops-drawer__head">
          <div>
            <div class="ops-drawer__kind">${kindLabel}</div>
            <h3 class="ops-drawer__title">${entity.name}</h3>
          </div>
          <button class="ops-close-btn" id="ops-drawer-close" title="Close" aria-label="Close panel">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M6 6l12 12M18 6L6 18"/>
            </svg>
          </button>
        </header>
        <dl class="ops-kv">${kvRows}</dl>
        ${sectionHtml}`;
  }

  /* ── Tab panel content router ────────────────────────────── */
  function buildTabContent() {
    const alerts = activeAlerts();
    switch (state.activeTab) {
      case 'alerts': return buildAlertPanel(alerts);
      case 'roster': return buildRosterPanel();
      case 'sensors': return buildSensorsPanel();
      case 'drone': return buildDronePanel();
      case 'help': return buildHelpPanel();
      default: return ''; // live-map shows the full 3-col layout
    }
  }

  /* ═══════════════════════════════════════════════════════════
     FULL PAGE RENDER
  ═══════════════════════════════════════════════════════════ */
  function renderPage() {
    if (!_container) return;
    const alerts = activeAlerts();
    const entity = resolveEntity(state.selectedMarkerId);

    const isMapTab = state.activeTab === 'live-map';

    _container.innerHTML = `
        <div class="ops-console">
          ${buildInnerNav()}
          ${isMapTab ? `
          <div class="ops-left">
            ${buildAlertPanel(alerts)}
            ${buildRosterPanel()}
          </div>
          <div class="ops-map">${buildMap()}</div>
          <div class="ops-drawer${state.drawerCollapsed ? ' ops-drawer--collapsed' : ''}">
            <button class="ops-drawer__toggle" id="ops-drawer-toggle" title="${state.drawerCollapsed ? 'Expand panel' : 'Collapse panel'}" aria-label="${state.drawerCollapsed ? 'Expand panel' : 'Collapse panel'}">
              ${state.drawerCollapsed ? '«' : '»'}
            </button>
            <div class="ops-drawer__body">${buildDrawer(entity)}</div>
          </div>
          ` : `
          <div class="ops-full-panel">
            ${buildTabContent()}
          </div>
          `}
        </div>`;

    bindEvents();
    tickClock();
    if (isMapTab) mountReticleMarkers(_container);
  }

  /* ═══════════════════════════════════════════════════════════
     EVENT BINDING
  ═══════════════════════════════════════════════════════════ */
  function bindEvents() {
    const root = _container;

    /* Inner nav tabs */
    root.querySelectorAll('.ops-nav__item').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeTab = btn.dataset.tab;
        state.callout = null;
        renderPage();
      });
    });

    /* Alert rows */
    root.querySelectorAll('.ops-alert-row').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.alertId;
        state.selectedAlertId = id;
        state.selectedMarkerId = id;
        state.selectedRangerId = null;
        const m = MARKERS.find(x => x.id === id);
        if (m) state.callout = { markerId: id };
        if (state.activeTab !== 'live-map') state.activeTab = 'live-map';
        renderPage();
      });
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') el.click(); });
    });

    /* Ack buttons */
    root.querySelectorAll('.ops-ack-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = btn.dataset.ackId;
        if (!state.ackedIds.includes(id)) state.ackedIds.push(id);
        if (state.selectedAlertId === id) {
          state.selectedAlertId = null;
          state.selectedMarkerId = null;
          state.callout = null;
        }
        renderPage();
      });
    });

    /* Roster rows */
    root.querySelectorAll('.ops-roster-row').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.rangerId;
        state.selectedRangerId = id;
        state.selectedMarkerId = id;
        state.selectedAlertId = null;
        const m = MARKERS.find(x => x.id === id);
        if (m) state.callout = { markerId: id };
        if (state.activeTab !== 'live-map') state.activeTab = 'live-map';
        renderPage();
      });
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') el.click(); });
    });

    /* Map markers — open callout */
    root.querySelectorAll('.ops-marker').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = btn.dataset.markerId;
        const alreadyOpen = state.callout && state.callout.markerId === id;
        state.selectedMarkerId = id;
        state.selectedRangerId = null;
        const alert = ALL_ALERTS.find(a => a.id === id);
        if (alert) state.selectedAlertId = id;
        state.callout = alreadyOpen ? null : { markerId: id };
        renderPage();
      });
      btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') btn.click(); });
    });

    /* Callout close / actions */
    root.querySelectorAll('[data-callout-action]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const action = btn.dataset.calloutAction;
        if (action === 'close') {
          state.callout = null;
          renderPage();
        } else if (action === 'deploy' || action === 'clear') {
          const id = state.callout?.markerId;
          if (id && !state.ackedIds.includes(id)) state.ackedIds.push(id);
          state.callout = null;
          state.selectedMarkerId = null;
          state.selectedAlertId = null;
          renderPage();
        } else {
          // comms, waypoint, ping, report — feedback only for now
          Toast.show('Action queued (demo mode)', 'info');
        }
      });
    });

    /* Map background click — dismiss callout */
    const mapBg = root.querySelector('.ops-map-bg');
    if (mapBg) {
      mapBg.addEventListener('click', (e) => {
        if (e.target === mapBg || e.target.classList.contains('ops-map-grid') || e.target.classList.contains('ops-map-svg')) {
          state.callout = null;
          renderPage();
        }
      });
    }

    /* Drawer collapse toggle */
    const drawerToggle = root.querySelector('#ops-drawer-toggle');
    if (drawerToggle) drawerToggle.addEventListener('click', () => {
      state.drawerCollapsed = !state.drawerCollapsed;
      localStorage.setItem(DRAWER_COLLAPSED_KEY, state.drawerCollapsed ? '1' : '0');
      const drawer = root.querySelector('.ops-drawer');
      if (drawer) {
        drawer.classList.toggle('ops-drawer--collapsed', state.drawerCollapsed);
        drawerToggle.textContent = state.drawerCollapsed ? '«' : '»';
        drawerToggle.title = state.drawerCollapsed ? 'Expand panel' : 'Collapse panel';
        drawerToggle.setAttribute('aria-label', state.drawerCollapsed ? 'Expand panel' : 'Collapse panel');
      }
    });

    /* Close drawer */
    const closeBtn = root.querySelector('#ops-drawer-close');
    if (closeBtn) closeBtn.addEventListener('click', () => {
      state.selectedMarkerId = null;
      state.selectedRangerId = null;
      state.selectedAlertId = null;
      state.callout = null;
      renderPage();
    });

    /* Deploy / cleared from drawer */
    const deployBtn = root.querySelector('#ops-btn-deploy');
    if (deployBtn) deployBtn.addEventListener('click', () => {
      const id = state.selectedMarkerId;
      if (id && !state.ackedIds.includes(id)) state.ackedIds.push(id);
      state.selectedMarkerId = null;
      state.selectedAlertId = null;
      state.callout = null;
      renderPage();
    });
    const clearedBtn = root.querySelector('#ops-btn-cleared');
    if (clearedBtn) clearedBtn.addEventListener('click', () => {
      const id = state.selectedMarkerId;
      if (id && !state.ackedIds.includes(id)) state.ackedIds.push(id);
      state.selectedMarkerId = null;
      state.selectedAlertId = null;
      state.callout = null;
      renderPage();
    });

    /* ESC to dismiss callout */
    if (!root._opsEscBound) {
      root._opsEscBound = true;
      document.addEventListener('keydown', _onEsc);
    }
  }

  function _onEsc(e) {
    if (e.key === 'Escape' && state.callout) {
      state.callout = null;
      renderPage();
    }
  }

  /* ── Topbar strip ────────────────────────────────────────── */
  function injectTopbarStrip() {
    const right = document.querySelector('.topbar__right');
    if (!right) return;
    const existing = right.querySelector('.ops-topbar-strip');
    if (existing) existing.remove();
    right.insertAdjacentHTML('afterbegin', buildTopbarStrip(activeAlerts()));
  }

  function removeTopbarStrip() {
    document.querySelector('.ops-topbar-strip')?.remove();
  }

  /* ── Public API ──────────────────────────────────────────── */
  function render(container) {
    state = {
      ackedIds: [],
      selectedMarkerId: 'threat-1',
      selectedRangerId: null,
      selectedAlertId: 'threat-1',
      callout: { markerId: 'threat-1' },
      activeTab: 'live-map',
      utcTime: '--:--:--',
      drawerCollapsed: localStorage.getItem(DRAWER_COLLAPSED_KEY) === '1',
    };

    _container = container;
    container.style.padding = '0';
    container.style.overflow = 'hidden';
    container.style.position = 'relative';

    renderPage();
    injectTopbarStrip();
    tickClock();
    _clockId = setInterval(() => { tickClock(); }, 1000);
  }

  function destroy() {
    clearInterval(_clockId);
    _clockId = null;
    document.removeEventListener('keydown', _onEsc);
    if (_container) _container._opsEscBound = false;
    _container = null;
    removeTopbarStrip();
  }

  return { render, destroy };

})();
