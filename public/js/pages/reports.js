/* ============================================================
   TERRA – reports.js
   Renders the reports list for My Reports, Pending Queue, Validated.
   `validated` and `pending` modes use the Analytics-aesthetic shell.
   `my-reports` uses the standard tactical table layout.
   ============================================================ */

const ReportsPage = (() => {

  const PAGE_SIZE = 25;

  /* ══════════════════════════════════════════════════════════
     SHARED PRIMITIVES (used by both tactical modes)
  ══════════════════════════════════════════════════════════ */

  function ruler(prefix, label, ver) {
    return `
      <div class="${prefix}-ruler">
        <div class="${prefix}-ruler__tick"></div>
        <span class="${prefix}-ruler__label">${label}</span>
        <div class="${prefix}-ruler__track">
          <div class="${prefix}-ruler__pip"></div>
          <div class="${prefix}-ruler__pip"></div>
          <div class="${prefix}-ruler__pip"></div>
        </div>
        <span class="${prefix}-ruler__ver">${ver}</span>
      </div>`;
  }

  function pill(prefix, text) {
    return `<span class="${prefix}-pill">${text}</span>`;
  }

  function kv(prefix, label, val) {
    return `
      <div class="${prefix}-kv">
        <div class="${prefix}-kv__dot"></div>
        <span class="${prefix}-kv__label">${label}</span>
        <span class="${prefix}-kv__val">${val}</span>
      </div>`;
  }

  function confClass(prefix, score) {
    if (score >= 75) return `${prefix}-row__conf--high`;
    if (score >= 40) return `${prefix}-row__conf--mid`;
    return `${prefix}-row__conf--low`;
  }

  function revealAll(rootId) {
    requestAnimationFrame(() => {
      document.querySelectorAll(`#${rootId} .reveal`).forEach(el => {
        setTimeout(() => el.classList.add('visible'), 60);
      });
    });
  }

  /* ══════════════════════════════════════════════════════════
     MY REPORTS MODE — tactical frame-GUI aesthetic (mr-*)
  ══════════════════════════════════════════════════════════ */

  function buildMyReportsHTML() {
    return `
      <div id="mr-root" class="mr-page">

        ${ruler('mr', 'MY REPORTS — PERSONAL SUBMISSION LOG', 'MR/1.0')}

        <div class="mr-hero reveal">
          <div class="mr-hero__body">
            <div class="mr-hero__left">
              ${pill('mr', 'TERRA SYS')}
              <div class="mr-id-large">MY REPORTS</div>
              <div class="mr-id-sub">PERSONAL SUBMISSION LOG</div>
              <div class="mr-id-meta" id="mr-ts">LOADING...</div>
            </div>
            <div class="mr-hero__centre">
              <div class="mr-kv-block" id="mr-kv-block">
                ${kv('mr', 'STATUS', 'LOADING')}
              </div>
            </div>
          </div>
          <div class="mr-stats-strip">
            <div class="mr-stat-cell">
              <div class="mr-stat-cell__label">Total Submitted</div>
              <div class="mr-stat-cell__val mr-stat-cell__val--green" id="mr-stat-total">—</div>
            </div>
            <div class="mr-stat-cell">
              <div class="mr-stat-cell__label">Validated</div>
              <div class="mr-stat-cell__val" id="mr-stat-validated">—</div>
            </div>
            <div class="mr-stat-cell">
              <div class="mr-stat-cell__label">Pending Review</div>
              <div class="mr-stat-cell__val mr-stat-cell__val--amber" id="mr-stat-pending">—</div>
            </div>
            <div class="mr-stat-cell">
              <div class="mr-stat-cell__label">Avg Confidence</div>
              <div class="mr-stat-cell__val mr-stat-cell__val--dim" id="mr-stat-conf">—</div>
            </div>
          </div>
        </div>

        ${ruler('mr', 'FILTER / SEARCH', 'FS-01')}

        <div class="mr-filter-bar reveal d1">
          <span class="mr-filter-bar__label">Search</span>
          <input class="mr-filter-input" id="mr-search" type="text" placeholder="Species, region…" />
          <span class="mr-filter-bar__label">Status</span>
          <select class="mr-filter-select" id="mr-status">
            <option value="">ALL</option>
            <option value="PENDING">Pending</option>
            <option value="VALIDATED">Validated</option>
            <option value="REJECTED">Rejected</option>
          </select>
          <span class="mr-filter-bar__label">Tier</span>
          <select class="mr-filter-select" id="mr-tier">
            <option value="">ALL</option>
            <option value="1">T1 — Public</option>
            <option value="2">T2 — Protected</option>
            <option value="3">T3 — Restricted</option>
          </select>
          <div class="mr-filter-sep"></div>
          <button class="mr-refresh-btn" id="mr-refresh">↺ REFRESH</button>
        </div>

        ${ruler('mr', 'REPORT INDEX', 'RI-00')}

        <div class="mr-list-section reveal d2">
          <div class="mr-list-head">
            <span>#</span>
            <span>Species</span>
            <span>Region</span>
            <span>Date</span>
            <span>Tier</span>
            <span>Conf %</span>
            <span>Status</span>
            <span>Action</span>
          </div>
          <div id="mr-list-body">
            <div class="mr-loading">
              <div class="mr-loading__dot"></div>
              <div class="mr-loading__dot"></div>
              <div class="mr-loading__dot"></div>
              <span>RETRIEVING SUBMISSION LOG...</span>
            </div>
          </div>
          <div class="mr-pagination" id="mr-pagination" style="display:none;">
            <button class="mr-page-btn" id="mr-prev">◀ PREV</button>
            <span class="mr-page-info" id="mr-page-info"></span>
            <button class="mr-page-btn" id="mr-next">NEXT ▶</button>
          </div>
        </div>

      </div>
    `;
  }

  function computeMyReportsStats(reports) {
    const total     = reports.length;
    const validated = reports.filter(r => r.validation_status === 'VALIDATED').length;
    const pending   = reports.filter(r => (r.validation_status || 'PENDING') === 'PENDING').length;
    const scores    = reports.map(r => r.ai_confidence_score).filter(n => n != null);
    const avgConf   = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const tiers     = { 1: 0, 2: 0, 3: 0 };
    reports.forEach(r => { const t = Math.min(3, parseInt(r.sensitivity_tier) || 1); tiers[t]++; });
    return { total, validated, pending, avgConf, tiers };
  }

  function populateMyReportsStats(stats) {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const el  = id => document.getElementById(id);
    if (el('mr-ts'))             el('mr-ts').textContent             = `SYNC · ${now}`;
    if (el('mr-stat-total'))     el('mr-stat-total').textContent     = stats.total;
    if (el('mr-stat-validated')) el('mr-stat-validated').textContent = stats.validated;
    if (el('mr-stat-pending'))   el('mr-stat-pending').textContent   = stats.pending;
    if (el('mr-stat-conf'))      el('mr-stat-conf').textContent      = stats.avgConf.toFixed(1) + '%';
    const kvBlock = el('mr-kv-block');
    if (kvBlock) {
      kvBlock.innerHTML =
        kv('mr', 'T1 PUBLIC',      stats.tiers[1] + ' reports') +
        kv('mr', 'T2 PROTECTED',   stats.tiers[2] + ' reports') +
        kv('mr', 'T3 RESTRICTED',  stats.tiers[3] + ' reports') +
        kv('mr', 'VALIDATED',      stats.validated + ' confirmed') +
        kv('mr', 'PENDING',        stats.pending   + ' awaiting');
    }
  }

  function renderMyReportsRows(reports, page) {
    const body  = document.getElementById('mr-list-body');
    const pgBar = document.getElementById('mr-pagination');
    const pgInf = document.getElementById('mr-page-info');
    if (!body) return;

    if (!reports.length) {
      body.innerHTML = `<div class="mr-empty">NO REPORTS MATCH CURRENT FILTERS</div>`;
      if (pgBar) pgBar.style.display = 'none';
      return;
    }

    const totalPages = Math.ceil(reports.length / PAGE_SIZE);
    const start      = (page - 1) * PAGE_SIZE;
    const slice      = reports.slice(start, start + PAGE_SIZE);
    const tierLabels = { 1: 'PUBLIC', 2: 'PROTECT', 3: 'RESTRCT' };

    body.innerHTML = slice.map((r, i) => {
      const seq    = String(start + i + 1).padStart(3, '0');
      const date   = new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
      const tier   = Math.min(3, parseInt(r.sensitivity_tier) || 1);
      const conf   = r.ai_confidence_score != null ? Number(r.ai_confidence_score).toFixed(1) : null;
      const cClass = conf != null ? confClass('mr', Number(conf)) : '';
      const status = (r.validation_status || 'PENDING').toUpperCase();
      const statusKey = status.toLowerCase();

      return `
        <div class="mr-row" style="animation-delay:${(i % PAGE_SIZE) * 0.025}s" data-id="${r.report_id}">
          <span class="mr-row__seq">${seq}</span>
          <span class="mr-row__species">${r.species_name || 'Unknown Species'}</span>
          <span class="mr-row__region">${r.region_id || '—'}</span>
          <span class="mr-row__date">${date}</span>
          <div class="mr-row__tier">
            <div class="mr-tier-pip mr-tier-pip--${tier}"></div>
            <span class="mr-tier-label">T${tier} ${tierLabels[tier]}</span>
          </div>
          <span class="mr-row__conf ${cClass}">${conf != null ? conf + '%' : '—'}</span>
          <div class="mr-row__status">
            <span class="mr-status-badge mr-status-badge--${statusKey}">
              <span class="mr-status-badge__dot"></span>${status}
            </span>
          </div>
          <div class="mr-row__action">
            <button class="mr-view-btn" data-action="view" data-id="${r.report_id}">VIEW →</button>
          </div>
        </div>`;
    }).join('');

    if (pgBar && pgInf) {
      pgBar.style.display = totalPages > 1 ? 'flex' : 'none';
      pgInf.textContent   = `PAGE ${page} / ${totalPages}  ·  ${reports.length} REPORTS`;
      document.getElementById('mr-prev').disabled = page <= 1;
      document.getElementById('mr-next').disabled = page >= totalPages;
    }

    body.querySelectorAll('.mr-row').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('.mr-view-btn')) return;
        Router.navigate('report-detail', { reportId: row.dataset.id });
      });
    });
    body.querySelectorAll('.mr-view-btn').forEach(btn => {
      btn.addEventListener('click', () => Router.navigate('report-detail', { reportId: btn.dataset.id }));
    });
  }

  async function mountMyReports() {
    let allReports = [], filtered = [], currentPage = 1;

    function applyFilters() {
      const search = (document.getElementById('mr-search')?.value || '').toLowerCase();
      const status = document.getElementById('mr-status')?.value || '';
      const tier   = document.getElementById('mr-tier')?.value   || '';
      filtered = allReports.filter(r => {
        const matchSearch = !search ||
          (r.species_name || '').toLowerCase().includes(search) ||
          (r.region_id    || '').toLowerCase().includes(search);
        const matchStatus = !status || (r.validation_status || 'PENDING') === status;
        const matchTier   = !tier   || String(r.sensitivity_tier) === tier;
        return matchSearch && matchStatus && matchTier;
      });
      currentPage = 1;
      renderMyReportsRows(filtered, currentPage);
    }

    try {
      allReports = await API.get('/reports?mine=true');
      filtered   = allReports;
      populateMyReportsStats(computeMyReportsStats(allReports));
      renderMyReportsRows(filtered, currentPage);
    } catch (err) {
      const body = document.getElementById('mr-list-body');
      if (body) body.innerHTML = `<div class="mr-empty" style="color:var(--mr-red);">ERR: ${err.message}</div>`;
    }

    document.getElementById('mr-search')?.addEventListener('input',  applyFilters);
    document.getElementById('mr-status')?.addEventListener('change', applyFilters);
    document.getElementById('mr-tier')?.addEventListener('change',   applyFilters);
    document.getElementById('mr-refresh')?.addEventListener('click', () => {
      allReports = []; filtered = []; currentPage = 1;
      const body = document.getElementById('mr-list-body');
      if (body) body.innerHTML = `<div class="mr-loading"><div class="mr-loading__dot"></div><div class="mr-loading__dot"></div><div class="mr-loading__dot"></div><span>REFRESHING...</span></div>`;
      mountMyReports();
    });
    document.getElementById('mr-prev')?.addEventListener('click', () => {
      if (currentPage > 1) { currentPage--; renderMyReportsRows(filtered, currentPage); }
    });
    document.getElementById('mr-next')?.addEventListener('click', () => {
      if (currentPage < Math.ceil(filtered.length / PAGE_SIZE)) { currentPage++; renderMyReportsRows(filtered, currentPage); }
    });

    revealAll('mr-root');
  }

  /* ══════════════════════════════════════════════════════════
     VALIDATED MODE — Analytics aesthetic
  ══════════════════════════════════════════════════════════ */

  function buildValidatedHTML() {
    return `
      <div id="vr-root" class="vr-page">

        ${ruler('vr', 'VALIDATED REPORTS — FIELD INTEL REGISTRY', 'VR/1.0')}

        <div class="vr-hero reveal">
          <div class="vr-hero__body">
            <div class="vr-hero__left">
              ${pill('vr', 'TERRA SYS')}
              <div class="vr-id-large">VALIDATED</div>
              <div class="vr-id-sub">CONFIRMED FIELD INTELLIGENCE</div>
              <div class="vr-id-meta" id="vr-ts">LOADING...</div>
            </div>
            <div class="vr-hero__centre">
              <div class="vr-kv-block" id="vr-kv-block">
                ${kv('vr', 'STATUS', 'LOADING')}
              </div>
            </div>
          </div>
          <div class="vr-stats-strip">
            <div class="vr-stat-cell">
              <div class="vr-stat-cell__label">Total Validated</div>
              <div class="vr-stat-cell__val vr-stat-cell__val--green" id="vr-stat-total">—</div>
            </div>
            <div class="vr-stat-cell">
              <div class="vr-stat-cell__label">Species Confirmed</div>
              <div class="vr-stat-cell__val" id="vr-stat-species">—</div>
            </div>
            <div class="vr-stat-cell">
              <div class="vr-stat-cell__label">Avg Confidence</div>
              <div class="vr-stat-cell__val vr-stat-cell__val--cyan" id="vr-stat-conf">—</div>
            </div>
            <div class="vr-stat-cell">
              <div class="vr-stat-cell__label">High-Tier Threats</div>
              <div class="vr-stat-cell__val vr-stat-cell__val--amber" id="vr-stat-threat">—</div>
            </div>
          </div>
        </div>

        ${ruler('vr', 'FILTER / SEARCH', 'FS-01')}

        <div class="vr-filter-bar reveal d1">
          <span class="vr-filter-bar__label">Search</span>
          <input class="vr-filter-input" id="vr-search" type="text" placeholder="Species, region…" />
          <span class="vr-filter-bar__label">Tier</span>
          <select class="vr-filter-select" id="vr-tier">
            <option value="">ALL</option>
            <option value="1">T1 — Public</option>
            <option value="2">T2 — Protected</option>
            <option value="3">T3 — Restricted</option>
          </select>
          <div class="vr-filter-sep"></div>
          <button class="vr-refresh-btn" id="vr-refresh">↺ REFRESH</button>
        </div>

        ${ruler('vr', 'REPORT INDEX', 'RI-00')}

        <div class="vr-list-section reveal d2">
          <div class="vr-list-head">
            <span>#</span>
            <span>Species</span>
            <span>Region</span>
            <span>Date</span>
            <span>Tier</span>
            <span>Conf %</span>
            <span>Action</span>
          </div>
          <div id="vr-list-body">
            <div class="vr-loading">
              <div class="vr-loading__dot"></div>
              <div class="vr-loading__dot"></div>
              <div class="vr-loading__dot"></div>
              <span>RETRIEVING VALIDATED INTELLIGENCE...</span>
            </div>
          </div>
          <div class="vr-pagination" id="vr-pagination" style="display:none;">
            <button class="vr-page-btn" id="vr-prev">◀ PREV</button>
            <span class="vr-page-info" id="vr-page-info"></span>
            <button class="vr-page-btn" id="vr-next">NEXT ▶</button>
          </div>
        </div>

      </div>
    `;
  }

  function computeValidatedStats(reports) {
    const total   = reports.length;
    const species = new Set(reports.map(r => r.species_name).filter(Boolean)).size;
    const scores  = reports.map(r => r.ai_confidence_score).filter(n => n != null);
    const avgConf = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const threats = reports.filter(r => (r.sensitivity_tier || 1) >= 3).length;
    const tiers   = { 1: 0, 2: 0, 3: 0 };
    reports.forEach(r => { const t = Math.min(3, parseInt(r.sensitivity_tier) || 1); tiers[t]++; });
    return { total, species, avgConf, threats, tiers };
  }

  function populateValidatedStats(stats) {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const el  = id => document.getElementById(id);
    if (el('vr-ts'))           el('vr-ts').textContent           = `SYNC · ${now}`;
    if (el('vr-stat-total'))   el('vr-stat-total').textContent   = stats.total;
    if (el('vr-stat-species')) el('vr-stat-species').textContent = stats.species;
    if (el('vr-stat-conf'))    el('vr-stat-conf').textContent    = stats.avgConf.toFixed(1) + '%';
    if (el('vr-stat-threat'))  el('vr-stat-threat').textContent  = stats.threats;
    const kvBlock = el('vr-kv-block');
    if (kvBlock) {
      kvBlock.innerHTML =
        kv('vr', 'T1 PUBLIC',       stats.tiers[1] + ' records') +
        kv('vr', 'T2 PROTECTED',    stats.tiers[2] + ' records') +
        kv('vr', 'T3 RESTRICTED',   stats.tiers[3] + ' records') +
        kv('vr', 'AVG CONFIDENCE',  stats.avgConf.toFixed(1) + '%') +
        kv('vr', 'TOTAL VALIDATED', String(stats.total));
    }
  }

  function renderValidatedRows(reports, page) {
    const body  = document.getElementById('vr-list-body');
    const pgBar = document.getElementById('vr-pagination');
    const pgInf = document.getElementById('vr-page-info');
    if (!body) return;

    if (!reports.length) {
      body.innerHTML = `<div class="vr-empty">NO RECORDS MATCH CURRENT FILTERS</div>`;
      if (pgBar) pgBar.style.display = 'none';
      return;
    }

    const totalPages = Math.ceil(reports.length / PAGE_SIZE);
    const start      = (page - 1) * PAGE_SIZE;
    const slice      = reports.slice(start, start + PAGE_SIZE);
    const tierLabels = { 1: 'PUBLIC', 2: 'PROTECT', 3: 'RESTRCT' };

    body.innerHTML = slice.map((r, i) => {
      const seq    = String(start + i + 1).padStart(3, '0');
      const date   = new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
      const tier   = Math.min(3, parseInt(r.sensitivity_tier) || 1);
      const conf   = r.ai_confidence_score != null ? Number(r.ai_confidence_score).toFixed(1) : null;
      const cClass = conf != null ? confClass('vr', Number(conf)) : '';
      return `
        <div class="vr-row" style="animation-delay:${(i % PAGE_SIZE) * 0.025}s" data-id="${r.report_id}">
          <span class="vr-row__seq">${seq}</span>
          <span class="vr-row__species">${r.species_name || 'Unknown Species'}</span>
          <span class="vr-row__region">${r.region_id || '—'}</span>
          <span class="vr-row__date">${date}</span>
          <div class="vr-row__tier">
            <div class="vr-tier-pip vr-tier-pip--${tier}"></div>
            <span class="vr-tier-label">T${tier} ${tierLabels[tier]}</span>
          </div>
          <span class="vr-row__conf ${cClass}">${conf != null ? conf + '%' : '—'}</span>
          <div class="vr-row__action">
            <button class="vr-view-btn" data-action="view" data-id="${r.report_id}">VIEW →</button>
          </div>
        </div>`;
    }).join('');

    if (pgBar && pgInf) {
      pgBar.style.display = totalPages > 1 ? 'flex' : 'none';
      pgInf.textContent   = `PAGE ${page} / ${totalPages}  ·  ${reports.length} RECORDS`;
      document.getElementById('vr-prev').disabled = page <= 1;
      document.getElementById('vr-next').disabled = page >= totalPages;
    }

    body.querySelectorAll('.vr-row').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('.vr-view-btn')) return;
        Router.navigate('report-detail', { reportId: row.dataset.id });
      });
    });
    body.querySelectorAll('.vr-view-btn').forEach(btn => {
      btn.addEventListener('click', () => Router.navigate('report-detail', { reportId: btn.dataset.id }));
    });
  }

  async function mountValidated() {
    let allReports = [], filtered = [], currentPage = 1;

    function applyFilters() {
      const search = (document.getElementById('vr-search')?.value || '').toLowerCase();
      const tier   = document.getElementById('vr-tier')?.value || '';
      filtered = allReports.filter(r => {
        const matchSearch = !search ||
          (r.species_name || '').toLowerCase().includes(search) ||
          (r.region_id    || '').toLowerCase().includes(search);
        return matchSearch && (!tier || String(r.sensitivity_tier) === tier);
      });
      currentPage = 1;
      renderValidatedRows(filtered, currentPage);
    }

    try {
      allReports = await API.get('/reports?status=VALIDATED');
      filtered   = allReports;
      populateValidatedStats(computeValidatedStats(allReports));
      renderValidatedRows(filtered, currentPage);
    } catch (err) {
      const body = document.getElementById('vr-list-body');
      if (body) body.innerHTML = `<div class="vr-empty" style="color:var(--vr-red);">ERR: ${err.message}</div>`;
    }

    document.getElementById('vr-search')?.addEventListener('input',  applyFilters);
    document.getElementById('vr-tier')?.addEventListener('change',   applyFilters);
    document.getElementById('vr-refresh')?.addEventListener('click', () => {
      allReports = []; filtered = []; currentPage = 1;
      const body = document.getElementById('vr-list-body');
      if (body) body.innerHTML = `<div class="vr-loading"><div class="vr-loading__dot"></div><div class="vr-loading__dot"></div><div class="vr-loading__dot"></div><span>REFRESHING...</span></div>`;
      mountValidated();
    });
    document.getElementById('vr-prev')?.addEventListener('click', () => {
      if (currentPage > 1) { currentPage--; renderValidatedRows(filtered, currentPage); }
    });
    document.getElementById('vr-next')?.addEventListener('click', () => {
      if (currentPage < Math.ceil(filtered.length / PAGE_SIZE)) { currentPage++; renderValidatedRows(filtered, currentPage); }
    });

    revealAll('vr-root');
  }

  /* ══════════════════════════════════════════════════════════
     PENDING QUEUE MODE — Analytics aesthetic, amber accent
  ══════════════════════════════════════════════════════════ */

  function buildPendingHTML() {
    const canAct = Auth.hasPermission('validate_report');
    return `
      <div id="pq-root" class="pq-page">

        ${ruler('pq', 'PENDING QUEUE — AWAITING RANGER VALIDATION', 'PQ/1.0')}

        <div class="pq-hero reveal">
          <div class="pq-hero__body">
            <div class="pq-hero__left">
              ${pill('pq', 'REVIEW SYS')}
              <div class="pq-id-large">PENDING</div>
              <div class="pq-id-sub">AWAITING VALIDATION</div>
              <div class="pq-id-meta" id="pq-ts">LOADING...</div>
            </div>
            <div class="pq-hero__centre">
              <div class="pq-kv-block" id="pq-kv-block">
                ${kv('pq', 'STATUS', 'LOADING')}
              </div>
            </div>
          </div>
          <div class="pq-stats-strip">
            <div class="pq-stat-cell">
              <div class="pq-stat-cell__label">Queue Depth</div>
              <div class="pq-stat-cell__val pq-stat-cell__val--amber" id="pq-stat-total">—</div>
            </div>
            <div class="pq-stat-cell">
              <div class="pq-stat-cell__label">Species Count</div>
              <div class="pq-stat-cell__val" id="pq-stat-species">—</div>
            </div>
            <div class="pq-stat-cell">
              <div class="pq-stat-cell__label">T3 Restricted</div>
              <div class="pq-stat-cell__val pq-stat-cell__val--red" id="pq-stat-t3">—</div>
            </div>
            <div class="pq-stat-cell">
              <div class="pq-stat-cell__label">Avg Confidence</div>
              <div class="pq-stat-cell__val pq-stat-cell__val--dim" id="pq-stat-conf">—</div>
            </div>
          </div>
        </div>

        ${ruler('pq', 'FILTER / SEARCH', 'FS-01')}

        <div class="pq-filter-bar reveal d1">
          <span class="pq-filter-bar__label">Search</span>
          <input class="pq-filter-input" id="pq-search" type="text" placeholder="Species, region…" />
          <span class="pq-filter-bar__label">Tier</span>
          <select class="pq-filter-select" id="pq-tier">
            <option value="">ALL</option>
            <option value="1">T1 — Public</option>
            <option value="2">T2 — Protected</option>
            <option value="3">T3 — Restricted</option>
          </select>
          <div class="pq-filter-sep"></div>
          <button class="pq-refresh-btn" id="pq-refresh">↺ REFRESH</button>
        </div>

        ${ruler('pq', 'QUEUE INDEX', 'QI-00')}

        <div class="pq-list-section reveal d2">
          <div class="pq-list-head">
            <span>#</span>
            <span>Species</span>
            <span>Region</span>
            <span>Date</span>
            <span>Tier</span>
            <span>Conf %</span>
            ${canAct ? '<span>Validate / Reject</span>' : '<span>View</span>'}
          </div>
          <div id="pq-list-body">
            <div class="pq-loading">
              <div class="pq-loading__dot"></div>
              <div class="pq-loading__dot"></div>
              <div class="pq-loading__dot"></div>
              <span>LOADING PENDING QUEUE...</span>
            </div>
          </div>
          <div class="pq-pagination" id="pq-pagination" style="display:none;">
            <button class="pq-page-btn" id="pq-prev">◀ PREV</button>
            <span class="pq-page-info" id="pq-page-info"></span>
            <button class="pq-page-btn" id="pq-next">NEXT ▶</button>
          </div>
        </div>

      </div>
    `;
  }

  function computePendingStats(reports) {
    const total   = reports.length;
    const species = new Set(reports.map(r => r.species_name).filter(Boolean)).size;
    const scores  = reports.map(r => r.ai_confidence_score).filter(n => n != null);
    const avgConf = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const t3      = reports.filter(r => (r.sensitivity_tier || 1) >= 3).length;
    const tiers   = { 1: 0, 2: 0, 3: 0 };
    reports.forEach(r => { const t = Math.min(3, parseInt(r.sensitivity_tier) || 1); tiers[t]++; });
    return { total, species, avgConf, t3, tiers };
  }

  function populatePendingStats(stats) {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const el  = id => document.getElementById(id);
    if (el('pq-ts'))           el('pq-ts').textContent           = `SYNC · ${now}`;
    if (el('pq-stat-total'))   el('pq-stat-total').textContent   = stats.total;
    if (el('pq-stat-species')) el('pq-stat-species').textContent = stats.species;
    if (el('pq-stat-t3'))      el('pq-stat-t3').textContent      = stats.t3;
    if (el('pq-stat-conf'))    el('pq-stat-conf').textContent    = stats.avgConf.toFixed(1) + '%';
    const kvBlock = el('pq-kv-block');
    if (kvBlock) {
      kvBlock.innerHTML =
        kv('pq', 'T1 PUBLIC',      stats.tiers[1] + ' pending') +
        kv('pq', 'T2 PROTECTED',   stats.tiers[2] + ' pending') +
        kv('pq', 'T3 RESTRICTED',  stats.tiers[3] + ' pending') +
        kv('pq', 'AVG CONFIDENCE', stats.avgConf.toFixed(1) + '%') +
        kv('pq', 'QUEUE DEPTH',    String(stats.total));
    }
  }

  function renderPendingRows(reports, page, onAction) {
    const canAct = Auth.hasPermission('validate_report');
    const body   = document.getElementById('pq-list-body');
    const pgBar  = document.getElementById('pq-pagination');
    const pgInf  = document.getElementById('pq-page-info');
    if (!body) return;

    if (!reports.length) {
      body.innerHTML = `<div class="pq-empty">QUEUE CLEAR — NO PENDING REPORTS</div>`;
      if (pgBar) pgBar.style.display = 'none';
      return;
    }

    const totalPages = Math.ceil(reports.length / PAGE_SIZE);
    const start      = (page - 1) * PAGE_SIZE;
    const slice      = reports.slice(start, start + PAGE_SIZE);
    const tierLabels = { 1: 'PUBLIC', 2: 'PROTECT', 3: 'RESTRCT' };

    body.innerHTML = slice.map((r, i) => {
      const seq    = String(start + i + 1).padStart(3, '0');
      const date   = new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
      const tier   = Math.min(3, parseInt(r.sensitivity_tier) || 1);
      const conf   = r.ai_confidence_score != null ? Number(r.ai_confidence_score).toFixed(1) : null;
      const cClass = conf != null ? confClass('pq', Number(conf)) : '';

      const actions = canAct
        ? `<div class="pq-row__actions">
             <button class="pq-act-btn pq-act-btn--validate" data-action="validate" data-id="${r.report_id}">✓ VALIDATE</button>
             <button class="pq-act-btn pq-act-btn--reject"   data-action="reject"   data-id="${r.report_id}">✕ REJECT</button>
           </div>`
        : `<div class="pq-row__actions">
             <button class="pq-view-btn" data-action="view" data-id="${r.report_id}">VIEW →</button>
           </div>`;

      return `
        <div class="pq-row" style="animation-delay:${(i % PAGE_SIZE) * 0.025}s" data-id="${r.report_id}">
          <span class="pq-row__seq">${seq}</span>
          <span class="pq-row__species">${r.species_name || 'Unknown Species'}</span>
          <span class="pq-row__region">${r.region_id || '—'}</span>
          <span class="pq-row__date">${date}</span>
          <div class="pq-row__tier">
            <div class="pq-tier-pip pq-tier-pip--${tier}"></div>
            <span class="pq-tier-label">T${tier} ${tierLabels[tier]}</span>
          </div>
          <span class="pq-row__conf ${cClass}">${conf != null ? conf + '%' : '—'}</span>
          ${actions}
        </div>`;
    }).join('');

    if (pgBar && pgInf) {
      pgBar.style.display = totalPages > 1 ? 'flex' : 'none';
      pgInf.textContent   = `PAGE ${page} / ${totalPages}  ·  ${reports.length} IN QUEUE`;
      document.getElementById('pq-prev').disabled = page <= 1;
      document.getElementById('pq-next').disabled = page >= totalPages;
    }

    // Row click → view
    body.querySelectorAll('.pq-row').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('.pq-act-btn') || e.target.closest('.pq-view-btn')) return;
        Router.navigate('report-detail', { reportId: row.dataset.id });
      });
    });

    // View btn
    body.querySelectorAll('.pq-view-btn').forEach(btn => {
      btn.addEventListener('click', () => Router.navigate('report-detail', { reportId: btn.dataset.id }));
    });

    // Validate / Reject
    body.querySelectorAll('.pq-act-btn').forEach(btn => {
      btn.addEventListener('click', () => onAction(btn.dataset.action, btn.dataset.id));
    });
  }

  async function mountPending() {
    let allReports = [], filtered = [], currentPage = 1;

    function applyFilters() {
      const search = (document.getElementById('pq-search')?.value || '').toLowerCase();
      const tier   = document.getElementById('pq-tier')?.value || '';
      filtered = allReports.filter(r => {
        const matchSearch = !search ||
          (r.species_name || '').toLowerCase().includes(search) ||
          (r.region_id    || '').toLowerCase().includes(search);
        return matchSearch && (!tier || String(r.sensitivity_tier) === tier);
      });
      currentPage = 1;
      renderPendingRows(filtered, currentPage, handleAction);
    }

    function handleAction(action, id) {
      const status = action === 'validate' ? 'VALIDATED' : 'REJECTED';
      Modal.open({
        title: action === 'validate' ? 'Validate Report' : 'Reject Report',
        body: `<p>Are you sure you want to <strong>${action}</strong> this report?</p>`,
        confirmLabel: action === 'validate' ? 'VALIDATE' : 'REJECT',
        onConfirm: async () => {
          try {
            await API.patch(`/reports/${id}/validate`, { status });
            Toast.success(`Report ${status.toLowerCase()} successfully.`);
            // Remove from local list and re-render
            allReports = allReports.filter(r => r.report_id !== id);
            filtered   = filtered.filter(r => r.report_id !== id);
            populatePendingStats(computePendingStats(allReports));
            renderPendingRows(filtered, currentPage, handleAction);
          } catch (err) {
            Toast.error(err.message);
          }
        }
      });
    }

    try {
      allReports = await API.get('/reports?status=PENDING');
      filtered   = allReports;
      populatePendingStats(computePendingStats(allReports));
      renderPendingRows(filtered, currentPage, handleAction);
    } catch (err) {
      const body = document.getElementById('pq-list-body');
      if (body) body.innerHTML = `<div class="pq-empty" style="color:var(--pq-red);">ERR: ${err.message}</div>`;
    }

    document.getElementById('pq-search')?.addEventListener('input',  applyFilters);
    document.getElementById('pq-tier')?.addEventListener('change',   applyFilters);
    document.getElementById('pq-refresh')?.addEventListener('click', () => {
      allReports = []; filtered = []; currentPage = 1;
      const body = document.getElementById('pq-list-body');
      if (body) body.innerHTML = `<div class="pq-loading"><div class="pq-loading__dot"></div><div class="pq-loading__dot"></div><div class="pq-loading__dot"></div><span>REFRESHING...</span></div>`;
      mountPending();
    });
    document.getElementById('pq-prev')?.addEventListener('click', () => {
      if (currentPage > 1) { currentPage--; renderPendingRows(filtered, currentPage, handleAction); }
    });
    document.getElementById('pq-next')?.addEventListener('click', () => {
      if (currentPage < Math.ceil(filtered.length / PAGE_SIZE)) { currentPage++; renderPendingRows(filtered, currentPage, handleAction); }
    });

    revealAll('pq-root');
  }

  /* ══════════════════════════════════════════════════════════
     PUBLIC: render
  ══════════════════════════════════════════════════════════ */
  function render(container, mode = 'my-reports') {
    if (mode === 'validated') {
      container.innerHTML = buildValidatedHTML();
      mountValidated();
    } else if (mode === 'pending') {
      container.innerHTML = buildPendingHTML();
      mountPending();
    } else {
      container.innerHTML = buildMyReportsHTML();
      mountMyReports();
    }
  }

  return { render };
})();
