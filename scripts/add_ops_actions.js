const { query } = require('../src/config/db');

async function migrate() {
    console.log('[MIGRATION] Creating ops_actions table...');
    try {
        await query(`
            CREATE TABLE IF NOT EXISTS ops_actions (
                action_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                type         TEXT NOT NULL
                                 CHECK (type IN ('deploy', 'waypoint', 'comms', 'clear')),
                initiated_by UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                target_id    TEXT,
                payload      JSONB,
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);

        await query(`
            CREATE INDEX IF NOT EXISTS idx_ops_actions_type
            ON ops_actions (type);
        `);

        await query(`
            CREATE INDEX IF NOT EXISTS idx_ops_actions_initiated_by
            ON ops_actions (initiated_by);
        `);

        console.log('[SUCCESS] ops_actions table ready.');
    } catch (err) {
        console.error('[ERROR] Migration failed:', err.message);
        console.error(err.stack);
    } finally {
        process.exit();
    }
}

migrate();
