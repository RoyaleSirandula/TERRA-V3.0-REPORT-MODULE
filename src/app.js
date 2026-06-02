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
const movebankRoutes      = require('./routes/movebankRoutes');
const portalDataRoutes    = require('./routes/portalDataRoutes');
const opsRoutes           = require('./routes/opsRoutes');
const operatorRoutes      = require('./routes/operatorRoutes');


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

// Serve root assets and HTML pages for the landing pages (terra, solutions, etc.)
app.use('/assets', express.static(path.join(__dirname, '../assets')));
const rootPages = ['terra', 'solutions', 'index', 'fieldreporting', 'firemonitoring', 'speciesintel', 'siteanalysis', 'coming-soon', 'kpi', 'goals', 'grant', 'home', 'Ho', 'reticle-preview', 't3', 't4'];
rootPages.forEach(page => {
    app.get(`/${page}.html`, (req, res) => {
        res.sendFile(path.join(__dirname, `../${page}.html`));
    });
});

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
app.use('/api/movebank',      movebankRoutes);
app.use('/api/portal-data',  portalDataRoutes);
app.use('/api/ops',          opsRoutes);
app.use('/api/operator',     operatorRoutes);


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
