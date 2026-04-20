# TERRA — Site Analysis Access Control
**Phase 3 | Files: `public/js/pages/siteAnalysis.js`, `src/routes/analysisRoutes.js`, `src/routes/gee.routes.js`, `public/css/siteAnalysis.css`**

---

## Overview

Site Analysis is a full geospatial analysis environment. Community accounts have a restricted view: satellite basemap only, own reports only, no GEE layers, no drawing tools, no buffer or NDVI analysis. Rangers, Analysts, and Admins have the full toolset.

There are three enforcement layers: backend API gates, client capability check, and UI panel conditional rendering. All three are active simultaneously — the backend gates ensure no direct API bypass is possible even if the client restriction is bypassed.

---

## Enforcement Layers

### Layer 1 — Backend API Gates

**Files:** `src/routes/analysisRoutes.js`, `src/routes/gee.routes.js`

| Endpoint | Gate |
|---|---|
| `GET /api/analysis/sightings` | Automatically scopes to `WHERE user_id = current_user` when `caps.siteAnalysis.ownReportsOnly` is true (Community). No `requireCap` needed — all roles may call the sightings endpoint, but the query is silently scoped. |
| `POST /api/analysis/ndvi-zonal` | `requireCap('siteAnalysis.ndviAnalysis')` — Community receives 403 |
| `POST /api/analysis/buffer` | `requireCap('siteAnalysis.bufferAnalysis')` — Community receives 403 |
| All `POST /api/gee/*` | `requireCap('siteAnalysis.geeAccess')` — applied as router-level middleware, Community receives 403 on any GEE call |

**Works fully:** Yes. The `requireCap` middleware returns:
```json
{ "error": "Forbidden: Insufficient tier access", "code": "TIER_RESTRICTED", "requiredCap": "..." }
```
The `code` field allows the frontend to distinguish a tier restriction from a server error.

---

### Layer 2 — Client Capability Check

**File:** `public/js/pages/siteAnalysis.js`

**What it does:** At the top of `render()`, sets the module-level flag `_isCommunityRestricted`:

```javascript
_isCommunityRestricted = !Auth.can('siteAnalysis.geeAccess');
```

`geeAccess` is `false` only for COMMUNITY, making this a clean proxy for the full restriction state. All subsequent rendering decisions read this flag.

**Works fully:** Yes. The flag is re-evaluated on every `render()` call, so it stays current if a user's role is changed server-side (requires re-login to take effect, since capabilities are derived from the session token's role).

---

### Layer 3 — UI Panel Conditional Rendering

**File:** `public/js/pages/siteAnalysis.js`

All UI restrictions are implemented as conditional template literals — the restricted HTML is **not mounted at all**, not merely hidden. This prevents any CSS-override bypass.

#### 3a. Basemap Lock

When `_isCommunityRestricted`:
- The "Minimal" basemap radio button is not rendered.
- The "Satellite" radio is pre-checked and marked `disabled`.
- `_activeMode` is forced to `'satellite'` before any session restore logic runs.

#### 3b. GEE Section

When `_isCommunityRestricted`, the entire GEE item list is replaced by a `.sa-tier-lock` placeholder:

```html
<div class="sa-tier-lock">
  <div class="sa-tier-lock__icon">◈</div>
  <div class="sa-tier-lock__text">Environmental Intelligence layers require Ranger tier or above.</div>
</div>
```

When not restricted, the full 8-item GEE checklist is rendered as before.

#### 3c. Dock Tabs

When `_isCommunityRestricted`, the BUFFER, RESULTS, and TIME tabs are not rendered. Only the LAYERS tab is present. This prevents Community users from accessing the Buffer / Proximity panel and Analysis Results panel.

#### 3d. Restriction Banner

A `.sa-tier-banner` strip is rendered directly below the map header for Community users:

> "Community view — showing your reports in satellite mode only. Upgrade to Ranger for full analytical tools."

This is non-dismissable and spans the full map width.

---

### Sightings Data Scoping

**File:** `public/js/pages/siteAnalysis.js` → `loadData()`

When `_isCommunityRestricted`, the sightings API is called with `?own_only=true`:

```javascript
const ownOnly = _isCommunityRestricted ? '?own_only=true' : '';
_reports = await API.get(`/analysis/sightings${ownOnly}`);
```

The backend also enforces this independently via `caps.siteAnalysis.ownReportsOnly`.

**Works fully:** Yes. Community accounts see only their own validated sightings as map pins. The stat panel (Active Points, Sector Density, Total Records) reflects only this scoped data.

---

## CSS — Restriction UI

**File:** `public/css/siteAnalysis.css`

| Class | Purpose |
|---|---|
| `.sa-tier-banner` | Full-width info strip below map header, dark background, mono font, brand-lime icon |
| `.sa-tier-banner__icon` | The `◈` glyph, brand-lime, flex-shrink: 0 |
| `.sa-tier-lock` | Dashed-border placeholder block inside the Layers panel GEE section |
| `.sa-tier-lock__icon` | Large muted glyph |
| `.sa-tier-lock__text` | Mono, dim colour, small font, 1.5 line-height |

**Works fully:** Yes. Both elements follow the existing TERRA design tokens (`--clr-brand`, `--clr-text-dim`, `--font-mono`, `--clr-surface-2`).

---

## What Community Accounts Can Do in Site Analysis

- Open sessions dashboard (no restrictions)
- Start a new map session
- View a satellite basemap
- See their own validated sightings as map pins (tooltips with species + date)
- Save and restore sessions
- See the stat panel (values reflect own-reports-only data)

## What Community Accounts Cannot Do

- Switch basemap to Minimal
- Enable any GEE layer
- Open the Buffer / Proximity panel
- Run buffer analysis
- Run NDVI zonal analysis
- Draw polygons, lines, or markers
- Use the temporal playback timeline
- Change grid resolution

---

## Limitations

- Drawing tools (`L.Draw`) are still initialised for Community but no tabs to trigger them are shown. A future improvement would skip initialising `L.Draw` entirely for Community to avoid loading unused code.
- Session restore for a Community-saved session will always force satellite mode even if the session had a different mode stored — this is intentional.
