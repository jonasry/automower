import test from 'node:test';
import assert from 'node:assert/strict';

import { app } from './server.js';
import { setPoolForTests } from './dbPool.js';

async function withServer(run) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('returns 503 JSON when PostgreSQL is unavailable', async () => {
  const error = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
  setPoolForTests({
    query: async () => { throw error; },
    end: async () => {}
  });

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/status`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database temporarily unavailable'
      }
    });
  });
});

test('returns 500 JSON for unexpected database query failures', async () => {
  setPoolForTests({
    query: async () => { throw new Error('bad query'); },
    end: async () => {}
  });

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/status`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error'
      }
    });
  });
});

test('returns empty positions without querying all mowers', async () => {
  setPoolForTests({
    query: async () => { throw new Error('positions query should not run'); },
    end: async () => {}
  });

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/positions`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      heat: [],
      recent: [],
      session: null
    });
  });
});
