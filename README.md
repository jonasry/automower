# Automower API Example

This Node.js application connects to the Husqvarna Automower Connect streaming
API, stores mower telemetry in PostgreSQL, and serves a heatmap and status UI.

## Requirements

- Node.js 18 or later.
- PostgreSQL 15 or later, or Docker with Docker Compose.
- Husqvarna credentials in `HQ_API_KEY` and `HQ_API_SECRET`, or in
  `$HOME/.config/autoplanner/credentials.json` as `api-key` and `api-secret`.

PostgreSQL is the only supported runtime database. Existing data in
`db/mower-data.sqlite` is not imported automatically.

## Configure an existing PostgreSQL instance

Create separate application and test databases. Run these statements as a
PostgreSQL administrator, replacing the example passwords:

```sql
CREATE ROLE automower LOGIN PASSWORD 'replace-with-password';
CREATE DATABASE automower OWNER automower;

CREATE ROLE automower_test LOGIN PASSWORD 'replace-with-test-password';
CREATE DATABASE automower_test OWNER automower_test;
```

Set the connection strings and credentials in your shell. Do not commit real
values; `.env.example` is a reference, and `.env` is ignored by Git.

```bash
export DATABASE_URL='postgresql://automower:replace-with-password@127.0.0.1:5432/automower'
export TEST_DATABASE_URL='postgresql://automower_test:replace-with-test-password@127.0.0.1:5432/automower_test'
export HQ_API_KEY='replace-with-api-key'
export HQ_API_SECRET='replace-with-api-secret'
```

Install packages, migrate the empty application database, and start the app:

```bash
npm install
npm run db:migrate
npm run db:migrate:status
npm start
```

The map is available at <http://localhost:3000/map.html>.

## Generated mower map overlay

For each selected mower, the server downloads Husqvarna's generated SVG map
from `/v1/mowers/{mower-id}/maps/generated` and exposes only normalized geometry
to the browser. The overlay uses the final recorded position from the latest
completed `GOING_HOME` session as its charging-station anchor.

The current conversion assumes 1,000 SVG units per metre, SVG X pointing east,
SVG Y pointing north, and zero rotation. Working areas, islands, guides, and the
charging-station reference are drawn as outlines. The Settings panel stores
per-mower east/west and north/south trim in browser local storage.

If no generated map or completed return-home position is available, the normal
heatmap and mower trail continue to work without the boundary overlay. The
overlay is informational and is not a mower navigation or safety boundary.

Application startup checks connectivity and migration state. It never changes
the schema automatically. If migrations are pending, run `npm run db:migrate`
before restarting.

## Tests

`TEST_DATABASE_URL` must target a different database from `DATABASE_URL`. Each
Node test process creates its own schema, runs the migrations there, and drops
the schema afterward. The test role therefore needs `CREATE` permission on its
database.

```bash
TEST_DATABASE_URL='postgresql://automower_test:replace-with-test-password@127.0.0.1:5432/automower_test' npm test
```

The test harness refuses to fall back to `DATABASE_URL`, so a missing test URL
cannot modify the application database accidentally.

## Docker Compose

Copy `.env.example` to `.env` and replace the placeholder Husqvarna and
PostgreSQL values. Then start PostgreSQL, apply migrations, and start the app:

```bash
docker compose up --build --wait
```

Compose publishes PostgreSQL on host port `5433` by default to avoid clashing
with a PostgreSQL instance already using `5432`. Containers use port `5432`
internally. Telemetry persists in the named `postgres-data` volume.

```bash
docker compose logs -f app
docker compose down
```

`docker compose down` retains the database volume. Only use
`docker compose down -v` when you intentionally want to delete all Compose
telemetry.

## Event storage and replay

Every WebSocket payload is stored in `events` as normalized telemetry plus a
raw `JSONB` payload. Heatmap points are stored in `positions`, with `event_id`
linking a point to its source event. PostgreSQL conflict handling suppresses
duplicate events and positions.

WebSocket messages are persisted sequentially in arrival order. For a position
message, its event row is written before its linked position row. Position
identity IDs therefore define mower trail and heat-map interpolation order;
timestamps remain informational and are not used to order waypoints because
events without a source timestamp receive an arrival timestamp.

If an individual event or position insert fails, the error is logged and
processing continues with the next queued WebSocket message. A failed event
insert does not prevent an otherwise valid position from being stored without
an event link.

Inspect recent events with `psql`:

```bash
psql "$DATABASE_URL" -c \
  "SELECT event_type, event_timestamp, message_code FROM events ORDER BY id DESC LIMIT 5;"
```

Replay recorded CSV telemetry through the normal ingestion pipeline:

```bash
npm run replay -- data.csv
npm run replay -- --use-recorded-timestamps data.csv
npm run replay -- --real-time --speed=30 data.csv
```

By default replayed events receive current timestamps. `--real-time` preserves
recorded pacing; `--speed` accelerates it, and `--max-delay=0` disables pauses.

## Connection tuning and TLS

Optional settings and defaults are:

- `PG_POOL_MAX=10`
- `PG_IDLE_TIMEOUT_MS=30000`
- `PG_CONNECTION_TIMEOUT_MS=5000`
- `PG_QUERY_TIMEOUT_MS=10000`
- `PG_SSL=disable`

For a hosted provider that requires TLS, set `PG_SSL=require`. The application
keeps certificate verification enabled. Install the provider's trusted CA in
the runtime environment when it is not already trusted; do not disable
verification to work around certificate errors.

## Backup and restore

Create a compressed PostgreSQL backup:

```bash
pg_dump --format=custom --file=automower.dump "$DATABASE_URL"
```

Restore into an empty, migrated target database using its connection URL:

```bash
pg_restore --clean --if-exists --no-owner \
  --dbname='postgresql://automower:replace-with-password@127.0.0.1:5432/automower' \
  automower.dump
```

Backups contain mower history and raw event payloads. Store them securely and
test restoration periodically.

## Authentication and streaming behavior

Access tokens are cached in
`$HOME/.config/autoplanner/access_token.json` with owner-only permissions. The
WebSocket reconnects after the Husqvarna service's timeout or a network
interruption and sends a ping every 60 seconds. Incoming messages are handled
through the sequential persistence behavior documented under **Event storage
and replay**.
