const { pool } = require('../src/config/db');

async function migrate() {
    console.log('Starting migration: user_map_objects table...');
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_map_objects (
                object_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
                type VARCHAR(50) NOT NULL,
                geometry GEOMETRY(Geometry, 4326),
                meta_data JSONB,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_user_map_objects_user ON user_map_objects(user_id);
            CREATE INDEX IF NOT EXISTS idx_user_map_objects_geom ON user_map_objects USING GIST (geometry);
        `);
        console.log('Migration successful.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await pool.end();
    }
}

migrate();
