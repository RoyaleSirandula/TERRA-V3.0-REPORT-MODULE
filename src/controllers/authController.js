/* ============================================================
   TERRA – authController.js
   Handles user registration and login.
   Returns a signed JWT on success.
   ============================================================ */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const User = require('../models/User');

/* ── POST /api/auth/register ─────────────────────────────── */
const register = async (req, res) => {
    const { username, email, password, role = 'COMMUNITY' } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'username, email and password are required.' });
    }

    try {
        // Check for duplicate email
        const { rows: existing } = await query(
            'SELECT user_id FROM users WHERE email = $1', [email]
        );
        if (existing.length > 0) {
            return res.status(409).json({ error: 'An account with this email already exists.' });
        }

        // Resolve role_id from role name
        const { rows: roleRows } = await query(
            'SELECT role_id FROM roles WHERE name = $1', [role.toUpperCase()]
        );
        if (!roleRows.length) {
            return res.status(400).json({ error: `Role '${role}' does not exist.` });
        }
        const role_id = roleRows[0].role_id;

        // Hash password
        const password_hash = await bcrypt.hash(password, 12);

        // Create user (region_id is optional — null for now)
        const newUser = await User.create({
            username,
            email,
            password_hash,
            role_id,
            region_id: req.body.region_id || null,
        });

        // Fetch full user with permissions for the JWT payload
        const userWithPerms = await User.findByIdWithPermissions(newUser.user_id);

        const token = jwt.sign(
            { user_id: newUser.user_id },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        );

        return res.status(201).json({
            message: 'Account created successfully.',
            token,
            user: {
                user_id: userWithPerms.user_id,
                username: userWithPerms.username,
                email: userWithPerms.email,
                role_name: userWithPerms.role_name,
                permissions: userWithPerms.permissions,
            },
        });
    } catch (err) {
        console.error('[AuthController.register]', err);
        return res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
};

/* ── POST /api/auth/login ───────────────────────────────── */
const login = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }

    try {
        // Find user by email (include password_hash)
        const { rows } = await query(
            `SELECT u.*, r.name as role_name
             FROM users u
             LEFT JOIN roles r ON u.role_id = r.role_id
             WHERE u.email = $1`,
            [email]
        );

        if (!rows.length) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const user = rows[0];

        // Verify password
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        // Fetch permissions
        const userWithPerms = await User.findByIdWithPermissions(user.user_id);

        const token = jwt.sign(
            { user_id: user.user_id },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        );

        return res.status(200).json({
            message: 'Login successful.',
            token,
            user: {
                user_id: userWithPerms.user_id,
                username: userWithPerms.username,
                email: userWithPerms.email,
                role_name: userWithPerms.role_name,
                permissions: userWithPerms.permissions,
            },
        });
    } catch (err) {
        console.error('[AuthController.login]', err);
        return res.status(500).json({ error: 'Login failed. Please try again.' });
    }
};

/* ── POST /api/auth/verify-password ─────────────────────── */
const verifyPassword = async (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required.' });

    try {
        const { rows } = await query(
            'SELECT password_hash FROM users WHERE user_id = $1',
            [req.user.user_id]
        );
        if (!rows.length) return res.status(401).json({ error: 'User not found.' });

        const valid = await bcrypt.compare(password, rows[0].password_hash);
        if (!valid) return res.status(401).json({ error: 'Incorrect password.' });

        res.json({ ok: true });
    } catch (err) {
        console.error('[AuthController.verifyPassword]', err);
        res.status(500).json({ error: 'Verification failed.' });
    }
};

module.exports = { register, login, verifyPassword };
