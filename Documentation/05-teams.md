# TERRA — Teams & Team Report Broadcasting
**Phase 5 | File: `src/routes/teamsRoutes.js`**

---

## Overview

Teams are operational units — patrol zones, project groups, regional reserve sections — that share a report feed. When a team member posts a report to the team, all other active members receive a notification and can view the post in the team feed.

Teams are a layer on top of direct sharing (Phase 4). Direct sharing is person-to-person; team posting is one-to-many within a defined group.

---

## Who Can Do What

| Action | COMMUNITY | RANGER | ANALYST | ADMIN |
|---|---|---|---|---|
| Join a team | No | Yes (if added by Lead/Admin) | Yes | Yes |
| Create a team | No | No | Yes | Yes |
| Add members | No | Yes (if LEAD of that team) | Yes (if LEAD) | Yes (always) |
| Remove members | No | Yes (if LEAD) | Yes (if LEAD) | Yes (always) |
| Post a report | No | Yes — own reports only | Yes — any report | Yes — any report |
| View team feed | No | Yes — posts after joined_at only | Yes | Yes |
| Manage teams | No | No | No | Yes |

---

## Database Schema

### `teams`

| Column | Type | Notes |
|---|---|---|
| `team_id` | UUID PK | Auto-generated |
| `name` | VARCHAR(100) | Required |
| `region` | TEXT | Optional — maps to a geographic area |
| `created_by` | UUID FK → users (SET NULL) | Nullable — survives creator deletion |
| `created_at` | TIMESTAMPTZ | Immutable |

### `team_members`

| Column | Type | Notes |
|---|---|---|
| `team_id` | UUID FK → teams | Part of composite PK |
| `user_id` | UUID FK → users | Part of composite PK |
| `member_role` | VARCHAR(20) | `LEAD` or `MEMBER` |
| `joined_at` | TIMESTAMPTZ | Set on first join or re-join |
| `removed_at` | TIMESTAMPTZ | Null = active; set on soft-delete |

Primary key is `(team_id, user_id)` ensuring each user appears at most once per team. On re-add (after soft-remove), `ON CONFLICT DO UPDATE` clears `removed_at` and updates `member_role`.

Indexed on `user_id WHERE removed_at IS NULL` for fast "which teams am I in?" queries.

### `team_report_posts`

| Column | Type | Notes |
|---|---|---|
| `post_id` | UUID PK | Auto-generated |
| `team_id` | UUID FK → teams | Cascades on team delete |
| `report_id` | UUID FK → reports | Cascades on report delete |
| `posted_by` | UUID FK → users (SET NULL) | Nullable — survives user deletion |
| `posted_at` | TIMESTAMPTZ | Immutable |
| `note` | TEXT | Optional context note from poster |

Indexed on `(team_id, posted_at DESC)` for fast feed queries.

---

## Temporal Access Gate

The most important access rule in the team feed is:

> A member can only read posts made **at or after their `joined_at` timestamp**.

This is enforced in `GET /api/teams/:id/posts`:

```sql
WHERE tp.team_id = $1 AND tp.posted_at >= $2
```

where `$2` is `membership.rows[0].joined_at`.

**Why this matters:** If a team shares a sensitive sighting on Monday, and a new member is added on Wednesday, the Wednesday member cannot retroactively access the Monday post. This mirrors the principle used in military/conservation intelligence systems where "need to know" is evaluated at the time of disclosure, not at the time of access.

---

## API Endpoints

### `GET /api/teams` — List my teams

Returns all teams the current user is an active member of, including `member_role` and live `member_count`. No capability gate beyond authentication — if you're a member, you can see it.

**Works fully:** Yes.

---

### `POST /api/teams` — Create a team

**Requires:** `teams.canCreate` (Analyst / Admin).

Uses a database transaction: creates the `teams` row and inserts the creator as `LEAD` atomically. If the INSERT into `team_members` fails, the team row is rolled back.

**Body:** `{ name, region? }`

**Works fully:** Yes. Creator is automatically LEAD.

---

### `GET /api/teams/:id/members` — List active members

Requester must be an active member. Returns username, role_name, member_role, joined_at for all active (not soft-removed) members.

**Works fully:** Yes.

---

### `POST /api/teams/:id/members` — Add a member

Only a LEAD of the specific team or an Admin can add members. Rangers who are LEAD of a team may add other Rangers; Admins can add anyone to any team.

Uses `ON CONFLICT (team_id, user_id) DO UPDATE` to handle re-adding previously removed members without creating duplicate rows.

Sends a `TEAM_ADDED` notification to the newly added member.

**Works fully:** Yes.

---

### `DELETE /api/teams/:id/members/:uid` — Soft-remove a member

Sets `removed_at = NOW()`. Historical posts are preserved. The removed member loses access to the feed immediately (the temporal gate uses `AND removed_at IS NULL` in the membership check).

**Works fully:** Yes.

---

### `POST /api/teams/:id/posts` — Post a report to team feed

**Requires:** `sharing.canShare` capability + active team membership.

Rangers may only post reports they submitted. Analysts/Admins may post any report. After inserting the post, fans out `TEAM_POST` notifications to all other active members.

**Works fully:** Yes. The fan-out uses a `for` loop rather than a bulk insert — acceptable for typical team sizes (< 20 members). A bulk insert pattern should be used if teams grow large.

---

### `GET /api/teams/:id/posts` — Get team feed

Temporal gate: only posts after `joined_at` are returned. Returns last 50 posts, newest first, joined with report + species + poster username.

**Works fully:** Yes.

---

## Limitations

- There is no `GET /api/teams/:id` endpoint to retrieve a single team's metadata. The list endpoint includes all relevant fields for UI rendering.
- Team deletion is not yet implemented. Deleting a team would cascade-delete all memberships and posts.
- The LEAD role can only be assigned at member-add time (`member_role` field). There is no "promote to LEAD" patch endpoint yet.
- Pagination is not implemented on the team feed — returns last 50 posts. This is a hard cap.
- Rangers cannot create teams; they can only be added to them. A future improvement could allow Rangers to create informal sub-groups with a more limited capability set.
