/* ============================================================
   TERRA – timelineWidget.js
   Report lifecycle and audit log widgets, styled to mirror the
   kpi.html tl-row pattern: monospace phase label, Syne title,
   accent dot, DM Sans body copy.
   ============================================================ */

const TimelineWidget = (() => {

    /* ── Internal: build a single tl-row entry ───────────────── */
    function buildRow(phase, title, desc, dotAccent = true, delay = 0) {
        const dotColor = dotAccent ? 'var(--clr-brand)' : 'var(--clr-border)';
        return `
            <div class="tl-row" style="
                display: grid;
                grid-template-columns: 120px 1fr;
                align-items: start;
                padding: 24px 28px;
                gap: 24px;
                background: var(--clr-surface);
                border-bottom: 1px solid var(--clr-border);
                transition: background var(--transition-normal);
                animation: fadeInUp var(--transition-slow) both;
                animation-delay: ${delay}s;
            "
            >
                <div style="
                    font-family: var(--font-mono);
                    font-size: 10px;
                    letter-spacing: 0.06em;
                    color: var(--clr-brand);
                    text-transform: uppercase;
                    padding-top: 3px;
                ">${phase}</div>
                <div style="display:flex; align-items:flex-start; gap: 12px;">
                    <div style="
                        width: 6px; height: 6px;
                        background: ${dotColor};
                        border-radius: 50%;
                        flex-shrink: 0;
                        margin-top: 5px;
                        box-shadow: ${dotAccent ? '0 0 6px var(--clr-brand-glow)' : 'none'};
                    "></div>
                    <div>
                        <div style="
                            font-family: var(--font-label);
                            font-size: 13px;
                            font-weight: var(--fw-bold);
                            letter-spacing: -0.01em;
                            color: var(--clr-text);
                            margin-bottom: 6px;
                        ">${title}</div>
                        <div style="
                            font-size: 12px;
                            color: var(--clr-text-muted);
                            line-height: 1.75;
                        ">${desc}</div>
                    </div>
                </div>
            </div>
        `;
    }

    /* ── Internal: derive lifecycle events from report data ────── */
    function buildLifecycleEvents(report) {
        const status    = (report?.validation_status || 'PENDING').toUpperCase();
        const score     = Number(report?.ai_confidence_score ?? 0);
        const createdAt = new Date(report?.created_at || Date.now());
        const events    = [];

        events.push({
            phase:   'Submitted',
            title:   'Report Received',
            desc:    createdAt.toLocaleString(),
            accent:  true,
        });

        if (score != null && !isNaN(score)) {
            events.push({
                phase:   'Scoring',
                title:   `ICE Scored — ${score.toFixed(1)}% confidence`,
                desc:    'Automated intelligence confidence pipeline',
                accent:  true,
            });
        }

        if (status === 'VALIDATED') {
            events.push({
                phase:   'Validated',
                title:   'Field Officer Approved',
                desc:    report?.validated_at
                    ? new Date(report.validated_at).toLocaleString()
                    : 'Validation timestamp unavailable',
                accent:  true,
            });
            events.push({
                phase:   'Pipeline',
                title:   'Data Fed to Predictive Model',
                desc:    'Migration & trend analysis updated',
                accent:  true,
            });
            events.push({
                phase:   'Cleared',
                title:   'Analyst Access Unlocked',
                desc:    'Anonymised dataset available for export',
                accent:  true,
            });
        } else if (status === 'REJECTED') {
            events.push({
                phase:   'Rejected',
                title:   'Report Flagged & Excluded',
                desc:    report?.validated_at
                    ? new Date(report.validated_at).toLocaleString()
                    : 'Recently',
                accent:  false,
            });
        } else {
            events.push({
                phase:   'Pending',
                title:   'Awaiting Ranger Review',
                desc:    'Assigned to regional ranger queue',
                accent:  false,
            });
        }

        return events;
    }

    /* ── Definition: Report Lifecycle ────────────────────────── */
    const timelineDefinition = {
        id:          'timeline-lifecycle',
        name:        'Report Lifecycle',
        icon:        '',
        desc:        'Chronological event timeline from submission to analyst access.',
        defaultSpan: 12,
        extraClass:  'widget--timeline',
        flush:       false,

        render(container, report) {
            const events = buildLifecycleEvents(report);
            container.innerHTML = events
                .map((ev, i) => buildRow(ev.phase, ev.title, ev.desc, ev.accent, i * 0.07))
                .join('');
        },
    };

    /* ── Definition: Audit Log ───────────────────────────────── */
    const auditDefinition = {
        id:          'timeline-audit',
        name:        'Audit Log',
        icon:        '',
        desc:        'Audit events associated with this report.',
        defaultSpan: 12,
        extraClass:  'widget--timeline',
        flush:       false,

        render(container, report) {
            const events = [
                {
                    phase: 'Created',
                    title: 'Report Created',
                    desc:  new Date(report?.created_at || Date.now()).toLocaleString(),
                    accent: true,
                },
                {
                    phase: 'System',
                    title: 'AI Pipeline Triggered',
                    desc:  'Automated scoring system',
                    accent: true,
                },
                {
                    phase: 'Queue',
                    title: 'Ranger Queue Assigned',
                    desc:  'Regional queue — awaiting review',
                    accent: false,
                },
            ];

            if (report.validation_status !== 'PENDING') {
                events.push({
                    phase:  report.validation_status === 'VALIDATED' ? 'Validated' : 'Rejected',
                    title:  `Report ${report.validation_status.charAt(0) + report.validation_status.slice(1).toLowerCase()}`,
                    desc:   `Ranger ID: ${report.validated_by || 'Unknown'} · ${report.validated_at ? new Date(report.validated_at).toLocaleString() : 'Recently'}`,
                    accent: report.validation_status === 'VALIDATED',
                });
            }

            container.innerHTML = events
                .map((ev, i) => buildRow(ev.phase, ev.title, ev.desc, ev.accent, i * 0.07))
                .join('');
        },
    };

    WidgetRegistry.register(timelineDefinition);
    WidgetRegistry.register(auditDefinition);

    return {};
})();
