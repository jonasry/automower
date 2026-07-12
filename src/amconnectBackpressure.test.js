import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_PENDING_PERSISTENCE,
  enqueueIncomingEvent,
  getPendingPersistenceCount
} from './amconnect.js';
import { setPoolForTests } from './dbPool.js';
import { mowerStates } from './state.js';

test('updates live state immediately and bounds persistence during a database outage', () => {
  setPoolForTests({
    query: async () => new Promise(() => {}),
    end: async () => {}
  });
  mowerStates.clear();

  for (let i = 0; i <= MAX_PENDING_PERSISTENCE; i += 1) {
    enqueueIncomingEvent(Buffer.from(JSON.stringify({
      id: 'backpressure-mower',
      type: 'battery-event-v2',
      attributes: {
        battery: { batteryPercent: i },
        metadata: { timestamp: `2026-07-12T19:${String(i % 60).padStart(2, '0')}:00.000Z` }
      }
    })));
  }

  assert.equal(mowerStates.get('backpressure-mower')?.batteryPercent, 100);
  assert.equal(getPendingPersistenceCount(), MAX_PENDING_PERSISTENCE);
});
