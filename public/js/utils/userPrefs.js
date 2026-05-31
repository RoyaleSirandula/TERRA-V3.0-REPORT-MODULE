/* ============================================================
   TERRA – userPrefs.js
   Persistent user display preferences: theme and font size.

   Stored as a single JSON object in localStorage under PREFS_KEY.
   `applyAll()` must be called once on boot (before first render)
   so that the correct classes / attributes are in place before
   any CSS is evaluated.

   Dispatches 'terra:prefschange' on window whenever a value is
   written, so other modules can react without polling.

   Replaces the ad-hoc THEME_KEY logic that was previously split
   across topbar.js.

   Public API:
     UserPrefs.get(key)         → current value (falls back to default)
     UserPrefs.set(key, value)  → persist + apply immediately
     UserPrefs.getAll()         → full prefs object (copy)
     UserPrefs.applyAll()       → re-apply every stored pref to DOM
   ============================================================ */

const UserPrefs = (() => {

    const PREFS_KEY = 'terra_prefs';

    /**
     * Valid values per key.
     * Keeping this explicit prevents stale/garbage values from
     * localStorage from being applied to the DOM.
     */
    const SCHEMA = {
        theme:    { values: ['dark', 'light'],              default: 'dark'   },
        fontSize: { values: ['normal', 'large', 'xlarge'],  default: 'normal' },
    };

    /* ── Storage helpers ─────────────────────────────────────── */

    function _load() {
        try {
            const raw = localStorage.getItem(PREFS_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch {
            return {};
        }
    }

    function _save(prefs) {
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
        } catch {
            /* Quota exceeded or private-browsing restriction — silent. */
        }
    }

    /* ── DOM applicators ─────────────────────────────────────── */

    /**
     * Applies a single preference key/value pair to the DOM.
     * All DOM mutations for a given key are isolated here so
     * there is one authoritative place to change the mechanism.
     */
    function _applyOne(key, value) {
        if (key === 'theme') {
            document.body.classList.toggle('light', value === 'light');
        } else if (key === 'fontSize') {
            const html = document.documentElement;
            if (value === 'normal') {
                html.removeAttribute('data-font-size');
            } else {
                html.setAttribute('data-font-size', value);
            }
        }
    }

    /* ── Public API ──────────────────────────────────────────── */

    /**
     * Returns the stored value for `key`, or the schema default
     * if the stored value is missing or outside the allowed set.
     * @param {string} key
     * @returns {string}
     */
    function get(key) {
        const schema = SCHEMA[key];
        if (!schema) return undefined;
        const stored = _load()[key];
        return schema.values.includes(stored) ? stored : schema.default;
    }

    /**
     * Persists a new value for `key` and applies it immediately.
     * Silently ignores values that are not in the allowed set.
     * @param {string} key
     * @param {string} value
     */
    function set(key, value) {
        const schema = SCHEMA[key];
        if (!schema || !schema.values.includes(value)) return;

        const prefs  = _load();
        prefs[key]   = value;
        _save(prefs);
        _applyOne(key, value);

        window.dispatchEvent(
            new CustomEvent('terra:prefschange', { detail: { key, value } })
        );
    }

    /**
     * Returns a shallow copy of the full prefs object, with every
     * key resolved to a valid value (defaults filled in).
     * @returns {{ theme: string, fontSize: string }}
     */
    function getAll() {
        const result = {};
        for (const key of Object.keys(SCHEMA)) {
            result[key] = get(key);
        }
        return result;
    }

    /**
     * Re-applies every stored preference to the DOM.
     * Call once on boot, before the first render, so that CSS
     * classes and attributes are stable before paint.
     */
    function applyAll() {
        const prefs = getAll();
        for (const [key, value] of Object.entries(prefs)) {
            _applyOne(key, value);
        }
    }

    return Object.freeze({ get, set, getAll, applyAll });

})();
