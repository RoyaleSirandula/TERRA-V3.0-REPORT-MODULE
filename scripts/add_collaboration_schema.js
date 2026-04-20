/* ============================================================
   TERRA – add_collaboration_schema.js
   Database migration for Phases 4-6: collaboration tables.

   Creates (idempotently via IF NOT EXISTS):
     report_shares      — direct person-to-person report sharing
     share_audit_log    — immutable log of every share action
     teams              — operational team definitions
     team_members       — team membership with soft-delete
     team_report_posts  — reports posted to a team feed
     notifications      — in-app notification records

   Run once:
     node scripts/add_collaboration_schema.js

   Safe to re-run: IF NOT EXISTS guards prevent duplicate creation.
   All foreign keys reference existing users/reports tables.
   ============================================================ */

require('dotenv').config();
const { pool } = require('../src/config/db');

async function migrate() {
    const client = await pool.connect();
    console.log('[MIGRATION] Starting collaboration schema migration…');

    try {
        await client.query('BEGIN');

        /* ─────────────────────────────────────────────────────
           1. report_shares
           Direct person-to-person report sharing.

           • No self-shares enforced by CHECK constraint.
           • expires_at nullable: shares without expiry are permanent.
           • read_at nullable: null = not yet read by recipient.
           • Indexed on shared_to (inbox queries) and shared_by (outbox).
        ───────────────────────────────────────────────────── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS report_shares (
                share_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                report_id   UUID        NOT NULL REFERENCES reports(report_id)  ON DELETE CASCADE,
                shared_by   UUID        NOT NULL REFERENCES users(user_id)      ON DELETE CASCADE,
                shared_to   UUID        NOT NULL REFERENCES users(user_id)      ON DELETE CASCADE,
                note        TEXT,
                shared_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                expires_at  TIMESTAMPTZ,
                read_at     TIMESTAMPTZ,
                CONSTRAINT no_self_share CHECK (shared_by <> shared_to)
            );
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_shares_to  ON report_shares(shared_to);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_shares_by  ON report_shares(shared_by);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_shares_rpt ON report_shares(report_id);`);
        console.log('[MIGRATION] ✓ report_shares');

        /* ─────────────────────────────────────────────────────
           2. share_audit_log
           Immutable append-only log. Cannot be updated once written.
           ON DELETE SET NULL keeps audit history even if a share is
           deleted (report cascade deletes the share but not this log).
        ───────────────────────────────────────────────────── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS share_audit_log (
                log_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                share_id    UUID        REFERENCES report_shares(share_id) ON DELETE SET NULL,
                action      VARCHAR(20) NOT NULL CHECK (action IN ('CREATED', 'READ', 'REVOKED')),
                actor_id    UUID        REFERENCES users(user_id)          ON DELETE SET NULL,
                logged_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                detail      JSONB
            );
        `);
        console.log('[MIGRATION] ✓ share_audit_log');

        /* ─────────────────────────────────────────────────────
           3. teams
           An operational group (patrol unit, project team, etc.).
           created_by is nullable so admin-created teams survive if
           the creator account is deleted.
        ───────────────────────────────────────────────────── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS teams (
                team_id    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
                name       VARCHAR(100) NOT NULL,
                region     TEXT,
                created_by UUID         REFERENCES users(user_id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
            );
        `);
        console.log('[MIGRATION] ✓ teams');

        /* ─────────────────────────────────────────────────────
           4. team_members
           Composite PK (team_id, user_id) ensures uniqueness.
           removed_at is set on soft-delete; NULL means active.
           The partial index covers the most common query:
           "who are the current active members of team X?"
        ───────────────────────────────────────────────────── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS team_members (
                team_id     UUID        NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
                user_id     UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                member_role VARCHAR(20) NOT NULL DEFAULT 'MEMBER'
                            CHECK (member_role IN ('LEAD', 'MEMBER')),
                joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                removed_at  TIMESTAMPTZ,
                PRIMARY KEY (team_id, user_id)
            );
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_team_members_user
            ON team_members(user_id) WHERE removed_at IS NULL;
        `);
        console.log('[MIGRATION] ✓ team_members');

        /* ─────────────────────────────────────────────────────
           5. team_report_posts
           A report posted to a team feed.  A report can be posted
           to multiple teams (no unique constraint on report_id).
           Posted_by SET NULL so the post survives user deletion.
        ───────────────────────────────────────────────────── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS team_report_posts (
                post_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                team_id    UUID        NOT NULL REFERENCES teams(team_id)   ON DELETE CASCADE,
                report_id  UUID        NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
                posted_by  UUID        REFERENCES users(user_id)            ON DELETE SET NULL,
                posted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                note       TEXT
            );
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_team_posts_team ON team_report_posts(team_id, posted_at DESC);`);
        console.log('[MIGRATION] ✓ team_report_posts');

        /* ─────────────────────────────────────────────────────
           6. notifications
           Lightweight records pointing at the relevant share or
           team post.  The partial index on unread rows keeps the
           badge count query fast regardless of total row count.
        ───────────────────────────────────────────────────── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS notifications (
                notif_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                to_user      UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                type         VARCHAR(30) NOT NULL
                             CHECK (type IN ('DIRECT_SHARE', 'TEAM_POST', 'TEAM_ADDED')),
                reference_id UUID,
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                read_at      TIMESTAMPTZ
            );
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_notif_user_unread
            ON notifications(to_user) WHERE read_at IS NULL;
        `);
        console.log('[MIGRATION] ✓ notifications');

        await client.query('COMMIT');
        console.log('[MIGRATION] All collaboration tables created successfully.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[MIGRATION] FAILED — rolled back:', err.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
