/* ============================================================
   TERRA – sharingRoutes.js
   Phase 4: Direct report sharing between Rangers, Analysts, Admins.

   WHAT THIS MODULE DOES
   ─────────────────────
   Provides person-to-person report sharing for privileged roles.
   A Ranger selects a report they submitted, picks a recipient
   (Ranger / Analyst / Admin), adds an optional field note, and
   creates a share.  The recipient sees the share in their inbox
   via GET /api/shares and is notified via the notifications table.

   SCOPE RULES (enforced server-side, not client-side)
   ────────────────────────────────────────────────────
   • Requires sharing.canShare capability (Rangers, Analysts, Admins).
   • Rangers may only share reports they personally submitted.
   • Analysts and Admins may share any report.
   • Reports with sensitivity_tier >= 3 cannot be shared to COMMUNITY.
   • Expired shares (expires_at < NOW()) are excluded from the inbox.
   • Every share write is mirrored to share_audit_log (immutable).

   ENDPOINTS
   ─────────
   POST   /api/shares                — create a direct share
   GET    /api/shares                — inbox: reports shared to me
   GET    /api/shares/sent           — outbox: shares I have sent
   PATCH  /api/shares/:id/read       — mark a share read (timestamps it)
   ============================================================ */

const express = require('express');
const router  = express.Router();
const { pool }       = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireCap }   = require('../utils/capabilities');

router.use(authenticate);

/* ── POST /api/shares ───────────────────────────────────────
   Create a direct share.

   Body: { report_id, to_user_id, note?, expires_at? }

   Validation chain:
     1. report_id + to_user_id are required.
     2. Report must exist.
     3. Rangers may only share reports they submitted.
     4. Tier-3/4 reports cannot be shared to COMMUNITY recipients.
     5. Inserts into report_shares + share_audit_log + notifications.
─────────────────────────────────────────────────────────── */
router.post('/', requireCap('sharing.canShare'), async (req, res) => {
    const { report_id, to_user_id, note, expires_at } = req.body;

    if (!report_id || !to_user_id) {
        return res.status(400).json({ error: 'report_id and to_user_id are required' });
    }

    try {
        // ① Verify the report exists and retrieve ownership + tier
        const reportResult = await pool.query(
            'SELECT user_id, sensitivity_tier FROM reports WHERE report_id = $1',
            [report_id]
        );
        if (!reportResult.rows.length) {
            return res.status(404).json({ error: 'Report not found' });
        }
        const report    = reportResult.rows[0];
        const actorRole = (req.user.role_name || '').toUpperCase();

        // ② Rangers may only share reports they submitted themselves
        if (actorRole === 'RANGER' && report.user_id !== req.user.user_id) {
            return res.status(403).json({
                error: 'Rangers can only share reports they personally submitted',
            });
        }

        // ③ Cannot share to self
        if (to_user_id === req.user.user_id) {
            return res.status(400).json({ error: 'Cannot share a report with yourself' });
        }

        // ④ Tier-3/4 reports may not reach COMMUNITY recipients
        if (report.sensitivity_tier >= 3) {
            const recipientResult = await pool.query(
                `SELECT r.name FROM users u
                 JOIN roles r ON u.role_id = r.role_id
                 WHERE u.user_id = $1`,
                [to_user_id]
            );
            const recipientRole = (recipientResult.rows[0]?.name || '').toUpperCase();
            if (recipientRole === 'COMMUNITY') {
                return res.status(403).json({
                    error: 'High-sensitivity reports cannot be shared with Community accounts',
                });
            }
        }

        // ⑤ Persist the share
        const shareResult = await pool.query(`
            INSERT INTO report_shares (report_id, shared_by, shared_to, note, expires_at)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING share_id, report_id, shared_by, shared_to, note, shared_at, expires_at
        `, [report_id, req.user.user_id, to_user_id, note || null, expires_at || null]);

        const share = shareResult.rows[0];

        // ⑥ Immutable audit entry
        await pool.query(`
            INSERT INTO share_audit_log (share_id, action, actor_id, detail)
            VALUES ($1, 'CREATED', $2, $3)
        `, [share.share_id, req.user.user_id, JSON.stringify({ to_user_id, report_id })]);

        // ⑦ Push notification to recipient
        await pool.query(`
            INSERT INTO notifications (to_user, type, reference_id)
            VALUES ($1, 'DIRECT_SHARE', $2)
        `, [to_user_id, share.share_id]);

        res.status(201).json(share);
    } catch (err) {
        console.error('[SHARES] Create error:', err);
        res.status(500).json({ error: 'Failed to create share' });
    }
});

/* ── GET /api/shares (inbox) ────────────────────────────────
   Returns all active (non-expired) reports shared to the
   current user, newest first.  Joins report + species + sender
   so the client only needs one round-trip to render the inbox.
─────────────────────────────────────────────────────────── */
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                rs.share_id,
                rs.note,
                rs.shared_at,
                rs.expires_at,
                rs.read_at,
                r.report_id,
                r.sensitivity_tier,
                r.sighting_timestamp,
                r.validation_status,
                COALESCE(s.common_name, r.species_name_custom, 'Unknown Species') AS species_name,
                u.username AS shared_by_username,
                u.user_id  AS shared_by_user_id
            FROM report_shares rs
            JOIN reports r  ON rs.report_id = r.report_id
            LEFT JOIN species s ON r.species_id = s.species_id
            JOIN users u    ON rs.shared_by = u.user_id
            WHERE rs.shared_to = $1
              AND (rs.expires_at IS NULL OR rs.expires_at > NOW())
            ORDER BY rs.shared_at DESC
        `, [req.user.user_id]);

        res.json(result.rows);
    } catch (err) {
        console.error('[SHARES] Inbox fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch shares' });
    }
});

/* ── GET /api/shares/sent (outbox) ─────────────────────────
   Returns all shares the current user has sent, newest first.
   Includes read_at so the sender can see delivery confirmation.
─────────────────────────────────────────────────────────── */
router.get('/sent', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                rs.share_id,
                rs.note,
                rs.shared_at,
                rs.expires_at,
                rs.read_at,
                r.report_id,
                r.sensitivity_tier,
                COALESCE(s.common_name, r.species_name_custom, 'Unknown Species') AS species_name,
                u.username AS shared_to_username,
                u.user_id  AS shared_to_user_id
            FROM report_shares rs
            JOIN reports r  ON rs.report_id = r.report_id
            LEFT JOIN species s ON r.species_id = s.species_id
            JOIN users u    ON rs.shared_to = u.user_id
            WHERE rs.shared_by = $1
            ORDER BY rs.shared_at DESC
            LIMIT 100
        `, [req.user.user_id]);

        res.json(result.rows);
    } catch (err) {
        console.error('[SHARES] Outbox fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch sent shares' });
    }
});

/* ── PATCH /api/shares/:id/read ─────────────────────────────
   Timestamps read_at on the share record (idempotent — silently
   succeeds if already read).  Also writes a READ entry to the
   audit log so delivery is traceable.
─────────────────────────────────────────────────────────── */
router.patch('/:id/read', async (req, res) => {
    try {
        const result = await pool.query(`
            UPDATE report_shares
            SET    read_at = NOW()
            WHERE  share_id = $1
              AND  shared_to = $2
              AND  read_at IS NULL
            RETURNING share_id, read_at
        `, [req.params.id, req.user.user_id]);

        if (!result.rows.length) {
            return res.status(404).json({ error: 'Share not found or already read' });
        }

        // Audit the read event
        await pool.query(`
            INSERT INTO share_audit_log (share_id, action, actor_id)
            VALUES ($1, 'READ', $2)
        `, [req.params.id, req.user.user_id]);

        res.json(result.rows[0]);
    } catch (err) {
        console.error('[SHARES] Mark-read error:', err);
        res.status(500).json({ error: 'Failed to mark share as read' });
    }
});

module.exports = router;
