# Ordered Position Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist WebSocket telemetry sequentially and render each selected mower's positions in database insertion order.

**Architecture:** A single Promise chain owns WebSocket ingestion, so one message's event and optional position writes finish before the next message starts. Position reads require a mower filter and order solely by the generated position `id`; requests without a mower selection return an empty payload without querying combined mower history.

**Tech Stack:** Node.js ES modules, Node test runner, Express 5, PostgreSQL 15+, `pg`.

## Global Constraints

- Process WebSocket messages through one FIFO chain with no concurrent persistence or backpressure subsystem.
- Insert an event before its optional position, and continue with the next queued message after logging an individual insert failure.
- Query positions for exactly one mower and sort them by position `id`, never by timestamp.
- Keep timestamps for informational, freshness, duration, and heat-age uses only.
- Use async/await, two-space indentation, and single quotes.

---

### Task 1: Read one mower's positions in insertion order

**Files:**
- Modify: `src/db.test.js:144-166`
- Modify: `src/db.js:109-135`
- Modify: `src/serverDatabaseErrors.test.js`
- Modify: `src/server.js:62-88`

**Interfaces:**
- Consumes: `storePosition(position)` and `getPositions({ mowerId, sessionId })` from `src/db.js`; Express `GET /api/positions`.
- Produces: `getPositions({ mowerId, sessionId })` returning rows ordered by numeric `id`; an empty positions HTTP payload when `mowerId` is absent.

- [ ] **Step 1: Change the database test to require insertion-ID order**

Replace the existing `reads ordered positions with mower and session filters` test with:

```js
test('reads one mower session in position insertion order', async () => {
  await storePosition({
    mowerId: 'mower-read-a', sessionId: 10, state: 'MOWING', lat: 55.2, lon: 13.2,
    timestamp: '2026-07-12T13:02:00.000Z', eventId: null
  });
  await storePosition({
    mowerId: 'mower-read-a', sessionId: 10, state: 'MOWING', lat: 55.1, lon: 13.1,
    timestamp: '2026-07-12T13:01:00.000Z', eventId: null
  });
  await storePosition({
    mowerId: 'mower-read-a', sessionId: 10, state: 'MOWING', lat: 55.3, lon: 13.3,
    timestamp: '2026-07-12T13:01:00.000Z', eventId: null
  });
  await storePosition({
    mowerId: 'mower-read-b', sessionId: 20, state: 'MOWING', lat: 56.1, lon: 14.1,
    timestamp: '2026-07-12T13:00:00.000Z', eventId: null
  });

  const rows = await getPositions({ mowerId: 'mower-read-a', sessionId: 10 });

  assert.deepEqual(rows.map((row) => row.lat), [55.2, 55.1, 55.3]);
  assert.ok(rows.every((row, index) => Number.isSafeInteger(row.id) && (
    index === 0 || row.id > rows[index - 1].id
  )));
  assert.ok(rows.every((row) => row.mower_id === 'mower-read-a' && row.session_id === 10));
});
```

- [ ] **Step 2: Run the database test and verify RED**

Run:

```bash
TEST_DATABASE_URL=postgresql://luck@127.0.0.1:5432/postgres node --import ./src/testDbSetup.js --test src/db.test.js
```

Expected: FAIL because the current query sorts the reversed timestamps chronologically and does not return `id`.

- [ ] **Step 3: Add an HTTP test for the missing-mower case**

Append to `src/serverDatabaseErrors.test.js`:

```js
test('returns empty positions without querying all mowers', async () => {
  setPoolForTests({
    query: async () => { throw new Error('positions query should not run'); },
    end: async () => {}
  });

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/positions`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      heat: [],
      recent: [],
      session: null
    });
  });
});
```

- [ ] **Step 4: Run the HTTP test and verify RED**

Run:

```bash
TEST_DATABASE_URL=postgresql://luck@127.0.0.1:5432/postgres node --import ./src/testDbSetup.js --test src/serverDatabaseErrors.test.js
```

Expected: FAIL with status 500 because the current route invokes an unfiltered positions query.

- [ ] **Step 5: Implement the insertion-order database read**

Change `getPositions` in `src/db.js` to reject the all-mower read by returning no rows, select `id`, and order by it:

```js
async function getPositions({ mowerId, sessionId } = {}) {
  if (!mowerId) return [];

  const clauses = ['mower_id = $1'];
  const params = [mowerId];

  if (sessionId != null && sessionId !== '') {
    params.push(sessionId);
    clauses.push(`session_id = $${params.length}`);
  }

  const result = await getPool().query(`
    SELECT id, mower_id, session_id, lat, lon, timestamp, activity
    FROM positions
    WHERE ${clauses.join(' AND ')}
    ORDER BY id
  `, params);

  return result.rows.map((row) => ({
    ...row,
    id: toSafeInteger(row.id, 'positions.id'),
    session_id: row.session_id == null ? null : toSafeInteger(row.session_id, 'positions.session_id'),
    timestamp: iso(row.timestamp)
  }));
}
```

- [ ] **Step 6: Short-circuit the positions endpoint without a mower ID**

At the start of the `/api/positions` handler in `src/server.js`, normalize and require the mower ID before constructing filters:

```js
app.get('/api/positions', async (req, res) => {
  const { mowerId, sessionId } = req.query;
  const selectedMowerId = typeof mowerId === 'string' ? mowerId.trim() : '';

  res.set('Cache-Control', 'public, max-age=15');
  if (!selectedMowerId) {
    return res.json(buildPositionsPayload());
  }

  const heatFilters = { mowerId: selectedMowerId };
  const trailFilters = { mowerId: selectedMowerId };
  let selectedSessionId = null;
```

Remove the old optional `mowerId` filter block and keep the existing session parsing, interpolation calls, and response. Do not set `Cache-Control` a second time at the end.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```bash
TEST_DATABASE_URL=postgresql://luck@127.0.0.1:5432/postgres node --import ./src/testDbSetup.js --test src/db.test.js src/interpolate.test.js src/serverDatabaseErrors.test.js
```

Expected: all focused tests PASS.

- [ ] **Step 8: Commit the ordered read contract**

```bash
git add src/db.js src/db.test.js src/server.js src/serverDatabaseErrors.test.js
git commit -m "Read mower positions in insertion order"
```

---

### Task 2: Serialize WebSocket ingestion with one FIFO chain

**Files:**
- Modify: `src/amconnectPersistence.test.js`
- Modify: `src/amconnectFailure.test.js`
- Modify: `src/amconnect.js:10-15,261-282`
- Delete: `src/amconnectBackpressure.test.js`

**Interfaces:**
- Consumes: `handleIncomingEvent(data)`, `storeEvent`, and `storePosition`.
- Produces: `enqueueIncomingEvent(data)` returning the shared FIFO tail Promise and `drainIncomingEvents()` awaiting all messages enqueued before the call.

- [ ] **Step 1: Replace the persistence test with a deterministic FIFO test**

Replace `src/amconnectPersistence.test.js` with:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { drainIncomingEvents, enqueueIncomingEvent } from './amconnect.js';
import { setPoolForTests } from './dbPool.js';
import { mowerStates } from './state.js';

function positionEvent(mowerId, marker) {
  return Buffer.from(JSON.stringify({
    id: mowerId,
    type: 'position-event-v2',
    attributes: {
      position: { latitude: marker, longitude: 13 + marker / 100 }
    }
  }));
}

test('persists WebSocket messages one at a time in arrival order', async () => {
  const calls = [];
  let releaseFirstEvent;
  const firstEventGate = new Promise((resolve) => {
    releaseFirstEvent = resolve;
  });

  setPoolForTests({
    query: async (sql, params) => {
      const marker = params[8].attributes.position.latitude;
      calls.push(`event:${marker}`);
      if (marker === 1) await firstEventGate;
      return { rows: [{ id: String(marker) }] };
    },
    connect: async () => ({
      query: async (sql, params) => {
        if (sql.includes('INSERT INTO positions')) calls.push(`position:${params[3]}`);
        return { rows: [] };
      },
      release() {}
    }),
    end: async () => {}
  });
  mowerStates.clear();

  enqueueIncomingEvent(positionEvent('fifo-mower', 1));
  enqueueIncomingEvent(positionEvent('fifo-mower', 2));
  await new Promise((resolve) => setImmediate(resolve));
  const callsBeforeRelease = [...calls];

  releaseFirstEvent();
  await drainIncomingEvents();

  assert.deepEqual(callsBeforeRelease, ['event:1']);
  assert.deepEqual(calls, ['event:1', 'position:1', 'event:2', 'position:2']);
});
```

- [ ] **Step 2: Run the FIFO test and verify RED**

Run:

```bash
TEST_DATABASE_URL=postgresql://luck@127.0.0.1:5432/postgres node --import ./src/testDbSetup.js --test src/amconnectPersistence.test.js
```

Expected: FAIL because `callsBeforeRelease` includes the second event while the first event write is blocked.

- [ ] **Step 3: Extend the failure test to prove the queue continues**

Replace the test in `src/amconnectFailure.test.js` with:

```js
test('logs a failed position write and continues with the next queued event', async () => {
  const mowerId = 'position-write-failure-mower';
  const positionError = new Error('position write failed');
  let eventWrites = 0;
  const loggedErrors = [];
  const originalConsoleError = console.error;
  setPoolForTests({
    query: async () => ({ rows: [{ id: String(++eventWrites) }] }),
    connect: async () => { throw positionError; },
    end: async () => {}
  });
  mowerStates.clear();

  console.error = (...args) => loggedErrors.push(args);
  try {
    enqueueIncomingEvent(Buffer.from(JSON.stringify({
      id: mowerId,
      type: 'position-event-v2',
      attributes: {
        position: { latitude: 55.5, longitude: 13.5 },
        metadata: { timestamp: '2026-07-12T18:00:00.000Z' }
      }
    })));
    enqueueIncomingEvent(Buffer.from(JSON.stringify({
      id: mowerId,
      type: 'battery-event-v2',
      attributes: {
        battery: { batteryPercent: 73 },
        metadata: { timestamp: '2026-07-12T18:00:01.000Z' }
      }
    })));
    await drainIncomingEvents();
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(eventWrites, 2);
  assert.equal(mowerStates.get(mowerId)?.batteryPercent, 73);
  assert.equal(
    loggedErrors.some(([message, error]) => (
      message === 'Failed to persist position:' && error === positionError
    )),
    true
  );
});
```

- [ ] **Step 4: Implement the FIFO chain**

Replace the pending persistence declarations near the top of `src/amconnect.js` with:

```js
let ingestionChain = Promise.resolve();
```

Replace `enqueueIncomingEvent`, `drainIncomingEvents`, and `getPendingPersistenceCount` with:

```js
export function enqueueIncomingEvent(data) {
  ingestionChain = ingestionChain
    .then(() => handleIncomingEvent(data))
    .catch((err) => {
      console.error('Queued WebSocket event error:', err);
    });
  return ingestionChain;
}

export function drainIncomingEvents() {
  return ingestionChain;
}
```

Remove the `MAX_PENDING_PERSISTENCE` export and delete `src/amconnectBackpressure.test.js`. Keep `persistIncomingEvent`'s per-insert error handling unchanged so failures are logged and the next queued message is processed.

- [ ] **Step 5: Run ingestion tests and verify GREEN**

Run:

```bash
TEST_DATABASE_URL=postgresql://luck@127.0.0.1:5432/postgres node --import ./src/testDbSetup.js --test src/amconnectPersistence.test.js src/amconnectFailure.test.js src/amconnectLifecycle.test.js
```

Expected: all ingestion and lifecycle tests PASS with no unexpected warnings or errors.

- [ ] **Step 6: Commit sequential ingestion**

```bash
git add src/amconnect.js src/amconnectPersistence.test.js src/amconnectFailure.test.js src/amconnectBackpressure.test.js
git commit -m "Preserve WebSocket ingestion order"
```

---

### Task 3: Document behavior and verify the feature

**Files:**
- Modify: `README.md:92-150`

**Interfaces:**
- Consumes: the ordered ingestion and position query behavior implemented in Tasks 1 and 2.
- Produces: operator-facing documentation of FIFO persistence, ID ordering, timestamp semantics, and failure continuation.

- [ ] **Step 1: Update event-storage documentation**

After the first paragraph under `## Event storage and replay`, add:

```markdown
WebSocket messages are persisted sequentially in arrival order. For a position
message, its event row is written before its linked position row. Position
identity IDs therefore define mower trail and heat-map interpolation order;
timestamps remain informational and are not used to order waypoints because
events without a source timestamp receive an arrival timestamp.

If an individual event or position insert fails, the error is logged and
processing continues with the next queued WebSocket message. A failed event
insert does not prevent an otherwise valid position from being stored without
an event link.
```

- [ ] **Step 2: Remove obsolete outage/backpressure documentation**

Replace the final paragraph under `## Authentication and streaming behavior` with:

```markdown
The WebSocket reconnects after the Husqvarna service's timeout or a network
interruption and sends a ping every 60 seconds. Incoming messages are handled
through the sequential persistence behavior documented under **Event storage
and replay**.
```

- [ ] **Step 3: Run the complete test suite**

Run:

```bash
TEST_DATABASE_URL=postgresql://luck@127.0.0.1:5432/postgres npm test
```

Expected: all tests PASS, with the obsolete backpressure test absent.

- [ ] **Step 4: Inspect the final branch diff**

Run:

```bash
git diff --check
git status --short
git diff HEAD~2 -- README.md src/amconnect.js src/db.js src/server.js
```

Expected: no whitespace errors; only the approved ordered-ingestion files and documentation are changed.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md
git commit -m "Document ordered telemetry persistence"
```

- [ ] **Step 6: Re-run final verification after the commit**

```bash
TEST_DATABASE_URL=postgresql://luck@127.0.0.1:5432/postgres npm test
git status --short
```

Expected: all tests PASS and the working tree is clean.
