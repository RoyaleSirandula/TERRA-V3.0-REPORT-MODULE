const express = require('express');
const router = express.Router();
const { register, login, verifyPassword } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

// POST /api/auth/register
router.post('/register', register);

// POST /api/auth/login
router.post('/login', login);

// POST /api/auth/verify-password  (requires active session)
router.post('/verify-password', authenticate, verifyPassword);

module.exports = router;
