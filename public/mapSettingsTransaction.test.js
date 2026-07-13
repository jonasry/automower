import test from 'node:test';
import assert from 'node:assert/strict';

import { HEATMAP_SETTINGS_STORAGE_KEY } from './heatmapSettings.js';
import { MAP_OVERLAY_SETTINGS_KEY } from './mapOverlaySettings.js';
import { saveMapSettingsTransaction } from './mapSettingsTransaction.js';

function storage(initial = {}, { failOnceFor = null } = {}) {
  const values = new Map(Object.entries(initial));
  let failed = false;
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      if (key === failOnceFor && !failed) {
        failed = true;
        throw new Error('storage write failed');
      }
      values.set(key, String(value));
    }
  };
}

const currentHeatmapSettings = {
  version: 1,
  colors: {
    low: '#111111',
    medium: '#222222',
    high: '#333333',
    peak: '#444444'
  },
  softness: 0.4,
  strength: 0.5
};
const nextHeatmapSettings = {
  ...currentHeatmapSettings,
  softness: 0.8
};
const currentMapOverlaySettings = {
  version: 1,
  mowers: { mower: { eastMetres: 1, northMetres: 2 } }
};
const nextMapOverlaySettings = {
  version: 1,
  mowers: { mower: { eastMetres: 3, northMetres: 4 } }
};

test('saves both settings records and returns their normalized values', () => {
  const target = storage();
  const saved = saveMapSettingsTransaction(target, {
    currentHeatmapSettings,
    currentMapOverlaySettings,
    nextHeatmapSettings,
    nextMapOverlaySettings
  });

  assert.equal(saved.heatmapSettings.softness, 0.8);
  assert.deepEqual(
    saved.mapOverlaySettings.mowers.mower,
    { eastMetres: 3, northMetres: 4 }
  );
});

test('rolls back heatmap storage when overlay storage fails', () => {
  const target = storage({
    [HEATMAP_SETTINGS_STORAGE_KEY]: JSON.stringify(currentHeatmapSettings),
    [MAP_OVERLAY_SETTINGS_KEY]: JSON.stringify(currentMapOverlaySettings)
  }, { failOnceFor: MAP_OVERLAY_SETTINGS_KEY });

  assert.throws(
    () => saveMapSettingsTransaction(target, {
      currentHeatmapSettings,
      currentMapOverlaySettings,
      nextHeatmapSettings,
      nextMapOverlaySettings
    }),
    /storage write failed/
  );
  assert.deepEqual(
    JSON.parse(target.getItem(HEATMAP_SETTINGS_STORAGE_KEY)),
    currentHeatmapSettings
  );
  assert.deepEqual(
    JSON.parse(target.getItem(MAP_OVERLAY_SETTINGS_KEY)),
    currentMapOverlaySettings
  );
});
