import test from 'node:test';
import assert from 'node:assert/strict';

import { loadDatabaseConfig } from './dbConfig.js';

test('requires DATABASE_URL', () => {
  assert.throws(() => loadDatabaseConfig({}), /DATABASE_URL is required/);
});

test('loads documented pool defaults', () => {
  assert.deepEqual(loadDatabaseConfig({
    DATABASE_URL: 'postgres://user:pass@localhost/automower'
  }), {
    connectionString: 'postgres://user:pass@localhost/automower',
    ssl: undefined,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000
  });
});

test('parses explicit pool settings', () => {
  assert.deepEqual(loadDatabaseConfig({
    DATABASE_URL: 'postgres://user:pass@localhost/automower',
    PG_POOL_MAX: '4',
    PG_IDLE_TIMEOUT_MS: '20000',
    PG_CONNECTION_TIMEOUT_MS: '2500',
    PG_QUERY_TIMEOUT_MS: '8000'
  }), {
    connectionString: 'postgres://user:pass@localhost/automower',
    ssl: undefined,
    max: 4,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 2500,
    query_timeout: 8000
  });
});

test('rejects invalid pool settings', () => {
  assert.throws(() => loadDatabaseConfig({
    DATABASE_URL: 'postgres://localhost/automower',
    PG_POOL_MAX: '0'
  }), /PG_POOL_MAX must be a positive integer/);
});

test('enables verified TLS only when requested', () => {
  assert.deepEqual(loadDatabaseConfig({
    DATABASE_URL: 'postgres://localhost/automower',
    PG_SSL: 'require'
  }).ssl, { rejectUnauthorized: true });
});
