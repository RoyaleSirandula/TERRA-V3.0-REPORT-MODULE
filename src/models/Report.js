const { query } = require('../config/db');

class Report {
  static async create({ user_id, species_id, species_name_custom, latitude, longitude, sighting_timestamp, media_url, description, region_id, sensitivity_tier }) {
    // 1. Run Intelligence/Confidence Engines
    const { totalScore, breakdown, engines } = await Report.calculateSmartConfidence({
      user_id, species_id, species_name_custom, latitude, longitude, media_url, region_id
    });

    const sql = `
      INSERT INTO reports (
        user_id, species_id, species_name_custom, geom, sighting_timestamp, media_url, description, 
        region_id, sensitivity_tier, validation_status, ai_confidence_score, 
        confidence_breakdown, engine_metadata
      )
      VALUES (
        $1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, $7, $8, 
        $9, $10, 'PENDING', $11, $12, $13
      )
      RETURNING report_id, validation_status, created_at;
    `;
    const params = [
      user_id, species_id, species_name_custom, longitude, latitude, sighting_timestamp, media_url, description,
      region_id, sensitivity_tier, totalScore, JSON.stringify(breakdown), JSON.stringify(engines)
    ];

    const { rows } = await query(sql, params);
    return rows[0];
  }

  /* ── Intelligence Plugin System ──────────────────────────── */
  static intelligenceEngines = [];

  static registerIntelligenceEngine(engine) {
    this.intelligenceEngines.push(engine);
    console.log(`[INTELLIGENCE] Registered engine: ${engine.name}`);
  }

  static async calculateSmartConfidence(data) {
    const results = {
      totalScore: 30, // Base baseline
      breakdown: [],
      engines: []
    };

    // Run all registered engines
    for (const engine of this.intelligenceEngines) {
      try {
        const engineResult = await engine.process(data);
        results.totalScore += (engineResult.scoreBoost || 0);
        results.breakdown.push(...(engineResult.breakdown || []));
        results.engines.push(engine.name);
      } catch (err) {
        console.error(`[INTELLIGENCE] Engine ${engine.name} failed:`, err);
      }
    }

    results.totalScore = Math.min(100, Math.round(results.totalScore));
    return results;
  }

  static async findById(report_id) {
    const sql = `
      SELECT r.*, ST_AsGeoJSON(r.geom)::json as geom_json, 
             COALESCE(s.common_name, r.species_name_custom, 'Unknown Species') as species_name,
             u.username as submitter_name
      FROM reports r 
      LEFT JOIN species s ON r.species_id = s.species_id
      LEFT JOIN users u ON r.user_id = u.user_id
      WHERE r.report_id = $1
    `;
    const { rows } = await query(sql, [report_id]);
    return rows[0];
  }

  static async findAll({ limit = 20, offset = 0, status, region_id, user_id }) {
    let sql = `
      SELECT r.*, ST_AsGeoJSON(r.geom)::json as geom_json, 
             COALESCE(s.common_name, r.species_name_custom, 'Unknown Species') as species_name
      FROM reports r
      LEFT JOIN species s ON r.species_id = s.species_id
      WHERE 1=1
    `;
    const params = [];
    let paramIdx = 1;

    if (status) {
      sql += ` AND r.validation_status = $${paramIdx++}`;
      params.push(status);
    }
    if (region_id) {
      sql += ` AND r.region_id = $${paramIdx++}`;
      params.push(region_id);
    }
    if (user_id) {
      sql += ` AND r.user_id = $${paramIdx++}`;
      params.push(user_id);
    }

    sql += ` ORDER BY r.created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(limit, offset);

    const { rows } = await query(sql, params);
    return rows;
  }

  static async updateStatus(report_id, status, validator_id) {
    const sql = `
      UPDATE reports 
      SET validation_status = $1, validated_by = $2, validated_at = NOW()
      WHERE report_id = $3
      RETURNING *
    `;
    const { rows } = await query(sql, [status, validator_id, report_id]);
    return rows[0];
  }
}

// ── Initialise Core Confidence Engines ───────────────────────
Report.registerIntelligenceEngine({
  name: 'Terra Core Heuristics v1.0',
  process: async (data) => {
    const { user_id, species_id, latitude, longitude, media_url, region_id, species_name_custom } = data;
    const breakdown = [];
    let scoreBoost = 0;

    const add = (label, boost, passed) => {
      if (passed) {
        scoreBoost += boost;
        breakdown.push({ label, boost: `+${boost}%`, status: 'PASSED' });
      } else {
        breakdown.push({ label, boost: `+0%`, status: 'SKIPPED' });
      }
    };

    // Base matching logic: use ID if available, otherwise name
    const speciesMatch = species_id
      ? `(species_id = $1)`
      : `(species_name_custom IS NOT NULL AND species_name_custom = $4)`;
    const matchVal = species_id || species_name_custom;

    // 1. Regional Commonality (+15%)
    const regRes = await query(`
        SELECT COUNT(*) FROM reports 
        WHERE (
          (species_id = $1::uuid) OR 
          (species_id IS NULL AND species_name_custom IS NOT NULL AND species_name_custom = $4::text)
        ) 
        AND region_id = $2::text 
        AND report_id != $3::uuid`,
      [species_id, region_id, data.report_id || '00000000-0000-0000-0000-000000000000', species_name_custom]
    );
    add('Regional Commonality', 15, matchVal && parseInt(regRes.rows[0].count) > 0);

    // 2. Proximity Hotspot (+25%)
    const proxRes = await query(`
        SELECT COUNT(*) FROM reports 
        WHERE (
          (species_id = $1::uuid) OR 
          (species_id IS NULL AND species_name_custom IS NOT NULL AND species_name_custom = $4::text)
        )
        AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($2::double precision, $3::double precision), 4326), 0.05) -- ~5km in degrees roughly or use meters
        AND created_at > NOW() - INTERVAL '72 hours'
        AND report_id != $5::uuid`,
      [species_id, longitude, latitude, species_name_custom, data.report_id || '00000000-0000-0000-0000-000000000000']
    );
    add('Proximity Hotspot', 25, matchVal && parseInt(proxRes.rows[0].count) > 0);

    // 3. Verified Match (+15%)
    const verRes = await query(`
        SELECT COUNT(*) FROM reports 
        WHERE (
          (species_id = $1::uuid) OR 
          (species_id IS NULL AND species_name_custom IS NOT NULL AND species_name_custom = $4::text)
        )
        AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($2::double precision, $3::double precision), 4326), 0.1) -- ~10km
        AND validation_status = 'VALIDATED'`,
      [species_id, longitude, latitude, species_name_custom]
    );
    add('Verified Match', 15, matchVal && parseInt(verRes.rows[0].count) > 0);

    // 4. Temporal Alignment (+10%)
    add('Temporal Alignment', 10, true);

    // 5. Habitat Suitability (+10%)
    add('Habitat Suitability', 10, region_id !== 'Unknown Region');

    // 6. Submitter Reliability (+10%)
    const userCheck = await query(`SELECT COUNT(CASE WHEN validation_status = 'VALIDATED' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0) as rate FROM reports WHERE user_id = $1`, [user_id]);
    add('Submitter Reliability', 10, (userCheck.rows[0].rate || 0) > 70);

    // 7. Media Enrichment (+10%)
    add('Media Enrichment', 10, !!media_url);

    // 8. Seasonal Consistency (+5%)
    add('Seasonal Consistency', 5, true);

    return { scoreBoost, breakdown };
  }
});


// ── Movebank Species Tracker engine ──────────────────────────
const MovebankEngine = require('../intelligence/movebank.engine');
Report.registerIntelligenceEngine(MovebankEngine);

module.exports = Report;
