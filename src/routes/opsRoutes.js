/* ============================================================
   TERRA – opsRoutes.js
   Ops Console API — Phases 1–6.

   WHAT THIS MODULE DOES
   ─────────────────────
   Provides aggregated data and action endpoints for the Ops
   Console tactical dashboard. Data is derived from existing
   tables; ACK persistence uses the alert_acks table (Phase 4);
   action dispatch uses the ops_actions table (Phase 6).

   ROLE RULES
   ──────────
   • All endpoints require authentication.
   • Any role may read (Rangers, Analysts, Admins).
   • Any role may ACK an alert or dispatch an action.

   ENDPOINTS
   ─────────
   GET   /api/ops/summary           — rangers, threats, alerts, sensors
   PATCH /api/ops/alerts/:id/ack    — persist alert acknowledgement
   POST  /api/ops/actions           — log a dispatched action
   ============================================================ */

const express    = require('express');
const router     = express.Router();
const { pool }   = require('../config/db');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

/* ── GET /api/ops/summary ───────────────────────────────────
   Returns a single payload the Ops Console needs on mount.
   Each alert includes acked_by_me so the frontend can restore
   acknowledged state across page loads.
─────────────────────────────────────────────────────────── */
router.get('/summary', async (req, res) => {
    try {
        const [rangersResult, threatsResult, sensorsResult, basesResult] = await Promise.all([
            pool.query(`
                SELECT
                    u.user_id,
                    u.username,
                    u.region_id,
                    u.home_lat,
                    u.home_lng,
                    u.last_lat,
                    u.last_lng,
                    u.last_ping,
                    r.name AS role_name
                FROM  users u
                JOIN  roles r ON u.role_id = r.role_id
                WHERE LOWER(r.name) = 'ranger'
                ORDER BY u.username ASC
            `),

            // Threats/Alerts: tier 3 (High) or 4 (Critical) in last 24 hours.
            // acked_by_me is true when the requesting user has an alert_acks row.
            pool.query(`
                SELECT
                    r.report_id,
                    r.sensitivity_tier,
                    r.validation_status,
                    r.ai_confidence_score,
                    r.created_at,
                    r.description,
                    r.region_id,
                    ST_Y(r.geom) AS lat,
                    ST_X(r.geom) AS lng,
                    COALESCE(s.common_name, r.species_name_custom, 'Unknown Species') AS species_name,
                    u.username AS submitted_by,
                    EXISTS (
                        SELECT 1 FROM alert_acks aa
                        WHERE aa.report_id = r.report_id
                          AND aa.user_id   = $1
                    ) AS acked_by_me
                FROM  reports r
                LEFT  JOIN species s ON r.species_id = s.species_id
                LEFT  JOIN users   u ON r.user_id    = u.user_id
                WHERE r.sensitivity_tier IN (3, 4)
                  AND r.created_at > NOW() - INTERVAL '24 hours'
                ORDER BY r.created_at DESC
                LIMIT 50
            `, [req.user.user_id]),

            // Sensors: all records, ordered by status then name
            pool.query(`
                SELECT
                    sensor_id,
                    name,
                    type,
                    sector,
                    status,
                    battery_pct,
                    last_sync,
                    lat,
                    lng
                FROM  sensors
                ORDER BY
                    CASE status WHEN 'online' THEN 0 WHEN 'degraded' THEN 1 ELSE 2 END,
                    name ASC
            `),

            // Command bases: fetched from DB — no longer hardcoded on the frontend
            pool.query(`
                SELECT base_id, name, lat, lng, sector
                FROM   command_bases
                ORDER  BY name ASC
            `)
        ]);

        const rangers = rangersResult.rows.map(u => {
            // Prefer live device position; fall back to admin-assigned home position
            const lat = u.last_lat ?? u.home_lat ?? null;
            const lng = u.last_lng ?? u.home_lng ?? null;
            return {
                id:        `ranger-${u.user_id}`,
                user_id:   u.user_id,
                name:      u.username,
                role:      u.role_name,
                region:    u.region_id || null,
                team_id:   null,
                team:      null,
                status:    u.last_ping ? 'active' : 'idle',
                lastPing:  u.last_ping ? new Date(u.last_ping).toISOString() : null,
                lat,
                lng,
                home_lat:  u.home_lat ?? null,
                home_lng:  u.home_lng ?? null,
            };
        });

        const threats = threatsResult.rows.map(r => ({
            id:           `threat-${r.report_id}`,
            report_id:    r.report_id,
            kind:         Number(r.sensitivity_tier) === 4 ? 'threat' : 'caution',
            lat:          r.lat != null ? parseFloat(r.lat) : null,
            lng:          r.lng != null ? parseFloat(r.lng) : null,
            label:        r.species_name,
            confidence:   r.ai_confidence_score != null ? r.ai_confidence_score / 100 : null,
            status:       r.validation_status,
            created_at:   r.created_at,
            submitted_by: r.submitted_by || null,
            description:  r.description  || null,
        }));

        const alerts = threatsResult.rows.map(r => ({
            id:           `threat-${r.report_id}`,
            kind:         Number(r.sensitivity_tier) === 4 ? 'alert' : 'warn',
            title:        r.species_name,
            conf:         r.ai_confidence_score != null ? (r.ai_confidence_score / 100).toFixed(2) : '—',
            source:       r.submitted_by ? `field report — ${r.submitted_by}` : 'field report',
            time:         new Date(r.created_at).toISOString(),
            sector:       r.region_id ? String(r.region_id) : null,
            acked_by_me:  r.acked_by_me === true,
        }));

        const sensors = sensorsResult.rows.map(s => ({
            id:       `sensor-${s.sensor_id}`,
            name:     s.name,
            type:     s.type,
            sector:   s.sector   || '—',
            status:   s.status,
            battery:  s.battery_pct != null ? `${s.battery_pct}%` : '—',
            lastSync: s.last_sync
                ? new Date(s.last_sync).toUTCString().slice(17, 25) // HH:MM:SS
                : '—',
            lat:      s.lat != null ? parseFloat(s.lat) : null,
            lng:      s.lng != null ? parseFloat(s.lng) : null,
        }));

        const command_bases = basesResult.rows.map(b => ({
            id:     `command-${b.base_id}`,
            base_id: b.base_id,
            kind:   'command',
            label:  b.name,
            lat:    parseFloat(b.lat),
            lng:    parseFloat(b.lng),
            sector: b.sector || null,
        }));

        res.json({ rangers, threats, alerts, sensors, command_bases });
    } catch (err) {
        console.error('[OPS] Summary error:', err.message);
        console.error(err.stack);
        res.status(500).json({ error: err.message || 'Failed to load ops summary' });
    }
});

/* ── PATCH /api/ops/alerts/:id/ack ──────────────────────────
   Persists an alert acknowledgement for the requesting user.
   :id is the frontend alert ID, e.g. "threat-<uuid>".

   Idempotent — acknowledging an already-ACKed alert is a no-op
   (ON CONFLICT DO NOTHING).
─────────────────────────────────────────────────────────── */
router.patch('/alerts/:id/ack', async (req, res) => {
    const raw = req.params.id;

    // Alert IDs are prefixed "threat-<uuid>" on the frontend
    const reportId = raw.startsWith('threat-') ? raw.slice('threat-'.length) : raw;

    // Basic UUID format check before hitting the DB
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(reportId)) {
        return res.status(400).json({ error: 'Invalid alert id' });
    }

    try {
        await pool.query(`
            INSERT INTO alert_acks (report_id, user_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
        `, [reportId, req.user.user_id]);

        res.json({ acked: true, report_id: reportId });
    } catch (err) {
        console.error('[OPS] ACK error:', err.message);
        res.status(500).json({ error: err.message || 'Failed to acknowledge alert' });
    }
});

/* ── POST /api/ops/actions ───────────────────────────────────
   Logs a dispatched ops action (deploy, waypoint, comms, clear).
   Returns the created record so the frontend can confirm receipt.

   Body: { type, target_id?, payload? }
     type      — one of: deploy | waypoint | comms | clear
     target_id — loose string ref to the affected entity (alert/ranger ID)
     payload   — optional JSONB for extra context (coords, message, etc.)
─────────────────────────────────────────────────────────── */
router.post('/actions', async (req, res) => {
    const VALID_TYPES = ['deploy', 'waypoint', 'comms', 'clear'];
    const { type, target_id = null, payload = null } = req.body || {};

    if (!VALID_TYPES.includes(type)) {
        return res.status(400).json({ error: `Invalid action type. Must be one of: ${VALID_TYPES.join(', ')}` });
    }

    try {
        const { rows } = await pool.query(`
            INSERT INTO ops_actions (type, initiated_by, target_id, payload)
            VALUES ($1, $2, $3, $4)
            RETURNING action_id, type, target_id, created_at
        `, [type, req.user.user_id, target_id, payload ? JSON.stringify(payload) : null]);

        res.status(201).json(rows[0]);
    } catch (err) {
        console.error('[OPS] Action error:', err.message);
        res.status(500).json({ error: err.message || 'Failed to dispatch action' });
    }
});

module.exports = router;
