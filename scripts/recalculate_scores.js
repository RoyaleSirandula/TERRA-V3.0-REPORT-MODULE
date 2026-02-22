const Report = require('../src/models/Report');
const { query } = require('../src/config/db');

async function recalculate() {
    try {
        console.log('--- Recalculating all reports ---');
        const reports = await query(`
            SELECT r.*, ST_X(geom) as longitude, ST_Y(geom) as latitude 
            FROM reports r
        `);

        for (const r of reports.rows) {
            console.log(`Processing ${r.report_id}...`);
            const { totalScore, breakdown, engines } = await Report.calculateSmartConfidence({
                report_id: r.report_id,
                user_id: r.user_id,
                species_id: r.species_id,
                species_name_custom: r.species_name_custom,
                latitude: r.latitude,
                longitude: r.longitude,
                media_url: r.media_url,
                region_id: r.region_id
            });

            await query(`
                UPDATE reports 
                SET ai_confidence_score = $1, 
                    confidence_breakdown = $2,
                    engine_metadata = $3
                WHERE report_id = $4
            `, [totalScore, JSON.stringify(breakdown), JSON.stringify(engines), r.report_id]);

            console.log(`  New Score: ${totalScore}`);
        }

        console.log('Done!');
    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

recalculate();
