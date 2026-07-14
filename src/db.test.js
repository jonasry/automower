import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { getPool } from './dbPool.js';
import { assertDatabaseReady } from './dbMigrations.js';
import {
  getChargingStationAnchor,
  getLatestBatteryReading,
  getPositions,
  getSessionSummaries,
  getStoredMowerIds,
  storeEvent,
  storePosition
} from './db.js';

function event(overrides = {}) {
  return {
    mowerId: 'mower-write-test',
    eventType: 'position-event-v2',
    eventTimestamp: '2026-07-12T10:00:00.000Z',
    receivedAt: '2026-07-12T10:00:01.000Z',
    lat: 55.1,
    lon: 13.1,
    messageCode: null,
    messageSeverity: null,
    payload: JSON.stringify({ a: 1, b: 2 }),
    ...overrides
  };
}

test('recognizes the complete repository migration set in PostgreSQL', async () => {
  await assertDatabaseReady();
});

test('deduplicates equivalent JSON events and refreshes received_at', async () => {
  const firstId = await storeEvent(event());
  const later = '2026-07-12T10:00:02.000Z';
  const secondId = await storeEvent(event({
    receivedAt: later,
    payload: JSON.stringify({ b: 2, a: 1 })
  }));

  assert.equal(secondId, firstId);

  const result = await getPool().query(
    'SELECT received_at, payload FROM events WHERE id = $1',
    [firstId]
  );
  assert.equal(result.rows[0].received_at.toISOString(), later);
  assert.deepEqual(result.rows[0].payload, { a: 1, b: 2 });
});

test('deduplicates event payloads larger than a PostgreSQL B-tree index entry', async () => {
  const payload = JSON.stringify({ samples: randomBytes(12000).toString('hex') });
  const firstId = await storeEvent(event({
    mowerId: 'mower-large-event',
    payload
  }));
  const secondId = await storeEvent(event({
    mowerId: 'mower-large-event',
    receivedAt: '2026-07-12T10:00:03.000Z',
    payload
  }));

  assert.equal(secondId, firstId);
});

test('deduplicates events whose nullable key fields are absent', async () => {
  const firstId = await storeEvent(event({
    mowerId: null,
    eventType: 'ready',
    eventTimestamp: null,
    payload: JSON.stringify({ ready: true })
  }));
  const secondId = await storeEvent(event({
    mowerId: null,
    eventType: 'ready',
    eventTimestamp: null,
    receivedAt: '2026-07-12T10:01:00.000Z',
    payload: JSON.stringify({ ready: true })
  }));

  assert.equal(secondId, firstId);
});

test('deduplicates positions and attaches a missing source event', async () => {
  const position = {
    mowerId: 'mower-position-test',
    sessionId: 1234,
    state: 'MOWING',
    lat: 55.2,
    lon: 13.2,
    timestamp: '2026-07-12T11:00:00.000Z',
    eventId: null
  };

  await storePosition(position);
  const eventId = await storeEvent(event({
    mowerId: position.mowerId,
    eventTimestamp: position.timestamp,
    lat: position.lat,
    lon: position.lon,
    payload: JSON.stringify({ position: true })
  }));
  await storePosition({ ...position, eventId });

  const result = await getPool().query(
    'SELECT event_id FROM positions WHERE mower_id = $1',
    [position.mowerId]
  );
  assert.equal(result.rowCount, 1);
  assert.equal(Number(result.rows[0].event_id), eventId);
});

test('does not replace a different non-null position event link', async () => {
  const firstEventId = await storeEvent(event({
    mowerId: 'mower-linked-position',
    payload: JSON.stringify({ event: 1 })
  }));
  const secondEventId = await storeEvent(event({
    mowerId: 'mower-linked-position',
    payload: JSON.stringify({ event: 2 })
  }));
  const position = {
    mowerId: 'mower-linked-position',
    sessionId: 5678,
    state: 'MOWING',
    lat: 55.3,
    lon: 13.3,
    timestamp: '2026-07-12T12:00:00.000Z'
  };

  await storePosition({ ...position, eventId: firstEventId });
  await storePosition({ ...position, eventId: secondEventId });

  const result = await getPool().query(
    'SELECT event_id FROM positions WHERE mower_id = $1',
    [position.mowerId]
  );
  assert.equal(Number(result.rows[0].event_id), firstEventId);
});

test('reads one mower session in position insertion order', async () => {
  await storePosition({
    mowerId: 'mower-read-a', sessionId: 10, state: 'MOWING', lat: 55.2, lon: 13.2,
    timestamp: '2026-07-12T13:02:00.000Z', eventId: null
  });
  await storePosition({
    mowerId: 'mower-read-a', sessionId: 10, state: 'MOWING', lat: 55.1, lon: 13.1,
    timestamp: '2026-07-12T13:01:00.000Z', eventId: null
  });
  await storePosition({
    mowerId: 'mower-read-a', sessionId: 10, state: 'MOWING', lat: 55.3, lon: 13.3,
    timestamp: '2026-07-12T13:01:00.000Z', eventId: null
  });
  await storePosition({
    mowerId: 'mower-read-b', sessionId: 20, state: 'MOWING', lat: 56.1, lon: 14.1,
    timestamp: '2026-07-12T13:00:00.000Z', eventId: null
  });

  const rows = await getPositions({ mowerId: 'mower-read-a', sessionId: 10 });

  assert.deepEqual(rows.map((row) => row.lat), [55.2, 55.1, 55.3]);
  assert.ok(rows.every((row, index) => Number.isSafeInteger(row.id) && (
    index === 0 || row.id > rows[index - 1].id
  )));
  assert.ok(rows.every((row) => row.mower_id === 'mower-read-a' && row.session_id === 10));
});

test('reads battery JSONB and discovers mowers across both tables', async () => {
  await storeEvent(event({
    mowerId: 'mower-battery-read',
    eventType: 'battery-event-v2',
    eventTimestamp: '2026-07-12T14:00:00.000Z',
    payload: JSON.stringify({ attributes: { battery: { batteryPercent: '74.6' } } })
  }));
  await storePosition({
    mowerId: 'mower-position-only', sessionId: 30, state: 'MOWING', lat: 55, lon: 13,
    timestamp: '2026-07-12T14:01:00.000Z', eventId: null
  });

  assert.deepEqual(await getLatestBatteryReading('mower-battery-read'), {
    timestamp: '2026-07-12T14:00:00.000Z',
    batteryPercent: 75
  });
  const mowerIds = await getStoredMowerIds();
  assert.ok(mowerIds.includes('mower-battery-read'));
  assert.ok(mowerIds.includes('mower-position-only'));
});

test('summarizes mowing sessions and includes messages inside their time range', async () => {
  const mowerId = 'mower-session-read';
  await storePosition({
    mowerId, sessionId: 100, state: 'MOWING', lat: 55, lon: 13,
    timestamp: '2026-07-12T15:00:00.000Z', eventId: null
  });
  await storePosition({
    mowerId, sessionId: 100, state: 'MOWING', lat: 55.1, lon: 13.1,
    timestamp: '2026-07-12T15:12:00.000Z', eventId: null
  });
  await storeEvent(event({
    mowerId,
    eventType: 'message-event-v2',
    eventTimestamp: '2026-07-12T15:05:00.000Z',
    messageCode: 501,
    messageSeverity: 'WARNING',
    payload: JSON.stringify({ message: 501 })
  }));

  assert.deepEqual(await getSessionSummaries({ mowerId, limit: 5, messageLimit: 3 }), [{
    mowerId,
    sessionId: 100,
    start: '2026-07-12T15:00:00.000Z',
    end: '2026-07-12T15:12:00.000Z',
    durationMinutes: 12,
    points: 2,
    messages: [{
      timestamp: '2026-07-12T15:05:00.000Z',
      code: 501,
      severity: 'WARNING'
    }]
  }]);
});

test('selects the final position from the latest eligible going-home session', async () => {
  const mowerId = `mower-map-anchor-${Date.now()}`;
  const rows = [
    [100, 'GOING_HOME', 55.1000, 13.1000, '2026-07-13T10:00:00.000Z'],
    [100, 'GOING_HOME', 55.1001, 13.1001, '2026-07-13T10:05:00.000Z'],
    [200, 'GOING_HOME', 55.2000, 13.2000, '2026-07-13T11:00:00.000Z'],
    [200, 'GOING_HOME', 55.2002, 13.2002, '2026-07-13T11:08:00.000Z'],
    [300, 'MOWING', 56, 14, '2026-07-13T12:00:00.000Z']
  ];
  for (const [sessionId, state, lat, lon, timestamp] of rows) {
    await storePosition({
      mowerId,
      sessionId,
      state,
      lat,
      lon,
      timestamp,
      eventId: null
    });
  }

  assert.deepEqual(await getChargingStationAnchor(mowerId), {
    lat: 55.2002,
    lon: 13.2002,
    timestamp: '2026-07-13T11:08:00.000Z',
    sessionId: 200,
    sourceActivity: 'GOING_HOME'
  });
  assert.deepEqual(
    await getChargingStationAnchor(mowerId, { excludeSessionId: 200 }),
    {
      lat: 55.1001,
      lon: 13.1001,
      timestamp: '2026-07-13T10:05:00.000Z',
      sessionId: 100,
      sourceActivity: 'GOING_HOME'
    }
  );
});

test('returns null when only the excluded going-home session is available', async () => {
  const mowerId = `mower-map-active-${Date.now()}`;
  await storePosition({
    mowerId,
    sessionId: 400,
    state: 'GOING_HOME',
    lat: 55.4,
    lon: 13.4,
    timestamp: '2026-07-13T12:00:00.000Z',
    eventId: null
  });

  assert.equal(
    await getChargingStationAnchor(mowerId, { excludeSessionId: 400 }),
    null
  );
});
