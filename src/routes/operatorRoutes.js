/* ============================================================
   TERRA – operatorRoutes.js
   Operator Management API — Field Asset Location Control.

   WHAT THIS MODULE DOES
   ─────────────────────
   Provides read and edit endpoints for the three classes of
   field assets whose locations are managed via the Operator
   Management UI: command bases, sensors, and rangers.

   Admin-only endpoints require the manage_users permission.
   Device ping endpoints (auto-update) require any valid token.

   ENDPOINTS
   ─────────
   GET    /api/operator/assets                  — all assets for management UI
   POST   /api/operator/command-bases           — create command base
   PATCH  /api/operator/command-bases/:id       — edit command base
   DELETE /api/operator/command-bases/:id       — remove command base
   PATCH  /api/operator/sensors/:id             — edit sensor
   POST   /api/operator/sensors/:id/ping        — device auto-update (any auth)
   PATCH  /api/operator/rangers/:id/home        — set ranger home position
   POST   /api/operator/rangers/:id/ping        — device auto-update (any auth)
   ============================================================ */

const express  = require('express');
const router   = express.Router();
const { pool } = require('../config/db');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

/* ── Admin guard middleware ──────────────────────────────────
   Applied selectively to write endpoints that require the
   manage_users permission. Ping endpoints skip this guard.
─────────────────────────────────────────────────────────── */
async function requireAdmin(req, res, next) {
    try {
        const { rows } = await pool.query(`
            SELECT p.slug
            FROM   users u
            JOIN   roles r       ON u.role_id      = r.role_id
            JOIN   role_permissions rp ON r.role_id = rp.role_id
            JOIN   permissions p  ON rp.permission_id = p.permission_id
            WHERE  u.user_id = $1
              AND  p.slug    = 'manage_users'
        `, [req.user.user_id]);

        if (rows.length === 0) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        next();
    } catch (err) {
        console.error('[OPERATOR] Admin check error:', err.message);
        res.status(500).json({ error: 'Authorization check failed' });
    }
}

/* ── GET /api/operator/assets ────────────────────────────────
   Returns all three asset classes for the management UI.
   Accessible to any authenticated user so rangers can see
   base locations; edits are admin-gated at the PATCH level.
─────────────────────────────────────────────────────────── */
router.get('/assets', async (req, res) => {
    try {
        const [basesResult, sensorsResult, rangersResult] = await Promise.all([
            pool.query(`
                SELECT base_id, name, lat, lng, sector, updated_at
                FROM   command_bases
                ORDER  BY name ASC
            `),
            pool.query(`
                SELECT sensor_id, name, type, sector, status,
                       battery_pct, lat, lng, last_sync
                FROM   sensors
                ORDER  BY name ASC
            `),
            pool.query(`
                SELECT u.user_id, u.username, u.email,
                       u.home_lat, u.home_lng,
                       u.last_lat, u.last_lng, u.last_ping,
                       r.name AS role_name
                FROM   users u
                JOIN   roles r ON u.role_id = r.role_id
                WHERE  LOWER(r.name) = 'ranger'
                ORDER  BY u.username ASC
            `),
        ]);

        res.json({
            command_bases: basesResult.rows,
            sensors:       sensorsResult.rows,
            rangers:       rangersResult.rows,
        });
    } catch (err) {
        console.error('[OPERATOR] Assets error:', err.message);
        res.status(500).json({ error: err.message || 'Failed to load assets' });
    }
});

/* ── POST /api/operator/command-bases ────────────────────────
   Create a new command base.
   Body: { name, lat, lng, sector? }
─────────────────────────────────────────────────────────── */
router.post('/command-bases', requireAdmin, async (req, res) => {
    const { name, lat, lng, sector = null } = req.body || {};

    if (!name || lat == null || lng == null) {
        return res.status(400).json({ error: 'name, lat, and lng are required' });
    }
    if (typeof lat !== 'number' || typeof lng !== 'number') {
        return res.status(400).json({ error: 'lat and lng must be numbers' });
    }

    try {
        const { rows } = await pool.query(`
            INSERT INTO command_bases (name, lat, lng, sector)
            VALUES ($1, $2, $3, $4)
            RETURNING base_id, name, lat, lng, sector, updated_at
        `, [name.trim(), lat, lng, sector || null]);

        res.status(201).json(rows[0]);
    } catch (err) {
        console.error('[OPERATOR] Create base error:', err.message);
        res.status(500).json({ error: err.message || 'Failed to create command base' });
    }
});

/* ── PATCH /api/operator/command-bases/:id ───────────────────
   Update a command base's name, coordinates, or sector.
   Body: { name?, lat?, lng?, sector? }
─────────────────────────────────────────────────────────── */
router.patch('/command-bases/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, lat, lng, sector } = req.body || {};

    const fields = [];
    const values = [];
    let   idx    = 1;

    if (name  != null) { fields.push(`name   = $${idx++}`); values.push(name.trim()); }
    if (lat   != null) { fields.push(`lat    = $${idx++}`); values.push(lat); }
    if (lng   != null) { fields.push(`lng    = $${idx++}`); values.push(lng); }
    if (sector !== undefined) { fields.push(`sector = $${idx++}`); values.push(sector || null); }

    if (fields.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    try {
        const { rows } = await pool.query(`
            UPDATE command_bases
            SET    ${fields.join(', ')}
            WHERE  base_id = $${idx}
            RETURNING base_id, name, lat, lng, sector, updated_at
        `, values);

        if (rows.length === 0) return res.status(404).json({ error: 'Command base not found' });
        res.json(rows[0]);
    } catch (err) {
        console.error('[OPERATOR] Update base error:', err.message);
        res.status(500).json({ error: err.message || 'Failed to update command base' });
    }
});

/* ── DELETE /api/operator/command-bases/:id ──────────────────
   Remove a command base permanently.
─────────────────────────────────────────────────────────── */
router.delete('/command-bases/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const { rowCount } = await pool.query(
            'DELETE FROM command_bases WHERE base_id = $1', [id]
        );
        if (rowCount === 0) return res.status(404).json({ error: 'Command base not found' });
        res.json({ deleted: true, base_id: id });
    } catch (err) {
        console.error('[OPERATOR] Delete base error:', err.message);
        res.status(500).json({ error: err.message || 'Failed to delete command base' });
    }
});

/* ── PATCH /api/operator/sensors/:id ────────────────────────
   Update sensor metadata or location manually.
   Body: { name?, lat?, lng?, sector?, type?, status? }
─────────────────────────────────────────────────────────── */
router.patch('/sensors/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, lat, lng, sector, type, status } = req.body || {};

    const VALID_STATUSES = ['online', 'offline', 'degraded'];
    if (status != null && !VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const fields = [];
    const values = [];
    let   idx    = 1;

    if (name   != null) { fields.push(`name   = $${idx++}`); values.push(name.trim()); }
    if (lat    != null) { fields.push(`lat    = $${idx++}`); values.push(lat); }
    if (lng    != null) { fields.push(`lng    = $${idx++}`); values.push(lng); }
    if (sector !== undefined) { fields.push(`sector = $${idx++}`); values.push(sector || null); }
    if (type   != null) { fields.push(`type   = $${idx++}`); values.push(type.trim()); }
    if (status != null) { fields.push(`status = $${idx++}`); values.push(status); }

    if (fields.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);

    try {
        const { rows } = await pool.query(`
            UPDATE sensors
            SET    ${fields.join(', ')}
            WHERE  sensor_id = $${idx}
            RETURNING sensor_id, name, type, sector, status, battery_pct, lat, lng, last_sync
        `, values);

        if (rows.length === 0) return res.status(404).json({ error: 'Sensor not found' });
        res.json(rows[0]);
    } catch (err) {
        console.error('[OPERATOR] Update sensor error:', err.message);
        res.status(500).json({ error: err.message || 'Failed to update sensor' });
    }
});

/* ── POST /api/operator/sensors/:id/ping ────────────────────
   Device auto-update. Called by the sensor hardware/gateway.
   Any authenticated token accepted — no admin requirement.
   Body: { lat, lng, battery_pct?, status? }
─────────────────────────────────────────────────────────── */
router.post('/sensors/:id/ping', async (req, res) => {
    const { id } = req.params;
    const { lat, lng, battery_pct, status } = req.body || {};

    if (lat == null || lng == null) {
        return res.status(400).json({ error: 'lat and lng are required' });
    }

    const VALID_STATUSES = ['online', 'offline', 'degraded'];
    if (status != null && !VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const fields = ['lat = $1', 'lng = $2', 'last_sync = NOW()'];
    const values = [lat, lng];
    let   idx    = 3;

    if (battery_pct != null) { fields.push(`battery_pct = $${idx++}`); values.push(battery_pct); }
    if (status      != null) { fields.push(`status      = $${idx++}`); values.push(status); }

    values.push(id);

    try {
        const { rows } = await pool.query(`
            UPDATE sensors
            SET    ${fields.join(', ')}
            WHERE  sensor_id = $${idx}
            RETURNING sensor_id, name, lat, lng, status, battery_pct, last_sync
        `, values);

        if (rows.length === 0) return res.status(404).json({ error: 'Sensor not found' });
        res.json({ updated: true, ...rows[0] });
    } catch (err) {
        console.error('[OPERATOR] Sensor ping error:', err.message);
        res.status(500).json({ error: err.message || 'Failed to update sensor location' });
    }
});

/* ── PATCH /api/operator/rangers/:id/home ───────────────────
   Admin sets a ranger's static home/assigned position.
   Body: { home_lat, home_lng }
─────────────────────────────────────────────────────────── */
router.patch('/rangers/:id/home', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { home_lat, home_lng } = req.body || {};

    if (home_lat == null || home_lng == null) {
        return res.status(400).json({ error: 'home_lat and home_lng are required' });
    }

    try {
        const { rows } = await pool.query(`
            UPDATE users
            SET    home_lat = $1, home_lng = $2
            WHERE  user_id  = $3
            RETURNING user_id, username, home_lat, home_lng
        `, [home_lat, home_lng, id]);

        if (rows.length === 0) return res.status(404).json({ error: 'Ranger not found' });
        res.json(rows[0]);
    } catch (err) {
        console.error('[OPERATOR] Update ranger home error:', err.message);
        res.status(500).json({ error: err.message || 'Failed to update ranger home position' });
    }
});

/* ── POST /api/operator/rangers/:id/ping ────────────────────
   Device auto-update. Called by ranger mobile app / GPS unit.
   Any authenticated token accepted — no admin requirement.
   Body: { lat, lng }
─────────────────────────────────────────────────────────── */
router.post('/rangers/:id/ping', async (req, res) => {
    const { id } = req.params;
    const { lat, lng } = req.body || {};

    if (lat == null || lng == null) {
        return res.status(400).json({ error: 'lat and lng are required' });
    }

    try {
        const { rows } = await pool.query(`
            UPDATE users
            SET    last_lat  = $1,
                   last_lng  = $2,
                   last_ping = NOW()
            WHERE  user_id   = $3
            RETURNING user_id, username, last_lat, last_lng, last_ping
        `, [lat, lng, id]);

        if (rows.length === 0) return res.status(404).json({ error: 'Ranger not found' });
        res.json({ updated: true, ...rows[0] });
    } catch (err) {
        console.error('[OPERATOR] Ranger ping error:', err.message);
        res.status(500).json({ error: err.message || 'Failed to update ranger location' });
    }
});

module.exports = router;
