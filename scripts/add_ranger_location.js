const { query } = require('../src/config/db');

async function migrate() {
    console.log('[MIGRATION] Adding location columns to users table...');
    try {
        await query(`
            ALTER TABLE users
                ADD COLUMN IF NOT EXISTS home_lat  DOUBLE PRECISION,
                ADD COLUMN IF NOT EXISTS home_lng  DOUBLE PRECISION,
                ADD COLUMN IF NOT EXISTS last_lat  DOUBLE PRECISION,
                ADD COLUMN IF NOT EXISTS last_lng  DOUBLE PRECISION,
                ADD COLUMN IF NOT EXISTS last_ping TIMESTAMPTZ;
        `);

        await query(`
            CREATE INDEX IF NOT EXISTS idx_users_last_ping
            ON users (last_ping)
            WHERE last_ping IS NOT NULL;
        `);

        console.log('[SUCCESS] Location columns added to users table.');
    } catch (err) {
        console.error('[ERROR] Migration failed:', err.message);
        console.error(err.stack);
    } finally {
        process.exit();
    }
}

migrate();
