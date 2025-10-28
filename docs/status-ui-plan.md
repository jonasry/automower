# Status UI Integration Plan

## Goals
- Replace placeholder status UI in `public/map.html` with live data for mower state, battery, and session stats.
- Keep the heatmap endpoint untouched while adding supporting APIs for status and session metadata.
- Ensure the page can handle multiple mowers and future status fields without layout rewrites.

## Current Observations
- `public/map.html` only calls `/api/positions` and hardcodes mower selection, battery level, and session info blocks.
- Backend state lives in `mowerStates` (`src/state.js`), populated from the initial REST call in `src/app.js` and updated by WebSocket events in `src/amconnect.js`, but only tracks `activity`, `mowerName`, and a timestamp.
- Session data is implied via the `session_id` column in SQLite (`src/db.js`), and a new `events` table now stores raw Automower payloads (activity, messages, timestamps) that we can tap for richer status views, but there is still no API surface for aggregated metadata.

## Backend Work
1. **Enrich tracked mower state**
   - Extend the object stored in `mowerStates` to capture battery percentage, charging state, connection status, and last-known position.
   - Parse the extra fields both from the initial `/v1/mowers` fetch in `src/app.js` and the ongoing `mower-event-v2` messages in `src/amconnect.js`.
   - Keep timestamps (activity change vs. last event) distinct so the frontend can show “last updated” accurately.
   - OpenAPI document available in docs/swagger/amconnect.yml.

2. **Derive session summaries**
   - Add a helper in `src/db.js` (or a dedicated module) to group persisted data by `mower_id` and `session_id`, combining `positions` rows with relevant `events` to return start/end timestamps, duration, point counts, and notable status messages.
   - Consider exposing the most recent N sessions per mower, ordered newest-first, so the UI can populate the session drop-down while keeping responses small.

3. **Expose a status API**
   - Create a new route (e.g., `GET /api/status`) in `src/server.js` that returns a payload such as:
     ```json
     {
       "mowers": [{"id":"...","name":"...","activity":"MOWING","battery":76,"lastUpdate":"2024-04-09T12:34:56Z","sessionId":1702564023456}],
       "sessions": {"<mowerId>": [{"id":1702564023456,"start":"...","end":"...","durationMinutes":42,"points":138,"messages":[{"code":713,"severity":"WARNING","time":"..."}]}]}
     }
     ```
   - Bubble up last message severity, charging events, or error states by reading the persisted `events` table, while keeping the live mower snapshot lean.
   - Keep responses cacheable for a few seconds (matching the heat endpoint) and handle empty data gracefully.

4. **Wire session selection to heat data**
   - Allow `/api/positions` to accept optional `mowerId` and `sessionId` query params so the UI can request a specific session’s trail.
   - Default behaviour should remain the latest session of the default mower to preserve current functionality.

## Frontend Work
1. **Introduce a status fetcher**
   - Add a new polling function in `public/map.html` that calls `/api/status`, populates the mower picker, and updates the battery + activity display.
   - Handle missing fields (e.g., unknown battery) by showing placeholders or muted text.

2. **Session dropdown population**
   - When status data arrives, fill the sidebar session select with the latest sessions for the active mower (include formatted start/end labels).
   - On selection change, trigger a reload of the map data with the chosen mower/session via the new query params.

3. **Render session info block**
   - Replace placeholder list items with real values (start/end/duration/points) from the selected session summary.
   - Add lightweight formatting helpers for timestamps and durations so the UI stays readable.

4. **Synchronise map + status refresh**
   - Coordinate polling intervals so `loadData()` (heatmap) and the new status updater run together, using cached selections to avoid flicker.
   - Consider a `Promise.all` approach to fetch both endpoints concurrently when the page refreshes.

5. **Visual polish**
   - Adjust the battery component to reflect critical levels with existing colour logic and show charging state (e.g., bolt icon) when applicable.
   - Optionally surface last-known position time near the battery/activity line to convey freshness.

## Testing & Validation
- Seed the database with multiple sessions (use `src/test.sql` or captured data) and verify the dropdown orders sessions correctly.
- Simulate WebSocket events containing battery and activity changes to confirm the status API reflects updates without page reloads.
- Manually test edge cases: no mowers available, missing battery info, session without positions, long idle periods.

## Open Questions
- Confirm the Husqvarna event payloads expose battery percentage and charging flags as expected; if not, adjust scope.
- Decide whether the initial status fetch should include historical sessions or if a separate endpoint/report is needed later.
- Determine acceptable polling cadence (30s vs. faster) to balance freshness with API load.
