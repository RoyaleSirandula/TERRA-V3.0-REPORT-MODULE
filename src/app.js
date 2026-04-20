const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const reportRoutes        = require('./routes/reportRoutes');
const authRoutes          = require('./routes/authRoutes');
const analysisRoutes      = require('./routes/analysisRoutes');
const userRoutes          = require('./routes/userRoutes');
const rolesRoutes         = require('./routes/rolesRoutes');
const geeRoutes           = require('./routes/gee.routes');
const sharingRoutes       = require('./routes/sharingRoutes');
const teamsRoutes         = require('./routes/teamsRoutes');
const notificationsRoutes = require('./routes/notificationsRoutes');


const app = express();

// Middleware
app.use(helmet({
    // Allow Google Fonts and inline styles for the UI
    contentSecurityPolicy: false,
}));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files from /public
app.use(express.static(path.join(__dirname, '../public')));

// Serve uploaded media files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));


// Routes
app.use('/api/auth',          authRoutes);
app.use('/api/reports',       reportRoutes);
app.use('/api/analysis',      analysisRoutes);
app.use('/api/users',         userRoutes);
app.use('/api/roles',         rolesRoutes);
app.use('/api/gee',           geeRoutes);
app.use('/api/shares',        sharingRoutes);
app.use('/api/teams',         teamsRoutes);
app.use('/api/notifications', notificationsRoutes);


// Health Check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date() });
});

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something broke!' });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;
