const Report = require('../src/models/Report');
const { query } = require('../src/config/db');

async function test() {
    try {
        const userRes = await query('SELECT user_id FROM users LIMIT 1');
        const user_id = userRes.rows[0].user_id;

        console.log('--- Simulating Submission of "Cheetah" ---');
        // This is what the controller does
        const species_id_from_form = "Cheetah";
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const isUuid = species_id_from_form && uuidRegex.test(species_id_from_form.trim());
        const validSpeciesId = isUuid ? species_id_from_form.trim() : null;
        const customSpeciesName = !isUuid && species_id_from_form ? species_id_from_form.trim() : null;

        const report = await Report.create({
            user_id,
            species_id: validSpeciesId,
            species_name_custom: customSpeciesName,
            latitude: -1.304,
            longitude: 36.824,
            sighting_timestamp: new Date(),
            description: 'Simulation test',
            region_id: 'Test Region',
            sensitivity_tier: 1
        });

        console.log('Success! Created:', report.report_id);

        const fullReport = await Report.findById(report.report_id);
        console.log('Resolved Species Name:', fullReport.species_name);

        if (fullReport.species_name === 'Cheetah') {
            console.log('MODEL AND CONTROLLER LOGIC ARE PERFECT.');
        } else {
            console.log('LOGIC ERROR: Expected Cheetah, got', fullReport.species_name);
        }

    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

test();
