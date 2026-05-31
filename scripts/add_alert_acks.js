const { query } = require('../src/config/db');

async function migrate() {
    console.log('[MIGRATION] Creating alert_acks table...');
    try {
        await query(`
            CREATE TABLE IF NOT EXISTS alert_acks (
                report_id UUID    NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
                user_id   UUID    NOT NULL REFERENCES users(user_id)     ON DELETE CASCADE,
                acked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (report_id, user_id)
            );
        `);
        await query(`
            CREATE INDEX IF NOT EXISTS idx_alert_acks_user
            ON alert_acks (user_id);
        `);
        console.log('[SUCCESS] alert_acks table ready.');
    } catch (err) {
        console.error('[ERROR] Migration failed:', err);
    } finally {
        process.exit();
    }
}

migrate();
