# Field Intelligence View — Developer Reference

**Route:** `#/test-site`  
**Sidebar label:** Test Site  
**Files:** `js/pages/testSite.js` · `css/testSite.css`

---

## What it does

Renders every wildlife sighting from the API as a typed reticle marker on a full-viewport Leaflet map. Markers animate in on load, then collapse to triangle icons. Rangers can hover, click, keyboard-navigate, filter by kind / confidence / time window, and overlay a heatmap or flow arrows. The full filter + viewport state is encoded in the URL hash so links are shareable and the browser back-button works.

---

## Architecture

### Module structure

`TestSitePage` is a single IIFE exposing one public method:

```js
TestSitePage.render(container)   // called by the router
```

All state lives inside the closure. Nothing is shared with other page modules.

### Render lifecycle

```
render(container)
  │
  ├─ destroy previous Leaflet instance (_leafletMap.remove())
  ├─ decode URL hash → savedState
  ├─ reset filterState to defaults
  ├─ build DOM shell (header + filter bar + map wrapper)
  ├─ create L.Map + tile layer
  ├─ showLoadingOverlay()
  ├─ await API.get('/analysis/sightings')   ← only async point
  │     falls back to FALLBACK_MARKERS if 0 results or error
  ├─ [abort if _renderId changed — stale render guard]
  ├─ hideLoadingOverlay()
  ├─ fitMapToMarkers() — skipped if URL has saved viewport
  ├─ mountMarkers()
  │     └─ runIntroSequence() → collapseToTriangle() (all markers)
  ├─ wireKeyboard()
  ├─ restoreState(savedState) — re-applies URL params
  └─ wire filter bar event listeners
```

### Module-level state

| Variable | Type | Purpose |
|---|---|---|
| `filterState` | Object | Active kinds, confidence threshold, time window, heatmapOn, flowsOn |
| `_mountedRefs` | Array | One entry per marker: `{card, svg, tri, meta, latlng, leafletMarker, markerData, scale}` |
| `_leafletMap` | L.Map | The live map instance; `null` when not rendering |
| `_heatLayer` | L.heatLayer | Hidden until `filterState.heatmapOn = true` |
| `_flowGroup` | L.layerGroup | Flow polylines + arrowheads; `null` when not active |
| `_renderId` | number | Monotonic counter; stale async renders bail after `await` |
| `_focusedIndex` | number | Index into `_mountedRefs` for keyboard focus; `-1` = none |
| `_kbHandler` | function | Current `document` keydown listener; swapped on each render to prevent duplicates |

---

## Marker kinds

| Kind | Trigger | Colour |
|---|---|---|
| `threat` | `sensitivity_tier >= 3` | Red `#ff3333` |
| `report` | `validation_status === VALIDATED` + species known | Cyan `#66ccff` |
| `default` | No species ID or name | White `#ffffff` |
| `asset` | Reserved — future ranger/sensor objects | Green `#39ff14` |

Kind is determined in `sightingToMarker()`. Tier takes priority over species presence, so a validated sighting at tier 3 is classified as `threat`, not `report`.

---

## Visual encoding

| Visual property | Encodes |
|---|---|
| Marker size | `sensitivity_tier` via `tierScale()`: tier 1 = 1×, tier 2 = 1.28×, tier 3 = 1.6× |
| Triangle opacity | Age of `created_at` via `decayOpacity()`: exponential decay, floors at 0.25 after 7 days |
| Pulse ring (green glow) | Fresh intel: `created_at` < 2 hours ago |
| Flow line brightness | Volume (marker count) of shared-kind sector pair; dim = low, vivid = high |
| Age label colour | Green < 6h · Amber < 48h · Red older |

---

## Interaction model

### Mouse

| Action | Result |
|---|---|
| Hover triangle | Info panel slides in |
| Click triangle | Restore reticle SVG + fly to marker |
| Double-click triangle | Max zoom + all panels open |
| Click reticle | Expand detail panel + fly |
| Click expanded reticle | Collapse back to triangle |
| Double-click reticle | Max zoom + all panels open |
| Click DETAIL button | Open right-side dock panel |

**Note on double-click:** Native `dblclick` is unreliable on Leaflet DivIcons because Leaflet consumes the event. Double-click is emulated with a 300 ms timer: a second click within the window cancels the single-click action and fires `focusMarker()` instead.

### Keyboard

Keyboard focus is independent from mouse hover. Press any navigation key to enter keyboard mode. Focus is shown as a pulsing lime border around the focused triangle.

| Key | Action |
|---|---|
| `Tab` / `→` / `↓` | Focus next visible marker |
| `Shift+Tab` / `←` / `↑` | Focus previous visible marker |
| `Enter` (first press) | Restore reticle + fly to marker |
| `Enter` (second press) | Expand detail panel |
| `Enter` (third press) | Collapse back to triangle |
| `Escape` | Collapse focused marker to triangle |
| `D` | Open detail dock for focused marker |

Keyboard shortcuts are silenced when focus is inside an `<input>` or `<textarea>` so the filter bar slider and any future form fields are unaffected.

Focus cycles only through **visible** markers (i.e. markers not hidden by the current filter). Changing a filter while a marker is focused does not reset focus; the cycle adjusts on the next navigation keystroke.

---

## Filter bar

| Control | `filterState` field | Persisted in URL |
|---|---|---|
| Kind buttons (DEFAULT / REPORT / ASSET / THREAT) | `activeKinds: Set` | `kinds=report,threat` |
| Confidence slider (0–100%) | `minConfidence: number` | `conf=20` |
| Time window (NOW / 24H / 7D / ALL) | `timeWindow: string` | `time=7D` |
| HEAT toggle | `heatmapOn: boolean` | `heat=1` |
| FLOWS toggle | `flowsOn: boolean` | `flows=1` |

At least one kind must remain active — the kind toggle refuses to deselect the last one.

Fallback markers (no API data) always pass the confidence and time filters because they carry no `ai_confidence_score` or `created_at`.

---

## Heatmap

Uses `leaflet-heat` (`L.heatLayer`). The layer is created once in `mountMarkers()` and toggled via `addLayer` / `removeLayer` in `applyFilters()`. The heat canvas receives `pointer-events: none` after every `addLayer` call because `leaflet-heat` renders a raw canvas that would otherwise intercept clicks and make the map unresponsive.

Heatmap intensity is `sensitivity_tier / 3` (range 0.33–1.0). Only currently-visible kinds contribute points.

---

## Flow arrows

Toggled by the FLOWS button. Computed by `buildFlowArrows()`:

1. Group markers by sector → compute centroid per sector.
2. For every sector pair that shares at least one kind, compute a flow. Direction goes from the sector with more events toward the sector with fewer. Volume = total count of the dominant kind across both sectors.
3. Render each flow as a 2 px polyline + SVG arrowhead at the destination. A volume label appears at the midpoint for flows carrying 3+ events.

Flow lines use `interactive: false` so they never capture clicks.

---

## URL state

Hash scheme:
```
#/test-site?kinds=report,threat&conf=20&time=7D&heat=1&flows=1
            &focus=ts-abc123&zoom=14&lat=-1.26500&lng=36.84200
```

`history.replaceState` is used — **not** `pushState` — so the URL updates silently without creating a new browser history entry. The router owns navigation history; individual pages only update within their own entry.

`pushState()` (the internal helper, not `history.pushState`) is debounced at 120 ms to coalesce the rapid `moveend` events fired during `flyTo` animations.

---

## Double-render guard

The router's `navigate()` both calls `render()` directly **and** sets `window.location.hash`, which fires `hashchange`, which calls `render()` a second time. Without a guard, both renders would complete and wire duplicate click listeners — causing every button click to toggle state on then immediately off.

Guard pattern:
```js
const myId = ++_renderId;          // stamp this render
// ... await API call ...
if (myId !== _renderId) return;    // bail if a newer render started
// ... wire listeners ...
```

---

## Adding a new marker kind

1. Add an entry to `VARIANT_META` with `bracket`, `bar`, `fill`, `titleColor`, `statusColor`.
2. Add the kind to `KIND_ORDER` in the desired animation sequence position.
3. Add a classification rule in `sightingToMarker()`.
4. Optionally add a `buildXContent()` function and register it in the `builders` map inside `makeExpandedPanel()`.
5. Add a kind button to the filter bar HTML in `render()` and include the kind in the `KIND_COLORS` / `KIND_LABELS` maps.
6. Add a `FLOW_COLORS` entry.

---

## Adding a new filter

1. Add the field to `filterState`.
2. Add the HTML control to the filter bar template in `render()`.
3. Add the visibility logic in `applyFilters()`.
4. Encode the value in `encodeStateToHash()`.
5. Decode it in `decodeStateFromHash()`.
6. Restore it in `restoreState()`.

---

## Known constraints

- **Leaflet DivIcon overflow:** `iconSize` is set to `[520, 230]` — much larger than the visible reticle — so the expanded panel and info panel never get clipped by Leaflet's marker bounding box. `pointer-events: none` on `.ts-reticle-card` ensures the transparent overflow area never captures clicks.
- **Heat canvas pointer events:** `leaflet-heat` renders a canvas without `pointer-events: none`. This is corrected in `applyFilters()` every time the layer is added, because adding the layer recreates the canvas element.
- **No `dblclick` on DivIcons:** See "Double-click" in the interaction model section above.
- **`history.replaceState` vs router pushState:** The router uses `window.location.hash =` which fires `hashchange`. This page uses `history.replaceState` which does **not** fire `hashchange`, so there is no recursive loop.
