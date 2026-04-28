'use strict';

// Movebank REST API proxy — token-based auth with automatic license acceptance.
// Docs: https://github.com/movebank/movebank-api/blob/master/movebank-api.md
// Requires Node 18+ for native fetch.
//
// Env vars (optional — public studies accessible without them):
//   MOVEBANK_USERNAME   MOVEBANK_PASSWORD

const crypto        = require('crypto');
const MOVEBANK_BASE = 'https://www.movebank.org/movebank/service/direct-read';
const MAX_SPEED_MS  = 50; // 50 m/s (~180 km/h) — absolute biological ceiling

/* ── Token cache (session tokens expire; cache for 55 min) ── */
let _cachedToken  = null;
let _tokenExpiry  = 0;

async function _getToken() {
    if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken;

    const u = process.env.MOVEBANK_USERNAME;
    const p = process.env.MOVEBANK_PASSWORD;
    if (!u || !p) return null; // No credentials → public-only access

    const auth = 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
    const res  = await fetch(
        `${MOVEBANK_BASE}?service=request-token`,
        { headers: { Authorization: auth }, signal: AbortSignal.timeout(10_000) }
    );

    if (res.status === 401) {
        throw new Error('Movebank credentials rejected (401). Verify MOVEBANK_USERNAME / MOVEBANK_PASSWORD in .env and that the account is active at movebank.org.');
    }
    if (!res.ok) {
        throw new Error(`Movebank token request failed: ${res.status}`);
    }

    _cachedToken = (await res.text()).trim();
    _tokenExpiry = Date.now() + 55 * 60 * 1000;
    return _cachedToken;
}

/* ── Core fetch with automatic license-acceptance retry ────── */
// When a study has data-use terms, Movebank returns:
//   header  accept-license: true
//   body    the license text
// We MD5 that text and resubmit with license-md5=<hash> to accept.
async function _fetch(params, _retryingLicense = false) {
    const token      = await _getToken();
    const allParams  = { ...params, format: 'json' };
    if (token) allParams['api-token'] = token;

    const qs  = new URLSearchParams(allParams).toString();
    const res = await fetch(`${MOVEBANK_BASE}?${qs}`, {
        signal: AbortSignal.timeout(15_000),
    });

    // License acceptance required — compute MD5 and retry once
    if (!_retryingLicense && res.headers.get('accept-license') === 'true') {
        const licenseText = await res.text();
        const md5         = crypto.createHash('md5').update(licenseText).digest('hex');
        console.log(`[Movebank] Accepting license for study (md5: ${md5})`);
        return _fetch({ ...params, 'license-md5': md5 }, true);
    }

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (res.status === 401) {
            throw new Error('Movebank returned 401. Check MOVEBANK_USERNAME / MOVEBANK_PASSWORD in .env.');
        }
        if (res.status === 403) {
            throw new Error(
                'Movebank returned 403 Forbidden. ' +
                (token
                    ? 'Your account may not have access to this study. Accept its terms at movebank.org or contact the data owner.'
                    : 'Register a free account at movebank.org and add MOVEBANK_USERNAME / MOVEBANK_PASSWORD to your .env file.')
            );
        }
        throw new Error(`Movebank API ${res.status}: ${text.slice(0, 300)}`);
    }

    return res.json();
}

/* ── Geometry helpers ─────────────────────────────────────── */
function _haversineM(lat1, lng1, lat2, lng2) {
    const R   = 6_371_000;
    const toR = d => d * Math.PI / 180;
    const dLat = toR(lat2 - lat1);
    const dLng = toR(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
            + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── Timestamp formatter for request params ──────────────── */
// Movebank request param format: yyyyMMddHHmmssSSS
function _formatTs(date) {
    const d   = new Date(date);
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    return (
        d.getUTCFullYear()       +
        pad(d.getUTCMonth() + 1) +
        pad(d.getUTCDate())      +
        pad(d.getUTCHours())     +
        pad(d.getUTCMinutes())   +
        pad(d.getUTCSeconds())   +
        '000'
    );
}

/* ── Parse events JSON → flat fix array ──────────────────── */
// JSON response timestamps are milliseconds since epoch (per Movebank docs).
// Two response shapes handled:
//   { individuals: [{ individual-local-identifier, locations: [{timestamp, location_lat, ...}] }] }
//   flat array of event objects
function _parseEvents(data) {
    let raw = [];

    if (Array.isArray(data)) {
        raw = data;
    } else if (data && Array.isArray(data.individuals)) {
        data.individuals.forEach(ind => {
            const id     = ind['individual-local-identifier'] || ind['individual_local_identifier'] || 'unknown';
            const sensor = ind['sensor-type'] || ind['sensor_type'] || '';
            (ind.locations || []).forEach(loc => {
                raw.push({
                    'individual-local-identifier': id,
                    'sensor-type':   sensor,
                    timestamp:       loc.timestamp,        // ms since epoch
                    'location-lat':  loc.location_lat  ?? loc['location-lat'],
                    'location-long': loc.location_long ?? loc['location-long'],
                    'argos-lc':      loc.argos_lc      ?? loc['argos-lc'] ?? null,
                });
            });
        });
    }

    return raw
        .map(r => ({
            individual: r['individual-local-identifier'] || r['individual_local_identifier'] || 'unknown',
            // Handle both ms-since-epoch (number) and ISO string (legacy)
            ts:     typeof r.timestamp === 'number'
                        ? r.timestamp
                        : new Date(r.timestamp).getTime(),
            lat:    parseFloat(r['location-lat']  ?? r['location_lat']  ?? r.location_lat),
            lng:    parseFloat(r['location-long'] ?? r['location_long'] ?? r.location_long),
            sensor: r['sensor-type'] || r['sensor_type'] || '',
            argosLc:r['argos-lc']    || r['argos_lc']    || null,
        }))
        .filter(f => !isNaN(f.lat) && !isNaN(f.lng) && !isNaN(f.ts));
}

/* ── Argos quality filter ─────────────────────────────────── */
// GPS: keep all. Argos: only location classes 3, 2, 1 are reliable.
function _qualityFilter(fixes) {
    return fixes.filter(f => {
        if (!f.sensor) return true;
        const s = f.sensor.toLowerCase();
        if (s.includes('gps')) return true;
        if (s.includes('argos')) return ['3', '2', '1'].includes(String(f.argosLc));
        return true;
    });
}

/* ── Speed filter ─────────────────────────────────────────── */
function _speedFilter(fixes) {
    const byInd = {};
    fixes.forEach(f => { (byInd[f.individual] ??= []).push(f); });

    const out = [];
    for (const track of Object.values(byInd)) {
        track.sort((a, b) => a.ts - b.ts);
        out.push(track[0]);
        for (let i = 1; i < track.length; i++) {
            const prev = track[i - 1];
            const curr = track[i];
            const dt   = (curr.ts - prev.ts) / 1000;
            if (dt <= 0) continue;
            const dist = _haversineM(prev.lat, prev.lng, curr.lat, curr.lng);
            if (dist / dt <= MAX_SPEED_MS) out.push(curr);
        }
    }
    return out;
}

/* ── Public API ──────────────────────────────────────────── */

async function searchStudies({ taxon } = {}) {
    const params = { entity_type: 'study' };
    if (taxon) params.taxon_name = taxon;

    // Filter to studies the user can actually access (if authenticated)
    const token = await _getToken();
    if (token) params.i_have_download_access = 'true';

    const data    = await _fetch(params);
    const studies = Array.isArray(data) ? data : (data.studies || []);

    return studies.map(s => ({
        id:                   s.id,
        name:                 s.name || s['study-name'] || `Study ${s.id}`,
        taxon:                s['taxon-ids']                   || s.taxon_ids              || '',
        principalInvestigator:s['principal-investigator-name'] || '',
        numberOfIndividuals:  s['number-of-individuals']       || s.number_of_individuals  || 0,
        timestampStart:       s['timestamp-start']             || s.timestamp_start        || null,
        timestampEnd:         s['timestamp-end']               || s.timestamp_end          || null,
        licenseType:          s['license-type']                || s.license_type           || '',
        sensorTypes:          s['sensor-type-ids']             || s.sensor_type_ids        || '',
    }));
}

async function getStudyInfo(studyId) {
    const data    = await _fetch({ entity_type: 'study', study_id: studyId });
    const studies = Array.isArray(data) ? data : (data.studies || []);
    const s       = studies[0];
    if (!s) throw new Error(`Study ${studyId} not found or not accessible`);

    return {
        id:                   s.id,
        name:                 s.name || s['study-name'] || `Study ${s.id}`,
        taxon:                s['taxon-ids']                   || '',
        principalInvestigator:s['principal-investigator-name'] || '',
        numberOfIndividuals:  s['number-of-individuals']       || 0,
        timestampStart:       s['timestamp-start']             || null,
        timestampEnd:         s['timestamp-end']               || null,
        licenseType:          s['license-type']                || '',
        sensorTypes:          s['sensor-type-ids']             || '',
    };
}

async function getTrackSegment({ studyId, startTime, endTime, lat, lng, radiusKm = 500 }) {
    const params = {
        entity_type:      'event',
        study_id:         studyId,
        timestamp_start:  _formatTs(startTime),
        timestamp_end:    _formatTs(endTime),
        attributes:       'timestamp,location_lat,location_long,individual_local_identifier,sensor_type,argos_lc',
    };

    const data = await _fetch(params);
    let fixes  = _parseEvents(data);

    if (lat != null && lng != null && radiusKm > 0) {
        const radiusM = radiusKm * 1000;
        fixes = fixes.filter(f => _haversineM(lat, lng, f.lat, f.lng) <= radiusM);
    }

    fixes = _qualityFilter(fixes);
    fixes = _speedFilter(fixes);
    fixes.sort((a, b) => a.ts - b.ts);

    return fixes;
}

// Invalidate cached token (call if requests start returning 401)
function clearToken() {
    _cachedToken = null;
    _tokenExpiry = 0;
}

module.exports = { searchStudies, getStudyInfo, getTrackSegment, clearToken };
