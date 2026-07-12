import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after } from 'node:test';

import { runner as migrate } from 'node-pg-migrate';
import pg from 'pg';

const { Pool } = pg;
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required to run the test suite');
}

function connectionTarget(value) {
  const url = new URL(value);
  return [url.protocol, url.username, url.hostname, url.port || '5432', url.pathname].join('|');
}

if (
  process.env.DATABASE_URL &&
  connectionTarget(process.env.DATABASE_URL) === connectionTarget(testDatabaseUrl)
) {
  throw new Error('TEST_DATABASE_URL must not target the same database as DATABASE_URL');
}

const testSchema = `automower_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const quotedSchema = `"${testSchema}"`;
const adminPool = new Pool({ connectionString: testDatabaseUrl });

await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);

try {
  await migrate({
    databaseUrl: testDatabaseUrl,
    dir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations'),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    schema: testSchema,
    migrationsSchema: testSchema,
    count: Infinity,
    noLock: true,
    verbose: false,
    log: () => {}
  });
} catch (error) {
  await adminPool.query(`DROP SCHEMA ${quotedSchema} CASCADE`);
  await adminPool.end();
  throw error;
}

const runtimeUrl = new URL(testDatabaseUrl);
runtimeUrl.searchParams.set('options', `-c search_path=${testSchema}`);
process.env.DATABASE_URL = runtimeUrl.toString();

after(async () => {
  await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  await adminPool.end();
});
