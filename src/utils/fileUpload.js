const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads directory exists
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Ensure portal-data directory exists for CSV uploads
const portalDataDir = path.join('public', 'data', 'portal');
if (!fs.existsSync(portalDataDir)) {
    fs.mkdirSync(portalDataDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    // Accept images and audio
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('audio/')) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only images and audio are allowed.'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// CSV upload — saved to public/data/portal/ so the frontend can fetch them directly
const csvStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, portalDataDir);
    },
    filename: function (req, file, cb) {
        // Sanitise original name: strip path chars, replace spaces
        const safe = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + safe);
    }
});

const csvFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.csv' || file.mimetype === 'text/csv' || file.mimetype === 'application/vnd.ms-excel') {
        cb(null, true);
    } else {
        cb(new Error('Only CSV files are accepted for data uploads.'), false);
    }
};

const uploadCsv = multer({
    storage: csvStorage,
    fileFilter: csvFilter,
    limits: { fileSize: 50 * 1024 * 1024 } // 50 MB
});

module.exports = upload;
module.exports.uploadCsv = uploadCsv;
