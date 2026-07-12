import test from 'node:test';
import assert from 'node:assert/strict';

import { drainIncomingEvents, enqueueIncomingEvent } from './amconnect.js';
import { getPositions } from './db.js';
import { mowerStates } from './state.js';

test('serializes activity and position persistence in arrival order', async () => {
  const mowerId = 'ordered-ingestion-mower';
  const activityTimestamp = '2026-07-12T17:00:00.000Z';
  mowerStates.clear();

  enqueueIncomingEvent(Buffer.from(JSON.stringify({
    id: mowerId,
    type: 'mower-event-v2',
    attributes: {
      mower: { activity: 'MOWING' },
      metadata: { timestamp: activityTimestamp }
    }
  })));
  enqueueIncomingEvent(Buffer.from(JSON.stringify({
    id: mowerId,
    type: 'position-event-v2',
    attributes: {
      position: { latitude: 55.4, longitude: 13.4 },
      metadata: { timestamp: '2026-07-12T17:00:30.000Z' }
    }
  })));

  await drainIncomingEvents();

  const rows = await getPositions({ mowerId });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].session_id, Date.parse(activityTimestamp));
  assert.equal(mowerStates.get(mowerId).lastPosition.eventId != null, true);
});
