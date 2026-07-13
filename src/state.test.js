import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveInitialSessionId } from './state.js';

test('continues a persisted session only when its activity is still current', () => {
  assert.equal(resolveInitialSessionId(
    'GOING_HOME',
    { activity: 'GOING_HOME', sessionId: 123 },
    999
  ), 123);
  assert.equal(resolveInitialSessionId(
    'GOING_HOME',
    { activity: 'MOWING', sessionId: 123 },
    999
  ), 999);
  assert.equal(resolveInitialSessionId('GOING_HOME', null, 999), 999);
});
