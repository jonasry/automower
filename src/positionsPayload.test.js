import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPositionsPayload } from './positionsPayload.js';

test('keeps heatmap data broad while selecting the trail session', () => {
  const heatData = [
    [55.1, 13.1, 1, 100, true, '2026-05-06T10:00:00.000Z'],
    [55.2, 13.2, 1, 100, true, '2026-05-06T10:10:00.000Z'],
    [55.3, 13.3, 1, 200, true, '2026-05-06T11:00:00.000Z'],
    [55.4, 13.4, 1, 200, true, '2026-05-06T11:20:00.000Z']
  ];
  const trailData = heatData.filter((entry) => entry[3] === 100);

  const payload = buildPositionsPayload({
    heatData,
    trailData,
    selectedSessionId: 100
  });

  assert.deepEqual(payload.heat, [
    [55.1, 13.1, 1],
    [55.2, 13.2, 1],
    [55.3, 13.3, 1],
    [55.4, 13.4, 1]
  ]);
  assert.deepEqual(payload.recent, [
    [55.2, 13.2],
    [55.1, 13.1]
  ]);
  assert.equal(payload.session.sessionId, 100);
});
