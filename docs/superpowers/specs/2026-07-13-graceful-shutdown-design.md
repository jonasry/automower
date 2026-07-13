# Graceful Shutdown Design

## Goal

Make `SIGINT` and `SIGTERM` stop the application cleanly after it has connected. An intentional shutdown must not reconnect the upstream Automower WebSocket, and an open browser event stream must not prevent the process from completing shutdown.

## Considered Approaches

### Track intentional WebSocket shutdown and close SSE subscribers

Keep the existing runtime structure while adding explicit lifecycle state at the two long-lived connection boundaries. `stopWebSocket()` marks the upstream client as stopped before closing it, and the close handler reconnects only after an unexpected disconnect. The local event bus gains a shutdown operation that ends every active SSE response before `server.close()` waits for HTTP connections.

This is the selected approach because it addresses both root causes at their owning components without changing normal reconnect or notification behavior.

### Force process exit immediately on the first signal

Calling `process.exit()` without draining work would mask both connection-lifecycle bugs, but it could interrupt event persistence and database cleanup. This is rejected because graceful shutdown was introduced specifically to protect in-flight work.

### Force-close every HTTP connection

Calling `server.closeAllConnections()` would release the HTTP server, but it treats ordinary requests and intentional SSE streams identically and leaves subscriber cleanup implicit. It remains a possible last-resort timeout mechanism, not the primary shutdown path.

## Architecture and Data Flow

The upstream WebSocket owns a boolean stopped state. A normal `startWebSocket()` clears that state. `stopWebSocket()` sets it before clearing timers and closing the current socket, then resolves after the socket has closed. The socket close handler still clears ping state and logs the disconnect, but schedules a reconnect only when the client has not been intentionally stopped.

The client event bus owns its active SSE subscribers. A new `close()` operation ends each response, clears its keepalive timer, and removes it from the subscriber set. Application shutdown calls this operation before awaiting `server.close()`, allowing the server callback to complete even when a map page is open.

The lifecycle shutdown remains idempotent: all signals share one shutdown promise. The timeout is moved around the complete ordered sequence so a stall in WebSocket closure, HTTP closure, persistence draining, or database closure rejects instead of leaving the process indefinitely half-stopped.

Shutdown order is:

1. Stop the upstream WebSocket without reconnecting.
2. End all local SSE responses.
3. Stop accepting HTTP traffic and wait for remaining requests.
4. Drain in-flight incoming-event persistence.
5. Close the database pool.

## Error Handling

An already-closed or absent WebSocket is treated as stopped. Socket-close waiting must not introduce an unbounded wait; the application-level shutdown timeout covers it. Ending an SSE response is best-effort so one broken response cannot prevent cleanup of the others.

The first signal starts graceful shutdown. Repeated signals continue to observe the same idempotent promise. If the complete shutdown exceeds the configured timeout, the existing signal handler reports the failure and exits non-zero.

## Testing

Regression coverage will verify:

- an intentional WebSocket stop does not schedule a reconnect;
- `stopWebSocket()` waits for socket closure;
- closing the client event bus ends active SSE responses and removes subscribers;
- lifecycle shutdown invokes SSE closure before HTTP closure;
- the lifecycle timeout also covers a stalled HTTP close;
- existing unexpected-disconnect reconnection and shutdown idempotence remain intact.

