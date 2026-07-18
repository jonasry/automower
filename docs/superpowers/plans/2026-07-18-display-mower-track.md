# Display Mower Track Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a checked-by-default checkbox that instantly hides or restores the selected session's mower track without affecting the heatmap or session information.

**Architecture:** Keep the preference as page-local state represented by the checkbox itself. Cache the latest `recent` positions in `public/map.js`, centralize removal of the Leaflet track layer, and make track rendering honor the checkbox while leaving heatmap, message-marker, boundary-overlay, and session-stat rendering unchanged.

**Tech Stack:** Browser HTML/CSS, modern JavaScript ES modules, Leaflet, Node.js built-in test runner and strict assertions.

## Global Constraints

- The checkbox label is exactly **Display Mower Track**.
- The checkbox is checked on every page load and is not persisted.
- The checkbox hides only track point markers, the dashed track line, and session start/end endpoint markers.
- The coverage heatmap, boundary overlay, warning/error location markers, mower/session selection, event log, and status information remain unaffected.
- Session Start, End, Duration, and Points remain visible and unchanged.
- Toggling does not issue an API request.

---

### Task 1: Add the Checked-by-Default Session Control

**Files:**
- Create: `public/mapTrackVisibility.test.js`
- Modify: `public/map.html:67-72`
- Modify: `public/map.css:417-425`

**Interfaces:**
- Consumes: the existing Session history panel section in `public/map.html`.
- Produces: `input#displayMowerTrack`, a checked checkbox read by Task 2, and `.track-toggle` styling for its label.

- [ ] **Step 1: Write the failing control test**

Create `public/mapTrackVisibility.test.js` with:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./map.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('./map.css', import.meta.url), 'utf8');
const source = readFileSync(new URL('./map.js', import.meta.url), 'utf8');

test('provides a checked-by-default Display Mower Track checkbox', () => {
  assert.match(
    html,
    /<label class="track-toggle" for="displayMowerTrack">[\s\S]+<input id="displayMowerTrack" type="checkbox" checked \/>[\s\S]+<span>Display Mower Track<\/span>[\s\S]+<\/label>/
  );
  assert.match(css, /\.track-toggle\s*\{/);
  assert.match(css, /\.track-toggle input\s*\{/);
});
```

- [ ] **Step 2: Run the test and verify the missing control causes failure**

Run:

```bash
node --test public/mapTrackVisibility.test.js
```

Expected: FAIL in `provides a checked-by-default Display Mower Track checkbox` because `map.html` does not contain `displayMowerTrack`.

- [ ] **Step 3: Add the accessible checked checkbox**

In `public/map.html`, place this label immediately after `sessionSelect` and before the panel section closes:

```html
            <label class="track-toggle" for="displayMowerTrack">
              <input id="displayMowerTrack" type="checkbox" checked />
              <span>Display Mower Track</span>
            </label>
```

- [ ] **Step 4: Style the checkbox consistently with the session panel**

In `public/map.css`, immediately after the `.session-select` rule, add:

```css
.track-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  width: max-content;
  max-width: 100%;
  margin-top: 12px;
  color: var(--text);
  font-weight: 700;
  cursor: pointer;
}

.track-toggle input {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--accent);
  cursor: pointer;
}

.track-toggle input:focus-visible {
  outline: 3px solid rgba(95, 143, 105, 0.28);
  outline-offset: 2px;
}
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run:

```bash
node --test public/mapTrackVisibility.test.js
```

Expected: PASS with 1 test and 0 failures.

- [ ] **Step 6: Commit the control**

```bash
git add public/map.html public/map.css public/mapTrackVisibility.test.js
git commit -m "Add mower track display control"
```

---

### Task 2: Toggle the Cached Leaflet Track Layer

**Files:**
- Modify: `public/mapTrackVisibility.test.js`
- Modify: `public/map.js:27-55, 559-574, 688-719, 766-776, 917-925`

**Interfaces:**
- Consumes: `input#displayMowerTrack` from Task 1 and the existing `recent` positions array returned by `/api/positions`.
- Produces: `latestRecent: Array<[number, number, ...unknown[]]>`, `clearRecentPath(): void`, and checkbox-driven calls to `renderRecentPath(latestRecent)`.

- [ ] **Step 1: Add failing tests for caching and conditional rendering**

Append these tests to `public/mapTrackVisibility.test.js`:

```js
test('caches session positions and renders the track only while checked', () => {
  assert.match(source, /let latestRecent = \[\];/);
  assert.match(
    source,
    /function renderRecentPath\(recent\) \{\s+latestRecent = recent;\s+clearRecentPath\(\);\s+if \(!displayMowerTrack\.checked\) return;/
  );
  assert.match(
    source,
    /displayMowerTrack\.addEventListener\('change', \(\) => \{\s+renderRecentPath\(latestRecent\);\s+\}\);/
  );
});

test('removes only the mower track layer when visibility changes', () => {
  assert.match(
    source,
    /function clearRecentPath\(\) \{\s+if \(!recentLayer\) return;\s+map\.removeLayer\(recentLayer\);\s+recentLayer = null;\s+\}/
  );
  assert.match(
    source,
    /function clearLayers\(\) \{[\s\S]+clearRecentPath\(\);[\s\S]+if \(messageLayer\)/
  );
});

test('keeps message markers and session statistics independent of track visibility', () => {
  assert.match(
    source,
    /renderHeatmap\([\s\S]+renderRecentPath\(recent\);\s+renderMessageMarkers\([\s\S]+renderSessionStats\(\{ heat, recent, session, summary: context\?\.summary, mower: context\?\.mower \}\);/
  );
});
```

- [ ] **Step 2: Run the tests and verify the missing cache causes failure**

Run:

```bash
node --test public/mapTrackVisibility.test.js
```

Expected: the first control test passes and the three new tests FAIL because `latestRecent`, `clearRecentPath`, and the checkbox change listener do not exist.

- [ ] **Step 3: Add transient track state and the checkbox reference**

In `public/map.js`, add `latestRecent` beside the other latest-render state:

```js
let latestHeat = [];
let latestRecent = [];
let latestFitKey = null;
```

Add the checkbox reference beside `sessionSelect`:

```js
const sessionSelect = document.getElementById('sessionSelect');
const displayMowerTrack = document.getElementById('displayMowerTrack');
```

- [ ] **Step 4: Centralize removal of the track layer**

Add this function immediately before `clearLayers`:

```js
function clearRecentPath() {
  if (!recentLayer) return;
  map.removeLayer(recentLayer);
  recentLayer = null;
}
```

Replace the existing `recentLayer` removal block inside `clearLayers` with:

```js
  clearRecentPath();
```

Do not change heat-layer or message-layer cleanup.

- [ ] **Step 5: Cache positions and honor the checkbox in track rendering**

Change the start of `renderRecentPath` to:

```js
function renderRecentPath(recent) {
  latestRecent = recent;
  clearRecentPath();
  if (!displayMowerTrack.checked) return;

  recentLayer = L.layerGroup();
```

Keep the existing circle markers, dashed polyline, endpoint markers, and final `recentLayer.addTo(map)` unchanged.

- [ ] **Step 6: Redraw only from cache when the checkbox changes**

Immediately after the existing `sessionSelect` change listener, add:

```js
displayMowerTrack.addEventListener('change', () => {
  renderRecentPath(latestRecent);
});
```

This handler must not call `loadData`, `fetch`, or any other request function.

- [ ] **Step 7: Run the focused tests and verify all behavior passes**

Run:

```bash
node --test public/mapTrackVisibility.test.js
```

Expected: PASS with 4 tests and 0 failures.

- [ ] **Step 8: Run neighboring browser-map tests**

Run:

```bash
node --test public/mapTrackVisibility.test.js public/mapOverlayUi.test.js public/mapRefresh.test.js
```

Expected: PASS with all tests and 0 failures.

- [ ] **Step 9: Run the complete repository test suite**

Run:

```bash
npm test
```

Expected: PASS with 0 failures. The command uses the repository's isolated PostgreSQL test harness and requires the configured `TEST_DATABASE_URL`.

- [ ] **Step 10: Commit the behavior**

```bash
git add public/map.js public/mapTrackVisibility.test.js
git commit -m "Toggle selected mower session track"
```

---

### Task 3: Verify the Finished Interaction

**Files:**
- Verify: `public/map.html`
- Verify: `public/map.css`
- Verify: `public/map.js`
- Verify: `public/mapTrackVisibility.test.js`

**Interfaces:**
- Consumes: the completed checkbox and Leaflet layer behavior from Tasks 1 and 2.
- Produces: final automated and manual verification evidence for handoff.

- [ ] **Step 1: Check the final diff for unintended persistence or request behavior**

Run:

```bash
git diff HEAD~2 --check
git diff HEAD~2 -- public/map.html public/map.css public/map.js public/mapTrackVisibility.test.js
```

Expected: no whitespace errors; no `localStorage`, storage settings, `loadData`, or `fetch` call is added to the checkbox handler.

- [ ] **Step 2: Manually verify the browser interaction**

Start the configured application:

```bash
npm start
```

Open `http://localhost:3000/map.html` and verify:

1. **Display Mower Track** is checked on initial load.
2. The selected session's point markers, dashed line, and start/end map markers are visible.
3. Unchecking hides those track elements immediately without a loading state.
4. The heatmap, boundary overlay, warning/error map markers, event log, and Start, End, Duration, and Points remain visible and unchanged.
5. Changing the mower or session while unchecked does not show the track.
6. Rechecking shows the newly selected session's cached track without a positions request in the browser network panel.
7. Reloading the page restores the checkbox to checked.

Stop the application with `Ctrl-C` after verification.

- [ ] **Step 3: Record the verification result**

In the implementation handoff, report the exact focused-test and full-suite commands, their pass/fail counts, and whether each of the seven manual checks passed. No additional repository file changes are required for this step.
