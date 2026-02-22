const Report = require('../models/Report');

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
        const { status, region_id, limit, offset } = req.query;

        // RBAC Logic for Filtering
        // If not Admin or Analyst, user constraints apply?
        // Actually, middleware protects the route, controller handles logic.
        // But Ranger should only see their region? The current specs say yes.
        // Dynamic RBAC checks permissions, but data scoping is logic.

        // For now, simple implementation:
        const filters = {
            limit, offset, status, region_id
        };

        // If user has 'view_own_reports' only, filter by user_id
        if (req.user.permissions.includes('view_own_reports') && !req.user.permissions.includes('view_pending_reports')) {
            // Community logic mostly
            filters.user_id = req.user.user_id;
        }

        const reports = await Report.findAll(filters);
        res.json(reports);
    } catch (err) {
        console.error('Error fetching reports:', err);
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
