import pg from 'pg';

import { loadDatabaseConfig } from './dbConfig.js';

const { Pool } = pg;
let pool = null;
let closePromise = null;

function getPool() {
  if (!pool) {
    pool = new Pool(loadDatabaseConfig());
  }
  return pool;
}

function setPoolForTests(testPool) {
  pool = testPool;
  closePromise = null;
}

async function closePool() {
  if (!pool) return;
  if (!closePromise) {
    closePromise = Promise.resolve(pool.end());
  }
  await closePromise;
}

function toSafeInteger(value, fieldName) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) {
    throw new RangeError(`${fieldName} exceeds JavaScript safe integer range`);
  }
  return numeric;
}

export { closePool, getPool, setPoolForTests, toSafeInteger };
