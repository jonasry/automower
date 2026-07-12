import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { storeEvent, getLatestMessages } from './db.js';

test('getLatestMessages returns latest mower message events with coordinates', () => {
  assert.equal(fs.existsSync(process.env.AUTOMOWER_DB_PATH), true);

  const mowerId = '__test_latest_messages_mower__';
  const otherMowerId = '__test_latest_messages_other_mower__';

  storeEvent({
    mowerId,
    eventType: 'message-event-v2',
    eventTimestamp: '2026-05-09T10:00:00.000Z',
    receivedAt: '2026-05-09T10:00:01.000Z',
    lat: 55.1,
    lon: 13.1,
    messageCode: 100,
    messageSeverity: 'INFO',
    payload: JSON.stringify({ test: 'old' })
  });
  storeEvent({
    mowerId,
    eventType: 'battery-event-v2',
    eventTimestamp: '2026-05-09T10:30:00.000Z',
    receivedAt: '2026-05-09T10:30:01.000Z',
    lat: null,
    lon: null,
    messageCode: null,
    messageSeverity: null,
    payload: JSON.stringify({ test: 'battery' })
  });
  storeEvent({
    mowerId,
    eventType: 'message-event-v2',
    eventTimestamp: '2026-05-09T11:00:00.000Z',
    receivedAt: '2026-05-09T11:00:01.000Z',
    lat: 55.3,
    lon: 13.3,
    messageCode: 150,
    messageSeverity: 'ERROR',
    payload: JSON.stringify({ test: 'middle' })
  });
  storeEvent({
    otherMowerId,
    eventType: 'message-event-v2',
    eventTimestamp: '2026-05-09T11:30:00.000Z',
    receivedAt: '2026-05-09T11:30:01.000Z',
    lat: 55.9,
    lon: 13.9,
    messageCode: 999,
    messageSeverity: 'ERROR',
    payload: JSON.stringify({ test: 'other-mower' })
  });
  storeEvent({
    mowerId,
    eventType: 'message-event-v2',
    eventTimestamp: '2026-05-09T12:00:00.000Z',
    receivedAt: '2026-05-09T12:00:01.000Z',
    lat: 55.2,
    lon: 13.2,
    messageCode: 200,
    messageSeverity: 'WARNING',
    payload: JSON.stringify({ test: 'new' })
  });

  assert.deepEqual(getLatestMessages(mowerId, 2), [
    {
      timestamp: '2026-05-09T12:00:00.000Z',
      code: 200,
      severity: 'WARNING',
      lat: 55.2,
      lon: 13.2
    },
    {
      timestamp: '2026-05-09T11:00:00.000Z',
      code: 150,
      severity: 'ERROR',
      lat: 55.3,
      lon: 13.3
    }
  ]);
});
