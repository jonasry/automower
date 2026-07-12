import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPool } from './dbPool.js';

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../migrations'
);

async function listRepositoryMigrations() {
  const files = await fs.readdir(migrationsDir);
  return files
    .filter((file) => file.endsWith('.sql'))
    .map((file) => path.basename(file, '.sql'))
    .sort();
}

async function assertDatabaseReady(pool = getPool(), expectedMigrations = null) {
  try {
    await pool.query('SELECT 1');
    const expected = expectedMigrations ?? await listRepositoryMigrations();
    const result = await pool.query('SELECT name FROM pgmigrations ORDER BY id');
    const applied = result.rows.map((row) => row.name);

    if (
      applied.length !== expected.length ||
      expected.some((migration, index) => migration !== applied[index])
    ) {
      throw new Error('migration mismatch');
    }
  } catch (error) {
    if (error?.message?.startsWith('Database schema is not fully migrated')) {
      throw error;
    }
    if (error?.code === '42P01' || error?.message === 'migration mismatch') {
      throw new Error('Database schema is not fully migrated; run npm run db:migrate', { cause: error });
    }
    throw error;
  }
}

export { assertDatabaseReady, listRepositoryMigrations };
