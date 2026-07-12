import { getPool } from './dbPool.js';

const EXPECTED_MIGRATION = '001_initial';

async function assertDatabaseReady(pool = getPool()) {
  try {
    await pool.query('SELECT 1');
    const result = await pool.query('SELECT name FROM pgmigrations WHERE name = $1', [EXPECTED_MIGRATION]);
    if (result.rows.length !== 1) {
      throw new Error('migration missing');
    }
  } catch (error) {
    if (error?.message?.startsWith('Database schema is not fully migrated')) {
      throw error;
    }
    if (error?.code === '42P01' || error?.message === 'migration missing') {
      throw new Error('Database schema is not fully migrated; run npm run db:migrate', { cause: error });
    }
    throw error;
  }
}

export { assertDatabaseReady };
