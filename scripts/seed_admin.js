const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');

async function createAdmin() {
    try {
        const username = 'Admin';
        const email = 'admin@terra.org';
        const password = 'Password123!';

        console.log(`Creating admin user: ${username} (${email})...`);

        // Hash password
        const password_hash = await bcrypt.hash(password, 12);

        // Get Admin role ID
        const { rows: roleRows } = await pool.query("SELECT role_id FROM roles WHERE name = 'ADMIN'");
        if (roleRows.length === 0) {
            console.error('ADMIN role not found. Please run seed_rbac.js first.');
            process.exit(1);
        }
        const role_id = roleRows[0].role_id;

        // Insert Admin user
        await pool.query(
            'INSERT INTO users (username, email, password_hash, role_id) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING',
            [username, email, password_hash, role_id]
        );

        console.log('Admin user created successfully!');
        process.exit(0);
    } catch (err) {
        console.error('Error creating admin user:', err);
        process.exit(1);
    }
}

createAdmin();
