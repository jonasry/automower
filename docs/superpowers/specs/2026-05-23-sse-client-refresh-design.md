# SSE Client Refresh Design

## Goal

Replace the browser's fixed scheduled data pull with server notifications. The browser should still fetch `/api/status` and `/api/positions` in the same way it does today, but it should do so when the local server announces that mower data changed. If notifications are quiet for a while, the browser should still refresh on a fallback timeout.

## Architecture

The app server exposes a one-way Server-Sent Events endpoint at `/api/events`. Browsers connect with `EventSource`. The server keeps a small set of active response streams and publishes a JSON notification whenever the Automower WebSocket handler persists or applies a meaningful incoming event.

The notification payload is intentionally small:

- `type`: the upstream event type, such as `position-event-v2`, `battery-event-v2`, or `message-event-v2`
- `mowerId`: the affected mower when available
- `eventId`: persisted event id when available
- `timestamp`: the event timestamp used by the server
- `changed`: coarse change categories the client can use later, such as `position`, `status`, `battery`, or `message`

The first client implementation treats all data-change events as a signal to call the existing `refreshAll()` flow. Keeping fetch/render logic unchanged limits risk and preserves current filtering behavior.

## Data Flow

1. The browser loads once with `refreshAll()`.
2. The browser opens `new EventSource('/api/events')`.
3. `src/amconnect.js` handles an incoming Automower message, updates state/DB, and publishes a data-change notification.
4. `src/server.js` writes the notification to all connected SSE clients.
5. `public/map.js` receives the notification and calls `refreshAll()`.
6. If no event arrives within the fallback interval, the browser calls `refreshAll()` anyway and resets the fallback timer.

## Error Handling

The SSE endpoint sends periodic keepalive comments so proxies and browsers keep the stream open. Closed connections are removed from the subscriber set. If the browser's `EventSource` reports an error, native reconnection is allowed to continue and the timeout fallback still refreshes data.

The existing fetch error handling remains responsible for rendering delayed-update messaging.

## Testing

Server tests cover subscriber add/remove behavior and notification payload delivery without binding a real port. Client tests cover that the fallback timeout remains and that the old unconditional `setInterval(refreshAll, ...)` polling pattern is removed in favor of the SSE setup.
