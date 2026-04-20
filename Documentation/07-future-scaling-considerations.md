# TERRA — Future Scaling Considerations

This document records features and architectural decisions that have been deliberately deferred. Each entry includes the context behind the decision, the options evaluated, and a recommended sequencing when the time comes to implement.

---

## Real-Time Collaboration (Reports & Sessions)

**Raised:** 2026-04-20  
**Context:** Rangers, Analysts, and Admins need to collaborate on reports and Site Analysis sessions across field teams.

### Current State

The Phase 4–6 APIs (report sharing, teams, notifications) are complete on the backend. Sessions are stored in `localStorage` only — they exist solely in the browser that created them and cannot be shared or linked.

### What Needs to Be Built

#### 1. Sharing UI (prerequisite for anything collaborative)

The backend endpoints exist but have no frontend interface. Before any collaboration flow works end-to-end, the following UI components are needed:

- **Share Report button** on the report detail page — user picker, optional note, submit to `POST /api/shares`
- **Inbox page** or slide-in panel — renders `GET /api/shares`, marks items read via `PATCH /api/shares/:id/read`
- **Topbar notification badge** — polls `GET /api/notifications/unread-count` on tab focus and every 60 seconds

#### 2. Server-Side Session Persistence (prerequisite for session sharing)

Sessions are currently written to `localStorage` via `createSessionFromMap()`. To share or link a session, a `saved_sessions` table is needed:

```sql
CREATE TABLE saved_sessions (
    session_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID REFERENCES users(user_id) ON DELETE CASCADE,
    name         TEXT,
    payload      JSONB NOT NULL,     -- full session JSON (viewport, layers, drawnItems, etc.)
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

The existing `createSessionFromMap()` serialisation is already well-structured and can be stored directly as the JSONB payload. Migration from `localStorage` to server-side can be opt-in (a "Sync to account" button).

#### 3. Shareable Session Links (snapshot sharing)

Once sessions are server-side, a short share token (or direct `session_id`) can be passed to a recipient. The recipient opens the session in read-only mode — same viewport, same layers, no edit rights.

- No real-time involvement
- One-directional (point-in-time snapshot)
- Natural fit for briefing-style handoffs between Rangers and Analysts

#### 4. Session Export / Import via Teams (offline-compatible alternative)

Add "Export Session" (downloads the session JSON) and "Import Session" (uploads or pastes JSON). Rangers post the JSON to a team feed as an attachment. Teammates import it locally. No server infrastructure changes required beyond Phase 5 (Teams).

#### 5. Live Collaborative Sessions (real-time)

Live shared state — multiple users on the same map simultaneously, seeing each other's cursors, drawn polygons, and markers update in real time.

**What this requires:**
- WebSockets on the server (`socket.io` or native `ws`)
- Server-side session state store (Redis pub/sub or Postgres `LISTEN/NOTIFY`)
- Sessions become server-owned rather than browser-owned
- Client Leaflet layer updates broadcast via socket events

**Architecture sketch:**
```
Ranger A draws polygon → emits 'draw:create' via socket
Server broadcasts to all subscribers of session_id
Analyst B's map receives event → renders the polygon live
```

This is a significant infrastructure change and should be treated as a separate milestone, not an extension of the current feature set.

---

### Recommended Sequencing

| Step | What | Effort | Dependency |
|---|---|---|---|
| 1 | Topbar notification badge wired to `/api/notifications/unread-count` | Small | None — endpoint exists |
| 2 | Share Report UI on report detail page | Small–Medium | None — endpoint exists |
| 3 | Notification inbox panel (slide-in from topbar) | Medium | Step 1 |
| 4 | Server-side session persistence (`saved_sessions` table) | Medium | None |
| 5 | Shareable session links (read-only via token) | Medium | Step 4 |
| 6 | Session export / import via team feed | Small | Phase 5 Teams |
| 7 | Live collaborative sessions via WebSockets | Large | Step 4 |

Steps 1–3 unlock the already-built Phase 4–6 backend for actual use. Steps 4–6 unlock session collaboration without requiring real-time infrastructure. Step 7 is the full real-time experience and should only be scoped once steps 1–6 are stable.

---

*Add further future considerations below as they arise.*
