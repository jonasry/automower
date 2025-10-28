export const mowerStates = new Map();

const defaultState = {
  mowerName: 'Unknown',
  activity: 'UNKNOWN',
  sessionId: null,
  lastActivityAt: null,
  batteryPercent: null,
  lastBatteryAt: null,
  isCharging: false,
  lastPosition: null,
  lastEventAt: null,
  lastMessage: null
};

export function getMowerState(mowerId) {
  return mowerStates.get(mowerId) ?? null;
}

export function updateMowerState(mowerId, updates = {}) {
  if (!mowerId) return null;
  const current = mowerStates.get(mowerId) ?? { mowerId, ...defaultState };
  const next = {
    mowerId,
    ...current,
    ...updates
  };
  mowerStates.set(mowerId, next);
  return next;
}

export function getAllMowerStates() {
  return Array.from(mowerStates.values());
}
