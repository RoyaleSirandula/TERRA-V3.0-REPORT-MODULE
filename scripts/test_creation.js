const Report = require('../src/models/Report');
const { query } = require('../src/config/db');

async function test() {
    try {
        // Need a user ID
        const userRes = await query('SELECT user_id FROM users LIMIT 1');
        const user_id = userRes.rows[0].user_id;

        const testData = {
            user_id,
            species_id: null,
            species_name_custom: 'Cheetah',
            latitude: -1.304,
            longitude: 36.824,
            sighting_timestamp: new Date(),
            description: 'Test cheetah at Nyayo',
            region_id: 'Nairobi County',
            sensitivity_tier: 1
        };

        console.log('--- Testing Report.create ---');
        const report = await Report.create(testData);
        console.log('Created Report:', report);

        // Fetch it back to see score and breakdown
        const fetched = await query('SELECT ai_confidence_score, confidence_breakdown FROM reports WHERE report_id = $1', [report.report_id]);
        console.log('Stored Data:', fetched.rows[0]);

    } catch (err) {
        console.error('Test failed:', err);
    } finally {
        process.exit();
    }
}

test();
