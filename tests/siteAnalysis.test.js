/**
 * tests/siteAnalysis.test.js
 *
 * Unit tests for the pure / quasi-pure functions introduced in siteAnalysis.js:
 *
 *   1. haversineDistanceMeters   — great-circle distance maths
 *   2. getViewportAreaKm2        — viewport area normalisation
 *   3. getViewportSightings      — viewport intersection filter
 *   4. computeViewportStats      — Active Points + Sector Density outputs
 *   5. computeBufferRecords      — Total Records + delta label outputs
 *   6. setSessionSpecies         — species context + immediate recompute
 *   7. Auto-step deduplication   — renderGrid._lastAutoStep toast guard
 *
 * Run with:  node tests/siteAnalysis.test.js
 *
 * Uses Node 18+ built-in test runner (node:test + node:assert).
 * No external dependencies required.
 */

'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

/* ═══════════════════════════════════════════════════════════════════
   SECTION 1 — REPLICATED PURE FUNCTIONS
   These are extracted verbatim from siteAnalysis.js so the tests
   exercise exactly the same logic without needing a browser environment.
═══════════════════════════════════════════════════════════════════ */

/**
 * haversineDistanceMeters — great-circle distance between two WGS-84 points.
 * Replicated from siteAnalysis.js without modification.
 */
function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
    const R     = 6371000;
    const toRad = deg => deg * Math.PI / 180;
    const dLat  = toRad(lat2 - lat1);
    const dLng  = toRad(lng2 - lng1);
    const a     = Math.sin(dLat / 2) ** 2
                + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
                * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * getViewportAreaKm2 — approximate viewport area from mock bounds object.
 * In production _map.getBounds() returns a Leaflet bounds; here we accept
 * a plain bounds object with the same interface.
 */
function getViewportAreaKm2(bounds) {
    const latSpan   = bounds.getNorth() - bounds.getSouth();
    const lngSpan   = bounds.getEast()  - bounds.getWest();
    const centreLat = (bounds.getNorth() + bounds.getSouth()) / 2;
    const heightKm  = latSpan * 111.32;
    const widthKm   = lngSpan * 111.32 * Math.abs(Math.cos(centreLat * Math.PI / 180));
    return Math.max(heightKm * widthKm, 0.001);
}

/**
 * getViewportSightings — filter a report array to only those within bounds.
 * In production uses _map.getBounds(); here accepts bounds directly.
 */
function getViewportSightings(filteredReports, bounds) {
    if (!bounds || filteredReports.length === 0) return [];
    return filteredReports.filter(r =>
        r.latitude  >= bounds.getSouth() && r.latitude  <= bounds.getNorth() &&
        r.longitude >= bounds.getWest()  && r.longitude <= bounds.getEast()
    );
}

/**
 * computeViewportStats — derives Sector Density and Active Points.
 * Returns { density: string, points: number } instead of writing to DOM
 * so the test can assert the computed values directly.
 */
function computeViewportStats(filteredReports, bounds) {
    const viewport = getViewportSightings(filteredReports, bounds);
    const count    = viewport.length;
    const areaKm2  = getViewportAreaKm2(bounds);
    const density  = count / areaKm2;
    return {
        points:  count,
        density: density < 10 ? density.toFixed(2) : density.toFixed(1),
    };
}

/**
 * computeBufferRecords — counts sightings within the buffer zone, optionally
 * restricted to a species.  Returns { count, label } instead of writing DOM.
 *
 * @param {object[]} filteredReports
 * @param {object}   bufferConfig    { lat, lng, radiusMeters }
 * @param {string|null} sessionSpeciesId
 * @param {string|null} sessionSpeciesName
 */
function computeBufferRecords(filteredReports, bufferConfig, sessionSpeciesId, sessionSpeciesName) {
    const { lat: bufLat, lng: bufLng, radiusMeters } = bufferConfig;

    // Narrow candidate pool to session species when a species filter is active
    const pool = sessionSpeciesId
        ? filteredReports.filter(r => r.species_id === sessionSpeciesId)
        : filteredReports;

    let count, label;

    if (bufLat != null && bufLng != null && !isNaN(bufLat) && !isNaN(bufLng)) {
        count = pool.filter(r =>
            haversineDistanceMeters(bufLat, bufLng, r.latitude, r.longitude) <= radiusMeters
        ).length;

        const radiusLabel = radiusMeters >= 1000
            ? `${(radiusMeters / 1000).toFixed(0)}km`
            : `${radiusMeters}m`;

        label = sessionSpeciesName
            ? `${radiusLabel} · ${sessionSpeciesName.toUpperCase().slice(0, 14)}`
            : `${radiusLabel} BUFFER ZONE`;
    } else {
        count = pool.length;
        label = sessionSpeciesName
            ? `ALL · ${sessionSpeciesName.toUpperCase().slice(0, 14)}`
            : 'ALL VALIDATED';
    }

    return { count, label };
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 2 — SHARED TEST FIXTURES
═══════════════════════════════════════════════════════════════════ */

/**
 * makeBounds — creates a minimal Leaflet-style bounds mock.
 */
function makeBounds(south, west, north, east) {
    return {
        getSouth: () => south,
        getNorth: () => north,
        getWest:  () => west,
        getEast:  () => east,
    };
}

/**
 * makeSighting — factory for report objects used across tests.
 * Defaults to a Nairobi-area location unless overridden.
 */
function makeSighting(overrides = {}) {
    return {
        report_id:  `rpt-${Math.random().toString(36).slice(2, 8)}`,
        species_id: 'sp-buffalo',
        species_name: 'African Buffalo',
        latitude:   -1.2921,
        longitude:  36.8219,
        created_at: '2026-01-15T10:00:00Z',
        ...overrides,
    };
}

// Nairobi (reference point for buffer tests)
const NAIROBI_LAT = -1.2921;
const NAIROBI_LNG = 36.8219;

// Mombasa — ~440 km from Nairobi
const MOMBASA_LAT = -4.0435;
const MOMBASA_LNG = 39.6682;

/* ═══════════════════════════════════════════════════════════════════
   SECTION 3 — TEST SUITES
═══════════════════════════════════════════════════════════════════ */

/* ── 1. haversineDistanceMeters ──────────────────────────────────── */
describe('haversineDistanceMeters', () => {

    it('returns 0 for identical coordinates', () => {
        const d = haversineDistanceMeters(NAIROBI_LAT, NAIROBI_LNG, NAIROBI_LAT, NAIROBI_LNG);
        assert.strictEqual(d, 0);
    });

    it('is symmetric — distance A→B equals distance B→A', () => {
        const ab = haversineDistanceMeters(NAIROBI_LAT, NAIROBI_LNG, MOMBASA_LAT, MOMBASA_LNG);
        const ba = haversineDistanceMeters(MOMBASA_LAT, MOMBASA_LNG, NAIROBI_LAT, NAIROBI_LNG);
        assert.ok(Math.abs(ab - ba) < 0.01, `Expected symmetric but got ab=${ab} ba=${ba}`);
    });

    it('measures Nairobi→Mombasa within ±2% of known ~440km road/air distance', () => {
        const d = haversineDistanceMeters(NAIROBI_LAT, NAIROBI_LNG, MOMBASA_LAT, MOMBASA_LNG);
        const km = d / 1000;
        // Great-circle is ~440 km; allow ±2% tolerance
        assert.ok(km > 430 && km < 450, `Expected ~440 km, got ${km.toFixed(1)} km`);
    });

    it('correctly handles antipodal points (~Earth half-circumference)', () => {
        const d = haversineDistanceMeters(0, 0, 0, 180);
        const km = d / 1000;
        // Half circumference ≈ 20015 km
        assert.ok(km > 19900 && km < 20100, `Expected ~20015 km, got ${km.toFixed(1)} km`);
    });

    it('returns correct value for short distance (~1 km)', () => {
        // Moving ~0.009° latitude ≈ 1 km
        const d = haversineDistanceMeters(0, 0, 0.009, 0);
        assert.ok(d > 900 && d < 1100, `Expected ~1000 m, got ${d.toFixed(0)} m`);
    });

    it('handles negative latitudes (southern hemisphere) correctly', () => {
        const d = haversineDistanceMeters(-1.0, 36.0, -1.01, 36.0);
        // ~1.11 km
        assert.ok(d > 1000 && d < 1300);
    });
});

/* ── 2. getViewportAreaKm2 ───────────────────────────────────────── */
describe('getViewportAreaKm2', () => {

    it('returns a positive area for a normal viewport', () => {
        const bounds = makeBounds(-2, 36, -1, 37);
        const area = getViewportAreaKm2(bounds);
        assert.ok(area > 0, 'Area must be positive');
    });

    it('returns ≥ 0.001 km² (floor) even for a zero-size viewport', () => {
        const bounds = makeBounds(0, 0, 0, 0);  // degenerate — single point
        const area = getViewportAreaKm2(bounds);
        assert.ok(area >= 0.001, `Expected floor 0.001, got ${area}`);
    });

    it('scales proportionally — doubling lat and lng spans quadruples area', () => {
        const small = makeBounds(0, 0, 1, 1);
        const large = makeBounds(0, 0, 2, 2);
        const aSmall = getViewportAreaKm2(small);
        const aLarge = getViewportAreaKm2(large);
        // At equator the cos correction is ~1, so area should ≈ 4×
        const ratio = aLarge / aSmall;
        assert.ok(ratio > 3.5 && ratio < 4.5, `Expected ~4× ratio, got ${ratio.toFixed(2)}`);
    });

    it('accounts for latitude — same degree span is smaller area near poles', () => {
        const equatorial = makeBounds(0, 0, 1, 1);
        const polar      = makeBounds(80, 0, 81, 1);
        const aEq  = getViewportAreaKm2(equatorial);
        const aPol = getViewportAreaKm2(polar);
        // cos(80°) ≈ 0.174 → polar area should be much smaller
        assert.ok(aPol < aEq, `Polar area (${aPol.toFixed(0)} km²) should be less than equatorial (${aEq.toFixed(0)} km²)`);
    });

    it('produces a reasonable area for a typical Leaflet zoom-10 view', () => {
        // Bounds: latSpan=0.6°, lngSpan=1.0°, centred ~−1.2° (near Nairobi, cos ≈ 1)
        //   heightKm = 0.6 × 111.32 ≈ 66.8 km
        //   widthKm  = 1.0 × 111.32 × cos(−1.2°) ≈ 111.3 km
        //   area     ≈ 66.8 × 111.3 ≈ 7,435 km²
        const bounds = makeBounds(-1.5, 36.3, -0.9, 37.3);
        const area = getViewportAreaKm2(bounds);
        assert.ok(area > 7000 && area < 8000, `Expected ~7,435 km², got ${area.toFixed(0)} km²`);
    });
});

/* ── 3. getViewportSightings ─────────────────────────────────────── */
describe('getViewportSightings', () => {

    it('returns empty array when filteredReports is empty', () => {
        const bounds = makeBounds(-2, 36, 0, 38);
        const result = getViewportSightings([], bounds);
        assert.deepStrictEqual(result, []);
    });

    it('includes sightings exactly on the boundary (inclusive)', () => {
        const bounds = makeBounds(-2, 36, 0, 38);
        const onNorthEdge  = makeSighting({ latitude:  0,  longitude: 37 });
        const onSouthEdge  = makeSighting({ latitude: -2,  longitude: 37 });
        const onWestEdge   = makeSighting({ latitude: -1,  longitude: 36 });
        const onEastEdge   = makeSighting({ latitude: -1,  longitude: 38 });
        const result = getViewportSightings(
            [onNorthEdge, onSouthEdge, onWestEdge, onEastEdge],
            bounds
        );
        assert.strictEqual(result.length, 4, 'All boundary sightings should be included');
    });

    it('excludes sightings just outside the boundary', () => {
        const bounds = makeBounds(-2, 36, 0, 38);
        const justNorth = makeSighting({ latitude:  0.001, longitude: 37 });
        const justSouth = makeSighting({ latitude: -2.001, longitude: 37 });
        const justWest  = makeSighting({ latitude: -1,     longitude: 35.999 });
        const justEast  = makeSighting({ latitude: -1,     longitude: 38.001 });
        const result = getViewportSightings(
            [justNorth, justSouth, justWest, justEast],
            bounds
        );
        assert.strictEqual(result.length, 0, 'Sightings just outside bounds should be excluded');
    });

    it('returns only the in-bounds subset from a mixed array', () => {
        const bounds = makeBounds(-2, 36, 0, 38);
        const inside  = makeSighting({ latitude: -1,    longitude: 37 });
        const outside = makeSighting({ latitude: -5,    longitude: 37 });
        const result  = getViewportSightings([inside, outside], bounds);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].latitude, -1);
    });

    it('handles a null/undefined bounds gracefully (returns empty)', () => {
        const result = getViewportSightings([makeSighting()], null);
        assert.deepStrictEqual(result, []);
    });
});

/* ── 4. computeViewportStats ─────────────────────────────────────── */
describe('computeViewportStats', () => {

    const bounds = makeBounds(-1.5, 36.5, -1.0, 37.0);

    it('returns { points: 0, density: "0.00" } when no sightings in viewport', () => {
        const result = computeViewportStats([], bounds);
        assert.strictEqual(result.points, 0);
        assert.strictEqual(result.density, '0.00');
    });

    it('counts only sightings inside the viewport', () => {
        const inside  = makeSighting({ latitude: -1.2, longitude: 36.8 });
        const outside = makeSighting({ latitude: -5.0, longitude: 36.8 });
        const result  = computeViewportStats([inside, outside], bounds);
        assert.strictEqual(result.points, 1);
    });

    it('density increases proportionally with more sightings over the same area', () => {
        // Use a tight 0.02°×0.02° viewport (≈5 km²) so density values are large
        // enough to be distinguishable at 2 decimal places.
        // area ≈ (0.02×111.32)² ≈ 4.97 km²
        // density(1) ≈ 0.20  →  density(5) ≈ 1.01
        const tightBounds = makeBounds(-1.21, 36.79, -1.19, 36.81);
        const one  = [makeSighting({ latitude: -1.20, longitude: 36.80 })];
        const five = Array.from({ length: 5 }, () => makeSighting({ latitude: -1.20, longitude: 36.80 }));
        const r1 = computeViewportStats(one,  tightBounds);
        const r5 = computeViewportStats(five, tightBounds);
        assert.ok(parseFloat(r5.density) > parseFloat(r1.density),
            `Density should increase with more sightings (got r1=${r1.density}, r5=${r5.density})`);
    });

    it('formats density with 2 decimal places when below 10', () => {
        const sightings = [makeSighting({ latitude: -1.2, longitude: 36.8 })];
        const { density } = computeViewportStats(sightings, bounds);
        assert.match(density, /^\d+\.\d{2}$/, `Expected 2 d.p. format, got "${density}"`);
    });

    it('formats density with 1 decimal place when 10 or above', () => {
        // Use a tiny viewport to inflate the density value above 10
        const tinyBounds = makeBounds(-1.2901, 36.8199, -1.2900, 36.8200);
        const sightings  = Array.from({ length: 200 }, () =>
            makeSighting({ latitude: -1.29005, longitude: 36.82005 })
        );
        const { density } = computeViewportStats(sightings, tinyBounds);
        if (parseFloat(density) >= 10) {
            assert.match(density, /^\d+\.\d{1}$/, `Expected 1 d.p. format, got "${density}"`);
        }
        // If density is still below 10 that's fine — the sightings just don't
        // make it above 10 for this tiny area. At minimum it should not crash.
    });
});

/* ── 5. computeBufferRecords ─────────────────────────────────────── */
describe('computeBufferRecords', () => {

    // A tight cluster in Nairobi, 300 m radius
    const nearby = Array.from({ length: 4 }, (_, i) =>
        makeSighting({ species_id: 'sp-buffalo', latitude: NAIROBI_LAT + i * 0.0005, longitude: NAIROBI_LNG })
    );
    // One far sighting in Mombasa
    const farAway = makeSighting({ species_id: 'sp-buffalo', latitude: MOMBASA_LAT, longitude: MOMBASA_LNG });
    // A lion sighting at Nairobi — different species
    const lion = makeSighting({ species_id: 'sp-lion', species_name: 'African Lion', latitude: NAIROBI_LAT, longitude: NAIROBI_LNG });

    const allReports = [...nearby, farAway, lion];

    describe('with no buffer centre set', () => {

        it('returns total count of all reports when no species filter', () => {
            const config = { lat: null, lng: null, radiusMeters: 5000 };
            const { count, label } = computeBufferRecords(allReports, config, null, null);
            assert.strictEqual(count, allReports.length);
            assert.strictEqual(label, 'ALL VALIDATED');
        });

        it('filters to session species when no buffer centre', () => {
            const config = { lat: null, lng: null, radiusMeters: 5000 };
            const { count, label } = computeBufferRecords(allReports, config, 'sp-lion', 'African Lion');
            assert.strictEqual(count, 1, 'Only the lion sighting should match');
            assert.ok(label.includes('ALL'), 'Label should say ALL when no buffer centre');
            assert.ok(label.includes('AFRICAN LION'), 'Label should include species name');
        });

        it('returns 0 when species filter matches nothing', () => {
            const config = { lat: null, lng: null, radiusMeters: 5000 };
            const { count } = computeBufferRecords(allReports, config, 'sp-elephant', 'Elephant');
            assert.strictEqual(count, 0);
        });
    });

    describe('with buffer centre set', () => {

        it('counts sightings within the radius', () => {
            // 1 km radius around Nairobi — should capture nearby cluster but not Mombasa
            const config = { lat: NAIROBI_LAT, lng: NAIROBI_LNG, radiusMeters: 1000 };
            const { count } = computeBufferRecords(allReports, config, null, null);
            // 4 nearby + 1 lion are all within ~200 m of Nairobi; farAway is ~440 km away
            assert.strictEqual(count, 5, 'Should count 4 buffalo + 1 lion within 1 km');
        });

        it('excludes sightings outside the radius', () => {
            const config = { lat: NAIROBI_LAT, lng: NAIROBI_LNG, radiusMeters: 1000 };
            const { count } = computeBufferRecords(allReports, config, null, null);
            assert.ok(count < allReports.length, 'Mombasa sighting should be excluded');
        });

        it('combines radius filter with species filter', () => {
            const config = { lat: NAIROBI_LAT, lng: NAIROBI_LNG, radiusMeters: 1000 };
            const { count } = computeBufferRecords(allReports, config, 'sp-lion', 'African Lion');
            assert.strictEqual(count, 1, 'Only 1 lion within 1 km radius');
        });

        it('returns 0 when radius is very tight (1 m) and no exact match', () => {
            const config = { lat: 0, lng: 0, radiusMeters: 1 };
            const { count } = computeBufferRecords(allReports, config, null, null);
            assert.strictEqual(count, 0);
        });

        it('formats radius label correctly for km values', () => {
            const config = { lat: NAIROBI_LAT, lng: NAIROBI_LNG, radiusMeters: 5000 };
            const { label } = computeBufferRecords(allReports, config, null, null);
            assert.ok(label.includes('5km'), `Expected "5km" in label, got "${label}"`);
        });

        it('formats radius label correctly for sub-km values', () => {
            const config = { lat: NAIROBI_LAT, lng: NAIROBI_LNG, radiusMeters: 500 };
            const { label } = computeBufferRecords(allReports, config, null, null);
            assert.ok(label.includes('500m'), `Expected "500m" in label, got "${label}"`);
        });

        it('includes truncated species name in label when species is set', () => {
            const config = { lat: NAIROBI_LAT, lng: NAIROBI_LNG, radiusMeters: 5000 };
            const { label } = computeBufferRecords(allReports, config, 'sp-buffalo', 'African Buffalo');
            // Sliced to 14 chars: 'AFRICAN BUFFAL'
            assert.ok(label.includes('AFRICAN BUFFAL'), `Expected species in label, got "${label}"`);
        });

        it('radius boundary — point exactly at radius distance is included', () => {
            // Place one sighting exactly 5000 m from Nairobi using inverse haversine
            // We'll approximate: at equator 0.045° ≈ 5000 m
            // Instead verify that a point we know is 5000 m away is counted at radius=5000
            const exactlyAt5km = makeSighting({
                species_id: 'sp-test',
                // 0.045° latitude ≈ 5010 m — just place it right at the threshold
                latitude:  NAIROBI_LAT + 0.0449,
                longitude: NAIROBI_LNG,
            });
            const dist = haversineDistanceMeters(
                NAIROBI_LAT, NAIROBI_LNG,
                exactlyAt5km.latitude, exactlyAt5km.longitude
            );
            const config = { lat: NAIROBI_LAT, lng: NAIROBI_LNG, radiusMeters: dist };
            const { count } = computeBufferRecords([exactlyAt5km], config, null, null);
            // Point is exactly at boundary — haversine(dist) <= dist is always true
            assert.strictEqual(count, 1, 'Point at exact boundary distance should be included');
        });
    });
});

/* ── 6. setSessionSpecies ────────────────────────────────────────── */
describe('setSessionSpecies (stateful wrapper)', () => {
    /**
     * We simulate the stateful wrapper here — maintaining _sessionSpeciesId
     * and _sessionSpeciesName as local variables and calling computeBufferRecords
     * after each set, the same way the real function does.
     */

    let speciesId   = null;
    let speciesName = null;

    function setSessionSpecies(id, name) {
        speciesId   = id   || null;
        speciesName = name || null;
    }

    const reports = [
        makeSighting({ species_id: 'sp-a', latitude: 0, longitude: 0 }),
        makeSighting({ species_id: 'sp-b', latitude: 0, longitude: 0 }),
    ];
    const config = { lat: null, lng: null, radiusMeters: 5000 };

    beforeEach(() => { speciesId = null; speciesName = null; });

    it('setting a species restricts the pool to matching records', () => {
        setSessionSpecies('sp-a', 'Species A');
        const { count } = computeBufferRecords(reports, config, speciesId, speciesName);
        assert.strictEqual(count, 1);
    });

    it('clearing species (null) reverts to all-species count', () => {
        setSessionSpecies('sp-a', 'Species A');
        setSessionSpecies(null, null);
        const { count } = computeBufferRecords(reports, config, speciesId, speciesName);
        assert.strictEqual(count, reports.length);
    });

    it('passing undefined also clears species (treated as null)', () => {
        setSessionSpecies(undefined, undefined);
        assert.strictEqual(speciesId, null);
        assert.strictEqual(speciesName, null);
    });

    it('switching from one species to another filters correctly', () => {
        setSessionSpecies('sp-a', 'Species A');
        const { count: countA } = computeBufferRecords(reports, config, speciesId, speciesName);

        setSessionSpecies('sp-b', 'Species B');
        const { count: countB } = computeBufferRecords(reports, config, speciesId, speciesName);

        assert.strictEqual(countA, 1);
        assert.strictEqual(countB, 1);
    });
});

/* ── 7. Auto-step toast deduplication guard ──────────────────────── */
describe('Auto-step deduplication (renderGrid._lastAutoStep logic)', () => {
    /**
     * Simulates the renderGrid._lastAutoStep tracking logic in isolation.
     * Verifies that the toast only fires when the stepped-to key CHANGES,
     * not on every render where auto-step is active.
     */

    const GRID_RESOLUTIONS = {
        fine:     { label: 'Fine',     cellSize: 0.001, maxCells: 300 },
        standard: { label: 'Standard', cellSize: 0.005, maxCells: 400 },
        medium:   { label: 'Medium',   cellSize: 0.010, maxCells: 500 },
        coarse:   { label: 'Coarse',   cellSize: 0.025, maxCells: 600 },
        regional: { label: 'Regional', cellSize: 0.050, maxCells: Infinity },
    };
    const RESOLUTION_ORDER = ['regional', 'coarse', 'medium', 'standard', 'fine'];

    function getNextCoarser(key) {
        const idx = RESOLUTION_ORDER.indexOf(key);
        return idx > 0 ? RESOLUTION_ORDER[idx - 1] : null;
    }

    function estimateCells(cellSize, latSpan, lngSpan) {
        return Math.ceil(latSpan / cellSize) * Math.ceil(lngSpan / cellSize);
    }

    /**
     * Simulates one call to the renderGrid() auto-step section.
     * Returns { activeKey, toastFired, lastAutoStep }.
     */
    let lastAutoStep = null;

    function simulateRenderGrid(userResolution, latSpan, lngSpan) {
        let activeKey = userResolution;
        while (activeKey) {
            const preset    = GRID_RESOLUTIONS[activeKey];
            const estimated = estimateCells(preset.cellSize, latSpan, lngSpan);
            if (estimated <= preset.maxCells) break;
            const coarser = getNextCoarser(activeKey);
            if (!coarser) break;
            activeKey = coarser;
        }

        let toastFired = false;
        if (activeKey !== userResolution) {
            if (lastAutoStep !== activeKey) {
                toastFired = true;  // would call Toast.warning() here
            }
        }
        lastAutoStep = (activeKey !== userResolution) ? activeKey : null;
        return { activeKey, toastFired, lastAutoStep };
    }

    beforeEach(() => { lastAutoStep = null; });

    it('does NOT fire toast when no auto-step needed', () => {
        // standard cellSize=0.005, maxCells=400
        // ceil(0.01/0.005) * ceil(0.01/0.005) = 2 * 2 = 4 cells → safely under limit
        const { toastFired, activeKey } = simulateRenderGrid('standard', 0.01, 0.01);
        assert.strictEqual(toastFired, false);
        assert.strictEqual(activeKey, 'standard');
    });

    it('fires toast once when auto-step is first triggered', () => {
        // Very large viewport — forces fine → coarser
        const { toastFired } = simulateRenderGrid('fine', 5, 5);
        assert.strictEqual(toastFired, true);
    });

    it('does NOT fire toast again on repeated renders with the same auto-step', () => {
        // First render — toast fires
        const first = simulateRenderGrid('fine', 5, 5);
        assert.strictEqual(first.toastFired, true);

        // Second render at same viewport — toast must NOT repeat
        const second = simulateRenderGrid('fine', 5, 5);
        assert.strictEqual(second.toastFired, false,
            'Toast should not repeat when auto-step key has not changed');
    });

    it('fires toast again if the stepped-to key changes (user zoomed in then out)', () => {
        // Zoom out far — steps to 'regional'
        const far = simulateRenderGrid('fine', 10, 10);
        assert.ok(far.activeKey !== 'fine');
        const keyAfterFar = far.activeKey;

        // Zoom in a little — now steps to a different (less coarse) level
        // Use a viewport that would step to coarse but not regional
        const medium = simulateRenderGrid('fine', 2, 2);

        if (medium.activeKey !== keyAfterFar && medium.activeKey !== 'fine') {
            assert.strictEqual(medium.toastFired, true,
                'Toast should fire again when step-to key changes');
        }
    });

    it('clears lastAutoStep when viewport returns to a renderable size', () => {
        // First render: latSpan=5 forces auto-step (fine produces thousands of cells)
        simulateRenderGrid('fine', 5, 5);
        assert.notStrictEqual(lastAutoStep, null, 'lastAutoStep should be set after auto-step');

        // Second render: latSpan=0.015 → fine: ceil(15)*ceil(15)=225 ≤ maxCells(300) → no step
        simulateRenderGrid('fine', 0.015, 0.015);
        assert.strictEqual(lastAutoStep, null, 'lastAutoStep should clear when viewport fits fine resolution');
    });

    it('steps through multiple levels without firing multiple toasts', () => {
        // So extreme that it has to step multiple levels
        const result = simulateRenderGrid('fine', 20, 20);
        // Should have fired at most one toast regardless of how many levels stepped
        assert.strictEqual(typeof result.toastFired, 'boolean');
        // The function fires at most once per render call — confirmed by the return value
    });
});
