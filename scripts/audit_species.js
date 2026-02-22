const { query } = require('../src/config/db');

async function audit() {
    try {
        console.log('--- Checking Species Registry ---');
        const specRes = await query('SELECT * FROM species');
        specRes.rows.forEach(s => {
            console.log(`Species: ${s.common_name} (ID: ${s.species_id})`);
        });

        console.log('\n--- Checking Recent Reports vs Registry ---');
        const repRes = await query(`
            SELECT 
                r.report_id, 
                r.species_id, 
                r.species_name_custom, 
                s.common_name as registry_name,
                r.description
            FROM reports r
            LEFT JOIN species s ON r.species_id = s.species_id
            ORDER BY r.created_at DESC
            LIMIT 10
        `);

        repRes.rows.forEach(r => {
            console.log('---');
            console.log(`Report: ${r.report_id}`);
            console.log(`DB species_id: ${r.species_id}`);
            console.log(`DB species_name_custom: ${r.species_name_custom}`);
            console.log(`Registry Name (Join): ${r.registry_name || 'NULL'}`);
            console.log(`Description: ${r.description}`);

            const resolved = r.registry_name || r.species_name_custom || 'Unknown Species';
            console.log(`Resolved Name (Logic): ${resolved}`);
        });

    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

audit();
