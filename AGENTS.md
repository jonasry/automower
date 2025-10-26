# Repository Guidelines

## Project Structure & Module Organization
`src/` contains all runtime modules: `app.js` wires startup, `server.js` exposes HTTP + static assets, `amconnect.js` handles the Automower streaming client, `auth.js` manages credential refresh, and `db.js` wraps SQLite persistence. Helpers such as `state.js` and `interpolate.js` sit alongside. Static UI assets (heatmap, CSS, JS) live in `public/`. Recorded telemetry is written to `db/mower-data.sqlite`; mount or back up this directory for durability. Reference material belongs in `docs/`, and environment-specific config (API credentials, tokens) lives under `$HOME/.config/autoplanner/`.

## Build, Test, and Development Commands
```bash
npm start        # run src/app.js with live API/WebSocket pipeline
node src/app.js  # same as npm start; handy for attaching debuggers
npm test         # placeholder; replace with real suite before merging
```
Need Docker? `docker build -t automower .` then run with the `docker run` example in `README.md`, binding `db/` and `$HOME/.config/autoplanner` so tokens and history persist.

## Coding Style & Naming Conventions
Favor modern ES modules and async/await; keep indentation at 2 spaces and use single quotes unless template literals add clarity. Name modules and exports after Automower domain concepts (`mowerStates`, `startWebSocket`). Keep logging structured and purposeful—existing emoji markers are acceptable when they convey state transitions. Secrets belong in env vars or the credentials JSON, never in source.

## Testing Guidelines
No automated tests exist yet, so new features should introduce targeted coverage (Node test runner or Jest) for database writes, token refresh, and reconnection flows. Store specs next to the code as `<module>.test.js` or place them in a future `tests/` directory. Document manual verification steps in PRs until CI is configured.

## Commit & Pull Request Guidelines
Recent history uses concise, imperative subjects (`Use a window of 7 days for heat map data`). Follow that format, group related changes per commit, and reference issue IDs where relevant. Pull requests should describe intent, highlight risky areas (e.g., auth, DB schema), attach terminal output for tests, and include screenshots/GIFs whenever `public/` changes impact UX. Tag reviewers who own the affected slice of the stack.

## Security & Configuration Tips
Requires Node.js 18+ for the built-in `fetch`. Set `HQ_API_KEY`, `HQ_API_SECRET`, and optionally `PORT` via env vars or `$HOME/.config/autoplanner/credentials.json`. Token caches (`access_token.json`) are created with 0600 permissions; confirm the same when running in Docker or CI, and never commit files from `db/` or the config directory.
