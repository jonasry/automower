import test from 'node:test';
import assert from 'node:assert/strict';

import { shapeEventForStorage } from './events.js';

test('message local timestamp is normalized with mower timezone', () => {
  const shaped = shapeEventForStorage({
    id: 'mower-1',
    type: 'message-event-v2',
    attributes: {
      message: {
        time: 1778405143,
        code: 78,
        severity: 'ERROR'
      }
    }
  }, { mowerTimeZone: 'Europe/Stockholm' });

  assert.equal(shaped.eventTimestamp, '2026-05-10T07:25:43.000Z');
});
