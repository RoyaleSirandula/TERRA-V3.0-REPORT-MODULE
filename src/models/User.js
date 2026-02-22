const { query } = require('../config/db');

class User {
    static async findByIdWithPermissions(user_id) {
        const sql = `
      SELECT 
        u.*, 
        r.name as role_name,
        COALESCE(
          json_agg(p.slug) FILTER (WHERE p.slug IS NOT NULL), 
          '[]'
        ) as permissions
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.role_id
      LEFT JOIN role_permissions rp ON r.role_id = rp.role_id
      LEFT JOIN permissions p ON rp.permission_id = p.permission_id
      WHERE u.user_id = $1
      GROUP BY u.user_id, r.name
    `;
        const { rows } = await query(sql, [user_id]);
        return rows[0];
    }

    static async create({ username, email, password_hash, role_id, region_id }) {
        const sql = `
      INSERT INTO users (username, email, password_hash, role_id, region_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING user_id, username, email, role_id, created_at
    `;
        const { rows } = await query(sql, [username, email, password_hash, role_id, region_id]);
        return rows[0];
    }
}

module.exports = User;
