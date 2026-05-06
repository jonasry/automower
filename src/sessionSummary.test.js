import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeLatestSession } from './sessionSummary.js';

test('summarizes the latest session duration from original position timestamps', () => {
  const data = [
    [55.1, 13.1, 1, 100, true, '2026-05-06T10:00:00.000Z'],
    [55.2, 13.2, 1, 100, true, '2026-05-06T10:10:00.000Z'],
    [55.3, 13.3, 1, 200, true, '2026-05-06T11:00:00.000Z'],
    [55.4, 13.4, 1, 200, false],
    [55.5, 13.5, 1, 200, true, '2026-05-06T11:42:30.000Z']
  ];

  assert.deepEqual(summarizeLatestSession(data), {
    sessionId: 200,
    start: '2026-05-06T11:00:00.000Z',
    end: '2026-05-06T11:42:30.000Z',
    durationMs: 2550000,
    points: 2
  });
});
