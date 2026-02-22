const { query } = require('../src/config/db');

async function audit() {
    try {
        const reportsCount = await query("SELECT count(*) FROM reports");
        const speciesCount = await query("SELECT count(*) FROM species");
        const usersCount = await query("SELECT count(*) FROM users");

        console.log('Total Reports:', reportsCount.rows[0].count);
        console.log('Total Species:', speciesCount.rows[0].count);
        console.log('Total Users:', usersCount.rows[0].count);

        const oldestUser = await query("SELECT min(created_at) FROM users");
        console.log('Oldest User Account Created:', oldestUser.rows[0].min);

        const types = await query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'reports' 
            AND column_name IN ('region_id', 'confidence_breakdown')
        `);
        console.log('Column Types:', types.rows);

    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

audit();
