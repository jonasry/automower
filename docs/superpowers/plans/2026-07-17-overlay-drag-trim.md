# Overlay Drag Trim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a direct two-dimensional map drag adjust the selected mower's draft SVG trim while Settings is open, without panning the Leaflet map.

**Architecture:** Add a small pure browser module that converts a geographic pointer displacement into east/north metre offsets from the gesture's initial trim. Integrate it into `public/map.js` with pointer capture and explicit Leaflet drag-handler transitions, reuse the existing draft settings/render pipeline, and add a trim-mode cursor without changing layout.

**Tech Stack:** JavaScript ES modules, Leaflet, browser Pointer Events, Node.js built-in test runner, CSS.

## Global Constraints

- Node.js 18 or later.
- Keep normal Leaflet drag-to-pan behavior outside Settings.
- Keep the map center stationary during an overlay trim drag.
- A diagonal drag updates east/west and north/south trim together and the overlay follows the pointer directly.
- Keep the existing -20 m to +20 m trim limits and 0.1 m range controls.
- Save persists draft trim, Cancel discards it, and Reset sets both axes to zero.
- Do not change server, database, SVG parsing, storage format, dependencies, or HTML layout.
- Use modern ES modules, async/await where applicable, two-space indentation, and single quotes.

---

## File Structure

- Create `public/mapOverlayDrag.js`: pure geographic drag-to-trim conversion.
- Create `public/mapOverlayDrag.test.js`: direction, diagonal composition, initial-trim stability, and invalid-input tests.
- Modify `public/map.js`: Settings-mode map dragging, pointer gesture state, draft updates, cleanup, and cursor classes.
- Modify `public/mapOverlayUi.test.js`: source-level integration assertions following the repository's existing browser UI test style.
- Modify `public/map.css`: trim-mode `grab` and active `grabbing` cursors.
- Modify `public/mapCss.test.js`: cursor-rule assertions.

### Task 1: Geographic Drag Conversion

**Files:**
- Create: `public/mapOverlayDrag.js`
- Create: `public/mapOverlayDrag.test.js`

**Interfaces:**
- Consumes: `{ eastMetres: number, northMetres: number }` and Leaflet-like `{ lat: number, lng: number }` values.
- Produces: `trimFromGeographicDrag(initialTrim, startLatLng, currentLatLng)`, returning `{ eastMetres, northMetres }` for valid input or `null` for invalid input.

- [ ] **Step 1: Write the failing conversion tests**

Create `public/mapOverlayDrag.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { trimFromGeographicDrag } from './mapOverlayDrag.js';

const closeTo = (actual, expected, tolerance = 0.0001) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`
  );
};

test('decomposes a diagonal drag into east and north trim', () => {
  const trim = trimFromGeographicDrag(
    { eastMetres: 2, northMetres: -1 },
    { lat: 60, lng: 15 },
    { lat: 60.00001, lng: 15.00002 }
  );

  closeTo(trim.eastMetres, 3.1131949);
  closeTo(trim.northMetres, 0.1131949);
});

test('keeps horizontal and vertical drag directions direct', () => {
  const west = trimFromGeographicDrag(
    { eastMetres: 0, northMetres: 0 },
    { lat: 60, lng: 15 },
    { lat: 60, lng: 14.99999 }
  );
  const south = trimFromGeographicDrag(
    { eastMetres: 0, northMetres: 0 },
    { lat: 60, lng: 15 },
    { lat: 59.99999, lng: 15 }
  );

  assert.ok(west.eastMetres < 0);
  closeTo(west.northMetres, 0);
  closeTo(south.eastMetres, 0);
  assert.ok(south.northMetres < 0);
});

test('calculates every move from the gesture initial trim', () => {
  const initialTrim = { eastMetres: 5, northMetres: 7 };
  const start = { lat: 60, lng: 15 };

  const halfway = trimFromGeographicDrag(
    initialTrim,
    start,
    { lat: 60.000005, lng: 15.000005 }
  );
  const finished = trimFromGeographicDrag(
    initialTrim,
    start,
    { lat: 60.00001, lng: 15.00001 }
  );

  closeTo(finished.eastMetres - initialTrim.eastMetres, 2 * (
    halfway.eastMetres - initialTrim.eastMetres
  ));
  closeTo(finished.northMetres - initialTrim.northMetres, 2 * (
    halfway.northMetres - initialTrim.northMetres
  ));
});

test('returns null for non-finite input or a polar reference latitude', () => {
  assert.equal(trimFromGeographicDrag(
    { eastMetres: Number.NaN, northMetres: 0 },
    { lat: 60, lng: 15 },
    { lat: 60, lng: 15 }
  ), null);
  assert.equal(trimFromGeographicDrag(
    { eastMetres: 0, northMetres: 0 },
    { lat: 90, lng: 15 },
    { lat: 90, lng: 15.1 }
  ), null);
});
```

- [ ] **Step 2: Run the test and verify the RED state**

Run:

```bash
node --test public/mapOverlayDrag.test.js
```

Expected: FAIL because `public/mapOverlayDrag.js` does not exist.

- [ ] **Step 3: Implement the pure conversion**

Create `public/mapOverlayDrag.js`:

```js
const EARTH_RADIUS_METRES = 6378137;
const DEGREES_TO_RADIANS = Math.PI / 180;

export function trimFromGeographicDrag(
  initialTrim,
  startLatLng,
  currentLatLng
) {
  const eastMetres = initialTrim?.eastMetres;
  const northMetres = initialTrim?.northMetres;
  const startLat = startLatLng?.lat;
  const startLng = startLatLng?.lng;
  const currentLat = currentLatLng?.lat;
  const currentLng = currentLatLng?.lng;
  const values = [
    eastMetres,
    northMetres,
    startLat,
    startLng,
    currentLat,
    currentLng
  ];

  if (!values.every(Number.isFinite) || Math.abs(startLat) >= 90) return null;

  const referenceLatitude = startLat * DEGREES_TO_RADIANS;
  return {
    eastMetres: eastMetres +
      (currentLng - startLng) * DEGREES_TO_RADIANS *
      EARTH_RADIUS_METRES * Math.cos(referenceLatitude),
    northMetres: northMetres +
      (currentLat - startLat) * DEGREES_TO_RADIANS * EARTH_RADIUS_METRES
  };
}
```

- [ ] **Step 4: Run the focused tests and verify the GREEN state**

Run:

```bash
node --test public/mapOverlayDrag.test.js public/mapProjection.test.js public/mapOverlaySettings.test.js
```

Expected: all tests PASS with no warnings.

- [ ] **Step 5: Commit the conversion unit**

```bash
git add public/mapOverlayDrag.js public/mapOverlayDrag.test.js
git commit -m "Add overlay drag trim conversion"
```

### Task 2: Settings-Mode Pointer Integration

**Files:**
- Modify: `public/map.js:9-16,26-49,212-260,827-869`
- Modify: `public/mapOverlayUi.test.js:1-51`
- Modify: `public/map.css:182-200`
- Modify: `public/mapCss.test.js:1-28`

**Interfaces:**
- Consumes: `trimFromGeographicDrag(initialTrim, startLatLng, currentLatLng)` from Task 1, existing `getMowerTrim`, `setMowerTrim`, `renderOverlayControls`, and `redrawMapOverlayPreview`.
- Produces: Settings-mode pointer drag behavior that mutates only `draftMapOverlaySettings`, plus `is-overlay-trim-mode` and `is-overlay-trim-dragging` cursor classes.

- [ ] **Step 1: Write failing integration and cursor tests**

Append to `public/mapOverlayUi.test.js`:

```js
test('uses map dragging as two-dimensional draft trim in Settings', () => {
  assert.match(source, /trimFromGeographicDrag/);
  assert.match(source, /map\.dragging\.disable\(\)/);
  assert.match(source, /map\.dragging\.enable\(\)/);
  assert.match(source, /addEventListener\('pointerdown', beginOverlayTrimDrag\)/);
  assert.match(source, /addEventListener\('pointermove', updateOverlayTrimDrag\)/);
  assert.match(source, /setMowerTrim\([\s\S]+drag\.mowerId[\s\S]+nextTrim/);
  assert.match(source, /renderOverlayControls\(draftMapOverlaySettings\)/);
  assert.match(source, /redrawMapOverlayPreview\(draftMapOverlaySettings\)/);
});

test('cleans up an overlay trim gesture on every terminal pointer event', () => {
  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    assert.match(
      source,
      new RegExp(`addEventListener\\('${eventName}', finishOverlayTrimDrag\\)`)
    );
  }
});
```

Append to `public/mapCss.test.js`:

```js
test('shows direct manipulation cursors during overlay trim', () => {
  assert.equal(
    declarationsFor('#map.is-overlay-trim-mode').cursor,
    'grab'
  );
  assert.equal(
    declarationsFor('#map.is-overlay-trim-mode.is-overlay-trim-dragging').cursor,
    'grabbing'
  );
});
```

- [ ] **Step 2: Run the integration tests and verify the RED state**

Run:

```bash
node --test public/mapOverlayUi.test.js public/mapCss.test.js
```

Expected: FAIL because pointer integration, Leaflet drag transitions, and cursor rules are absent.

- [ ] **Step 3: Add pointer state and draft updates to `public/map.js`**

Import the Task 1 helper:

```js
import { trimFromGeographicDrag } from './mapOverlayDrag.js';
```

Add state beside the existing map settings state and cache the Leaflet
container after DOM lookup:

```js
let overlayTrimDrag = null;
let restoreMapDragging = false;

const mapContainer = map.getContainer();
```

Add the gesture functions before `setPanelMode`:

```js
function beginOverlayTrimDrag(event) {
  const canStart = isConfigMode &&
    event.isPrimary !== false &&
    (event.pointerType !== 'mouse' || event.button === 0) &&
    selectedMowerId &&
    latestMapPayload?.status === 'ready' &&
    draftMapOverlaySettings;
  if (!canStart) return;

  overlayTrimDrag = {
    pointerId: event.pointerId,
    mowerId: selectedMowerId,
    initialTrim: getMowerTrim(draftMapOverlaySettings, selectedMowerId),
    startLatLng: map.mouseEventToLatLng(event)
  };
  mapContainer.setPointerCapture(event.pointerId);
  mapContainer.classList.add('is-overlay-trim-dragging');
  event.preventDefault();
}

function updateOverlayTrimDrag(event) {
  const drag = overlayTrimDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;

  const nextTrim = trimFromGeographicDrag(
    drag.initialTrim,
    drag.startLatLng,
    map.mouseEventToLatLng(event)
  );
  if (!nextTrim || drag.mowerId !== selectedMowerId) return;

  draftMapOverlaySettings = setMowerTrim(
    draftMapOverlaySettings,
    drag.mowerId,
    nextTrim
  );
  renderOverlayControls(draftMapOverlaySettings);
  redrawMapOverlayPreview(draftMapOverlaySettings);
  event.preventDefault();
}

function finishOverlayTrimDrag(event) {
  const drag = overlayTrimDrag;
  if (!drag || (event && event.pointerId !== drag.pointerId)) return;

  overlayTrimDrag = null;
  mapContainer.classList.remove('is-overlay-trim-dragging');
  if (
    event?.type !== 'lostpointercapture' &&
    mapContainer.hasPointerCapture(drag.pointerId)
  ) {
    mapContainer.releasePointerCapture(drag.pointerId);
  }
}
```

Replace `setPanelMode` with a transition-aware version that preserves the
map's pre-Settings drag-handler state:

```js
function setPanelMode(mode) {
  const wasConfigMode = isConfigMode;
  isConfigMode = mode === 'config';

  if (isConfigMode && !wasConfigMode) {
    restoreMapDragging = map.dragging.enabled();
    map.dragging.disable();
    mapContainer.classList.add('is-overlay-trim-mode');
  } else if (!isConfigMode && wasConfigMode) {
    finishOverlayTrimDrag();
    mapContainer.classList.remove('is-overlay-trim-mode');
    if (restoreMapDragging) map.dragging.enable();
    restoreMapDragging = false;
  }

  statusPanelContent.hidden = isConfigMode;
  configPanelContent.hidden = !isConfigMode;
}
```

End an active gesture before mower selection changes, and register the map
container listeners near the other event listeners:

```js
mowerPicker.addEventListener('change', () => {
  if (!mowerPicker.value) return;
  finishOverlayTrimDrag();
  latestMapRequestId += 1;
  clearMapOverlay();
  selectedMowerId = mowerPicker.value;
  selectedSessionId = 'latest';
  if (isConfigMode) {
    draftMapOverlaySettings = structuredClone(mapOverlaySettings);
    renderOverlayControls(draftMapOverlaySettings);
  }
  resetMapFit();
  const context = renderStatus();
  Promise.all([loadData(context), loadMapOverlay()]);
});

mapContainer.addEventListener('pointerdown', beginOverlayTrimDrag);
mapContainer.addEventListener('pointermove', updateOverlayTrimDrag);
mapContainer.addEventListener('pointerup', finishOverlayTrimDrag);
mapContainer.addEventListener('pointercancel', finishOverlayTrimDrag);
mapContainer.addEventListener('lostpointercapture', finishOverlayTrimDrag);
```

- [ ] **Step 4: Add the trim cursor rules to `public/map.css`**

Place these rules immediately after the existing `#map` rule:

```css
#map.is-overlay-trim-mode {
  cursor: grab;
}

#map.is-overlay-trim-mode.is-overlay-trim-dragging {
  cursor: grabbing;
}
```

- [ ] **Step 5: Run focused tests and verify the GREEN state**

Run:

```bash
node --test public/mapOverlayDrag.test.js public/mapOverlayUi.test.js public/mapCss.test.js public/mapOverlaySettings.test.js public/mapProjection.test.js public/mapSettingsTransaction.test.js
```

Expected: all focused tests PASS with no warnings.

- [ ] **Step 6: Run formatting and diff checks**

Run:

```bash
git diff --check
```

Expected: exit code 0 with no output.

- [ ] **Step 7: Commit the pointer integration**

```bash
git add public/map.js public/mapOverlayUi.test.js public/map.css public/mapCss.test.js
git commit -m "Use map dragging to trim overlay"
```

### Task 3: Feature Verification

**Files:**
- Verify only; no planned source changes.

**Interfaces:**
- Consumes: completed Tasks 1 and 2.
- Produces: verification evidence that focused browser behavior and the repository test suite remain healthy.

- [ ] **Step 1: Run all standalone browser tests**

Run:

```bash
node --test public/*.test.js
```

Expected: all browser tests PASS.

- [ ] **Step 2: Run the complete repository test suite**

Run:

```bash
npm test
```

Expected: all tests PASS. If `TEST_DATABASE_URL` is not configured or the
dedicated PostgreSQL test database is unavailable, record that environmental
blocker and retain the passing standalone browser-test result.

- [ ] **Step 3: Inspect the final branch diff and commits**

Run:

```bash
git status --short
git diff main...HEAD --check
git log --oneline main..HEAD
```

Expected: the worktree is clean, the diff check has no output, and the branch
contains the plan plus the two focused implementation commits.
