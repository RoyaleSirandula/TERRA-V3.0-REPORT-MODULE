# TERRA — Operator Management: Field Assets

Field asset location management for the Ops Console. Admins can set and update coordinates for command bases, sensors, and rangers without touching code. Sensor and ranger devices can auto-update their own positions via authenticated ping endpoints.

---

## Overview

| Asset class | Storage | Manual edit | Auto-update |
|-------------|---------|-------------|-------------|
| Command bases | `command_bases` table | Admin PATCH | N/A (fixed infrastructure) |
| Sensors | `sensors` table (existing) | Admin PATCH | `POST /api/operator/sensors/:id/ping` |
| Rangers | `users.home_lat/lng` + `users.last_lat/lng` | Admin PATCH (home) | `POST /api/operator/rangers/:id/ping` |

Command bases appear on the Ops Console map fetched from DB — the former hardcoded `COMMAND_MARKERS` array is gone.

---

## Migrations

Run in order, once each:

```
node scripts/add_command_bases.js
node scripts/add_ranger_location.js
```

### `command_bases` schema

```sql
CREATE TABLE command_bases (
    base_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    lat        DOUBLE PRECISION NOT NULL,
    lng        DOUBLE PRECISION NOT NULL,
    sector     TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Seeded with `Base Karoo` at the previously hardcoded coordinates (-1.3180, 36.8950).

### `users` additions

```sql
ALTER TABLE users
    ADD COLUMN home_lat  DOUBLE PRECISION,
    ADD COLUMN home_lng  DOUBLE PRECISION,
    ADD COLUMN last_lat  DOUBLE PRECISION,
    ADD COLUMN last_lng  DOUBLE PRECISION,
    ADD COLUMN last_ping TIMESTAMPTZ;
```

- `home_lat/home_lng` — admin-assigned static post position
- `last_lat/last_lng` — most recent device ping (auto-updated)
- `last_ping` — timestamp of last ping; used to derive `active` vs `idle` status

---

## API

### `GET /api/operator/assets`

Returns all three asset classes for the management UI. Any authenticated role.

```json
{
  "command_bases": [{ "base_id", "name", "lat", "lng", "sector", "updated_at" }],
  "sensors":       [{ "sensor_id", "name", "type", "sector", "status", "battery_pct", "lat", "lng", "last_sync" }],
  "rangers":       [{ "user_id", "username", "email", "home_lat", "home_lng", "last_lat", "last_lng", "last_ping", "role_name" }]
}
```

### `POST /api/operator/command-bases` — Admin

Body: `{ name, lat, lng, sector? }` → 201 with created record.

### `PATCH /api/operator/command-bases/:id` — Admin

Body: any subset of `{ name, lat, lng, sector }` → updated record.

### `DELETE /api/operator/command-bases/:id` — Admin

→ `{ deleted: true, base_id }`.

### `PATCH /api/operator/sensors/:id` — Admin

Body: any subset of `{ name, type, lat, lng, sector, status }`.
`status` validated against `online | offline | degraded`.

### `POST /api/operator/sensors/:id/ping` — Any auth

Body: `{ lat, lng, battery_pct?, status? }`. Updates `lat`, `lng`, `last_sync`, and optionally `battery_pct`/`status`. Called by sensor hardware or gateway.

### `PATCH /api/operator/rangers/:id/home` — Admin

Body: `{ home_lat, home_lng }`. Sets the fallback static position for a ranger.

### `POST /api/operator/rangers/:id/ping` — Any auth

Body: `{ lat, lng }`. Updates `last_lat`, `last_lng`, `last_ping`. Called by ranger mobile app or GPS unit.

---

## `GET /api/ops/summary` changes

- `command_bases` added to response — array of `{ id, base_id, kind: 'command', label, lat, lng, sector }`.
- `rangers` now include `lat`, `lng` (live position or home fallback), `home_lat`, `home_lng`, `lastPing`, and `status: 'active' | 'idle'`.

---

## Frontend — Operator Management (users.js)

A **Field Assets** tab is added alongside the existing **Operators** tab below the hero section. Tab state is held in `_activeTab` — switching is instant (show/hide), no re-fetch.

### Command Bases panel

| Column | Editable |
|--------|----------|
| Name | ✅ |
| Latitude | ✅ |
| Longitude | ✅ |
| Sector | ✅ |

Actions: **EDIT** (modal), **DELETE** (confirm dialog).
"+ ADD BASE" button opens a create modal.

### Sensors panel

| Column | Editable |
|--------|----------|
| Name | ✅ |
| Type | ✅ |
| Sector | ✅ |
| Latitude | ✅ |
| Longitude | ✅ |
| Status | read-only here (updated by device ping) |

Action: **EDIT** (modal).

### Rangers — Home Positions panel

| Column | Editable |
|--------|----------|
| Handle | read-only |
| Home Lat | ✅ via SET HOME |
| Home Lng | ✅ via SET HOME |
| Last Live Ping | read-only |

Action: **SET HOME** (modal). Explains that home is the fallback when no live ping exists.

### map.js changes

- `COMMAND_MARKERS` converted from `const` to `let`, populated from `data.command_bases` in `loadOpsData()`.
- `RANGERS` array now carries `lat`, `lng`, `home_lat`, `home_lng` from the API — rangers with positions appear as map markers.

---

## Implementation Checklist

### Load-Bearing Requirements
- [x] `requireAdmin` middleware checks `manage_users` permission at DB level — not trust-the-client role checks
- [x] Sensor status validated against allowed set before DB write — CHECK constraint also enforced at DB level
- [x] Ranger location uses `last_lat ?? home_lat` fallback in summary — live position takes priority
- [x] `updated_at = NOW()` set on every command base PATCH — audit trail in DB
- [x] `COMMAND_MARKERS` no longer hardcoded — map always reflects DB state after migration

### Test Checklist
- [ ] Run both migrations — no errors, command_bases has 1 row (Base Karoo)
- [ ] `GET /api/operator/assets` returns all three arrays
- [ ] `POST /api/operator/command-bases` creates a base; it appears on Ops Console map after next load/poll
- [ ] `PATCH /api/operator/command-bases/:id` updates coordinates; reflected in map on reload
- [ ] `DELETE /api/operator/command-bases/:id` removes base; gone from map on reload
- [ ] `PATCH /api/operator/sensors/:id` updates sensor lat/lng; reflected in Sensors panel and map
- [ ] `POST /api/operator/sensors/:id/ping` updates position without admin token
- [ ] `PATCH /api/operator/rangers/:id/home` sets home position; ranger appears on map (if previously invisible)
- [ ] `POST /api/operator/rangers/:id/ping` updates last_lat/lng/ping; ranger status becomes 'active'
- [ ] Admin-only endpoints return 403 for non-admin tokens
- [ ] Operator Management page shows OPERATORS and FIELD ASSETS tabs
- [ ] Field Assets tab loads all three panels with correct data
- [ ] Edit modals pre-populate current values
- [ ] Validation: missing lat/lng in modal shows error, does not close modal

### Top Priority SE Practices Applied
- [x] **DB-level auth check** — `requireAdmin` queries the permissions table, not a client-supplied role claim
- [x] **Live-over-home fallback in SQL mapping** — `??` operator in JS, consistent with how it'll work when telemetry is live
- [x] **Single assets endpoint** — one fetch loads all three panels; no waterfall on tab open
- [x] **Idempotent migrations** — `IF NOT EXISTS` and seed guard on all scripts

---

*Last updated: 2026-05-31 — Backend + Frontend complete. Migrations required before testing.*
