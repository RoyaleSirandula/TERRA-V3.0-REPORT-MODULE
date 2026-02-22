/* ============================================================
   TERRA – timelineWidget.js
   Chronological event timeline widget showing the full
   report lifecycle (submitted → AI scored → validated/rejected)
   and any subsequent audit events.
   ============================================================ */

const TimelineWidget = (() => {

    /* ── Internal: derive timeline events from report data ────── */
    function buildEvents(report) {
        const events = [];

        // 1. Report submitted
        events.push({
            label: 'Report Submitted',
            meta: new Date(report?.created_at || Date.now()).toLocaleString(),
            dotClass: '',
        });

        // 2. AI scored
        if (report?.ai_confidence_score != null) {
            events.push({
                label: `AI Scored — ${Number(report.ai_confidence_score).toFixed(1)}% confidence`,
                meta: 'Automated scoring pipeline',
                dotClass: '',
            });
        } else {
            events.push({
                label: 'Awaiting AI Scoring',
                meta: 'Pipeline processing…',
                dotClass: 'timeline-item__dot--muted',
            });
        }

        // 3. Ranger review
        const status = (report?.validation_status || 'PENDING').toUpperCase();
        if (status === 'VALIDATED') {
            events.push({
                label: 'Validated by Ranger',
                meta: report?.validated_at
                    ? new Date(report.validated_at).toLocaleString()
                    : 'Recently',
                dotClass: '',
            });
        } else if (status === 'REJECTED') {
            events.push({
                label: 'Rejected by Ranger',
                meta: report?.validated_at
                    ? new Date(report.validated_at).toLocaleString()
                    : 'Recently',
                dotClass: 'timeline-item__dot--danger',
            });
        } else {
            events.push({
                label: 'Pending Ranger Review',
                meta: 'Assigned to regional ranger queue',
                dotClass: 'timeline-item__dot--warning',
            });
        }

        // 4. Data feed (only if validated)
        if (status === 'VALIDATED') {
            events.push({
                label: 'Data Fed to Predictive Model',
                meta: 'Migration & trend analysis updated',
                dotClass: '',
            });
            events.push({
                label: 'Analyst Access Unlocked',
                meta: 'Anonymized dataset available for export',
                dotClass: '',
            });
        }

        return events;
    }

    /* ── Definition ──────────────────────────────────────────── */
    const timelineDefinition = {
        id: 'timeline-lifecycle',
        name: 'Report Lifecycle',
        icon: '🕐',
        desc: 'Chronological event timeline from submission to analyst access.',
        defaultSpan: 4,
        flush: false,

        render(container, report) {
            const events = buildEvents(report);
            const itemsHTML = events.map((ev, i) => `
        <div class="timeline-item" style="animation-delay:${i * 0.08}s">
          <div class="timeline-item__dot ${ev.dotClass}"></div>
          <div class="timeline-item__content">
            <div class="timeline-item__label">${ev.label}</div>
            <div class="timeline-item__meta">${ev.meta}</div>
          </div>
        </div>
      `).join('');

            container.innerHTML = `<div class="timeline">${itemsHTML}</div>`;
        }
    };

    /* ── Second variant: Audit Log mini-feed ─────────────────── */
    const auditDefinition = {
        id: 'timeline-audit',
        name: 'Audit Log Feed',
        icon: '📜',
        desc: 'Live feed of audit events associated with this report.',
        defaultSpan: 4,
        flush: false,

        render(container, report) {
            // Derived from report details
            const events = [
                { label: 'Report created', meta: new Date(report?.created_at || Date.now()).toLocaleString(), dot: '' },
                { label: 'AI pipeline triggered', meta: 'Automated System', dot: '' },
                { label: 'Ranger queue assigned', meta: 'Regional Queue', dot: 'timeline-item__dot--warning' }
            ];

            if (report.validation_status !== 'PENDING') {
                events.push({
                    label: `Report ${report.validation_status.toLowerCase()}`,
                    meta: `Action by Ranger (ID: ${report.validated_by || 'Unknown User'}) at ${report.validated_at ? new Date(report.validated_at).toLocaleString() : 'Recently'}`,
                    dot: report.validation_status === 'REJECTED' ? 'timeline-item__dot--danger' : ''
                });
            }

            const itemsHTML = events.map((ev, i) => `
        <div class="timeline-item" style="animation-delay:${i * 0.08}s">
          <div class="timeline-item__dot ${ev.dot}"></div>
          <div class="timeline-item__content">
            <div class="timeline-item__label">${ev.label}</div>
            <div class="timeline-item__meta">${ev.meta}</div>
          </div>
        </div>
      `).join('');

            container.innerHTML = `<div class="timeline">${itemsHTML}</div>`;
        }
    };

    WidgetRegistry.register(timelineDefinition);
    WidgetRegistry.register(auditDefinition);

    return {};
})();
