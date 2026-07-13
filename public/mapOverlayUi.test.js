import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./map.js', import.meta.url), 'utf8');

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
