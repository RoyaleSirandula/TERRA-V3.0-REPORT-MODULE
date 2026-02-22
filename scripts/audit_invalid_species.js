const { query } = require('../src/config/db');

async function audit() {
    try {
        console.log('--- ALL REPORTS WITH "Unknown Species" RESOLUTION ---');
        const res = await query(`
            SELECT 
                r.report_id, 
                r.species_id, 
                r.species_name_custom, 
                s.common_name as registry_name,
                r.created_at
            FROM reports r
            LEFT JOIN species s ON r.species_id = s.species_id
            WHERE (s.common_name IS NULL AND r.species_name_custom IS NULL)
               OR (s.common_name IS NULL AND r.species_id IS NOT NULL)
        `);

        console.log(`Found ${res.rows.length} potentially problematic reports.`);

        res.rows.forEach(r => {
            console.log('---');
            console.log(`ID: ${r.report_id}`);
            console.log(`Species ID in DB: ${r.species_id}`);
            console.log(`Custom Name in DB: ${r.species_name_custom}`);
            console.log(`Registry Name: ${r.registry_name || 'NOT FOUND IN REGISTRY'}`);
            console.log(`Created: ${r.created_at}`);
        });

    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

audit();
