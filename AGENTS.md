# Repository Guidelines

## Project Structure & Module Organization
Runtime code lives in `src/`. `app.js` composes startup, `appLifecycle.js` owns startup and graceful shutdown ordering, `server.js` serves the HTTP API, SSE notifications, and static UI, and `amconnect.js` manages the Husqvarna WebSocket and sequential event-ingestion queue. Authentication and token caching live in `auth.js`.

PostgreSQL is the only supported database. Queries and persistence are in `db.js`, pooling and safe integer conversion in `dbPool.js`, connection settings in `dbConfig.js`, and startup migration checks in `dbMigrations.js`. Versioned SQL migrations live in `migrations/`; the application checks them at startup but never applies them automatically.

Event normalization, mower state, interpolation, and session summaries are split across focused modules in `src/`. Generated mower-map fetching, SVG validation, and API routing use the `mowerMap*.js` modules. Browser assets and their co-located Node tests live in `public/`. Telemetry replay tooling is in `scripts/`, plans and reference material are in `docs/`, and files under `docs/swagger/` follow the more specific instructions in `docs/swagger/AGENTS.md`.

## Setup, Database, and Development Commands
Use Node.js 18 or later. Install exactly the locked dependencies with `npm ci` (use `npm install` only when intentionally changing dependencies). Copy `.env.example` to the ignored `.env` file and replace its placeholders before running the application or tests.

```bash
npm run db:migrate         # apply pending migrations to DATABASE_URL
npm run db:migrate:status  # preview pending migrations without applying them
npm start                  # load .env and run the HTTP/WebSocket application
npm test                   # load .env and run the complete Node test suite
```

Do not treat `node src/app.js` as equivalent to `npm start`: the npm script preloads `src/loadEnv.js`. The map is served at `http://localhost:3000/map.html` unless `PORT` overrides the default.

For a Compose-managed local stack, configure `.env` and run:

```bash
docker compose up --build --wait
docker compose logs -f app
docker compose down
```

Compose runs PostgreSQL, applies migrations through a one-shot service, and stores telemetry in the `postgres-data` volume. `docker compose down` retains that volume; use `docker compose down -v` only when intentionally deleting local telemetry.

Replay recorded CSV telemetry through the normal ingestion path with `npm run replay -- data.csv`. See `README.md` for timestamp, pacing, backup, restore, and hosted-PostgreSQL details.

## Database and Migration Guidelines
Set `DATABASE_URL` for the runtime database and `TEST_DATABASE_URL` for a separate test database. Never point both variables at the same database. The test role must be able to connect and create/drop schemas in its dedicated database.

Add schema changes as a new, ordered SQL file in `migrations/`; do not rewrite a migration that may already have been applied. Run the migration, verify `npm run db:migrate:status`, and add or update database-backed tests. Keep migrations compatible with PostgreSQL 15 or later unless the documented minimum changes.

Preserve the ingestion guarantees when changing persistence: WebSocket payloads are processed sequentially in arrival order, an event is inserted before its linked position, and position identity order defines trail and heat-map waypoint order. Timestamps are informational and may be synthesized for events that lack source timestamps. Keep individual write failures isolated so one malformed event does not stall the queue.

## Testing Guidelines
Tests use the built-in Node test runner and are co-located as `*.test.js` under `src/` and `public/`. `src/testDbSetup.js` loads `.env`, requires `TEST_DATABASE_URL`, refuses to fall back to the runtime database, creates a unique schema for each test process, applies all migrations, and drops the schema afterward.

Run the full suite with `npm test`. Run a focused file while retaining the isolated database harness with, for example:

```bash
node --import ./src/testDbSetup.js --test src/db.test.js
node --import ./src/testDbSetup.js --test public/mapProjection.test.js
```

Add targeted coverage for changed behavior, especially database writes and queries, migration readiness, authentication, WebSocket reconnection and ordering, graceful shutdown, HTTP error handling, and browser settings. Tests that inspect browser source or styles belong beside the relevant `public/` module. Record manual verification steps in the PR for behavior that automated tests cannot cover.

## Coding Style & Design Conventions
Use modern ES modules and async/await, two-space indentation, and single quotes unless a template literal is clearer. Keep modules focused and name exports after Automower domain concepts. Prefer dependency injection at network, database, clock, and lifecycle boundaries so behavior remains testable.

Keep logs structured and purposeful; existing emoji markers are acceptable when they communicate lifecycle transitions. Preserve safe HTTP error responses: log diagnostic detail server-side without returning credentials, SQL, upstream bodies, or stack traces to clients. Treat downloaded mower SVG as untrusted input and retain its size, structure, and external-content guards.

## Configuration and Security
Required runtime configuration is `DATABASE_URL` plus Husqvarna credentials supplied as `HQ_API_KEY` and `HQ_API_SECRET` or through `$HOME/.config/autoplanner/credentials.json`. Tests additionally require `TEST_DATABASE_URL`. Optional settings include `PORT`, `PG_SSL`, `PG_POOL_MAX`, `PG_IDLE_TIMEOUT_MS`, `PG_CONNECTION_TIMEOUT_MS`, and `PG_QUERY_TIMEOUT_MS`; keep `.env.example` and `README.md` aligned when adding configuration.

Never commit `.env`, database dumps, credentials, tokens, or recorded telemetry containing sensitive mower data. Access tokens are cached at `$HOME/.config/autoplanner/access_token.json` with owner-only permissions; preserve those permissions in local, Docker, and CI environments. Keep TLS certificate verification enabled when `PG_SSL=require`. Back up PostgreSQL with `pg_dump`, protect backups as sensitive data, and test restoration periodically.

## Commit and Pull Request Guidelines
Use concise, imperative commit subjects and group related changes. PRs should explain intent, call out risky areas such as authentication, ingestion ordering, lifecycle behavior, or schema changes, and include the exact test and migration commands run with their results. Include screenshots or GIFs whenever changes under `public/` affect the UI, and describe backup, rollout, or compatibility considerations for database changes.
