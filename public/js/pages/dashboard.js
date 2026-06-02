/* ============================================================
   TERRA – dashboard.js
   Command overview: mission brief, metric rail, spark map,
   horizontal timeline, activity feed, confidence band.
   ============================================================ */

const DashboardPage = (() => {

  /* ══════════════════════════════════════════════════════════
     PRIMITIVES
  ══════════════════════════════════════════════════════════ */
  function ruler(label, ver) {
    return `
      <div class="db-ruler">
        <div class="db-ruler__tick"></div>
        <span class="db-ruler__label">${label}</span>
        <div class="db-ruler__track">
          <div class="db-ruler__pip"></div>
          <div class="db-ruler__pip"></div>
          <div class="db-ruler__pip"></div>
        </div>
        <span class="db-ruler__ver">${ver}</span>
      </div>`;
  }

  function skel(w, h) {
    return `<div class="db-skel" style="width:${w};height:${h};"></div>`;
  }

  /* ══════════════════════════════════════════════════════════
     HTML BUILDERS
  ══════════════════════════════════════════════════════════ */

  function buildBrief() {
    const user = Auth.getUser?.() || {};
    const name = (user.display_name || user.username || 'OPERATOR').toUpperCase();
    return `
      <div class="db-brief reveal">
        <div class="db-brief__main">
          <div class="db-brief__eyebrow">
            <span class="db-brief__pill">TERRA SYS</span>
            <span class="db-brief__live">
              <span class="db-brief__live-dot"></span>
              LIVE
            </span>
          </div>
          <div class="db-brief__callsign">WELCOME,&nbsp;<span id="db-name">${name}</span></div>
          <div class="db-brief__context" id="db-context">
            Loading field intelligence summary&hellip;
          </div>
          <div class="db-brief__actions">
            <button class="db-brief__btn db-brief__btn--primary" data-page="submit-report">+ SUBMIT REPORT</button>
            <button class="db-brief__btn" data-page="map">OPS CONSOLE</button>
            <button class="db-brief__btn" data-page="my-reports">MY REPORTS</button>
          </div>
        </div>
        <div class="db-brief__sys">
          <div class="db-brief__clock">
            <div class="db-brief__clock-time" id="db-clock">00:00:00</div>
            <div class="db-brief__clock-date" id="db-date">—</div>
            <div class="db-brief__clock-tz">UTC · TERRA UNIFIED TIME</div>
          </div>
          <div class="db-brief__status-list">
            <div class="db-sys-row">
              <div class="db-sys-dot db-sys-dot--go"></div>
              <span class="db-sys-label">API</span>
              <span class="db-sys-val">ONLINE</span>
            </div>
            <div class="db-sys-row">
              <div class="db-sys-dot db-sys-dot--go"></div>
              <span class="db-sys-label">AI ENGINE</span>
              <span class="db-sys-val">READY</span>
            </div>
            <div class="db-sys-row">
              <div class="db-sys-dot db-sys-dot--go"></div>
              <span class="db-sys-label">SYNC</span>
              <span class="db-sys-val" id="db-sync-age">—</span>
            </div>
          </div>
        </div>
      </div>`;
  }

  function buildMetricRail() {
    return `
      <div class="db-metric-rail reveal d1">
        <div class="db-metric db-metric--green">
          <div class="db-metric__label">Total Reports</div>
          <div class="db-metric__val db-skel" id="db-m-total" style="width:60px;height:2.4rem;"></div>
          <div class="db-metric__sub">All time</div>
        </div>
        <div class="db-metric db-metric--amber">
          <div class="db-metric__label">Pending Review</div>
          <div class="db-metric__val db-skel" id="db-m-pending" style="width:48px;height:2.4rem;"></div>
          <div class="db-metric__sub">Awaiting validation</div>
        </div>
        <div class="db-metric db-metric--dim">
          <div class="db-metric__label">Validated</div>
          <div class="db-metric__val db-skel" id="db-m-validated" style="width:48px;height:2.4rem;"></div>
          <div class="db-metric__sub">Confirmed sightings</div>
        </div>
        <div class="db-metric db-metric--dim">
          <div class="db-metric__label">Species Tracked</div>
          <div class="db-metric__val db-skel" id="db-m-species" style="width:48px;height:2.4rem;"></div>
          <div class="db-metric__sub">Unique taxa</div>
        </div>
      </div>`;
  }

  function buildBody() {
    return buildFeedPanel();
  }


  function buildFeedPanel() {
    return `
      <div class="db-feed-panel reveal d2">
        <div class="db-feed-panel__head">
          <span class="db-feed-panel__title">RECENT REPORTS</span>
          <span class="db-feed-panel__count" id="db-feed-count">—</span>
        </div>
        <div class="db-feed-list" id="db-feed-list">
          ${[0,1,2,3,4,5].map(i => `
            <div class="db-feed-item db-feed-item--pending" style="animation-delay:${i*0.06}s">
              <div class="db-feed-item__bar"></div>
              <div class="db-feed-item__body">
                <div class="db-skel" style="width:70%;height:11px;"></div>
                <div class="db-feed-item__meta">
                  <div class="db-skel" style="width:50%;height:9px;"></div>
                  <div class="db-skel" style="width:28px;height:9px;"></div>
                </div>
              </div>
            </div>`).join('')}
        </div>
        <div class="db-feed-footer">
          <button class="db-feed-footer__btn" data-page="my-reports">VIEW ALL REPORTS →</button>
        </div>
      </div>`;
  }

  function buildConfPanel() {
    return `
      <div class="db-conf-panel reveal d4">
        ${ruler('AI CONFIDENCE OVERVIEW — SCORE DISTRIBUTION', 'CV/1.0')}
        <div class="db-conf-body">
          <div class="db-conf-score-cell">
            <div class="db-conf-score-label">AVG SCORE</div>
            <div class="db-conf-score-val db-skel" id="db-conf-avg" style="width:80px;height:2.2rem;"></div>
            <div class="db-conf-score-sub" id="db-conf-pop">— REPORTS</div>
          </div>
          <div class="db-conf-bars">
            <div class="db-conf-row">
              <span class="db-conf-row__label">HIGH ≥70</span>
              <div class="db-conf-row__track"><div class="db-conf-row__fill" id="db-cf-high" style="background:var(--db-green);"></div></div>
              <span class="db-conf-row__val" id="db-cv-high" style="color:var(--db-green);">—</span>
            </div>
            <div class="db-conf-row">
              <span class="db-conf-row__label">MED 40–69</span>
              <div class="db-conf-row__track"><div class="db-conf-row__fill" id="db-cf-med" style="background:var(--db-amber);"></div></div>
              <span class="db-conf-row__val" id="db-cv-med" style="color:var(--db-amber);">—</span>
            </div>
            <div class="db-conf-row">
              <span class="db-conf-row__label">LOW &lt;40</span>
              <div class="db-conf-row__track"><div class="db-conf-row__fill" id="db-cf-low" style="background:var(--db-red);"></div></div>
              <span class="db-conf-row__val" id="db-cv-low" style="color:var(--db-red);">—</span>
            </div>
          </div>
        </div>
      </div>`;
  }

  /* ══════════════════════════════════════════════════════════
     CLOCK
  ══════════════════════════════════════════════════════════ */
  let _clockInterval = null;

  function startClock() {
    stopClock();
    function tick() {
      const now  = new Date();
      const hh   = String(now.getUTCHours()).padStart(2, '0');
      const mm   = String(now.getUTCMinutes()).padStart(2, '0');
      const ss   = String(now.getUTCSeconds()).padStart(2, '0');
      const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
      const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
      const timeEl = document.getElementById('db-clock');
      const dateEl = document.getElementById('db-date');
      if (timeEl) timeEl.textContent = `${hh}:${mm}:${ss}`;
      if (dateEl) dateEl.textContent = `${days[now.getUTCDay()]} ${String(now.getUTCDate()).padStart(2,'0')} ${months[now.getUTCMonth()]} ${now.getUTCFullYear()}`;
    }
    tick();
    _clockInterval = setInterval(tick, 1000);
  }

  function stopClock() {
    if (_clockInterval) { clearInterval(_clockInterval); _clockInterval = null; }
  }

  /* ══════════════════════════════════════════════════════════
     ACTIVITY FEED
  ══════════════════════════════════════════════════════════ */
  function renderFeed(reports) {
    const list    = document.getElementById('db-feed-list');
    const countEl = document.getElementById('db-feed-count');
    if (!list) return;

    if (!reports.length) {
      list.innerHTML = `<div class="db-feed-empty">NO REPORTS YET</div>`;
      if (countEl) countEl.textContent = '0 REPORTS';
      return;
    }

    if (countEl) countEl.textContent = `${reports.length} TOTAL`;

    const recent = [...reports].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 12);

    list.innerHTML = recent.map((r, i) => {
      const status  = (r.validation_status || 'PENDING').toLowerCase();
      const species = r.species_name || 'Unknown Species';
      const region  = r.region_id || '—';
      const time    = r.created_at
        ? new Date(r.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'2-digit' })
        : '—';
      return `
        <div class="db-feed-item db-feed-item--${status}" data-id="${r.report_id || ''}" style="animation-delay:${i * 0.045}s">
          <div class="db-feed-item__bar"></div>
          <div class="db-feed-item__body">
            <div class="db-feed-item__species">${species}</div>
            <div class="db-feed-item__meta">
              <span class="db-feed-item__region">${region}</span>
              <span class="db-feed-item__time">${time}</span>
            </div>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.db-feed-item[data-id]').forEach(item => {
      item.addEventListener('click', () => {
        if (item.dataset.id) Router.navigate('report-detail', { reportId: item.dataset.id });
      });
    });
  }

  /* ══════════════════════════════════════════════════════════
     METRICS + CONFIDENCE
  ══════════════════════════════════════════════════════════ */
  function populateMetrics(stats) {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('db-skel');
      el.style.width = '';
      el.style.height = '';
      el.textContent = val ?? '—';
    };
    set('db-m-total',     stats.total);
    set('db-m-pending',   stats.pending);
    set('db-m-validated', stats.validated);
    set('db-m-species',   stats.species_count);
  }

  function populateConfidence(stats) {
    const { total, avg_confidence, conf_high, conf_medium, conf_low } = stats;

    const avgEl = document.getElementById('db-conf-avg');
    const popEl = document.getElementById('db-conf-pop');
    if (avgEl) {
      avgEl.classList.remove('db-skel');
      avgEl.style.width = ''; avgEl.style.height = '';
      const score = avg_confidence || 0;
      const color = score >= 70 ? 'var(--db-green)' : score >= 40 ? 'var(--db-amber)' : 'var(--db-red)';
      avgEl.style.color = color;
      avgEl.textContent = score.toFixed(1) + '%';
    }
    if (popEl) popEl.textContent = `${total || 0} REPORTS`;

    const pct = n => total ? Math.round((n / total) * 100) : 0;
    const hP = pct(conf_high), mP = pct(conf_medium), lP = pct(conf_low);

    function setBar(fillId, valId, p, count) {
      const fill = document.getElementById(fillId);
      const val  = document.getElementById(valId);
      if (fill) setTimeout(() => { fill.style.width = p + '%'; }, 120);
      if (val)  val.textContent = `${count} · ${p}%`;
    }
    setBar('db-cf-high', 'db-cv-high', hP, conf_high   || 0);
    setBar('db-cf-med',  'db-cv-med',  mP, conf_medium || 0);
    setBar('db-cf-low',  'db-cv-low',  lP, conf_low    || 0);
  }

  function buildContextSentence(stats, reports) {
    const pending   = stats.pending   || 0;
    const validated = stats.validated || 0;
    const total     = stats.total     || 0;
    const species   = stats.species_count || 0;

    const highTier  = reports.filter(r => (r.sensitivity_tier || 1) >= 3).length;
    const parts     = [];

    if (total === 0) return `No field reports on record. Submit your first sighting to begin.`;

    if (pending > 0)   parts.push(`<strong>${pending} report${pending !== 1 ? 's' : ''} pending validation</strong>`);
    if (highTier > 0)  parts.push(`<strong>${highTier} high-tier sighting${highTier !== 1 ? 's' : ''}</strong> flagged`);
    if (validated > 0) parts.push(`<strong>${validated} confirmed</strong> across ${species} species`);

    return parts.length
      ? parts.join(' &nbsp;·&nbsp; ') + '.'
      : `<strong>${total}</strong> total report${total !== 1 ? 's' : ''} on record across <strong>${species}</strong> species.`;
  }

  function setSyncAge() {
    const el = document.getElementById('db-sync-age');
    if (el) el.textContent = new Date().toISOString().slice(11, 19) + ' UTC';
  }

  /* ══════════════════════════════════════════════════════════
     REVEAL
  ══════════════════════════════════════════════════════════ */
  function revealAll() {
    requestAnimationFrame(() => {
      document.querySelectorAll('#db-root .reveal').forEach(el => {
        setTimeout(() => el.classList.add('visible'), 40);
      });
    });
  }

  /* ══════════════════════════════════════════════════════════
     DATA LOAD
  ══════════════════════════════════════════════════════════ */
  async function loadData() {
    try {
      const [stats, reports] = await Promise.all([
        API.get('/reports/stats'),
        API.get('/reports?limit=50'),
      ]);

      populateMetrics(stats);
      populateConfidence(stats);

      const ctx = document.getElementById('db-context');
      if (ctx) ctx.innerHTML = buildContextSentence(stats, reports);

      renderFeed(reports);
      setSyncAge();

    } catch (err) {
      console.error('[Dashboard] Load error:', err);
      ['db-m-total','db-m-pending','db-m-validated','db-m-species'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.classList.remove('db-skel'); el.style.cssText = ''; el.textContent = '—'; }
      });
      const ctx = document.getElementById('db-context');
      if (ctx) ctx.textContent = 'Could not load field intelligence. Check connection.';
    }
  }

  /* ══════════════════════════════════════════════════════════
     PUBLIC: render
  ══════════════════════════════════════════════════════════ */
  function render(container) {
    stopClock();

    container.innerHTML = `
      <div id="db-root" class="db-page">
        ${ruler('TERRA COMMAND OVERVIEW — DASHBOARD', 'DB/2.0')}
        ${buildBrief()}
        ${buildMetricRail()}
        ${buildBody()}
        ${buildConfPanel()}
      </div>`;

    /* Wire nav buttons */
    container.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', () => Router.navigate(btn.dataset.page));
    });

    startClock();
    revealAll();
    loadData();
  }

  return { render };
})();
