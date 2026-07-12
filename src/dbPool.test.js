import test from 'node:test';
import assert from 'node:assert/strict';

import { closePool, getPool, setPoolForTests, toSafeInteger } from './dbPool.js';
import { assertDatabaseReady } from './dbMigrations.js';

test('converts safe PostgreSQL bigint values to numbers', () => {
  assert.equal(toSafeInteger('42', 'events.id'), 42);
  assert.throws(
    () => toSafeInteger('9007199254740992', 'events.id'),
    /events\.id exceeds JavaScript safe integer range/
  );
});

test('closes an injected pool once', async () => {
  let closes = 0;
  const pool = { end: async () => { closes += 1; } };

  setPoolForTests(pool);
  assert.equal(getPool(), pool);
  await closePool();
  await closePool();

  assert.equal(closes, 1);
});

test('accepts a database with the expected migration', async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      if (sql === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
      return { rows: [{ name: '001_initial' }] };
    }
  };

  await assertDatabaseReady(pool);
  assert.equal(queries.length, 2);
});

test('rejects a database with pending migrations', async () => {
  const pool = {
    async query(sql) {
      if (sql === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
      return { rows: [] };
    }
  };

  await assert.rejects(
    assertDatabaseReady(pool),
    /Database schema is not fully migrated; run npm run db:migrate/
  );
});
