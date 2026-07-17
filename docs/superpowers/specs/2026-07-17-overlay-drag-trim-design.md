# Overlay Drag Trim Design

## Goal

When the map Settings panel is open, dragging the map surface translates the
selected mower's boundary SVG overlay without panning the underlying Leaflet
map. The overlay follows the pointer in two dimensions, and the existing east
and north trim controls update live to show the drag's geographic components.

Outside Settings, map dragging retains its current panning behavior.

## Interaction

Entering Settings disables Leaflet's normal drag-to-pan handler and enables a
dedicated overlay trim drag interaction on the map container. A primary-pointer
drag directly moves the overlay in the same screen direction as the pointer.
Horizontal and vertical movement are handled together: a diagonal drag updates
both the east/west and north/south trim values during each pointer movement.

The map center does not change during an overlay trim drag. Zoom controls and
non-drag map behavior remain available. The trim drag is inactive when there is
no selected mower or no ready boundary overlay.

Leaving Settings through Save or Cancel restores normal Leaflet map dragging.
An interrupted pointer gesture also ends cleanly without leaving drag state
active.

## Geographic Conversion

At pointer-down, the browser records the pointer's map coordinate and the
selected mower's current draft trim. During pointer movement, Leaflet converts
the current container point to a latitude/longitude coordinate while the map is
stationary.

The change in longitude is converted to east/west metres at the drag's
reference latitude. The change in latitude is converted to north/south metres.
Both deltas are added to the trim recorded at pointer-down. This makes direct
manipulation stable throughout one drag and prevents rounding from accumulating
across individual move events.

The existing map-overlay settings normalization remains authoritative, so both
axes retain the current -20 m to +20 m limits. Once an axis reaches its limit,
additional movement in that direction does not move the overlay farther.

## Draft Settings and Controls

Pointer movement updates `draftMapOverlaySettings` through the existing
per-mower trim functions. Each update then:

1. renders both trim range controls and their signed metre outputs;
2. redraws the boundary overlay from the updated draft settings; and
3. leaves the heatmap settings and base-map view unchanged.

The existing transaction behavior is preserved. Save persists the dragged
trim, Cancel discards it and redraws the saved trim, and Reset sets both draft
axes to zero. The range dials continue to work independently of dragging.

## Code Boundaries

A focused browser module owns the pure geographic drag calculation: given an
initial trim plus start and current geographic pointer coordinates, it returns
the next east/north trim. `public/map.js` owns Leaflet and DOM integration,
including enabling or disabling map panning with Settings, pointer capture and
gesture cleanup, updating draft state, rendering the controls, and redrawing
the overlay.

No server, database, SVG parsing, storage format, or HTML layout changes are
required.

## Error and Edge Handling

- Non-primary mouse buttons do not start a trim drag.
- A drag does not start without a selected mower and ready overlay payload.
- Pointer-up, pointer-cancel, leaving Settings, and lost pointer capture clear
  the active gesture.
- Invalid or non-finite geographic input is ignored rather than corrupting the
  draft trim.
- Existing trim normalization clamps valid results to the supported limits.

## Testing

Automated tests will verify:

- horizontal drags update only east/west trim in the direct drag direction;
- vertical drags update only north/south trim in the direct drag direction;
- diagonal drags update both axes from the same gesture;
- movement is calculated from the gesture's initial trim rather than
  accumulating rounded move-event values;
- trim values stay within the existing -20 m to +20 m limits;
- Settings mode disables Leaflet map dragging and restores it on Save or
  Cancel;
- map drag integration updates both controls and redraws the draft overlay; and
- dragging is inactive without a selected mower or ready overlay.

The focused browser tests run with Node's built-in test runner alongside the
existing map overlay settings, projection, and UI source tests.
