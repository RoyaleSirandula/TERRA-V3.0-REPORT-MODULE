/* ============================================================
   TERRA – capabilities.js
   Single source of truth for role-based capability gates.

   DESIGN PRINCIPLE
   ────────────────
   Roles are metadata (stored in DB). Capabilities are the
   contract (what a role can actually do). Nothing in the
   app should branch on raw role strings — it should always
   read from a capability object produced by this module.

   ADDING A NEW CAPABILITY
   ───────────────────────
   1. Add the key to every role block in CAPABILITY_MATRIX.
   2. Add requireCap('section.newKey') to the relevant route.
   3. Add Auth.can('section.newKey') to the relevant UI component.
   No other files need to change.
   ============================================================ */

/**
 * CAPABILITY_MATRIX
 *
 * Maps role_name (uppercase) → structured capability object.
 *
 * siteAnalysis
 *   mode               'full' | 'restricted'
 *   allowedBasemaps    string[] — which basemap IDs the user may select
 *   ownReportsOnly     boolean  — sightings endpoint scoped to user_id
 *   geeAccess          boolean  — may call /api/gee/* endpoints
 *   drawingTools       boolean  — may use Leaflet.Draw polygon/line/marker
 *   waterLayer         boolean  — JRC water GEE layer visible
 *   bufferAnalysis     boolean  — may call /api/analysis/buffer
 *   ndviAnalysis       boolean  — may call /api/analysis/ndvi-zonal
 *   timelineControl    boolean  — may use temporal playback slider
 *   gridResolution     boolean  — may change density-grid resolution
 *
 * myReports
 *   scope              'own' | 'all' — 'own' always forces user_id filter
 *
 * sharing
 *   canShare           boolean  — may create report_shares
 *   canReceive         boolean  — may appear as a share recipient
 *   canForward         boolean  — may share reports submitted by others (future)
 *
 * teams
 *   canJoin            boolean  — may be added to a team
 *   canCreate          boolean  — may create a new team
 *   canManage          boolean  — may remove members, delete teams
 *
 * administration       boolean  — may access /users /roles /audit-logs pages
 */
const CAPABILITY_MATRIX = {
    COMMUNITY: {
        siteAnalysis: {
            mode: 'restricted',
            allowedBasemaps: ['satellite'],
            ownReportsOnly: true,
            geeAccess: false,
            drawingTools: false,
            waterLayer: false,
            bufferAnalysis: false,
            ndviAnalysis: false,
            timelineControl: false,
            gridResolution: false,
        },
        myReports: { scope: 'own' },
        sharing:   { canShare: false, canReceive: false, canForward: false },
        teams:     { canJoin: false,  canCreate: false,  canManage: false },
        administration: false,
    },

    RANGER: {
        siteAnalysis: {
            mode: 'full',
            allowedBasemaps: ['satellite', 'aesthetic'],
            ownReportsOnly: false,
            geeAccess: true,
            drawingTools: true,
            waterLayer: true,
            bufferAnalysis: true,
            ndviAnalysis: true,
            timelineControl: true,
            gridResolution: true,
        },
        myReports: { scope: 'all' },
        sharing:   { canShare: true,  canReceive: true,  canForward: false },
        teams:     { canJoin: true,   canCreate: false,  canManage: false },
        administration: false,
    },

    ANALYST: {
        siteAnalysis: {
            mode: 'full',
            allowedBasemaps: ['satellite', 'aesthetic'],
            ownReportsOnly: false,
            geeAccess: true,
            drawingTools: true,
            waterLayer: true,
            bufferAnalysis: true,
            ndviAnalysis: true,
            timelineControl: true,
            gridResolution: true,
        },
        myReports: { scope: 'all' },
        sharing:   { canShare: true,  canReceive: true,  canForward: true },
        teams:     { canJoin: true,   canCreate: true,   canManage: false },
        administration: false,
    },

    ADMIN: {
        siteAnalysis: {
            mode: 'full',
            allowedBasemaps: ['satellite', 'aesthetic'],
            ownReportsOnly: false,
            geeAccess: true,
            drawingTools: true,
            waterLayer: true,
            bufferAnalysis: true,
            ndviAnalysis: true,
            timelineControl: true,
            gridResolution: true,
        },
        myReports: { scope: 'all' },
        sharing:   { canShare: true,  canReceive: true,  canForward: true },
        teams:     { canJoin: true,   canCreate: true,   canManage: true },
        administration: true,
    },
};

/**
 * buildCapabilities(role_name)
 *
 * Returns the full capability object for a given role_name string.
 * Input is normalised to uppercase before lookup so 'ranger',
 * 'Ranger', and 'RANGER' all resolve correctly.
 *
 * Falls back to COMMUNITY capabilities if the role is unknown,
 * applying the principle of least privilege: an unrecognised role
 * gets the most restricted set rather than crashing or granting
 * elevated access.
 *
 * @param  {string} role_name  — role_name from the users table
 * @returns {object}           — capability object from CAPABILITY_MATRIX
 */
function buildCapabilities(role_name) {
    const key = (role_name || '').toUpperCase();
    return CAPABILITY_MATRIX[key] || CAPABILITY_MATRIX.COMMUNITY;
}

/**
 * requireCap(capPath)
 *
 * Express middleware factory. Reads the authenticated user's role_name,
 * builds their capability object, then checks whether the boolean value
 * at `capPath` (dot-notation) is truthy.
 *
 * Returns HTTP 403 with a structured error body if the capability is
 * absent so the client can distinguish a tier restriction from a generic
 * server error and render an appropriate upgrade prompt.
 *
 * Usage:
 *   router.post('/buffer', authenticate, requireCap('siteAnalysis.bufferAnalysis'), handler);
 *   router.post('/gee/mapid', authenticate, requireCap('siteAnalysis.geeAccess'), handler);
 *
 * @param  {string} capPath  — dot-path into the capability object
 * @returns {Function}       — Express middleware (req, res, next)
 */
function requireCap(capPath) {
    return (req, res, next) => {
        const caps   = buildCapabilities(req.user?.role_name);
        const actual = capPath.split('.').reduce((obj, key) => obj?.[key], caps);
        if (!actual) {
            return res.status(403).json({
                error:       'Forbidden: Insufficient tier access',
                code:        'TIER_RESTRICTED',
                requiredCap: capPath,
                userRole:    req.user?.role_name || 'UNKNOWN',
            });
        }
        next();
    };
}

module.exports = { buildCapabilities, requireCap, CAPABILITY_MATRIX };
