# Graceful Shutdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make application shutdown terminate without reconnecting or hanging on browser event streams while preserving ordinary WebSocket reconnect and authentication behavior.

**Architecture:** Add generation-based lifecycle state around the existing upstream WebSocket so intentional stops invalidate pending connects and suppress only shutdown-triggered reconnects. Give the SSE event bus ownership of closing its subscribers, then place the complete ordered shutdown sequence under one timeout.

**Tech Stack:** Node.js 18+ ES modules, `ws`, Express, Node test runner, `node:events` test fakes.

## Global Constraints

- Unexpected Automower WebSocket closures must retain the existing immediate-first-retry and exponential-backoff behavior.
- Token acquisition and refresh behavior must remain unchanged.
- SSE subscribers close only during application shutdown.
- Shutdown remains ordered and idempotent.
- No new runtime dependencies.

---

## File Structure

- `src/amconnect.js`: Own upstream WebSocket generation state, reconnect decisions, and asynchronous close completion.
- `src/amconnectLifecycle.test.js`: Exercise lifecycle policy and socket-close waiting with isolated fakes.
- `src/clientEvents.js`: Own active SSE response cleanup.
- `src/clientEvents.test.js`: Verify shutdown ends all SSE responses.
- `src/appLifecycle.js`: Orchestrate and time-bound the entire shutdown sequence.
- `src/appLifecycle.test.js`: Verify ordering, idempotence, and timeout scope.
- `src/app.js`: Wire event-stream closure into production shutdown.

### Task 1: Upstream WebSocket Lifecycle

**Files:**
- Create: `src/amconnectLifecycle.test.js`
- Modify: `src/amconnect.js:8-12,243-312`

**Interfaces:**
- Produces: `createConnectionLifecycle()` with `start(): number`, `stop(): void`, `isCurrent(generation: number): boolean`, and `shouldReconnect(generation: number): boolean`.
- Produces: `waitForWebSocketClose(socket): Promise<void>`.
- Preserves: `startWebSocket(apiKey, apiSecret): Promise<void>` and `stopWebSocket(): Promise<void>`.

- [ ] **Step 1: Write failing lifecycle-policy tests**

Create `src/amconnectLifecycle.test.js` with tests that start an isolated lifecycle, assert an unexpected close may reconnect, stop it and assert the same generation may not reconnect, and assert a later start invalidates an earlier in-flight generation:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createConnectionLifecycle, waitForWebSocketClose } from './amconnect.js';

test('intentional stop suppresses reconnect without disabling later starts', () => {
  const lifecycle = createConnectionLifecycle();
  const first = lifecycle.start();
  assert.equal(lifecycle.shouldReconnect(first), true);

  lifecycle.stop();
  assert.equal(lifecycle.shouldReconnect(first), false);

  const second = lifecycle.start();
  assert.equal(lifecycle.isCurrent(first), false);
  assert.equal(lifecycle.isCurrent(second), true);
  assert.equal(lifecycle.shouldReconnect(second), true);
});

test('waitForWebSocketClose resolves only after an active socket closes', async () => {
  class FakeSocket extends EventEmitter {
    static OPEN = 1;
    constructor() {
      super();
      this.readyState = FakeSocket.OPEN;
      this.closeCalled = false;
    }
    close() {
      this.closeCalled = true;
    }
  }

  const socket = new FakeSocket();
  let resolved = false;
  const closing = waitForWebSocketClose(socket).then(() => { resolved = true; });
  await Promise.resolve();
  assert.equal(socket.closeCalled, true);
  assert.equal(resolved, false);

  socket.readyState = 3;
  socket.emit('close');
  await closing;
  assert.equal(resolved, true);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --import ./src/testDbSetup.js --test src/amconnectLifecycle.test.js`

Expected: FAIL because `createConnectionLifecycle` and `waitForWebSocketClose` are not exported.

- [ ] **Step 3: Implement generation state and close waiting**

Add lifecycle helpers to `src/amconnect.js`:

```js
export function createConnectionLifecycle() {
  let generation = 0;
  let stopped = true;
  return {
    start() {
      stopped = false;
      generation += 1;
      return generation;
    },
    stop() {
      stopped = true;
      generation += 1;
    },
    isCurrent(candidate) {
      return !stopped && candidate === generation;
    },
    shouldReconnect(candidate) {
      return !stopped && candidate === generation;
    }
  };
}

export function waitForWebSocketClose(socket) {
  if (!socket || socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    socket.once('close', resolve);
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      try {
        socket.close();
      } catch {
        socket.removeListener('close', resolve);
        resolve();
      }
    }
  });
}
```

Create one module-level lifecycle. Keep `startWebSocket(apiKey, apiSecret)` as the explicit-start entry point: it calls `connectionLifecycle.start()` and delegates to a private `connectWebSocket(apiKey, apiSecret, generation)`. After `getToken`, the private function returns without creating a socket unless `isCurrent(generation)` is true. Capture the new socket locally and use it in handlers. In its close handler, schedule the existing reconnect only when `shouldReconnect(generation)` is true, and have the timer call the private connector with the same generation. Reusing the generation ensures a reconnect callback already in flight cannot re-enable connectivity after `stopWebSocket()` invalidates it. In `stopWebSocket`, call `connectionLifecycle.stop()`, clear timers, capture and null the current socket, then `await waitForWebSocketClose(socket)`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --import ./src/testDbSetup.js --test src/amconnectLifecycle.test.js src/amconnectPersistence.test.js`

Expected: all tests PASS, proving intentional stop policy and close waiting while retaining existing event persistence behavior.

- [ ] **Step 5: Commit the WebSocket lifecycle change**

```bash
git add src/amconnect.js src/amconnectLifecycle.test.js
git commit -m "Fix WebSocket shutdown lifecycle"
```

### Task 2: SSE Subscriber Shutdown

**Files:**
- Modify: `src/clientEvents.js:10-41,68-77`
- Modify: `src/clientEvents.test.js`

**Interfaces:**
- Produces: `clientEventBus.close(): void`, which ends every active response and leaves `subscriberCount` at zero.
- Consumes: response objects supporting `end()` and optional `on('close', ...)`.

- [ ] **Step 1: Write the failing SSE shutdown test**

Append a test using the existing response fake pattern:

```js
test('close ends active event streams and removes every subscriber', () => {
  const bus = createClientEventBus({ keepAliveMs: 0 });
  const first = new FakeResponse();
  const second = new FakeResponse();
  first.ended = false;
  second.ended = false;
  first.end = () => { first.ended = true; first.emit('close'); };
  second.end = () => { second.ended = true; second.emit('close'); };

  bus.subscribe(first);
  bus.subscribe(second);
  bus.close();

  assert.equal(first.ended, true);
  assert.equal(second.ended, true);
  assert.equal(bus.subscriberCount, 0);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test src/clientEvents.test.js`

Expected: FAIL with `bus.close is not a function`.

- [ ] **Step 3: Implement event-bus closure**

Store `cleanup` on each subscriber and add this method to the returned bus:

```js
function close() {
  for (const subscriber of Array.from(subscribers)) {
    subscriber.cleanup();
    try {
      subscriber.res.end();
    } catch {}
  }
}
```

Expose `close` beside `subscribe`, `publish`, and `onPublish`. Cleanup remains idempotent so a response's subsequent `close` event is harmless.

- [ ] **Step 4: Run the client-event tests and verify GREEN**

Run: `node --test src/clientEvents.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Commit the SSE shutdown change**

```bash
git add src/clientEvents.js src/clientEvents.test.js
git commit -m "Close event streams during shutdown"
```

### Task 3: Complete Shutdown Timeout and Production Wiring

**Files:**
- Modify: `src/appLifecycle.js:16-45`
- Modify: `src/appLifecycle.test.js:32-62`
- Modify: `src/app.js:1-7,102-112`

**Interfaces:**
- `createShutdown()` additionally consumes `closeClientEvents(): void | Promise<void>`.
- The shutdown promise covers `stopWebSocket`, `closeClientEvents`, `closeHttpServer`, `drainIncomingEvents`, and `closeDb` under `timeoutMs`.

- [ ] **Step 1: Write failing ordering and timeout tests**

Update the existing ordered-shutdown test to supply `closeClientEvents` and expect `['websocket', 'events', 'http', 'drain', 'database']`. Replace the drain-specific timeout test with a stalled HTTP close:

```js
test('shutdown timeout covers a stalled HTTP close', async () => {
  const shutdown = createShutdown({
    stopWebSocket: async () => {},
    closeClientEvents: async () => {},
    closeHttpServer: async () => new Promise(() => {}),
    drainIncomingEvents: async () => {},
    closeDb: async () => {},
    timeoutMs: 5
  });

  await assert.rejects(shutdown(), /Timed out during shutdown after 5ms/);
});
```

- [ ] **Step 2: Run lifecycle tests and verify RED**

Run: `node --test src/appLifecycle.test.js`

Expected: ordering FAILS because event streams are not closed, and the timeout test remains pending until the test runner reports an unresolved promise because the timeout does not cover HTTP closure.

- [ ] **Step 3: Implement whole-sequence timeout and wire SSE closure**

Change `withTimeout` to reject with `Timed out during shutdown after ${timeoutMs}ms`. Add `closeClientEvents` to `createShutdown` and wrap the complete sequence:

```js
const work = (async () => {
  await stopWebSocket();
  await closeClientEvents();
  await closeHttpServer();
  await drainIncomingEvents();
  await closeDb();
})();
shutdownPromise = withTimeout(work, timeoutMs);
```

In `src/app.js`, import `clientEventBus` from `./clientEvents.js` and pass:

```js
closeClientEvents: () => clientEventBus.close(),
```

- [ ] **Step 4: Run lifecycle and event-stream tests and verify GREEN**

Run: `node --test src/appLifecycle.test.js src/clientEvents.test.js`

Expected: all tests PASS, including a bounded stalled HTTP shutdown.

- [ ] **Step 5: Commit the orchestrator change**

```bash
git add src/app.js src/appLifecycle.js src/appLifecycle.test.js
git commit -m "Bound graceful application shutdown"
```

### Task 4: Full Verification

**Files:**
- Review only; no planned production changes.

**Interfaces:**
- Verifies all interfaces and global constraints from Tasks 1-3.

- [ ] **Step 1: Run formatting and patch checks**

Run: `git diff main --check`

Expected: exit 0 with no whitespace errors.

- [ ] **Step 2: Run the complete test suite**

Run: `npm test`

Expected: all repository tests PASS. If the configured PostgreSQL test database is unavailable, record that environment failure and run every database-independent affected test directly with `node --test`.

- [ ] **Step 3: Review branch scope and lifecycle guarantees**

Run: `git diff main --stat && git log --oneline main..HEAD && git status --short`

Expected: only the design, plan, WebSocket lifecycle, SSE cleanup, orchestrator wiring, and targeted tests are present; worktree is clean.
