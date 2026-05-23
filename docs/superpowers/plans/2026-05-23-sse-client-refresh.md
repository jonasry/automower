# SSE Client Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the browser when the server announces mower data changes, with a timeout fallback when no events arrive.

**Architecture:** Add a small server-side SSE notifier module with a singleton bus. `src/server.js` exposes `/api/events`, `src/amconnect.js` publishes notifications after meaningful Automower events, and `public/map.js` uses `EventSource` plus a fallback timer to call the existing `refreshAll()` fetch flow.

**Tech Stack:** Node.js ES modules, Express 5, native browser `EventSource`, Node test runner.

---

## File Structure

- Create `src/clientEvents.js`: Own active SSE subscribers, response formatting, keepalives, cleanup, and publish helpers.
- Create `src/clientEvents.test.js`: Unit-test SSE subscriber delivery and cleanup with fake response objects.
- Modify `src/server.js`: Mount `/api/events` before static middleware and stream notifications via the singleton bus.
- Modify `src/amconnect.js`: Publish change notifications after state/DB changes for mower, position, message, battery, and other typed events.
- Modify `public/map.js`: Replace unconditional polling interval with an event-driven refresh scheduler and fallback timer.
- Create `public/mapRefresh.test.js`: Static regression test that confirms `EventSource` refresh wiring exists and the old unconditional polling interval is gone.

### Task 1: Server-Side SSE Notifier

**Files:**
- Create: `src/clientEvents.js`
- Test: `src/clientEvents.test.js`

- [ ] **Step 1: Write the failing notifier tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createClientEventBus } from './clientEvents.js';

class FakeResponse extends EventEmitter {
  constructor() {
    super();
    this.headers = null;
    this.statusCode = null;
    this.chunks = [];
    this.flushed = false;
  }

  set(headers) {
    this.headers = headers;
  }

  status(code) {
    this.statusCode = code;
    return this;
  }

  flushHeaders() {
    this.flushed = true;
  }

  write(chunk) {
    this.chunks.push(chunk);
  }
}

test('streams published mower data changes to subscribers', () => {
  const bus = createClientEventBus({ keepAliveMs: 0, now: () => '2026-05-23T10:00:00.000Z' });
  const res = new FakeResponse();

  bus.subscribe(res);
  bus.publish({
    type: 'position-event-v2',
    mowerId: 'mower-1',
    eventId: 42,
    timestamp: '2026-05-23T09:59:59.000Z',
    changed: ['position']
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'text/event-stream');
  assert.equal(res.flushed, true);
  assert.equal(bus.subscriberCount, 1);
  assert.match(res.chunks.join(''), /event: mower-data/);
  assert.match(res.chunks.join(''), /"mowerId":"mower-1"/);
  assert.match(res.chunks.join(''), /"changed":\["position"\]/);
  assert.match(res.chunks.join(''), /"notifiedAt":"2026-05-23T10:00:00.000Z"/);
});

test('removes subscribers when the response closes', () => {
  const bus = createClientEventBus({ keepAliveMs: 0 });
  const res = new FakeResponse();

  bus.subscribe(res);
  res.emit('close');

  assert.equal(bus.subscriberCount, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/clientEvents.test.js`

Expected: FAIL with `Cannot find module` for `src/clientEvents.js`.

- [ ] **Step 3: Implement minimal notifier**

```js
export function createClientEventBus({ keepAliveMs = 25000, now = () => new Date().toISOString() } = {}) {
  const subscribers = new Set();

  function writeEvent(res, eventName, payload) {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  function subscribe(res) {
    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });
    res.flushHeaders?.();
    res.write(': connected\n\n');

    const subscriber = { res, keepAliveTimer: null };
    if (keepAliveMs > 0) {
      subscriber.keepAliveTimer = setInterval(() => {
        try {
          res.write(': keepalive\n\n');
        } catch {
          cleanup();
        }
      }, keepAliveMs);
      subscriber.keepAliveTimer.unref?.();
    }

    function cleanup() {
      if (subscriber.keepAliveTimer) clearInterval(subscriber.keepAliveTimer);
      subscribers.delete(subscriber);
    }

    subscribers.add(subscriber);
    res.on?.('close', cleanup);
    return cleanup;
  }

  function publish(change) {
    const payload = {
      type: change.type ?? 'unknown',
      mowerId: change.mowerId ?? null,
      eventId: change.eventId ?? null,
      timestamp: change.timestamp ?? null,
      changed: Array.isArray(change.changed) ? change.changed : [],
      notifiedAt: now()
    };

    for (const subscriber of Array.from(subscribers)) {
      try {
        writeEvent(subscriber.res, 'mower-data', payload);
      } catch {
        if (subscriber.keepAliveTimer) clearInterval(subscriber.keepAliveTimer);
        subscribers.delete(subscriber);
      }
    }
  }

  return {
    subscribe,
    publish,
    get subscriberCount() {
      return subscribers.size;
    }
  };
}

export const clientEventBus = createClientEventBus();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/clientEvents.test.js`

Expected: PASS.

### Task 2: Server Route and Automower Notifications

**Files:**
- Modify: `src/server.js`
- Modify: `src/amconnect.js`
- Test: `src/clientEvents.test.js`

- [ ] **Step 1: Write failing integration expectations**

Extend `src/clientEvents.test.js`:

```js
test('normalizes unknown changes to an empty changed list', () => {
  const bus = createClientEventBus({ keepAliveMs: 0, now: () => '2026-05-23T10:00:00.000Z' });
  const res = new FakeResponse();

  bus.subscribe(res);
  bus.publish({ type: 'mower-event-v2', mowerId: 'mower-1' });

  assert.match(res.chunks.join(''), /"changed":\[\]/);
});
```

- [ ] **Step 2: Run test to verify it fails or guards missing behavior**

Run: `node --test src/clientEvents.test.js`

Expected before implementation: at least the new route/publish behavior is not wired in source review; after Task 1 this unit may already pass, but Task 2 still requires code wiring.

- [ ] **Step 3: Wire server route**

In `src/server.js`, import `clientEventBus` and add:

```js
app.get('/api/events', (req, res) => {
  clientEventBus.subscribe(res);
});
```

Place the route before `express.static(...)`.

- [ ] **Step 4: Publish from Automower event handling**

In `src/amconnect.js`, import `clientEventBus`. Add a local helper:

```js
function publishClientChange({ type, mowerId, eventId, timestamp, changed }) {
  clientEventBus.publish({ type, mowerId, eventId, timestamp, changed });
}
```

Call it after meaningful updates:

- mower-event-v2: `changed: ['status']`
- position-event-v2 with coordinates: `changed: ['position']`
- message-event-v2: `changed: ['message']`
- battery-event-v2: `changed: ['battery']`
- other typed events: `changed: ['status']`

- [ ] **Step 5: Run notifier tests**

Run: `node --test src/clientEvents.test.js`

Expected: PASS.

### Task 3: Browser Event-Driven Refresh

**Files:**
- Modify: `public/map.js`
- Test: `public/mapRefresh.test.js`

- [ ] **Step 1: Write failing client regression test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(__dirname, 'map.js'), 'utf8');

test('uses SSE notifications to trigger refreshes', () => {
  assert.match(source, /new EventSource\('\/api\/events'\)/);
  assert.match(source, /addEventListener\('mower-data'/);
  assert.match(source, /scheduleFallbackRefresh/);
});

test('does not use unconditional scheduled polling for refreshAll', () => {
  assert.doesNotMatch(source, /setInterval\(refreshAll,\s*STATUS_POLL_MS\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test public/mapRefresh.test.js`

Expected: FAIL because `EventSource('/api/events')` is not present and the old polling interval is present.

- [ ] **Step 3: Implement client scheduler**

In `public/map.js`, rename `STATUS_POLL_MS` to `REFRESH_FALLBACK_MS`. Add:

```js
let refreshFallbackTimer = null;
let refreshInFlight = null;

function scheduleFallbackRefresh() {
  if (refreshFallbackTimer) clearTimeout(refreshFallbackTimer);
  refreshFallbackTimer = setTimeout(() => {
    refreshFromNotification();
  }, REFRESH_FALLBACK_MS);
}

async function refreshFromNotification() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshAll()
    .catch((err) => {
      console.error(err);
    })
    .finally(() => {
      refreshInFlight = null;
      scheduleFallbackRefresh();
    });
  return refreshInFlight;
}

function startServerNotifications() {
  if (!('EventSource' in window)) {
    scheduleFallbackRefresh();
    return;
  }

  const events = new EventSource('/api/events');
  events.addEventListener('mower-data', () => {
    refreshFromNotification();
  });
  events.onerror = () => {
    scheduleFallbackRefresh();
  };
  scheduleFallbackRefresh();
}
```

Replace:

```js
refreshAll();
setInterval(refreshAll, STATUS_POLL_MS);
```

with:

```js
refreshFromNotification();
startServerNotifications();
```

- [ ] **Step 4: Run client regression test**

Run: `node --test public/mapRefresh.test.js`

Expected: PASS.

### Task 4: Full Verification

**Files:**
- All changed files.

- [ ] **Step 1: Run targeted tests**

Run: `node --test src/clientEvents.test.js public/mapRefresh.test.js`

Expected: PASS.

- [ ] **Step 2: Run full suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Inspect changed files**

Run: `git diff -- src/clientEvents.js src/clientEvents.test.js src/server.js src/amconnect.js public/map.js public/mapRefresh.test.js docs/superpowers/specs/2026-05-23-sse-client-refresh-design.md docs/superpowers/plans/2026-05-23-sse-client-refresh.md`

Expected: Diff contains only SSE notification, client fallback refresh, and docs changes.
