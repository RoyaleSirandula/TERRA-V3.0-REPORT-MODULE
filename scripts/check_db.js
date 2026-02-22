const { query } = require('../src/config/db');

async function check() {
    try {
        const res = await query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'reports';
        `);
        console.log('Columns in reports:', res.rows.map(r => r.column_name));

        const data = await query(`SELECT * FROM reports LIMIT 1;`);
        console.log('Sample report data:', JSON.stringify(data.rows[0], null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

check();
