# Soft Garden UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Automower map page into a calm home/garden companion UI while preserving the existing `/api/positions` heatmap behavior.

**Architecture:** Keep the app frontend static and backend-compatible, but split the current inline page into focused assets. `public/map.html` owns semantic markup and external includes, `public/map.css` owns the visual system and responsive layout, and `public/map.js` owns Leaflet setup, data loading, temporary status text, and UI state. No backend API changes are required for this slice.

**Tech Stack:** Plain HTML, CSS, JavaScript ES modules-style browser code, Leaflet, `leaflet.heat`, Express static serving, existing `/api/positions`.

---

## File Structure

- Modify: `public/map.html`
  - Replace the dark dashboard structure with semantic app markup.
  - Load `map.css` and `map.js`.
  - Keep Leaflet CDN dependencies.

- Create: `public/map.css`
  - Define the soft garden palette, typography, shell layout, responsive behavior, Leaflet control styling, loading/error states, and reduced-motion behavior.

- Create: `public/map.js`
  - Move existing map initialization and polling out of inline script.
  - Preserve `/api/positions` behavior.
  - Add frontend-only status/session rendering text until live APIs exist.
  - Preserve user map position after the initial fit.

- Optional manual verification only: no automated frontend test framework exists in this repository. Use `npm start` and browser checks.

---

### Task 1: Split The Single-File UI Into Stable Assets

**Files:**
- Modify: `public/map.html`
- Create: `public/map.css`
- Create: `public/map.js`

- [ ] **Step 1: Replace `public/map.html` with semantic markup and asset includes**

Use this complete structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <title>Automower Garden Map</title>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css" />
  <link rel="stylesheet" href="/map.css" />
  <script src="https://unpkg.com/leaflet/dist/leaflet.js"></script>
  <script src="https://unpkg.com/leaflet.heat/dist/leaflet-heat.js"></script>
</head>
<body>
  <div class="app-shell">
    <header class="status-strip" aria-label="Mower status">
      <div class="mower-identity">
        <label class="visually-hidden" for="mowerPicker">Selected mower</label>
        <select id="mowerPicker" class="mower-picker">
          <option value="am415x">AM 415X</option>
        </select>
        <span id="activityBadge" class="status-badge status-badge--active">Mowing now</span>
      </div>

      <div class="status-meta">
        <div class="battery" title="Battery">
          <span class="battery-shell" aria-hidden="true">
            <span id="batteryLevel" class="battery-level" style="--level:45%"></span>
          </span>
          <span id="batteryText" class="battery-text">45%</span>
        </div>
        <span id="freshnessText" class="freshness">Last updated just now</span>
      </div>
    </header>

    <main class="garden-workspace">
      <section class="map-region" aria-label="Garden heatmap">
        <div id="map"></div>
        <div id="mapMessage" class="map-message" hidden></div>
      </section>

      <aside class="session-panel" aria-label="Session details">
        <div class="panel-section">
          <p class="section-kicker">Current session</p>
          <h1 id="sessionTitle">Latest garden run</h1>
          <p id="sessionSummary" class="session-summary">Showing recent path and coverage heat from recorded mower positions.</p>
        </div>

        <div class="metric-grid" aria-label="Session summary">
          <div class="metric">
            <span class="metric-value" id="durationValue">-</span>
            <span class="metric-label">Duration</span>
          </div>
          <div class="metric">
            <span class="metric-value" id="pointsValue">-</span>
            <span class="metric-label">Points</span>
          </div>
          <div class="metric">
            <span class="metric-value" id="coverageValue">7d</span>
            <span class="metric-label">Heat window</span>
          </div>
        </div>

        <div class="panel-section">
          <label class="field-label" for="sessionSelect">Session history</label>
          <select id="sessionSelect" class="session-select">
            <option value="latest">Latest session</option>
          </select>
        </div>

        <div class="panel-section panel-section--quiet">
          <p class="detail-row"><span>Start</span><strong id="startValue">-</strong></p>
          <p class="detail-row"><span>End</span><strong id="endValue">-</strong></p>
          <p class="detail-row"><span>Status</span><strong id="statusValue">Waiting for data</strong></p>
        </div>
      </aside>
    </main>
  </div>

  <script src="/map.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `public/map.css` with a temporary minimal stylesheet**

Use this starter so the page is immediately usable before the full visual pass:

```css
:root {
  --surface: #f7f6ee;
  --panel: #fffff8;
  --text: #1f3328;
  --muted: #667466;
  --border: #d8e1d6;
  --accent: #5f8f69;
}

* {
  box-sizing: border-box;
}

html,
body {
  height: 100%;
  margin: 0;
}

body {
  background: var(--surface);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.app-shell {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.status-strip {
  min-height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 18px;
  background: rgba(255, 255, 248, 0.94);
  border-bottom: 1px solid var(--border);
}

.garden-workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
}

.map-region {
  position: relative;
  min-height: 420px;
}

#map {
  position: absolute;
  inset: 0;
}

.session-panel {
  padding: 20px;
  background: var(--panel);
  border-left: 1px solid var(--border);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

@media (max-width: 760px) {
  .status-strip {
    align-items: flex-start;
    flex-direction: column;
  }

  .garden-workspace {
    display: flex;
    flex-direction: column;
  }

  .map-region {
    min-height: 58svh;
  }

  .session-panel {
    border-left: 0;
    border-top: 1px solid var(--border);
  }
}
```

- [ ] **Step 3: Create `public/map.js` by moving the existing behavior out of inline script**

Use this complete first version:

```js
const gardenGradient = {
  0.2: 'rgba(131, 164, 113, 0.55)',
  0.45: '#7ea36a',
  0.7: '#d8b65f',
  1.0: '#df7f64'
};

const map = L.map('map', {
  zoomControl: true
}).setView([55.7, 13.2], 17);

let heatLayer = null;
let recentLayer = null;
let boundsFitted = false;

function setMapMessage(message) {
  const el = document.getElementById('mapMessage');
  el.hidden = !message;
  el.textContent = message || '';
}

function updateBattery(pct) {
  const clamped = Math.max(0, Math.min(100, pct | 0));
  const level = document.getElementById('batteryLevel');
  const text = document.getElementById('batteryText');
  level.style.setProperty('--level', `${clamped}%`);
  level.dataset.state = clamped < 20 ? 'critical' : clamped < 50 ? 'attention' : 'normal';
  text.textContent = `${clamped}%`;
}

function renderSessionStats({ heat, recent }) {
  document.getElementById('pointsValue').textContent = heat.length ? heat.length.toLocaleString() : '-';
  document.getElementById('durationValue').textContent = recent.length > 1 ? 'Active' : '-';
  document.getElementById('startValue').textContent = recent.length ? 'Recorded' : '-';
  document.getElementById('endValue').textContent = recent.length ? 'Latest' : '-';
  document.getElementById('statusValue').textContent = heat.length ? 'Coverage data loaded' : 'Waiting for data';
}

function clearLayers() {
  if (heatLayer) {
    map.removeLayer(heatLayer);
    heatLayer = null;
  }

  if (recentLayer) {
    map.removeLayer(recentLayer);
    recentLayer = null;
  }
}

function renderHeatmap(heat) {
  if (!heat.length) return;

  heatLayer = L.heatLayer(heat, {
    radius: 11,
    blur: 8,
    maxZoom: 20,
    gradient: gardenGradient
  }).addTo(map);

  if (!boundsFitted) {
    const latLngs = heat.map((point) => L.latLng(point[0], point[1]));
    map.fitBounds(L.latLngBounds(latLngs), { padding: [28, 28] });
    boundsFitted = true;
  }
}

function makeEndpointMarker(className, label) {
  return L.divIcon({
    className: `endpoint-marker ${className}`,
    html: `<span aria-hidden="true"></span><span class="visually-hidden">${label}</span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
}

function renderRecentPath(recent) {
  recentLayer = L.layerGroup();
  const polylinePoints = [];

  recent.forEach(([lat, lon]) => {
    L.circleMarker([lat, lon], {
      radius: 3,
      color: '#315f3c',
      weight: 1,
      fillColor: '#315f3c',
      fillOpacity: 0.85
    }).addTo(recentLayer);
    polylinePoints.push([lat, lon]);
  });

  if (polylinePoints.length > 1) {
    L.polyline(polylinePoints, {
      color: '#315f3c',
      weight: 2.5,
      dashArray: '7, 6',
      opacity: 0.72
    }).addTo(recentLayer);

    const startPoint = polylinePoints[polylinePoints.length - 1];
    const endPoint = polylinePoints[0];
    L.marker(startPoint, { icon: makeEndpointMarker('endpoint-marker--start', 'Session start') }).addTo(recentLayer);
    L.marker(endPoint, { icon: makeEndpointMarker('endpoint-marker--end', 'Latest mower position') }).addTo(recentLayer);
  }

  recentLayer.addTo(map);
}

async function loadData() {
  setMapMessage('');

  try {
    const res = await fetch('/api/positions');
    if (!res.ok) throw new Error(`Positions request failed: ${res.status}`);

    const { heat = [], recent = [] } = await res.json();
    clearLayers();
    renderHeatmap(heat);
    renderRecentPath(recent);
    renderSessionStats({ heat, recent });

    if (!heat.length) {
      setMapMessage('Waiting for mower position data');
    }

    document.getElementById('freshnessText').textContent = 'Last updated just now';
  } catch (err) {
    console.error(err);
    clearLayers();
    renderSessionStats({ heat: [], recent: [] });
    setMapMessage('Could not load mower positions. Retrying soon.');
    document.getElementById('freshnessText').textContent = 'Update delayed';
  }
}

updateBattery(45);
loadData();
setInterval(loadData, 30000);
```

- [ ] **Step 4: Run a static smoke check**

Run:

```bash
npm start
```

Expected:

```text
HTTP server listening at http://localhost:3000/map.html
```

Open `http://localhost:3000/map.html`. Expected: page loads without console syntax errors, map appears, and `/api/positions` is requested.

- [ ] **Step 5: Commit**

```bash
git add public/map.html public/map.css public/map.js
git commit -m "Split map UI assets"
```

---

### Task 2: Apply The Soft Garden Visual System

**Files:**
- Modify: `public/map.css`
- Modify: `public/map.js`

- [ ] **Step 1: Replace starter CSS with the complete visual system**

Update `public/map.css` with these rules:

```css
:root {
  --bg: #f4f5ec;
  --surface: #fffdf4;
  --surface-soft: #edf3e7;
  --surface-glass: rgba(255, 253, 244, 0.9);
  --text: #1d3025;
  --muted: #657466;
  --faint: #8a9788;
  --border: #d7e0d2;
  --accent: #5f8f69;
  --accent-strong: #315f3c;
  --amber: #c79a3d;
  --danger: #b95e4e;
  --shadow: 0 18px 50px rgba(42, 64, 48, 0.14);
  --radius-lg: 20px;
  --radius-md: 12px;
  color-scheme: light;
}

* {
  box-sizing: border-box;
}

html,
body {
  height: 100%;
  margin: 0;
}

body {
  background:
    radial-gradient(circle at 12% 8%, rgba(159, 184, 132, 0.22), transparent 28%),
    linear-gradient(135deg, #f6f4ea 0%, #e8f0e2 100%);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  letter-spacing: 0;
}

button,
select {
  font: inherit;
}

.app-shell {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.status-strip {
  z-index: 600;
  min-height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 18px;
  background: var(--surface-glass);
  border-bottom: 1px solid rgba(215, 224, 210, 0.8);
  box-shadow: 0 8px 24px rgba(42, 64, 48, 0.08);
  backdrop-filter: blur(16px);
}

.mower-identity,
.status-meta,
.battery {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mower-picker,
.session-select {
  min-height: 38px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  padding: 0 34px 0 13px;
  outline: none;
}

.mower-picker {
  max-width: 190px;
  font-weight: 750;
}

.mower-picker:focus,
.session-select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(95, 143, 105, 0.18);
}

.status-badge {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  border-radius: 999px;
  padding: 0 11px;
  background: #e6f0df;
  color: var(--accent-strong);
  font-size: 13px;
  font-weight: 750;
}

.battery-shell {
  position: relative;
  width: 42px;
  height: 18px;
  border: 2px solid #8ba78e;
  border-radius: 6px;
  padding: 2px;
}

.battery-shell::after {
  content: "";
  position: absolute;
  top: 5px;
  right: -6px;
  width: 3px;
  height: 8px;
  border-radius: 2px;
  background: #8ba78e;
}

.battery-level {
  display: block;
  width: var(--level, 0%);
  height: 100%;
  border-radius: 3px;
  background: var(--accent);
  transition: width 180ms ease, background 180ms ease;
}

.battery-level[data-state="attention"] {
  background: var(--amber);
}

.battery-level[data-state="critical"] {
  background: var(--danger);
}

.battery-text,
.freshness {
  color: var(--muted);
  font-size: 14px;
  white-space: nowrap;
}

.garden-workspace {
  position: relative;
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(310px, 350px);
  gap: 16px;
  padding: 16px;
}

.map-region {
  position: relative;
  min-height: 520px;
  overflow: hidden;
  border: 1px solid rgba(215, 224, 210, 0.8);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  background: var(--surface-soft);
}

#map {
  position: absolute;
  inset: 0;
  background: #dfead7;
}

.map-message {
  position: absolute;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  max-width: min(420px, calc(100% - 32px));
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 10px 14px;
  background: var(--surface-glass);
  color: var(--muted);
  box-shadow: 0 12px 30px rgba(42, 64, 48, 0.12);
}

.session-panel {
  align-self: stretch;
  overflow: auto;
  border: 1px solid rgba(215, 224, 210, 0.82);
  border-radius: var(--radius-lg);
  padding: 20px;
  background: var(--surface-glass);
  box-shadow: var(--shadow);
  backdrop-filter: blur(16px);
}

.panel-section + .panel-section,
.metric-grid + .panel-section {
  margin-top: 22px;
}

.section-kicker,
.field-label {
  display: block;
  margin: 0 0 8px;
  color: var(--faint);
  font-size: 12px;
  font-weight: 750;
}

h1 {
  margin: 0;
  color: var(--text);
  font-size: 28px;
  line-height: 1.12;
}

.session-summary {
  margin: 10px 0 0;
  color: var(--muted);
  line-height: 1.45;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.metric {
  min-width: 0;
  border: 1px solid rgba(215, 224, 210, 0.8);
  border-radius: var(--radius-md);
  padding: 12px;
  background: rgba(255, 255, 248, 0.72);
}

.metric-value {
  display: block;
  overflow-wrap: anywhere;
  color: var(--text);
  font-size: 22px;
  font-weight: 800;
  line-height: 1;
}

.metric-label {
  display: block;
  margin-top: 7px;
  color: var(--muted);
  font-size: 12px;
}

.session-select {
  width: 100%;
  border-radius: var(--radius-md);
}

.panel-section--quiet {
  border-top: 1px solid var(--border);
  padding-top: 14px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  margin: 0;
  padding: 9px 0;
  color: var(--muted);
}

.detail-row strong {
  color: var(--text);
  text-align: right;
}

.endpoint-marker span:first-child {
  display: block;
  width: 18px;
  height: 18px;
  border: 3px solid var(--surface);
  border-radius: 999px;
  box-shadow: 0 4px 12px rgba(31, 51, 40, 0.25);
}

.endpoint-marker--start span:first-child {
  background: var(--amber);
}

.endpoint-marker--end span:first-child {
  background: var(--accent-strong);
}

.leaflet-control-zoom a,
.leaflet-control-zoom a:hover {
  background: var(--surface);
  color: var(--text);
  border-color: var(--border);
}

.leaflet-control-attribution {
  background: rgba(255, 253, 244, 0.86);
  color: var(--muted);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (max-width: 880px) {
  .status-strip {
    align-items: flex-start;
    flex-direction: column;
  }

  .status-meta {
    width: 100%;
    justify-content: space-between;
  }

  .garden-workspace {
    display: flex;
    flex-direction: column;
    padding: 12px;
  }

  .map-region {
    min-height: 58svh;
  }

  .session-panel {
    max-height: none;
  }
}

@media (max-width: 520px) {
  .mower-identity,
  .status-meta {
    flex-wrap: wrap;
  }

  .metric-grid {
    grid-template-columns: 1fr;
  }

  h1 {
    font-size: 24px;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

- [ ] **Step 2: Adjust `public/map.js` status text to match the calmer UX language**

Ensure these initial labels exist:

```js
document.getElementById('activityBadge').textContent = 'Mowing now';
document.getElementById('freshnessText').textContent = 'Last updated just now';
document.getElementById('sessionTitle').textContent = 'Latest garden run';
document.getElementById('sessionSummary').textContent = 'Showing recent path and coverage heat from recorded mower positions.';
```

- [ ] **Step 3: Run browser smoke check**

Run:

```bash
npm start
```

Expected: server starts and the page visually uses warm surfaces, muted green status accents, a soft panel, and no dark dashboard shell.

- [ ] **Step 4: Commit**

```bash
git add public/map.css public/map.js
git commit -m "Apply soft garden visual system"
```

---

### Task 3: Improve Map UX, Loading, Empty, And Error States

**Files:**
- Modify: `public/map.js`
- Modify: `public/map.css`

- [ ] **Step 1: Add loading state helpers to `public/map.js`**

Insert these helpers after `setMapMessage`:

```js
function setPanelLoading(isLoading) {
  document.body.classList.toggle('is-loading', isLoading);
}

function setStatusValue(value) {
  document.getElementById('statusValue').textContent = value;
}
```

- [ ] **Step 2: Update `loadData()` to show loading and precise failure states**

Replace the current `loadData()` body with:

```js
async function loadData() {
  setMapMessage('');
  setPanelLoading(true);

  try {
    const res = await fetch('/api/positions');
    if (!res.ok) throw new Error(`Positions request failed: ${res.status}`);

    const { heat = [], recent = [] } = await res.json();
    clearLayers();
    renderHeatmap(heat);
    renderRecentPath(recent);
    renderSessionStats({ heat, recent });

    if (!heat.length) {
      setMapMessage('Waiting for mower position data');
      setStatusValue('Waiting for data');
    } else {
      setStatusValue('Coverage data loaded');
    }

    document.getElementById('freshnessText').textContent = 'Last updated just now';
  } catch (err) {
    console.error(err);
    clearLayers();
    renderSessionStats({ heat: [], recent: [] });
    setMapMessage('Could not load mower positions. Retrying soon.');
    setStatusValue('Update delayed');
    document.getElementById('freshnessText').textContent = 'Update delayed';
  } finally {
    setPanelLoading(false);
  }
}
```

- [ ] **Step 3: Add CSS loading affordance**

Add this to `public/map.css` near the panel styles:

```css
.is-loading .metric-value,
.is-loading .detail-row strong {
  color: transparent;
  border-radius: 8px;
  background: linear-gradient(90deg, #e8efdf, #f8f6eb, #e8efdf);
  background-size: 220% 100%;
  animation: shimmer 1.2s ease-in-out infinite;
}

@keyframes shimmer {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: -100% 0;
  }
}
```

- [ ] **Step 4: Verify map viewport preservation**

Manual check:

1. Start server with `npm start`.
2. Open `http://localhost:3000/map.html`.
3. Pan or zoom the map.
4. Wait for the 30-second refresh.

Expected: after the first successful data fit, later refreshes do not reset the user’s pan/zoom because `boundsFitted` remains `true`.

- [ ] **Step 5: Commit**

```bash
git add public/map.css public/map.js
git commit -m "Improve map loading and empty states"
```

---

### Task 4: Verify Responsive UX And Accessibility

**Files:**
- Modify: `public/map.css`
- Modify: `public/map.html`

- [ ] **Step 1: Run desktop browser review**

Run:

```bash
npm start
```

Open `http://localhost:3000/map.html` at about `1440x900`.

Expected:

- The map is the dominant workspace.
- The session panel does not overpower the map.
- Header text and controls fit on one line.
- Leaflet zoom controls remain usable.
- Text does not overlap map controls or panel content.

- [ ] **Step 2: Run mobile browser review**

Open browser devtools responsive mode at about `390x844`.

Expected:

- Header wraps without clipping.
- Map appears before the session panel.
- Session panel content stacks cleanly.
- Metric text does not overflow.
- Select controls remain tappable.

- [ ] **Step 3: Fix any observed small-screen overflow with these CSS guards**

Add or confirm these rules exist:

```css
.mower-picker,
.session-select,
.status-badge,
.freshness,
.battery-text {
  max-width: 100%;
}

.session-panel,
.status-strip,
.metric,
.detail-row {
  min-width: 0;
}

.detail-row strong,
.detail-row span {
  overflow-wrap: anywhere;
}
```

- [ ] **Step 4: Verify keyboard focus**

Manual check:

1. Press `Tab` through the page.
2. Confirm focus reaches mower picker, Leaflet controls, and session selector.
3. Confirm focus rings are visible and not clipped.

Expected: all interactive elements are reachable and focus is visually clear.

- [ ] **Step 5: Commit**

```bash
git add public/map.html public/map.css
git commit -m "Tune responsive map layout"
```

---

### Task 5: Final Verification And Cleanup

**Files:**
- Review: `public/map.html`
- Review: `public/map.css`
- Review: `public/map.js`
- Review: `docs/superpowers/specs/2026-05-06-soft-garden-ui-design.md`

- [ ] **Step 1: Check for accidental inline CSS or script drift**

Run:

```bash
rg -n "<style>|</style>|<script>\\s*$" public/map.html
```

Expected: no inline `<style>` block and no inline app script. External Leaflet script tags and `/map.js` are acceptable.

- [ ] **Step 2: Check for old high-contrast palette remnants**

Run:

```bash
rg -n "#0f172a|#0b1020|#111827|#0000FF|#FF0000|indigo|🟡|🟢" public
```

Expected: no matches in the redesigned files.

- [ ] **Step 3: Final browser pass**

Run:

```bash
npm start
```

Review `http://localhost:3000/map.html`.

Expected:

- Default view no longer resembles the original dark technical dashboard.
- Current mower state, battery, and freshness are visible at a glance.
- Map remains visually dominant.
- Session controls are discoverible and calm.
- Empty/error messages appear as designed if `/api/positions` is unavailable.

- [ ] **Step 4: Review git diff**

Run:

```bash
git diff -- public/map.html public/map.css public/map.js
```

Expected: only frontend redesign changes are present.

- [ ] **Step 5: Commit**

```bash
git add public/map.html public/map.css public/map.js
git commit -m "Finish soft garden map redesign"
```

---

## Self-Review Notes

- Spec coverage: The plan covers the calm garden visual direction, map-first workspace, softer heatmap, status strip, session panel, loading/empty/error states, mobile behavior, and accessibility checks.
- Scope: Backend live status/session APIs remain out of scope, matching the approved spec boundary.
- Open decisions resolved for this first slice: use a docked desktop session panel, keep session history as a softened native select, and split HTML/CSS/JS now for maintainability.
