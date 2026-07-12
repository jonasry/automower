import test from 'node:test';
import assert from 'node:assert/strict';

import { getPool } from './dbPool.js';
import { storeEvent, storePosition } from './db.js';

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
