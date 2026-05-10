import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStatusPayload } from './server.js';
import { storeEvent } from './db.js';
import { mowerStates } from './state.js';

test('/api/status includes latest messages for mowers found only in persisted events', async () => {
  const mowerId = `__test_status_db_messages_${Date.now()}__`;

  mowerStates.clear();

  for (let i = 0; i < 6; i += 1) {
    storeEvent({
      mowerId,
      eventType: 'message-event-v2',
      eventTimestamp: `2026-05-09T12:0${i}:00.000Z`,
      receivedAt: `2026-05-09T12:0${i}:01.000Z`,
      lat: 55 + i / 10,
      lon: 13 + i / 10,
      messageCode: 100 + i,
      messageSeverity: i % 2 === 0 ? 'INFO' : 'WARNING',
      payload: JSON.stringify({ test: 'status-db-backed-messages', i })
    });
  }

  const payload = buildStatusPayload();
  const mower = payload.mowers.find((entry) => entry.id === mowerId);

  assert.ok(mower);
  assert.deepEqual(
    mower.messages.map((message) => message.code),
    [105, 104, 103, 102, 101]
  );
});
