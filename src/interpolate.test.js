import test from 'node:test';
import assert from 'node:assert/strict';

import { getInterpolatedPositions, interpolatePositionRows } from './interpolate.js';
import { storePosition } from './db.js';

const mowerId = 'test-mower';
const previousSessionId = 1;
const mowingSessionId = 2;

function todayAt(hour, minute) {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hour,
    minute
  ).toISOString();
}

const rows = [
  {
    mower_id: mowerId,
    session_id: previousSessionId,
    activity: 'MOWING',
    lat: 55.0,
    lon: 13.0,
    timestamp: todayAt(8, 0)
  },
  {
    mower_id: mowerId,
    session_id: previousSessionId,
    activity: 'MOWING',
    lat: 55.0,
    lon: 13.00002,
    timestamp: todayAt(8, 1)
  },
  {
    mower_id: mowerId,
    session_id: mowingSessionId,
    activity: 'MOWING',
    lat: 55.0001,
    lon: 13.0001,
    timestamp: todayAt(9, 0)
  },
  {
    mower_id: mowerId,
    session_id: mowingSessionId,
    activity: 'MOWING',
    lat: 55.0001,
    lon: 13.00012,
    timestamp: todayAt(9, 1)
  }
];

test('keeps the first mowing point after a session boundary in global heat data', () => {
  const interpolated = interpolatePositionRows(rows);

  assert.deepEqual(interpolated.find((entry) => entry[3] === mowingSessionId), [
    55.0001,
    13.0001,
    2,
    mowingSessionId,
    true
  ]);
});

test('loads PostgreSQL positions before interpolating them', async () => {
  const mowerId = 'interpolation-db-mower';
  await storePosition({
    mowerId, sessionId: 50, state: 'MOWING', lat: 55, lon: 13,
    timestamp: todayAt(16, 0), eventId: null
  });
  await storePosition({
    mowerId, sessionId: 50, state: 'MOWING', lat: 55, lon: 13.00002,
    timestamp: todayAt(16, 1), eventId: null
  });

  const result = await getInterpolatedPositions({ mowerId, sessionId: 50 });
  assert.ok(result.length > 0);
  assert.ok(result.every((point) => point[3] === 50));
});
