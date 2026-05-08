import test from 'node:test';
import assert from 'node:assert/strict';
import { SESSION_SUMMARY_SQL } from './sessionSummaryQuery.js';

test('session summary query filters picker sessions to mowing positions', () => {
  assert.match(SESSION_SUMMARY_SQL, /activity\s*=\s*'MOWING'/);
});
