const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { authenticate, authorize } = require('../middleware/auth');
const upload = require('../utils/fileUpload');

// Submit a new report (Requires 'submit_report' permission)
router.post('/',
    authenticate,
    authorize('submit_report'),
    upload.single('media'),
    reportController.createReport
);

// Get reports (Base authentication required)
router.get('/', authenticate, reportController.getReports);

// Get aggregate stats (must be before /:id to avoid conflict)
router.get('/stats', authenticate, reportController.getStats);

// Get single report
router.get('/:id', authenticate, reportController.getReportById);

// Validate/Reject a report (Requires 'validate_report' permission)
router.patch('/:id/validate',
    authenticate,
    authorize('validate_report'),
    reportController.validateReport
);

module.exports = router;
