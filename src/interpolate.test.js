import test from 'node:test';
import assert from 'node:assert/strict';

import { getInterpolatedPositions, interpolatePositionRows } from './interpolate.js';
import { storePosition } from './db.js';

const mowerId = 'test-mower';
const previousSessionId = 1;
const mowingSessionId = 2;

const rows = [
  {
    mower_id: mowerId,
    session_id: previousSessionId,
    activity: 'MOWING',
    lat: 55.0,
    lon: 13.0,
    timestamp: '2026-07-12T08:00:00.000Z'
  },
  {
    mower_id: mowerId,
    session_id: previousSessionId,
    activity: 'MOWING',
    lat: 55.0,
    lon: 13.00002,
    timestamp: '2026-07-12T08:01:00.000Z'
  },
  {
    mower_id: mowerId,
    session_id: mowingSessionId,
    activity: 'MOWING',
    lat: 55.0001,
    lon: 13.0001,
    timestamp: '2026-07-12T09:00:00.000Z'
  },
  {
    mower_id: mowerId,
    session_id: mowingSessionId,
    activity: 'MOWING',
    lat: 55.0001,
    lon: 13.00012,
    timestamp: '2026-07-12T09:01:00.000Z'
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
    timestamp: '2026-07-12T16:00:00.000Z', eventId: null
  });
  await storePosition({
    mowerId, sessionId: 50, state: 'MOWING', lat: 55, lon: 13.00002,
    timestamp: '2026-07-12T16:01:00.000Z', eventId: null
  });

  const result = await getInterpolatedPositions({ mowerId, sessionId: 50 });
  assert.ok(result.length > 0);
  assert.ok(result.every((point) => point[3] === 50));
});
