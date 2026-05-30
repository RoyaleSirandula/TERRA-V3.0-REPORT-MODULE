# TERRA PLATFORM
## TECHNICAL SPECIFICATION: SCOPED SESSION ARCHITECTURE FOR SITE ANALYSIS
### Document ID: TSA-001 | Version: 1.0 | Status: APPROVED
### Date: 2026-05-30 | Author: Terra Systems

---

## CHANGE HISTORY

| Version | Date       | Author          | Description                      |
|---------|------------|-----------------|----------------------------------|
| 1.0     | 2026-05-30 | Terra Systems   | Initial specification            |

---

## 1. SCOPE AND PURPOSE

### 1.1 Purpose

This specification defines the **Scoped Session Architecture (SSA)** for Terra's Site Analysis module. It establishes the design contract, data flow model, layer lifecycle, rendering pipeline, and performance budgets that govern how spatial data is loaded, streamed, filtered, and rendered within a user-defined geographic boundary during an active analysis session.

### 1.2 Problem Statement

The current implementation of Site Analysis loads all globally available spatial data — GPS tracks, sensor feeds, report markers, environmental overlays — into the browser regardless of the user's area of interest. This produces three compounding failure modes under scale:

1. **Bandwidth waste** — data irrelevant to the analysed region crosses the network
2. **Main-thread contention** — all data streams share a single render cycle, causing mutual stutter
3. **No isolation guarantee** — opening a session for Region A activates data belonging to Region B

### 1.3 Scope of This Document

This document covers:
- The Session Boundary model and its role as a first-class query parameter
- The independent lifecycle of each layer type (GPS, Acoustic, Reports, Vegetation)
- The delta rendering contract between data streams and the map canvas
- The spatial filtering contract (client-side and server-side)
- Performance budgets per layer per tick
- The sandbox reference implementation

This document does not cover: authentication, multi-user session concurrency, or offline sync architecture.

---

## 2. SYSTEM CONTEXT

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TERRA CLIENT (Browser)                        │
│                                                                      │
│   ┌──────────────┐    ┌──────────────────────────────────────────┐  │
│   │   Session    │    │              Layer Manager               │  │
│   │  Controller  │───▶│  GPS Stream  │ Acoustic │ Reports │ Veg  │  │
│   └──────┬───────┘    └──────┬───────┴────┬─────┴────┬────┴──┬──┘  │
│          │                   │            │          │       │      │
│   ┌──────▼───────┐    ┌──────▼───────────▼──────────▼───────▼──┐   │
│   │  Boundary    │    │          Spatial Filter                  │   │
│   │   Model      │───▶│  ST_Within / Ray-Cast point-in-polygon   │   │
│   └──────────────┘    └─────────────────────┬───────────────────┘   │
│                                             │                        │
│                                    ┌────────▼────────┐              │
│                                    │  Leaflet Canvas  │              │
│                                    │  (Delta Render)  │              │
│                                    └─────────────────-┘              │
└─────────────────────────────────────────────────────────────────────┘
          │                                   ▲
          │ Spatial query (boundary param)     │ Filtered data only
          ▼                                   │
┌─────────────────────────────────────────────────────────────────────┐
│                        TERRA SERVER                                  │
│                                                                      │
│   REST/WS endpoints filter all queries by boundary polygon          │
│   via PostGIS ST_Within / ST_Intersects before returning data       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. CORE PRINCIPLES

### P-01: Boundary-First Query
The boundary polygon is submitted as a parameter on every data request. No data is fetched without a boundary. The server applies `ST_Within(geometry, boundary)` or `ST_Intersects(geometry, boundary)` before returning any records.

### P-02: Independent Layer Lifecycles
Each layer type (GPS, Acoustic, Reports, Vegetation) has its own activation state, update cadence, and teardown procedure. A layer can be activated, deactivated, or paused independently without affecting other layers.

### P-03: Session-Bound Subscriptions
All data subscriptions (WebSocket channels, SSE streams, polling timers) are created on session activation and destroyed on session deactivation. No subscription persists between sessions.

### P-04: Delta Rendering
On each layer tick, only the changed elements are updated on the map. Full layer redraws do not occur during an active session. A full redraw is permitted only on initial layer activation or on boundary change.

### P-05: Viewport Culling
Within an active session, detail-level data (sensor waveforms, trail history, report media) is only loaded for elements visible in the current viewport. Zoom-level thresholds gate the resolution of data requested.

### P-06: Zero Global State Bleed
Opening a Site Analysis session does not modify or read from any global data cache shared with other pages (Dashboard, Field Intel, Species Intel). Session state is fully self-contained and destroyed on navigation away.

---

## 4. SESSION LIFECYCLE

```
                        ┌────────────────┐
                        │    DORMANT     │  No boundary. No subscriptions.
                        │                │  No data in memory.
                        └───────┬────────┘
                                │
                    User draws boundary polygon
                                │
                        ┌───────▼────────┐
                        │  BOUNDARY SET  │  Boundary stored. Layers available
                        │                │  to toggle but not yet streaming.
                        └───────┬────────┘
                                │
                    User clicks ACTIVATE SESSION
                                │
                        ┌───────▼────────┐
                        │    ACTIVE      │  All toggled layers subscribe and
                        │                │  begin streaming. Spatial filter
                        │                │  applied to all incoming data.
                        └───────┬────────┘
                                │
               User clicks DEACTIVATE or navigates away
                                │
                        ┌───────▼────────┐
                        │   TEARDOWN     │  All timers cleared. All WebSocket
                        │                │  channels closed. All Leaflet layers
                        │                │  removed. Memory released.
                        └───────┬────────┘
                                │
                        Returns to DORMANT
```

### 4.1 Session Object Schema

```javascript
Session {
    id:            string,          // UUID, generated on activation
    boundary:      SessionBoundary, // Polygon model (see §5)
    activatedAt:   ISO8601,
    deactivatedAt: ISO8601 | null,
    layers: {
        gps:       LayerState,
        acoustic:  LayerState,
        reports:   LayerState,
        vegetation: LayerState,
    },
    stats: {
        totalRendered:  number,     // elements currently on map
        totalBlocked:   number,     // elements filtered out by boundary
        lastTickMs:     number,     // duration of last render cycle
    }
}

LayerState {
    enabled:      boolean,
    streaming:    boolean,
    itemCount:    number,
    blockedCount: number,
    lastUpdate:   ISO8601 | null,
    tickInterval: number,           // ms between updates
}
```

---

## 5. BOUNDARY MODEL

### 5.1 Definition

The SessionBoundary is the authoritative spatial scope of an analysis session. It is defined as a closed polygon in WGS84 coordinates, drawn by the user via the Leaflet.Draw tool.

### 5.2 Interface

```javascript
class SessionBoundary {
    constructor(latlngs: LatLng[])

    // Returns true if point falls within polygon (ray-casting)
    contains(latlng: LatLng): boolean

    // Returns true if any point in the array is within polygon
    intersects(latlngs: LatLng[]): boolean

    // Returns Leaflet LatLngBounds for viewport fitBounds
    toBounds(): L.LatLngBounds

    // Returns GeoJSON Polygon for server-side query param
    toGeoJSON(): GeoJSONPolygon

    // Returns area in km²
    areaKm2(): number
}
```

### 5.3 Point-in-Polygon Algorithm

Ray-casting (Jordan curve theorem). O(n) per check where n = polygon vertex count. For convex boundaries with ≤ 20 vertices, this runs in <0.01ms per point. Acceptable for real-time GPS delta checks.

### 5.4 Server-Side Enforcement

The boundary GeoJSON is sent as a query parameter on all data requests:

```
GET /api/gps-tracks?boundary=<GeoJSON>&since=<ISO8601>
GET /api/sensors?boundary=<GeoJSON>
GET /api/reports?boundary=<GeoJSON>&since=<ISO8601>
GET /api/vegetation?boundary=<GeoJSON>
```

The server applies `ST_Within(point, ST_GeomFromGeoJSON($boundary))` or `ST_Intersects(linestring, ...)` as appropriate. Records outside the boundary are never returned.

---

## 6. LAYER SPECIFICATIONS

### 6.1 GPS Tracking Layer

| Property         | Value                          |
|------------------|--------------------------------|
| Update cadence   | Every 2 000 ms (live) / on-demand (historical) |
| Renderer         | `L.canvas()` — shared canvas renderer |
| Spatial filter   | `boundary.contains(currentPosition)` OR `boundary.intersects(trailSegment)` |
| Delta operation  | Update marker LatLng + append one point to trail polyline |
| Full redraw      | On activation only             |
| Zoom gates       | Trail history: zoom ≥ 10. Node markers: zoom ≥ 12. Arrow chevrons: zoom ≥ 14 |
| Max trail length | 50 points per individual (FIFO, oldest point removed on append) |

**Activation sequence:**
1. Query `/api/gps-tracks?boundary=...` — returns individuals with positions intersecting boundary
2. For each individual: create trail polyline + current position marker on canvas
3. Start 2 000 ms interval → `_tickGPS()`

**Tick operation (`_tickGPS`):**
```
For each tracked individual:
  1. Receive new LatLng from stream/poll
  2. boundary.contains(newPos) → if false, mark as EXITED, hide marker
  3. If within boundary:
     a. marker.setLatLng(newPos)           — O(1)
     b. trail.addLatLng(newPos)            — O(1) append
     c. if trail.length > MAX: remove first point  — O(1)
  4. Update stats.totalRendered / stats.totalBlocked
```

### 6.2 Acoustic Sensor Layer

| Property         | Value                          |
|------------------|--------------------------------|
| Update cadence   | 3 000 ms event poll            |
| Renderer         | SVG divIcon markers (fixed positions) |
| Spatial filter   | `boundary.contains(sensor.position)` — evaluated once on activation |
| Delta operation  | Animate ripple on event-triggered sensor only |
| Full redraw      | Never — sensor positions are static |
| Zoom gates       | Waveform detail: zoom ≥ 13     |

**Activation sequence:**
1. Query `/api/sensors?boundary=...` — returns sensors within boundary only
2. Render one divIcon per sensor (inactive state)
3. Start 3 000 ms interval → `_tickAcoustic()`

**Tick operation:**
```
1. Receive event batch from stream
2. For each event: find sensor marker by sensor_id
3. Trigger ripple animation on that marker only
4. Update last-event timestamp on marker
```

### 6.3 Reports Layer

| Property         | Value                          |
|------------------|--------------------------------|
| Update cadence   | 5 000 ms                       |
| Renderer         | Reticle divIcon (existing system) |
| Spatial filter   | `boundary.contains(report.coordinates)` |
| Delta operation  | Add new markers only; update confidence bar on status change |
| Full redraw      | Never during active session    |
| Zoom gates       | Expanded panel: zoom ≥ 12      |

**Tick operation:**
```
1. Query /api/reports?boundary=...&since=lastCheck
2. For each new report: create reticle marker → addTo layer
3. For each updated report: update confidence bar fill only
4. No existing markers are removed or recreated
```

### 6.4 Vegetation / Environmental Layer

| Property         | Value                          |
|------------------|--------------------------------|
| Update cadence   | 10 000 ms (simulates satellite pass cycle) |
| Renderer         | L.polygon fill + opacity       |
| Spatial filter   | Layer is inherently scoped to boundary polygon |
| Delta operation  | Update fillColor and fillOpacity only |
| Full redraw      | Never                          |

---

## 7. DATA FLOW ARCHITECTURE

```
                      LIVE SESSION (ACTIVE state)
                      
  ┌─────────────────────────────────────────────────────────┐
  │                                                         │
  │  GPS Stream          Acoustic Stream      Report Stream  │
  │  (2 000ms)           (3 000ms)            (5 000ms)      │
  │      │                   │                    │          │
  │      ▼                   ▼                    ▼          │
  │  ┌───────┐           ┌───────┐           ┌───────┐      │
  │  │Spatial│           │Spatial│           │Spatial│      │
  │  │Filter │           │Filter │           │Filter │      │
  │  └───┬───┘           └───┬───┘           └───┬───┘      │
  │      │ PASS              │ PASS               │ PASS     │
  │      ▼                   ▼                    ▼          │
  │  ┌─────────────────────────────────────────────────┐    │
  │  │           DELTA RENDER QUEUE                     │    │
  │  │   Batches micro-updates, flushes on rAF          │    │
  │  └──────────────────────┬──────────────────────────┘    │
  │                         │                               │
  │                         ▼                               │
  │              ┌──────────────────────┐                   │
  │              │   Leaflet Canvas     │                   │
  │              │   (single thread)    │                   │
  │              └──────────────────────┘                   │
  └─────────────────────────────────────────────────────────┘
```

### 7.1 Delta Render Queue

To prevent multiple streams from contending on the same animation frame, all layer updates are pushed into a shared delta queue. The queue flushes once per `requestAnimationFrame`, batching all pending operations into a single paint cycle.

```
DeltaQueue {
    _pending: Map<markerId, Operation>
    
    push(markerId, operation):
        _pending.set(markerId, operation)  // latest op wins if same id queued twice
    
    flush():                               // called on rAF
        _pending.forEach((op, id) => op.execute())
        _pending.clear()
}
```

---

## 8. RENDERING PIPELINE

```
Incoming data point
        │
        ▼
[ boundary.contains(point) ] ─── NO ──▶  blockedCount++  (no render)
        │
       YES
        │
        ▼
[ Is this a new element? ]
        │
   YES  │  NO
        │   └──▶ [ Find existing marker ]
        │               │
        ▼               ▼
  Create marker    [ What changed? ]
  Add to layer          │
                   LatLng ──▶ marker.setLatLng()       O(1)
                   Confidence ──▶ update bar fill       O(1)
                   Status ──▶ update icon class         O(1)
                   New trail pt ──▶ polyline.addLatLng  O(1)
                        │
                        ▼
                  Push to DeltaQueue
                        │
                        ▼
                  rAF flush → paint
```

---

## 9. PERFORMANCE BUDGETS

| Layer      | Max elements rendered | Max tick duration | Max memory footprint |
|------------|-----------------------|-------------------|----------------------|
| GPS        | 100 individuals       | 8 ms              | 2 MB                 |
| Acoustic   | 50 sensors            | 4 ms              | 512 KB               |
| Reports    | 500 markers           | 12 ms             | 4 MB                 |
| Vegetation | 1 polygon             | 2 ms              | 64 KB                |
| **Total**  | —                     | **26 ms**         | **< 7 MB**           |

Target: all layer ticks combined must complete within one 16.7 ms frame budget at 60 fps. Vegetation and Acoustic updates are cheap. GPS and Reports should be profiled if individual counts exceed budget thresholds.

---

## 10. ZOOM-LEVEL DATA GATES

| Zoom | GPS Layer               | Acoustic Layer        | Reports Layer        |
|------|-------------------------|-----------------------|----------------------|
| ≤ 8  | Current position dot only | Sensor dot only      | Collapsed icon only  |
| 9–11 | Trail (last 10 pts)     | Sensor dot + label    | Reticle marker       |
| 12–13| Trail (last 30 pts) + nodes | Event ripple detail | Reticle + info panel |
| ≥ 14 | Full trail + arrows + nodes | Waveform overlay   | Full expanded panel  |

---

## 11. SESSION TEARDOWN CONTRACT

On `session.destroy()`, the following must occur in order:

1. `clearInterval` / `clearTimeout` on all layer timers
2. Close all WebSocket connections / cancel all fetch streams
3. Call `layer.remove()` on every Leaflet layer group
4. Null all layer group references
5. Clear delta queue
6. Null session boundary
7. Null session object
8. Emit `SESSION_DESTROYED` event for UI to return to DORMANT state

Failure to execute steps 1–2 before step 3 will leave orphaned timers that continue to call `addTo(map)` on a destroyed layer group, producing silent errors.

---

## 12. ERROR STATES

| State                  | Cause                                    | Recovery                          |
|------------------------|------------------------------------------|-----------------------------------|
| `BOUNDARY_TOO_LARGE`   | Region area > 50 000 km²                 | Prompt user to reduce boundary    |
| `NO_DATA_IN_BOUNDARY`  | Query returned 0 results for all layers  | Show empty-state UI per layer     |
| `STREAM_TIMEOUT`       | No data received for > 30 s on GPS layer | Retry once, then show stale badge |
| `RENDER_BUDGET_EXCEEDED`| Tick duration > 26 ms for 3 consecutive ticks | Reduce trail max length, increase tick interval |
| `SESSION_CONFLICT`     | User opens second session without closing first | Force teardown of existing session before creating new |

---

## 13. SANDBOX REFERENCE IMPLEMENTATION

The sandbox page (`#/sa-sandbox`) implements this specification with simulated data streams in place of live API calls. It serves as:

1. A functional proof of concept for the scoped session model
2. A development environment for testing layer interactions
3. A demonstration tool for stakeholders

The sandbox simulates:
- 6 GPS-tracked animals moving on random walks around a fixed region
- 10 acoustic sensors at fixed positions
- Reports appearing over time at random positions within a wider area
- Vegetation index changing on a 10 s cycle

All spatial filtering, session lifecycle, independent layer timers, delta rendering, and teardown behaviour in the sandbox are production-identical to the specification above. Only the data source (mock vs. live API) differs.

---

*End of Document TSA-001 v1.0*
