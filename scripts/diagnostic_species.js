const Report = require('../src/models/Report');
const { query } = require('../src/config/db');

async function diagnostic() {
    try {
        const userRes = await query('SELECT user_id FROM users LIMIT 1');
        const user_id = userRes.rows[0].user_id;

        console.log('--- Testing Report.create with Custom Name ---');
        const report = await Report.create({
            user_id,
            species_id: null,
            species_name_custom: 'DIAGNOSTIC_CHEETAH',
            latitude: -1.304,
            longitude: 36.824,
            sighting_timestamp: new Date(),
            description: 'Diagnostic report',
            region_id: 'Test Region',
            sensitivity_tier: 1
        });

        console.log('Created Report:', report.report_id);

        const check = await query('SELECT species_name_custom FROM reports WHERE report_id = $1', [report.report_id]);
        console.log('Value in DB:', check.rows[0].species_name_custom);

        if (check.rows[0].species_name_custom === 'DIAGNOSTIC_CHEETAH') {
            console.log('SUCCESS: Model works. Problem is likely in Controller or Frontend.');
        } else {
            console.log('FAILURE: Model failed to save custom name.');
        }

    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

diagnostic();
