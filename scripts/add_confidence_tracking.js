const { query } = require('../src/config/db');

async function migrate() {
    console.log('[MIGRATION] Adding confidence tracking columns...');
    try {
        await query(`
            ALTER TABLE reports 
            ADD COLUMN IF NOT EXISTS confidence_breakdown JSONB DEFAULT '{}',
            ADD COLUMN IF NOT EXISTS engine_metadata JSONB DEFAULT '{}';
        `);
        console.log('[SUCCESS] Migration completed.');
    } catch (err) {
        console.error('[ERROR] Migration failed:', err);
    } finally {
        process.exit();
    }
}

migrate();
