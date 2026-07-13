import test from 'node:test';
import assert from 'node:assert/strict';

import { createMowerMapHandler } from './mowerMapRoute.js';
import { MowerMapError } from './mowerMapSvg.js';

function fakeResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };
}

const geometryResult = {
  stale: false,
  fetchedAt: '2026-07-13T12:00:00.000Z',
  cacheKey: 'mower-1:1',
  metadata: {
    creationDateTime: null,
    mapVersion: '2.1',
    postProcessingCommit: null,
    postProcessingBranch: null
  },
  stationOrigin: { x: -1000, y: 500 },
  geometry: {
    workingAreas: [],
    islands: [],
    guides: [],
    chargingStationLine: { id: 'lona_cs', points: [] }
  }
};

test('returns ready geometry and excludes the active going-home session', async () => {
  let anchorOptions;
  const handler = createMowerMapHandler({
    getKnownMowerIds: async () => ['mower-1'],
    getMowerState: () => ({ activity: 'GOING_HOME', sessionId: 42 }),
    getGeometry: async () => geometryResult,
    getAnchor: async (_id, options) => {
      anchorOptions = options;
      return {
        lat: 55.7,
        lon: 13.2,
        timestamp: '2026-07-13T11:00:00.000Z',
        sessionId: 41,
        sourceActivity: 'GOING_HOME'
      };
    }
  });
  const res = fakeResponse();

  await handler({ params: { mowerId: 'mower-1' } }, res, assert.fail);

  assert.deepEqual(anchorOptions, { excludeSessionId: 42 });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'ready');
  assert.deepEqual(
    res.body.coordinateSystem.stationOrigin,
    { x: -1000, y: 500 }
  );
  assert.equal(res.body.coordinateSystem.unitsPerMetre, 1000);
  assert.equal(res.body.coordinateSystem.yAxis, 'north');
});

test('returns geometry with anchor-unavailable status', async () => {
  const handler = createMowerMapHandler({
    getKnownMowerIds: async () => ['mower-1'],
    getMowerState: () => ({ activity: 'PARKED_IN_CS', sessionId: 44 }),
    getGeometry: async () => geometryResult,
    getAnchor: async () => null
  });
  const res = fakeResponse();

  await handler({ params: { mowerId: 'mower-1' } }, res, assert.fail);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'anchor-unavailable');
  assert.equal(res.body.anchor, null);
});

test('suppresses the anchor when startup finds an active return-home trip', async () => {
  const handler = createMowerMapHandler({
    getKnownMowerIds: async () => ['mower-1'],
    getMowerState: () => ({
      activity: 'GOING_HOME',
      sessionId: 42,
      suppressMapAnchor: true
    }),
    getGeometry: async () => geometryResult,
    getAnchor: async () => assert.fail('suppressed anchor must not be queried')
  });
  const res = fakeResponse();

  await handler({ params: { mowerId: 'mower-1' } }, res, assert.fail);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'anchor-unavailable');
  assert.equal(res.body.anchor, null);
});

test('returns safe error codes for unknown, missing, failed, and invalid maps', async () => {
  const cases = [
    { known: [], error: null, status: 404, code: 'UNKNOWN_MOWER' },
    {
      known: ['m'],
      error: new MowerMapError('MAP_NOT_AVAILABLE', 'missing'),
      status: 404,
      code: 'MAP_NOT_AVAILABLE'
    },
    {
      known: ['m'],
      error: new MowerMapError('MAP_FETCH_FAILED', 'failed'),
      status: 502,
      code: 'MAP_FETCH_FAILED'
    },
    {
      known: ['m'],
      error: new MowerMapError('MAP_INVALID', 'invalid'),
      status: 502,
      code: 'MAP_INVALID'
    }
  ];

  for (const item of cases) {
    const handler = createMowerMapHandler({
      getKnownMowerIds: async () => item.known,
      getMowerState: () => null,
      getGeometry: async () => {
        if (item.error) throw item.error;
        assert.fail('unknown mower must not request geometry');
      },
      getAnchor: async () => null
    });
    const res = fakeResponse();

    await handler(
      { params: { mowerId: item.known[0] ?? 'unknown' } },
      res,
      assert.fail
    );

    assert.equal(res.statusCode, item.status);
    assert.equal(res.body.error.code, item.code);
    assert.equal(JSON.stringify(res.body).includes('upstream'), false);
  }
});
