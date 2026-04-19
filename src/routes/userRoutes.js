/* ============================================================
   TERRA – userRoutes.js
   Operator management endpoints. All routes require:
     - authenticate    (valid JWT)
     - manage_users    (RBAC permission slug)

   Endpoints:
     GET    /api/users               – full operator roster
     GET    /api/users/roles         – all roles with permissions + head count
     PATCH  /api/users/:id/role      – reassign operator role
     PATCH  /api/users/:id/status    – set verification_status
     DELETE /api/users/:id           – permanently revoke operator access

   Self-mutation guards on every write endpoint prevent an admin
   from accidentally locking themselves out or demotion-by-mistake.
   ============================================================ */

const express = require('express');
const router  = express.Router();
const { pool } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.use(authorize('manage_users'));

/* ── 1. Operator Roster ─────────────────────────────────── */
router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT
                u.user_id,
                u.username,
                u.email,
                u.verification_status,
                u.region_id,
                u.created_at,
                r.role_id,
                r.name AS role_name
            FROM users u
            LEFT JOIN roles r ON u.role_id = r.role_id
            ORDER BY u.created_at DESC
        `);
        res.json(rows);
    } catch (err) {
        console.error('[API] List users error:', err);
        res.status(500).json({ error: 'Failed to fetch operator roster' });
    }
});

/* ── 2. Roles with permissions + head count ─────────────── */
router.get('/roles', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT
                r.role_id,
                r.name,
                COUNT(DISTINCT u.user_id)::int         AS user_count,
                COALESCE(
                    json_agg(p.slug ORDER BY p.slug)
                    FILTER (WHERE p.slug IS NOT NULL),
                    '[]'
                )                                      AS permissions
            FROM roles r
            LEFT JOIN role_permissions rp ON r.role_id   = rp.role_id
            LEFT JOIN permissions      p  ON rp.permission_id = p.permission_id
            LEFT JOIN users            u  ON u.role_id   = r.role_id
            GROUP BY r.role_id, r.name
            ORDER BY r.name
        `);
        res.json(rows);
    } catch (err) {
        console.error('[API] List roles error:', err);
        res.status(500).json({ error: 'Failed to fetch role definitions' });
    }
});

/* ── 3. Reassign operator role ──────────────────────────── */
router.patch('/:id/role', async (req, res) => {
    const { id }      = req.params;
    const { role_id } = req.body;

    if (id === String(req.user.user_id)) {
        return res.status(400).json({ error: 'Cannot change your own role.' });
    }
    if (!role_id) {
        return res.status(400).json({ error: 'role_id is required.' });
    }

    try {
        const { rows } = await pool.query(
            `UPDATE users
                SET role_id = $1
              WHERE user_id = $2
          RETURNING user_id, username, role_id`,
            [role_id, id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Operator not found' });
        res.json(rows[0]);
    } catch (err) {
        console.error('[API] Update role error:', err);
        res.status(500).json({ error: 'Failed to reassign role' });
    }
});

/* ── 4. Set verification status ─────────────────────────── */
router.patch('/:id/status', async (req, res) => {
    const { id }     = req.params;
    const { status } = req.body;

    const VALID = ['VERIFIED', 'PENDING', 'SUSPENDED'];
    if (!VALID.includes(status)) {
        return res.status(400).json({ error: `Status must be one of: ${VALID.join(', ')}` });
    }
    if (id === String(req.user.user_id)) {
        return res.status(400).json({ error: 'Cannot change your own verification status.' });
    }

    try {
        const { rows } = await pool.query(
            `UPDATE users
                SET verification_status = $1
              WHERE user_id = $2
          RETURNING user_id, username, verification_status`,
            [status, id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Operator not found' });
        res.json(rows[0]);
    } catch (err) {
        console.error('[API] Update status error:', err);
        res.status(500).json({ error: 'Failed to update status' });
    }
});

/* ── 5. Revoke operator access (delete) ─────────────────── */
router.delete('/:id', async (req, res) => {
    const { id } = req.params;

    if (id === String(req.user.user_id)) {
        return res.status(400).json({ error: 'Cannot revoke your own access.' });
    }

    try {
        const { rows } = await pool.query(
            'DELETE FROM users WHERE user_id = $1 RETURNING user_id',
            [id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Operator not found' });
        res.json({ success: true });
    } catch (err) {
        console.error('[API] Delete user error:', err);
        res.status(500).json({ error: 'Failed to revoke access' });
    }
});

module.exports = router;
