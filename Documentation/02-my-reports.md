# TERRA — My Reports Page
**Phase 2 | Files: `public/js/pages/reports.js`, `src/controllers/reportController.js`**

---

## Overview

The My Reports page shows a user's own submitted reports. The core requirement is that **every role sees only their own submissions** in this view, regardless of what other pages they can access.

There are two independent enforcement points: the backend controller (prevents API-level bypass) and the frontend query param (communicates intent).

---

## How It Works

### Frontend: `loadReports('my-reports')`

**File:** `public/js/pages/reports.js`

**What it does:** Fetches `/api/reports?mine=true` when the mode is `my-reports`. This passes the scoping intent explicitly rather than relying on the backend to infer it from the mode.

```javascript
if (mode === 'my-reports') params = '?mine=true';
```

**Why `?mine=true` instead of relying on role:** Rangers, Analysts, and Admins all have permission to view other users' reports on other pages (Pending Queue, Validated). Without `mine=true`, the backend would return all reports for these roles. The `mine=true` param makes My Reports behave identically regardless of role — always own submissions.

**Works fully:** Yes. Replaces the previous approach that used `?status=PENDING` / empty-string logic, which did not scope My Reports for elevated roles.

---

### Backend: Gate A — Community Tier Hard Scope

**File:** `src/controllers/reportController.js` → `getReports()`

**What it does:** Checks whether the user has `view_own_reports` permission but *not* `view_pending_reports`. This combination identifies Community accounts. When true, `filters.user_id` is always set to the current user regardless of any query params.

```javascript
const isCommunityTier = req.user.permissions.includes('view_own_reports')
    && !req.user.permissions.includes('view_pending_reports');

if (isCommunityTier || mine === 'true') {
    filters.user_id = req.user.user_id;
}
```

**Why two gates:** The Community gate (Gate A) means a Community user cannot see other reports even if they call `/api/reports` directly without the `mine=true` param. The `mine=true` gate (Gate B) handles the elevated-role case from the frontend. Both gates write to the same `filters.user_id` field — the same WHERE clause is applied either way.

**Works fully:** Yes. The `Report.findAll(filters)` function in `src/models/Report.js` reads `filters.user_id` and adds `WHERE user_id = $n` when set.

---

### Backend: Gate B — `mine=true` Param

**File:** `src/controllers/reportController.js` → `getReports()`

**What it does:** When `req.query.mine === 'true'`, sets `filters.user_id = req.user.user_id` regardless of role. This is the mechanism the My Reports page uses to ensure Rangers and Analysts also see only their own submissions.

**Works fully:** Yes.

---

## Stats Scoping

**File:** `src/controllers/reportController.js` → `getStats()`

The stats endpoint (`GET /api/reports/stats`) applies the same Community-tier filter — Community users only see statistics derived from their own reports. This ensures the Dashboard stat cards are consistent with what My Reports shows.

**Works fully:** Yes. The Community tier check mirrors the one in `getReports()`.

---

## Sidebar Navigation

**File:** `public/js/components/sidebar.js`

The "My Reports" nav item is gated by `permission: 'view_own_reports'`, which all roles hold. It is always visible to logged-in users.

The "Pending Queue" item is gated by `permission: 'view_pending_reports'` — Community accounts do not see this in the sidebar.

**Works fully:** Yes. No changes were needed to the sidebar for this phase.

---

## Table Columns

| Column | Notes |
|---|---|
| Species | Common name from registry or free-text custom name |
| Region | `region_id` (text field in current schema) |
| Tier | `sensitivity_tier` badge (1–4) |
| Date | `created_at` formatted via `toLocaleDateString()` |
| Confidence | `ai_confidence_score` displayed as a branded percentage badge |
| Status | PENDING / VALIDATED / REJECTED badge |
| Actions | View button (all modes); Validate/Reject buttons (pending mode, permission-gated) |

---

## Limitations

- The `region_id` column currently stores a UUID or a text label depending on how the report was submitted. The display falls back to the raw value. A future improvement would join to a `regions` table for human-readable names.
- Pagination is not yet implemented — the endpoint accepts `limit` and `offset` params but the UI does not pass them. The default `LIMIT` in `Report.findAll` caps the result set.
