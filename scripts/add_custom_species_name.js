const { pool } = require('../src/config/db');

async function migrate() {
    try {
        console.log('Starting migration: Adding species_name_custom to reports table...');

        await pool.query(`
            ALTER TABLE reports 
            ADD COLUMN IF NOT EXISTS species_name_custom TEXT;
        `);

        console.log('Migration successful: Column added.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
