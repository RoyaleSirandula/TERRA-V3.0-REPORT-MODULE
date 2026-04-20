# TERRA — Capabilities System
**Phase 1 | File: `src/utils/capabilities.js` + `public/js/utils/auth.js`**

---

## Overview

The capabilities system is the single source of truth for what each role can do in TERRA. No other file in the application branches on raw role strings — all access decisions consult a structured capability object produced by this module.

This pattern (sometimes called "capabilities-as-data") makes it safe to add or rename roles without hunting for `if (role === 'RANGER')` checks scattered across routes and components.

---

## Architecture

```
DB roles table (COMMUNITY / RANGER / ANALYST / ADMIN)
         │
         ▼
buildCapabilities(role_name)         ← src/utils/capabilities.js
         │
         ├─► requireCap(capPath)     ← Express middleware (server enforcement)
         │
         └─► Auth.getCaps() / Auth.can(capPath)   ← client rendering hints
```

The server **always** enforces the real gates. The client-side copy is **only for rendering hints** — deciding which panels to mount, not which panels to hide.

---

## Capability Matrix

| Capability Path | COMMUNITY | RANGER | ANALYST | ADMIN |
|---|---|---|---|---|
| `siteAnalysis.mode` | `restricted` | `full` | `full` | `full` |
| `siteAnalysis.allowedBasemaps` | `[satellite]` | `[satellite, aesthetic]` | `[satellite, aesthetic]` | `[satellite, aesthetic]` |
| `siteAnalysis.ownReportsOnly` | `true` | `false` | `false` | `false` |
| `siteAnalysis.geeAccess` | `false` | `true` | `true` | `true` |
| `siteAnalysis.drawingTools` | `false` | `true` | `true` | `true` |
| `siteAnalysis.waterLayer` | `false` | `true` | `true` | `true` |
| `siteAnalysis.bufferAnalysis` | `false` | `true` | `true` | `true` |
| `siteAnalysis.ndviAnalysis` | `false` | `true` | `true` | `true` |
| `siteAnalysis.timelineControl` | `false` | `true` | `true` | `true` |
| `siteAnalysis.gridResolution` | `false` | `true` | `true` | `true` |
| `myReports.scope` | `own` | `all` | `all` | `all` |
| `sharing.canShare` | `false` | `true` | `true` | `true` |
| `sharing.canReceive` | `false` | `true` | `true` | `true` |
| `sharing.canForward` | `false` | `false` | `true` | `true` |
| `teams.canJoin` | `false` | `true` | `true` | `true` |
| `teams.canCreate` | `false` | `false` | `true` | `true` |
| `teams.canManage` | `false` | `false` | `false` | `true` |
| `administration` | `false` | `false` | `false` | `true` |

---

## Server-Side Functions

### `buildCapabilities(role_name)`

**File:** `src/utils/capabilities.js`

**What it does:** Normalises `role_name` to uppercase and returns the matching capability object from `CAPABILITY_MATRIX`. Falls back to `COMMUNITY` (most restrictive) for unknown roles, applying least-privilege by default.

**Parameters:**
- `role_name` — string, the `role_name` column from the `users` table join.

**Returns:** An object matching the structure in the matrix above.

**Called from:** `requireCap()` middleware, `GET /api/auth/me/capabilities` endpoint.

**Works fully:** Yes. Covers all four current roles. Adding a new role requires only a new key in `CAPABILITY_MATRIX` — no other files need changing.

---

### `requireCap(capPath)`

**File:** `src/utils/capabilities.js`

**What it does:** An Express middleware factory. Reads `req.user.role_name`, builds their capability object, then traverses the dot-path (e.g. `'siteAnalysis.geeAccess'`) to check if the value is truthy. Returns HTTP 403 with a structured error body if not:

```json
{
  "error": "Forbidden: Insufficient tier access",
  "code": "TIER_RESTRICTED",
  "requiredCap": "siteAnalysis.geeAccess",
  "userRole": "COMMUNITY"
}
```

The `code: 'TIER_RESTRICTED'` field allows the frontend to show an upgrade prompt rather than a generic error toast.

**Usage:**
```javascript
router.post('/buffer', authenticate, requireCap('siteAnalysis.bufferAnalysis'), handler);
router.post('/gee/mapid', authenticate, requireCap('siteAnalysis.geeAccess'), handler);
```

**Works fully:** Yes. Applied to:
- `POST /api/analysis/ndvi-zonal` — requires `siteAnalysis.ndviAnalysis`
- `POST /api/analysis/buffer` — requires `siteAnalysis.bufferAnalysis`
- All `/api/gee/*` endpoints — requires `siteAnalysis.geeAccess` (router-level middleware)
- `POST /api/shares` — requires `sharing.canShare`
- `POST /api/teams/:id/posts` — requires `sharing.canShare`
- `POST /api/teams` — requires `teams.canCreate`

---

## Client-Side Functions

### `Auth.getCaps()`

**File:** `public/js/utils/auth.js`

**What it does:** Returns the capability object for the currently logged-in user by reading `role_name` from `sessionStorage` and matching it against a client-side copy of `CAPABILITY_MATRIX`. Falls back to `COMMUNITY`.

**Returns:** Capability object (same structure as server-side matrix).

**Called from:** `Auth.can()`, `SiteAnalysisPage.render()`.

**Works fully:** Yes. The client-side matrix is a direct copy of the server-side one. These must be kept in sync if the matrix changes — the server copy is authoritative.

---

### `Auth.can(capPath)`

**File:** `public/js/utils/auth.js`

**What it does:** Checks a dot-path capability for the current user.

```javascript
Auth.can('siteAnalysis.geeAccess')    // → false for COMMUNITY
Auth.can('sharing.canShare')          // → true for RANGER+
Auth.can('teams.canCreate')           // → true for ANALYST+
```

**Returns:** `boolean`.

**Works fully:** Yes. Used in `SiteAnalysisPage.render()` to set `_isCommunityRestricted`, which gates all UI panel rendering.

---

## API Endpoint

### `GET /api/auth/me/capabilities`

**File:** `src/routes/authRoutes.js`

**What it does:** Returns the full capability object for the authenticated user's role.

**Response:**
```json
{
  "role": "RANGER",
  "capabilities": { "siteAnalysis": { ... }, "sharing": { ... }, ... }
}
```

**Works fully:** Yes. Requires a valid session token. Intended for use after login if the client needs to refresh capabilities without logging out.

---

## Adding a New Capability

1. Add the key to every role block in `CAPABILITY_MATRIX` in `src/utils/capabilities.js`.
2. Mirror it in the client-side `MATRIX` inside `Auth.getCaps()` in `public/js/utils/auth.js`.
3. Add `requireCap('section.newKey')` to the relevant route.
4. Add `Auth.can('section.newKey')` to the relevant UI component.

No other files need to change.
