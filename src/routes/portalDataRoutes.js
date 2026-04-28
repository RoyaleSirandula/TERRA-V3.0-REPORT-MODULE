const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { authenticate, authorize } = require('../middleware/auth');
const { uploadCsv } = require('../utils/fileUpload');

const PORTAL_DATA_DIR = path.join(__dirname, '../../public/data/portal');

// POST /api/portal-data/upload
// Upload a CSV file. Requires export_data permission (Ranger+).
router.post('/upload',
    authenticate,
    authorize('export_data'),
    uploadCsv.single('csvfile'),
    (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: 'No CSV file provided.' });
        }
        res.json({
            message: 'CSV uploaded successfully.',
            file: {
                filename: req.file.filename,
                originalName: req.file.originalname,
                size: req.file.size,
                url: `/data/portal/${req.file.filename}`,
            }
        });
    }
);

// GET /api/portal-data/list
// List all uploaded CSVs for this portal.
router.get('/list', authenticate, authorize('export_data'), (req, res) => {
    try {
        if (!fs.existsSync(PORTAL_DATA_DIR)) {
            return res.json({ files: [] });
        }
        const files = fs.readdirSync(PORTAL_DATA_DIR)
            .filter(f => f.endsWith('.csv'))
            .map(f => {
                const stat = fs.statSync(path.join(PORTAL_DATA_DIR, f));
                return {
                    filename: f,
                    originalName: f.replace(/^\d+-\d+-/, ''), // strip prefix
                    size: stat.size,
                    uploadedAt: stat.mtime.toISOString(),
                    url: `/data/portal/${f}`,
                };
            })
            .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
        res.json({ files });
    } catch (err) {
        res.status(500).json({ error: 'Failed to list uploaded files.' });
    }
});

// DELETE /api/portal-data/:filename
router.delete('/:filename', authenticate, authorize('export_data'), (req, res) => {
    const safe = path.basename(req.params.filename);
    const filepath = path.join(PORTAL_DATA_DIR, safe);
    if (!filepath.startsWith(PORTAL_DATA_DIR)) {
        return res.status(400).json({ error: 'Invalid filename.' });
    }
    if (!fs.existsSync(filepath)) {
        return res.status(404).json({ error: 'File not found.' });
    }
    fs.unlinkSync(filepath);
    res.json({ message: 'File deleted.' });
});

module.exports = router;
