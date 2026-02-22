const { query } = require('../src/config/db');

async function fix() {
    try {
        // 1. Add Cheetah
        let cheetah_id;
        const checkRes = await query(`SELECT species_id FROM species WHERE common_name = 'Cheetah'`);
        if (checkRes.rows.length > 0) {
            cheetah_id = checkRes.rows[0].species_id;
        } else {
            const insRes = await query(`
                INSERT INTO species (common_name, scientific_name, endangered_flag, default_sensitivity_tier) 
                VALUES ('Cheetah', 'Acinonyx jubatus', true, 2) 
                RETURNING species_id
            `);
            cheetah_id = insRes.rows[0].species_id;
            console.log('Added Cheetah:', cheetah_id);
        }

        // 2. Update Nyayo reports
        const nyayo_reports = [
            '4eb1a760-6823-4c84-a449-451e775628bf',
            'b8d9dd76-23e5-4e19-99e4-0eee8ea05132'
        ];

        for (const id of nyayo_reports) {
            await query(`UPDATE reports SET species_id = $1 WHERE report_id = $2`, [cheetah_id, id]);
            console.log(`Updated report ${id} to Cheetah`);
        }

    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

fix();
