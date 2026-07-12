function positiveInteger(name, value, fallback) {
  if (value == null || value === '') return fallback;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function sslConfig(value) {
  if (value == null || value === '' || value === 'disable') return undefined;
  if (value === 'require') return { rejectUnauthorized: true };
  throw new Error('PG_SSL must be either "require" or "disable"');
}

function loadDatabaseConfig(env = process.env) {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  return {
    connectionString: env.DATABASE_URL,
    ssl: sslConfig(env.PG_SSL),
    max: positiveInteger('PG_POOL_MAX', env.PG_POOL_MAX, 10),
    idleTimeoutMillis: positiveInteger('PG_IDLE_TIMEOUT_MS', env.PG_IDLE_TIMEOUT_MS, 30000),
    connectionTimeoutMillis: positiveInteger('PG_CONNECTION_TIMEOUT_MS', env.PG_CONNECTION_TIMEOUT_MS, 5000),
    query_timeout: positiveInteger('PG_QUERY_TIMEOUT_MS', env.PG_QUERY_TIMEOUT_MS, 10000)
  };
}

export { loadDatabaseConfig };
