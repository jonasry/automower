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
