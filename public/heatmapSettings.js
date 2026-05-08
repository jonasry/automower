export const HEATMAP_SETTINGS_STORAGE_KEY = 'automower.heatmapSettings.v1';

export const DEFAULT_HEATMAP_SETTINGS = {
  version: 1,
  colors: {
    low: '#83a471',
    medium: '#7ea36a',
    high: '#d8b65f',
    peak: '#df7f64'
  },
  softness: 0.5,
  strength: 0.5
};

const colorPattern = /^#[0-9a-f]{6}$/i;

function createDefaultHeatmapSettings() {
  return {
    ...DEFAULT_HEATMAP_SETTINGS,
    colors: {
      ...DEFAULT_HEATMAP_SETTINGS.colors
    }
  };
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveStorage(storage) {
  if (storage !== undefined) return storage;

  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function normalizeColor(value, fallback) {
  return typeof value === 'string' && colorPattern.test(value)
    ? value.toLowerCase()
    : fallback;
}

function normalizeRatio(value, fallback) {
  return Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

export function normalizeHeatmapSettings(settings) {
  if (!isObject(settings) || settings.version !== DEFAULT_HEATMAP_SETTINGS.version) {
    return createDefaultHeatmapSettings();
  }

  const colors = isObject(settings.colors) ? settings.colors : {};

  return {
    version: DEFAULT_HEATMAP_SETTINGS.version,
    colors: {
      low: normalizeColor(colors.low, DEFAULT_HEATMAP_SETTINGS.colors.low),
      medium: normalizeColor(colors.medium, DEFAULT_HEATMAP_SETTINGS.colors.medium),
      high: normalizeColor(colors.high, DEFAULT_HEATMAP_SETTINGS.colors.high),
      peak: normalizeColor(colors.peak, DEFAULT_HEATMAP_SETTINGS.colors.peak)
    },
    softness: normalizeRatio(settings.softness, DEFAULT_HEATMAP_SETTINGS.softness),
    strength: normalizeRatio(settings.strength, DEFAULT_HEATMAP_SETTINGS.strength)
  };
}

export function loadHeatmapSettings(storage) {
  try {
    const rawSettings = resolveStorage(storage)?.getItem(HEATMAP_SETTINGS_STORAGE_KEY);
    return rawSettings
      ? normalizeHeatmapSettings(JSON.parse(rawSettings))
      : createDefaultHeatmapSettings();
  } catch {
    return createDefaultHeatmapSettings();
  }
}

export function saveHeatmapSettings(storage, settings) {
  const normalizedSettings = normalizeHeatmapSettings(settings);
  const resolvedStorage = resolveStorage(storage);

  if (!resolvedStorage || typeof resolvedStorage.setItem !== 'function') {
    throw new Error('Heatmap settings storage is unavailable');
  }

  resolvedStorage.setItem(HEATMAP_SETTINGS_STORAGE_KEY, JSON.stringify(normalizedSettings));
  return normalizedSettings;
}

export function buildGradient(settings) {
  const normalizedSettings = normalizeHeatmapSettings(settings);

  return {
    0.2: normalizedSettings.colors.low,
    0.45: normalizedSettings.colors.medium,
    0.7: normalizedSettings.colors.high,
    1.0: normalizedSettings.colors.peak
  };
}

export function buildHeatmapOptions(settings) {
  const normalizedSettings = normalizeHeatmapSettings(settings);

  return {
    radius: Math.round(7 + normalizedSettings.softness * 11),
    blur: Math.round(5 + normalizedSettings.softness * 6),
    maxZoom: 20,
    gradient: buildGradient(normalizedSettings)
  };
}

export function applyContributionStrength(heat, settings) {
  const normalizedSettings = normalizeHeatmapSettings(settings);
  const multiplier = 0.5 + normalizedSettings.strength;

  return heat.map(([lat, lon, weight]) => [lat, lon, weight * multiplier]);
}
