const { pool } = require('../src/config/db');

async function seedRBAC() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        console.log('Seeding Roles...');
        const roles = ['COMMUNITY', 'RANGER', 'ANALYST', 'ADMIN'];
        const roleMap = {};
        for (const role of roles) {
            const res = await client.query(
                'INSERT INTO roles (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING role_id, name',
                [role]
            );
            roleMap[res.rows[0].name] = res.rows[0].role_id;
        }

        console.log('Seeding Permissions...');
        const permissions = [
            'submit_report',
            'view_own_reports',
            'view_public_reports', // Tier 1
            'view_pending_reports',
            'validate_report',
            'view_protected_reports', // Tier 2
            'view_restricted_reports', // Tier 3
            'view_confidential_reports', // Tier 4
            'view_precise_coordinates',
            'export_data',
            'view_audit_logs',
            'manage_users',
            'manage_roles'
        ];

        const permMap = {};
        for (const perm of permissions) {
            const res = await client.query(
                'INSERT INTO permissions (slug) VALUES ($1) ON CONFLICT (slug) DO UPDATE SET slug=EXCLUDED.slug RETURNING permission_id, slug',
                [perm]
            );
            permMap[res.rows[0].slug] = res.rows[0].permission_id;
        }

        console.log('Mapping Roles to Permissions...');
        const rolePermissions = [
            // Community
            { role: 'COMMUNITY', perms: ['submit_report', 'view_own_reports', 'view_public_reports'] },

            // Ranger
            {
                role: 'RANGER', perms: [
                    'submit_report', 'view_own_reports', 'view_public_reports',
                    'view_pending_reports', 'validate_report',
                    'view_protected_reports', 'view_restricted_reports', 'view_confidential_reports',
                    'view_precise_coordinates'
                ]
            },

            // Analyst
            {
                role: 'ANALYST', perms: [
                    'view_public_reports', 'view_protected_reports', 'view_restricted_reports',
                    'export_data'
                    // Note: Analysts don't see precise coordinates by default in this seed, distinct from Rangers
                ]
            },

            // Admin
            { role: 'ADMIN', perms: permissions } // All permissions
        ];

        for (const rp of rolePermissions) {
            const rId = roleMap[rp.role];
            for (const pSlug of rp.perms) {
                const pId = permMap[pSlug];
                await client.query(
                    'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [rId, pId]
                );
            }
        }

        await client.query('COMMIT');
        console.log('RBAC Seeding Completed.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error seeding RBAC:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

seedRBAC();
