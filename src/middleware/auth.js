const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authenticate = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findByIdWithPermissions(decoded.user_id);

        if (!user) {
            return res.status(401).json({ error: 'Unauthorized: User not found' });
        }

        if (user.verification_status !== 'VERIFIED' && user.verification_status !== 'PENDING') {
            // Allow Pending for now or decide logic. Schema default is Pending.
            // If strictly required verified:
            // if (user.verification_status !== 'VERIFIED') return res.status(403).json({ error: 'Account not verified' });
        }

        req.user = user;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};

const authorize = (requiredPermission) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Admin Override (Optional, but usually Admin role has all permissions via seed, so strictly checking permissions is cleaner)
        // if (req.user.role_name === 'ADMIN') return next();

        if (!req.user.permissions.includes(requiredPermission)) {
            return res.status(403).json({ error: `Forbidden: Requires permission '${requiredPermission}'` });
        }

        next();
    };
};

/* Re-export requireCap so routes only need to import from auth.js */
const { requireCap } = require('../utils/capabilities');

module.exports = { authenticate, authorize, requireCap };
