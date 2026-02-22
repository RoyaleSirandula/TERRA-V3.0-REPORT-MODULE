const { query } = require('../src/config/db');

async function check() {
    try {
        const res = await query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'reports' AND column_name = 'region_id'");
        console.log('Region ID Type:', res.rows[0].data_type);

        const samples = await query("SELECT region_id FROM reports LIMIT 5");
        console.log('Sample Region IDs:', samples.rows);
    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

check();
