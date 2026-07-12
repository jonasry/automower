import test from 'node:test';
import assert from 'node:assert/strict';

import { enqueueIncomingEvent, drainIncomingEvents } from './amconnect.js';
import { setPoolForTests } from './dbPool.js';
import { mowerStates } from './state.js';

test('keeps live position state when position persistence fails', async () => {
  const mowerId = 'position-write-failure-mower';
  const positionError = new Error('position write failed');
  setPoolForTests({
    query: async () => ({ rows: [{ id: '1' }] }),
    connect: async () => { throw positionError; },
    end: async () => {}
  });
  mowerStates.clear();

  enqueueIncomingEvent(Buffer.from(JSON.stringify({
    id: mowerId,
    type: 'position-event-v2',
    attributes: {
      position: { latitude: 55.5, longitude: 13.5 },
      metadata: { timestamp: '2026-07-12T18:00:00.000Z' }
    }
  })));
  await drainIncomingEvents();

  assert.deepEqual(mowerStates.get(mowerId)?.lastPosition, {
    lat: 55.5,
    lon: 13.5,
    timestamp: '2026-07-12T18:00:00.000Z',
    eventId: 1
  });
});
