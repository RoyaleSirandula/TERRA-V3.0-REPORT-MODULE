'use strict';

const express    = require('express');
const router     = express.Router();
const { pool }   = require('../config/db');
const { authenticate } = require('../middleware/auth');
const Movebank   = require('../utils/movebank.service');

// Helper: run a Movebank call; if token expired (401), clear and retry once
async function _mb(fn) {
    try {
        return await fn();
    } catch (err) {
        if (err.message.includes('401')) {
            Movebank.clearToken();
            return fn(); // one retry with a fresh token
        }
        throw err;
    }
}

router.use(authenticate);

/* ── GET /api/movebank/studies?taxon=X ─────────────────────────
 * Search Movebank for studies by taxon name.
 * Returns a list of study summaries (id, name, sensor types, etc.)
 */
router.get('/studies', async (req, res) => {
    try {
        const studies = await _mb(() => Movebank.searchStudies({ taxon: req.query.taxon }));
        res.json(studies);
    } catch (err) {
        console.error('[Movebank] searchStudies error:', err.message);
        res.status(502).json({ error: err.message });
    }
});

/* ── GET /api/movebank/study/:id ────────────────────────────────
 * Fetch metadata for a single study by its Movebank ID.
 */
router.get('/study/:id', async (req, res) => {
    try {
        const info = await _mb(() => Movebank.getStudyInfo(req.params.id));
        res.json(info);
    } catch (err) {
        console.error('[Movebank] getStudyInfo error:', err.message);
        res.status(502).json({ error: err.message });
    }
});

/* ── GET /api/movebank/track ────────────────────────────────────
 * Return quality-filtered tracking fixes for a study, scoped
 * to a report's time window and geographic bounding radius.
 *
 * Query params:
 *   study_id    — Movebank study ID (required)
 *   report_id   — Terra report UUID (required; derives centre + time)
 *   window_days — ± days around sighting_timestamp (default: 30, max: 180)
 *   radius_km   — geographic filter radius in km   (default: 500)
 */
router.get('/track', async (req, res) => {
    try {
        const { study_id, report_id, window_days = 30, radius_km = 500 } = req.query;

        if (!study_id)  return res.status(400).json({ error: 'study_id is required' });
        if (!report_id) return res.status(400).json({ error: 'report_id is required' });

        // Derive spatial and temporal context from the report
        const { rows } = await pool.query(
            `SELECT ST_Y(geom) AS lat,
                    ST_X(geom) AS lng,
                    sighting_timestamp
             FROM   reports
             WHERE  report_id = $1`,
            [report_id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Report not found' });

        const lat        = parseFloat(rows[0].lat);
        const lng        = parseFloat(rows[0].lng);
        const centerTime = new Date(rows[0].sighting_timestamp);

        const days      = Math.min(Math.max(1, parseInt(window_days)), 180);
        const startTime = new Date(centerTime.getTime() - days * 86_400_000);
        const endTime   = new Date(centerTime.getTime() + days * 86_400_000);

        const fixes = await _mb(() => Movebank.getTrackSegment({
            studyId:  study_id,
            startTime,
            endTime,
            lat,
            lng,
            radiusKm: parseFloat(radius_km),
        }));

        res.json({
            study_id,
            window:   { start: startTime.toISOString(), end: endTime.toISOString(), days },
            center:   { lat, lng },
            radiusKm: parseFloat(radius_km),
            count:    fixes.length,
            fixes,
        });
    } catch (err) {
        console.error('[Movebank] getTrack error:', err.message);
        res.status(502).json({ error: err.message });
    }
});

/* ── PATCH /api/movebank/attach ─────────────────────────────────
 * Attach a Movebank study ID to a Terra report.
 * Body: { report_id, study_id, window_days?, radius_km? }
 */
router.patch('/attach', async (req, res) => {
    try {
        const { report_id, study_id, window_days = 30, radius_km = 500 } = req.body;

        if (!report_id || !study_id) {
            return res.status(400).json({ error: 'report_id and study_id are required' });
        }

        const config = {
            window_days:  parseInt(window_days),
            radius_km:    parseFloat(radius_km),
            attached_by:  req.user.user_id,
            attached_at:  new Date().toISOString(),
        };

        const { rows } = await pool.query(
            `UPDATE reports
             SET    movebank_study_id = $1,
                    movebank_config   = $2
             WHERE  report_id = $3
             RETURNING report_id, movebank_study_id, movebank_config`,
            [study_id, JSON.stringify(config), report_id]
        );

        if (!rows[0]) return res.status(404).json({ error: 'Report not found' });
        res.json(rows[0]);
    } catch (err) {
        console.error('[Movebank] attach error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/* ── DELETE /api/movebank/detach/:report_id ─────────────────────
 * Remove the Movebank study link from a report.
 */
router.delete('/detach/:report_id', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `UPDATE reports
             SET    movebank_study_id = NULL,
                    movebank_config   = '{}'
             WHERE  report_id = $1
             RETURNING report_id`,
            [req.params.report_id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Report not found' });
        res.json({ success: true });
    } catch (err) {
        console.error('[Movebank] detach error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
