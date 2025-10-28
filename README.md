# Automower API Example

This repository contains a small Node.js application that connects to the Husqvarna Automower Connect API and stores mower position data in a local SQLite database. It runs a web server that exposes an API endpoint and a simple heatmap page to visualise your mower's activity.

## Requirements

- Node.js 18+ (uses the built-in `fetch` API).
- API credentials either provided via environment variables `HQ_API_KEY` and `HQ_API_SECRET` or stored in `$HOME/.config/autoplanner/credentials.json` with the following structure:

  ```json
  {
    "api-key": "<your api key>",
    "api-secret": "<your api secret>"
  }
  ```

## Usage

Run the server with:

```bash
npm start
```

This launches `src/app.js`, which starts an HTTP server on `http://localhost:3000`. View `public/map.html` (for example at `http://localhost:3000/map.html`) to see a heatmap of recorded mower positions.

### Access Token Persistence

After a successful authentication, the script stores the received access token in
`$HOME/.config/autoplanner/access_token.json`. The file includes the token and
its expiration timestamp so that subsequent runs can reuse the token until it
expires. The file is created with owner-only permissions to keep the token
private.

### Streaming API

This application connects to the Husqvarna Automower Connect Streaming API using a WebSocket connection. When active, it receives a stream of events such as mower state updates (`mower-event-v2`) and position updates (`position-event-v2`). These events are processed in real time to maintain an up-to-date view of mower activity, which is then stored in a local SQLite database.

The WebSocket connection is subject to a 2-hour timeout per the API's limitations. When the connection is closed (either due to timeout or network issues), the application detects the closure, refreshes the authentication token if necessary, and automatically re-establishes the connection. This ensures continuous data collection without manual intervention.

A periodic `ping` is sent every 60 seconds to keep the connection alive. If the application is restarted, it will reuse a cached token from disk if it's still valid, or request a new one if needed.

#### Event storage

Every WebSocket payload (battery, planner, mower status, etc.) is persisted to the local SQLite database in the `events` table together with a normalized timestamp, optional coordinates, and the raw JSON payload for auditing. This runs alongside the existing `positions` table that backs the heatmap view.

To manually verify ingestion while developing, point `sqlite3` at the database after running the app:

```bash
sqlite3 db/mower-data.sqlite "SELECT event_type, event_timestamp, message_code FROM events ORDER BY id DESC LIMIT 5;"
```

#### Simulating event streams

When live mowing data is unavailable, you can replay recorded CSV rows (such as `data.csv`) to exercise the persistence pipeline. The replay tool generates `mower-event-v2`, `position-event-v2`, and synthetic `battery-event-v2` entries derived from the recorded session.

```bash
npm run replay -- data.csv
```

The script feeds events through the normal WebSocket handler, so both `positions` and `events` tables are populated exactly as they would be in production. By default, each replay stamps events with the current timestamp so multiple runs create fresh rows; pass `--use-recorded-timestamps` if you need to preserve the original values from the CSV.

Pass `--real-time` to keep the original pacing between events (use `--speed=30` to accelerate, or `--max-delay=0` to disable clamping):

```bash
npm run replay -- --real-time --speed=30 data.csv
```

## Docker

You can build a Docker image for the application with the included `Dockerfile`:

```bash
docker build -t automower .
```

Run the container and expose port 3000:

```bash
docker run -p 3000:3000 \
  -e HQ_API_KEY=<your api key> \
  -e HQ_API_SECRET=<your api secret> \
  -e PORT=3000 \
  -v $(pwd)/db:/usr/src/app/db \
  -v $HOME/.config/autoplanner:/root/.config/autoplanner \
  automower
```

This will start the server inside the container and serve the application at `http://localhost:3000`.
