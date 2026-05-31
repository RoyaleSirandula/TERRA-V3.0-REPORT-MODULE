# TERRA — Ops Console

This document covers the architecture, API contract, implementation checklist, and scaling notes for the Ops Console — the full-viewport tactical dashboard available at `#/map`.

---

## Overview

The Ops Console is a real-time command interface for field operations. It displays rangers, sensors, threats, and alerts on a tactical map. Implementation is being done in phases, one feature at a time, each backed by a real API endpoint before any frontend wiring.

---

## Phase Plan

| Phase | Feature | Backend | Frontend | Status |
|-------|---------|---------|---------|--------|
| 1 | `/api/ops/summary` — aggregated data endpoint | ✅ Done | ✅ Done | Complete |
| 2 | Frontend: replace mock data with live fetch | ✅ Done | ✅ Done | Complete |
| 3 | Polling for live refresh (30s interval) | ✅ Done | ✅ Done | **Complete** |
| 4 | Alert ACK persistence (`PATCH /api/ops/alerts/:id/ack`) | ✅ Done | ✅ Done | **Complete** |
| 5 | Sensors table + seeding | ✅ Done | ✅ Done | **Complete** |
| 6 | Action endpoints (deploy, waypoint, comms) | ✅ Done | ✅ Done | **Complete** |

---

## Phase 6 — Action Endpoints

### Migration

Run once:
```
node scripts/add_ops_actions.js
```

Creates the `ops_actions` table. Safe to re-run — uses `CREATE TABLE IF NOT EXISTS`.

### Schema

```sql
CREATE TABLE ops_actions (
    action_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type         TEXT NOT NULL
                     CHECK (type IN ('deploy', 'waypoint', 'comms', 'clear')),
    initiated_by UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    target_id    TEXT,
    payload      JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ops_actions_type         ON ops_actions (type);
CREATE INDEX idx_ops_actions_initiated_by ON ops_actions (initiated_by);
```

### New Endpoint

```
POST /api/ops/actions
Authorization: Bearer <token>   (any authenticated role)
Content-Type: application/json

Body:
{
  "type":      "deploy" | "waypoint" | "comms" | "clear",
  "target_id": "string | null",
  "payload":   { ...arbitrary } | null
}

Response 201:
{
  "action_id":  "<uuid>",
  "type":       "string",
  "target_id":  "string | null",
  "created_at": "ISO8601"
}
```

- `type` validated against the allowed set — returns 400 on invalid value.
- `target_id` is a loose string reference to the affected entity (e.g. `"threat-<uuid>"`, `"ranger-<uuid>"`).
- `payload` is optional JSONB for future structured context (coordinates, message text, etc.).

### Changes to `map.js`

| Button | Action type | Target ID |
|--------|-------------|-----------|
| Deploy team | `deploy` | `state.selectedMarkerId` |
| Mark cleared | `clear` | `state.selectedMarkerId` |
| Open comms | `comms` | `state.selectedMarkerId \|\| state.selectedRangerId` |
| Send waypoint | `waypoint` | `state.selectedMarkerId \|\| state.selectedRangerId` |

- Deploy and cleared buttons retain their existing optimistic UI (ACK + close drawer), then fire-and-forget the API call.
- Comms and waypoint buttons now have IDs (`#ops-btn-comms`, `#ops-btn-waypoint`) and bound event listeners.
- Success toast on `201`; specific error toast on network failure.
- Demo-mode `Toast.show('Action queued (demo mode)', 'info')` removed entirely.

### Implementation Checklist

#### Load-Bearing Requirements
- [x] `type` CHECK constraint enforced at DB level — invalid types can't be inserted
- [x] `initiated_by` references `users(user_id)` — every action is attributable to an authenticated user
- [x] Optimistic UI on deploy/clear — drawer closes instantly, API call is fire-and-forget
- [x] Comms and waypoint wired to real endpoint — no more dead buttons

#### Test Checklist
- [ ] Run `node scripts/add_ops_actions.js` — table and indexes created without error
- [ ] `POST /api/ops/actions` with `{ type: 'deploy', target_id: 'threat-<uuid>' }` returns 201 with `action_id`
- [ ] `POST /api/ops/actions` with invalid `type` returns 400
- [ ] `POST /api/ops/actions` without token returns 401
- [ ] "Deploy team" button: drawer closes, toast says "Team deployed", DB row inserted
- [ ] "Mark cleared" button: drawer closes, toast says "Threat marked cleared", DB row inserted
- [ ] "Open comms" button: toast says "Comms channel opened", DB row inserted
- [ ] "Send waypoint" button: toast says "Waypoint sent", DB row inserted
- [ ] Network failure on any action shows specific error toast, does not throw

#### Top Priority SE Practices Applied
- [x] **Single endpoint for all action types** — avoids proliferation of near-identical routes; `type` column drives audit trail
- [x] **Attribution on every row** — `initiated_by` means every dispatch is auditable
- [x] **Loose coupling on `target_id`** — string column accepts any entity ID format without FK constraints; allows future entity types without schema migration
- [x] **JSONB `payload`** — forward-compatible; structured extensions (coords, message) don't require new columns

---

## Phase 5 — Sensors Table

### Migration + Seed

Run once:
```
node scripts/add_sensors.js
```

Creates `sensors` table and seeds 5 initial records. Re-running is safe — seed is skipped if rows already exist.

### Schema

```sql
CREATE TABLE sensors (
    sensor_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,
    sector      TEXT,
    status      VARCHAR(20) NOT NULL DEFAULT 'online'
                    CHECK (status IN ('online', 'offline', 'degraded')),
    battery_pct INTEGER CHECK (battery_pct BETWEEN 0 AND 100),
    last_sync   TIMESTAMPTZ,
    lat         DOUBLE PRECISION,
    lng         DOUBLE PRECISION,
    region_id   UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Changes to `GET /api/ops/summary`

- `sensors` is no longer an empty array — it queries the `sensors` table.
- Ordered: online → degraded → offline, then by name.
- `battery` returned as a formatted string (`"78%"`) to match what `buildSensorsPanel` passes to `parseInt()`.
- `lastSync` formatted as `HH:MM:SS` UTC string.
- Sensors with `lat`/`lng` appear as map markers via the existing `sensorMarkers` path in `loadOpsData()`.

### Implementation Checklist

#### Load-Bearing Requirements
- [x] Seed guard (`COUNT(*) > 0` check) — migration safe to re-run without duplicating records
- [x] `status` column has a CHECK constraint — invalid values rejected at DB level
- [x] `battery` formatted server-side as `"N%"` — matches `parseInt(s.battery)` in the panel template
- [x] Sensors query runs in the same `Promise.all` as rangers and threats — no added latency

#### Test Checklist
- [ ] Run `node scripts/add_sensors.js` — table created, 5 rows seeded
- [ ] Run again — `[SKIP] Sensors already seeded` logged, no duplicate rows
- [ ] `GET /api/ops/summary` returns `sensors` array with 5 items
- [ ] Sensors panel shows all 5 sensors with correct name, type, sector, battery, status
- [ ] Camera 03 (offline) renders with alert chip and red status dot
- [ ] Sensors with lat/lng appear as markers on the Live Map
- [ ] `battery` bar width reflects correct percentage (e.g. Camera 03 at 12%)

#### Top Priority SE Practices Applied
- [x] **Single migration script per feature** — follows project convention (`add_confidence_tracking.js`, `add_alert_acks.js`)
- [x] **DB-level constraint on status** — invalid sensor states can't be inserted
- [x] **Idempotent seed** — safe to run in CI or re-run after a reset without manual cleanup

---

## Phase 4 — Alert ACK Persistence

### Migration

Run once before deploying:
```
node scripts/add_alert_acks.js
```

Creates:
```sql
CREATE TABLE IF NOT EXISTS alert_acks (
    report_id UUID NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(user_id)     ON DELETE CASCADE,
    acked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (report_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_alert_acks_user ON alert_acks (user_id);
```

### New endpoint

```
PATCH /api/ops/alerts/:id/ack
Authorization: Bearer <token>   (any authenticated role)
```

- `:id` is the frontend alert ID format: `threat-<uuid>`
- Idempotent — double-ACKing returns 200, not 409
- UUID format validated before DB query

### Changes to `GET /api/ops/summary`

Each alert in the `alerts` array now includes:
```json
{ "acked_by_me": true | false }
```

Fetched via a correlated `EXISTS` subquery — one DB round trip, no extra query.

### Changes to `map.js`

- `loadOpsData()` merges `acked_by_me` alerts into `state.ackedIds` after every fetch — ACKs survive page reload and cross-tab sessions.
- ACK button click: optimistic update (instant UI dismiss) + background `API.patch(...)`. Failure is logged as a warning; the in-session ACK is not rolled back.
- Poll tick: `state.ackedIds` is already updated by `loadOpsData()`; prune step only removes IDs for alerts that have fully aged out.

### Implementation Checklist

#### Load-Bearing Requirements
- [x] `alert_acks` primary key is `(report_id, user_id)` — one ACK per user per alert, no duplicates
- [x] `ON CONFLICT DO NOTHING` — PATCH is idempotent, safe to retry
- [x] UUID validated server-side before DB query — no injection surface
- [x] `acked_by_me` resolved via `EXISTS` — no extra query, no N+1
- [x] Optimistic UI update — ACK dismiss is instant; server persist is fire-and-forget

#### Test Checklist
- [ ] Run `node scripts/add_alert_acks.js` — `alert_acks` table and index created without error
- [ ] `PATCH /api/ops/alerts/threat-<valid-uuid>/ack` returns `{ acked: true }`
- [ ] Same PATCH called twice returns `{ acked: true }` both times (idempotent)
- [ ] `PATCH /api/ops/alerts/threat-not-a-uuid/ack` returns 400
- [ ] After ACK + page reload, alert is absent from the alerts panel (acked_by_me = true on load)
- [ ] `GET /api/ops/summary` — alerts where current user has ACKed show `acked_by_me: true`
- [ ] ACK button failure (network error) logs a warning but does not re-show the alert

#### Top Priority SE Practices Applied
- [x] **Optimistic UI** — no spinner on ACK; the action feels instant
- [x] **Idempotency** — PATCH safe to call multiple times (network retries won't corrupt state)
- [x] **Server is source of truth** — `ackedIds` is seeded from DB on every load/poll, not from localStorage

---

## Phase 3 — Polling for Live Refresh

### What changed in `map.js`

- `POLL_INTERVAL_MS = 30_000` — single constant, easy to tune.
- `_pollId` interval stored alongside `_clockId`; cleared in `destroy()` so no interval leaks on navigation.
- `_pollTick()` re-fetches `/api/ops/summary` silently. On network/server error it returns without touching the UI — the current data stays on screen.
- After each successful poll: stale `ackedIds` (for alerts that aged out of the 24h window) are pruned. If the currently-selected marker no longer exists in new data, the selection is cleared gracefully.
- `renderPage()` + `mountReticleMarkers()` called after each successful poll to reflect new data.

### Implementation Checklist

#### Load-Bearing Requirements
- [x] `_pollId` cleared in `destroy()` — no interval leak when navigating away from the Ops Console
- [x] Poll errors are silent — a transient network blip does not clear or corrupt the current display
- [x] `ackedIds` pruned after each poll — no phantom ACKs for alerts that no longer exist
- [x] Selected marker gracefully cleared if it disappears from the new dataset

#### Test Checklist
- [ ] After 30s, new threats appear on map and in alerts panel without page reload
- [ ] Acknowledged alerts that age out of the 24h window are removed from `ackedIds` on next poll
- [ ] If a selected marker is removed in new data, drawer resets to "No selection"
- [ ] Network failure during poll does not clear existing map data
- [ ] Navigating away from the Ops Console stops the poll (no background requests)
- [ ] No duplicate intervals if `render()` is called twice on the same container

#### Top Priority SE Practices Applied
- [x] **Single constant for interval** — `POLL_INTERVAL_MS` is the only place to change the cadence
- [x] **No state reset on poll** — user's active selections, acked alerts, and drawer state survive each refresh cycle
- [x] **Fail-silent on poll** — polling is a background enhancement, not a load-bearing path; errors are swallowed, not propagated

---

## Phase 1 — `/api/ops/summary`

### What it does

Single `GET` endpoint that returns all data the Ops Console needs on mount. Derived entirely from existing tables — no schema changes required.

### Route

```
GET /api/ops/summary
Authorization: Bearer <token>   (any authenticated role)
```

### Response Schema

```json
{
  "rangers": [
    {
      "id":        "ranger-<uuid>",
      "user_id":   "<uuid>",
      "name":      "string",
      "role":      "Ranger",
      "region":    "string | null",
      "team_id":   "<uuid> | null",
      "team":      "string | null",
      "status":    "idle",
      "lastPing":  null
    }
  ],
  "threats": [
    {
      "id":           "threat-<uuid>",
      "report_id":    "<uuid>",
      "kind":         "threat | caution",
      "lat":          number | null,
      "lng":          number | null,
      "label":        "string",
      "confidence":   number | null,
      "status":       "PENDING | VALIDATED | REJECTED",
      "created_at":   "ISO8601",
      "submitted_by": "string | null",
      "description":  "string | null"
    }
  ],
  "alerts": [
    {
      "id":     "threat-<uuid>",
      "kind":   "alert | warn",
      "title":  "string",
      "conf":   "string",
      "source": "string",
      "time":   "ISO8601",
      "sector": "string | null"
    }
  ],
  "sensors": []
}
```

### Data Sources

| Key | Source | Filter |
|-----|--------|--------|
| `rangers` | `users` + `roles` + `team_members` | `role.name = 'ranger'` |
| `threats` | `reports` + `species` + `users` | `sensitivity_tier IN ('HIGH','CRITICAL')` + last 24h |
| `alerts` | same rows as `threats`, reshaped | same filter |
| `sensors` | — | Empty array (Phase 5) |

### Known Limitations (Phase 1)

- `status` and `lastPing` on rangers are always `"idle"` / `null` — device telemetry not yet implemented.
- `threats.lat/lng` will be `null` for reports with no geometry.
- `sensors` is always an empty array until a `sensors` table exists.
- No real-time updates — one fetch on page load.

---

## Implementation Checklist

### Phase 1 — Backend (`/api/ops/summary`)

#### Load-Bearing Requirements
- [x] Route requires `authenticate` middleware — unauthenticated requests return 401
- [x] Uses `Promise.all` for parallel DB queries — never sequential awaits for independent queries
- [x] ST_X / ST_Y used directly in SQL — no extra geometry parsing in JS
- [x] LIMIT 50 on threats query — prevents unbounded result sets
- [x] Errors logged with `[OPS]` prefix and return 500 with generic message (no leak of SQL errors)
- [x] `sensitivity_tier` filtered as INTEGER (3, 4) — schema column is `INTEGER NOT NULL`, not a string enum
- [x] `region_id` included in SELECT — required by alerts mapping
- [x] `team_members`/`teams` subqueries removed from rangers query — tables not yet provisioned; team info re-added when Phase 5 tables exist

#### Test Checklist
- [ ] `GET /api/ops/summary` with valid token returns `{ rangers, threats, alerts, sensors }`
- [ ] `GET /api/ops/summary` without token returns 401
- [ ] `rangers` array contains only users whose role name is `'ranger'` (case-insensitive)
- [ ] `threats` array only contains reports from the last 24 hours
- [ ] `threats` array only contains `sensitivity_tier = HIGH` or `CRITICAL`
- [ ] A report with no geometry returns `lat: null, lng: null` — does not throw
- [ ] A ranger with no team membership returns `team: null, team_id: null` — does not throw
- [ ] `sensors` is always an empty array `[]`
- [ ] `alerts` length equals `threats` length (same source rows, different shape)
- [ ] Response time under 500ms with up to 1000 reports in DB

#### Top Priority SE Practices Applied
- [x] **Stable field names** — renaming any key in the response is a breaking change; treat schema as a contract
- [x] **No raw error exposure** — SQL errors are logged server-side, never returned to client
- [x] **Parallel queries** — `Promise.all` prevents waterfall latency
- [x] **Explicit LIMIT** — all queries that could return unbounded rows are capped
- [x] **Auth at router level** — `router.use(authenticate)` covers all future routes in this file automatically

---

## Phase 2 — Frontend Data Loading (Next)

Replaces the `MARKERS`, `ALL_ALERTS`, `RANGERS`, `SENSORS` mock arrays in `public/js/pages/map.js` with a single `loadOpsData()` fetch to `/api/ops/summary` on page mount.

### What changes in `map.js`

- Add `loadOpsData()` async function that calls `API.get('/ops/summary')`
- Call it in `render()` before `buildMap()` runs
- Map `rangers` → `RANGERS` shape, `threats` → subset of `MARKERS`, `alerts` → `ALL_ALERTS`
- Show a loading state in the topbar strip while fetch is in flight
- On fetch error, display a console error and fall back to empty arrays (graceful degradation)

### What changed in `map.js`

- `MARKERS`, `ALL_ALERTS`, `RANGERS`, `SENSORS` converted from `const` arrays to mutable `let` arrays, initialized empty.
- `COMMAND_MARKERS` stays hardcoded — command base is fixed infrastructure, not from the DB.
- `MAP_BOUNDS` constant defines the lat/lng extent of the tactical map canvas.
- `latLngToXY(lat, lng)` converts geographic coordinates to `x`/`y` percentages for marker placement. Clamps to `[5, 93]` so markers never clip outside the canvas edge.
- `_statusLabel(status)` maps API status strings to human-readable chip labels.
- `loadOpsData()` calls `GET /api/ops/summary` and hydrates all four arrays. Rangers appear on the map only when they have a non-null `lat`/`lng` (device telemetry, Phase 3+).
- `_bootstrapOps(container)` orchestrates: show loading screen → fetch → on success render page; on failure show error screen with retry button.
- `render()` is now synchronous but immediately delegates to `_bootstrapOps()`. Auto-selects the first threat as the initial drawer entity once data loads.
- Initial state defaults (`selectedMarkerId`, `selectedAlertId`, `callout`) are `null` — no longer hardcoded to `'threat-1'`.

---

## Phase 2 — Frontend Data Loading

### Implementation Checklist

#### Load-Bearing Requirements
- [x] `loadOpsData()` is the only place that writes to `MARKERS`, `ALL_ALERTS`, `RANGERS`, `SENSORS` — no other code mutates these
- [x] `render()` never blocks the event loop — loading screen appears immediately, data loads asynchronously
- [x] Retry button in error screen calls `_bootstrapOps()` — same path as initial mount, no special-case logic
- [x] `latLngToXY` clamps output to `[5, 93]` — markers with extreme coordinates never clip outside the canvas
- [x] Rangers with `lat: null` are in the Roster panel but not on the map — no null-coordinate markers
- [x] `COMMAND_MARKERS` always present in `MARKERS` after load — base is never absent from the map

#### Test Checklist
- [ ] On mount, loading screen appears immediately before fetch resolves
- [ ] After successful fetch, loading screen is replaced by full ops console
- [ ] Roster panel lists all Ranger-role users returned by API
- [ ] Threat markers appear on map for every threat with non-null lat/lng
- [ ] Threats with null lat/lng appear in Alerts panel but NOT as map markers
- [ ] Command base marker always present on map regardless of API response
- [ ] On fetch failure, error screen is shown with a Retry button
- [ ] Retry button triggers a fresh fetch and re-renders on success
- [ ] First threat auto-selected in drawer after load (if threats exist)
- [ ] Drawer shows "No selection" when no threats returned by API
- [ ] Sensors panel shows empty list when API returns `sensors: []`
- [ ] `latLngToXY` places markers inside the visible canvas for coordinates within MAP_BOUNDS

#### Top Priority SE Practices Applied
- [x] **Single write path** — data hydration happens exclusively in `loadOpsData()`, never scattered across render functions
- [x] **Graceful degradation** — empty arrays are valid state; all panels render correctly with zero items
- [x] **No stale defaults** — initial state `selectedMarkerId: null` prevents stale marker references before data loads
- [x] **Error boundary** — `renderLoadError()` catches all fetch failures; never throws uncaught promise rejections to the console

---

## Future Scaling Notes

- **Real-time transport:** When Phase 3 arrives, add `GET /api/ops/events` as a Server-Sent Events stream. The REST summary endpoint stays as the initial hydration payload; SSE delivers diffs.
- **Sensors table:** When hardware sensors are onboarded, create a `sensors` table with `sensor_id`, `type`, `lat`, `lng`, `battery_pct`, `last_sync`, `status`. The `/api/ops/summary` endpoint already returns `sensors: []` so the frontend contract doesn't change.
- **Action endpoints:** Deploy, waypoint, comms will each be separate `POST /api/ops/actions/:type` routes. Keep them separate from summary — command endpoints have different auth requirements (Analyst/Admin only).
- **Team-scoped filtering:** Add `?team_id=` query param to `/api/ops/summary` to scope rangers and alerts by team. No schema change needed — just an additional `WHERE` clause.

---

*Last updated: 2026-05-31 — All phases (1–6) complete.*
