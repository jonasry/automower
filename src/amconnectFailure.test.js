import test from 'node:test';
import assert from 'node:assert/strict';

import { enqueueIncomingEvent, drainIncomingEvents } from './amconnect.js';
import { setPoolForTests } from './dbPool.js';
import { mowerStates } from './state.js';

test('logs a failed position write and continues with the next queued event', async () => {
  const mowerId = 'position-write-failure-mower';
  const positionError = new Error('position write failed');
  let eventWrites = 0;
  const loggedErrors = [];
  const originalConsoleError = console.error;
  setPoolForTests({
    query: async () => ({ rows: [{ id: String(++eventWrites) }] }),
    connect: async () => { throw positionError; },
    end: async () => {}
  });
  mowerStates.clear();

  console.error = (...args) => loggedErrors.push(args);
  try {
    enqueueIncomingEvent(Buffer.from(JSON.stringify({
      id: mowerId,
      type: 'position-event-v2',
      attributes: {
        position: { latitude: 55.5, longitude: 13.5 },
        metadata: { timestamp: '2026-07-12T18:00:00.000Z' }
      }
    })));
    enqueueIncomingEvent(Buffer.from(JSON.stringify({
      id: mowerId,
      type: 'battery-event-v2',
      attributes: {
        battery: { batteryPercent: 73 },
        metadata: { timestamp: '2026-07-12T18:00:01.000Z' }
      }
    })));
    await drainIncomingEvents();
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(eventWrites, 2);
  assert.equal(mowerStates.get(mowerId)?.batteryPercent, 73);
  assert.equal(
    loggedErrors.some(([message, error]) => (
      message === 'Failed to persist position:' && error === positionError
    )),
    true
  );
});
