import test from 'node:test';
import assert from 'node:assert/strict';

import { createShutdown, startRuntime } from './appLifecycle.js';

test('validates PostgreSQL before starting HTTP and WebSocket services', async () => {
  const calls = [];
  const server = { name: 'server' };

  const result = await startRuntime({
    assertDatabaseReady: async () => { calls.push('ready'); },
    startHttpServer: () => { calls.push('http'); return server; },
    loadMowerState: async () => { calls.push('state'); },
    startWebSocket: async () => { calls.push('websocket'); },
    token: 'token',
    apiKey: 'key',
    apiSecret: 'secret'
  });

  assert.equal(result, server);
  assert.deepEqual(calls, ['ready', 'state', 'websocket', 'http']);
});

test('does not start services when database readiness fails', async () => {
  let starts = 0;
  await assert.rejects(startRuntime({
    assertDatabaseReady: async () => { throw new Error('pending migrations'); },
    startHttpServer: () => { starts += 1; },
    loadMowerState: async () => { starts += 1; },
    startWebSocket: async () => { starts += 1; }
  }), /pending migrations/);
  assert.equal(starts, 0);
});

test('shutdown is ordered and idempotent', async () => {
  const calls = [];
  const shutdown = createShutdown({
    stopWebSocket: async () => { calls.push('websocket'); },
    closeClientEvents: async () => { calls.push('events'); },
    closeHttpServer: async () => { calls.push('http'); },
    drainIncomingEvents: async () => { calls.push('drain'); },
    closeDb: async () => { calls.push('database'); },
    timeoutMs: 100
  });

  const first = shutdown();
  const second = shutdown();
  assert.equal(first, second);
  await first;
  assert.deepEqual(calls, ['websocket', 'events', 'http', 'drain', 'database']);
});

test('shutdown timeout covers a stalled HTTP close', async () => {
  const shutdown = createShutdown({
    stopWebSocket: async () => {},
    closeClientEvents: async () => {},
    closeHttpServer: async () => new Promise(() => {}),
    drainIncomingEvents: async () => {},
    closeDb: async () => {},
    timeoutMs: 5
  });

  await assert.rejects(shutdown(), /Timed out during shutdown after 5ms/);
});
