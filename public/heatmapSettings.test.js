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

test('loads defaults when browser storage access throws', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('localStorage unavailable');
    }
  });

  try {
    assert.deepEqual(loadHeatmapSettings(), DEFAULT_HEATMAP_SETTINGS);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
    } else {
      delete globalThis.localStorage;
    }
  }
});

test('defaulted loads can be mutated without changing shared defaults or future loads', () => {
  const storage = makeStorage();
  const loaded = loadHeatmapSettings(storage);

  loaded.colors.low = '#000000';
  loaded.softness = 0;

  assert.equal(DEFAULT_HEATMAP_SETTINGS.colors.low, '#83a471');
  assert.equal(DEFAULT_HEATMAP_SETTINGS.softness, 0.5);
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
