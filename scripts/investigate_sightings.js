const { query } = require('../src/config/db');

async function investigate() {
    try {
        console.log('\n--- 10 MOST RECENT REPORTS ---');
        const results = await query(`
            SELECT 
                r.report_id, 
                r.species_id, 
                r.species_name_custom, 
                r.description, 
                r.ai_confidence_score,
                COALESCE(s.common_name, r.species_name_custom, 'Unknown Species') as effective_species_name,
                r.created_at
            FROM reports r
            LEFT JOIN species s ON r.species_id = s.species_id
            ORDER BY r.created_at DESC
            LIMIT 10;
        `);

        results.rows.forEach(r => {
            console.log('---');
            console.log(`ID: ${r.report_id}`);
            console.log(`Species ID (UUID): ${r.species_id}`);
            console.log(`Custom Name: ${r.species_name_custom}`);
            console.log(`Effective Name: ${r.effective_species_name}`);
            console.log(`Description: ${r.description}`);
            console.log(`Score: ${r.ai_confidence_score}`);
            console.log(`Created At: ${r.created_at}`);
        });

    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

investigate();
