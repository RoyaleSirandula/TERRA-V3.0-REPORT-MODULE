# TERRA — Report Sharing (Direct / Person-to-Person)
**Phase 4 | Files: `src/routes/sharingRoutes.js`, `scripts/add_collaboration_schema.js`**

---

## Overview

Allows Rangers, Analysts, and Admins to share individual reports directly with named colleagues. The sender picks a report, selects a recipient by user ID, adds an optional field note, and creates a share. The recipient sees it in their inbox and receives a notification.

This is Phase 4 of the collaboration system. Phase 5 (Teams) adds group broadcast sharing on top of this foundation.

---

## Who Can Share

| Role | Can Send | Can Receive | Can Forward |
|---|---|---|---|
| COMMUNITY | No | No | No |
| RANGER | Yes — own reports only | Yes | No |
| ANALYST | Yes — any report | Yes | Yes (planned) |
| ADMIN | Yes — any report | Yes | Yes (planned) |

The server enforces these rules independently of the frontend.

---

## Database Schema

### `report_shares`

| Column | Type | Notes |
|---|---|---|
| `share_id` | UUID PK | Auto-generated |
| `report_id` | UUID FK → reports | Cascades on delete |
| `shared_by` | UUID FK → users | Cascades on delete |
| `shared_to` | UUID FK → users | Cascades on delete |
| `note` | TEXT | Optional field note from sender |
| `shared_at` | TIMESTAMPTZ | Set to NOW() on insert |
| `expires_at` | TIMESTAMPTZ | Nullable — null = permanent |
| `read_at` | TIMESTAMPTZ | Nullable — null = unread |
| CHECK | — | `shared_by <> shared_to` prevents self-shares |

Indexed on `shared_to` (inbox queries) and `shared_by` (outbox queries).

### `share_audit_log`

Immutable append-only table. Every share action (CREATED, READ, REVOKED) is written here. The `share_id` reference uses `ON DELETE SET NULL` so the audit history persists even if a share record is deleted by cascade.

| Column | Type | Notes |
|---|---|---|
| `log_id` | UUID PK | Auto-generated |
| `share_id` | UUID FK → report_shares (SET NULL) | Nullable after cascade delete |
| `action` | VARCHAR(20) | `CREATED` / `READ` / `REVOKED` |
| `actor_id` | UUID FK → users (SET NULL) | Who performed the action |
| `logged_at` | TIMESTAMPTZ | Immutable timestamp |
| `detail` | JSONB | Extra context (to_user_id, report_id, etc.) |

---

## API Endpoints

### `POST /api/shares` — Create a share

**Requires:** `sharing.canShare` capability.

**Body:**
```json
{
  "report_id": "uuid",
  "to_user_id": "uuid",
  "note": "Optional field note",
  "expires_at": "2026-12-31T00:00:00Z"
}
```

**Validation chain (server-side):**
1. `report_id` and `to_user_id` are required.
2. Report must exist in the `reports` table.
3. Rangers may only share reports where `report.user_id === req.user.user_id`.
4. Cannot share to self (`shared_by <> shared_to` enforced by DB constraint + API check).
5. Reports with `sensitivity_tier >= 3` cannot be shared to COMMUNITY recipients (recipient role is checked via JOIN).
6. Inserts into `report_shares`, writes to `share_audit_log`, inserts a `DIRECT_SHARE` notification for the recipient.

**Response:** The created share row (201).

**Works fully:** Yes. All five validation steps are active. The sensitivity gate requires the recipient to exist in the database — if the `to_user_id` does not exist, the FK constraint on `report_shares` will reject the insert.

---

### `GET /api/shares` — Inbox

Returns all active (non-expired) shares addressed to the current user, newest first.

Joins: `report_shares → reports → species → users (shared_by)` — single round-trip for a full inbox render.

Filters out expired shares: `(expires_at IS NULL OR expires_at > NOW())`.

**Works fully:** Yes.

---

### `GET /api/shares/sent` — Outbox

Returns all shares sent by the current user, newest first. Includes `read_at` so senders can see delivery confirmation (null = unread, timestamped = read).

**Works fully:** Yes.

---

### `PATCH /api/shares/:id/read` — Mark read

Sets `read_at = NOW()` on the share record. Only affects shares where `shared_to = current_user` (ownership check). Also writes a `READ` entry to `share_audit_log`.

Idempotent: if `read_at` is already set, returns 404 ("already read") — the client should treat this gracefully.

**Works fully:** Yes.

---

## Notification Integration

Every new share triggers an INSERT into `notifications`:

```sql
INSERT INTO notifications (to_user, type, reference_id)
VALUES ($to_user_id, 'DIRECT_SHARE', $share_id);
```

The `reference_id` is the `share_id`. The notification inbox calls `GET /api/shares/:shareId` to resolve the detail when the user taps the notification.

**Works fully:** Yes. Notifications table must exist (run `scripts/add_collaboration_schema.js` first).

---

## Running the Migration

```bash
node scripts/add_collaboration_schema.js
```

Creates all six collaboration tables. Safe to re-run (`IF NOT EXISTS` guards).

---

## Limitations

- Forward-sharing (Rangers sharing reports submitted by others) is blocked. The `canForward` capability exists in the matrix but is `false` for Rangers — Analysts and Admins can share any report because the `actorRole === 'RANGER'` ownership check only fires for Rangers.
- There is no revocation endpoint yet (`REVOKE` action exists in the audit log enum but no route deletes a share).
- The inbox has no pagination — returns all non-expired shares up to whatever the database returns. A `LIMIT` should be added before the user base grows large.
- `to_user_id` must be supplied by the frontend. There is no "search users by name" endpoint yet — the frontend would need to implement user search against `GET /api/users`.
