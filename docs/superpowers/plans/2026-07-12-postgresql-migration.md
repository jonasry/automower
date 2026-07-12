# PostgreSQL Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SQLite with PostgreSQL while preserving ingestion behavior, HTTP response shapes, and local/Docker workflows.

**Architecture:** Keep `src/db.js` as the only persistence boundary, backed by one `pg.Pool` and explicit `node-pg-migrate` SQL migrations. Propagate promises through interpolation, HTTP reads, WebSocket ingestion, replay, startup, and shutdown; integration tests use a unique PostgreSQL schema per test process.

**Tech Stack:** Node.js 18+ ES modules, PostgreSQL 15+, `pg`, `node-pg-migrate`, Express 5, Node test runner, Docker Compose.

## Global Constraints

- PostgreSQL is the only runtime database; do not retain SQLite compatibility or dual writes.
- Do not import `db/mower-data.sqlite`; PostgreSQL starts empty.
- Preserve the successful response shapes of `/api/positions` and `/api/status`.
- `DATABASE_URL` is required for runtime and migrations; `TEST_DATABASE_URL` is required for database integration tests.
- Normal app startup validates migrations but never applies them.
- Use parameterized SQL and never log connection URLs or credentials.
- Support Node.js 18+ and PostgreSQL 15+; Compose uses PostgreSQL 16.

## File map

- `package.json`, `package-lock.json`: replace SQLite dependency, add PostgreSQL/migration scripts.
- `migrations/001_initial.sql`: create the complete PostgreSQL schema and indexes.
- `src/dbConfig.js`: validate URLs, TLS, pool limits, and safe integer conversion.
- `src/dbPool.js`: own the shared pool and test override hooks.
- `src/dbMigrations.js`: expose migration status/readiness checks.
- `src/db.js`: implement all writes and reads with PostgreSQL.
- `src/testDbSetup.js`: create, migrate, select, and remove a unique test schema.
- `src/db.test.js`: integration coverage for schema, writes, reads, and normalization.
- `src/sessionSummaryQuery.js`: convert placeholders and PostgreSQL result aliases.
- `src/interpolate.js`, `src/interpolate.test.js`: make position lookup async while keeping pure interpolation synchronous.
- `src/server.js`, `src/serverStatus.test.js`: await database reads and standardize errors.
- `src/amconnect.js`, `src/events.test.js`: serialize and await ingestion.
- `scripts/replay-events.js`: await replayed writes and pool shutdown.
- `src/app.js`, `src/server.js`: startup readiness and graceful lifecycle.
- `src/appLifecycle.test.js`: startup/shutdown behavior.
- `Dockerfile`, `compose.yaml`, `.env.example`, `.gitignore`, `README.md`: deployment and operating workflow.

---

### Task 1: PostgreSQL foundation and migrations

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `migrations/001_initial.sql`
- Create: `src/dbConfig.js`
- Create: `src/dbConfig.test.js`
- Create: `src/dbPool.js`
- Create: `src/dbMigrations.js`
- Modify: `src/testDbSetup.js`

**Interfaces:**
- Produces: `loadDatabaseConfig(env) -> { connectionString, ssl, max, idleTimeoutMillis, connectionTimeoutMillis, queryTimeout }`
- Produces: `getPool() -> pg.Pool`, `closePool() -> Promise<void>`, `setPoolForTests(pool)`
- Produces: `assertDatabaseReady() -> Promise<void>`
- Produces: a migrated per-process schema selected through PostgreSQL `search_path` before test modules load.

- [ ] **Step 1: Add failing configuration tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDatabaseConfig } from './dbConfig.js';

test('requires DATABASE_URL', () => {
  assert.throws(() => loadDatabaseConfig({}), /DATABASE_URL is required/);
});

test('parses bounded pool settings', () => {
  assert.deepEqual(loadDatabaseConfig({
    DATABASE_URL: 'postgres://user:pass@localhost/automower',
    PG_POOL_MAX: '4',
    PG_CONNECTION_TIMEOUT_MS: '2500'
  }), {
    connectionString: 'postgres://user:pass@localhost/automower',
    ssl: undefined,
    max: 4,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2500,
    query_timeout: 10000
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test src/dbConfig.test.js`

Expected: FAIL because `src/dbConfig.js` does not exist.

- [ ] **Step 3: Install dependencies and add scripts**

Run: `npm uninstall better-sqlite3`

Run: `npm install pg node-pg-migrate`

Add scripts:

```json
"db:migrate": "node-pg-migrate up --migrations-dir migrations --migration-file-language sql",
"db:migrate:status": "node-pg-migrate up --dry-run --migrations-dir migrations --migration-file-language sql"
```

- [ ] **Step 4: Implement strict database configuration**

```js
function positiveInteger(name, value, fallback) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function loadDatabaseConfig(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  return {
    connectionString: env.DATABASE_URL,
    ssl: env.PG_SSL === 'require' ? { rejectUnauthorized: true } : undefined,
    max: positiveInteger('PG_POOL_MAX', env.PG_POOL_MAX, 10),
    idleTimeoutMillis: positiveInteger('PG_IDLE_TIMEOUT_MS', env.PG_IDLE_TIMEOUT_MS, 30000),
    connectionTimeoutMillis: positiveInteger('PG_CONNECTION_TIMEOUT_MS', env.PG_CONNECTION_TIMEOUT_MS, 5000),
    query_timeout: positiveInteger('PG_QUERY_TIMEOUT_MS', env.PG_QUERY_TIMEOUT_MS, 10000)
  };
}
```

- [ ] **Step 5: Create the initial SQL migration**

Create both tables, foreign key, migration-safe unique expressions using `COALESCE`, and the five existing lookup/unique indexes. Use `TIMESTAMPTZ`, `JSONB`, `DOUBLE PRECISION`, and identity `BIGINT` exactly as specified in the design. Include a down section that drops `positions` before `events`.

- [ ] **Step 6: Implement pool ownership and readiness validation**

`getPool()` lazily constructs one `Pool(loadDatabaseConfig())`; `closePool()` is idempotent. `assertDatabaseReady()` executes `SELECT 1`, reads the migration table used by `node-pg-migrate`, and throws `Database schema is not fully migrated; run npm run db:migrate` when the table or expected migration is absent.

- [ ] **Step 7: Replace SQLite test bootstrap**

Require `TEST_DATABASE_URL`, reject it when its normalized host/database/user matches `DATABASE_URL`, generate `automower_test_${process.pid}_${randomUUID()}`, create that schema through an admin pool, set `DATABASE_URL` to a URL whose `options` selects the schema, run migrations programmatically, and drop the schema in an `after`/exit-safe teardown.

- [ ] **Step 8: Run foundation tests**

Run: `node --test src/dbConfig.test.js`

Expected: PASS.

Run: `TEST_DATABASE_URL=postgres://... npm test`

Expected: existing database tests fail only because `src/db.js` still imports `better-sqlite3`; the test schema itself is created and migrated successfully.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json migrations src/dbConfig.js src/dbConfig.test.js src/dbPool.js src/dbMigrations.js src/testDbSetup.js
git commit -m "Add PostgreSQL foundation"
```

### Task 2: PostgreSQL write semantics

**Files:**
- Modify: `src/db.js`
- Create: `src/db.test.js`
- Modify: `src/latestMessages.test.js`

**Interfaces:**
- Consumes: `getPool()` from Task 1.
- Produces: `storeEvent(event) -> Promise<number>`.
- Produces: `storePosition(position) -> Promise<void>`.

- [ ] **Step 1: Write failing integration tests**

Test that `storeEvent` returns a safe numeric ID, equivalent JSONB objects deduplicate, duplicate events update `received_at`, and `storePosition` suppresses duplicate coordinates while attaching a previously null `event_id`. Query the tables with `getPool().query` to assert stored values directly.

```js
const firstId = await storeEvent(event);
const secondId = await storeEvent({ ...event, receivedAt: later, payload: '{"b":2,"a":1}' });
assert.equal(secondId, firstId);
const { rows } = await getPool().query('SELECT received_at FROM events WHERE id = $1', [firstId]);
assert.equal(rows[0].received_at.toISOString(), later);
```

- [ ] **Step 2: Verify the write tests fail**

Run: `TEST_DATABASE_URL=postgres://... node --import ./src/testDbSetup.js --test src/db.test.js`

Expected: FAIL because the SQLite implementation cannot load and helpers are synchronous.

- [ ] **Step 3: Implement atomic event upsert**

Use one parameterized `INSERT ... ON CONFLICT ... DO UPDATE SET received_at = EXCLUDED.received_at RETURNING id`. Parse the payload once when it arrives as a JSON string and pass the object to `pg`. Convert the returned identity with a helper that verifies `Number.isSafeInteger`.

- [ ] **Step 4: Implement safe position upsert**

Use `INSERT ... ON CONFLICT` to suppress the logical duplicate, followed within one checked-out-client transaction by an update that fills `event_id` only when it is null or already equal to the supplied ID. Roll back on any error and always release the client.

- [ ] **Step 5: Run write tests**

Run: `TEST_DATABASE_URL=postgres://... node --import ./src/testDbSetup.js --test src/db.test.js src/latestMessages.test.js`

Expected: write tests PASS; read assertions may remain failing until Task 3.

- [ ] **Step 6: Commit**

```bash
git add src/db.js src/db.test.js src/latestMessages.test.js
git commit -m "Persist mower events in PostgreSQL"
```

### Task 3: PostgreSQL read compatibility

**Files:**
- Modify: `src/db.js`
- Modify: `src/sessionSummaryQuery.js`
- Modify: `src/sessionSummaryQuery.test.js`
- Modify: `src/latestMessages.test.js`
- Modify: `src/serverStatus.test.js`

**Interfaces:**
- Produces async versions of `getPositions`, `getSessionSummaries`, `getLatestMessage`, `getLatestMessages`, `getLatestBatteryReading`, and `getStoredMowerIds` with unchanged resolved value shapes.

- [ ] **Step 1: Expand failing read tests**

Seed two mowers, multiple sessions, messages, and battery JSON. Assert ordering, mower/session filters, validated limits, ISO timestamps, rounded battery values, and stored mower union behavior. Change all existing database test calls to `await`.

- [ ] **Step 2: Verify read tests fail**

Run: `TEST_DATABASE_URL=postgres://... node --import ./src/testDbSetup.js --test src/db.test.js src/latestMessages.test.js src/sessionSummaryQuery.test.js`

Expected: FAIL because read helpers still use SQLite prepared statements/placeholders.

- [ ] **Step 3: Convert SQL and row normalization**

Use `$1`, `$2`, and `$3` placeholders. Cast `COUNT(*)` and session IDs or normalize them with the safe integer helper. Normalize every `TIMESTAMPTZ` through `toISOString()`. Read battery percent directly from the parsed JSONB object and preserve malformed/missing payload fallback behavior.

- [ ] **Step 4: Keep query limits parameterized**

Validate limit values in JavaScript, then pass them as PostgreSQL parameters rather than interpolating them into SQL. Preserve the current minimums and defaults.

- [ ] **Step 5: Run all database tests**

Run: `TEST_DATABASE_URL=postgres://... node --import ./src/testDbSetup.js --test src/db.test.js src/latestMessages.test.js src/sessionSummaryQuery.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db.js src/sessionSummaryQuery.js src/sessionSummaryQuery.test.js src/latestMessages.test.js src/serverStatus.test.js src/db.test.js
git commit -m "Read mower history from PostgreSQL"
```

### Task 4: Async interpolation and HTTP reads

**Files:**
- Modify: `src/interpolate.js`
- Modify: `src/interpolate.test.js`
- Modify: `src/server.js`
- Modify: `src/serverStatus.test.js`
- Create: `src/serverDatabaseErrors.test.js`

**Interfaces:**
- Produces: `getInterpolatedPositions(filters) -> Promise<Array>` while `interpolatePositionRows(rows)` stays synchronous.
- Produces: `buildStatusPayload() -> Promise<{ mowers, sessions }>`.
- Produces: async Express handlers with unchanged success bodies and `{ error: { code, message } }` failure bodies.

- [ ] **Step 1: Write failing async/error tests**

Await `buildStatusPayload`; test `/api/positions` and `/api/status` with a rejecting pool. Assert `503` for connection-class failures, `500` for other query failures, and that a failed status build does not populate `statusCache`.

- [ ] **Step 2: Verify focused failures**

Run: `TEST_DATABASE_URL=postgres://... node --import ./src/testDbSetup.js --test src/interpolate.test.js src/serverStatus.test.js src/serverDatabaseErrors.test.js`

Expected: FAIL because handlers and status building are synchronous.

- [ ] **Step 3: Propagate promises through interpolation**

```js
async function getInterpolatedPositions(filters = {}) {
  const rows = await getPositions(filters);
  return interpolatePositionRows(rows);
}
```

- [ ] **Step 4: Convert HTTP handlers and status building**

Await both position queries, `getStoredMowerIds`, per-mower messages, battery, and session summaries. Fetch independent per-mower reads with bounded `Promise.all` groups. Assign `statusCache` only after the complete payload resolves.

- [ ] **Step 5: Add one database error middleware**

Classify PostgreSQL connectivity/timeout codes as unavailable, log operation context, and respond with stable JSON. Do not include SQL, payloads, or database URLs.

- [ ] **Step 6: Run HTTP/interpolation tests**

Run: `TEST_DATABASE_URL=postgres://... node --import ./src/testDbSetup.js --test src/interpolate.test.js src/serverStatus.test.js src/serverDatabaseErrors.test.js src/positionsPayload.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/interpolate.js src/interpolate.test.js src/server.js src/serverStatus.test.js src/serverDatabaseErrors.test.js
git commit -m "Await PostgreSQL-backed API reads"
```

### Task 5: Ordered async event ingestion and replay

**Files:**
- Modify: `src/amconnect.js`
- Create: `src/amconnectPersistence.test.js`
- Modify: `scripts/replay-events.js`

**Interfaces:**
- Produces: `handleIncomingEvent(data) -> Promise<void>`.
- Produces: one live ingestion promise chain that preserves arrival order and recovers after rejection.

- [ ] **Step 1: Write failing ordering and recovery tests**

Inject deferred persistence calls, deliver an activity event followed by a position, and assert the position observes the new session only after the activity write completes. Reject one event and assert the next event still runs. Assert notifications omit `eventId` when persistence fails.

- [ ] **Step 2: Verify tests fail**

Run: `TEST_DATABASE_URL=postgres://... node --import ./src/testDbSetup.js --test src/amconnectPersistence.test.js`

Expected: FAIL because `handleIncomingEvent` does not await writes or serialize callbacks.

- [ ] **Step 3: Make the event handler async**

Await `storeEvent`, then await `storePosition` for position events. Keep state updates and notifications after the relevant persistence attempt. Catch persistence errors with event type/mower context and continue live-state handling with `eventId: null`.

- [ ] **Step 4: Serialize WebSocket callbacks**

Maintain `let ingestionChain = Promise.resolve()`. The message listener assigns `ingestionChain = ingestionChain.then(() => handleIncomingEvent(data)).catch(logAndContinue)` so one rejected event cannot poison the chain. Export a drain helper for shutdown tests.

- [ ] **Step 5: Await replay and shutdown**

Change replay to `await handleIncomingEvent(payload)` in its loop and `await closePool()` in `finally`. This guarantees the summary prints only after persistence completes.

- [ ] **Step 6: Run ingestion and replay tests**

Run: `TEST_DATABASE_URL=postgres://... node --import ./src/testDbSetup.js --test src/amconnectPersistence.test.js src/events.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/amconnect.js src/amconnectPersistence.test.js scripts/replay-events.js
git commit -m "Serialize PostgreSQL event ingestion"
```

### Task 6: Startup readiness and graceful shutdown

**Files:**
- Modify: `src/app.js`
- Modify: `src/server.js`
- Create: `src/appLifecycle.js`
- Create: `src/appLifecycle.test.js`

**Interfaces:**
- Produces: `startHttpServer(port) -> Promise<http.Server>` or a synchronously returned listening server with an awaited readiness wrapper.
- Produces: `createShutdown({ server, stopWebSocket, drainEvents, closePool, timeoutMs }) -> () => Promise<void>`.

- [ ] **Step 1: Write lifecycle tests**

Assert readiness runs before HTTP/WebSocket startup, missing migrations prevent both, shutdown calls each stage in order, a repeated signal returns the same promise, and timeout produces a non-zero result without hanging.

- [ ] **Step 2: Verify lifecycle tests fail**

Run: `node --test src/appLifecycle.test.js`

Expected: FAIL because lifecycle orchestration is embedded in `src/app.js`.

- [ ] **Step 3: Extract testable lifecycle orchestration**

Implement an idempotent closure with a single `shutdownPromise`; close the HTTP listener, stop reconnects/WebSocket, await the ingestion drain with `Promise.race`, then close the pool. Keep `process.exit` in the thin `src/app.js` entry point rather than the helper.

- [ ] **Step 4: Gate startup on database readiness**

Call `assertDatabaseReady()` before `startHttpServer()`, `loadMowerState()`, or `startWebSocket()`. Log a concise actionable error and set `process.exitCode = 1` on failure without printing `DATABASE_URL`.

- [ ] **Step 5: Run lifecycle and full tests**

Run: `TEST_DATABASE_URL=postgres://... npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app.js src/server.js src/appLifecycle.js src/appLifecycle.test.js
git commit -m "Validate and drain PostgreSQL lifecycle"
```

### Task 7: Docker Compose and operating documentation

**Files:**
- Modify: `Dockerfile`
- Create: `compose.yaml`
- Create: `.env.example`
- Modify: `.gitignore`
- Modify: `README.md`

**Interfaces:**
- Produces: `docker compose up --build` workflow with `postgres`, `migrate`, and `app` services.
- Produces: direct local `DATABASE_URL` workflow and backup/restore instructions.

- [ ] **Step 1: Add Compose configuration**

Use `postgres:16-alpine`, a named volume, `pg_isready` health check, a one-shot migration service, and an app dependency on successful migration. Remove the SQLite directory creation from the image and do not mount `db/`.

- [ ] **Step 2: Add safe environment examples and ignores**

`.env.example` includes placeholder application/test URLs and documented pool defaults, never working credentials. Ignore `.env`, `*.dump`, and local PostgreSQL data directories.

- [ ] **Step 3: Rewrite database documentation**

Document local database/role creation, migration/status commands, app and replay commands, test database isolation, Compose operation, `psql` verification, TLS, `pg_dump`, and `pg_restore`. State that SQLite data is not imported.

- [ ] **Step 4: Verify image and Compose configuration**

Run: `docker build -t automower:postgres .`

Expected: image builds without native SQLite compilation.

Run: `docker compose config`

Expected: exit 0 with three resolved services and one named PostgreSQL volume.

Run: `docker compose up --build --wait`

Expected: PostgreSQL is healthy, migration exits 0, app is running, and `curl http://localhost:3000/api/status` returns HTTP 200.

- [ ] **Step 5: Verify persistence across restart**

Replay a small fixture, query the event count, run `docker compose down` without `-v`, start again, and assert the count is unchanged.

- [ ] **Step 6: Run final verification**

Run: `TEST_DATABASE_URL=postgres://... npm test`

Expected: PASS with zero failures.

Run: `rg -n "better-sqlite3|AUTOMOWER_DB_PATH|mower-data.sqlite|sqlite3" src scripts package.json Dockerfile compose.yaml README.md`

Expected: no runtime/configuration references; README may mention only that legacy SQLite history is not imported.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add Dockerfile compose.yaml .env.example .gitignore README.md
git commit -m "Document PostgreSQL deployment"
```

