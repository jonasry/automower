# Heatmap Setup Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browser-stored, no-number setup mode for tuning heatmap colors, softness, and contribution strength with live preview.

**Architecture:** Keep the feature frontend-only. Add `public/heatmapSettings.js` for pure settings validation, storage adapters, and heatmap option mapping; import it from `public/map.js` after converting the map script to a browser module. Extend the existing side panel with a status/config mode switch and redraw the current cached heat payload for live preview.

**Tech Stack:** Plain browser JavaScript modules, Leaflet, leaflet.heat, `localStorage`, native HTML controls, Node test runner.

---

## File Structure

- Create: `public/heatmapSettings.js`
  - Owns defaults, validation, localStorage load/save helpers, gradient/radius/strength mapping, and heat point strength adjustment.
- Create: `public/heatmapSettings.test.js`
  - Node tests for pure settings behavior.
- Modify: `public/map.html`
  - Load `/map.js` as a module.
  - Add a settings button in the side panel.
  - Wrap existing status content in `#statusPanelContent`.
  - Add hidden `#configPanelContent` with color swatches, gradient preview, semantic sliders, Save, Cancel, and Reset.
- Modify: `public/map.css`
  - Style panel mode controls, color rows, gradient preview, semantic sliders, and action buttons.
- Modify: `public/map.js`
  - Import settings helpers.
  - Track active settings, draft settings, latest heat payload, and panel mode.
  - Redraw heatmap from cached data when setup controls change.

## Task 1: Add Tested Heatmap Settings Module

**Files:**
- Create: `public/heatmapSettings.js`
- Create: `public/heatmapSettings.test.js`

- [ ] **Step 1: Write failing tests for defaults, validation, mapping, and strength application**

Create `public/heatmapSettings.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_HEATMAP_SETTINGS,
  HEATMAP_SETTINGS_STORAGE_KEY,
  applyContributionStrength,
  buildGradient,
  buildHeatmapOptions,
  loadHeatmapSettings,
  normalizeHeatmapSettings,
  saveHeatmapSettings
} from './heatmapSettings.js';

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
}

test('loads defaults when storage is empty', () => {
  assert.deepEqual(loadHeatmapSettings(makeStorage()), DEFAULT_HEATMAP_SETTINGS);
});

test('loads defaults when storage contains invalid JSON', () => {
  const storage = makeStorage({ [HEATMAP_SETTINGS_STORAGE_KEY]: '{nope' });
  assert.deepEqual(loadHeatmapSettings(storage), DEFAULT_HEATMAP_SETTINGS);
});

test('normalizes valid settings and falls back invalid fields independently', () => {
  assert.deepEqual(normalizeHeatmapSettings({
    version: 1,
    colors: {
      low: '#112233',
      medium: 'not-a-color',
      high: '#abcdef',
      peak: '#ABC123'
    },
    softness: 3,
    strength: -2
  }), {
    version: 1,
    colors: {
      low: '#112233',
      medium: DEFAULT_HEATMAP_SETTINGS.colors.medium,
      high: '#abcdef',
      peak: '#abc123'
    },
    softness: 1,
    strength: 0
  });
});

test('saves and reloads valid settings', () => {
  const storage = makeStorage();
  const settings = normalizeHeatmapSettings({
    version: 1,
    colors: {
      low: '#101010',
      medium: '#202020',
      high: '#303030',
      peak: '#404040'
    },
    softness: 0.75,
    strength: 0.25
  });

  saveHeatmapSettings(storage, settings);
  assert.deepEqual(loadHeatmapSettings(storage), settings);
});

test('builds gradient and heat options from normalized settings', () => {
  const settings = normalizeHeatmapSettings({
    version: 1,
    colors: {
      low: '#111111',
      medium: '#222222',
      high: '#333333',
      peak: '#444444'
    },
    softness: 1,
    strength: 0.5
  });

  assert.deepEqual(buildGradient(settings), {
    0.2: '#111111',
    0.45: '#222222',
    0.7: '#333333',
    1.0: '#444444'
  });

  assert.deepEqual(buildHeatmapOptions(settings), {
    radius: 18,
    blur: 11,
    maxZoom: 20,
    gradient: {
      0.2: '#111111',
      0.45: '#222222',
      0.7: '#333333',
      1.0: '#444444'
    }
  });
});

test('applies contribution strength without mutating original heat payload', () => {
  const heat = [
    [55.1, 13.1, 2],
    [55.2, 13.2, 4]
  ];
  const adjusted = applyContributionStrength(heat, {
    ...DEFAULT_HEATMAP_SETTINGS,
    strength: 1
  });

  assert.deepEqual(adjusted, [
    [55.1, 13.1, 3],
    [55.2, 13.2, 6]
  ]);
  assert.deepEqual(heat, [
    [55.1, 13.1, 2],
    [55.2, 13.2, 4]
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail because the module does not exist**

Run:

```bash
npm test -- public/heatmapSettings.test.js
```

Expected: FAIL with module-not-found for `public/heatmapSettings.js`.

- [ ] **Step 3: Implement the settings module**

Create `public/heatmapSettings.js`:

```js
const HEATMAP_SETTINGS_STORAGE_KEY = 'automower.heatmapSettings.v1';

const DEFAULT_HEATMAP_SETTINGS = Object.freeze({
  version: 1,
  colors: Object.freeze({
    low: '#83a471',
    medium: '#7ea36a',
    high: '#d8b65f',
    peak: '#df7f64'
  }),
  softness: 0.5,
  strength: 0.5
});

const COLOR_KEYS = ['low', 'medium', 'high', 'peak'];
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

function clamp01(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

function normalizeColor(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return HEX_COLOR_RE.test(trimmed) ? trimmed.toLowerCase() : fallback;
}

function normalizeHeatmapSettings(value) {
  if (!value || typeof value !== 'object' || value.version !== 1) {
    return structuredClone(DEFAULT_HEATMAP_SETTINGS);
  }

  const colors = {};
  for (const key of COLOR_KEYS) {
    colors[key] = normalizeColor(value.colors?.[key], DEFAULT_HEATMAP_SETTINGS.colors[key]);
  }

  return {
    version: 1,
    colors,
    softness: clamp01(value.softness) ?? DEFAULT_HEATMAP_SETTINGS.softness,
    strength: clamp01(value.strength) ?? DEFAULT_HEATMAP_SETTINGS.strength
  };
}

function loadHeatmapSettings(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(HEATMAP_SETTINGS_STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_HEATMAP_SETTINGS);
    return normalizeHeatmapSettings(JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_HEATMAP_SETTINGS);
  }
}

function saveHeatmapSettings(storage = globalThis.localStorage, settings) {
  const normalized = normalizeHeatmapSettings(settings);
  storage.setItem(HEATMAP_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

function buildGradient(settings) {
  const normalized = normalizeHeatmapSettings(settings);
  return {
    0.2: normalized.colors.low,
    0.45: normalized.colors.medium,
    0.7: normalized.colors.high,
    1.0: normalized.colors.peak
  };
}

function mapSoftnessToRadius(softness) {
  return Math.round(7 + clamp01(softness) * 11);
}

function mapSoftnessToBlur(softness) {
  return Math.round(5 + clamp01(softness) * 6);
}

function mapStrengthToMultiplier(strength) {
  return 0.5 + clamp01(strength) * 1;
}

function buildHeatmapOptions(settings) {
  const normalized = normalizeHeatmapSettings(settings);
  return {
    radius: mapSoftnessToRadius(normalized.softness),
    blur: mapSoftnessToBlur(normalized.softness),
    maxZoom: 20,
    gradient: buildGradient(normalized)
  };
}

function applyContributionStrength(heat, settings) {
  const multiplier = mapStrengthToMultiplier(normalizeHeatmapSettings(settings).strength);
  return heat.map(([lat, lon, weight]) => [lat, lon, weight * multiplier]);
}

export {
  DEFAULT_HEATMAP_SETTINGS,
  HEATMAP_SETTINGS_STORAGE_KEY,
  applyContributionStrength,
  buildGradient,
  buildHeatmapOptions,
  loadHeatmapSettings,
  normalizeHeatmapSettings,
  saveHeatmapSettings
};
```

- [ ] **Step 4: Run settings tests**

Run:

```bash
npm test -- public/heatmapSettings.test.js
```

Expected: PASS for all tests in `public/heatmapSettings.test.js`.

- [ ] **Step 5: Commit**

```bash
git add public/heatmapSettings.js public/heatmapSettings.test.js
git commit -m "Add heatmap settings helpers"
```

## Task 2: Add Configure Mode Markup

**Files:**
- Modify: `public/map.html`

- [ ] **Step 1: Convert map script to module and add panel controls**

In `public/map.html`, change the final script tag:

```html
<script type="module" src="/map.js"></script>
```

Inside `<aside class="session-panel" aria-label="Session details">`, wrap the existing panel body in:

```html
<div id="statusPanelContent" class="panel-mode">
  <div class="panel-header">
    <div>
      <p class="section-kicker">Current session</p>
      <h1 id="sessionTitle">Latest garden run</h1>
    </div>
    <button id="settingsButton" class="icon-button" type="button" aria-label="Configure heatmap">Settings</button>
  </div>
  <p id="sessionSummary" class="session-summary">Showing recent path and coverage heat from recorded mower positions.</p>

  <!-- Keep the existing metric grid, session select section, and quiet details section here. -->
</div>
```

After `#statusPanelContent`, add:

```html
<div id="configPanelContent" class="panel-mode config-panel" hidden>
  <div class="panel-header">
    <div>
      <p class="section-kicker">Heatmap setup</p>
      <h1>Configure map</h1>
    </div>
  </div>

  <p class="session-summary">Tune the heatmap by adjusting the controls and watching the map.</p>
  <p id="settingsError" class="settings-error" hidden></p>

  <div class="panel-section">
    <p class="field-label">Coverage colors</p>
    <div id="gradientPreview" class="gradient-preview" aria-hidden="true"></div>
    <div class="color-grid">
      <label class="color-control">
        <span>Low</span>
        <input id="heatColorLow" type="color" />
      </label>
      <label class="color-control">
        <span>Medium</span>
        <input id="heatColorMedium" type="color" />
      </label>
      <label class="color-control">
        <span>High</span>
        <input id="heatColorHigh" type="color" />
      </label>
      <label class="color-control">
        <span>Peak</span>
        <input id="heatColorPeak" type="color" />
      </label>
    </div>
  </div>

  <div class="panel-section">
    <label class="range-label" for="softnessInput">
      <span>Sharper</span>
      <span>Softer</span>
    </label>
    <input id="softnessInput" class="semantic-range" type="range" min="0" max="1" step="0.01" />
  </div>

  <div class="panel-section">
    <label class="range-label" for="strengthInput">
      <span>Subtle</span>
      <span>Strong</span>
    </label>
    <input id="strengthInput" class="semantic-range" type="range" min="0" max="1" step="0.01" />
  </div>

  <div class="panel-actions">
    <button id="resetSettingsButton" class="secondary-button" type="button">Reset</button>
    <button id="cancelSettingsButton" class="secondary-button" type="button">Cancel</button>
    <button id="saveSettingsButton" class="primary-button" type="button">Save</button>
  </div>
</div>
```

The range inputs use numeric HTML values internally, but no numeric value is displayed.

- [ ] **Step 2: Run tests and manually smoke-check HTML**

Run:

```bash
npm test
```

Expected: existing tests still pass. Browser behavior is not wired yet, so the settings button may not work until Task 4.

- [ ] **Step 3: Commit**

```bash
git add public/map.html
git commit -m "Add heatmap setup panel markup"
```

## Task 3: Style Configure Mode

**Files:**
- Modify: `public/map.css`

- [ ] **Step 1: Add setup panel styles**

Add these styles near the panel rules in `public/map.css`:

```css
.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.icon-button,
.primary-button,
.secondary-button {
  min-height: 38px;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0 14px;
  background: var(--surface);
  color: var(--text);
  font-weight: 750;
  cursor: pointer;
}

.icon-button:focus,
.primary-button:focus,
.secondary-button:focus,
.semantic-range:focus,
.color-control input:focus {
  outline: none;
  box-shadow: 0 0 0 3px rgba(95, 143, 105, 0.18);
}

.primary-button {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--surface);
}

.secondary-button {
  color: var(--accent-strong);
}

.gradient-preview {
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: linear-gradient(90deg, #83a471, #7ea36a, #d8b65f, #df7f64);
}

.color-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.color-control {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  border: 1px solid rgba(215, 224, 210, 0.8);
  border-radius: var(--radius-md);
  padding: 10px;
  background: rgba(255, 255, 248, 0.72);
  color: var(--text);
  font-weight: 700;
}

.color-control input {
  width: 42px;
  height: 30px;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
}

.range-label {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  color: var(--text);
  font-weight: 750;
}

.semantic-range {
  width: 100%;
  accent-color: var(--accent);
}

.panel-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 22px;
}

.settings-error {
  border: 1px solid rgba(185, 94, 78, 0.28);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  background: rgba(185, 94, 78, 0.08);
  color: var(--danger);
}

@media (max-width: 520px) {
  .color-grid {
    grid-template-columns: 1fr;
  }

  .panel-actions {
    justify-content: stretch;
  }

  .panel-actions button {
    flex: 1 1 auto;
  }
}
```

- [ ] **Step 2: Run tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add public/map.css
git commit -m "Style heatmap setup panel"
```

## Task 4: Wire Settings Into Map Rendering

**Files:**
- Modify: `public/map.js`

- [ ] **Step 1: Import helpers and replace hardcoded heatmap options**

At the top of `public/map.js`, replace `gardenGradient` with:

```js
import {
  DEFAULT_HEATMAP_SETTINGS,
  applyContributionStrength,
  buildGradient,
  buildHeatmapOptions,
  loadHeatmapSettings,
  normalizeHeatmapSettings,
  saveHeatmapSettings
} from './heatmapSettings.js';
```

Add state near the existing `let` declarations:

```js
let heatmapSettings = loadHeatmapSettings();
let draftHeatmapSettings = null;
let latestHeat = [];
let latestFitKey = null;
let isConfigMode = false;
```

Update `renderHeatmap(heat, fitKey)` so it stores and renders adjusted heat:

```js
function renderHeatmap(heat, fitKey, settings = heatmapSettings) {
  latestHeat = heat;
  latestFitKey = fitKey;

  if (!heat.length) {
    boundsKey = null;
    return;
  }

  const adjustedHeat = applyContributionStrength(heat, settings);
  heatLayer = L.heatLayer(adjustedHeat, buildHeatmapOptions(settings)).addTo(map);

  if (boundsKey !== fitKey) {
    const latLngs = heat
      .map(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon) ? L.latLng(lat, lon) : null)
      .filter(Boolean);
    if (latLngs.length) {
      map.fitBounds(L.latLngBounds(latLngs), { padding: [28, 28] });
      boundsKey = fitKey;
    }
  }
}
```

Add a redraw helper after `renderHeatmap`:

```js
function redrawHeatmapPreview(settings) {
  if (heatLayer) {
    map.removeLayer(heatLayer);
    heatLayer = null;
  }
  renderHeatmap(latestHeat, latestFitKey, settings);
}
```

- [ ] **Step 2: Run tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add public/map.js
git commit -m "Apply heatmap settings to rendering"
```

## Task 5: Wire Configure Mode Controls

**Files:**
- Modify: `public/map.js`

- [ ] **Step 1: Add DOM references**

Add after the existing DOM constants:

```js
const statusPanelContent = document.getElementById('statusPanelContent');
const configPanelContent = document.getElementById('configPanelContent');
const settingsButton = document.getElementById('settingsButton');
const settingsError = document.getElementById('settingsError');
const gradientPreview = document.getElementById('gradientPreview');
const heatColorLow = document.getElementById('heatColorLow');
const heatColorMedium = document.getElementById('heatColorMedium');
const heatColorHigh = document.getElementById('heatColorHigh');
const heatColorPeak = document.getElementById('heatColorPeak');
const softnessInput = document.getElementById('softnessInput');
const strengthInput = document.getElementById('strengthInput');
const resetSettingsButton = document.getElementById('resetSettingsButton');
const cancelSettingsButton = document.getElementById('cancelSettingsButton');
const saveSettingsButton = document.getElementById('saveSettingsButton');
```

- [ ] **Step 2: Add setup rendering and event handlers**

Add after `resetMapFit()`:

```js
function setSettingsError(message) {
  settingsError.hidden = !message;
  settingsError.textContent = message || '';
}

function updateGradientPreview(settings) {
  const gradient = buildGradient(settings);
  gradientPreview.style.background = `linear-gradient(90deg, ${gradient[0.2]}, ${gradient[0.45]}, ${gradient[0.7]}, ${gradient[1.0]})`;
}

function renderSettingsControls(settings) {
  heatColorLow.value = settings.colors.low;
  heatColorMedium.value = settings.colors.medium;
  heatColorHigh.value = settings.colors.high;
  heatColorPeak.value = settings.colors.peak;
  softnessInput.value = String(settings.softness);
  strengthInput.value = String(settings.strength);
  updateGradientPreview(settings);
}

function readDraftFromControls() {
  return normalizeHeatmapSettings({
    version: 1,
    colors: {
      low: heatColorLow.value,
      medium: heatColorMedium.value,
      high: heatColorHigh.value,
      peak: heatColorPeak.value
    },
    softness: Number(softnessInput.value),
    strength: Number(strengthInput.value)
  });
}

function setPanelMode(mode) {
  isConfigMode = mode === 'config';
  statusPanelContent.hidden = isConfigMode;
  configPanelContent.hidden = !isConfigMode;
}

function enterConfigureMode() {
  draftHeatmapSettings = structuredClone(heatmapSettings);
  setSettingsError('');
  renderSettingsControls(draftHeatmapSettings);
  setPanelMode('config');
  heatColorLow.focus();
}

function previewDraftSettings() {
  draftHeatmapSettings = readDraftFromControls();
  renderSettingsControls(draftHeatmapSettings);
  redrawHeatmapPreview(draftHeatmapSettings);
}

function cancelConfigureMode() {
  draftHeatmapSettings = null;
  setSettingsError('');
  redrawHeatmapPreview(heatmapSettings);
  setPanelMode('status');
  settingsButton.focus();
}

function resetDraftSettings() {
  draftHeatmapSettings = structuredClone(DEFAULT_HEATMAP_SETTINGS);
  renderSettingsControls(draftHeatmapSettings);
  redrawHeatmapPreview(draftHeatmapSettings);
}

function saveConfigureMode() {
  try {
    heatmapSettings = saveHeatmapSettings(localStorage, readDraftFromControls());
    draftHeatmapSettings = null;
    setSettingsError('');
    redrawHeatmapPreview(heatmapSettings);
    setPanelMode('status');
    settingsButton.focus();
  } catch (err) {
    console.error(err);
    setSettingsError('Could not save settings in this browser.');
  }
}
```

Add event listeners near existing picker listeners:

```js
settingsButton.addEventListener('click', enterConfigureMode);
cancelSettingsButton.addEventListener('click', cancelConfigureMode);
resetSettingsButton.addEventListener('click', resetDraftSettings);
saveSettingsButton.addEventListener('click', saveConfigureMode);

[
  heatColorLow,
  heatColorMedium,
  heatColorHigh,
  heatColorPeak,
  softnessInput,
  strengthInput
].forEach((input) => {
  input.addEventListener('input', previewDraftSettings);
});
```

- [ ] **Step 3: Preserve draft settings during API refreshes**

In `loadData()`, change the render call:

```js
renderHeatmap(heat, fitKey, isConfigMode && draftHeatmapSettings ? draftHeatmapSettings : heatmapSettings);
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/map.js
git commit -m "Wire heatmap setup controls"
```

## Task 6: Verify In Browser And Polish

**Files:**
- Review: `public/map.html`
- Review: `public/map.css`
- Review: `public/map.js`
- Review: `public/heatmapSettings.js`

- [ ] **Step 1: Start the app**

Run:

```bash
npm start
```

Expected: server logs `HTTP server listening at http://localhost:3000/map.html`.

- [ ] **Step 2: Manual verification**

Open `http://localhost:3000/map.html` and verify:

- The normal status panel appears first.
- The settings button opens configure mode in the side panel.
- Low, Medium, High, and Peak are color swatches/color inputs.
- The gradient preview changes when a color changes.
- The gradient preview itself is not used as the picker.
- Sharper to Softer changes the heatmap radius without showing a numeric value.
- Subtle to Strong changes each contribution's apparent strength without showing a numeric value.
- Save persists after a page reload.
- Cancel restores the last saved setup.
- Reset previews defaults and only persists them after Save.
- Status/session data still refreshes after leaving configure mode.

- [ ] **Step 3: Run full tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Review diff**

Run:

```bash
git diff -- public/map.html public/map.css public/map.js public/heatmapSettings.js public/heatmapSettings.test.js
```

Expected: changes are limited to heatmap setup mode and settings helpers.

- [ ] **Step 5: Commit final polish if any changes were made**

```bash
git add public/map.html public/map.css public/map.js public/heatmapSettings.js public/heatmapSettings.test.js
git commit -m "Finish heatmap setup mode"
```

## Self-Review

- Spec coverage: The plan covers browser storage, no-number controls, Low/Medium/High/Peak color swatches, preview-only gradient bar, global softness and strength controls, live preview, Save/Cancel/Reset, validation, API non-changes, and manual verification.
- Placeholder scan: No placeholder markers or vague follow-up steps remain.
- Type consistency: The settings shape is consistently `{ version, colors, softness, strength }`; helper names match between tests, implementation, and `map.js` integration.
