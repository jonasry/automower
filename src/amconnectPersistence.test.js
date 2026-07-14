import test from 'node:test';
import assert from 'node:assert/strict';

import { drainIncomingEvents, enqueueIncomingEvent } from './amconnect.js';
import { setPoolForTests } from './dbPool.js';
import { mowerStates } from './state.js';

function positionEvent(mowerId, marker) {
  return Buffer.from(JSON.stringify({
    id: mowerId,
    type: 'position-event-v2',
    attributes: {
      position: { latitude: marker, longitude: 13 + marker / 100 }
    }
  }));
}

test('persists WebSocket messages one at a time in arrival order', async () => {
  const calls = [];
  let releaseFirstEvent;
  const firstEventGate = new Promise((resolve) => {
    releaseFirstEvent = resolve;
  });

  setPoolForTests({
    query: async (sql, params) => {
      const marker = params[8].attributes.position.latitude;
      calls.push(`event:${marker}`);
      if (marker === 1) await firstEventGate;
      return { rows: [{ id: String(marker) }] };
    },
    connect: async () => ({
      query: async (sql, params) => {
        if (sql.includes('INSERT INTO positions')) calls.push(`position:${params[3]}`);
        return { rows: [] };
      },
      release() {}
    }),
    end: async () => {}
  });
  mowerStates.clear();

  enqueueIncomingEvent(positionEvent('fifo-mower', 1));
  enqueueIncomingEvent(positionEvent('fifo-mower', 2));
  await new Promise((resolve) => setImmediate(resolve));
  const callsBeforeRelease = [...calls];

  releaseFirstEvent();
  await drainIncomingEvents();

  assert.deepEqual(callsBeforeRelease, ['event:1']);
  assert.deepEqual(calls, ['event:1', 'position:1', 'event:2', 'position:2']);
});
