const { query } = require('../src/config/db');
const fs = require('fs');

async function run() {
    const r = await query("SELECT count(*) FROM reports");
    const s = await query("SELECT count(*) FROM species");
    const u = await query("SELECT count(*) FROM users");
    const ou = await query("SELECT min(created_at) FROM users");

    const out = `
Reports: ${r.rows[0].count}
Species: ${s.rows[0].count}
Users: ${u.rows[0].count}
Oldest User: ${ou.rows[0].min}
    `;
    fs.writeFileSync('audit_results.txt', out);
    process.exit();
}
run();
