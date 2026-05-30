/* ============================================================
   TERRA – reportDetail.js
   Map-as-canvas report detail. Leaflet fills the shell; three
   floating panels surface identity, AI brief, and ICE confidence.
   Action bar (top) handles validate / reject for authorised users.

   Router.navigate('report-detail', { reportId }) lands here.
   ============================================================ */

const ReportDetailPage = (() => {

  /* ── State ───────────────────────────────────────────────── */
  let _map       = null;
  let _container = null;

  /* ── Ring arc geometry (matches mockup-study spec) ───────── */
  const OUTER_R = 37;
  const OUTER_C = +(2 * Math.PI * OUTER_R).toFixed(2); // 232.48
  const INNER_R = 25;
  const INNER_C = +(2 * Math.PI * INNER_R).toFixed(2); // 157.08

  function arcDash(pct, circumference) {
    const filled = (Math.min(Math.max(pct, 0), 100) / 100) * circumference;
    const gap    = circumference - filled;
    return `${filled.toFixed(1)} ${gap.toFixed(1)}`;
  }

  /* ── Metadata maps ───────────────────────────────────────── */
  const STATUS_META = {
    PENDING:   { label: 'PENDING',      color: '#e8a000' },
    VALIDATED: { label: 'VALIDATED',    color: '#b8f000' },
    REJECTED:  { label: 'REJECTED',     color: '#f05050' },
  };

  const TIER_META = {
    1: { label: 'PUBLIC',       color: 'rgba(255,255,255,0.35)' },
    2: { label: 'PROTECTED',    color: '#7c5cbf' },
    3: { label: 'RESTRICTED',   color: '#e8a000' },
    4: { label: 'CONFIDENTIAL', color: '#f05050' },
  };

  /* ── Helpers ─────────────────────────────────────────────── */
  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDate(str) {
    if (!str) return '—';
    const d = new Date(str);
    return isNaN(d) ? String(str) : d.toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function fmtCoord(n) {
    const v = parseFloat(n);
    return isNaN(v) ? '—' : v.toFixed(5);
  }

  /* ── Panel: Identity ─────────────────────────────────────── */
  function identityPanel(r) {
    const status = STATUS_META[r.validation_status] || STATUS_META.PENDING;
    const tier   = TIER_META[r.sensitivity_tier]    || TIER_META[1];
    const lat    = r.geom_json?.coordinates?.[1] ?? r.latitude;
    const lng    = r.geom_json?.coordinates?.[0] ?? r.longitude;

    const photoHTML = r.media_url
      ? `<div class="rd-photo-wrap">
           <img class="rd-photo" src="${esc(r.media_url)}" alt="Sighting media" loading="lazy"/>
         </div>`
      : '';

    const descHTML = r.description
      ? `<div class="rd-description">${esc(r.description)}</div>`
      : '';

    return `
      <div class="rd-panel rd-panel--identity">
        <div class="rd-panel-label">FIELD IDENTITY</div>
        <div class="rd-species">${esc(r.species_name || 'Unknown Species')}</div>
        <div class="rd-meta-rows">
          <div class="rd-meta-row">
            <span class="rd-meta-key">REGION</span>
            <span class="rd-meta-val">${esc(r.region_id || '—')}</span>
          </div>
          <div class="rd-meta-row">
            <span class="rd-meta-key">SUBMITTED</span>
            <span class="rd-meta-val">${esc(r.submitter_name || '—')}</span>
          </div>
          <div class="rd-meta-row">
            <span class="rd-meta-key">SIGHTED</span>
            <span class="rd-meta-val">${fmtDate(r.sighting_timestamp)}</span>
          </div>
          <div class="rd-meta-row">
            <span class="rd-meta-key">COORDS</span>
            <span class="rd-meta-val rd-meta-val--mono">${fmtCoord(lat)}, ${fmtCoord(lng)}</span>
          </div>
        </div>
        ${photoHTML}
        <div class="rd-badges">
          <span class="rd-badge"
            style="--badge-color:${status.color}">${status.label}</span>
          <span class="rd-badge"
            style="--badge-color:${tier.color}">T${r.sensitivity_tier || 1} · ${tier.label}</span>
        </div>
        ${descHTML}
      </div>`;
  }

  /* ── Panel: ICE Confidence ───────────────────────────────── */
  function confidencePanel(r) {
    const score     = Number(r.ai_confidence_score || 0);
    const breakdown = Array.isArray(r.confidence_breakdown) ? r.confidence_breakdown : [];
    const passed    = breakdown.filter(f => f.status === 'PASSED');
    const passedPct = breakdown.length > 0 ? (passed.length / breakdown.length) * 100 : 0;

    const riskLabel = score >= 70 ? 'LOW RISK' : score >= 40 ? 'MOD RISK' : 'HIGH RISK';
    const riskColor = score >= 70 ? '#b8f000' : score >= 40 ? '#e8a000' : '#f05050';

    const factorRows = breakdown.length > 0
      ? breakdown.map(f => {
          const ok = f.status === 'PASSED';
          return `
            <div class="rd-factor">
              <div class="rd-factor-dot ${ok ? 'rd-factor-dot--pass' : ''}"></div>
              <span class="rd-factor-label">${esc(f.label)}</span>
              <span class="rd-factor-boost ${ok ? 'rd-factor-boost--pass' : ''}">${esc(f.boost || '+0%')}</span>
            </div>`;
        }).join('')
      : `<div class="rd-factor-empty">NO BREAKDOWN DATA</div>`;

    return `
      <div class="rd-panel rd-panel--confidence">
        <div class="rd-panel-label">ICE CONFIDENCE ENGINE</div>
        <div class="rd-conf-body">
          <div class="rd-gauge-col">
            ${gaugesvg(score, passedPct)}
            <div class="rd-risk-tag" style="color:${riskColor}">${riskLabel}</div>
            <div class="rd-conf-seg-bar" title="${passed.length}/${breakdown.length} criteria passed">
              <div class="rd-conf-seg-bar__pass" style="flex:${passedPct || 0}"></div>
              <div class="rd-conf-seg-bar__skip" style="flex:${100 - passedPct || 100}"></div>
            </div>
          </div>
          <div class="rd-factors">${factorRows}</div>
        </div>
      </div>`;
  }

  /* ── Panel: AI Brief (populated async) ───────────────────── */
  function buildBriefPanel(brief) {
    const items = (brief.considerations || [])
      .map(c => `<div class="rd-brief-item">${esc(c)}</div>`)
      .join('');
    return `
      <div class="rd-panel rd-panel--brief">
        <div class="rd-panel-label">AI INTELLIGENCE BRIEF</div>
        <div class="rd-brief-items">${items}</div>
      </div>`;
  }

  function briefLoadingPanel() {
    return `
      <div class="rd-panel rd-panel--brief">
        <div class="rd-panel-label">AI INTELLIGENCE BRIEF</div>
        <div class="rd-brief-loading">LOADING BRIEF…</div>
      </div>`;
  }

  /* ── Action bar ──────────────────────────────────────────── */
  function actionBar(r, canValidate) {
    const status    = STATUS_META[r.validation_status] || STATUS_META.PENDING;
    const shortId   = String(r.report_id || '').slice(0, 8).toUpperCase();
    const isPending = r.validation_status === 'PENDING';

    const actionBtns = canValidate && isPending ? `
      <button class="rd-action-btn rd-action-btn--validate" id="rd-btn-validate">VALIDATE</button>
      <button class="rd-action-btn rd-action-btn--reject"   id="rd-btn-reject">REJECT</button>` : '';

    return `
      <div class="rd-action-bar">
        <button class="rd-back-btn" id="rd-back-btn" aria-label="Back to reports">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M8 2L3.5 6L8 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/>
          </svg>
          REPORTS
        </button>
        <div class="rd-bar-divider"></div>
        <div class="rd-bar-center">
          <span class="rd-bar-species">${esc(r.species_name || 'Unknown Species')}</span>
          <div class="rd-bar-tags">
            <span class="rd-bar-tag">${esc(r.region_id || 'Unknown')}</span>
            <span class="rd-bar-tag" style="--rd-tag-color:${status.color}">${status.label}</span>
          </div>
        </div>
        <div class="rd-bar-actions">
          ${actionBtns}
          <span class="rd-bar-id">#${shortId}</span>
        </div>
      </div>`;
  }

  /* ── Async: load AI brief into placeholder ───────────────── */
  async function loadBrief(reportId, slot) {
    try {
      const data = await API.get(`/reports/${reportId}/brief`);
      if (data?.brief && slot.isConnected) {
        slot.outerHTML = buildBriefPanel(data.brief);
      }
    } catch {
      /* 403 for Community tier — silently remove the slot */
      if (slot.isConnected) slot.remove();
    }
  }

  /* ── Wire validate / reject buttons ─────────────────────── */
  function wireActions(reportId, shell) {
    const validateBtn = shell.querySelector('#rd-btn-validate');
    const rejectBtn   = shell.querySelector('#rd-btn-reject');

    async function act(status, btn) {
      btn.disabled = true;
      try {
        await API.patch(`/reports/${reportId}/validate`, { status });
        Router.navigate('reports');
      } catch (err) {
        btn.disabled = false;
        const bar   = shell.querySelector('.rd-action-bar');
        if (bar) {
          const e = document.createElement('span');
          e.className   = 'rd-bar-error';
          e.textContent = err.message || 'Action failed';
          bar.appendChild(e);
          setTimeout(() => e.remove(), 4000);
        }
      }
    }

    if (validateBtn) validateBtn.addEventListener('click', () => act('VALIDATED', validateBtn));
    if (rejectBtn)   rejectBtn.addEventListener('click',   () => act('REJECTED',  rejectBtn));
  }

  /* ── Leaflet map setup ───────────────────────────────────── */
  function initMap(lat, lng) {
    _map = L.map('rd-map', {
      zoomControl:       false,
      attributionControl: false,
    }).setView([lat, lng], 13);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
    }).addTo(_map);

    /* Sighting marker */
    const icon = L.divIcon({
      className: 'rd-sighting-marker',
      html:      '<div class="rd-marker-ring"></div>',
      iconSize:  [22, 22],
      iconAnchor:[11, 11],
    });
    L.marker([lat, lng], { icon }).addTo(_map);

    /* Accuracy radius ring */
    L.circle([lat, lng], {
      radius:      500,
      color:       '#b8f000',
      fillColor:   '#b8f000',
      fillOpacity: 0.04,
      weight:      1,
      opacity:     0.28,
      dashArray:   '4 7',
    }).addTo(_map);

    L.control.zoom({ position: 'bottomright' }).addTo(_map);
  }

  /* ── Main render ─────────────────────────────────────────── */
  async function render(container, options = {}) {
    const { reportId } = options;
    _container = container;

    /* Tear down any previous map instance */
    if (_map) { _map.remove(); _map = null; }

    /* Full-bleed: remove shell padding */
    container.style.padding  = '0';
    container.style.overflow = 'hidden';
    container.style.position = 'relative';

    /* Loading state */
    container.innerHTML = `
      <div class="rd-loading">
        <span class="rd-loading-text">LOADING REPORT</span>
      </div>`;

    if (!reportId) {
      container.innerHTML = `<div class="rd-error"><span class="rd-error-text">NO REPORT ID</span></div>`;
      return;
    }

    let report;
    try {
      report = await API.get(`/reports/${reportId}`);
    } catch (err) {
      container.innerHTML = `
        <div class="rd-error">
          <span class="rd-error-text">${esc(err.message || 'FAILED TO LOAD REPORT')}</span>
        </div>`;
      return;
    }

    const user       = Auth.getUser();
    const canValidate = !!(user?.permissions?.includes('validate_report'));
    const lat        = report.geom_json?.coordinates?.[1] ?? report.latitude  ?? 0;
    const lng        = report.geom_json?.coordinates?.[0] ?? report.longitude ?? 0;

    container.innerHTML = `
      <div class="rd-shell">
        <div class="rd-map-wrap" id="rd-map"></div>
        ${actionBar(report, canValidate)}
        <div class="rd-panels">
          ${identityPanel(report)}
          ${briefLoadingPanel()}
          ${confidencePanel(report)}
        </div>
      </div>`;

    /* Back button */
    const backBtn = container.querySelector('#rd-back-btn');
    if (backBtn) backBtn.addEventListener('click', () => Router.navigate('reports'));

    /* Validate / reject */
    wireActions(reportId, container);

    /* Map */
    initMap(lat, lng);

    /* AI brief (non-blocking; 403 for Community silently removes slot) */
    const briefSlot = container.querySelector('.rd-panel--brief');
    if (briefSlot) loadBrief(reportId, briefSlot);
  }

  /* ── Teardown (called by router on navigate away) ────────── */
  function destroy() {
    if (_map) { _map.remove(); _map = null; }
    if (_container) {
      _container.style.padding  = '';
      _container.style.overflow = '';
      _container.style.position = '';
      _container = null;
    }
  }

  return { render, destroy };

})();

/* ── private alias so the inner IIFE can call the function ── */
/* (gaugesvg is referenced inside confidencePanel as a closure) */
function gaugesvg(score, passedPct) {
  const OUTER_R = 37, OUTER_C = 232.48;
  const INNER_R = 25, INNER_C = 157.08;
  function arcDash(pct, c) {
    const f = (Math.min(Math.max(pct, 0), 100) / 100) * c;
    return `${f.toFixed(1)} ${(c - f).toFixed(1)}`;
  }
  return `
    <svg width="96" height="96" viewBox="0 0 86 86" aria-hidden="true">
      <circle cx="43" cy="43" r="${OUTER_R}" fill="none"
        stroke="rgba(255,255,255,0.05)" stroke-width="5"/>
      <circle cx="43" cy="43" r="${OUTER_R}" fill="none"
        stroke="#b8f000" stroke-width="5"
        stroke-dasharray="${arcDash(score, OUTER_C)}" stroke-linecap="butt"
        transform="rotate(-90 43 43)"/>
      <circle cx="43" cy="43" r="${INNER_R}" fill="none"
        stroke="rgba(255,255,255,0.05)" stroke-width="4"/>
      <circle cx="43" cy="43" r="${INNER_R}" fill="none"
        stroke="#b8f000" stroke-width="4" opacity="0.45"
        stroke-dasharray="${arcDash(passedPct, INNER_C)}" stroke-linecap="butt"
        transform="rotate(-90 43 43)"/>
      <text x="43" y="38" text-anchor="middle"
        font-family="'DM Sans',sans-serif" font-size="17" font-weight="300"
        fill="#e6edf3">${Math.round(score)}</text>
      <text x="43" y="50" text-anchor="middle"
        font-family="'JetBrains Mono',monospace" font-size="7"
        fill="#7d8590" letter-spacing="1">ICE</text>
    </svg>`;
}
