import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./map.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./map.html', import.meta.url), 'utf8');
const transactionSource = readFileSync(
  new URL('./mapSettingsTransaction.js', import.meta.url),
  'utf8'
);

test('fetches the selected mower map and refreshes it beside position data', () => {
  assert.match(
    source,
    /\/api\/mowers\/\$\{encodeURIComponent\(selectedMowerId\)\}\/map/
  );
  assert.match(
    source,
    /Promise\.all\(\[loadData\(context\), loadMapOverlay\(\)\]\)/
  );
  assert.match(source, /latestMapRequestId/);
});

test('uses an outline-only non-interactive Leaflet pane below markers', () => {
  assert.match(source, /createPane\('mowerMapPane'\)/);
  assert.match(source, /fill:\s*false/);
  assert.match(source, /interactive:\s*false/);
  assert.match(source, /pane:\s*'mowerMapPane'/);
});

test('provides accessible east and north trim controls and overlay status', () => {
  for (const id of ['overlayEastInput', 'overlayNorthInput']) {
    assert.match(
      html,
      new RegExp(
        `id="${id}"[^>]+type="range"[^>]+min="-20"[^>]+max="20"[^>]+step="0.1"`
      )
    );
  }
  assert.match(html, /id="overlayEastValue"/);
  assert.match(html, /id="overlayNorthValue"/);
  assert.match(html, /id="mapOverlayStatus"/);
});

test('saves, cancels, resets, and previews map overlay settings', () => {
  assert.match(source, /saveMapSettingsTransaction/);
  assert.match(transactionSource, /saveMapOverlaySettings/);
  assert.match(source, /draftMapOverlaySettings/);
  assert.match(source, /redrawMapOverlayPreview/);
  assert.match(source, /setMowerTrim/);
});
