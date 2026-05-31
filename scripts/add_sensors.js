const { query } = require('../src/config/db');

async function migrate() {
    console.log('[MIGRATION] Creating sensors table...');
    try {
        await query(`
            CREATE TABLE IF NOT EXISTS sensors (
                sensor_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name        TEXT NOT NULL,
                type        TEXT NOT NULL,
                sector      TEXT,
                status      VARCHAR(20) NOT NULL DEFAULT 'online'
                                CHECK (status IN ('online', 'offline', 'degraded')),
                battery_pct INTEGER CHECK (battery_pct BETWEEN 0 AND 100),
                last_sync   TIMESTAMPTZ,
                lat         DOUBLE PRECISION,
                lng         DOUBLE PRECISION,
                region_id   UUID,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);

        await query(`
            CREATE INDEX IF NOT EXISTS idx_sensors_status
            ON sensors (status);
        `);

        console.log('[MIGRATION] Seeding initial sensor records...');

        // Seed only if table is empty — safe to re-run
        const { rows } = await query('SELECT COUNT(*) FROM sensors');
        if (parseInt(rows[0].count) > 0) {
            console.log('[SKIP] Sensors already seeded.');
            return;
        }

        await query(`
            INSERT INTO sensors (name, type, sector, status, battery_pct, last_sync, lat, lng)
            VALUES
                ('Acoustic 14',     'Acoustic Array', '7B',  'online',  78, NOW() - INTERVAL '2 minutes',  -1.2510, 36.8720),
                ('Acoustic 09',     'Acoustic Array', '21A', 'online',  62, NOW() - INTERVAL '3 minutes',  -1.3040, 36.9090),
                ('Camera 03',       'Camera Trap',    '09C', 'offline', 12, NOW() - INTERVAL '3 hours',    -1.2700, 36.9200),
                ('LoRa Node 7',     'LoRa Gateway',   '17B', 'online',  91, NOW() - INTERVAL '1 minute',   -1.2800, 36.8780),
                ('Satellite Link 1','VSAT Station',   '17B', 'online', 100, NOW(),                          -1.2950, 36.8400);
        `);

        console.log('[SUCCESS] Sensors table ready with 5 seed records.');
    } catch (err) {
        console.error('[ERROR] Migration failed:', err.message);
        console.error(err.stack);
    } finally {
        process.exit();
    }
}

migrate();
