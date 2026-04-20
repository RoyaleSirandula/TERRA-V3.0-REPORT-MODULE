const express = require('express');
const router  = express.Router();
const { register, login, verifyPassword } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { buildCapabilities } = require('../utils/capabilities');

// POST /api/auth/register
router.post('/register', register);

// POST /api/auth/login
router.post('/login', login);

// POST /api/auth/verify-password  (requires active session)
router.post('/verify-password', authenticate, verifyPassword);

/* GET /api/auth/me/capabilities
 *
 * Returns the full capability object for the current user's role.
 * The client stores this after login and reads it to decide which
 * UI panels to mount — no raw role string comparisons in the frontend.
 *
 * The server always enforces the real gates regardless of what the
 * client has cached; this endpoint is only for rendering hints.
 */
router.get('/me/capabilities', authenticate, (req, res) => {
    res.json({
        role:         req.user.role_name,
        capabilities: buildCapabilities(req.user.role_name),
    });
});

module.exports = router;
