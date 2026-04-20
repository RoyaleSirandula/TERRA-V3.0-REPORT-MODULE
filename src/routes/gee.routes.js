const express = require('express');
const router  = express.Router();
const geeService       = require('../utils/gee.service');
const { authenticate } = require('../middleware/auth');
const { requireCap }   = require('../utils/capabilities');

/* All GEE endpoints require authentication + geeAccess capability.
 * Community accounts receive 403 TIER_RESTRICTED on any GEE call. */
router.use(authenticate);
router.use(requireCap('siteAnalysis.geeAccess'));

router.post('/mapid', async (req, res) => {
    try {
        const { layerType } = req.body;
        if (!layerType) {
            return res.status(400).json({ error: 'layerType is required' });
        }

        console.log(`[GEE ROUTE] Requesting MapID for: ${layerType}`);
        const data = await geeService.getLayerMapId(layerType);
        
        res.json(data);
    } catch (err) {
        console.error('[GEE ROUTE] Error:', err);
        res.status(500).json({ 
            error: 'Failed to generate GEE MapID',
            message: err.message
        });
    }
});

/* POST /api/gee/timeseries
 * Runs monthly NDVI time series for a user-drawn polygon.
 * Uses ee.List.sequence(1,12).map() for parallel server-side computation.
 */
router.post('/timeseries', async (req, res) => {
    const { polygon } = req.body;
    if (!polygon) return res.status(400).json({ error: 'polygon geometry is required' });
    try {
        const data = await geeService.getNdviTimeSeries(polygon);
        res.json(data);
    } catch (err) {
        console.error('[GEE ROUTE] Timeseries error:', err);
        res.status(500).json({ error: 'Failed to compute NDVI time series', message: err.message });
    }
});

/* POST /api/gee/zonal
 * Cloud-masked Sentinel-2 NDVI zonal stats for a drawn polygon.
 * Also returns a 6-month MODIS trend series.
 */
router.post('/zonal', async (req, res) => {
    const { polygon } = req.body;
    if (!polygon) return res.status(400).json({ error: 'polygon geometry is required' });
    try {
        const data = await geeService.getNdviZonalStats(polygon);
        res.json(data);
    } catch (err) {
        console.error('[GEE ROUTE] Zonal error:', err);
        res.status(500).json({ error: 'Failed to compute NDVI zonal stats', message: err.message });
    }
});

module.exports = router;
