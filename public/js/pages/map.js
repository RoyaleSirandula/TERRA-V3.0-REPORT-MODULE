/* ============================================================
   TERRA – map.js   Ops Console / Tactical Dashboard
   Full-viewport tactical dashboard with Leaflet live map.
   Marker system mirrors Field Intel (testSite.js) exactly:
     hover → info panel  ·  click △ → restore + fly
     click reticle → expand panel  ·  DETAIL → dock
   Navigation: Router.navigate('map')
   ============================================================ */

const MapPage = (() => {

  /* ── Live data — populated by loadOpsData() on mount ────── */
  let MARKERS        = [];
  let ALL_ALERTS     = [];
  let RANGERS        = [];
  let SENSORS        = [];
  let COMMAND_MARKERS = [];
  let SIGHTINGS      = [];
  let _markerDataList = [];   // testSite-compatible marker objects

  /* ── Leaflet state ───────────────────────────────────────── */
  let _leafletMap    = null;
  let _opsMarkerRefs = [];    // [{card, svg, tri, meta, latlng, leafletMarker, markerData}]

  /* ── Inner nav tabs ──────────────────────────────────────── */
  const INNER_NAV = [
    { id: 'live-map', label: 'Live Map', icon: '◉' },
    { id: 'alerts',   label: 'Alerts',   icon: '⚑' },
    { id: 'roster',   label: 'Roster',   icon: '≡' },
    { id: 'sensors',  label: 'Sensors',  icon: '◈' },
    { id: 'drone',    label: 'Drone Feed', icon: '⟳' },
    { id: 'help',     label: 'Help',     icon: '?' },
  ];

  const DRAWER_COLLAPSED_KEY = 'terra_ops_drawer_collapsed';

  /* ── State ───────────────────────────────────────────────── */
  let state = {
    ackedIds:          [],
    selectedMarkerId:  null,
    selectedRangerId:  null,
    selectedAlertId:   null,
    callout:           null,
    activeTab:         'live-map',
    utcTime:           '--:--:--',
    drawerCollapsed:   localStorage.getItem(DRAWER_COLLAPSED_KEY) === '1',
  };

  let _clockId   = null;
  let _pollId    = null;
  let _container = null;

  const POLL_INTERVAL_MS = 30_000;

  /* ═══════════════════════════════════════════════════════════
     MARKER SYSTEM (mirrors testSite.js)
  ═══════════════════════════════════════════════════════════ */

  const VARIANT_META = {
    default: { bracket: '#ffffff',              bar: '#ffffff', fill: 'rgba(255,255,255,0.07)', titleColor: '#ffffff',  statusColor: '#aaaaaa' },
    report:  { bracket: '#ffffff',              bar: '#66ccff', fill: 'rgba(80,180,255,0.08)',  titleColor: '#66ccff',  statusColor: '#66ccff' },
    ranger:  { bracket: 'rgba(255,255,255,0.9)',bar: '#b8f000', fill: 'rgba(184,240,0,0.07)',   titleColor: '#b8f000',  statusColor: '#b8f000' },
    sensor:  { bracket: 'rgba(255,255,255,0.8)',bar: '#00e5ff', fill: 'rgba(0,229,255,0.07)',   titleColor: '#00e5ff',  statusColor: '#00e5ff' },
    command: { bracket: 'rgba(255,255,255,0.6)',bar: '#ffffff', fill: 'rgba(255,255,255,0.05)', titleColor: '#ffffff',  statusColor: '#aaaaaa' },
    caution: { bracket: 'rgba(255,255,255,0.9)',bar: '#ffcc44', fill: 'rgba(255,204,68,0.08)',  titleColor: '#ffcc44',  statusColor: '#ffcc44' },
    threat:  { bracket: '#ffffff',              bar: '#ff3333', fill: 'rgba(255,40,40,0.09)',   titleColor: '#ff3333',  statusColor: '#ff3333' },
  };

  const KIND_ORDER = ['default', 'report', 'ranger', 'sensor', 'command', 'caution', 'threat'];
  const NS = 'http://www.w3.org/2000/svg';

  function latLngToSector(lat, lng) {
    const lg = Math.round(lat * 20) / 20;
    const ng = Math.round(lng * 20) / 20;
    return `${lg.toFixed(2)},${ng.toFixed(2)}`;
  }

  function tierScale(tier) {
    return 1.0 + (Math.min(tier, 3) - 1) * 0.3;
  }

  function normaliseConf(score) {
    if (score == null) return null;
    return score > 1 ? score / 100 : score;
  }

  const DECAY_MAX_MS = 7 * 24 * 60 * 60 * 1000;
  const DECAY_K = 3.5;
  function decayOpacity(createdAt) {
    if (!createdAt) return 0.6;
    const age = Date.now() - new Date(createdAt).getTime();
    if (age <= 0) return 1.0;
    const ratio = Math.min(age / DECAY_MAX_MS, 1);
    const exp = (Math.exp(DECAY_K * ratio) - 1) / (Math.exp(DECAY_K) - 1);
    return Math.max(0.25, 1.0 - exp * 0.75);
  }

  function formatAge(createdAt) {
    if (!createdAt) return { label: 'UNKNOWN', color: '#555', isFresh: false };
    const ms = Date.now() - new Date(createdAt).getTime();
    const h  = ms / 3_600_000;
    const d  = ms / 86_400_000;
    let label;
    if (ms < 0)      label = 'JUST NOW';
    else if (h < 1)  label = `${Math.round(h * 60)}m AGO`;
    else if (h < 24) label = `${Math.floor(h)}h AGO`;
    else if (d < 30) label = `${Math.floor(d)}d AGO`;
    else             label = `${Math.floor(d / 30)}mo AGO`;
    const color = h < 6 ? '#00ff88' : h < 48 ? '#ffcc44' : '#ff5533';
    return { label, color, isFresh: h < 2 };
  }

  /* ── SVG builders ────────────────────────────────────────── */
  function makeMiniTriangle(meta, scale = 1) {
    const w = Math.round(20 * scale);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('width', `${w}`);
    svg.setAttribute('height', `${w}`);
    svg.style.display = 'block';
    svg.style.flexShrink = '0';
    svg.classList.add('ops-mini-tri');

    const tri = document.createElementNS(NS, 'polygon');
    tri.setAttribute('points', '10,2 18,18 2,18');
    tri.setAttribute('fill', 'none');
    tri.setAttribute('stroke', meta.bar);
    tri.setAttribute('stroke-width', '1.5');
    tri.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(tri);

    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', '10');
    dot.setAttribute('cy', '13');
    dot.setAttribute('r', '1.5');
    dot.setAttribute('fill', meta.bar);
    svg.appendChild(dot);

    return svg;
  }

  function makeSVG(meta, scale = 1, confidence = null) {
    const w = Math.round(78 * scale);
    const h = Math.round(72 * scale);
    const offset = Math.round(-26 * scale);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 130 120');
    svg.setAttribute('width', `${w}`);
    svg.setAttribute('height', `${h}`);
    svg.style.display = 'block';
    svg.style.position = 'absolute';
    svg.style.left = `${offset}px`;
    svg.style.top  = `${offset}px`;
    svg.classList.add('ops-reticle-svg');

    const fillBox = document.createElementNS(NS, 'rect');
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
      const pl = document.createElementNS(NS, 'polyline');
      pl.setAttribute('stroke', meta.bracket);
      pl.setAttribute('stroke-width', '1.5');
      pl.setAttribute('fill', 'none');
      pl.setAttribute('points', c.points);
      pl.setAttribute('opacity', '0');
      pl.classList.add('corner', c.cls);
      svg.appendChild(pl);
    });

    const track = document.createElementNS(NS, 'rect');
    track.setAttribute('x', '116'); track.setAttribute('y', '10');
    track.setAttribute('width', '5'); track.setAttribute('height', '100');
    track.setAttribute('rx', '1');
    track.setAttribute('stroke', meta.bar);
    track.setAttribute('stroke-width', '0.8');
    track.setAttribute('fill', 'none');
    track.setAttribute('opacity', '0');
    track.classList.add('bar-track');
    svg.appendChild(track);

    const fillH = confidence != null ? confidence * 100 : 72;
    const fillY = 110 - fillH;
    const barFill = document.createElementNS(NS, 'rect');
    barFill.setAttribute('x', '116'); barFill.setAttribute('y', String(fillY));
    barFill.setAttribute('width', '5'); barFill.setAttribute('height', String(fillH));
    barFill.setAttribute('rx', '1');
    barFill.setAttribute('fill', meta.bar);
    barFill.setAttribute('opacity', '0');
    barFill.classList.add('bar-fill');
    svg.appendChild(barFill);

    [35, 60, 85].forEach(ty => {
      const tick = document.createElementNS(NS, 'line');
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

  /* ── Animation helpers ───────────────────────────────────── */
  function flicker(el, finalOpacity, onDone) {
    let count = 0;
    const max = 2;
    function step() {
      el.setAttribute('opacity', count % 2 === 0 ? finalOpacity : '0');
      count++;
      if (count <= max * 2) setTimeout(step, 25 + Math.random() * 25);
      else { el.setAttribute('opacity', finalOpacity); if (onDone) onDone(); }
    }
    step();
  }

  function animateReticle(svg) {
    const fillBox  = svg.querySelector('.fill-box');
    const tl       = svg.querySelector('.corner.tl');
    const br       = svg.querySelector('.corner.br');
    const tr       = svg.querySelector('.corner.tr');
    const bl       = svg.querySelector('.corner.bl');
    const barTrack = svg.querySelector('.bar-track');
    const barFill  = svg.querySelector('.bar-fill');
    const barTicks = svg.querySelectorAll('.bar-tick');

    return new Promise(resolve => {
      setTimeout(() => fillBox.setAttribute('opacity', '1'), 40);
      const d = 160;
      setTimeout(() => flicker(tl, '1'), d);
      setTimeout(() => flicker(br, '1'), d + 80);
      setTimeout(() => flicker(tr, '1'), d + 160);
      setTimeout(() => flicker(bl, '1', () => {
        flicker(barTrack, '0.3');
        setTimeout(() => {
          barFill.setAttribute('opacity', '0.85');
          barTicks.forEach(t => t.setAttribute('opacity', '0.4'));
          setTimeout(resolve, 80);
        }, 80);
      }), d + 240);
    });
  }

  function restoreBarOpacity(svg) {
    svg.querySelector('.bar-track')?.setAttribute('opacity', '0.3');
    svg.querySelector('.bar-fill')?.setAttribute('opacity', '0.85');
    svg.querySelectorAll('.bar-tick').forEach(t => t.setAttribute('opacity', '0.4'));
  }

  function restoreSVGState(svg) {
    svg.querySelector('.fill-box')?.setAttribute('opacity', '1');
    svg.querySelectorAll('.corner').forEach(c => c.setAttribute('opacity', '1'));
    restoreBarOpacity(svg);
  }

  function resetSVGOpacity(svg) {
    svg.querySelectorAll('.fill-box, .corner, .bar-track, .bar-fill, .bar-tick')
      .forEach(el => el.setAttribute('opacity', '0'));
  }

  function flickerGridCells(cells) {
    const order = [...cells].sort(() => Math.random() - 0.5);
    order.forEach((cell, i) => {
      setTimeout(() => {
        let c = 0;
        const max = Math.floor(Math.random() * 2) + 2;
        function step() {
          cell.style.opacity = c % 2 === 0 ? '1' : '0';
          c++;
          if (c <= max * 2) setTimeout(step, 35 + Math.random() * 50);
          else cell.style.opacity = '1';
        }
        step();
      }, i * (55 + Math.random() * 70));
    });
  }

  /* ── Collapse / restore ──────────────────────────────────── */
  function collapseToTriangle(card, svg) {
    card.classList.remove('ops-expanded');
    const ip = card.querySelector('.ops-info-panel');
    if (ip) { ip.style.width = '0'; ip.style.opacity = '0'; }
    card.querySelectorAll('.ts-grid-cell').forEach(c => { c.style.opacity = '0'; });

    svg.style.transition = 'opacity 0.25s ease';
    svg.style.opacity = '0';
    setTimeout(() => {
      svg.style.display = 'none';
      svg.style.opacity = '';
      svg.style.transition = '';
      resetSVGOpacity(svg);
      card.classList.add('ops-mini');
      const tri = card.querySelector('.ops-mini-tri');
      if (tri) { tri.style.display = 'block'; tri.style.opacity = '1'; }
    }, 260);
  }

  function restoreReticle(card, svg) {
    card.classList.remove('ops-mini');
    const tri = card.querySelector('.ops-mini-tri');
    if (tri) tri.style.display = 'none';
    restoreSVGState(svg);
    svg.style.display = 'block';
    svg.style.opacity = '0';
    svg.style.transition = 'opacity 0.22s ease';
    requestAnimationFrame(() => {
      svg.style.opacity = '1';
      setTimeout(() => { svg.style.transition = ''; }, 240);
    });
  }

  /* ── Info panel (hover) ──────────────────────────────────── */
  function makeInfoPanel(marker, meta) {
    const panel = document.createElement('div');
    panel.className = 'ops-info-panel';

    const inner = document.createElement('div');
    inner.className = 'ops-info-inner';

    inner.appendChild(Object.assign(document.createElement('div'), { className: 'ts-corner-tr' }));

    const title = document.createElement('div');
    title.className = 'ops-info-title';
    title.style.color = meta.titleColor;
    title.textContent = marker.title;
    inner.appendChild(title);

    const eyebrow = document.createElement('div');
    eyebrow.className = 'ops-info-eyebrow';
    eyebrow.textContent = marker.kind.toUpperCase();
    eyebrow.style.color = meta.bar;
    inner.appendChild(eyebrow);

    marker.subs.forEach(s => {
      const sub = document.createElement('div');
      sub.className = 'ops-info-sub';
      sub.textContent = s;
      inner.appendChild(sub);
    });

    panel.appendChild(inner);
    return panel;
  }

  /* ── Expanded panel (click on reticle) ───────────────────── */
  function makeExpandedPanel(marker, meta) {
    const panel = document.createElement('div');
    panel.className = 'ops-exp-panel';

    const inner = document.createElement('div');
    inner.className = 'ops-exp-inner';

    inner.appendChild(Object.assign(document.createElement('div'), { className: 'ts-corner-tr' }));

    const kindLabels = { threat: 'THREAT DETECTED', caution: 'CAUTION', ranger: 'FIELD RANGER', sensor: 'FIELD SENSOR', command: 'BASE COMMAND', report: 'SIGHTING REPORT', default: 'FIELD REPORT' };
    const kindEl = document.createElement('div');
    kindEl.className = 'ops-exp-kind';
    kindEl.style.color = meta.bar;
    kindEl.textContent = kindLabels[marker.kind] || marker.kind.toUpperCase();
    inner.appendChild(kindEl);

    const titleEl = document.createElement('div');
    titleEl.className = 'ops-exp-title';
    titleEl.style.color = meta.titleColor;
    titleEl.textContent = marker.expTitle;
    inner.appendChild(titleEl);

    const divider = document.createElement('div');
    divider.className = 'ts-exp-divider';
    inner.appendChild(divider);

    marker.expSubs.forEach(s => {
      const row = document.createElement('div');
      row.className = 'ts-data-row';
      const parts = s.split(':');
      if (parts.length >= 2) {
        row.innerHTML = `<span class="ts-data-label">${parts[0].trim()}</span><span class="ts-data-value">${parts.slice(1).join(':').trim()}</span>`;
      } else {
        row.innerHTML = `<span class="ts-data-value">${s}</span>`;
      }
      inner.appendChild(row);
    });

    const raw = marker._raw;
    if (raw?.ai_confidence_score != null) {
      const pct = Math.round(normaliseConf(raw.ai_confidence_score) * 100);
      const conf = document.createElement('div');
      conf.className = 'ts-conf-wrap';
      conf.innerHTML = `<div class="ts-conf-label"><span style="color:#555;font-size:9px;letter-spacing:.1em;">AI CONF</span><span style="color:${meta.bar};font-size:9px;font-weight:600;">${pct}%</span></div><div class="ts-conf-track"><div class="ts-conf-fill" style="width:${pct}%;background:${meta.bar};"></div></div>`;
      inner.appendChild(conf);
    }

    const detailBtn = document.createElement('button');
    detailBtn.className = 'ts-detail-btn';
    detailBtn.dataset.action = 'open-dock';
    detailBtn.style.borderColor = meta.bar;
    detailBtn.style.color = meta.bar;
    detailBtn.innerHTML = 'DETAIL &rsaquo;';
    inner.appendChild(detailBtn);

    panel.appendChild(inner);
    return panel;
  }

  /* ── Dock panel (DETAIL button) ──────────────────────────── */
  const DOCK_W = 300;

  function buildDockContent(marker) {
    const raw   = marker._raw || {};
    const meta  = VARIANT_META[marker.kind] || VARIANT_META.default;
    const score = normaliseConf(raw.ai_confidence_score);
    const pct   = score != null ? Math.round(score * 100) : null;
    const tier  = raw.sensitivity_tier || 1;
    const status = (raw.validation_status || 'PENDING').toUpperCase();

    function row(label, value, color) {
      if (value == null || value === '' || value === '—') return '';
      return `<div class="ts-dock-row"><span class="ts-dock-label">${label}</span><span class="ts-dock-value"${color ? ` style="color:${color}"` : ''}>${value}</span></div>`;
    }
    function section(title, body) {
      if (!body.trim()) return '';
      return `<div class="ts-dock-section"><div class="ts-dock-section-title">${title}</div>${body}</div>`;
    }

    const confBlock = pct != null ? `<div class="ts-dock-conf"><div class="ts-dock-conf-row"><span style="color:#555;font-size:9px;letter-spacing:.1em;">AI CONFIDENCE</span><span style="color:${meta.bar};font-size:9px;font-weight:600;">${pct}%</span></div><div class="ts-conf-track" style="margin-top:4px;"><div class="ts-conf-fill" style="width:${pct}%;background:${meta.bar};"></div></div></div>` : '';

    const actionBlock = (marker.kind === 'threat' || marker.kind === 'caution')
      ? `<div class="ops-dock-actions"><button class="ops-btn ops-btn--ghost ops-dock-btn" data-dock-action="clear">Mark cleared</button><button class="ops-btn ops-btn--primary ops-dock-btn" data-dock-action="deploy">Deploy team</button></div>`
      : (marker.kind === 'ranger')
      ? `<div class="ops-dock-actions"><button class="ops-btn ops-btn--ghost ops-dock-btn" data-dock-action="comms">Open comms</button><button class="ops-btn ops-btn--primary ops-dock-btn" data-dock-action="waypoint">Send waypoint</button></div>`
      : '';

    return `
      <div class="ts-dock-header">
        <div class="ts-dock-kind" style="color:${meta.bar}">${marker.kind.toUpperCase()}</div>
        <div class="ts-dock-title" style="color:${meta.titleColor}">${marker.expTitle}</div>
      </div>
      ${section('LOCATION', `
        ${row('COORDS', `${parseFloat(marker.lat).toFixed(5)}, ${parseFloat(marker.lng).toFixed(5)}`)}
        ${row('SECTOR', marker.sector)}
      `)}
      ${section('STATUS', `
        ${row('STATUS', status, meta.statusColor)}
        ${row('TIER', tier > 0 ? String(tier) : null)}
        ${row('SUBMITTED', raw.submitted_by || raw.ranger_id)}
      `)}
      ${raw.species_name || raw.description ? section('DETAIL', `
        ${row('SPECIES', raw.species_name)}
        ${raw.description ? `<div class="ts-dock-row"><span class="ts-dock-label">NOTES</span><span class="ts-dock-value" style="white-space:pre-wrap;line-height:1.5">${raw.description}</span></div>` : ''}
      `) : ''}
      ${confBlock}
      ${actionBlock}`;
  }

  function openDock(mapWrap, markerId, marker) {
    let dock = mapWrap.querySelector('.ts-dock');
    if (!dock) {
      dock = document.createElement('div');
      dock.className = 'ts-dock';

      const collapseBtn = document.createElement('button');
      collapseBtn.className = 'ts-dock-collapse';
      collapseBtn.title = 'Collapse';
      collapseBtn.innerHTML = '›';
      collapseBtn.addEventListener('click', () => closeDock(mapWrap));
      dock.appendChild(collapseBtn);

      const body = document.createElement('div');
      body.className = 'ts-dock-body';
      dock.appendChild(body);
      mapWrap.appendChild(dock);

      requestAnimationFrame(() => requestAnimationFrame(() => dock.classList.add('ts-dock--open')));
      if (_leafletMap) setTimeout(() => _leafletMap.panBy([DOCK_W / 2, 0], { animate: true, duration: 0.3 }), 60);
    }

    const body = dock.querySelector('.ts-dock-body');
    body.style.opacity = '0';
    setTimeout(() => {
      body.innerHTML = buildDockContent(marker);
      body.style.opacity = '1';
      // Wire dock action buttons
      body.querySelectorAll('.ops-dock-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const action = btn.dataset.dockAction;
          if (action === 'deploy' || action === 'clear') {
            if (!state.ackedIds.includes(markerId)) state.ackedIds.push(markerId);
            state.selectedMarkerId = null;
            state.selectedAlertId  = null;
          }
          API.post('/ops/actions', { type: action, target_id: markerId })
            .then(() => {
              if (action === 'deploy')   Toast.success('Team deployed');
              if (action === 'clear')    Toast.success('Threat marked cleared');
              if (action === 'comms')    Toast.success('Comms channel opened');
              if (action === 'waypoint') Toast.success('Waypoint sent');
            })
            .catch(() => Toast.warning('Action logged locally — server sync failed'));
        });
      });
    }, 150);

    // Also update the ops drawer
    state.selectedMarkerId = markerId;
    _updateDrawer();
  }

  function closeDock(mapWrap) {
    const dock = mapWrap.querySelector('.ts-dock');
    if (!dock) return;
    dock.classList.remove('ts-dock--open');
    if (_leafletMap) _leafletMap.panBy([-DOCK_W / 2, 0], { animate: true, duration: 0.3 });
    setTimeout(() => dock.remove(), 300);
  }

  /* ── Bind interactions (mirrors testSite.bindInteractions) ── */
  function bindMarkerInteractions(card, svg, latlng, markerData) {
    const barEls = [
      svg.querySelector('.bar-track'),
      svg.querySelector('.bar-fill'),
      ...svg.querySelectorAll('.bar-tick'),
    ];
    const infoPanel = card.querySelector('.ops-info-panel');
    const tri       = card.querySelector('.ops-mini-tri');

    function flyToMarker() {
      if (!_leafletMap || !latlng) return;
      const targetZoom = Math.max(_leafletMap.getZoom(), 14);
      _leafletMap.flyTo(latlng, targetZoom, { animate: true, duration: 0.6 });
    }

    function focusMarker() {
      document.querySelectorAll('.ops-reticle-card').forEach(c => {
        if (c === card) return;
        const s = c.querySelector('.ops-reticle-svg');
        if (s) collapseToTriangle(c, s);
      });
      if (card.classList.contains('ops-mini')) restoreReticle(card, svg);
      card.classList.add('ops-expanded');
      if (infoPanel) { infoPanel.style.width = '200px'; infoPanel.style.opacity = '1'; }
      barEls.forEach(el => el.setAttribute('opacity', '0'));
      setTimeout(() => flickerGridCells(card.querySelectorAll('.ts-grid-cell')), 180);
      if (_leafletMap && latlng) setTimeout(() => _leafletMap.flyTo(latlng, _leafletMap.getMaxZoom(), { animate: true, duration: 0.9 }), 60);
      state.selectedMarkerId = markerData.id;
      _updateDrawer();
    }

    let clickTimer = null;
    function handleClick(singleFn) {
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
        focusMarker();
      } else {
        clickTimer = setTimeout(() => { clickTimer = null; singleFn(); }, 300);
      }
    }

    function showInfo() {
      if (card.classList.contains('ops-expanded')) return;
      if (!card.classList.contains('ops-mini')) {
        barEls.forEach(el => { el.style.transition = 'opacity 0.15s'; el.setAttribute('opacity', '0'); });
      }
      if (infoPanel) { infoPanel.style.width = '200px'; infoPanel.style.opacity = '1'; infoPanel.style.pointerEvents = 'none'; }
    }

    function hideInfo() {
      if (card.classList.contains('ops-expanded')) return;
      if (!card.classList.contains('ops-mini')) {
        if (svg.querySelector('.corner.bl')?.getAttribute('opacity') === '1') restoreBarOpacity(svg);
      }
      if (infoPanel) { infoPanel.style.width = '0'; infoPanel.style.opacity = '0'; }
    }

    if (tri) {
      tri.addEventListener('mouseenter', showInfo);
      tri.addEventListener('mouseleave', hideInfo);
      tri.addEventListener('click', e => {
        e.stopPropagation(); e.preventDefault();
        hideInfo();
        handleClick(() => {
          restoreReticle(card, svg);
          setTimeout(flyToMarker, 50);
          state.selectedMarkerId = markerData.id;
          _updateDrawer();
        });
      });
    }

    svg.addEventListener('mouseenter', showInfo);
    svg.addEventListener('mouseleave', hideInfo);
    svg.addEventListener('click', e => {
      if (card.classList.contains('ops-mini')) return;
      e.stopPropagation(); e.preventDefault();
      const wasExpanded = card.classList.contains('ops-expanded');
      handleClick(() => {
        document.querySelectorAll('.ops-reticle-card.ops-expanded').forEach(c => {
          if (c === card) return;
          const s = c.querySelector('.ops-reticle-svg');
          if (s) collapseToTriangle(c, s);
        });
        if (wasExpanded) {
          collapseToTriangle(card, svg);
          if (_leafletMap) {
            const mapWrap = _leafletMap.getContainer().parentElement;
            closeDock(mapWrap);
          }
        } else {
          flyToMarker();
          card.classList.add('ops-expanded');
          if (infoPanel) { infoPanel.style.width = '0'; infoPanel.style.opacity = '0'; }
          barEls.forEach(el => el.setAttribute('opacity', '0'));
          setTimeout(() => flickerGridCells(card.querySelectorAll('.ts-grid-cell')), 180);
          state.selectedMarkerId = markerData.id;
          _updateDrawer();
        }
      });
    });

    card.addEventListener('click', e => {
      const btn = e.target.closest('[data-action="open-dock"]');
      if (!btn) return;
      e.stopPropagation();
      card.classList.remove('ops-expanded');
      if (infoPanel) { infoPanel.style.width = '200px'; infoPanel.style.opacity = '1'; }
      restoreBarOpacity(svg);
      if (_leafletMap) {
        const mapWrap = _leafletMap.getContainer().parentElement;
        openDock(mapWrap, markerData.id, markerData);
      }
    });
  }

  /* ── Build marker data list from loaded ops data ─────────── */
  function _buildMarkerDataList() {
    const list = [];

    COMMAND_MARKERS.forEach(b => {
      if (b.lat == null || b.lng == null) return;
      const sector = latLngToSector(b.lat, b.lng);
      const coord  = `${b.lat.toFixed(4)}, ${b.lng.toFixed(4)}`;
      list.push({
        id: b.id, kind: 'command',
        lat: b.lat, lng: b.lng, sector,
        title: 'BASE COMMAND',
        subs:    [b.label, coord, b.sector || '—'],
        expTitle: b.label.toUpperCase(),
        expSubs: [`Coords: ${coord}`, `Sector: ${b.sector || '—'}`, 'Status: ACTIVE'],
        _raw: { created_at: null, sensitivity_tier: 1 },
      });
    });

    SENSORS.forEach(s => {
      if (s.lat == null || s.lng == null) return;
      const sector = latLngToSector(s.lat, s.lng);
      const coord  = `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`;
      list.push({
        id: s.id, kind: 'sensor',
        lat: s.lat, lng: s.lng, sector,
        title: 'FIELD ASSET',
        subs:    [s.name, s.type || 'SENSOR', `Battery: ${s.battery}`],
        expTitle: s.name.toUpperCase(),
        expSubs: [`Coords: ${coord}`, `Type: ${s.type}`, `Status: ${s.status}`, `Battery: ${s.battery}`, `Last sync: ${s.lastSync}`],
        _raw: { created_at: null, sensitivity_tier: 1, validation_status: s.status },
      });
    });

    RANGERS.forEach(r => {
      if (r.lat == null || r.lng == null) return;
      const sector = latLngToSector(r.lat, r.lng);
      const coord  = `${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}`;
      list.push({
        id: r.id, kind: 'ranger',
        lat: r.lat, lng: r.lng, sector,
        title: 'FIELD ASSET',
        subs:    [r.name, r.sector, `Status: ${r.label}`],
        expTitle: r.name.toUpperCase(),
        expSubs: [`Coords: ${coord}`, `Sector: ${r.sector}`, `Status: ${r.label}`, `Last ping: ${r.lastPing}`],
        _raw: { created_at: r.lastPing !== '—' ? r.lastPing : null, sensitivity_tier: 1, validation_status: r.status, submitted_by: r.name },
      });
    });

    SIGHTINGS.forEach(s => {
      if (s.lat == null || s.lng == null) return;
      const sector   = latLngToSector(s.lat, s.lng);
      const coord    = `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`;
      const kind     = s.kind === 'sighting' ? 'report' : 'default';
      list.push({
        id: s.id, kind,
        lat: s.lat, lng: s.lng, sector,
        title:    kind === 'report' ? 'SIGHTING REPORT' : 'FIELD REPORT',
        subs:     [s.label, `Tier ${s.tier}`, coord],
        expTitle: s.label.toUpperCase(),
        expSubs:  [`Coords: ${coord}`, `Tier: ${s.tier}`, `Status: ${s.status}`, s.submitted_by ? `By: ${s.submitted_by}` : null].filter(Boolean),
        _raw: {
          created_at: s.created_at,
          sensitivity_tier: s.tier,
          ai_confidence_score: s.confidence != null ? s.confidence * 100 : null,
          validation_status: s.status,
          species_name: s.label,
          description: s.description,
          submitted_by: s.submitted_by,
        },
      });
    });

    // Threats and cautions
    MARKERS.filter(m => m.kind === 'threat' || m.kind === 'caution').forEach(m => {
      if (m.lat == null || m.lng == null) return;
      const sector = latLngToSector(m.lat, m.lng);
      const coord  = `${m.lat.toFixed(4)}, ${m.lng.toFixed(4)}`;
      const alert  = ALL_ALERTS.find(a => a.id === m.id);
      list.push({
        id: m.id, kind: m.kind,
        lat: m.lat, lng: m.lng, sector,
        title:    m.kind === 'threat' ? 'THREAT DETECTED.' : 'CAUTION',
        subs:     [m.label, coord, alert ? `Conf: ${alert.conf}` : '—'],
        expTitle: m.label.toUpperCase(),
        expSubs:  [`Coords: ${coord}`, alert ? `Conf: ${alert.conf}` : null, alert ? `Source: ${alert.source}` : null, alert ? `Sector: ${alert.sector}` : null].filter(Boolean),
        _raw: {
          created_at: alert ? alert.time : null,
          sensitivity_tier: m.kind === 'threat' ? 4 : 3,
          ai_confidence_score: alert ? parseFloat(alert.conf) * 100 : null,
          validation_status: m.kind === 'threat' ? 'ALERT' : 'CAUTION',
          species_name: m.label,
          submitted_by: alert ? alert.source : null,
        },
      });
    });

    return list;
  }

  /* ── Mount markers on Leaflet map ────────────────────────── */
  function _mountOpsMarkers(animate = true) {
    if (!_leafletMap) return;

    const prevRefs = _opsMarkerRefs; // saved for atomic swap — removed AFTER new ones are added

    if (_markerDataList.length === 0) return;

    const sectorCounts = {};
    _markerDataList.forEach(m => { sectorCounts[m.sector] = (sectorCounts[m.sector] || 0) + 1; });

    const sorted = [..._markerDataList].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    const refs = [];

    sorted.forEach(m => {
      const meta  = VARIANT_META[m.kind] || VARIANT_META.default;
      const scale = tierScale(m._raw?.sensitivity_tier || 1);

      const wrapper = document.createElement('div');
      wrapper.className = 'ops-reticle-card ops-mini';
      wrapper.dataset.markerId = m.id;
      wrapper.dataset.kind     = m.kind;

      const svg    = makeSVG(meta, scale, normaliseConf(m._raw?.ai_confidence_score));
      svg.style.display = 'none';

      const triSvg = makeMiniTriangle(meta, scale);
      triSvg.style.display = 'none';

      wrapper.appendChild(triSvg);
      wrapper.appendChild(svg);
      wrapper.appendChild(makeInfoPanel(m, meta));
      wrapper.appendChild(makeExpandedPanel(m, meta));

      const icon = L.divIcon({
        className:  'ops-leaflet-icon',
        html:       wrapper,
        iconSize:   [520, 230],
        iconAnchor: [Math.round(10 * scale), Math.round(10 * scale)],
      });

      const latlng        = L.latLng(m.lat, m.lng);
      const leafletMarker = L.marker(latlng, { icon, interactive: true }).addTo(_leafletMap);
      refs.push({ card: wrapper, svg, tri: triSvg, meta, latlng, leafletMarker, markerData: m, scale });
    });

    // Swap atomically: new markers are on the map before old ones leave
    _opsMarkerRefs = refs;
    prevRefs.forEach(({ leafletMarker }) => leafletMarker.remove());

    if (animate) {
      requestAnimationFrame(() => { _runIntroSequence(refs); });
    } else {
      // Silent refresh — show triangles immediately at their decay opacity
      refs.forEach(({ card, svg, tri, markerData }) => {
        svg.style.display = 'none';
        card.classList.add('ops-mini');
        tri.style.display = 'block';
        tri.style.opacity = String(decayOpacity(markerData._raw?.created_at));
        const { isFresh } = formatAge(markerData._raw?.created_at);
        if (isFresh) tri.classList.add('ts-fresh');
      });
    }
    refs.forEach(({ card, svg, latlng, markerData }) => bindMarkerInteractions(card, svg, latlng, markerData));
  }

  /* ── Intro animation sequence ────────────────────────────── */
  function _runIntroSequence(refs) {
    const groups  = KIND_ORDER.map(kind => refs.filter(r => r.card.dataset.kind === kind));
    let groupDelay = 0;
    const STAGGER = 100, ANIM_DUR = 620, GROUP_GAP = 150;
    const allPromises = [];

    groups.forEach(group => {
      group.forEach((ref, i) => {
        const startAt = groupDelay + i * STAGGER;
        const p = new Promise(resolve => {
          setTimeout(() => {
            ref.card.classList.remove('ops-mini');
            ref.svg.style.display = 'block';
            animateReticle(ref.svg).then(resolve);
          }, startAt);
        });
        allPromises.push(p);
      });
      groupDelay += (group.length - 1) * STAGGER + ANIM_DUR + GROUP_GAP;
    });

    Promise.all(allPromises).then(() => {
      setTimeout(() => {
        refs.forEach(({ card, svg, tri, leafletMarker, markerData }) => {
          svg.style.transition = 'opacity 0.3s ease';
          svg.style.opacity    = '0';
          setTimeout(() => {
            svg.style.display     = 'none';
            svg.style.opacity     = '';
            svg.style.transition  = '';
            resetSVGOpacity(svg);
            card.classList.add('ops-mini');
            tri.style.display = 'block';

            const decay = decayOpacity(markerData._raw?.created_at);
            const { isFresh } = formatAge(markerData._raw?.created_at);
            let c = 0;
            function flickerTri() {
              tri.style.opacity = c % 2 === 0 ? String(decay) : '0';
              c++;
              if (c <= 5) setTimeout(flickerTri, 40 + Math.random() * 40);
              else {
                tri.style.opacity = String(decay);
                const el = leafletMarker.getElement();
                if (el) el.dataset.decayOpacity = String(decay);
                if (isFresh) tri.classList.add('ts-fresh');
              }
            }
            flickerTri();
          }, 320);
        });
      }, 400);
    });
  }

  /* ── Initialise Leaflet map ──────────────────────────────── */
  function _initLeafletMap(container) {
    if (_leafletMap) return;

    const map = L.map(container, {
      center: [-1.285, 36.875],
      zoom: 10,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    // Legend
    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = () => {
      const div = L.DomUtil.create('div', 'ops-map-legend');
      div.innerHTML = `
        <div class="ops-legend-title">MARKER KEY</div>
        ${[
          ['#ff3333', 'Threat'],
          ['#ffcc44', 'Caution'],
          ['#b8f000', 'Ranger'],
          ['#00e5ff', 'Sensor'],
          ['#66ccff', 'Sighting (validated)'],
          ['#ffffff', 'Field Report / Base'],
        ].map(([c, l]) => `<div class="ops-legend-row"><span class="ops-legend-dot" style="border-color:${c};box-shadow:0 0 4px ${c}44"></span><span>${l}</span></div>`).join('')}`;
      return div;
    };
    legend.addTo(map);

    _leafletMap = map;
  }

  /* ── Fit map to all mounted markers ─────────────────────── */
  function _fitToMarkers() {
    if (!_leafletMap || _markerDataList.length === 0) return;
    const coords = _markerDataList.map(m => [m.lat, m.lng]);
    const bounds = L.latLngBounds(coords);
    _leafletMap.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
  }

  /* ── Update ops drawer without full re-render ────────────── */
  function _updateDrawer() {
    const drawerBody = _container?.querySelector('.ops-drawer__body');
    if (!drawerBody) return;
    const entity = resolveEntity(state.selectedMarkerId);
    drawerBody.innerHTML = buildDrawer(entity);
    _bindDrawerButtons();
  }

  function _bindDrawerButtons() {
    const root = _container;
    if (!root) return;
    const deployBtn = root.querySelector('#ops-btn-deploy');
    if (deployBtn) deployBtn.addEventListener('click', () => {
      const id = state.selectedMarkerId;
      if (id && !state.ackedIds.includes(id)) state.ackedIds.push(id);
      API.post('/ops/actions', { type: 'deploy', target_id: id })
        .then(() => Toast.success('Team deployed'))
        .catch(() => Toast.warning('Action logged locally — server sync failed'));
    });
    const clearedBtn = root.querySelector('#ops-btn-cleared');
    if (clearedBtn) clearedBtn.addEventListener('click', () => {
      const id = state.selectedMarkerId;
      if (id && !state.ackedIds.includes(id)) state.ackedIds.push(id);
      API.post('/ops/actions', { type: 'clear', target_id: id })
        .then(() => Toast.success('Threat marked cleared'))
        .catch(() => Toast.warning('Action logged locally — server sync failed'));
    });
    const commsBtn = root.querySelector('#ops-btn-comms');
    if (commsBtn) commsBtn.addEventListener('click', () => {
      API.post('/ops/actions', { type: 'comms', target_id: state.selectedMarkerId })
        .then(() => Toast.success('Comms channel opened'))
        .catch(() => Toast.error('Could not open comms'));
    });
    const waypointBtn = root.querySelector('#ops-btn-waypoint');
    if (waypointBtn) waypointBtn.addEventListener('click', () => {
      API.post('/ops/actions', { type: 'waypoint', target_id: state.selectedMarkerId })
        .then(() => Toast.success('Waypoint sent'))
        .catch(() => Toast.error('Could not send waypoint'));
    });
    const closeBtn = root.querySelector('#ops-drawer-close');
    if (closeBtn) closeBtn.addEventListener('click', () => {
      state.selectedMarkerId = null;
      state.selectedRangerId = null;
      state.selectedAlertId  = null;
      _updateDrawer();
    });
  }

  /* ── Data loader ─────────────────────────────────────────── */
  async function loadOpsData() {
    const data = await API.get('/ops/summary');
    console.log('[OPS] summary received — rangers:', data.rangers?.length, 'threats:', data.threats?.length, 'sensors:', data.sensors?.length, 'bases:', data.command_bases?.length, 'sightings:', data.sightings?.length);

    RANGERS = data.rangers.map(r => ({
      id:       r.id,
      user_id:  r.user_id,
      name:     r.name,
      sector:   r.region || r.team || '—',
      lastPing: r.lastPing || '—',
      status:   r.status  || 'idle',
      label:    _statusLabel(r.status),
      lat:      r.lat  ?? null,
      lng:      r.lng  ?? null,
      home_lat: r.home_lat ?? null,
      home_lng: r.home_lng ?? null,
    }));

    const threatMarkers = data.threats
      .filter(t => t.lat !== null && t.lng !== null)
      .map(t => {
        return { id: t.id, kind: t.kind, lat: t.lat, lng: t.lng, label: t.label };
      });

    COMMAND_MARKERS = (data.command_bases || []).map(b => ({
      id: b.id, base_id: b.base_id, kind: 'command',
      label: b.label, lat: b.lat, lng: b.lng, sector: b.sector || null,
    }));

    SIGHTINGS = data.sightings || [];

    ALL_ALERTS = data.alerts;
    SENSORS    = data.sensors;
    MARKERS    = [...COMMAND_MARKERS, ...threatMarkers];

    const serverAcked = data.alerts.filter(a => a.acked_by_me).map(a => a.id);
    state.ackedIds = [...new Set([...state.ackedIds, ...serverAcked])];

    // Build testSite-compatible marker list
    _markerDataList = _buildMarkerDataList();
  }

  function _statusLabel(status) {
    return { go: 'On patrol', warn: 'Caution', alert: 'Lost signal', idle: 'Standing by' }[status] || 'Standing by';
  }

  /* ── Poll tick ───────────────────────────────────────────── */
  async function _pollTick() {
    // Snapshot IDs before the fetch so we can detect set changes
    const prevIds = new Set(_markerDataList.map(m => m.id));

    try { await loadOpsData(); } catch { return; }

    const liveIds = new Set(ALL_ALERTS.map(a => a.id));
    state.ackedIds = state.ackedIds.filter(id => liveIds.has(id));

    // Only remount if the marker set actually changed (new/removed entities)
    const newIds   = new Set(_markerDataList.map(m => m.id));
    const changed  = newIds.size !== prevIds.size || [...newIds].some(id => !prevIds.has(id));
    if (changed && state.activeTab === 'live-map' && _leafletMap) {
      _mountOpsMarkers(false);
    }

    // Update non-map panels without touching the leaflet container
    _refreshSidePanels();
  }

  function _refreshSidePanels() {
    if (!_container) return;
    const alerts = activeAlerts();
    const left = _container.querySelector('.ops-left');
    if (left) {
      left.querySelector('[data-panel="alerts"]')?.remove();
      left.querySelector('[data-panel="roster"]')?.remove();
      left.querySelector('[data-panel="sensors"]')?.remove();
      left.insertAdjacentHTML('beforeend', buildSensorsPanel());
      left.insertAdjacentHTML('afterbegin', buildRosterPanel());
      left.insertAdjacentHTML('afterbegin', buildAlertPanel(alerts));
      _bindPanelEvents();
    }
    injectTopbarStrip();
    tickClock();
  }

  /* ── Derived ─────────────────────────────────────────────── */
  function activeAlerts() {
    return ALL_ALERTS.filter(a => !state.ackedIds.includes(a.id));
  }

  /* ── Resolve entity for drawer ───────────────────────────── */
  function resolveEntity(markerId) {
    const id = markerId || state.selectedMarkerId;
    if (!id) return null;

    const m = _markerDataList.find(x => x.id === id);
    if (!m) return null;

    if (m.kind === 'threat' || m.kind === 'caution') {
      const alert = ALL_ALERTS.find(a => a.id === m.id);
      return {
        kind: 'threat',
        marker: m,
        name: `${m.expTitle} · ${m.sector}`,
        fields: [
          ['Confidence', alert ? alert.conf : '—'],
          ['Source',     alert ? alert.source : '—'],
          ['Sector',     m.sector],
          ['Coords',     `${m.lat.toFixed(4)}, ${m.lng.toFixed(4)}`],
          ['Detected',   alert ? `${alert.time}` : '—'],
        ],
        detail: 'Suspicious activity detected. See DETAIL for full report.',
      };
    }
    if (m.kind === 'ranger') {
      const r = RANGERS.find(x => x.id === m.id);
      return {
        kind: 'ranger', marker: m, name: m.expTitle,
        fields: [
          ['Sector',    r ? r.sector    : '—'],
          ['Last ping', r ? r.lastPing  : '—'],
          ['Status',    r ? r.label     : '—'],
          ['Coords',    `${m.lat.toFixed(4)}, ${m.lng.toFixed(4)}`],
        ],
      };
    }
    if (m.kind === 'report' || m.kind === 'default') {
      const s = SIGHTINGS.find(x => x.id === m.id);
      return {
        kind: m.kind, marker: m, name: m.expTitle,
        fields: [
          ['Species',      m.expTitle],
          ['Status',       s ? s.status : '—'],
          ['Tier',         s ? `Tier ${s.tier}` : '—'],
          ['Confidence',   s?.confidence != null ? `${Math.round(s.confidence * 100)}%` : '—'],
          ['Submitted by', s?.submitted_by || '—'],
          ['Coords',       `${m.lat.toFixed(4)}, ${m.lng.toFixed(4)}`],
        ],
        detail: s?.description || 'Field sighting record.',
      };
    }
    if (m.kind === 'sensor') {
      const s = SENSORS.find(x => x.id === m.id);
      return {
        kind: 'sensor', marker: m, name: m.expTitle,
        fields: [
          ['Type',      s ? s.type    : '—'],
          ['Status',    s ? s.status  : '—'],
          ['Battery',   s ? s.battery : '—'],
          ['Last sync', s ? s.lastSync : '—'],
          ['Coords',    `${m.lat.toFixed(4)}, ${m.lng.toFixed(4)}`],
        ],
      };
    }
    return {
      kind: 'asset', marker: m, name: m.expTitle,
      fields: [
        ['Type',   'Command Base'],
        ['Status', 'Active'],
        ['Coords', `${m.lat.toFixed(4)}, ${m.lng.toFixed(4)}`],
        ['Sector', m.sector],
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

  function buildInnerNav() {
    const items = INNER_NAV.map(tab => `
          <button class="ops-nav__item ${state.activeTab === tab.id ? 'is-active' : ''}"
                  data-tab="${tab.id}" title="${tab.label}">
            <span class="ops-nav__icon">${tab.icon}</span>
            <span class="ops-nav__label">${tab.label}</span>
          </button>`).join('');
    return `<nav class="ops-nav">${items}</nav>`;
  }

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

  function buildSensorsPanel() {
    const rows = SENSORS.map(s => `
          <li class="ops-sensor-row ops-sensor-row--${s.status}" data-sensor-id="${s.id}" role="button" tabindex="0">
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

  function buildHelpPanel() {
    const items = [
      ['Hover △',       'Show info panel for marker'],
      ['Click △',       'Restore reticle + fly to marker'],
      ['Click reticle', 'Expand detail panel + fly'],
      ['Double-click',  'Max zoom + all panels open'],
      ['DETAIL button', 'Open full detail dock'],
      ['Ack button',    'Acknowledge alert'],
      ['Roster row',    'Fly to ranger on map'],
      ['Alert row',     'Fly to threat on map'],
      ['ESC',           'Close focused marker'],
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

  function buildDrawer(entity) {
    if (!entity) {
      return `
            <div class="ops-drawer__empty">
              <div class="ops-eyebrow">No selection</div>
              <p style="font-size:12.5px;color:var(--clr-text-dim);line-height:1.55;margin:0">
                Click a marker on the map to inspect.
              </p>
            </div>`;
    }

    const kindLabel = { threat: 'Threat', caution: 'Caution', ranger: 'Ranger', sensor: 'Sensor', asset: 'Asset', report: 'Sighting', default: 'Field Report' }[entity.kind] || 'Entity';
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
    } else if (entity.kind === 'report' || entity.kind === 'default') {
      sectionHtml = `
            <div class="ops-section">
              <div class="ops-section__label">Notes</div>
              <p class="ops-section__text">${entity.detail || 'No description recorded.'}</p>
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
              <button class="ops-btn ops-btn--ghost" id="ops-btn-comms">Open comms</button>
              <button class="ops-btn ops-btn--primary" id="ops-btn-waypoint">Send waypoint</button>
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

  function buildTabContent() {
    const alerts = activeAlerts();
    switch (state.activeTab) {
      case 'alerts':  return buildAlertPanel(alerts);
      case 'roster':  return buildRosterPanel();
      case 'sensors': return buildSensorsPanel();
      case 'drone':   return buildDronePanel();
      case 'help':    return buildHelpPanel();
      default:        return '';
    }
  }

  /* ═══════════════════════════════════════════════════════════
     FULL PAGE RENDER
  ═══════════════════════════════════════════════════════════ */
  function renderPage() {
    if (!_container) return;
    const alerts   = activeAlerts();
    const entity   = resolveEntity(state.selectedMarkerId);
    const isMapTab = state.activeTab === 'live-map';

    // Detach the Leaflet container before innerHTML wipe so it survives
    const leafletContainer = _leafletMap ? _leafletMap.getContainer() : null;
    if (leafletContainer) leafletContainer.remove();

    _container.innerHTML = `
        <div class="ops-console">
          ${buildInnerNav()}
          ${isMapTab ? `
          <div class="ops-left">
            ${buildAlertPanel(alerts)}
            ${buildRosterPanel()}
            ${buildSensorsPanel()}
          </div>
          <div class="ops-map" id="ops-map-col"></div>
          <div class="ops-drawer${state.drawerCollapsed ? ' ops-drawer--collapsed' : ''}">
            <button class="ops-drawer__toggle" id="ops-drawer-toggle"
              title="${state.drawerCollapsed ? 'Expand panel' : 'Collapse panel'}"
              aria-label="${state.drawerCollapsed ? 'Expand panel' : 'Collapse panel'}">
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

    if (isMapTab) {
      const mapCol = _container.querySelector('#ops-map-col');
      if (leafletContainer && _leafletMap) {
        // Re-attach the preserved Leaflet container
        mapCol.appendChild(leafletContainer);
        _leafletMap.invalidateSize();
      } else {
        // First render — create the map
        const mapDiv = document.createElement('div');
        mapDiv.id    = 'ops-leaflet-map';
        mapDiv.style.cssText = 'width:100%;height:100%;';
        mapCol.appendChild(mapDiv);
        _initLeafletMap(mapDiv);
        _mountOpsMarkers();
        setTimeout(_fitToMarkers, 200); // after tiles load
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════
     EVENT BINDING
  ═══════════════════════════════════════════════════════════ */
  function bindEvents() {
    const root = _container;

    root.querySelectorAll('.ops-nav__item').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeTab = btn.dataset.tab;
        renderPage();
      });
    });

    _bindPanelEvents();

    // Drawer collapse toggle
    const drawerToggle = root.querySelector('#ops-drawer-toggle');
    if (drawerToggle) drawerToggle.addEventListener('click', () => {
      state.drawerCollapsed = !state.drawerCollapsed;
      localStorage.setItem(DRAWER_COLLAPSED_KEY, state.drawerCollapsed ? '1' : '0');
      const drawer = root.querySelector('.ops-drawer');
      if (drawer) {
        drawer.classList.toggle('ops-drawer--collapsed', state.drawerCollapsed);
        drawerToggle.textContent = state.drawerCollapsed ? '«' : '»';
      }
    });

    _bindDrawerButtons();

    if (!root._opsEscBound) {
      root._opsEscBound = true;
      document.addEventListener('keydown', _onEsc);
    }
  }

  function _bindPanelEvents() {
    const root = _container;

    // Alert rows
    root.querySelectorAll('.ops-alert-row').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.alertId;
        state.selectedAlertId  = id;
        state.selectedMarkerId = id;
        state.selectedRangerId = null;
        if (state.activeTab !== 'live-map') { state.activeTab = 'live-map'; renderPage(); return; }
        // Fly to marker on the Leaflet map
        const m = _markerDataList.find(x => x.id === id);
        if (m && _leafletMap) _leafletMap.flyTo([m.lat, m.lng], Math.max(_leafletMap.getZoom(), 14), { animate: true, duration: 0.7 });
        _updateDrawer();
      });
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') el.click(); });
    });

    // Ack buttons
    root.querySelectorAll('.ops-ack-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = btn.dataset.ackId;
        if (!state.ackedIds.includes(id)) state.ackedIds.push(id);
        if (state.selectedAlertId === id) {
          state.selectedAlertId  = null;
          state.selectedMarkerId = null;
        }
        _refreshSidePanels();
        API.patch(`/ops/alerts/${id}/ack`).catch(err => console.warn('[OPS] ACK persist failed:', err.message));
      });
    });

    // Sensor rows — fly to sensor on the map
    root.querySelectorAll('.ops-sensor-row').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.sensorId;
        state.selectedMarkerId = id;
        state.selectedRangerId = null;
        state.selectedAlertId  = null;
        if (state.activeTab !== 'live-map') { state.activeTab = 'live-map'; renderPage(); return; }
        const m = _markerDataList.find(x => x.id === id);
        if (m && _leafletMap) _leafletMap.flyTo([m.lat, m.lng], Math.max(_leafletMap.getZoom(), 14), { animate: true, duration: 0.7 });
        _updateDrawer();
      });
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') el.click(); });
    });

    // Roster rows — fly to ranger if they have a position
    root.querySelectorAll('.ops-roster-row').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.rangerId;
        state.selectedRangerId = id;
        state.selectedMarkerId = id;
        state.selectedAlertId  = null;
        if (state.activeTab !== 'live-map') { state.activeTab = 'live-map'; renderPage(); return; }
        const m = _markerDataList.find(x => x.id === id);
        if (m && _leafletMap) _leafletMap.flyTo([m.lat, m.lng], Math.max(_leafletMap.getZoom(), 14), { animate: true, duration: 0.7 });
        _updateDrawer();
      });
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') el.click(); });
    });
  }

  function _onEsc(e) {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.ops-reticle-card.ops-expanded, .ops-reticle-card:not(.ops-mini)').forEach(card => {
      const svg = card.querySelector('.ops-reticle-svg');
      if (svg) collapseToTriangle(card, svg);
    });
  }

  /* ── Topbar strip ────────────────────────────────────────── */
  function injectTopbarStrip() {
    const right = document.querySelector('.topbar__right');
    if (!right) return;
    right.querySelector('.ops-topbar-strip')?.remove();
    right.insertAdjacentHTML('afterbegin', buildTopbarStrip(activeAlerts()));
  }

  function removeTopbarStrip() {
    document.querySelector('.ops-topbar-strip')?.remove();
  }

  /* ── Loading / error screens ─────────────────────────────── */
  function renderLoading() {
    if (!_container) return;
    _container.innerHTML = `
      <div class="ops-console ops-console--loading">
        <div class="ops-load-state">
          <span class="ops-live-dot" style="margin-right:8px"></span>
          <span class="ops-eyebrow">Connecting to ops network…</span>
        </div>
      </div>`;
  }

  function renderLoadError(err) {
    console.error('[OPS] Failed to load summary:', err);
    if (!_container) return;
    const msg = err?.message || String(err);
    _container.innerHTML = `
      <div class="ops-console ops-console--loading">
        <div class="ops-load-state">
          <span class="ops-eyebrow" style="color:rgba(255,60,60,0.8)">
            Could not connect to ops network
          </span>
          <span style="font-size:10.5px;color:rgba(255,100,100,0.65);margin-top:6px;font-family:monospace;max-width:380px;text-align:center;line-height:1.5">
            ${msg}
          </span>
          <button class="ops-btn ops-btn--ghost" id="ops-retry-btn"
                  style="margin-top:12px;font-size:11px">Retry</button>
        </div>
      </div>`;
    _container.querySelector('#ops-retry-btn')?.addEventListener('click', () => _bootstrapOps(_container));
  }

  async function _bootstrapOps(container) {
    renderLoading();
    try {
      await loadOpsData();
    } catch (err) {
      renderLoadError(err);
      return;
    }

    renderPage();
    injectTopbarStrip();
    tickClock();
    _clockId = setInterval(tickClock, 1000);
    _pollId  = setInterval(_pollTick, POLL_INTERVAL_MS);
  }

  /* ── Public API ──────────────────────────────────────────── */
  function render(container) {
    state = {
      ackedIds:          [],
      selectedMarkerId:  null,
      selectedRangerId:  null,
      selectedAlertId:   null,
      callout:           null,
      activeTab:         'live-map',
      utcTime:           '--:--:--',
      drawerCollapsed:   localStorage.getItem(DRAWER_COLLAPSED_KEY) === '1',
    };

    _container = container;
    container.style.padding  = '0';
    container.style.overflow = 'hidden';
    container.style.position = 'relative';

    _bootstrapOps(container);
  }

  function destroy() {
    clearInterval(_clockId);
    clearInterval(_pollId);
    _clockId = null;
    _pollId  = null;
    document.removeEventListener('keydown', _onEsc);
    if (_container) _container._opsEscBound = false;
    _container = null;

    if (_leafletMap) {
      _leafletMap.remove();
      _leafletMap = null;
    }
    _opsMarkerRefs = [];
    _markerDataList = [];

    removeTopbarStrip();
  }

  return { render, destroy };

})();
