/* ============================================================
   TERRA – teamsRoutes.js
   Phase 5: Team management and team-broadcast report sharing.

   WHAT THIS MODULE DOES
   ─────────────────────
   Provides operational team structures that mirror real field
   units (e.g. "Mara North Patrol", "Serengeti Analysts").
   Team members share a feed of posted reports.  Access to the
   feed is gated to the posts made *after* a member joined —
   preventing retroactive access to sensitive historical posts.

   ROLE RULES
   ──────────
   • Any role with teams.canJoin capability may be added.
   • teams.canCreate — Analysts + Admins only (they create teams).
   • Ranger can be LEAD of a team if an Admin promotes them.
   • LEAD or ADMIN may add/remove members via team/:id/members.
   • Rangers may only post reports they submitted to a team.
   • Analysts/Admins may post any report to a team they belong to.

   ENDPOINTS
   ─────────
   GET    /api/teams                  — teams I belong to
   POST   /api/teams                  — create team (Analyst/Admin)
   GET    /api/teams/:id/members      — list active members
   POST   /api/teams/:id/members      — add a member (Lead/Admin)
   DELETE /api/teams/:id/members/:uid — soft-remove a member (Lead/Admin)
   GET    /api/teams/:id/posts        — team report feed (membership-gated)
   POST   /api/teams/:id/posts        — post a report to the team feed
   ============================================================ */

const express = require('express');
const router  = express.Router();
const { pool }         = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireCap }   = require('../utils/capabilities');

router.use(authenticate);

/* ── GET /api/teams ─────────────────────────────────────────
   Returns all teams the current user is an active member of,
   plus a live member count for the team card display.
─────────────────────────────────────────────────────────── */
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                t.team_id,
                t.name,
                t.region,
                t.created_at,
                tm.member_role,
                (
                    SELECT COUNT(*)::int
                    FROM   team_members
                    WHERE  team_id = t.team_id AND removed_at IS NULL
                ) AS member_count
            FROM teams t
            JOIN team_members tm
                ON t.team_id = tm.team_id
               AND tm.user_id = $1
               AND tm.removed_at IS NULL
            ORDER BY t.created_at DESC
        `, [req.user.user_id]);

        res.json(result.rows);
    } catch (err) {
        console.error('[TEAMS] List error:', err);
        res.status(500).json({ error: 'Failed to list teams' });
    }
});

/* ── POST /api/teams ────────────────────────────────────────
   Create a new team.  The creator is automatically added as
   LEAD.  Uses a transaction so the team row and the creator's
   membership are always written together.

   Capability gate: teams.canCreate (Analyst / Admin only).
─────────────────────────────────────────────────────────── */
router.post('/', requireCap('teams.canCreate'), async (req, res) => {
    const { name, region } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'name is required' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const teamResult = await client.query(`
            INSERT INTO teams (name, region, created_by)
            VALUES ($1, $2, $3)
            RETURNING team_id, name, region, created_at
        `, [name.trim(), region?.trim() || null, req.user.user_id]);

        const team = teamResult.rows[0];

        // Creator becomes LEAD automatically
        await client.query(`
            INSERT INTO team_members (team_id, user_id, member_role)
            VALUES ($1, $2, 'LEAD')
        `, [team.team_id, req.user.user_id]);

        await client.query('COMMIT');
        res.status(201).json({ ...team, member_role: 'LEAD', member_count: 1 });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[TEAMS] Create error:', err);
        res.status(500).json({ error: 'Failed to create team' });
    } finally {
        client.release();
    }
});

/* ── GET /api/teams/:id/members ─────────────────────────────
   Lists all active members of the specified team.
   The requester must be an active member to view the roster.
─────────────────────────────────────────────────────────── */
router.get('/:id/members', async (req, res) => {
    try {
        // Gate: requester must be an active member
        const membership = await pool.query(
            `SELECT member_role FROM team_members
             WHERE team_id = $1 AND user_id = $2 AND removed_at IS NULL`,
            [req.params.id, req.user.user_id]
        );
        if (!membership.rows.length) {
            return res.status(403).json({ error: 'You are not a member of this team' });
        }

        const result = await pool.query(`
            SELECT
                tm.member_role,
                tm.joined_at,
                u.user_id,
                u.username,
                r.name AS role_name
            FROM team_members tm
            JOIN users u  ON tm.user_id = u.user_id
            JOIN roles r  ON u.role_id  = r.role_id
            WHERE tm.team_id = $1 AND tm.removed_at IS NULL
            ORDER BY tm.joined_at ASC
        `, [req.params.id]);

        res.json(result.rows);
    } catch (err) {
        console.error('[TEAMS] Members list error:', err);
        res.status(500).json({ error: 'Failed to list members' });
    }
});

/* ── POST /api/teams/:id/members ────────────────────────────
   Add a user to a team.  Only a LEAD of this team or an Admin
   may perform this action.

   Uses ON CONFLICT to handle re-adding previously removed
   members: their removed_at is cleared and role updated.

   Body: { user_id, member_role? }  (member_role defaults to 'MEMBER')
─────────────────────────────────────────────────────────── */
router.post('/:id/members', async (req, res) => {
    const { user_id, member_role = 'MEMBER' } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });
    if (!['LEAD', 'MEMBER'].includes(member_role)) {
        return res.status(400).json({ error: 'member_role must be LEAD or MEMBER' });
    }

    try {
        // Gate: requester must be a LEAD of this team OR an Admin
        const actorRole = (req.user.role_name || '').toUpperCase();
        if (actorRole !== 'ADMIN') {
            const access = await pool.query(
                `SELECT member_role FROM team_members
                 WHERE team_id = $1 AND user_id = $2 AND removed_at IS NULL`,
                [req.params.id, req.user.user_id]
            );
            if (access.rows[0]?.member_role !== 'LEAD') {
                return res.status(403).json({ error: 'Only team leads or admins can add members' });
            }
        }

        const result = await pool.query(`
            INSERT INTO team_members (team_id, user_id, member_role)
            VALUES ($1, $2, $3)
            ON CONFLICT (team_id, user_id)
                DO UPDATE SET removed_at = NULL, member_role = $3
            RETURNING team_id, user_id, member_role, joined_at
        `, [req.params.id, user_id, member_role]);

        // Notify the newly added member
        await pool.query(`
            INSERT INTO notifications (to_user, type, reference_id)
            VALUES ($1, 'TEAM_ADDED', $2)
        `, [user_id, req.params.id]);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('[TEAMS] Add member error:', err);
        res.status(500).json({ error: 'Failed to add member' });
    }
});

/* ── DELETE /api/teams/:id/members/:uid ─────────────────────
   Soft-removes a member by setting removed_at = NOW().
   Historical posts they received while active remain in the
   audit trail.  Only LEAD or Admin may remove.
─────────────────────────────────────────────────────────── */
router.delete('/:id/members/:uid', async (req, res) => {
    try {
        const actorRole = (req.user.role_name || '').toUpperCase();
        if (actorRole !== 'ADMIN') {
            const access = await pool.query(
                `SELECT member_role FROM team_members
                 WHERE team_id = $1 AND user_id = $2 AND removed_at IS NULL`,
                [req.params.id, req.user.user_id]
            );
            if (access.rows[0]?.member_role !== 'LEAD') {
                return res.status(403).json({ error: 'Only team leads or admins can remove members' });
            }
        }

        const result = await pool.query(`
            UPDATE team_members
            SET    removed_at = NOW()
            WHERE  team_id = $1 AND user_id = $2 AND removed_at IS NULL
            RETURNING user_id, removed_at
        `, [req.params.id, req.params.uid]);

        if (!result.rows.length) {
            return res.status(404).json({ error: 'Member not found in this team' });
        }

        res.json({ success: true, removed: result.rows[0] });
    } catch (err) {
        console.error('[TEAMS] Remove member error:', err);
        res.status(500).json({ error: 'Failed to remove member' });
    }
});

/* ── POST /api/teams/:id/posts ──────────────────────────────
   Post a report to the team feed.

   ACCESS CONTROL:
   • Requester must be an active member.
   • Rangers may only post reports they submitted.
   • Analysts/Admins may post any report.
   • A notification is fanned out to all other active members.

   Capability gate: sharing.canShare (Rangers, Analysts, Admins).
─────────────────────────────────────────────────────────── */
router.post('/:id/posts', requireCap('sharing.canShare'), async (req, res) => {
    const { report_id, note } = req.body;
    if (!report_id) return res.status(400).json({ error: 'report_id is required' });

    try {
        // ① Verify active membership
        const membership = await pool.query(
            `SELECT user_id FROM team_members
             WHERE team_id = $1 AND user_id = $2 AND removed_at IS NULL`,
            [req.params.id, req.user.user_id]
        );
        if (!membership.rows.length) {
            return res.status(403).json({ error: 'You are not a member of this team' });
        }

        // ② Rangers can only post reports they submitted
        const actorRole = (req.user.role_name || '').toUpperCase();
        if (actorRole === 'RANGER') {
            const ownership = await pool.query(
                'SELECT user_id FROM reports WHERE report_id = $1',
                [report_id]
            );
            if (ownership.rows[0]?.user_id !== req.user.user_id) {
                return res.status(403).json({
                    error: 'Rangers can only post reports they personally submitted',
                });
            }
        }

        // ③ Persist the team post
        const postResult = await pool.query(`
            INSERT INTO team_report_posts (team_id, report_id, posted_by, note)
            VALUES ($1, $2, $3, $4)
            RETURNING post_id, team_id, report_id, posted_by, posted_at, note
        `, [req.params.id, report_id, req.user.user_id, note || null]);

        const post = postResult.rows[0];

        // ④ Fan-out notifications to all other active members
        const members = await pool.query(
            `SELECT user_id FROM team_members
             WHERE team_id = $1 AND user_id != $2 AND removed_at IS NULL`,
            [req.params.id, req.user.user_id]
        );
        for (const member of members.rows) {
            await pool.query(`
                INSERT INTO notifications (to_user, type, reference_id)
                VALUES ($1, 'TEAM_POST', $2)
            `, [member.user_id, post.post_id]);
        }

        res.status(201).json(post);
    } catch (err) {
        console.error('[TEAMS] Post report error:', err);
        res.status(500).json({ error: 'Failed to post report to team' });
    }
});

/* ── GET /api/teams/:id/posts ───────────────────────────────
   Returns the team's report feed, limited to posts made after
   the requesting user joined.  This is the temporal access
   gate: retroactive access is never granted.

   Returns last 50 posts, newest first, joined with report +
   species + poster username for a single-query feed render.
─────────────────────────────────────────────────────────── */
router.get('/:id/posts', async (req, res) => {
    try {
        // Gate: active member only; note the join date for temporal filtering
        const membership = await pool.query(
            `SELECT joined_at FROM team_members
             WHERE team_id = $1 AND user_id = $2 AND removed_at IS NULL`,
            [req.params.id, req.user.user_id]
        );
        if (!membership.rows.length) {
            return res.status(403).json({ error: 'You are not a member of this team' });
        }

        const joinedAt = membership.rows[0].joined_at;

        const result = await pool.query(`
            SELECT
                tp.post_id,
                tp.posted_at,
                tp.note,
                r.report_id,
                r.sighting_timestamp,
                r.validation_status,
                r.sensitivity_tier,
                COALESCE(s.common_name, r.species_name_custom, 'Unknown Species') AS species_name,
                u.username AS posted_by_username,
                u.user_id  AS posted_by_user_id
            FROM team_report_posts tp
            JOIN reports r  ON tp.report_id = r.report_id
            LEFT JOIN species s ON r.species_id = s.species_id
            JOIN users u    ON tp.posted_by = u.user_id
            WHERE tp.team_id   = $1
              AND tp.posted_at >= $2
            ORDER BY tp.posted_at DESC
            LIMIT 50
        `, [req.params.id, joinedAt]);

        res.json(result.rows);
    } catch (err) {
        console.error('[TEAMS] Get posts error:', err);
        res.status(500).json({ error: 'Failed to fetch team posts' });
    }
});

module.exports = router;
