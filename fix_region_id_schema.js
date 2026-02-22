const { pool } = require('./src/config/db');

async function fixSchema() {
    try {
        console.log('Dropping existing index on region_id...');
        await pool.query('DROP INDEX IF EXISTS idx_reports_region');

        console.log('Altering region_id column to TEXT...');
        await pool.query('ALTER TABLE reports ALTER COLUMN region_id TYPE TEXT USING region_id::text');

        console.log('Recreating index on region_id...');
        await pool.query('CREATE INDEX idx_reports_region ON reports(region_id)');

        console.log('Schema fix completed successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Schema fix failed:', err);
        process.exit(1);
    }
}

fixSchema();
