const express = require('express');
const router  = express.Router();
const { pool }         = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireCap }   = require('../utils/capabilities');

router.use(authenticate);

/* ── 1. Advanced Sighting Filter (Spatiotemporal) ────────────── */
/*
 * own_only scoping:
 * Community members have siteAnalysis.ownReportsOnly = true in the
 * capability matrix.  When the query param ?own_only=true is present
 * AND the authenticated user carries this capability, the WHERE clause
 * is restricted to r.user_id = current user.  This prevents a Community
 * account from seeing other users' validated reports even if they call
 * the endpoint directly without the frontend restriction.
 */
router.get('/sightings', async (req, res) => {
    try {
        const { start_date, end_date, species_id, north, south, east, west, own_only } = req.query;

        const { buildCapabilities } = require('../utils/capabilities');
        const caps = buildCapabilities(req.user.role_name);
        const forceOwnOnly = caps.siteAnalysis.ownReportsOnly;

        let query = `
            SELECT r.report_id, r.species_id, r.user_id,
                   COALESCE(s.common_name, r.species_name_custom, 'Unknown Species') as species_name,
                   r.validation_status, r.sensitivity_tier, r.ai_confidence_score,
                   r.sighting_timestamp as created_at,
                   ST_X(r.geom) as longitude, ST_Y(r.geom) as latitude
            FROM reports r
            LEFT JOIN species s ON r.species_id = s.species_id
            WHERE r.validation_status = 'VALIDATED'
        `;
        const values = [];
        let paramIdx = 1;

        // Scope to own reports for Community tier or explicit own_only param
        if (forceOwnOnly || own_only === 'true') {
            query += ` AND r.user_id = $${paramIdx++}`;
            values.push(req.user.user_id);
        }

        if (start_date && end_date) {
            query += ` AND r.sighting_timestamp BETWEEN $${paramIdx++} AND $${paramIdx++}`;
            values.push(start_date, end_date);
        }

        if (species_id) {
            query += ` AND r.species_id = $${paramIdx++}`;
            values.push(species_id);
        }

        if (north && south && east && west) {
            query += ` AND ST_Within(r.geom, ST_MakeEnvelope($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, 4326))`;
            values.push(west, south, east, north);
        }

        query += ` ORDER BY r.sighting_timestamp DESC LIMIT 1000`;

        const result = await pool.query(query, values);
        res.json(result.rows);
    } catch (err) {
        console.error('[API] Enhanced sightings error:', err);
        res.status(500).json({ error: 'Failed to fetch analytical sightings' });
    }
});

/* ── 2. User Map Objects (CRUD for User Scoped Drawings) ────── */
router.get('/user-objects', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT object_id, type, ST_AsGeoJSON(geometry)::json as geometry, meta_data, created_at
            FROM user_map_objects
            WHERE user_id = $1
            ORDER BY created_at ASC
        `, [req.user.user_id]);
        res.json(result.rows);
    } catch (err) {
        console.error('[API] Fetch objects error:', err);
        res.status(500).json({ error: 'Failed to fetch user objects' });
    }
});

router.post('/user-objects', async (req, res) => {
    try {
        const { type, geometry, meta_data } = req.body;
        // geometry is coming as a GeoJSON string/object
        const geomStr = typeof geometry === 'string' ? geometry : JSON.stringify(geometry);

        const result = await pool.query(`
            INSERT INTO user_map_objects (user_id, type, geometry, meta_data)
            VALUES ($1, $2, ST_GeomFromGeoJSON($3), $4)
            RETURNING object_id, type, ST_AsGeoJSON(geometry)::json as geometry, meta_data
        `, [req.user.user_id, type, geomStr, meta_data || {}]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('[API] Create object error:', err);
        res.status(500).json({ error: 'Failed to save map object' });
    }
});

router.delete('/user-objects/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM user_map_objects WHERE object_id = $1 AND user_id = $2 RETURNING object_id',
            [req.params.id, req.user.user_id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Object not found' });
        res.json({ success: true });
    } catch (err) {
        console.error('[API] Delete object error:', err);
        res.status(500).json({ error: 'Failed to delete object' });
    }
});

/* ── 3. NDVI Zonal Statistics ───────────────────────────────── */
/* Gate: Community accounts cannot run NDVI analysis. */
router.post('/ndvi-zonal', requireCap('siteAnalysis.ndviAnalysis'), async (req, res) => {
    // Phase 1: Mocked response. In production, this would use ST_SummaryStatsAgg(ST_Clip(raster, geometry))
    try {
        const { polygon } = req.body;

        // Pretend calculation taking 600ms
        await new Promise(resolve => setTimeout(resolve, 600));

        // Generate semi-random realistic looking data
        const mean = 0.4 + (Math.random() * 0.3);
        const min = mean - 0.2;
        const max = mean + 0.2;

        // Mock time-series trend
        const trend = Array.from({ length: 6 }).map((_, i) => ({
            date: new Date(Date.now() - (5 - i) * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            value: mean + (Math.random() * 0.1 - 0.05)
        }));

        res.json({
            mean: mean.toFixed(3),
            min: min.toFixed(3),
            max: max.toFixed(3),
            change_30_days: (Math.random() * 0.05 - 0.02).toFixed(3),
            trend: trend
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to compute NDVI stats' });
    }
});

/* ── 4. Buffer & Proximity Analysis ────────────────────────── */
/* Gate: Community accounts cannot run buffer analysis. */
router.post('/buffer', requireCap('siteAnalysis.bufferAnalysis'), async (req, res) => {
    try {
        const { geometry, radius_meters } = req.body;
        const geomStr = typeof geometry === 'string' ? geometry : JSON.stringify(geometry);

        // Find sightings within this buffer
        // Note: Using ST_Buffer with geography is generally better for meters, 
        // but we'll use a rough degree approximation or ST_DWithin for performance.

        const query = `
            SELECT COUNT(*) as total_sightings, 
                   json_agg(json_build_object('species_id', species_id, 'date', sighting_timestamp)) as sightings_list
            FROM reports
            WHERE validation_status = 'VALIDATED'
            AND ST_DWithin(geom::geography, ST_GeomFromGeoJSON($1)::geography, $2)
        `;

        const result = await pool.query(query, [geomStr, radius_meters || 5000]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('[API] Buffer error:', err);
        res.status(500).json({ error: 'Buffer analysis failed' });
    }
});

module.exports = router;
