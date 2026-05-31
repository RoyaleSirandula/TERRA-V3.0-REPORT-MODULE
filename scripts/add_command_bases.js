const { query } = require('../src/config/db');

async function migrate() {
    console.log('[MIGRATION] Creating command_bases table...');
    try {
        await query(`
            CREATE TABLE IF NOT EXISTS command_bases (
                base_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name       TEXT NOT NULL,
                lat        DOUBLE PRECISION NOT NULL,
                lng        DOUBLE PRECISION NOT NULL,
                sector     TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);

        await query(`
            CREATE INDEX IF NOT EXISTS idx_command_bases_name
            ON command_bases (name);
        `);

        const { rows } = await query('SELECT COUNT(*) FROM command_bases');
        if (parseInt(rows[0].count) > 0) {
            console.log('[SKIP] command_bases already seeded.');
            return;
        }

        // Seed from the previously hardcoded COMMAND_MARKERS value in map.js
        await query(`
            INSERT INTO command_bases (name, lat, lng, sector)
            VALUES ('Base Karoo', -1.3180, 36.8950, NULL);
        `);

        console.log('[SUCCESS] command_bases table ready with 1 seed record.');
    } catch (err) {
        console.error('[ERROR] Migration failed:', err.message);
        console.error(err.stack);
    } finally {
        process.exit();
    }
}

migrate();
