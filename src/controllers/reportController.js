const Report = require('../models/Report');
const { query } = require('../config/db');

exports.createReport = async (req, res) => {
    try {
        const { species_id, latitude, longitude, sighting_timestamp, description, region_id, sensitivity_tier } = req.body;

        // Validate required fields
        if (!latitude || !longitude || !region_id) {
            return res.status(400).json({ error: 'Missing required fields: latitude, longitude, region_id' });
        }

        // If user typed a name instead of picking a registry UUID
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const isUuid = species_id && uuidRegex.test(species_id.trim());
        const validSpeciesId = isUuid ? species_id.trim() : null;
        const customSpeciesName = !isUuid && species_id ? species_id.trim() : null;

        const reportData = {
            user_id: req.user.user_id,
            species_id: validSpeciesId,
            species_name_custom: customSpeciesName,
            latitude,
            longitude,
            sighting_timestamp: sighting_timestamp || new Date(),
            media_url: req.file ? req.file.path : null, // Local path from Multer
            description,
            region_id: region_id && region_id.trim() !== '' ? region_id : 'Unknown Region', // Now TEXT in DB
            sensitivity_tier: sensitivity_tier || 1 // Default to Public if not specified
        };

        console.log('[DEBUG] Submitting report with data:', JSON.stringify(reportData, null, 2));
        const newReport = await Report.create(reportData);
        res.status(201).json({ message: 'Report submitted successfully', report: newReport });
    } catch (err) {
        console.error('[CRITICAL] Report creation failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

exports.getReportById = async (req, res) => {
    try {
        const { id } = req.params;
        const report = await Report.findById(id);

        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }

        res.json(report);
    } catch (err) {
        console.error('Error fetching report:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

exports.getReports = async (req, res) => {
    try {
        const { status, region_id, limit, offset, mine } = req.query;

        const filters = { limit, offset, status, region_id };

        /*
         * Scope rules (two independent gates, both enforced server-side):
         *
         * Gate A — Community-tier hard scope:
         *   Community accounts have view_own_reports but NOT view_pending_reports.
         *   They ALWAYS see only their own reports regardless of the ?mine param.
         *
         * Gate B — Explicit mine=true param:
         *   Any role can request ?mine=true to see only their own submissions.
         *   Used by the My Reports page for ALL roles so Rangers/Analysts/Admins
         *   also see only their own reports when on the My Reports view.
         */
        const isCommunityTier = req.user.permissions.includes('view_own_reports')
            && !req.user.permissions.includes('view_pending_reports');

        if (isCommunityTier || mine === 'true') {
            filters.user_id = req.user.user_id;
        }

        const reports = await Report.findAll(filters);
        res.json(reports);
    } catch (err) {
        console.error('Error fetching reports:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

exports.getStats = async (req, res) => {
    try {
        let userFilter = '';
        const params = [];
        if (req.user.permissions.includes('view_own_reports') && !req.user.permissions.includes('view_pending_reports')) {
            userFilter = 'WHERE user_id = $1';
            params.push(req.user.user_id);
        }

        const { rows } = await query(`
            SELECT
                COUNT(*)::int                                                                              AS total,
                COUNT(*) FILTER (WHERE validation_status = 'PENDING')::int                                AS pending,
                COUNT(*) FILTER (WHERE validation_status = 'VALIDATED')::int                              AS validated,
                COUNT(DISTINCT COALESCE(species_id::text, species_name_custom))::int                      AS species_count,
                COALESCE(ROUND(AVG(ai_confidence_score))::int, 0)                                         AS avg_confidence,
                COUNT(*) FILTER (WHERE ai_confidence_score >= 70)::int                                    AS conf_high,
                COUNT(*) FILTER (WHERE ai_confidence_score >= 40 AND ai_confidence_score < 70)::int       AS conf_medium,
                COUNT(*) FILTER (WHERE ai_confidence_score < 40 OR ai_confidence_score IS NULL)::int      AS conf_low
            FROM reports
            ${userFilter}
        `, params);

        res.json(rows[0]);
    } catch (err) {
        console.error('[API] Stats error:', err);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
};

/* ── AI Brief: rule-based intelligence synthesis ──────────── */
function generateAIBrief(report) {
    const score      = Number(report.ai_confidence_score || 0);
    const tier       = Number(report.sensitivity_tier || 1);
    const breakdown  = Array.isArray(report.confidence_breakdown) ? report.confidence_breakdown : [];
    const passed     = breakdown.filter(i => i.status === 'PASSED');
    const unmet      = breakdown.filter(i => i.status !== 'PASSED');
    const tierLabels = ['', 'Public', 'Protected', 'Restricted', 'Confidential'];

    const riskLevel      = score >= 70 ? 'LOW' : score >= 40 ? 'MODERATE' : 'HIGH';
    const considerations = [];

    // Confidence assessment
    if (score >= 70) {
        considerations.push(`Confidence score of ${score.toFixed(1)}% meets the validation threshold. Report is suitable for immediate field action.`);
    } else if (score >= 40) {
        considerations.push(`Moderate confidence score of ${score.toFixed(1)}%. Cross-reference with adjacent sightings before escalating.`);
    } else {
        considerations.push(`Low confidence score of ${score.toFixed(1)}%. Manual verification strongly recommended before acting on this report.`);
    }

    // Sensitivity classification
    if (tier >= 3) {
        considerations.push(`Sensitivity classification: Tier ${tier} – ${tierLabels[tier] || 'Sensitive'}. Restrict dissemination to authorised personnel only.`);
    } else if (tier === 2) {
        considerations.push(`Tier 2 Protected classification — exercise caution when sharing location data externally.`);
    }

    // Passed intelligence criteria
    if (passed.length > 0) {
        considerations.push(`${passed.length} intelligence ${passed.length === 1 ? 'criterion' : 'criteria'} confirmed: ${passed.map(p => p.label).join(', ')}.`);
    }

    // Unmet criteria
    if (unmet.length > 0) {
        considerations.push(`${unmet.length} unmet ${unmet.length === 1 ? 'criterion' : 'criteria'} — ${unmet.map(f => f.label).join(', ')} — may reduce operational confidence.`);
    }

    // Region context
    if (report.region_id && report.region_id !== 'Unknown Region') {
        considerations.push(`Report originates from region "${report.region_id}". Cross-reference with the regional threat matrix for baseline activity levels.`);
    }

    // Validation status
    const statusMessages = {
        PENDING:   'Status: PENDING validation. Do not treat as confirmed intelligence until reviewed by a field officer.',
        VALIDATED: 'Status: VALIDATED. Cleared by a field officer and approved for operational use.',
        REJECTED:  'Status: REJECTED. Data has been flagged and is excluded from the active intelligence feed.',
    };
    const statusMsg = statusMessages[(report.validation_status || '').toUpperCase()];
    if (statusMsg) considerations.push(statusMsg);

    // Threat keyword scan on description
    if (report.description) {
        const desc    = report.description.toLowerCase();
        const threats = ['fire', 'smoke', 'illegal', 'poach', 'hunt', 'trap', 'snare', 'camp', 'vehicle', 'armed', 'shot', 'gun'];
        const flagged = threats.filter(k => desc.includes(k));
        if (flagged.length > 0) {
            considerations.push(`Description flags potential threat indicators: ${flagged.join(', ')}. Recommend immediate ranger dispatch to verify.`);
        }
    }

    return { riskLevel, score, tier, considerations, generatedAt: new Date().toISOString() };
}

exports.getAIBrief = async (req, res) => {
    try {
        const { id } = req.params;
        const report = await Report.findById(id);
        if (!report) return res.status(404).json({ error: 'Report not found' });

        // Community tier is excluded from AI brief access
        const isCommunity = req.user.permissions.includes('view_own_reports')
            && !req.user.permissions.includes('view_pending_reports');
        if (isCommunity) return res.status(403).json({ error: 'Access denied' });

        res.json({ brief: generateAIBrief(report) });
    } catch (err) {
        console.error('[AI-BRIEF] Error generating brief:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

exports.validateReport = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!['VALIDATED', 'REJECTED'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const report = await Report.updateStatus(id, status, req.user.user_id);
        if (!report) return res.status(404).json({ error: 'Report not found' });

        res.json({ message: `Report ${status}`, report });
    } catch (err) {
        console.error('Error validating report:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
