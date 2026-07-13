export const MAP_OVERLAY_SETTINGS_KEY = 'automower.mapOverlaySettings.v1';
export const DEFAULT_MAP_OVERLAY_SETTINGS = Object.freeze({
  version: 1,
  mowers: {}
});

const clamp = (value) => Number.isFinite(value)
  ? Math.max(-20, Math.min(20, value))
  : 0;
const trim = (value = {}) => ({
  eastMetres: clamp(value.eastMetres),
  northMetres: clamp(value.northMetres)
});
const isObject = (value) => Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value);

function resolveStorage(value) {
  if (value !== undefined) return value;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function normalizeMapOverlaySettings(value) {
  if (!isObject(value) || value.version !== 1 || !isObject(value.mowers)) {
    return { version: 1, mowers: {} };
  }
  return {
    version: 1,
    mowers: Object.fromEntries(
      Object.entries(value.mowers)
        .filter(([mowerId, mowerTrim]) => (
          mowerId.length > 0 && isObject(mowerTrim)
        ))
        .map(([mowerId, mowerTrim]) => [mowerId, trim(mowerTrim)])
    )
  };
}

export function getMowerTrim(settings, mowerId) {
  return trim(normalizeMapOverlaySettings(settings).mowers[mowerId]);
}

export function setMowerTrim(settings, mowerId, value) {
  const normalized = normalizeMapOverlaySettings(settings);
  return {
    version: 1,
    mowers: {
      ...normalized.mowers,
      [mowerId]: trim(value)
    }
  };
}

export function loadMapOverlaySettings(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem(MAP_OVERLAY_SETTINGS_KEY);
    return raw
      ? normalizeMapOverlaySettings(JSON.parse(raw))
      : { version: 1, mowers: {} };
  } catch {
    return { version: 1, mowers: {} };
  }
}

export function saveMapOverlaySettings(storage, settings) {
  const target = resolveStorage(storage);
  if (!target || typeof target.setItem !== 'function') {
    throw new Error('Map overlay settings storage is unavailable');
  }
  const normalized = normalizeMapOverlaySettings(settings);
  target.setItem(MAP_OVERLAY_SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}
