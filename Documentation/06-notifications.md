# TERRA — Notifications
**Phase 6 | File: `src/routes/notificationsRoutes.js`**

---

## Overview

An in-app notification system that drives a badge counter in the topbar and a notification inbox. Notifications are lightweight pointer records — they store a type and a `reference_id` pointing to the relevant share or team post. The client resolves the full detail via the respective endpoint when the user opens the item.

---

## Notification Types

| Type | Trigger | `reference_id` points to |
|---|---|---|
| `DIRECT_SHARE` | A report was shared directly to this user via `POST /api/shares` | `report_shares.share_id` |
| `TEAM_POST` | A report was posted to a team this user belongs to via `POST /api/teams/:id/posts` | `team_report_posts.post_id` |
| `TEAM_ADDED` | This user was added to a team via `POST /api/teams/:id/members` | `teams.team_id` |

---

## Database Schema

### `notifications`

| Column | Type | Notes |
|---|---|---|
| `notif_id` | UUID PK | Auto-generated |
| `to_user` | UUID FK → users | Cascades on user delete |
| `type` | VARCHAR(30) | One of the three types above |
| `reference_id` | UUID | Nullable — points to the relevant record |
| `created_at` | TIMESTAMPTZ | Immutable, set on insert |
| `read_at` | TIMESTAMPTZ | Null = unread; set when user marks it read |

**Index:** `(to_user) WHERE read_at IS NULL` — partial index covers the unread-count query efficiently. At any scale, this query is O(active unread count), not O(total notifications).

---

## API Endpoints

### `GET /api/notifications` — All notifications

Returns the 50 most recent notifications for the current user (read and unread). The client renders unread rows with a highlight based on `read_at === null`.

**Works fully:** Yes.

---

### `GET /api/notifications/unread-count` — Badge count

Returns `{ count: N }`. Designed to be called frequently — the partial index makes it fast regardless of total notification history.

**Polling strategy:** The topbar polls this endpoint on `document.visibilitychange` (when the browser tab regains focus) and on a 60-second interval while the app is active. This keeps the badge fresh without hammering the server.

> **Note:** The polling listener is not yet wired into `public/js/components/topbar.js`. The endpoint is ready — the topbar integration is the next implementation step.

**Works fully (endpoint):** Yes. **Works fully (topbar badge):** Endpoint complete; topbar wiring pending.

---

### `PATCH /api/notifications/:id/read` — Mark one as read

Sets `read_at = NOW()` on a single notification. Only affects notifications where `to_user = current_user` — users cannot mark each other's notifications read.

Returns 404 if the notification is not found or is already read. The client should handle this gracefully (treat as success — the notification is already read either way).

**Works fully:** Yes.

---

### `PATCH /api/notifications/read-all` — Mark all as read

Marks every unread notification for the current user as read in a single `UPDATE`. Returns `{ updated: N }` so the client can animate the badge clearing.

**Works fully:** Yes.

---

## Generating Notifications

Notifications are created by the routes that trigger them — not by a separate service. Each write point is:

| Route | Notification written |
|---|---|
| `POST /api/shares` | `DIRECT_SHARE` to `shared_to` |
| `POST /api/teams/:id/members` | `TEAM_ADDED` to the new `user_id` |
| `POST /api/teams/:id/posts` | `TEAM_POST` fan-out to all other active members |

The fan-out in `POST /api/teams/:id/posts` uses a loop over member rows. For teams with many members this is a sequential INSERT loop — acceptable for current scale. A bulk INSERT or a dedicated notification queue should be considered if teams grow beyond ~50 members.

---

## Polling Strategy (Design)

```
Page focus event (visibilitychange) → GET /api/notifications/unread-count → update badge
                                                │
                                          every 60s (setInterval)
```

The 60-second interval is a pragmatic choice:
- Rangers in the field may not always have good connectivity.
- Share urgency is moderate — a 60-second lag is acceptable for field operations.
- WebSockets or Server-Sent Events would give real-time delivery but require infrastructure changes.

---

## Limitations

- **Topbar wiring not yet implemented.** The endpoint is live but the topbar badge polling listener needs to be added to `public/js/components/topbar.js`. The badge should display above the user avatar or a dedicated bell icon.
- **No notification panel UI.** There is no page or overlay to browse the full notification list. A slide-in panel triggered from the topbar badge is the natural next step.
- **No push notifications.** Real-time delivery requires a WebSocket connection or a push notification service (FCM/APNs). The current polling approach works for web but does not reach users who have the tab closed.
- **No per-user notification preferences.** A settings page to opt out of specific notification types (e.g. disable TEAM_POST emails) does not yet exist.
- **`reference_id` is untyped.** The type field tells the client which table to query, but the lookup must be done by the client. A future improvement could add a `JSONB detail` column with enough context to render a preview without a second API call.
