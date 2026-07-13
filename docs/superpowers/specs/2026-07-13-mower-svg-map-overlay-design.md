# Mower SVG Map Overlay Design

## Summary

Overlay each mower's Husqvarna-generated SVG map on the existing Leaflet map.
The server downloads and parses the generated SVG with the same Husqvarna
credentials used by the existing API integration. It combines the parsed local
geometry with a charging-station GPS anchor inferred from recorded
`GOING_HOME` positions. The browser converts the geometry from local
millimetres to latitude and longitude, renders outline-only Leaflet vector
layers, and applies per-mower east/west and north/south trim stored in browser
application data.

This first version deliberately assumes a fixed scale and orientation:

- 1,000 SVG coordinate units equal one metre.
- SVG X increases eastward.
- SVG Y increases southward and must be inverted for north-positive map
  coordinates.
- The SVG is not rotated relative to the geographic map.
- Users may adjust translation only; scale and rotation are not configurable.

## Goals

- Download the current generated SVG for a selected mower without exposing
  Husqvarna credentials to the browser.
- Parse the mowing-area boundaries, islands, guide lines, and charging-station
  reference from the SVG into safe normalized geometry.
- Infer the charging-station GPS anchor from the final stored position of the
  latest completed `GOING_HOME` session.
- Convert SVG millimetre coordinates into geographic coordinates around that
  anchor.
- Render working areas, islands, guides, and the charging-station reference as
  unfilled Leaflet outlines.
- Allow a user to trim the overlay east/west and north/south for each mower.
- Preserve all existing heatmap, trail, status, message-marker, and setup-mode
  behavior when the overlay is unavailable.

## Non-goals

- Estimating or configuring map rotation.
- Adjusting or estimating SVG scale.
- Persisting trim settings on the server or sharing them between browsers.
- Filling working areas or islands.
- Using the SVG as a raster image or executable browser SVG.
- Editing mower work areas, stay-out zones, guides, or other Husqvarna map
  data.
- Treating the overlay as a navigation or safety boundary.
- Correcting GPS drift or reconciling Husqvarna's local map with a formal GIS
  coordinate reference system.

## Existing behavior

`src/amconnect.js` stores each position event with the mower activity and the
current activity-derived `session_id`. A transition into `GOING_HOME` therefore
creates a session whose position rows trace the return to the charging station.
The subsequent `PARKED_IN_CS` or `CHARGING` activity event has no position, so
the final position in the preceding `GOING_HOME` session is the best available
charging-station GPS estimate.

The browser currently sends position payload coordinates directly to Leaflet
and fits the map to recorded heatmap positions. It has no local-coordinate or
SVG georeferencing layer. Setup mode already supports draft preview, Save,
Cancel, and Reset for heatmap settings stored in `localStorage`.

## Architecture

The feature is divided into four focused responsibilities:

1. A Husqvarna map client downloads and caches generated SVG documents.
2. An SVG geometry parser validates the document and returns data-only local
   geometry.
3. A database helper identifies a stable charging-station GPS anchor.
4. Browser modules validate per-mower trim settings, convert local points to
   latitude/longitude, and manage the Leaflet overlay layer.

The server exposes a mower-specific endpoint that composes the parsed geometry
and current anchor. The browser never receives the bearer token, API key, or raw
upstream SVG. It receives only finite numeric point arrays and selected SVG
metadata.

Geometry and anchor lifecycles remain separate. Parsed geometry is cached
because generated maps change infrequently. The charging-station anchor is read
from the database for each local endpoint request so a newly completed
`GOING_HOME` session can establish or update the overlay without waiting for
the geometry cache to expire.

## Husqvarna map download

For mower ID `mowerId`, the server requests:

```text
GET https://api.amc.husqvarna.dev/v1/mowers/{mowerId}/maps/generated
```

The mower ID is URL-encoded. The request uses the same headers as the existing
Automower API calls:

```text
Authorization-Provider: husqvarna
Authorization: Bearer <access token>
X-Api-Key: <API key>
```

The server refreshes the access token and retries once after a `401` or `403`.
It does not retry other failures within the same request. Network failures,
timeouts, non-success statuses, oversized responses, and invalid documents are
reported without exposing upstream response bodies, credentials, or tokens.

Only mower IDs already known through current mower state or stored mower data
may be requested. The local endpoint must not become an authenticated proxy for
arbitrary mower IDs.

## Geometry cache

Successfully parsed geometry is cached in memory by mower ID for one hour. A
cache entry records the parsed geometry, upstream SVG metadata, and fetch time.

- A request within the one-hour lifetime uses cached geometry.
- The first request after expiry attempts an upstream refresh.
- If refresh succeeds, the new geometry atomically replaces the old entry.
- If refresh fails and an old entry exists, the server returns the old geometry
  with `stale: true`.
- If refresh fails and no entry exists, the endpoint reports map
  unavailability.
- Cache state is process-local and may be empty after application restart.

Concurrent requests for the same uncached or expired mower map share one
in-flight download rather than issuing duplicate upstream requests.

## SVG parsing and validation

The server parses XML with a standards-compliant XML parser. It rejects
documents containing a `DOCTYPE` or external entity declaration, does not
resolve external resources, and must not extract elements with regular
expressions or pass raw SVG markup to the browser.

Supported geometry is intentionally narrow:

- `polygon` elements whose IDs begin with `main_area_`
- `polygon` elements whose IDs begin with `island_`
- `polyline` elements whose IDs begin with `guide_`
- the `polyline` whose ID is `lona_cs`

For each supported element, the parser returns its ID, optional title, type,
and ordered array of `{ x, y }` finite numeric points. Polygon point arrays are
treated as closed during Leaflet rendering even if the final source point does
not repeat the first point. Polylines remain open. Source `fill`, `stroke`,
`stroke-width`, scripts, external references, embedded images, styles, event
handlers, and all unsupported elements are ignored.

The parser also returns these allowed root metadata values when present:

- `map-creation-datetime`
- `map-version`
- `post-processing-commit`
- `post-processing-branch`

The local station origin is the first point of `lona_cs`. In the reference SVG,
this is `(-1316, 959)` and is also the first point of `guide_1`. Guide
coincidence is useful validation evidence but is not required because a valid
map may not contain a guide. A missing `lona_cs`, a `lona_cs` without at least
two finite points, or unsupported/missing working-area geometry makes the map
invalid for this feature.

The parser rejects a document larger than 2 MiB, more than 256 supported
geometry elements, more than 10,000 points in one element, or more than 50,000
supported points in total. These limits comfortably exceed the reference
`hq.svg` while bounding server work and browser payload size.

## Charging-station anchor selection

The database adds a helper that returns the latest reliable charging-station
anchor for one mower. It operates only on stored `positions` rows with:

- the requested `mower_id`
- `activity = 'GOING_HOME'`
- non-null, finite latitude and longitude
- a non-null `session_id`
- a valid timestamp

Eligible rows are grouped by `session_id`. The helper identifies the eligible
session with the latest maximum timestamp, then returns that session's final
position by timestamp. The result contains:

- latitude
- longitude
- timestamp
- session ID
- source activity, always `GOING_HOME`

If the current in-memory mower activity is `GOING_HOME`, the current in-memory
`sessionId` is excluded. This prevents the overlay from moving while the mower
is still approaching the station. The helper then falls back to the previous
eligible `GOING_HOME` session. If there is no previous session, the anchor is
unavailable until the current return-home sequence completes and the mower
leaves `GOING_HOME` state.

If the mower is not currently `GOING_HOME`, its latest `GOING_HOME` session is
eligible and its final position becomes the anchor. This design relies on the
observed event sequence rather than claiming that the telemetry explicitly
labels a charging-station coordinate.

## Local map endpoint

The server exposes:

```text
GET /api/mowers/:mowerId/map
```

A ready response has this conceptual shape:

```json
{
  "status": "ready",
  "mowerId": "mower-id",
  "stale": false,
  "fetchedAt": "2026-07-13T12:00:00.000Z",
  "metadata": {
    "creationDateTime": "2025-07-20 20:12:21",
    "mapVersion": "2.1",
    "postProcessingCommit": "93d840b7",
    "postProcessingBranch": "PP_RB59"
  },
  "coordinateSystem": {
    "unitsPerMetre": 1000,
    "xAxis": "east",
    "yAxis": "south",
    "rotationDegrees": 0,
    "stationOrigin": { "x": -1316, "y": 959 }
  },
  "geometry": {
    "workingAreas": [
      { "id": "main_area_0", "title": "Working area 0", "points": [] }
    ],
    "islands": [],
    "guides": [],
    "chargingStationLine": {
      "id": "lona_cs",
      "points": []
    }
  },
  "anchor": {
    "lat": 55.7,
    "lon": 13.2,
    "timestamp": "2026-07-13T11:00:00.000Z",
    "sessionId": 1783940400000,
    "sourceActivity": "GOING_HOME"
  }
}
```

The endpoint has two successful machine-readable states and three
machine-readable error outcomes:

- `ready`: geometry and anchor are both available.
- `anchor-unavailable`: valid geometry exists but no eligible anchor exists.
- `MAP_NOT_AVAILABLE`: Husqvarna reports no generated map for the mower.
- `MAP_FETCH_FAILED`: the upstream request failed and no cached geometry exists.
- `MAP_INVALID`: the returned document cannot produce supported geometry and no
  cached geometry exists.

`anchor-unavailable` returns normalized geometry and a null anchor so the
browser can explain precisely why it cannot render. Error responses use the
repository's existing `{ error: { code, message } }` envelope and must not
include the upstream response body. The endpoint mappings are:

- `200` with `status: "ready"` for complete geometry and anchor data
- `200` with `status: "anchor-unavailable"`, geometry, and `anchor: null`
- `404` with `UNKNOWN_MOWER` for a mower ID unknown to the application
- `404` with `MAP_NOT_AVAILABLE` when Husqvarna reports no generated map
- `502` with `MAP_FETCH_FAILED` when the upstream request fails and no cached
  geometry exists
- `502` with `MAP_INVALID` when the upstream document is invalid and no cached
  geometry exists

Browser behavior is driven by the stable status or error code rather than
prose.

## Coordinate conversion

For SVG point `(x, y)`, station origin `(originX, originY)`, and selected
mower's saved trim:

```text
eastMetres  = (x - originX) / 1000 + eastTrimMetres
northMetres = (originY - y) / 1000 + northTrimMetres
```

Positive east trim moves the entire overlay east. Positive north trim moves it
north. The reversed Y subtraction converts the SVG's down-positive Y axis into
north-positive local metres.

At the small extent of this map, the browser uses a local tangent-plane
approximation around the station anchor:

```text
latitude  = anchorLatitude
          + northMetres / earthRadiusMetres * 180 / pi

longitude = anchorLongitude
          + eastMetres
            / (earthRadiusMetres * cos(anchorLatitudeRadians))
            * 180 / pi
```

`earthRadiusMetres` is `6378137`. The conversion accepts only finite source,
anchor, and trim values and does not mutate cached source geometry. Converting
the station-origin point with zero trim returns the anchor coordinate.

## Browser overlay rendering

The browser maintains a dedicated Leaflet layer group for mower-map geometry.
On a successful response it fully builds the replacement layer off-map, then
replaces the previous layer atomically. A failed refresh leaves the last
successfully rendered layer visible only when the server response explicitly
served stale geometry for the same mower; switching mower always clears the old
mower's overlay before displaying another mower's data.

All geometry is rendered without fill:

- Working areas use a two-pixel green boundary line.
- Islands use a two-pixel warm red boundary line.
- Guides use a three-pixel blue line.
- `lona_cs` uses a three-pixel amber charging-station reference line.

The overlay is non-interactive and appears above the base map and heatmap but
below mower endpoint and message markers. Leaflet stroke weights remain
screen-consistent while zooming. Source SVG color and width attributes do not
control browser styling. In particular, every polyline is explicitly unfilled
so SVG's default black fill cannot close the guide between its final and first
points.

The overlay does not replace the existing position-driven `fitBounds`
behavior. Heatmap and trail points remain responsible for the current map
viewport.

The browser requests map data when the selected mower changes and as part of
the existing data refresh flow. It may skip geometry reconstruction when the
mower, map metadata/fetch identity, anchor, and active trim are unchanged.

## Per-mower trim settings

Overlay trim is stored separately from heatmap settings under the versioned
`localStorage` key `automower.mapOverlaySettings.v1`:

```json
{
  "version": 1,
  "mowers": {
    "mower-id": {
      "eastMetres": 0,
      "northMetres": 0
    }
  }
}
```

Settings are isolated by mower ID. A missing record, invalid JSON, unknown
version, invalid mower map, or non-finite individual value falls back to zero
for the affected values. Normalization does not modify other mowers' valid
settings.

The existing Settings tab gains a `Boundary overlay` section for the selected
mower with:

- East/west offset from `-20.0` to `20.0` metres in `0.1 m` steps
- North/south offset from `-20.0` to `20.0` metres in `0.1 m` steps
- Visible signed values with metre units
- A reset action that sets both draft offsets to zero

Entering setup mode copies both heatmap settings and the selected mower's
overlay settings into drafts. Trim changes redraw the overlay immediately from
unchanged source geometry. Save normalizes and persists both groups of
settings. Cancel discards both drafts and restores the previously saved
heatmap and overlay. Reset affects draft values only until Save. If browser
storage cannot be written, setup mode remains open and shows a concise error
rather than claiming success.

Changing the selected mower loads that mower's saved trim and never reuses the
previous mower's draft or saved offsets.

## Empty and error states

Overlay failures remain isolated from the existing map experience. The base
map, heatmap, recent trail, markers, status, and live refresh continue to work.

The browser omits the overlay and presents a concise, non-blocking explanation
in the Settings section when:

- the mower has no generated map
- the generated map cannot be fetched or parsed
- no completed `GOING_HOME` anchor is available yet
- returned geometry or coordinates are invalid

Saved trim is retained while the map or anchor is unavailable. Recovery occurs
on a later normal refresh without requiring the user to re-enter settings.

Server logs identify the mower, operation, status, and whether stale geometry
was used, but never log credentials, bearer tokens, raw upstream response
bodies, or complete SVG contents.

## Testing

### SVG parser tests

Use a focused fixture derived from `hq.svg` and small purpose-built fixtures to
verify:

- working-area, island, guide, and `lona_cs` extraction
- metadata normalization
- ordered finite point parsing, including negative coordinates
- station origin selection from the first `lona_cs` point
- open polylines and closed polygon semantics
- ignored fill, stroke, style, script, and unsupported elements
- rejection of malformed XML, missing working area, missing or invalid
  `lona_cs`, malformed point lists, and configured safety-limit violations

### Husqvarna client and cache tests

With a mocked fetch and token provider, verify:

- URL encoding and required request headers
- successful parsing and caching
- cache hits within one hour
- one shared in-flight request for concurrent misses
- refresh after expiry
- token refresh and one retry after `401` or `403`
- no retry loop for repeated authentication failure
- stale-cache fallback after refresh failure
- safe failure without a previous cache entry

### Database anchor tests

Using the PostgreSQL test database, verify that the helper:

- reads only the requested mower's `GOING_HOME` rows
- ignores rows without a session, timestamp, or usable coordinates
- takes the final timestamped row from a session
- selects the most recent eligible session
- excludes the current active `GOING_HOME` session ID
- falls back to the preceding completed session
- returns no anchor when only an active return-home session exists

### Coordinate and settings tests

Browser-module unit tests verify:

- station origin maps exactly to the anchor with zero trim
- positive 1,000-unit X produces one metre east
- positive 1,000-unit Y produces one metre south
- positive east and north trims move in their named directions
- conversion does not mutate source geometry
- invalid coordinates prevent layer construction
- missing, malformed, unknown-version, and partially invalid browser settings
  normalize safely
- mower settings remain isolated
- Reset, Save, and Cancel preserve their draft semantics

### Endpoint and regression tests

Server tests verify known-mower validation, ready and unavailable response
shapes, safe error envelopes, and stale metadata. Existing tests must continue
to pass, including status, position payload, heatmap settings, database, and
SSE refresh behavior.

Manual browser verification covers:

- outline-only working area, island, guide, and station rendering
- layer order relative to heatmap and markers
- absence of the accidental black guide fill
- correct north/south inversion
- live east/west and north/south trim preview
- Save, Cancel, Reset, and per-mower isolation
- stable line appearance while zooming
- correct recovery when geometry or an anchor becomes available later
- plausible alignment against recorded mower positions and a map extent of
  approximately 51 by 47 metres for the reference SVG

## Acceptance criteria

- Selecting a mower with a valid generated map and an eligible completed
  `GOING_HOME` session displays unfilled map boundaries aligned around the
  inferred charging station.
- The reference SVG is interpreted as approximately 51 by 47 metres, not
  kilometres.
- SVG X maps east and SVG Y is inverted so positive source Y maps south.
- Working areas, islands, guides, and `lona_cs` remain separate styled Leaflet
  vector layers with no polygon or polyline fill.
- An active `GOING_HOME` session never moves the overlay anchor.
- Per-mower translation trim previews immediately and survives reload after
  Save.
- Cancel and Reset follow the existing setup-mode semantics.
- Missing map data, invalid SVG, upstream failure, missing anchor, or invalid
  browser storage does not break existing map functionality.
- Husqvarna credentials and raw SVG content never reach the browser.
- Automated tests cover parsing, fetching, caching, anchor selection,
  conversion, settings, endpoint behavior, and regressions.
