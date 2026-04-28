'use strict';

// Movebank intelligence engine.
// At report-creation time, searches Movebank for known studies tracking this species.
// Finding active studies near the report region gives a moderate confidence boost —
// it means the species has documented movement patterns in science literature.
//
// This call is best-effort: a 5-second timeout prevents slow report creation.
// If credentials are absent or the call fails, it skips silently.

const TIMEOUT_MS = 5_000;

module.exports = {
    name: 'Movebank Species Tracker v1.0',

    process: async (data) => {
        const { species_name_custom } = data;

        // Skip if no species name to search with
        const taxon = (species_name_custom || '').trim();
        if (!taxon) {
            return { scoreBoost: 0, breakdown: [] };
        }

        const breakdown = [];
        let scoreBoost  = 0;

        try {
            // Lazy-require to avoid loading at startup before env is ready
            const Movebank = require('../utils/movebank.service');

            const studies = await Promise.race([
                Movebank.searchStudies({ taxon }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)
                ),
            ]);

            if (studies && studies.length > 0) {
                scoreBoost += 10;
                const n = studies.length;
                breakdown.push({
                    label:  `Movebank Tracked Species (${n} stud${n === 1 ? 'y' : 'ies'})`,
                    boost:  '+10%',
                    status: 'PASSED',
                });
            } else {
                breakdown.push({
                    label:  'Movebank Tracked Species',
                    boost:  '+0%',
                    status: 'SKIPPED',
                });
            }
        } catch (err) {
            if (err.message !== 'timeout') {
                console.warn('[Movebank Engine] Soft error (non-blocking):', err.message);
            }
            breakdown.push({
                label:  'Movebank Tracked Species',
                boost:  '+0%',
                status: 'SKIPPED',
            });
        }

        return { scoreBoost, breakdown };
    },
};
