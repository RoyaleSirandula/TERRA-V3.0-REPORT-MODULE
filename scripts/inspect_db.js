const { query } = require('../src/config/db');

async function inspect() {
    try {
        console.log('--- REPORTS TABLE COLUMNS ---');
        const res = await query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'reports'");
        res.rows.forEach(c => console.log(`${c.column_name}: ${c.data_type} (Nullable: ${c.is_nullable})`));

        console.log('\n--- SAMPLE DATA (LATEST 3) ---');
        const data = await query("SELECT report_id, species_name_custom, region_id, created_at FROM reports ORDER BY created_at DESC LIMIT 3");
        console.log(JSON.stringify(data.rows, null, 2));

        console.log('\n--- EARLIEST DATA ---');
        const old = await query("SELECT report_id, created_at FROM reports ORDER BY created_at ASC LIMIT 1");
        console.log(JSON.stringify(old.rows, null, 2));

    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

inspect();
