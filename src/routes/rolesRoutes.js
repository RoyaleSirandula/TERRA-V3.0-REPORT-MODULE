/* ============================================================
   TERRA – rolesRoutes.js
   RBAC role + permission management endpoints.
   All routes require authenticate + manage_roles permission.

   Endpoints:
     GET    /api/roles                     – all roles + permissions + user count
     GET    /api/roles/permissions         – all available permission slugs
     POST   /api/roles                     – create a new role
     PATCH  /api/roles/:id/permissions     – replace permission set (atomic)
     DELETE /api/roles/:id                 – delete role (guard: no active users)
   ============================================================ */

const express = require('express');
const router  = express.Router();
const { pool } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.use(authorize('manage_roles'));

/* ── 1. All roles with permissions + user count ─────────── */
router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT
                r.role_id,
                r.name,
                COUNT(DISTINCT u.user_id)::int                      AS user_count,
                COALESCE(
                    json_agg(
                        json_build_object('permission_id', p.permission_id, 'slug', p.slug)
                        ORDER BY p.slug
                    ) FILTER (WHERE p.slug IS NOT NULL),
                    '[]'
                )                                                    AS permissions
            FROM roles r
            LEFT JOIN role_permissions rp ON r.role_id = rp.role_id
            LEFT JOIN permissions      p  ON rp.permission_id = p.permission_id
            LEFT JOIN users            u  ON u.role_id = r.role_id
            GROUP BY r.role_id, r.name
            ORDER BY r.name
        `);
        res.json(rows);
    } catch (err) {
        console.error('[API] List roles error:', err);
        res.status(500).json({ error: 'Failed to fetch roles' });
    }
});

/* ── 2. All available permissions ───────────────────────── */
router.get('/permissions', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT permission_id, slug FROM permissions ORDER BY slug'
        );
        res.json(rows);
    } catch (err) {
        console.error('[API] List permissions error:', err);
        res.status(500).json({ error: 'Failed to fetch permissions' });
    }
});

/* ── 3. Create a new role ────────────────────────────────── */
router.post('/', async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Role name is required.' });
    }
    const cleanName = name.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    try {
        const { rows } = await pool.query(
            'INSERT INTO roles (name) VALUES ($1) RETURNING role_id, name',
            [cleanName]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: `Role "${cleanName}" already exists.` });
        }
        console.error('[API] Create role error:', err);
        res.status(500).json({ error: 'Failed to create role' });
    }
});

/* ── 4. Replace permission set for a role (atomic) ──────── */
router.patch('/:id/permissions', async (req, res) => {
    const { id }             = req.params;
    const { permission_ids } = req.body;

    if (!Array.isArray(permission_ids)) {
        return res.status(400).json({ error: 'permission_ids must be an array.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM role_permissions WHERE role_id = $1', [id]);

        if (permission_ids.length > 0) {
            const placeholders = permission_ids
                .map((_, i) => `($1, $${i + 2})`)
                .join(', ');
            await client.query(
                `INSERT INTO role_permissions (role_id, permission_id) VALUES ${placeholders}`,
                [id, ...permission_ids]
            );
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[API] Update permissions error:', err);
        res.status(500).json({ error: 'Failed to update permissions' });
    } finally {
        client.release();
    }
});

/* ── 5. Delete a role ────────────────────────────────────── */
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const { rows: check } = await pool.query(
            'SELECT COUNT(*)::int AS n FROM users WHERE role_id = $1', [id]
        );
        if (check[0].n > 0) {
            return res.status(409).json({
                error: `Cannot delete: ${check[0].n} operator${check[0].n !== 1 ? 's' : ''} still assigned. Reassign them first.`
            });
        }
        const { rows } = await pool.query(
            'DELETE FROM roles WHERE role_id = $1 RETURNING role_id, name', [id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Role not found' });
        res.json({ success: true, deleted: rows[0] });
    } catch (err) {
        console.error('[API] Delete role error:', err);
        res.status(500).json({ error: 'Failed to delete role' });
    }
});

module.exports = router;
