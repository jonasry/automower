import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAP_OVERLAY_SETTINGS_KEY,
  getMowerTrim,
  loadMapOverlaySettings,
  saveMapOverlaySettings,
  setMowerTrim
} from './mapOverlaySettings.js';

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value))
  };
}

test('normalizes per-mower trim independently and clamps to twenty metres', () => {
  const settings = setMowerTrim({
    version: 1,
    mowers: { other: { eastMetres: 1, northMetres: 2 } }
  }, 'mower', {
    eastMetres: 99,
    northMetres: -99
  });

  assert.deepEqual(
    getMowerTrim(settings, 'mower'),
    { eastMetres: 20, northMetres: -20 }
  );
  assert.deepEqual(
    getMowerTrim(settings, 'other'),
    { eastMetres: 1, northMetres: 2 }
  );
  assert.deepEqual(
    getMowerTrim(settings, 'missing'),
    { eastMetres: 0, northMetres: 0 }
  );
});

test('loads safe defaults for malformed storage and saves normalized values', () => {
  const malformed = storage({ [MAP_OVERLAY_SETTINGS_KEY]: '{bad' });
  assert.deepEqual(
    loadMapOverlaySettings(malformed),
    { version: 1, mowers: {} }
  );

  const target = storage();
  const saved = saveMapOverlaySettings(target, {
    version: 1,
    mowers: { mower: { eastMetres: 1.25, northMetres: Number.NaN } }
  });
  assert.deepEqual(
    saved.mowers.mower,
    { eastMetres: 1.25, northMetres: 0 }
  );
  assert.deepEqual(loadMapOverlaySettings(target), saved);
});
