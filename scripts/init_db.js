const { pool } = require('../src/config/db');
const fs = require('fs');
const path = require('path');

async function initDB() {
    try {
        const schemaPath = path.join(__dirname, '../database_schema.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');

        console.log('Running schema migration...');
        await pool.query(schemaSql);
        console.log('Schema migration completed successfully.');
    } catch (err) {
        console.error('Error running schema migration:', err);
    } finally {
        await pool.end();
    }
}

initDB();
