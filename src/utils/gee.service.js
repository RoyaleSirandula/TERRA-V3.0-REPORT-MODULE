const ee = require('@google/earthengine');
const path = require('path');
const fs = require('fs');

class GeeService {
    constructor() {
        this.initialized = false;
        this.initPromise = null;
    }

    async init() {
        if (this.initialized) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = new Promise((resolve, reject) => {
            try {
                const keyPath = process.env.GEE_SERVICE_ACCOUNT_KEY;
                if (!keyPath) {
                    throw new Error('GEE_SERVICE_ACCOUNT_KEY not defined in .env');
                }

                const absolutePath = path.isAbsolute(keyPath) 
                    ? keyPath 
                    : path.join(process.cwd(), keyPath);

                if (!fs.existsSync(absolutePath)) {
                    throw new Error(`GEE credentials file not found at ${absolutePath}`);
                }

                const key = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));

                console.log('[GEE] Authenticating via private key…');
                ee.data.authenticateViaPrivateKey(
                    key,
                    () => {
                        console.log('[GEE] Authentication successful. Initializing…');
                        ee.initialize(null, null, () => {
                            console.log('[GEE] System Ready.');
                            this.initialized = true;
                            resolve();
                        }, (err) => {
                            console.error('[GEE] Initialization failed:', err);
                            reject(err);
                        });
                    },
                    (err) => {
                        console.error('[GEE] Authentication failed:', err);
                        reject(err);
                    }
                );
            } catch (err) {
                reject(err);
            }
        });

        return this.initPromise;
    }

    /**
     * Get a MapID for a specific layer type.
     * @param {string} layerType - 'vegetation', 'water', or 'elevation'
     */
    async getLayerMapId(layerType) {
        await this.init();

        let image;
        let visParams;

        switch (layerType) {
            case 'vegetation-high':
                // Sentinel-2 NDVI (High Res)
                const s2 = ee.ImageCollection('COPERNICUS/S2_SR')
                    .filterDate('2023-01-01', '2023-12-31')
                    .median();
                image = s2.normalizedDifference(['B8', 'B4']).rename('NDVI');
                visParams = {
                    min: 0,
                    max: 0.8,
                    palette: ['#FFFFFF', '#CE7E45', '#DF923D', '#F1B555', '#FCD163', '#99B718', '#74A901', '#66A000', '#529400', '#3E8601', '#207401', '#056201', '#004C00', '#023B01', '#012E01', '#011D01', '#011301']
                };
                break;

            case 'vegetation-low':
                // MODIS NDVI (Low Res / Global)
                image = ee.ImageCollection('MODIS/061/MOD13Q1')
                    .filterDate('2023-01-01', '2023-12-31')
                    .median()
                    .select('NDVI')
                    .multiply(0.0001); // Scale factor for MODIS NDVI
                visParams = {
                    min: 0,
                    max: 0.8,
                    palette: ['#FFFFFF', '#CE7E45', '#DF923D', '#F1B555', '#FCD163', '#99B718', '#74A901', '#66A000', '#529400', '#3E8601', '#207401', '#056201', '#004C00', '#023B01', '#012E01', '#011D01', '#011301']
                };
                break;

            case 'water':
                // JRC Global Surface Water Occurrence
                image = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('occurrence');
                visParams = {
                    min: 0,
                    max: 100,
                    palette: ['#ece7f2', '#bdc9e1', '#74a9cf', '#0570b0']
                };
                break;

            case 'elevation':
                // SRTM Hillshade
                const srtm = ee.Image('USGS/SRTMGL1_003');
                image = ee.Terrain.hillshade(srtm);
                visParams = {
                    min: 0,
                    max: 255
                };
                break;

            default:
                throw new Error(`Unknown layer type: ${layerType}`);
        }

        return new Promise((resolve, reject) => {
            image.getMap(visParams, (map) => {
                if (map && map.mapid) {
                    resolve({
                        mapid: map.mapid,
                        token: map.token,
                        urlTemplate: `https://earthengine.googleapis.com/v1alpha/${map.mapid}/tiles/{z}/{x}/{y}`
                    });
                } else {
                    reject(new Error('Failed to generate MapID from GEE'));
                }
            });
        });
    }
}

module.exports = new GeeService();
