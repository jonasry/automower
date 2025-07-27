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

The credentials file is likewise updated with the API key and secret that were
used for authentication so that future runs can reuse them without setting
environment variables.
