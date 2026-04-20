/* ============================================================
   TERRA – notificationsRoutes.js
   Phase 6: In-app notification system.

   WHAT THIS MODULE DOES
   ─────────────────────
   Provides the data layer for the notification badge in the
   topbar and the notification inbox panel.  Notifications are
   lightweight records pointing to the relevant share or team
   post — the client resolves the detail via the respective
   endpoint when the user opens the item.

   NOTIFICATION TYPES
   ──────────────────
   DIRECT_SHARE  — a report was shared directly to this user
                   reference_id → report_shares.share_id
   TEAM_POST     — a report was posted to a team this user belongs to
                   reference_id → team_report_posts.post_id
   TEAM_ADDED    — this user was added to a team
                   reference_id → teams.team_id

   POLLING STRATEGY
   ────────────────
   The topbar calls GET /api/notifications/unread-count on page
   focus (via visibilitychange) and every 60 seconds when the
   app is active.  Full list is fetched only when the user opens
   the notification panel.  This keeps the polling light.

   ENDPOINTS
   ─────────
   GET    /api/notifications               — all notifications (newest 50)
   GET    /api/notifications/unread-count  — { count: N } for badge
   PATCH  /api/notifications/:id/read      — mark one as read
   PATCH  /api/notifications/read-all      — mark all as read
   ============================================================ */

const express = require('express');
const router  = express.Router();
const { pool }         = require('../config/db');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

/* ── GET /api/notifications ─────────────────────────────────
   Returns the 50 most recent notifications for the current user,
   regardless of read state.  The client renders unread items
   with a highlight based on the presence of read_at = null.
─────────────────────────────────────────────────────────── */
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT notif_id, type, reference_id, created_at, read_at
            FROM   notifications
            WHERE  to_user = $1
            ORDER  BY created_at DESC
            LIMIT  50
        `, [req.user.user_id]);

        res.json(result.rows);
    } catch (err) {
        console.error('[NOTIF] Fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

/* ── GET /api/notifications/unread-count ────────────────────
   Returns a single integer count of unread notifications.
   Designed to be called frequently (badge polling) — the
   partial index on (to_user) WHERE read_at IS NULL keeps
   this query O(1) even with many historical notifications.
─────────────────────────────────────────────────────────── */
router.get('/unread-count', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT COUNT(*)::int AS count
            FROM   notifications
            WHERE  to_user = $1 AND read_at IS NULL
        `, [req.user.user_id]);

        res.json({ count: result.rows[0].count });
    } catch (err) {
        console.error('[NOTIF] Count error:', err);
        res.status(500).json({ error: 'Failed to fetch notification count' });
    }
});

/* ── PATCH /api/notifications/:id/read ─────────────────────
   Marks a single notification as read by setting read_at = NOW().
   Only affects notifications addressed to the current user,
   preventing users from marking each other's notifications read.
─────────────────────────────────────────────────────────── */
router.patch('/:id/read', async (req, res) => {
    try {
        const result = await pool.query(`
            UPDATE notifications
            SET    read_at = NOW()
            WHERE  notif_id = $1
              AND  to_user  = $2
              AND  read_at IS NULL
            RETURNING notif_id, read_at
        `, [req.params.id, req.user.user_id]);

        if (!result.rows.length) {
            return res.status(404).json({ error: 'Notification not found or already read' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('[NOTIF] Mark-read error:', err);
        res.status(500).json({ error: 'Failed to mark notification as read' });
    }
});

/* ── PATCH /api/notifications/read-all ─────────────────────
   Marks every unread notification for the current user as read
   in one UPDATE.  Returns the count of records updated so the
   client can animate the badge clearing.
─────────────────────────────────────────────────────────── */
router.patch('/read-all', async (req, res) => {
    try {
        const result = await pool.query(`
            UPDATE notifications
            SET    read_at = NOW()
            WHERE  to_user = $1 AND read_at IS NULL
            RETURNING notif_id
        `, [req.user.user_id]);

        res.json({ updated: result.rows.length });
    } catch (err) {
        console.error('[NOTIF] Read-all error:', err);
        res.status(500).json({ error: 'Failed to mark all notifications as read' });
    }
});

module.exports = router;
