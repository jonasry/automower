# Message Event Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single sidebar status field with the latest five mower-wide message events and show error/warning message markers on the map.

**Architecture:** Add a focused database read helper for latest mower message events, enrich those rows in `/api/status`, then render the list and map markers from the selected mower payload. Keep all persistence append-only; the five-row cap is a read limit.

**Tech Stack:** Node.js ES modules, `better-sqlite3`, Express, plain browser JavaScript, Leaflet.

---

## File Structure

- `src/db.js`: add `latestMessagesStmt` and exported `getLatestMessages(mowerId, limit = 5)`.
- `src/latestMessages.test.js`: test newest-first filtering, limiting, and coordinate inclusion using the real DB helper.
- `src/server.js`: include `messages` in each mower summary, enriched from `messageDescriptions`.
- `public/map.html`: replace the current `Status` detail row with an event log container.
- `public/map.js`: render log rows and message marker layer for ERROR/WARNING rows with coordinates.
- `public/map.css`: style compact event log rows and map marker icons.

## Task 1: Database Latest Message Helper

**Files:**
- Modify: `src/db.js`
- Create: `src/latestMessages.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/latestMessages.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { storeEvent, getLatestMessages } from './db.js';

test('getLatestMessages returns latest mower message events with coordinates', () => {
  const mowerId = `mower-${Date.now()}`;
  const otherMowerId = `${mowerId}-other`;

  storeEvent({
    mowerId,
    eventType: 'message-event-v2',
    eventTimestamp: '2026-05-09T10:00:00.000Z',
    receivedAt: '2026-05-09T10:00:01.000Z',
    lat: 55.1,
    lon: 13.1,
    messageCode: 100,
    messageSeverity: 'INFO',
    payload: JSON.stringify({ test: 'old' })
  });
  storeEvent({
    mowerId,
    eventType: 'battery-event-v2',
    eventTimestamp: '2026-05-09T10:30:00.000Z',
    receivedAt: '2026-05-09T10:30:01.000Z',
    lat: null,
    lon: null,
    messageCode: null,
    messageSeverity: null,
    payload: JSON.stringify({ test: 'battery' })
  });
  storeEvent({
    otherMowerId,
    eventType: 'message-event-v2',
    eventTimestamp: '2026-05-09T11:00:00.000Z',
    receivedAt: '2026-05-09T11:00:01.000Z',
    lat: 55.9,
    lon: 13.9,
    messageCode: 999,
    messageSeverity: 'ERROR',
    payload: JSON.stringify({ test: 'other-mower' })
  });
  storeEvent({
    mowerId,
    eventType: 'message-event-v2',
    eventTimestamp: '2026-05-09T12:00:00.000Z',
    receivedAt: '2026-05-09T12:00:01.000Z',
    lat: 55.2,
    lon: 13.2,
    messageCode: 200,
    messageSeverity: 'WARNING',
    payload: JSON.stringify({ test: 'new' })
  });

  assert.deepEqual(getLatestMessages(mowerId, 2), [
    {
      timestamp: '2026-05-09T12:00:00.000Z',
      code: 200,
      severity: 'WARNING',
      lat: 55.2,
      lon: 13.2
    },
    {
      timestamp: '2026-05-09T10:00:00.000Z',
      code: 100,
      severity: 'INFO',
      lat: 55.1,
      lon: 13.1
    }
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/latestMessages.test.js`

Expected: FAIL because `getLatestMessages` is not exported.

- [ ] **Step 3: Implement the helper**

In `src/db.js`, add a prepared statement:

```js
const latestMessagesStmt = db.prepare(`
  SELECT
    event_timestamp,
    message_code,
    message_severity,
    lat,
    lon
  FROM events
  WHERE mower_id = ?
    AND event_type = 'message-event-v2'
    AND event_timestamp IS NOT NULL
  ORDER BY event_timestamp DESC
  LIMIT ?
`);
```

Add:

```js
function getLatestMessages(mowerId, limit = 5) {
  if (!mowerId) return [];
  const limitValue = Number(limit);
  const lim = Number.isFinite(limitValue) ? Math.max(1, Math.floor(limitValue)) : 5;
  return latestMessagesStmt.all(mowerId, lim).map((row) => ({
    timestamp: row.event_timestamp,
    code: row.message_code,
    severity: row.message_severity,
    lat: row.lat,
    lon: row.lon
  }));
}
```

Export `getLatestMessages`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/latestMessages.test.js`

Expected: PASS.

## Task 2: Status API Messages Payload

**Files:**
- Modify: `src/server.js`

- [ ] **Step 1: Add latest messages to mower summaries**

Import `getLatestMessages` and map rows into `messages`:

```js
const latestMessages = getLatestMessages(mowerId, 5).map((message) => ({
  code: message.code ?? null,
  severity: message.severity ?? null,
  timestamp: message.timestamp ?? null,
  description: message.code != null ? messageDescriptions.get(message.code) ?? null : null,
  lat: message.lat ?? null,
  lon: message.lon ?? null
}));
```

Add `messages: latestMessages` to `mowerSummary`.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`

Expected: PASS.

## Task 3: Sidebar Event Log

**Files:**
- Modify: `public/map.html`
- Modify: `public/map.js`
- Modify: `public/map.css`

- [ ] **Step 1: Replace the status row markup**

In `public/map.html`, replace:

```html
<p class="detail-row"><span>Status</span><strong id="statusValue">Waiting for data</strong></p>
```

with:

```html
<div class="event-log" aria-label="Mower message events">
  <div class="event-log__header">
    <span>Events</span>
    <strong>Latest 5</strong>
  </div>
  <div id="eventLog" class="event-log__rows">
    <p class="event-log__empty">No mower messages recorded</p>
  </div>
</div>
```

- [ ] **Step 2: Render event rows**

In `public/map.js`, replace `statusValue` usage with `eventLog`, add severity icon helpers, and add:

```js
function renderEventLog(messages = []) {
  eventLog.innerHTML = '';
  if (!Array.isArray(messages) || messages.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'event-log__empty';
    empty.textContent = 'No mower messages recorded';
    eventLog.appendChild(empty);
    return;
  }

  messages.slice(0, 5).forEach((message) => {
    const row = document.createElement('div');
    row.className = 'event-row';

    const severity = document.createElement('span');
    severity.className = 'event-row__severity';
    const icon = getSeverityIcon(message.severity);
    severity.textContent = icon ? `${icon} ${message.severity}` : (message.severity ?? 'INFO');

    const time = document.createElement('time');
    time.className = 'event-row__time';
    time.textContent = formatTimestamp(message.timestamp);

    const code = document.createElement('span');
    code.className = 'event-row__code';
    code.textContent = message.code != null ? String(message.code) : '-';

    const description = document.createElement('span');
    description.className = 'event-row__message';
    description.textContent = message.description ?? 'Unknown message';

    row.append(severity, time, code, description);
    eventLog.appendChild(row);
  });
}
```

Call `renderEventLog(activeMower.messages)` from `renderStatus()` and the no-data branch with `[]`.

- [ ] **Step 3: Style the event log**

Add CSS classes for `.event-log`, `.event-log__header`, `.event-row`, `.event-row__severity`, `.event-row__time`, `.event-row__code`, `.event-row__message`, and `.event-log__empty`.

## Task 4: Message Markers

**Files:**
- Modify: `public/map.js`
- Modify: `public/map.css`

- [ ] **Step 1: Add a message marker layer**

Add `let messageLayer = null;`, remove it in `clearLayers()`, and create:

```js
function renderMessageMarkers(messages = []) {
  messageLayer = L.layerGroup();
  messages.forEach((message) => {
    const lat = Number(message.lat);
    const lon = Number(message.lon);
    const icon = getSeverityIcon(message.severity);
    if (!icon || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    L.marker([lat, lon], {
      icon: makeMessageMarker(message.severity, icon)
    }).addTo(messageLayer);
  });
  messageLayer.addTo(map);
}
```

Call it after `renderRecentPath(recent)` in `loadData()`.

- [ ] **Step 2: Add marker icon styling**

Use a Leaflet `divIcon` with `.message-marker`, `.message-marker--error`, and `.message-marker--warning` classes. Style them as compact circular icons that match the sidebar severity icon.

- [ ] **Step 3: Run tests and manually inspect**

Run: `npm test`

Start the app if needed with `npm start` and open `http://localhost:3000/map.html`. Verify the event log displays rows and error/warning markers appear when messages include coordinates.
