/* ============================================================
   TERRA – reportDetail.js
   Multi-panel framed dashboard. CSS prefix: rd-*

   Layout:
     Ruler bar
     Grid row A  [Identity | Confidence | Threat Matrix]
     Grid row B  [Evidence | Mini Audit | AI Brief]
     Actions bar
     Grid row C  [Tabs + full-width widget area]

   Navigation:
     Router.navigate('report-detail', { reportId: 'uuid' })
   ============================================================ */

const ReportDetailPage = (() => {

  const NS = 'http://www.w3.org/2000/svg';

  /* ══════════════════════════════════════════════════════════
     SPECIES REFERENCE DATABASE
  ══════════════════════════════════════════════════════════ */
  const SPECIES_DB = {
    'lion': { common: 'Lion', sci: 'Panthera leo', iucn: 'VU', icon: '🦁', habitat: 'Savanna, grassland, open woodland', diet: 'Carnivore — ungulates, buffalo, zebra', threats: 'Habitat loss, human-wildlife conflict, prey depletion', range: 'Sub-Saharan Africa, small population in India', notes: 'Apex predator; keystone species. Territorial prides up to 30.' },
    'cheetah': { common: 'Cheetah', sci: 'Acinonyx jubatus', iucn: 'VU', icon: '🐆', habitat: 'Open savanna, semi-arid regions', diet: 'Carnivore — small to medium antelope, gazelle', threats: 'Habitat fragmentation, human conflict, low genetic diversity', range: 'Eastern & Southern Africa, Iran', notes: 'Fastest land animal. Diurnal hunter. Solitary except coalitions.' },
    'elephant': { common: 'African Elephant', sci: 'Loxodonta africana', iucn: 'EN', icon: '🐘', habitat: 'Savanna, forest, wetlands, bushland', diet: 'Herbivore — grasses, bark, fruit, roots', threats: 'Ivory poaching, habitat loss, human-elephant conflict', range: 'Sub-Saharan Africa', notes: 'Largest land animal. Keystone ecosystem engineer. Matriarchal herds.' },
    'rhinoceros': { common: 'Black Rhinoceros', sci: 'Diceros bicornis', iucn: 'CR', icon: '🦏', habitat: 'Semi-arid savanna, scrub, woodland', diet: 'Browser — leaves, shoots, branches', threats: 'Horn poaching, habitat loss', range: 'Eastern & Southern Africa', notes: 'Hook-lipped browser. Solitary. Critically endangered from poaching.' },
    'leopard': { common: 'Leopard', sci: 'Panthera pardus', iucn: 'VU', icon: '🐆', habitat: 'Forest, savanna, mountains, desert margins', diet: 'Carnivore — wide prey base; caches kills in trees', threats: 'Habitat loss, bushmeat trade, human conflict', range: 'Africa, Middle East, South & East Asia', notes: 'Most adaptable big cat. Largely nocturnal. Solitary and territorial.' },
    'wildebeest': { common: 'Blue Wildebeest', sci: 'Connochaetes taurinus', iucn: 'LC', icon: '🐃', habitat: 'Open savanna, floodplain grassland', diet: 'Grazer — short grasses', threats: 'Habitat fragmentation interrupting migration corridors', range: 'Eastern & Southern Africa', notes: 'Annual Great Migration involves ~1.5M animals. Keystone prey species.' },
    'zebra': { common: 'Plains Zebra', sci: 'Equus quagga', iucn: 'NT', icon: '🦓', habitat: 'Grassland, savanna, woodland edges', diet: 'Grazer — coarse grasses', threats: 'Hunting, habitat loss, water access competition', range: 'Eastern & Southern Africa', notes: 'Migrates with wildebeest. Social herds. Unique stripe patterns.' },
    'giraffe': { common: 'Giraffe', sci: 'Giraffa camelopardalis', iucn: 'VU', icon: '🦒', habitat: 'Savanna, open woodland, bushland', diet: 'Browser — acacia, leaves, shoots', threats: 'Habitat loss, poaching, human disturbance', range: 'Sub-Saharan Africa', notes: 'Tallest land animal. Declining "silent extinction." Nine subspecies.' },
    'hippopotamus': { common: 'Hippopotamus', sci: 'Hippopotamus amphibius', iucn: 'VU', icon: '🦛', habitat: 'Rivers, lakes, wetlands', diet: 'Herbivore — short grass (grazes nocturnally)', threats: 'Poaching (ivory teeth), habitat loss, water scarcity', range: 'Sub-Saharan Africa', notes: 'Semi-aquatic megafauna. Highly territorial in water. Ecosystem engineers.' },
    'wild dog': { common: 'African Wild Dog', sci: 'Lycaon pictus', iucn: 'EN', icon: '🐕', habitat: 'Open savanna, woodland', diet: 'Carnivore — highly cooperative pack hunters', threats: 'Habitat loss, disease from domestic dogs, human persecution', range: 'Fragmented populations in eastern & southern Africa', notes: 'Most efficient predator by kill success rate (~80%). Pack sizes 6–20.' },
    'buffalo': { common: 'African Buffalo', sci: 'Syncerus caffer', iucn: 'LC', icon: '🐂', habitat: 'Savanna, woodland, wetlands', diet: 'Grazer — coarse grasses', threats: 'Disease (corridor disease), habitat encroachment', range: 'Sub-Saharan Africa', notes: 'Considered one of the most dangerous animals in Africa. Large herds.' },
  };

  function lookupSpecies(name) {
    if (!name) return null;
    const key = name.toLowerCase().trim();
    if (SPECIES_DB[key]) return SPECIES_DB[key];
    for (const [k, v] of Object.entries(SPECIES_DB)) {
      if (key.includes(k) || k.includes(key)) return v;
    }
    return null;
  }

  /* ══════════════════════════════════════════════════════════
     TABS
  ══════════════════════════════════════════════════════════ */
  const TABS = [
    { id: 'location', label: 'Location', defaultWidgets: ['map-location'] },
    { id: 'audit', label: 'Audit Log', defaultWidgets: [] },
    { id: 'species-intel', label: 'Species Intel', defaultWidgets: [] },
    { id: 'raw', label: 'Raw Data', defaultWidgets: [] },
  ];

  /* ══════════════════════════════════════════════════════════
     CINEMATIC LOADER
  ══════════════════════════════════════════════════════════ */
  function buildLoaderSVG() {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 130 120');
    svg.setAttribute('width', '130');
    svg.setAttribute('height', '120');
    svg.classList.add('rd-loader__svg');

    const fillBox = document.createElementNS(NS, 'rect');
    fillBox.setAttribute('x', '10'); fillBox.setAttribute('y', '10');
    fillBox.setAttribute('width', '100'); fillBox.setAttribute('height', '100');
    fillBox.setAttribute('fill', 'rgba(195,255,0,0.03)');
    svg.appendChild(fillBox);

    [
      '10,25 10,10 25,10',
      '95,110 110,110 110,95',
      '95,10 110,10 110,25',
      '10,95 10,110 25,110',
    ].forEach(pts => {
      const pl = document.createElementNS(NS, 'polyline');
      pl.setAttribute('stroke', 'rgba(195,255,0,0.55)');
      pl.setAttribute('stroke-width', '1.5');
      pl.setAttribute('fill', 'none');
      pl.setAttribute('points', pts);
      svg.appendChild(pl);
    });

    [[40, 60, 55, 60], [65, 60, 80, 60], [60, 40, 60, 55], [60, 65, 60, 80]].forEach(([x1, y1, x2, y2]) => {
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', x1); l.setAttribute('y1', y1);
      l.setAttribute('x2', x2); l.setAttribute('y2', y2);
      l.setAttribute('stroke', 'rgba(195,255,0,0.30)');
      l.setAttribute('stroke-width', '0.8');
      svg.appendChild(l);
    });

    const track = document.createElementNS(NS, 'rect');
    track.setAttribute('x', '116'); track.setAttribute('y', '10');
    track.setAttribute('width', '5'); track.setAttribute('height', '100');
    track.setAttribute('rx', '1');
    track.setAttribute('stroke', 'rgba(195,255,0,0.35)');
    track.setAttribute('stroke-width', '0.8');
    track.setAttribute('fill', 'none');
    svg.appendChild(track);

    const barFill = document.createElementNS(NS, 'rect');
    barFill.setAttribute('x', '116'); barFill.setAttribute('y', '38');
    barFill.setAttribute('width', '5'); barFill.setAttribute('height', '72');
    barFill.setAttribute('rx', '1');
    barFill.setAttribute('fill', 'rgba(195,255,0,0.5)');
    svg.appendChild(barFill);

    return svg;
  }

  function showLoader() {
    const cells = Array.from({ length: 96 }, () =>
      `<div class="rd-loader__grid-cell"></div>`
    ).join('');

    const loader = document.createElement('div');
    loader.className = 'rd-loader';
    loader.id = 'rd-loader';
    loader.innerHTML = `
      <div class="rd-loader__grid">${cells}</div>
      <div class="rd-loader__corner rd-loader__corner--tl"></div>
      <div class="rd-loader__corner rd-loader__corner--tr"></div>
      <div class="rd-loader__corner rd-loader__corner--bl"></div>
      <div class="rd-loader__corner rd-loader__corner--br"></div>
      <div class="rd-loader__sweep"></div>
      <div class="rd-loader__reticle">
        <div style="position:relative;display:flex;align-items:center;justify-content:center;">
          <div class="rd-loader__dot"></div>
        </div>
        <div class="rd-loader__status">Acquiring report data…</div>
      </div>`;

    const reticleWrap = loader.querySelector('.rd-loader__reticle > div');
    reticleWrap.insertBefore(buildLoaderSVG(), reticleWrap.firstChild);

    document.body.appendChild(loader);
    return loader;
  }

  function dismissLoader(loader) {
    if (!loader) return;
    loader.classList.add('rd-loader--exit');
    loader.addEventListener('animationend', () => loader.remove(), { once: true });
  }

  /* ══════════════════════════════════════════════════════════
     WATERMARK SVG
  ══════════════════════════════════════════════════════════ */
  const RETICLE_COLORS = {
    PENDING: { bracket: '#ffffff', bar: '#ffa200', fill: 'rgba(255,162,0,0.07)' },
    VALIDATED: { bracket: '#ffffff', bar: '#c3ff00', fill: 'rgba(195,255,0,0.05)' },
    REJECTED: { bracket: '#ffffff', bar: '#ff0000ff', fill: 'rgba(255,32,32,0.07)' },
  };

  function buildWatermarkSVG(status) {
    const m = RETICLE_COLORS[status] || RETICLE_COLORS.PENDING;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 130 120');
    svg.setAttribute('width', '200');
    svg.setAttribute('height', '185');

    const fill = document.createElementNS(NS, 'rect');
    fill.setAttribute('x', '10'); fill.setAttribute('y', '10');
    fill.setAttribute('width', '100'); fill.setAttribute('height', '100');
    fill.setAttribute('fill', m.fill);
    svg.appendChild(fill);

    [
      '10,30 10,10 30,10',
      '90,110 110,110 110,90',
      '90,10 110,10 110,30',
      '10,90 10,110 30,110',
    ].forEach(pts => {
      const pl = document.createElementNS(NS, 'polyline');
      pl.setAttribute('stroke', m.bracket);
      pl.setAttribute('stroke-width', '1.5');
      pl.setAttribute('fill', 'none');
      pl.setAttribute('points', pts);
      svg.appendChild(pl);
    });

    [[40, 60, 54, 60], [66, 60, 80, 60], [60, 40, 60, 54], [60, 66, 60, 80]].forEach(([x1, y1, x2, y2]) => {
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', x1); l.setAttribute('y1', y1);
      l.setAttribute('x2', x2); l.setAttribute('y2', y2);
      l.setAttribute('stroke', m.bar);
      l.setAttribute('stroke-width', '0.6');
      svg.appendChild(l);
    });

    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', '60'); dot.setAttribute('cy', '60');
    dot.setAttribute('r', '2.5');
    dot.setAttribute('fill', m.bar);
    svg.appendChild(dot);

    const track = document.createElementNS(NS, 'rect');
    track.setAttribute('x', '116'); track.setAttribute('y', '10');
    track.setAttribute('width', '5'); track.setAttribute('height', '100');
    track.setAttribute('rx', '1');
    track.setAttribute('stroke', m.bar);
    track.setAttribute('stroke-width', '0.7');
    track.setAttribute('fill', 'none');
    svg.appendChild(track);

    const barFill = document.createElementNS(NS, 'rect');
    barFill.setAttribute('x', '116'); barFill.setAttribute('y', '38');
    barFill.setAttribute('width', '5'); barFill.setAttribute('height', '72');
    barFill.setAttribute('rx', '1');
    barFill.setAttribute('fill', m.bar);
    svg.appendChild(barFill);

    return svg;
  }

  /* ══════════════════════════════════════════════════════════
     GPS ACCURACY
  ══════════════════════════════════════════════════════════ */
  function gpsHTML(accuracy) {
    if (!accuracy) return '<span style="color:var(--rd-dim)">Not recorded</span>';
    const m = parseFloat(accuracy);
    const cls = m <= 15 ? 'good' : m <= 50 ? 'fair' : 'poor';
    const label = m <= 15 ? 'High accuracy' : m <= 50 ? 'Fair accuracy' : 'Low accuracy';
    return `<span class="rd-gps-accuracy"><span class="rd-gps-dot rd-gps-dot--${cls}"></span>±${Math.round(m)}m · ${label}</span>`;
  }

  /* ══════════════════════════════════════════════════════════
     RULER
  ══════════════════════════════════════════════════════════ */
  function buildRuler(report) {
    const status = (report.validation_status || 'PENDING').toUpperCase();
    return `
      <div class="rd-ruler rd-reveal d1">
        <span class="rd-ruler__tick"></span>
        <span class="rd-ruler__label">Reports / Detail</span>
        <span class="rd-ruler__track"></span>
        <span class="rd-ruler__status-pill rd-ruler__status-pill--${status.toLowerCase()}">${status}</span>
        <button class="rd-btn" id="rd-btn-back">← Back</button>
      </div>`;
  }

  /* ══════════════════════════════════════════════════════════
     ROW A — three panels
  ══════════════════════════════════════════════════════════ */

  /* A1 — SPECIES IDENTITY
     Full species name as large display type, four data cells in a 2×2
     sub-grid separated by hairlines (matches reference image's labelled
     data-cell pattern), reticle watermark behind all content. */
  function buildPanelIdentity(report) {
    const status    = (report.validation_status || 'PENDING').toUpperCase();
    const tier      = report.sensitivity_tier || 1;
    const tierLabel = ['', 'Public', 'Protected', 'Restricted', 'Confidential'][tier] || '—';
    const dateStr   = report.created_at
      ? new Date(report.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
      : '—';
    const timeStr   = report.created_at
      ? new Date(report.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : '';
    const coordStr  = `${Number(report.latitude || 0).toFixed(5)}, ${Number(report.longitude || 0).toFixed(5)}`;
    const liveDot   = status === 'VALIDATED' ? '' : status === 'REJECTED' ? 'red' : 'amber';

    return `
      <div class="rd-frame rd-identity-panel">
        <div class="rd-frame__head">
          <span class="rd-frame__live rd-frame__live--${liveDot}"></span>
          <span class="rd-frame__title">Species Identity</span>
          <span class="rd-frame__subtitle">#${report.report_id ? report.report_id.slice(0, 8).toUpperCase() : '—'}</span>
        </div>

        <!-- Body: watermark behind text, species name + status badges up top,
             then a 2×2 grid of labelled data cells with hairline borders. -->
        <div class="rd-frame__body" style="position:relative;overflow:hidden;display:flex;flex-direction:column;gap:0;padding:0;">

          <!-- Watermark reticle (opacity set in CSS) -->
          <div class="rd-watermark" id="rd-watermark"></div>

          <!-- Species name block -->
          <div style="padding:12px 14px 10px;position:relative;z-index:1;border-bottom:1px solid var(--rd-border2);">
            <div class="rd-id-label" style="margin-bottom:4px;">Report · ${report.report_id || '—'}</div>
            <h1 class="rd-title">${report.species_name || 'Unknown Species'}</h1>
            <div class="rd-badges" style="margin-top:6px;">
              <span class="rd-badge rd-badge--${status.toLowerCase()}">${status}</span>
              <span class="rd-badge rd-badge--tier">Tier ${tier} · ${tierLabel}</span>
              ${report.region_id ? `<button class="rd-region-chip" id="rd-region-chip">◉ ${report.region_id}</button>` : ''}
            </div>
          </div>

          <!-- 2×2 data cells — each cell has a muted label and a larger value,
               separated by the same hairline border used in reference panels. -->
          <div class="rd-meta-grid" style="flex:1;position:relative;z-index:1;">
            <div class="rd-meta-item">
              <span class="rd-meta-item__label">Submission Date</span>
              <span class="rd-meta-item__value">${dateStr}${timeStr ? ` · ${timeStr}` : ''}</span>
            </div>
            <div class="rd-meta-item">
              <span class="rd-meta-item__label">Submitted By</span>
              <span class="rd-meta-item__value">${report.submitter_name || 'Anonymous'}</span>
            </div>
            <div class="rd-meta-item">
              <span class="rd-meta-item__label">Coordinates</span>
              <span class="rd-meta-item__value" style="font-size:9px;letter-spacing:0.02em;">${coordStr}</span>
            </div>
            <div class="rd-meta-item">
              <span class="rd-meta-item__label">GPS Accuracy</span>
              <span class="rd-meta-item__value">${gpsHTML(report.gps_accuracy)}</span>
            </div>
          </div>

        </div>
      </div>`;
  }

  /* A2 — AI CONFIDENCE
     Oversized percentage number (like the "72,600 Page View" in the reference),
     an animated progress bar, risk badge, then a scrollable criteria breakdown
     list — each criterion is a row of label + boost score. */
  function buildPanelConfidence(report) {
    const confVal   = Number(report.ai_confidence_score || 0);
    const breakdown = Array.isArray(report.confidence_breakdown) ? report.confidence_breakdown : [];
    const passed    = breakdown.filter(i => i.status === 'PASSED');
    const failed    = breakdown.filter(i => i.status !== 'PASSED');

    /* All criteria shown: passed ones glow green, failed ones are dimmed. */
    const allCriteria = [
      ...passed.map(c => ({ ...c, ok: true })),
      ...failed.map(c => ({ ...c, ok: false })),
    ];
    const criteriaHTML = allCriteria.length === 0
      ? `<div class="rd-criteria-row" style="opacity:0.4;font-style:italic;">No criteria data.</div>`
      : allCriteria.map(c => `
          <div class="rd-criteria-row" style="${c.ok ? '' : 'opacity:0.35;'}">
            <span class="rd-criteria-row__label">
              <span class="rd-criteria-row__plus" style="color:${c.ok ? 'var(--rd-green)' : 'var(--rd-dim)'};">${c.ok ? '+' : '–'}</span>
              ${c.label}
            </span>
            <span class="rd-criteria-row__boost" style="color:${c.ok ? 'var(--rd-green)' : 'var(--rd-dim)'};">${c.boost ?? ''}</span>
          </div>`).join('');

    /* Five segmented bar ticks to show score visually at a glance. */
    const segments = [20, 40, 60, 80, 100].map(threshold => {
      const active = confVal >= threshold - 19;
      return `<div style="flex:1;height:100%;background:${active ? `rgba(195,255,0,${0.15 + confVal / 500})` : 'rgba(255,255,255,0.04)'};border-right:1px solid var(--rd-border2);transition:background 1s ease;"></div>`;
    }).join('');

    return `
      <div class="rd-frame rd-conf-panel">
        <div class="rd-frame__head">
          <span class="rd-frame__live"></span>
          <span class="rd-frame__title">AI Confidence Score</span>
          <span class="rd-frame__subtitle" id="rd-brief-status-badge">${passed.length}/${breakdown.length} criteria</span>
        </div>
        <div class="rd-frame__body rd-frame__body--scroll" style="display:flex;flex-direction:column;gap:0;padding:0;">

          <!-- Score block: large number like reference "72,600" stat cards. -->
          <div style="padding:14px 14px 10px;border-bottom:1px solid var(--rd-border2);">
            <div style="font-size:7px;letter-spacing:0.18em;text-transform:uppercase;color:var(--rd-dim);margin-bottom:6px;">
              Confidence Score
            </div>
            <div class="rd-conf-big" id="rd-conf-number">${Math.round(confVal)}<span class="rd-conf-big__unit">%</span></div>

            <!-- Segmented bar — 5 equal chunks, filled proportionally -->
            <div style="display:flex;height:4px;background:var(--rd-border2);margin:10px 0 4px;overflow:hidden;" id="rd-seg-bar">
              ${segments}
            </div>
            <div style="display:flex;justify-content:space-between;font-size:7px;color:var(--rd-dim);">
              <span>Low</span><span>Moderate</span><span>High</span>
            </div>

            <!-- Animated thin fill bar (updated by animateConfBar) -->
            <div class="rd-conf-bar" style="margin-top:6px;">
              <div class="rd-conf-bar__fill" id="rd-conf-fill" style="width:0%"></div>
            </div>

            <!-- Risk badge injected here by fetchAndRenderBrief -->
            <div id="rd-risk-badge" style="margin-top:8px;"></div>
          </div>

          <!-- Scrollable criteria list -->
          <div style="padding:6px 0;flex:1;">
            <div style="padding:4px 14px 6px;font-size:7px;letter-spacing:0.16em;text-transform:uppercase;color:var(--rd-dim);border-bottom:1px solid var(--rd-border2);">
              Criteria Breakdown
            </div>
            <div class="rd-criteria-rows">${criteriaHTML}</div>
          </div>

        </div>
      </div>`;
  }

  /* A3 — THREAT MATRIX
     3×3 colour-intensity grid where the active cell (intersection of this
     report's tier and confidence band) is highlighted. Below: a data summary
     with tier name and confidence band as labelled rows. */
  function buildPanelThreat(report) {
    const tier     = Math.min(report.sensitivity_tier || 1, 3) - 1; /* 0-based col */
    const conf     = report.ai_confidence_score || 0;
    const confRow  = conf >= 75 ? 0 : conf >= 40 ? 1 : 2;
    /* intensity[row][col] → 0=none, 1=green, 2=amber, 3=red */
    const intensity = [[1, 2, 3], [0, 1, 2], [0, 0, 1]];
    const confLabels = ['≥75% High', '≥40% Mid', '<40% Low'];
    const tierLabels = ['T1 Public', 'T2 Protected', 'T3 Restricted'];

    let cells = '';
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const lvl    = intensity[row][col];
        const active = row === confRow && col === tier ? ' rd-tm-cell--active' : '';
        cells += `<div class="rd-tm-cell rd-tm-cell--${lvl}${active}"
          title="${tierLabels[col]} / ${confLabels[row]}"></div>`;
      }
    }

    const tierName = ['Public', 'Protected', 'Restricted'][tier];
    const confBand = ['High', 'Mid', 'Low'][confRow];
    const riskLevel = intensity[confRow][tier]; /* 0–3 */
    const riskLabels = ['Minimal', 'Low', 'Moderate', 'High'];
    const riskColors = ['var(--rd-dim)', 'var(--rd-green)', 'var(--rd-amber)', 'var(--rd-red)'];

    return `
      <div class="rd-frame rd-threat-panel">
        <div class="rd-frame__head">
          <span class="rd-frame__live rd-frame__live--dim"></span>
          <span class="rd-frame__title">Threat Matrix</span>
          <span class="rd-frame__subtitle" style="color:${riskColors[riskLevel]}">${riskLabels[riskLevel]}</span>
        </div>
        <div class="rd-frame__body" style="display:flex;flex-direction:column;gap:0;padding:0;">

          <!-- Matrix grid with column + row axis labels on the outside. -->
          <div style="padding:12px 14px 8px;">
            <!-- Column axis labels (tiers) -->
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:3px;margin-bottom:3px;">
              ${tierLabels.map(l => `<div style="font-size:6px;letter-spacing:0.08em;text-transform:uppercase;color:var(--rd-dim);text-align:center;">${l}</div>`).join('')}
            </div>
            <!-- The 3×3 matrix -->
            <div style="display:grid;grid-template-columns:auto 1fr;gap:4px;align-items:start;">
              <!-- Row axis labels (confidence bands) -->
              <div style="display:flex;flex-direction:column;gap:3px;padding-top:0;">
                ${confLabels.map(l => `<div style="font-size:6px;letter-spacing:0.06em;color:var(--rd-dim);writing-mode:initial;white-space:nowrap;height:calc((100% - 6px)/3);display:flex;align-items:center;">${l}</div>`).join('')}
              </div>
              <!-- Cells -->
              <div class="rd-threat-matrix__grid">${cells}</div>
            </div>
          </div>

          <!-- Summary rows: active position in the matrix. -->
          <div class="rd-tier-badges" style="border-top:1px solid var(--rd-border2);padding:8px 14px;">
            <div class="rd-tier-row">
              <span class="rd-tier-row__label">Active Cell</span>
              <span class="rd-tier-row__value" style="color:${riskColors[riskLevel]}">
                ${tierName} · ${confBand} conf
              </span>
            </div>
            <div class="rd-tier-row">
              <span class="rd-tier-row__label">Risk Level</span>
              <span class="rd-tier-row__value" style="color:${riskColors[riskLevel]};font-weight:700;">
                ${riskLabels[riskLevel].toUpperCase()}
              </span>
            </div>
            <div class="rd-tier-row">
              <span class="rd-tier-row__label">Confidence</span>
              <span class="rd-tier-row__value">${Math.round(conf)}% (${confBand})</span>
            </div>
          </div>

        </div>
      </div>`;
  }

  /* ══════════════════════════════════════════════════════════
     ROW B — three panels
  ══════════════════════════════════════════════════════════ */

  /* B1 — FIELD OBSERVATION
     Photo thumbnail on the left half, observation text on the right.
     Submitter track record shown in the header as inline stats. */
  function buildPanelEvidence(report) {
    const mediaHTML = report.media_url
      ? `<div class="rd-evidence__media" id="rd-media-wrap">
           <img class="rd-evidence__img"
             src="/${report.media_url.replace(/^\/?/, '')}"
             alt="${report.species_name || 'Field evidence'}"
             loading="lazy"
           />
           <div class="rd-evidence__overlay">⊕</div>
         </div>`
      : `<div class="rd-evidence__media">
           <div class="rd-evidence__no-media">
             <span class="rd-evidence__no-media-icon">📷</span>
             No photo
           </div>
         </div>`;

    return `
      <div class="rd-frame rd-evidence-panel">
        <div class="rd-frame__head">
          <span class="rd-frame__live rd-frame__live--dim"></span>
          <span class="rd-frame__title">Field Observation</span>
          <!-- Submitter stats injected here once the async call resolves. -->
          <div class="rd-submitter-track" id="rd-submitter-track">
            <span style="color:var(--rd-dim);font-size:7px;letter-spacing:0.08em;">—</span>
          </div>
        </div>
        <div class="rd-frame__body rd-frame__body--flush">
          <!-- Left: photo | Right: observation text in a two-column split. -->
          <div class="rd-evidence-inner">
            ${mediaHTML}
            <div class="rd-evidence__desc">
              <!-- Field notes header -->
              <div style="font-size:7px;letter-spacing:0.16em;text-transform:uppercase;color:var(--rd-dim);margin-bottom:6px;">
                Field Notes
              </div>
              <div class="rd-desc-text">
                ${report.description || '<em style="color:var(--rd-dim);font-style:normal;">No description provided.</em>'}
              </div>
              ${report.behaviour_notes ? `
                <div style="margin-top:10px;font-size:7px;letter-spacing:0.16em;text-transform:uppercase;color:var(--rd-dim);margin-bottom:4px;">
                  Behaviour Notes
                </div>
                <div class="rd-desc-text">${report.behaviour_notes}</div>` : ''}
            </div>
          </div>
        </div>
      </div>`;
  }

  /* B2 — LIFECYCLE LOG (mini version)
     Vertical timeline: dot → event name → timestamp. Each event type gets
     a distinct dot colour (submit=muted, validate=green, reject=red). */
  function buildPanelMiniAudit(report) {
    const events = buildAuditEvents(report).slice(0, 5);
    const rows = events.map(e => `
      <div class="rd-mini-row">
        <div class="rd-mini-dot rd-mini-dot--${e.type}"></div>
        <div style="min-width:0;">
          <div class="rd-mini-event">${e.event}</div>
          <div class="rd-mini-time">${e.time}</div>
          <div class="rd-mini-time" style="color:var(--rd-green);opacity:0.7;">${e.actor}</div>
        </div>
      </div>`).join('');

    return `
      <div class="rd-frame rd-mini-audit">
        <div class="rd-frame__head">
          <span class="rd-frame__live rd-frame__live--dim"></span>
          <span class="rd-frame__title">Lifecycle Log</span>
          <span class="rd-frame__subtitle">${events.length} events</span>
        </div>
        <!-- Scrollable event list — each row: coloured dot + event + timestamp. -->
        <div class="rd-frame__body rd-frame__body--scroll" style="padding:8px 12px;">
          ${rows}
        </div>
      </div>`;
  }

  /* B3 — AI FIELD BRIEF
     Skeleton grid while loading, replaced by bullet-point intelligence
     observations once the async brief endpoint resolves. */
  function buildPanelBrief() {
    return `
      <div class="rd-frame rd-brief-panel" id="rd-brief-container">
        <div class="rd-frame__head">
          <span class="rd-frame__live"></span>
          <span class="rd-frame__title">AI Field Brief</span>
          <!-- Risk level text injected here after brief loads. -->
          <span class="rd-frame__subtitle" id="rd-brief-status">Generating…</span>
        </div>
        <!-- Skeleton cells animate while the brief endpoint is in-flight. -->
        <div class="rd-frame__body rd-frame__body--scroll" id="rd-brief-body" style="padding:10px 12px;">
          <div class="rd-brief-sk">
            <div class="rd-brief-sk__cell"></div>
            <div class="rd-brief-sk__cell"></div>
            <div class="rd-brief-sk__cell"></div>
            <div class="rd-brief-sk__cell"></div>
            <div class="rd-brief-sk__cell"></div>
          </div>
        </div>
      </div>`;
  }

  /* ══════════════════════════════════════════════════════════
     ACTIONS
  ══════════════════════════════════════════════════════════ */
  function buildActions(report) {
    const status = (report.validation_status || 'PENDING').toUpperCase();
    const canValidate = Auth.hasPermission('validate_report') && status === 'PENDING';
    const canExport = Auth.hasPermission('export_data');
    return `
      <div class="rd-actions rd-reveal d4">
        <div class="rd-actions__group">
          ${canValidate ? `
            <button class="rd-btn rd-btn--primary" id="rd-btn-validate">✓ Validate</button>
            <button class="rd-btn rd-btn--danger"  id="rd-btn-reject">✕ Reject</button>
            <div class="rd-actions__divider"></div>` : ''}
          ${canExport ? `<button class="rd-btn" id="rd-btn-export">↓ Export JSON</button>` : ''}
        </div>
        <div class="rd-actions__sep"></div>
        <div class="rd-actions__group">
          <button class="rd-btn" id="rd-btn-analyse">◎ Analyse Site</button>
        </div>
      </div>`;
  }

  /* ══════════════════════════════════════════════════════════
     TAB STRIP
  ══════════════════════════════════════════════════════════ */
  function buildTabs(activeId) {
    return `
      <div class="rd-tabs" id="rd-tabs" role="tablist">
        ${TABS.map(t => `
          <button class="rd-tab ${t.id === activeId ? 'active' : ''}"
            role="tab" data-tab="${t.id}"
            aria-selected="${t.id === activeId}"
          >${t.label}</button>`).join('')}
      </div>`;
  }

  /* ══════════════════════════════════════════════════════════
     TAB CONTENT RENDERERS
  ══════════════════════════════════════════════════════════ */

  /* LOCATION TAB — Leaflet map via WidgetRegistry, full widget height. */
  function renderLocationTab(container, report) {
    WidgetRegistry.init(container, report, ['map-location']);
  }

  /* AUDIT TAB — Full expanded timeline.
     Three-column grid: timestamp | event description | actor.
     A vertical connector line runs down the left alongside the dot
     sequence to make the timeline flow explicit. */
  function renderAuditTab(container, report) {
    const events = buildAuditEvents(report);

    const rows = events.map(e => `
      <div class="rd-audit-row">
        <!-- Connector dot — colour encodes event type -->
        <div class="rd-audit-dot rd-audit-dot--${e.type}"></div>
        <div class="rd-audit-row__time">${e.time}</div>
        <div style="min-width:0;">
          <div class="rd-audit-row__event">${e.event}</div>
          <!-- Actor shown smaller below the event description. -->
          <div style="font-size:7px;color:var(--rd-dim);margin-top:2px;letter-spacing:0.06em;">${e.actor}</div>
        </div>
      </div>`).join('');

    /* Summary stat strip above the timeline. */
    const validated = events.filter(e => e.type === 'validate').length;
    const rejected  = events.filter(e => e.type === 'reject').length;

    container.innerHTML = `
      <div class="widget widget--auto">
        <div class="widget__header">
          <div class="widget__title-group">
            <span class="widget__icon">◎</span>
            <span class="widget__title">Lifecycle Audit Log</span>
          </div>
          <!-- Inline event-type summary counts in the header right. -->
          <div style="display:flex;gap:12px;font-size:7px;letter-spacing:0.10em;color:var(--rd-dim);">
            <span>${events.length} events</span>
            ${validated ? `<span style="color:var(--rd-green);">✓ ${validated} validated</span>` : ''}
            ${rejected  ? `<span style="color:var(--rd-red);">✕ ${rejected} rejected</span>`   : ''}
          </div>
        </div>
        <div class="widget__body" style="padding:0;">
          <!-- Timeline runs down left edge via ::before pseudo on rd-audit. -->
          <div class="rd-audit">${rows}</div>
        </div>
      </div>`;
  }

  function buildAuditEvents(report) {
    const events = [];
    const fmt = ts => ts
      ? new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).toUpperCase()
      : '—';
    if (report.created_at)
      events.push({ type: 'submit', time: fmt(report.created_at), event: 'Report submitted and entered pending queue', actor: report.submitter_name || 'Anonymous' });
    if (report.reviewed_at && report.validation_status === 'VALIDATED')
      events.push({ type: 'validate', time: fmt(report.reviewed_at), event: 'Report validated — data fed to AI training pipeline', actor: report.reviewed_by || 'System' });
    if (report.reviewed_at && report.validation_status === 'REJECTED')
      events.push({ type: 'reject', time: fmt(report.reviewed_at), event: 'Report rejected and flagged for review', actor: report.reviewed_by || 'System' });
    if (report.ai_processed_at)
      events.push({ type: 'view', time: fmt(report.ai_processed_at), event: `AI confidence scored at ${Number(report.ai_confidence_score || 0).toFixed(1)}%`, actor: 'Terra AI Engine' });
    if (events.length === 0)
      events.push({ type: 'view', time: '—', event: 'No audit events recorded', actor: '—' });
    return events;
  }

  /* SPECIES INTEL TAB — Two stacked widgets:
     1. Species Reference Card: icon + taxonomy hero, then five data rows
        (habitat / diet / range / threats / notes) as a scannable table.
     2. Nearby Reports: async-fetched list of sightings within 10km, each row
        shows species name, distance, and validation status badge. */
  function renderSpeciesTab(container, report) {
    const species     = lookupSpecies(report.species_name);
    const speciesHTML = species ? buildSpeciesCard(species, report) : buildSpeciesUnknown(report);

    const nearbyHTML = `
      <div class="widget widget--auto" id="rd-similar-widget">
        <div class="widget__header">
          <div class="widget__title-group">
            <span class="widget__icon">◈</span>
            <span class="widget__title">Nearby Sightings · 10 km radius</span>
          </div>
          <!-- Count badge injected once fetch resolves. -->
          <span id="rd-similar-count" style="font-size:7px;letter-spacing:0.10em;color:var(--rd-dim);">Loading…</span>
        </div>
        <div class="widget__body" style="padding:0;" id="rd-similar-body">
          <!-- Skeleton rows while fetching. -->
          <div style="padding:10px 14px;display:flex;flex-direction:column;gap:6px;">
            ${[70,85,60].map(w => `<div style="height:7px;background:rgba(255,255,255,0.05);width:${w}%;animation:rd-sk-pulse 1.6s ease-in-out infinite;"></div>`).join('')}
          </div>
        </div>
      </div>`;

    container.innerHTML = speciesHTML + nearbyHTML;
    fetchSimilarReports(report);
  }

  function buildSpeciesCard(s, report) {
    const iucnColor = { LC:'var(--rd-green)', NT:'#a8e6ff', VU:'var(--rd-amber)', EN:'#ff8c42', CR:'var(--rd-red)', EW:'#cc44ff', EX:'var(--rd-dim)', DD:'var(--rd-dim)' }[s.iucn] || 'var(--rd-muted)';

    /* Data rows rendered as a table-like structure: label left, value right. */
    const dataRows = [
      ['Habitat',  s.habitat],
      ['Diet',     s.diet],
      ['Range',    s.range],
      ['Threats',  s.threats],
      ['Notes',    s.notes],
    ].map(([label, val]) => `
      <div class="rd-species-row">
        <span class="rd-species-row__label">${label}</span>
        <span class="rd-species-row__value">${val}</span>
      </div>`).join('');

    return `
      <div class="widget widget--tall">
        <div class="widget__header">
          <div class="widget__title-group">
            <span class="widget__icon">◉</span>
            <span class="widget__title">Species Reference</span>
          </div>
          <span style="font-size:7px;letter-spacing:0.12em;color:var(--rd-dim);">IUCN Red List 2024</span>
        </div>
        <div class="widget__body" style="padding:0;display:flex;flex-direction:column;">

          <!-- Hero: icon + name block + IUCN badge, separated from data rows. -->
          <div style="display:flex;align-items:center;gap:14px;padding:14px 16px;border-bottom:1px solid var(--rd-border2);">
            <div style="font-size:3rem;line-height:1;flex-shrink:0;opacity:0.85;">${s.icon}</div>
            <div style="flex:1;min-width:0;">
              <div class="rd-species-card__common">${s.common}</div>
              <div class="rd-species-card__sci">${s.sci}</div>
              <div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap;align-items:center;">
                <!-- IUCN status badge uses colour from the lookup table above. -->
                <span class="rd-species-card__iucn rd-iucn--${s.iucn}"
                  style="font-size:8px;">${s.iucn} · ${iucnLabel(s.iucn)}</span>
                ${report?.species_name ? `<span style="font-size:7px;color:var(--rd-dim);letter-spacing:0.08em;">Matched: "${report.species_name}"</span>` : ''}
              </div>
            </div>
            <!-- Conservation status column: colour-coded severity bar. -->
            <div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex-shrink:0;">
              <div style="font-size:6px;letter-spacing:0.14em;text-transform:uppercase;color:var(--rd-dim);">Status</div>
              <div style="width:28px;height:60px;border:1px solid var(--rd-border2);position:relative;overflow:hidden;">
                <div style="position:absolute;bottom:0;left:0;right:0;background:${iucnColor};opacity:0.6;
                  height:${{ LC:20, NT:30, VU:45, EN:60, CR:80, EW:90, EX:100, DD:15 }[s.iucn] || 50}%;
                  transition:height 1s ease;"></div>
              </div>
              <div style="font-size:7px;color:${iucnColor};font-weight:700;">${s.iucn}</div>
            </div>
          </div>

          <!-- Data rows: each line is label + value. -->
          <div class="rd-species-rows" style="flex:1;overflow-y:auto;padding:0 16px;">
            ${dataRows}
          </div>

        </div>
      </div>`;
  }

  function buildSpeciesUnknown(report) {
    return `
      <div class="widget widget--auto">
        <div class="widget__header">
          <div class="widget__title-group">
            <span class="widget__icon">◉</span>
            <span class="widget__title">Species Reference</span>
          </div>
        </div>
        <div class="widget__body" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:120px;">
          <div style="font-size:2rem;opacity:0.12;">?</div>
          <div style="font-size:8px;letter-spacing:0.14em;text-transform:uppercase;color:var(--rd-dim);text-align:center;">
            "${report.species_name || 'Unknown'}"<br>not in reference database
          </div>
          <div style="font-size:7px;color:var(--rd-dim);opacity:0.6;text-align:center;max-width:200px;line-height:1.6;">
            Database covers 11 focal species. Submit a data request to expand coverage.
          </div>
        </div>
      </div>`;
  }

  function iucnLabel(code) {
    const map = { LC: 'Least Concern', NT: 'Near Threatened', VU: 'Vulnerable', EN: 'Endangered', CR: 'Critically Endangered', EW: 'Extinct in Wild', EX: 'Extinct', DD: 'Data Deficient' };
    return map[code] || code;
  }

  async function fetchSimilarReports(report) {
    const body      = document.getElementById('rd-similar-body');
    const countBadge = document.getElementById('rd-similar-count');
    if (!body) return;
    try {
      const params = new URLSearchParams({ lat: report.latitude, lng: report.longitude, radius: 10, exclude: report.report_id, limit: 6 });
      if (report.species_id) params.set('species_id', report.species_id);
      const data = await API.get(`/reports?${params}`);
      const list = Array.isArray(data) ? data : (data.reports || []);

      if (countBadge) countBadge.textContent = list.length ? `${list.length} found` : 'none found';

      if (!list.length) {
        body.innerHTML = `<div class="rd-similar-empty">No sightings within 10 km.</div>`;
        return;
      }

      /* Each row: species name | distance pill | status badge.
         Sorted ascending by distance so nearest is always first. */
      const sorted = list.map(r => ({
        ...r,
        _dist: haversineKm(report.latitude, report.longitude, parseFloat(r.latitude || 0), parseFloat(r.longitude || 0)),
      })).sort((a, b) => a._dist - b._dist);

      body.innerHTML = `<div class="rd-similar-list">${sorted.map(r => {
        const st = (r.validation_status || 'pending').toLowerCase();
        return `<div class="rd-similar-row" data-id="${r.report_id}" tabindex="0" role="button">
          <span class="rd-similar-row__species">${r.species_name || 'Unknown'}</span>
          <span class="rd-similar-row__dist">${r._dist.toFixed(1)} km</span>
          <span class="rd-similar-row__status rd-similar-row__status--${st}">${st.toUpperCase()}</span>
        </div>`;
      }).join('')}</div>`;

      body.querySelectorAll('.rd-similar-row').forEach(row => {
        row.addEventListener('click', () => Router.navigate('report-detail', { reportId: row.dataset.id }));
      });
    } catch (_) {
      if (countBadge) countBadge.textContent = 'error';
      body.innerHTML = `<div class="rd-similar-empty">Could not load nearby reports.</div>`;
    }
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* RAW DATA TAB — Three stacked sections:
     1. Key-value summary strip for the most-referenced fields (fast scan).
     2. Full JSON pre block for engineers / export reference.
     3. Byte-size and field-count metadata footer. */
  function renderRawTab(container, report) {
    const safe = { ...report };
    delete safe.geom; /* omit binary geometry blob */
    const json     = JSON.stringify(safe, null, 2);
    const byteSize = new Blob([json]).size;
    const fields   = Object.keys(safe).length;

    /* Quick-access rows for the most useful fields. */
    const quickFields = [
      ['report_id',          safe.report_id],
      ['species_name',       safe.species_name],
      ['validation_status',  safe.validation_status],
      ['ai_confidence_score', safe.ai_confidence_score != null ? `${safe.ai_confidence_score}%` : '—'],
      ['sensitivity_tier',   safe.sensitivity_tier],
      ['latitude',           safe.latitude],
      ['longitude',          safe.longitude],
      ['created_at',         safe.created_at],
      ['reviewed_at',        safe.reviewed_at || '—'],
      ['reviewed_by',        safe.reviewed_by || '—'],
    ].map(([k, v]) => `
      <div style="display:flex;justify-content:space-between;align-items:baseline;
                  gap:10px;padding:5px 0;border-bottom:1px solid var(--rd-border2);">
        <span style="font-size:8px;letter-spacing:0.10em;color:var(--rd-dim);flex-shrink:0;">${k}</span>
        <span style="font-size:9px;color:var(--rd-muted);text-align:right;word-break:break-all;">${v ?? '—'}</span>
      </div>`).join('');

    container.innerHTML = `
      <!-- Quick-scan summary strip — most-referenced fields at a glance. -->
      <div class="widget widget--auto">
        <div class="widget__header">
          <div class="widget__title-group">
            <span class="widget__icon">≡</span>
            <span class="widget__title">Field Summary</span>
          </div>
          <span style="font-size:7px;color:var(--rd-dim);letter-spacing:0.10em;">${fields} fields · ${byteSize} B</span>
        </div>
        <div class="widget__body" style="padding:0 14px;">
          ${quickFields}
        </div>
      </div>

      <!-- Full JSON dump for reference or copy-paste. -->
      <div class="widget widget--auto">
        <div class="widget__header">
          <div class="widget__title-group">
            <span class="widget__icon">{ }</span>
            <span class="widget__title">Raw JSON — geom excluded</span>
          </div>
          <!-- Copy button: copies raw JSON to clipboard. -->
          <button id="rd-raw-copy" style="font-family:var(--rd-mono);font-size:7px;letter-spacing:0.12em;
            text-transform:uppercase;border:1px solid var(--rd-border);background:transparent;
            color:var(--rd-dim);padding:3px 10px;cursor:pointer;transition:color 0.15s,border-color 0.15s;"
            onmouseenter="this.style.color='var(--rd-text)';this.style.borderColor='rgba(255,255,255,0.22)'"
            onmouseleave="this.style.color='var(--rd-dim)';this.style.borderColor='var(--rd-border)'">
            ⎘ Copy
          </button>
        </div>
        <pre class="rd-raw-pre">${json}</pre>
      </div>`;

    document.getElementById('rd-raw-copy')?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(json);
      Toast.success('Copied to clipboard.');
    });
  }

  function activateTab(tabId, container, report) {
    document.querySelectorAll('.rd-tab').forEach(btn => {
      const on = btn.dataset.tab === tabId;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on);
    });
    container.classList.add('tab-switching');
    setTimeout(() => {
      container.innerHTML = '';
      if (tabId === 'location') renderLocationTab(container, report);
      else if (tabId === 'audit') renderAuditTab(container, report);
      else if (tabId === 'species-intel') renderSpeciesTab(container, report);
      else if (tabId === 'raw') renderRawTab(container, report);
      requestAnimationFrame(() => container.classList.remove('tab-switching'));
    }, 220);
  }

  /* ══════════════════════════════════════════════════════════
     ASYNC SIDE EFFECTS
  ══════════════════════════════════════════════════════════ */
  function animateConfBar(value) {
    const fill = document.getElementById('rd-conf-fill');
    if (fill) requestAnimationFrame(() => { fill.style.width = `${value}%`; });
  }

  async function fetchAndRenderBrief(report) {
    const bodyEl = document.getElementById('rd-brief-body');
    const statusEl = document.getElementById('rd-brief-status');
    if (!bodyEl) return;
    try {
      const { brief } = await API.get(`/reports/${report.report_id}/brief`);

      if (statusEl) statusEl.textContent = brief.riskLevel + ' RISK';

      const riskBadge = document.getElementById('rd-risk-badge');
      if (riskBadge) riskBadge.innerHTML = `<span class="rd-risk rd-risk--${brief.riskLevel}">${brief.riskLevel} RISK</span>`;

      bodyEl.innerHTML = `
        ${brief.considerations.map(pt => `
          <div class="rd-brief-item">
            <span class="rd-brief-item__bullet">◆</span>
            <span>${pt}</span>
          </div>`).join('')}
        <div class="rd-brief-ts">
          Generated ${new Date(brief.generatedAt).toLocaleString().toUpperCase()} · Terra Intelligence Engine v1
        </div>`;
    } catch (err) {
      const is403 = err?.status === 403 || String(err?.message).includes('403');
      if (statusEl) statusEl.textContent = is403 ? 'RESTRICTED' : 'UNAVAILABLE';
      bodyEl.innerHTML = `<div style="color:var(--rd-dim);font-style:italic;font-size:8px;padding:4px 0">${is403 ? 'Ranger tier and above only.' : 'Could not load field brief.'}</div>`;
    }
  }

  async function fetchSubmitterStats(report) {
    const el = document.getElementById('rd-submitter-track');
    if (!el || !report.submitted_by) { if (el) el.innerHTML = ''; return; }
    try {
      const stats = await API.get(`/users/${report.submitted_by}/stats`);
      const pct = stats.total > 0 ? Math.round((stats.validated / stats.total) * 100) : 0;
      el.innerHTML = `
        <span>${report.submitter_name || 'Submitter'}</span>
        <span class="rd-submitter-track__sep">·</span>
        <span class="rd-submitter-track__stat">${stats.validated}</span>/<span>${stats.total}</span>
        <span class="rd-submitter-track__sep">·</span>
        <span class="rd-submitter-track__stat">${pct}%</span>`;
    } catch (_) {
      el.innerHTML = `<span style="color:var(--rd-dim)">${report.submitter_name || ''}</span>`;
    }
  }

  function wireMedia(report) {
    const wrap = document.getElementById('rd-media-wrap');
    if (!wrap || !report.media_url) return;
    wrap.addEventListener('click', () => {
      const src = `/${report.media_url.replace(/^\/?/, '')}`;
      const bd = document.createElement('div');
      bd.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.94);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
      const img = document.createElement('img');
      img.src = src;
      img.style.cssText = 'max-width:92vw;max-height:88vh;box-shadow:0 0 60px rgba(0,0,0,0.9);';
      bd.appendChild(img);
      bd.addEventListener('click', () => bd.remove());
      document.body.appendChild(bd);
    });
  }

  function wireActions(report) {
    document.getElementById('rd-btn-back')?.addEventListener('click', () => Router.navigate('my-reports'));

    document.getElementById('rd-btn-analyse')?.addEventListener('click', () => {
      Router.navigate('site-analysis', { lat: report.latitude, lng: report.longitude, reportId: report.report_id });
    });

    document.getElementById('rd-region-chip')?.addEventListener('click', () => {
      Router.navigate('site-analysis', { lat: report.latitude, lng: report.longitude, reportId: report.report_id, regionId: report.region_id });
    });

    document.getElementById('rd-btn-validate')?.addEventListener('click', () => {
      Modal.open({
        title: 'Validate Report',
        body: '<p>Confirm validation? Data will feed the AI training pipeline.</p>',
        confirmLabel: 'Validate',
        onConfirm: async () => {
          try { await API.patch(`/reports/${report.report_id}/validate`, { status: 'VALIDATED' }); Toast.success('Report validated.'); Router.navigate('pending'); }
          catch (err) { Toast.error(err.message); }
        },
      });
    });

    document.getElementById('rd-btn-reject')?.addEventListener('click', () => {
      Modal.open({
        title: 'Reject Report',
        body: '<p>Reject this report? The action will be logged.</p>',
        confirmLabel: 'Reject',
        onConfirm: async () => {
          try { await API.patch(`/reports/${report.report_id}/validate`, { status: 'REJECTED' }); Toast.success('Report rejected.'); Router.navigate('pending'); }
          catch (err) { Toast.error(err.message); }
        },
      });
    });

    document.getElementById('rd-btn-export')?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `terra-report-${report.report_id.slice(0, 8)}.json`;
      a.click(); URL.revokeObjectURL(url);
      Toast.success('Exported as JSON.');
    });
  }

  /* ══════════════════════════════════════════════════════════
     PUBLIC: render
  ══════════════════════════════════════════════════════════ */
  async function render(container, options = {}) {
    const { reportId } = options;

    if (!reportId) {
      container.innerHTML = `<div class="rd-page" style="padding:40px;color:var(--rd-dim)">No report ID provided.</div>`;
      return;
    }

    const loader = showLoader();
    container.innerHTML = `<div class="rd-page" id="rd-root"></div>`;

    let report;
    try {
      report = await API.get(`/reports/${reportId}`);
    } catch (err) {
      dismissLoader(loader);
      container.innerHTML = `
        <div class="rd-page" style="padding:40px;font-family:'JetBrains Mono',monospace">
          <div style="font-size:9px;letter-spacing:0.16em;color:#ff2020;margin-bottom:12px">ERROR — REPORT UNAVAILABLE</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.3);margin-bottom:24px">${err.message}</div>
          <button class="rd-btn" onclick="Router.navigate('my-reports')">← Back to Reports</button>
        </div>`;
      return;
    }

    /* Normalise coordinates */
    if (report.geom_json?.coordinates) {
      report.longitude = report.geom_json.coordinates[0];
      report.latitude = report.geom_json.coordinates[1];
    } else if (typeof report.geom === 'string' && report.geom.startsWith('{')) {
      try {
        const geo = JSON.parse(report.geom);
        report.longitude = geo.coordinates?.[0];
        report.latitude = geo.coordinates?.[1];
      } catch (_) { }
    }
    report.latitude = parseFloat(report.latitude || 0);
    report.longitude = parseFloat(report.longitude || 0);
    report.species_name = report.species_name || 'Unknown Species';

    const status = (report.validation_status || 'PENDING').toUpperCase();
    const root = document.getElementById('rd-root');

    root.innerHTML = `
      ${buildRuler(report)}

      <div class="rd-grid">

        <!-- Row A: Identity | Confidence | Threat -->
        <div class="rd-row-a rd-reveal d2">
          ${buildPanelIdentity(report)}
          ${buildPanelConfidence(report)}
          ${buildPanelThreat(report)}
        </div>

        <!-- Row B: Evidence | Audit | Brief -->
        <div class="rd-row-b rd-reveal d3">
          ${buildPanelEvidence(report)}
          ${buildPanelMiniAudit(report)}
          ${buildPanelBrief()}
        </div>

        <!-- Actions -->
        ${buildActions(report)}

        <!-- Row C: Tabs + widget area -->
        <div class="rd-row-c rd-reveal d5">
          <div class="rd-row-c-frame">
            ${buildTabs('location')}
            <div class="rd-widget-area">
              <div class="rd-widget-stack" id="rd-widget-stack"></div>
            </div>
          </div>
        </div>

      </div>`;

    dismissLoader(loader);

    /* Wire watermark */
    const watermarkMount = document.getElementById('rd-watermark');
    if (watermarkMount) watermarkMount.appendChild(buildWatermarkSVG(status));

    /* Wire tab clicks */
    const widgetStack = document.getElementById('rd-widget-stack');
    document.getElementById('rd-tabs').addEventListener('click', e => {
      const tab = e.target.closest('.rd-tab');
      if (tab) activateTab(tab.dataset.tab, widgetStack, report);
    });

    wireActions(report);
    wireMedia(report);

    /* Default tab */
    activateTab('location', widgetStack, report);

    /* Reveal cascade */
    requestAnimationFrame(() => {
      document.querySelectorAll('.rd-reveal').forEach(el => el.classList.add('visible'));
    });

    /* Non-blocking async */
    animateConfBar(report.ai_confidence_score || 0);
    fetchAndRenderBrief(report);
    fetchSubmitterStats(report);
  }

  return { render };
})();
