# Heatmap Setup Mode Design Spec

## Context

The Automower map currently renders a Leaflet heatmap from `/api/positions`.
Heatmap appearance is statically configured in `public/map.js`: the gradient,
radius, blur, and recent path colors are source constants. The interpolated heat
payload already includes a per-point weight, and the browser passes those points
directly to `L.heatLayer`.

The desired feature is a setup mode where a user can tune how the heatmap feels
without editing source files. Settings can be stored in the browser. The user
does not want raw numeric values in the UI; feedback should come from moving the
relevant controls and watching the map update.

## Goals

- Let the user configure heatmap colors from the map page.
- Let the user tune heat radius with semantic language: `Sharper` to `Softer`.
- Let the user tune per-contribution strength with semantic language: `Subtle`
  to `Strong`.
- Preview every change live on the current map before saving.
- Store saved settings in browser storage so they survive page reloads on the
  same browser/device.
- Keep the backend API, database, interpolation logic, and Docker persistence
  unchanged for this feature.

## Non-Goals

- No account-level or server-persisted preferences.
- No separate setup route.
- No raw JSON editor or numeric heatmap configuration UI.
- No change to the `/api/positions` response shape.
- No attempt to configure every Leaflet heat option.

## UX Design

The map page remains a single-page UI. The existing side panel has two modes:

- `Status mode`: the current mower/session details, with a settings button.
- `Configure mode`: replaces the status content with heatmap setup controls.

The settings button in status mode switches the side panel into configure mode.
The map remains visible and interactive while the side panel changes.

Configure mode includes:

- Four labeled color controls: `Low`, `Medium`, `High`, and `Peak`.
- A `Sharper` to `Softer` control for heat radius. Internally, sharper means a
  smaller heat radius and softer means a larger heat radius.
- A `Subtle` to `Strong` control for contribution strength. Internally, this
  multiplies each heat point's weight before rendering.
- `Save`, which persists the previewed setup to browser storage and returns to
  status mode.
- `Cancel`, which discards preview edits, restores the last saved setup, and
  returns to status mode.
- `Reset`, which restores the source default look, previews it immediately, and
  can then be saved or canceled.

No raw numbers are shown in the setup UI. The user learns each control's effect
by moving controls and watching the heatmap redraw live.

## Color Stops

The four color controls represent heatmap intensity stops:

- `Low`: sparse or light mower coverage.
- `Medium`: more overlapping contributions.
- `High`: repeated coverage.
- `Peak`: the strongest hotspots.

The implementation can map these labels to the fixed Leaflet gradient stop
positions already implied by the current design. Those stop positions remain an
implementation detail and are not displayed to the user.

## Architecture

Keep this feature frontend-only and centered in `public/map.js`.

Add a small heatmap settings layer:

- `DEFAULT_HEATMAP_SETTINGS` contains the source defaults.
- `loadHeatmapSettings()` reads browser storage, validates the stored value, and
  falls back to defaults.
- `saveHeatmapSettings(settings)` validates and writes settings to browser
  storage.
- `buildHeatmapOptions(settings)` converts user settings into Leaflet heat
  options such as gradient and radius.
- `applyHeatmapSettings(settings)` redraws the current heat layer with the
  configured gradient, radius, and strength.
- `enterConfigureMode()` copies saved settings into a draft object.

The page should keep the latest heat payload in memory after each successful
`/api/positions` load. Live preview then redraws from that cached payload instead
of requiring a fresh API request for every control movement.

## Data Flow

On page load:

1. Load saved heatmap settings from browser storage.
2. Validate and normalize the settings.
3. Use the resulting settings when rendering the first heat layer.

When `/api/positions` refreshes:

1. Store the latest `heat` payload in memory.
2. Render the heatmap using the active settings.
3. Keep existing status/session refresh behavior unchanged.

When entering configure mode:

1. Copy the active saved settings into draft settings.
2. Render setup controls from the draft.
3. Keep the current heat payload visible.

When a setup control changes:

1. Update draft settings.
2. Validate or clamp the changed field.
3. Redraw the heatmap using draft settings.
4. Do not write browser storage yet.

When saving:

1. Validate and normalize the full draft.
2. Persist it to browser storage.
3. Make it the active settings.
4. Return to status mode.

When canceling:

1. Discard the draft.
2. Reload the last saved settings.
3. Redraw the heatmap with saved settings.
4. Return to status mode.

When resetting:

1. Replace the draft with source defaults.
2. Redraw immediately.
3. Wait for Save or Cancel.

## Contribution Strength

The backend should keep returning heat points as `[lat, lon, weight]`.
Contribution strength is applied client-side before rendering:

```js
const adjustedHeat = heat.map(([lat, lon, weight]) => [
  lat,
  lon,
  weight * settings.strength
]);
```

The implementation must avoid mutating the original API payload. This keeps
refreshes, cancel behavior, and repeated previews predictable.

## Browser Storage

Use `localStorage` with a versioned key, for example
`automower.heatmapSettings.v1`.

The stored shape should be compact and explicit:

```json
{
  "version": 1,
  "colors": {
    "low": "#83a471",
    "medium": "#7ea36a",
    "high": "#d8b65f",
    "peak": "#df7f64"
  },
  "softness": 0.5,
  "strength": 0.5
}
```

The numeric `softness` and `strength` values are internal storage values only.
They are not displayed in the UI. They should be mapped to bounded render values
in `buildHeatmapOptions()` and the heat-point adjustment step.

## Validation And Error Handling

Browser storage is untrusted input.

- Missing storage falls back to defaults.
- Invalid JSON falls back to defaults.
- Unknown versions fall back to defaults until a migration is needed.
- Invalid individual fields fall back independently where practical.
- Color values should be normalized to hex strings suitable for color inputs.
- Internal softness and strength values should be clamped to their supported
  ranges.
- If storage write fails, keep the live preview active, show a concise panel
  error, and do not claim settings were saved.

The feature should not break map loading if settings validation fails.

## Accessibility

- The settings button must be a real button with an accessible name.
- Configure mode controls must have labels that match the visible language.
- Color controls should not rely on color alone; `Low`, `Medium`, `High`, and
  `Peak` labels remain visible.
- Save, Cancel, and Reset must be keyboard accessible.
- Focus should move into configure mode when opened and return to the settings
  button or panel area when closed.
- Live preview should not create disruptive focus changes.

## Testing

Automated tests should cover the pure settings logic:

- Loading defaults when browser storage is empty.
- Loading defaults when browser storage contains invalid JSON.
- Saving and reloading valid settings.
- Falling back for invalid individual fields.
- Mapping `Sharper` to `Softer` storage values into bounded heat radius values.
- Mapping `Subtle` to `Strong` storage values into bounded strength multipliers.
- Applying contribution strength without mutating the original heat payload.
- Building a Leaflet heat options object from settings.

Manual verification should cover:

- Open setup mode from the side panel.
- Move each control and confirm the map updates live.
- Save, reload the page, and confirm settings persist.
- Cancel after edits and confirm the last saved view returns.
- Reset, save, reload, and confirm defaults persist.
- Confirm the normal status panel still updates after returning from configure
  mode.

## Acceptance Criteria

- The map side panel can switch from status mode to configure mode.
- Configure mode provides no-number controls for color stops, softness, and
  strength.
- Heatmap changes preview live without additional API requests per control
  change.
- Save persists settings to browser storage.
- Cancel restores the last saved settings.
- Reset previews source defaults and can be saved.
- Corrupt or missing browser settings never prevent the map from rendering.
- `/api/positions`, interpolation, and database behavior remain unchanged.
