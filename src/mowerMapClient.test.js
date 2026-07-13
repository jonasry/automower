import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createMowerMapClient, MAP_CACHE_TTL_MS } from './mowerMapClient.js';

const svg = await readFile(new URL('./fixtures/mower-map.svg', import.meta.url), 'utf8');

function response(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'image/svg+xml' }
  });
}

test('uses Automower headers, encodes mower id, and caches for one hour', async () => {
  let now = 1000;
  const requests = [];
  const client = createMowerMapClient({
    apiKey: 'api-key',
    apiSecret: 'api-secret',
    getToken: async () => 'token-1',
    refreshToken: async () => assert.fail('refresh not expected'),
    now: () => now,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return response(svg);
    }
  });

  const first = await client.getGeometry('mower/id');
  const second = await client.getGeometry('mower/id');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /mower%2Fid\/maps\/generated$/);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer token-1');
  assert.equal(requests[0].options.headers['Authorization-Provider'], 'husqvarna');
  assert.equal(requests[0].options.headers['X-Api-Key'], 'api-key');
  assert.equal(first.stale, false);
  assert.equal(second.cacheKey, first.cacheKey);

  now += MAP_CACHE_TTL_MS + 1;
  await client.getGeometry('mower/id');
  assert.equal(requests.length, 2);
});

test('refreshes once after authorization failure', async () => {
  const tokens = [];
  const client = createMowerMapClient({
    apiKey: 'key',
    apiSecret: 'secret',
    getToken: async () => 'old-token',
    refreshToken: async () => 'new-token',
    fetchImpl: async (_url, options) => {
      tokens.push(options.headers.Authorization);
      return tokens.length === 1 ? response('', 401) : response(svg);
    }
  });

  await client.getGeometry('mower-1');
  assert.deepEqual(tokens, ['Bearer old-token', 'Bearer new-token']);
});

test('coalesces concurrent refresh and serves stale geometry after refresh failure', async () => {
  let now = 0;
  let calls = 0;
  let fail = false;
  const client = createMowerMapClient({
    apiKey: 'key',
    apiSecret: 'secret',
    getToken: async () => 'token',
    refreshToken: async () => 'token-2',
    now: () => now,
    fetchImpl: async () => {
      calls += 1;
      if (fail) throw new Error('network down');
      await Promise.resolve();
      return response(svg);
    }
  });

  const [first, second] = await Promise.all([
    client.getGeometry('mower-1'),
    client.getGeometry('mower-1')
  ]);
  assert.equal(calls, 1);
  assert.equal(first.cacheKey, second.cacheKey);

  now += MAP_CACHE_TTL_MS + 1;
  fail = true;
  const stale = await client.getGeometry('mower-1');
  assert.equal(stale.stale, true);
  assert.equal(calls, 2);
});

test('maps upstream absence, repeated auth failure, and oversized bodies to safe codes', async () => {
  for (const [status, expectedCode] of [[404, 'MAP_NOT_AVAILABLE'], [403, 'MAP_FETCH_FAILED']]) {
    const client = createMowerMapClient({
      apiKey: 'key',
      apiSecret: 'secret',
      getToken: async () => 'token',
      refreshToken: async () => 'refreshed',
      fetchImpl: async () => response('', status)
    });
    await assert.rejects(
      client.getGeometry('mower'),
      (error) => error.code === expectedCode
    );
  }

  const oversized = createMowerMapClient({
    apiKey: 'key',
    apiSecret: 'secret',
    getToken: async () => 'token',
    refreshToken: async () => 'token',
    fetchImpl: async () => response('x'.repeat(2 * 1024 * 1024 + 1))
  });
  await assert.rejects(
    oversized.getGeometry('mower'),
    (error) => error.code === 'MAP_INVALID'
  );
});
