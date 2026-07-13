# Mower SVG Map Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Download each mower's generated Husqvarna SVG map, anchor its millimetre geometry to the latest completed return-home position, and render an outline-only Leaflet overlay with per-mower east/north browser trim.

**Architecture:** A server-side XML parser converts the upstream SVG into bounded data-only geometry. An authenticated map client caches parsed geometry, a PostgreSQL query supplies a stable charging-station anchor, and a mower-specific Express route composes both. Pure browser modules own projection and trim persistence; `public/map.js` turns the projected geometry into a dedicated Leaflet layer and extends the existing Settings draft workflow.

**Tech Stack:** Node.js 18+ ES modules, Express 5, PostgreSQL via `pg`, `fast-xml-parser` 5.9.3, Leaflet, browser `localStorage`, Node test runner.

## Global Constraints

- Follow the approved spec at `docs/superpowers/specs/2026-07-13-mower-svg-map-overlay-design.md`.
- Interpret 1,000 SVG coordinate units as one metre.
- Treat SVG X as east-positive and SVG Y as south-positive; do not estimate or expose rotation or scale.
- Derive the SVG station origin from the first point of `lona_cs`.
- Use the final point of the latest eligible `GOING_HOME` session as the GPS anchor; exclude the active `GOING_HOME` session ID.
- Never send Husqvarna credentials, access tokens, upstream response bodies, or raw SVG markup to the browser.
- Reject SVG documents over 2 MiB, more than 256 supported elements, more than 10,000 points in one element, or more than 50,000 supported points total.
- Reject `DOCTYPE` and entity declarations and do not resolve external resources.
- Render working areas, islands, guides, and `lona_cs` as non-interactive outlines with no fill.
- Store only per-mower east/north trim in `automower.mapOverlaySettings.v1`; clamp each value to `-20.0` through `20.0` metres.
- Overlay failures must not block the base map, heatmap, trail, markers, status, or live refresh.
- Preserve two-space indentation, single quotes, async/await, structured logging, and the existing Node test runner.

---

## File Structure

- `src/mowerMapSvg.js`: validate and parse upstream XML into normalized local geometry.
- `src/mowerMapSvg.test.js`: parser, metadata, station-origin, security, and limit tests.
- `src/fixtures/mower-map.svg`: small valid generated-map fixture.
- `src/mowerMapClient.js`: authenticated fetch, bounded body read, retry, one-hour cache, stale fallback, and in-flight deduplication.
- `src/mowerMapClient.test.js`: isolated fetch/token/cache tests.
- `src/db.js`: add the PostgreSQL charging-station-anchor query.
- `src/db.test.js`: integration coverage for eligible and excluded return-home sessions.
- `src/mowerMapRoute.js`: dependency-injected route handler and response/error normalization.
- `src/mowerMapRoute.test.js`: route outcomes without real Husqvarna calls.
- `src/server.js`: register the local mower-map route and runtime client configuration hook.
- `src/app.js`: construct and configure the authenticated map client.
- `public/mapOverlaySettings.js`: normalize, load, update, and save per-mower trim.
- `public/mapOverlaySettings.test.js`: browser-storage and mower-isolation tests.
- `public/mapProjection.js`: pure SVG-to-latitude/longitude conversion and payload projection.
- `public/mapProjection.test.js`: scale, axis, trim, input-validation, and immutability tests.
- `public/map.js`: map fetching, race protection, Leaflet pane/layer construction, redraw, and Settings integration.
- `public/map.html`: boundary-overlay controls and status text.
- `public/map.css`: trim-control and overlay-status presentation.
- `public/mapOverlayUi.test.js`: static UI/source integration assertions.
- `README.md`: document the generated-map overlay, anchor assumption, and local trim.
- `package.json`, `package-lock.json`: add `fast-xml-parser` 5.9.3.

---

### Task 1: Parse generated SVG into bounded data-only geometry

**Files:**
- Create: `src/mowerMapSvg.js`
- Create: `src/mowerMapSvg.test.js`
- Create: `src/fixtures/mower-map.svg`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: UTF-8 SVG text from the map client.
- Produces: `parseMowerMapSvg(svgText, options?) -> { metadata, stationOrigin, geometry }`.
- Produces: `MowerMapError` with `code` set to `MAP_INVALID`, `MAP_NOT_AVAILABLE`, or `MAP_FETCH_FAILED` for downstream normalization.
- Produces: `SVG_LIMITS` and `MAX_SVG_BYTES` constants used by the client.

- [ ] **Step 1: Add the valid SVG fixture**

Create `src/fixtures/mower-map.svg` with this complete fixture:

```svg
<svg xmlns="http://www.w3.org/2000/svg" map-creation-datetime="2025-07-20 20:12:21" map-version="2.1" post-processing-commit="abc123" post-processing-branch="main">
  <polyline id="lona_cs" stroke="yellow" points="-1000,500 0,-1000" />
  <polygon id="main_area_0" title="Working area 0" stroke="green" fill="green" points="-2000,-2000 3000,-2000 3000,4000 -2000,4000" />
  <polygon id="island_1" title="Island 1" stroke="red" fill="red" points="0,0 500,0 500,500 0,500" />
  <polyline id="guide_1" stroke="blue" stroke-width="500" points="-1000,500 0,-1000 2000,-1500" />
  <script>alert('ignored')</script>
</svg>
```

- [ ] **Step 2: Write the failing parser tests**

Create `src/mowerMapSvg.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  MowerMapError,
  parseMowerMapSvg
} from './mowerMapSvg.js';

const fixtureUrl = new URL('./fixtures/mower-map.svg', import.meta.url);

test('parses supported geometry, metadata, and lona station origin', async () => {
  const svg = await readFile(fixtureUrl, 'utf8');
  const parsed = parseMowerMapSvg(svg);

  assert.deepEqual(parsed.metadata, {
    creationDateTime: '2025-07-20 20:12:21',
    mapVersion: '2.1',
    postProcessingCommit: 'abc123',
    postProcessingBranch: 'main'
  });
  assert.deepEqual(parsed.stationOrigin, { x: -1000, y: 500 });
  assert.equal(parsed.geometry.workingAreas[0].id, 'main_area_0');
  assert.equal(parsed.geometry.workingAreas[0].points.length, 4);
  assert.equal(parsed.geometry.islands[0].id, 'island_1');
  assert.equal(parsed.geometry.guides[0].id, 'guide_1');
  assert.deepEqual(parsed.geometry.chargingStationLine.points[1], { x: 0, y: -1000 });
  assert.equal(JSON.stringify(parsed).includes('alert'), false);
  assert.equal(JSON.stringify(parsed).includes('fill'), false);
});

test('rejects unsafe and structurally invalid documents', () => {
  const invalid = [
    '<!DOCTYPE svg [<!ENTITY x "boom">]><svg>&x;</svg>',
    '<svg><polygon id="main_area_0" points="0,0 1,0 1,1"></svg>',
    '<svg><polygon id="main_area_0" points="0,0 nope 1,1"/><polyline id="lona_cs" points="0,0 1,1"/></svg>',
    '<svg><polygon id="main_area_0" points="0,0 1,0 1,1"/></svg>',
    '<svg><polyline id="lona_cs" points="0,0 1,1"/></svg>'
  ];

  for (const svg of invalid) {
    assert.throws(
      () => parseMowerMapSvg(svg),
      (error) => error instanceof MowerMapError && error.code === 'MAP_INVALID'
    );
  }
});

test('enforces configurable limits used to exercise production guards', () => {
  const svg = '<svg><polygon id="main_area_0" points="0,0 1,0 1,1"/><polyline id="lona_cs" points="0,0 1,1"/></svg>';
  assert.throws(
    () => parseMowerMapSvg(svg, { limits: { maxBytes: 16, maxElements: 256, maxPointsPerElement: 10000, maxTotalPoints: 50000 } }),
    /2 MiB|size limit/
  );
  assert.throws(
    () => parseMowerMapSvg(svg, { limits: { maxBytes: 2097152, maxElements: 1, maxPointsPerElement: 10000, maxTotalPoints: 50000 } }),
    /element limit/
  );
});
```

- [ ] **Step 3: Run the parser test and verify it fails**

Run: `node --test src/mowerMapSvg.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/mowerMapSvg.js`.

- [ ] **Step 4: Install the XML parser dependency**

Run: `npm install fast-xml-parser@5.9.3`

Expected: `package.json` and `package-lock.json` add `fast-xml-parser` 5.9.3 and npm exits successfully.

- [ ] **Step 5: Implement the parser and error contract**

Create `src/mowerMapSvg.js` with these complete behaviors and exports:

```js
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export const MAX_SVG_BYTES = 2 * 1024 * 1024;
export const SVG_LIMITS = Object.freeze({
  maxBytes: MAX_SVG_BYTES,
  maxElements: 256,
  maxPointsPerElement: 10000,
  maxTotalPoints: 50000
});

export class MowerMapError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'MowerMapError';
    this.code = code;
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  processEntities: false,
  trimValues: true
});

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function parsePoints(value, id, limit) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MowerMapError('MAP_INVALID', `${id} has no points`);
  }
  const tokens = value.trim().split(/\s+/);
  if (tokens.length > limit) {
    throw new MowerMapError('MAP_INVALID', `${id} exceeds point limit`);
  }
  return tokens.map((token) => {
    const match = token.match(/^(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?),(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i);
    if (!match) throw new MowerMapError('MAP_INVALID', `${id} has malformed points`);
    const point = { x: Number(match[1]), y: Number(match[2]) };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new MowerMapError('MAP_INVALID', `${id} has non-finite points`);
    }
    return point;
  });
}

function normalizeElement(element, minimumPoints, limits) {
  const id = typeof element?.id === 'string' ? element.id : '';
  const points = parsePoints(element?.points, id || 'unnamed geometry', limits.maxPointsPerElement);
  if (points.length < minimumPoints) {
    throw new MowerMapError('MAP_INVALID', `${id} has too few points`);
  }
  return {
    id,
    ...(typeof element.title === 'string' ? { title: element.title } : {}),
    points
  };
}

export function parseMowerMapSvg(svgText, { limits = SVG_LIMITS } = {}) {
  if (typeof svgText !== 'string' || Buffer.byteLength(svgText) > limits.maxBytes) {
    throw new MowerMapError('MAP_INVALID', 'SVG exceeds size limit');
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(svgText)) {
    throw new MowerMapError('MAP_INVALID', 'SVG declarations are not allowed');
  }
  if (XMLValidator.validate(svgText) !== true) {
    throw new MowerMapError('MAP_INVALID', 'SVG is not well-formed XML');
  }

  const root = parser.parse(svgText)?.svg;
  if (!root || typeof root !== 'object') {
    throw new MowerMapError('MAP_INVALID', 'SVG root element is missing');
  }

  const polygons = asArray(root.polygon).filter((element) =>
    typeof element?.id === 'string' && /^(?:main_area_|island_)/.test(element.id));
  const polylines = asArray(root.polyline).filter((element) =>
    typeof element?.id === 'string' && (element.id === 'lona_cs' || element.id.startsWith('guide_')));
  if (polygons.length + polylines.length > limits.maxElements) {
    throw new MowerMapError('MAP_INVALID', 'SVG exceeds element limit');
  }

  const workingAreas = polygons.filter((item) => item.id.startsWith('main_area_')).map((item) => normalizeElement(item, 3, limits));
  const islands = polygons.filter((item) => item.id.startsWith('island_')).map((item) => normalizeElement(item, 3, limits));
  const guides = polylines.filter((item) => item.id.startsWith('guide_')).map((item) => normalizeElement(item, 2, limits));
  const lonaSource = polylines.find((item) => item.id === 'lona_cs');
  const chargingStationLine = lonaSource ? normalizeElement(lonaSource, 2, limits) : null;
  if (workingAreas.length === 0 || !chargingStationLine) {
    throw new MowerMapError('MAP_INVALID', 'SVG lacks working area or charging-station geometry');
  }

  const totalPoints = [...workingAreas, ...islands, ...guides, chargingStationLine]
    .reduce((sum, item) => sum + item.points.length, 0);
  if (totalPoints > limits.maxTotalPoints) {
    throw new MowerMapError('MAP_INVALID', 'SVG exceeds total point limit');
  }

  return {
    metadata: {
      creationDateTime: root['map-creation-datetime'] ?? null,
      mapVersion: root['map-version'] ?? null,
      postProcessingCommit: root['post-processing-commit'] ?? null,
      postProcessingBranch: root['post-processing-branch'] ?? null
    },
    stationOrigin: { ...chargingStationLine.points[0] },
    geometry: { workingAreas, islands, guides, chargingStationLine }
  };
}
```

Keep parsing limited to direct generated-SVG children, which matches `hq.svg` and avoids recursively accepting unrelated embedded markup.

- [ ] **Step 6: Run parser tests**

Run: `node --test src/mowerMapSvg.test.js`

Expected: all parser tests PASS.

- [ ] **Step 7: Commit the parser**

```bash
git add package.json package-lock.json src/mowerMapSvg.js src/mowerMapSvg.test.js src/fixtures/mower-map.svg
git commit -m "Parse generated mower SVG maps"
```

---

### Task 2: Download and cache generated maps with existing credentials

**Files:**
- Create: `src/mowerMapClient.js`
- Create: `src/mowerMapClient.test.js`

**Interfaces:**
- Consumes: `parseMowerMapSvg`, `MAX_SVG_BYTES`, `getToken(apiKey, apiSecret)`, and `refreshToken(apiKey, apiSecret)`.
- Produces: `createMowerMapClient(options) -> { getGeometry(mowerId), clear() }`.
- `getGeometry` resolves `{ metadata, stationOrigin, geometry, fetchedAt, cacheKey, stale }` or rejects with `MowerMapError`.

- [ ] **Step 1: Write failing client tests for headers, retry, cache, stale fallback, and request coalescing**

Create `src/mowerMapClient.test.js` using the fixture and this test harness:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createMowerMapClient, MAP_CACHE_TTL_MS } from './mowerMapClient.js';

const svg = await readFile(new URL('./fixtures/mower-map.svg', import.meta.url), 'utf8');

function response(body, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'image/svg+xml' } });
}

test('uses Automower headers, encodes mower id, and caches for one hour', async () => {
  let now = 1000;
  const requests = [];
  const client = createMowerMapClient({
    apiKey: 'api-key',
    apiSecret: 'api-secret',
    getToken: async () => 'token-1',
    refreshToken: async () => assert.fail('refresh not expected'),
    now: () => now,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return response(svg);
    }
  });

  const first = await client.getGeometry('mower/id');
  const second = await client.getGeometry('mower/id');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /mower%2Fid\/maps\/generated$/);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer token-1');
  assert.equal(requests[0].options.headers['Authorization-Provider'], 'husqvarna');
  assert.equal(requests[0].options.headers['X-Api-Key'], 'api-key');
  assert.equal(first.stale, false);
  assert.equal(second.cacheKey, first.cacheKey);

  now += MAP_CACHE_TTL_MS + 1;
  await client.getGeometry('mower/id');
  assert.equal(requests.length, 2);
});

test('refreshes once after authorization failure', async () => {
  const tokens = [];
  const client = createMowerMapClient({
    apiKey: 'key',
    apiSecret: 'secret',
    getToken: async () => 'old-token',
    refreshToken: async () => 'new-token',
    fetchImpl: async (_url, options) => {
      tokens.push(options.headers.Authorization);
      return tokens.length === 1 ? response('', 401) : response(svg);
    }
  });
  await client.getGeometry('mower-1');
  assert.deepEqual(tokens, ['Bearer old-token', 'Bearer new-token']);
});

test('coalesces concurrent refresh and serves stale geometry after refresh failure', async () => {
  let now = 0;
  let calls = 0;
  let fail = false;
  const client = createMowerMapClient({
    apiKey: 'key', apiSecret: 'secret',
    getToken: async () => 'token', refreshToken: async () => 'token-2',
    now: () => now,
    fetchImpl: async () => {
      calls += 1;
      if (fail) throw new Error('network down');
      await Promise.resolve();
      return response(svg);
    }
  });

  const [a, b] = await Promise.all([client.getGeometry('mower-1'), client.getGeometry('mower-1')]);
  assert.equal(calls, 1);
  assert.equal(a.cacheKey, b.cacheKey);

  now += MAP_CACHE_TTL_MS + 1;
  fail = true;
  const stale = await client.getGeometry('mower-1');
  assert.equal(stale.stale, true);
  assert.equal(calls, 2);
});

test('maps upstream absence, repeated auth failure, and oversized bodies to safe codes', async () => {
  for (const [status, expectedCode] of [[404, 'MAP_NOT_AVAILABLE'], [403, 'MAP_FETCH_FAILED']]) {
    const client = createMowerMapClient({
      apiKey: 'key', apiSecret: 'secret',
      getToken: async () => 'token', refreshToken: async () => 'refreshed',
      fetchImpl: async () => response('', status)
    });
    await assert.rejects(client.getGeometry('mower'), (error) => error.code === expectedCode);
  }

  const oversized = createMowerMapClient({
    apiKey: 'key', apiSecret: 'secret',
    getToken: async () => 'token', refreshToken: async () => 'token',
    fetchImpl: async () => response('x'.repeat(2 * 1024 * 1024 + 1))
  });
  await assert.rejects(oversized.getGeometry('mower'), (error) => error.code === 'MAP_INVALID');
});
```

- [ ] **Step 2: Run client tests and verify failure**

Run: `node --test src/mowerMapClient.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/mowerMapClient.js`.

- [ ] **Step 3: Implement authenticated fetching, bounded reads, caching, and retry**

Create `src/mowerMapClient.js`. Use these exact public constants and structure:

```js
import { Buffer } from 'node:buffer';

import { MAX_SVG_BYTES, MowerMapError, parseMowerMapSvg } from './mowerMapSvg.js';

export const MAP_CACHE_TTL_MS = 60 * 60 * 1000;
const MAP_FETCH_TIMEOUT_MS = 10000;

async function readLimitedText(response, maxBytes = MAX_SVG_BYTES) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new MowerMapError('MAP_INVALID', 'Generated map exceeds size limit');
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new MowerMapError('MAP_INVALID', 'Generated map exceeds size limit');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

export function createMowerMapClient({
  apiKey,
  apiSecret,
  getToken,
  refreshToken,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  cacheTtlMs = MAP_CACHE_TTL_MS
}) {
  const cache = new Map();
  const inFlight = new Map();

  async function request(mowerId, token) {
    return fetchImpl(`https://api.amc.husqvarna.dev/v1/mowers/${encodeURIComponent(mowerId)}/maps/generated`, {
      headers: {
        'Authorization-Provider': 'husqvarna',
        Authorization: `Bearer ${token}`,
        'X-Api-Key': apiKey
      },
      signal: AbortSignal.timeout(MAP_FETCH_TIMEOUT_MS)
    });
  }

  async function download(mowerId) {
    let token = await getToken(apiKey, apiSecret);
    let response = await request(mowerId, token);
    if (response.status === 401 || response.status === 403) {
      token = await refreshToken(apiKey, apiSecret);
      response = await request(mowerId, token);
    }
    if (response.status === 404) {
      throw new MowerMapError('MAP_NOT_AVAILABLE', 'No generated mower map is available');
    }
    if (!response.ok) {
      throw new MowerMapError('MAP_FETCH_FAILED', `Generated map request failed with status ${response.status}`);
    }

    const parsed = parseMowerMapSvg(await readLimitedText(response));
    const fetchedMs = now();
    return {
      ...parsed,
      fetchedAt: new Date(fetchedMs).toISOString(),
      fetchedMs,
      cacheKey: `${mowerId}:${fetchedMs}`
    };
  }

  async function refresh(mowerId, previous) {
    try {
      const entry = await download(mowerId);
      cache.set(mowerId, entry);
      return { ...entry, stale: false };
    } catch (error) {
      if (previous) return { ...previous, stale: true };
      if (error instanceof MowerMapError) throw error;
      throw new MowerMapError('MAP_FETCH_FAILED', 'Generated map request failed', { cause: error });
    }
  }

  async function getGeometry(mowerId) {
    const previous = cache.get(mowerId);
    if (previous && now() - previous.fetchedMs < cacheTtlMs) {
      return { ...previous, stale: false };
    }
    if (inFlight.has(mowerId)) return inFlight.get(mowerId);

    const pending = refresh(mowerId, previous).finally(() => inFlight.delete(mowerId));
    inFlight.set(mowerId, pending);
    return pending;
  }

  return { getGeometry, clear: () => cache.clear() };
}
```

In tests, provide a fetch stub that accepts but ignores `signal`; production retains the ten-second abort.

- [ ] **Step 4: Run client and parser tests**

Run: `node --test src/mowerMapSvg.test.js src/mowerMapClient.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Commit the map client**

```bash
git add src/mowerMapClient.js src/mowerMapClient.test.js
git commit -m "Fetch and cache generated mower maps"
```

---

### Task 3: Query a stable charging-station anchor

**Files:**
- Modify: `src/db.js`
- Modify: `src/db.test.js`

**Interfaces:**
- Produces: `getChargingStationAnchor(mowerId, { excludeSessionId = null } = {})`.
- Returns: `{ lat, lon, timestamp, sessionId, sourceActivity: 'GOING_HOME' } | null`.

- [ ] **Step 1: Add failing database tests for latest final point and active-session exclusion**

Append to `src/db.test.js` and import `getChargingStationAnchor`:

```js
test('selects the final position from the latest eligible going-home session', async () => {
  const mowerId = `mower-map-anchor-${Date.now()}`;
  const rows = [
    [100, 'GOING_HOME', 55.1000, 13.1000, '2026-07-13T10:00:00.000Z'],
    [100, 'GOING_HOME', 55.1001, 13.1001, '2026-07-13T10:05:00.000Z'],
    [200, 'GOING_HOME', 55.2000, 13.2000, '2026-07-13T11:00:00.000Z'],
    [200, 'GOING_HOME', 55.2002, 13.2002, '2026-07-13T11:08:00.000Z'],
    [300, 'MOWING', 56, 14, '2026-07-13T12:00:00.000Z']
  ];
  for (const [sessionId, state, lat, lon, timestamp] of rows) {
    await storePosition({ mowerId, sessionId, state, lat, lon, timestamp, eventId: null });
  }

  assert.deepEqual(await getChargingStationAnchor(mowerId), {
    lat: 55.2002,
    lon: 13.2002,
    timestamp: '2026-07-13T11:08:00.000Z',
    sessionId: 200,
    sourceActivity: 'GOING_HOME'
  });
  assert.deepEqual(await getChargingStationAnchor(mowerId, { excludeSessionId: 200 }), {
    lat: 55.1001,
    lon: 13.1001,
    timestamp: '2026-07-13T10:05:00.000Z',
    sessionId: 100,
    sourceActivity: 'GOING_HOME'
  });
});

test('returns null when only the excluded going-home session is available', async () => {
  const mowerId = `mower-map-active-${Date.now()}`;
  await storePosition({
    mowerId, sessionId: 400, state: 'GOING_HOME', lat: 55.4, lon: 13.4,
    timestamp: '2026-07-13T12:00:00.000Z', eventId: null
  });
  assert.equal(await getChargingStationAnchor(mowerId, { excludeSessionId: 400 }), null);
});
```

- [ ] **Step 2: Run the focused DB tests and verify failure**

Run: `node --import ./src/testDbSetup.js --test src/db.test.js`

Environment: `TEST_DATABASE_URL` must be exported as described in `README.md`.

Expected: FAIL because `getChargingStationAnchor` is not exported.

- [ ] **Step 3: Implement the anchor query**

Add this helper to `src/db.js`, using `toSafeInteger` for the optional input and returned session ID:

```js
async function getChargingStationAnchor(mowerId, { excludeSessionId = null } = {}) {
  if (!mowerId) return null;
  const excluded = excludeSessionId == null
    ? null
    : toSafeInteger(excludeSessionId, 'positions.session_id');
  const result = await getPool().query(`
    WITH eligible AS (
      SELECT
        id,
        session_id,
        lat,
        lon,
        timestamp,
        MAX(timestamp) OVER (PARTITION BY session_id) AS session_end,
        ROW_NUMBER() OVER (
          PARTITION BY session_id
          ORDER BY timestamp DESC, id DESC
        ) AS position_rank
      FROM positions
      WHERE mower_id = $1
        AND activity = 'GOING_HOME'
        AND session_id IS NOT NULL
        AND timestamp IS NOT NULL
        AND lat IS NOT NULL
        AND lon IS NOT NULL
        AND lat NOT IN ('NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)
        AND lon NOT IN ('NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)
        AND ($2::BIGINT IS NULL OR session_id <> $2)
    )
    SELECT session_id, lat, lon, timestamp
    FROM eligible
    WHERE position_rank = 1
    ORDER BY session_end DESC, session_id DESC
    LIMIT 1
  `, [mowerId, excluded]);

  const row = result.rows[0];
  if (!row) return null;
  return {
    lat: Number(row.lat),
    lon: Number(row.lon),
    timestamp: iso(row.timestamp),
    sessionId: toSafeInteger(row.session_id, 'positions.session_id'),
    sourceActivity: 'GOING_HOME'
  };
}
```

Add `getChargingStationAnchor` to the named export block.

- [ ] **Step 4: Run the DB tests**

Run: `node --import ./src/testDbSetup.js --test src/db.test.js`

Environment: `TEST_DATABASE_URL` must be exported.

Expected: all `src/db.test.js` tests PASS.

- [ ] **Step 5: Commit the anchor query**

```bash
git add src/db.js src/db.test.js
git commit -m "Find charging station from return-home positions"
```

---

### Task 4: Expose normalized map geometry and anchor through Express

**Files:**
- Create: `src/mowerMapRoute.js`
- Create: `src/mowerMapRoute.test.js`
- Modify: `src/server.js`
- Modify: `src/app.js`

**Interfaces:**
- Consumes: `mowerMapClient.getGeometry(mowerId)`, `getChargingStationAnchor`, `getStoredMowerIds`, and `getMowerState`.
- Produces: `createMowerMapHandler(dependencies?)` for Express and unit tests.
- Produces: `configureMowerMapClient(client)` in `src/server.js`, called once by `src/app.js` before HTTP startup.
- Produces: `GET /api/mowers/:mowerId/map` with the response contract in the approved spec.

- [ ] **Step 1: Write failing route-handler tests**

Create `src/mowerMapRoute.test.js` with a small fake response:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { MowerMapError } from './mowerMapSvg.js';
import { createMowerMapHandler } from './mowerMapRoute.js';

function fakeResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(value) { this.body = value; return this; }
  };
}

const geometryResult = {
  stale: false,
  fetchedAt: '2026-07-13T12:00:00.000Z',
  cacheKey: 'mower-1:1',
  metadata: { creationDateTime: null, mapVersion: '2.1', postProcessingCommit: null, postProcessingBranch: null },
  stationOrigin: { x: -1000, y: 500 },
  geometry: { workingAreas: [], islands: [], guides: [], chargingStationLine: { id: 'lona_cs', points: [] } }
};

test('returns ready geometry and excludes the active going-home session', async () => {
  let anchorOptions;
  const handler = createMowerMapHandler({
    getKnownMowerIds: async () => ['mower-1'],
    getMowerState: () => ({ activity: 'GOING_HOME', sessionId: 42 }),
    getGeometry: async () => geometryResult,
    getAnchor: async (_id, options) => {
      anchorOptions = options;
      return { lat: 55.7, lon: 13.2, timestamp: '2026-07-13T11:00:00.000Z', sessionId: 41, sourceActivity: 'GOING_HOME' };
    }
  });
  const res = fakeResponse();
  await handler({ params: { mowerId: 'mower-1' } }, res, assert.fail);

  assert.deepEqual(anchorOptions, { excludeSessionId: 42 });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'ready');
  assert.deepEqual(res.body.coordinateSystem.stationOrigin, { x: -1000, y: 500 });
  assert.equal(res.body.coordinateSystem.unitsPerMetre, 1000);
});

test('returns geometry with anchor-unavailable status', async () => {
  const handler = createMowerMapHandler({
    getKnownMowerIds: async () => ['mower-1'],
    getMowerState: () => ({ activity: 'PARKED_IN_CS', sessionId: 44 }),
    getGeometry: async () => geometryResult,
    getAnchor: async () => null
  });
  const res = fakeResponse();
  await handler({ params: { mowerId: 'mower-1' } }, res, assert.fail);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'anchor-unavailable');
  assert.equal(res.body.anchor, null);
});

test('returns safe error codes for unknown, missing, failed, and invalid maps', async () => {
  const cases = [
    { known: [], error: null, status: 404, code: 'UNKNOWN_MOWER' },
    { known: ['m'], error: new MowerMapError('MAP_NOT_AVAILABLE', 'missing'), status: 404, code: 'MAP_NOT_AVAILABLE' },
    { known: ['m'], error: new MowerMapError('MAP_FETCH_FAILED', 'failed'), status: 502, code: 'MAP_FETCH_FAILED' },
    { known: ['m'], error: new MowerMapError('MAP_INVALID', 'invalid'), status: 502, code: 'MAP_INVALID' }
  ];
  for (const item of cases) {
    const handler = createMowerMapHandler({
      getKnownMowerIds: async () => item.known,
      getMowerState: () => null,
      getGeometry: async () => {
        if (item.error) throw item.error;
        assert.fail('unknown mower must not request geometry');
      },
      getAnchor: async () => null
    });
    const res = fakeResponse();
    await handler({ params: { mowerId: item.known[0] ?? 'unknown' } }, res, assert.fail);
    assert.equal(res.statusCode, item.status);
    assert.equal(res.body.error.code, item.code);
    assert.equal(JSON.stringify(res.body).includes('upstream'), false);
  }
});
```

- [ ] **Step 2: Run route tests and verify failure**

Run: `node --test src/mowerMapRoute.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/mowerMapRoute.js`.

- [ ] **Step 3: Implement the dependency-injected handler**

Create `src/mowerMapRoute.js`:

```js
import { MowerMapError } from './mowerMapSvg.js';

const errorResponses = {
  MAP_NOT_AVAILABLE: [404, 'No generated mower map is available'],
  MAP_FETCH_FAILED: [502, 'Generated mower map is temporarily unavailable'],
  MAP_INVALID: [502, 'Generated mower map is invalid']
};

export function createMowerMapHandler({
  getKnownMowerIds,
  getMowerState,
  getGeometry,
  getAnchor
}) {
  return async function mowerMapHandler(req, res, next) {
    const mowerId = req.params.mowerId;
    try {
      const knownMowerIds = await getKnownMowerIds();
      if (!knownMowerIds.includes(mowerId)) {
        return res.status(404).json({ error: { code: 'UNKNOWN_MOWER', message: 'Unknown mower' } });
      }

      const state = getMowerState(mowerId);
      const excludeSessionId = state?.activity === 'GOING_HOME' ? state.sessionId ?? null : null;
      const [map, anchor] = await Promise.all([
        getGeometry(mowerId),
        getAnchor(mowerId, { excludeSessionId })
      ]);
      res.set('Cache-Control', 'private, max-age=15');
      return res.json({
        status: anchor ? 'ready' : 'anchor-unavailable',
        mowerId,
        stale: map.stale,
        fetchedAt: map.fetchedAt,
        cacheKey: map.cacheKey,
        metadata: map.metadata,
        coordinateSystem: {
          unitsPerMetre: 1000,
          xAxis: 'east',
          yAxis: 'south',
          rotationDegrees: 0,
          stationOrigin: map.stationOrigin
        },
        geometry: map.geometry,
        anchor
      });
    } catch (error) {
      if (error instanceof MowerMapError && errorResponses[error.code]) {
        const [status, message] = errorResponses[error.code];
        console.warn(`Mower map request failed for ${mowerId}: ${error.code}`);
        return res.status(status).json({ error: { code: error.code, message } });
      }
      return next(error);
    }
  };
}
```

- [ ] **Step 4: Register the route and configure the runtime client**

In `src/server.js`:

```js
import { getChargingStationAnchor, /* existing imports */ } from './db.js';
import { getMowerState, mowerStates, updateMowerState } from './state.js';
import { createMowerMapHandler } from './mowerMapRoute.js';

let mowerMapClient = null;

export function configureMowerMapClient(client) {
  if (!client || typeof client.getGeometry !== 'function') {
    throw new TypeError('Mower map client must provide getGeometry');
  }
  mowerMapClient = client;
}

async function getKnownMowerIds() {
  return Array.from(new Set([...mowerStates.keys(), ...(await getStoredMowerIds())]));
}

app.get('/api/mowers/:mowerId/map', createMowerMapHandler({
  getKnownMowerIds,
  getMowerState,
  getGeometry: (mowerId) => {
    if (!mowerMapClient) throw new Error('Mower map client is not configured');
    return mowerMapClient.getGeometry(mowerId);
  },
  getAnchor: getChargingStationAnchor
}));
```

Register the API route before `express.static` and before the final error middleware.

In `src/app.js`, import `createMowerMapClient` and `configureMowerMapClient`, then configure immediately after loading credentials:

```js
const { apiKey, apiSecret } = await loadCredentials();
if (!apiKey || !apiSecret) {
  console.error('🚷 Missing API credentials.');
  process.exit(1);
}

configureMowerMapClient(createMowerMapClient({
  apiKey,
  apiSecret,
  getToken,
  refreshToken
}));
```

- [ ] **Step 5: Run route, server, app-lifecycle, and DB tests**

Run: `node --test src/mowerMapRoute.test.js src/appLifecycle.test.js`

Expected: all non-database tests PASS.

Run: `node --import ./src/testDbSetup.js --test src/db.test.js src/serverStatus.test.js src/serverDatabaseErrors.test.js`

Environment: `TEST_DATABASE_URL` must be exported.

Expected: all database-backed tests PASS.

- [ ] **Step 6: Commit the local map endpoint**

```bash
git add src/mowerMapRoute.js src/mowerMapRoute.test.js src/server.js src/app.js
git commit -m "Expose generated mower map geometry"
```

---

### Task 5: Add pure browser projection and per-mower trim modules

**Files:**
- Create: `public/mapOverlaySettings.js`
- Create: `public/mapOverlaySettings.test.js`
- Create: `public/mapProjection.js`
- Create: `public/mapProjection.test.js`

**Interfaces:**
- Produces: `loadMapOverlaySettings`, `saveMapOverlaySettings`, `normalizeMapOverlaySettings`, `getMowerTrim`, and `setMowerTrim`.
- Produces: `projectMowerMap(payload, trim) -> { workingAreas, islands, guides, chargingStationLine }`, each with Leaflet-ready `[lat, lon]` arrays.

- [ ] **Step 1: Write failing settings tests**

Create `public/mapOverlaySettings.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAP_OVERLAY_SETTINGS_KEY,
  getMowerTrim,
  loadMapOverlaySettings,
  saveMapOverlaySettings,
  setMowerTrim
} from './mapOverlaySettings.js';

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value))
  };
}

test('normalizes per-mower trim independently and clamps to twenty metres', () => {
  const settings = setMowerTrim({ version: 1, mowers: { other: { eastMetres: 1, northMetres: 2 } } }, 'mower', {
    eastMetres: 99,
    northMetres: -99
  });
  assert.deepEqual(getMowerTrim(settings, 'mower'), { eastMetres: 20, northMetres: -20 });
  assert.deepEqual(getMowerTrim(settings, 'other'), { eastMetres: 1, northMetres: 2 });
  assert.deepEqual(getMowerTrim(settings, 'missing'), { eastMetres: 0, northMetres: 0 });
});

test('loads safe defaults for malformed storage and saves normalized values', () => {
  const bad = storage({ [MAP_OVERLAY_SETTINGS_KEY]: '{bad' });
  assert.deepEqual(loadMapOverlaySettings(bad), { version: 1, mowers: {} });

  const target = storage();
  const saved = saveMapOverlaySettings(target, {
    version: 1,
    mowers: { mower: { eastMetres: 1.25, northMetres: Number.NaN } }
  });
  assert.deepEqual(saved.mowers.mower, { eastMetres: 1.25, northMetres: 0 });
  assert.deepEqual(loadMapOverlaySettings(target), saved);
});
```

- [ ] **Step 2: Write failing projection tests**

Create `public/mapProjection.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { projectMowerMap, svgPointToLatLng } from './mapProjection.js';

const coordinateSystem = {
  unitsPerMetre: 1000,
  xAxis: 'east', yAxis: 'south', rotationDegrees: 0,
  stationOrigin: { x: -1000, y: 500 }
};
const anchor = { lat: 55.7, lon: 13.2 };

test('maps origin to anchor and applies east-positive, south-positive millimetres', () => {
  const origin = svgPointToLatLng({ x: -1000, y: 500 }, coordinateSystem, anchor, { eastMetres: 0, northMetres: 0 });
  const east = svgPointToLatLng({ x: 0, y: 500 }, coordinateSystem, anchor, { eastMetres: 0, northMetres: 0 });
  const south = svgPointToLatLng({ x: -1000, y: 1500 }, coordinateSystem, anchor, { eastMetres: 0, northMetres: 0 });
  assert.deepEqual(origin, [55.7, 13.2]);
  assert.ok(east[1] > origin[1]);
  assert.ok(Math.abs(east[0] - origin[0]) < 1e-12);
  assert.ok(south[0] < origin[0]);
});

test('applies positive trim north and east without mutating source geometry', () => {
  const payload = {
    status: 'ready', coordinateSystem, anchor,
    geometry: {
      workingAreas: [{ id: 'main_area_0', points: [{ x: -1000, y: 500 }, { x: 0, y: 500 }, { x: 0, y: 1500 }] }],
      islands: [], guides: [],
      chargingStationLine: { id: 'lona_cs', points: [{ x: -1000, y: 500 }, { x: 0, y: -1000 }] }
    }
  };
  const before = structuredClone(payload);
  const projected = projectMowerMap(payload, { eastMetres: 1, northMetres: 1 });
  assert.ok(projected.workingAreas[0].latLngs[0][0] > anchor.lat);
  assert.ok(projected.workingAreas[0].latLngs[0][1] > anchor.lon);
  assert.deepEqual(payload, before);
});

test('rejects unsupported coordinate contracts and non-finite points', () => {
  assert.throws(
    () => svgPointToLatLng({ x: Number.NaN, y: 0 }, coordinateSystem, anchor, { eastMetres: 0, northMetres: 0 }),
    /finite/
  );
  assert.throws(
    () => svgPointToLatLng({ x: 0, y: 0 }, { ...coordinateSystem, rotationDegrees: 1 }, anchor, { eastMetres: 0, northMetres: 0 }),
    /coordinate system/
  );
});
```

- [ ] **Step 3: Run both browser-module tests and verify failure**

Run: `node --test public/mapOverlaySettings.test.js public/mapProjection.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for both implementation modules.

- [ ] **Step 4: Implement versioned per-mower trim persistence**

Create `public/mapOverlaySettings.js`:

```js
export const MAP_OVERLAY_SETTINGS_KEY = 'automower.mapOverlaySettings.v1';
export const DEFAULT_MAP_OVERLAY_SETTINGS = Object.freeze({ version: 1, mowers: {} });

const clamp = (value) => Number.isFinite(value) ? Math.max(-20, Math.min(20, value)) : 0;
const trim = (value = {}) => ({ eastMetres: clamp(value.eastMetres), northMetres: clamp(value.northMetres) });
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function resolveStorage(value) {
  if (value !== undefined) return value;
  try { return globalThis.localStorage; } catch { return null; }
}

export function normalizeMapOverlaySettings(value) {
  if (!isObject(value) || value.version !== 1 || !isObject(value.mowers)) {
    return { version: 1, mowers: {} };
  }
  return {
    version: 1,
    mowers: Object.fromEntries(Object.entries(value.mowers)
      .filter(([mowerId, mowerTrim]) => mowerId.length > 0 && isObject(mowerTrim))
      .map(([mowerId, mowerTrim]) => [mowerId, trim(mowerTrim)]))
  };
}

export function getMowerTrim(settings, mowerId) {
  return trim(normalizeMapOverlaySettings(settings).mowers[mowerId]);
}

export function setMowerTrim(settings, mowerId, value) {
  const normalized = normalizeMapOverlaySettings(settings);
  return { version: 1, mowers: { ...normalized.mowers, [mowerId]: trim(value) } };
}

export function loadMapOverlaySettings(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem(MAP_OVERLAY_SETTINGS_KEY);
    return raw ? normalizeMapOverlaySettings(JSON.parse(raw)) : { version: 1, mowers: {} };
  } catch {
    return { version: 1, mowers: {} };
  }
}

export function saveMapOverlaySettings(storage, settings) {
  const target = resolveStorage(storage);
  if (!target || typeof target.setItem !== 'function') {
    throw new Error('Map overlay settings storage is unavailable');
  }
  const normalized = normalizeMapOverlaySettings(settings);
  target.setItem(MAP_OVERLAY_SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}
```

- [ ] **Step 5: Implement pure local projection**

Create `public/mapProjection.js`:

```js
const EARTH_RADIUS_METRES = 6378137;
const radiansToDegrees = 180 / Math.PI;

function finite(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

export function svgPointToLatLng(point, coordinateSystem, anchor, trim) {
  if (
    coordinateSystem?.unitsPerMetre !== 1000 ||
    coordinateSystem?.xAxis !== 'east' ||
    coordinateSystem?.yAxis !== 'south' ||
    coordinateSystem?.rotationDegrees !== 0
  ) throw new TypeError('Unsupported mower map coordinate system');

  const x = finite(point?.x, 'SVG x');
  const y = finite(point?.y, 'SVG y');
  const originX = finite(coordinateSystem.stationOrigin?.x, 'station origin x');
  const originY = finite(coordinateSystem.stationOrigin?.y, 'station origin y');
  const anchorLat = finite(anchor?.lat, 'anchor latitude');
  const anchorLon = finite(anchor?.lon, 'anchor longitude');
  const eastTrim = finite(trim?.eastMetres ?? 0, 'east trim');
  const northTrim = finite(trim?.northMetres ?? 0, 'north trim');
  if (Math.abs(anchorLat) >= 90 || Math.abs(anchorLon) > 180) throw new RangeError('Invalid anchor coordinate');

  const eastMetres = (x - originX) / 1000 + eastTrim;
  const northMetres = (originY - y) / 1000 + northTrim;
  const latitude = anchorLat + northMetres / EARTH_RADIUS_METRES * radiansToDegrees;
  const longitude = anchorLon + eastMetres /
    (EARTH_RADIUS_METRES * Math.cos(anchorLat / radiansToDegrees)) * radiansToDegrees;
  return [latitude, longitude];
}

function projectElements(elements, coordinateSystem, anchor, trim) {
  if (!Array.isArray(elements)) throw new TypeError('Map geometry must be an array');
  return elements.map((element) => ({
    id: element.id,
    ...(element.title ? { title: element.title } : {}),
    latLngs: element.points.map((point) => svgPointToLatLng(point, coordinateSystem, anchor, trim))
  }));
}

export function projectMowerMap(payload, trim) {
  if (payload?.status !== 'ready' || !payload.anchor || !payload.geometry) {
    throw new TypeError('Ready mower map payload is required');
  }
  return {
    workingAreas: projectElements(payload.geometry.workingAreas, payload.coordinateSystem, payload.anchor, trim),
    islands: projectElements(payload.geometry.islands, payload.coordinateSystem, payload.anchor, trim),
    guides: projectElements(payload.geometry.guides, payload.coordinateSystem, payload.anchor, trim),
    chargingStationLine: projectElements([payload.geometry.chargingStationLine], payload.coordinateSystem, payload.anchor, trim)[0]
  };
}
```

- [ ] **Step 6: Run browser-module tests**

Run: `node --test public/mapOverlaySettings.test.js public/mapProjection.test.js`

Expected: all tests PASS.

- [ ] **Step 7: Commit projection and settings modules**

```bash
git add public/mapOverlaySettings.js public/mapOverlaySettings.test.js public/mapProjection.js public/mapProjection.test.js
git commit -m "Project mower map geometry in the browser"
```

---

### Task 6: Fetch and render the outline-only Leaflet layer

**Files:**
- Modify: `public/map.js`
- Create: `public/mapOverlayUi.test.js`

**Interfaces:**
- Consumes: `projectMowerMap(payload, trim)` and `getMowerTrim(settings, mowerId)`.
- Produces: a dedicated `mowerMapPane`, `mapOverlayLayer`, `loadMapOverlay()`, `renderMapOverlay()`, and `redrawMapOverlayPreview()`.
- Preserves: position-driven `fitBounds`, existing transient layers, and request-race protection.

- [ ] **Step 1: Add failing source-integration tests**

Create `public/mapOverlayUi.test.js` with the initial source checks:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./map.js', import.meta.url), 'utf8');

test('fetches the selected mower map and refreshes it beside position data', () => {
  assert.match(source, /\/api\/mowers\/\$\{encodeURIComponent\(selectedMowerId\)\}\/map/);
  assert.match(source, /Promise\.all\(\[loadData\(context\), loadMapOverlay\(\)\]\)/);
  assert.match(source, /latestMapRequestId/);
});

test('uses an outline-only non-interactive Leaflet pane below markers', () => {
  assert.match(source, /createPane\('mowerMapPane'\)/);
  assert.match(source, /fill:\s*false/);
  assert.match(source, /interactive:\s*false/);
  assert.match(source, /pane:\s*'mowerMapPane'/);
});
```

- [ ] **Step 2: Run the source test and verify failure**

Run: `node --test public/mapOverlayUi.test.js`

Expected: FAIL because map overlay fetching and rendering are absent.

- [ ] **Step 3: Add map-overlay imports and state**

At the top of `public/map.js`, add:

```js
import {
  getMowerTrim,
  loadMapOverlaySettings
} from './mapOverlaySettings.js';
import { projectMowerMap } from './mapProjection.js';
```

After map creation, add a dedicated pane whose z-index is above normal overlays (`400`) and below markers (`600`):

```js
map.createPane('mowerMapPane');
map.getPane('mowerMapPane').style.zIndex = '425';
```

Add state next to existing layer/request state:

```js
let mapOverlayLayer = null;
let latestMapPayload = null;
let latestMapRequestId = 0;
let mapOverlayMessage = '';
let mapOverlaySettings = loadMapOverlaySettings();
```

- [ ] **Step 4: Implement atomic outline-layer construction**

Add these functions to `public/map.js`:

```js
const mapLineStyles = {
  workingArea: { color: '#315f3c', weight: 2 },
  island: { color: '#a8493f', weight: 2 },
  guide: { color: '#2f6fbd', weight: 3 },
  station: { color: '#ad7a1f', weight: 3 }
};

function clearMapOverlay() {
  if (mapOverlayLayer) map.removeLayer(mapOverlayLayer);
  mapOverlayLayer = null;
  latestMapPayload = null;
}

function renderMapOverlay(payload, settings = mapOverlaySettings) {
  const projected = projectMowerMap(payload, getMowerTrim(settings, selectedMowerId));
  const replacement = L.layerGroup();
  const options = (style) => ({ ...style, fill: false, interactive: false, pane: 'mowerMapPane' });

  projected.workingAreas.forEach((area) => L.polygon(area.latLngs, options(mapLineStyles.workingArea)).addTo(replacement));
  projected.islands.forEach((island) => L.polygon(island.latLngs, options(mapLineStyles.island)).addTo(replacement));
  projected.guides.forEach((guide) => L.polyline(guide.latLngs, options(mapLineStyles.guide)).addTo(replacement));
  L.polyline(projected.chargingStationLine.latLngs, options(mapLineStyles.station)).addTo(replacement);

  if (mapOverlayLayer) map.removeLayer(mapOverlayLayer);
  replacement.addTo(map);
  mapOverlayLayer = replacement;
  latestMapPayload = payload;
}

function redrawMapOverlayPreview(settings = mapOverlaySettings) {
  if (!latestMapPayload || latestMapPayload.status !== 'ready') return;
  renderMapOverlay(latestMapPayload, settings);
}
```

Do not add `mapOverlayLayer` to the existing `clearLayers()` function; position refreshes and overlay refreshes are independent.

- [ ] **Step 5: Implement independent map loading and race protection**

Add:

```js
function overlayMessageFor(code) {
  if (code === 'MAP_NOT_AVAILABLE') return 'No generated boundary map is available for this mower.';
  if (code === 'MAP_INVALID') return 'The generated boundary map could not be read.';
  if (code === 'UNKNOWN_MOWER') return 'Boundary map is unavailable for this mower.';
  return 'Boundary map is temporarily unavailable.';
}

async function loadMapOverlay() {
  const requestId = ++latestMapRequestId;
  const mowerId = selectedMowerId;
  if (!mowerId) {
    clearMapOverlay();
    mapOverlayMessage = 'Select a mower to load its boundary map.';
    return;
  }

  try {
    const response = await fetch(`/api/mowers/${encodeURIComponent(mowerId)}/map`);
    const payload = await response.json();
    if (requestId !== latestMapRequestId || mowerId !== selectedMowerId) return;
    if (!response.ok) {
      clearMapOverlay();
      mapOverlayMessage = overlayMessageFor(payload?.error?.code);
      return;
    }
    if (payload.status === 'anchor-unavailable') {
      clearMapOverlay();
      mapOverlayMessage = 'Boundary map is waiting for a completed return-home position.';
      return;
    }
    renderMapOverlay(payload);
    mapOverlayMessage = payload.stale ? 'Showing the last available boundary map.' : '';
  } catch (error) {
    console.error(error);
    if (requestId !== latestMapRequestId || mowerId !== selectedMowerId) return;
    clearMapOverlay();
    mapOverlayMessage = 'Boundary map is temporarily unavailable.';
  }
}
```

Change `refreshAll()` to:

```js
async function refreshAll() {
  const context = await fetchStatus();
  await Promise.all([loadData(context), loadMapOverlay()]);
}
```

When `mowerPicker` changes, increment `latestMapRequestId`, clear the old overlay immediately, then run `Promise.all([loadData(context), loadMapOverlay()])` instead of only `loadData(context)`.

- [ ] **Step 6: Run source and existing refresh tests**

Run: `node --test public/mapOverlayUi.test.js public/mapRefresh.test.js`

Expected: all tests PASS.

- [ ] **Step 7: Commit Leaflet overlay rendering**

```bash
git add public/map.js public/mapOverlayUi.test.js
git commit -m "Render mower map boundary overlays"
```

---

### Task 7: Extend Settings with live per-mower east/north trim

**Files:**
- Modify: `public/map.html`
- Modify: `public/map.css`
- Modify: `public/map.js`
- Modify: `public/mapOverlayUi.test.js`

**Interfaces:**
- Consumes: settings helpers from Task 5 and redraw function from Task 6.
- Produces: two `-20.0..20.0`, `0.1 m` range controls, signed outputs, status text, and existing Save/Cancel/Reset semantics across both settings records.

- [ ] **Step 1: Extend the failing UI tests**

Append to `public/mapOverlayUi.test.js`:

```js
const html = readFileSync(new URL('./map.html', import.meta.url), 'utf8');

test('provides accessible east and north trim controls and overlay status', () => {
  for (const id of ['overlayEastInput', 'overlayNorthInput']) {
    assert.match(html, new RegExp(`id="${id}"[^>]+type="range"[^>]+min="-20"[^>]+max="20"[^>]+step="0.1"`));
  }
  assert.match(html, /id="overlayEastValue"/);
  assert.match(html, /id="overlayNorthValue"/);
  assert.match(html, /id="mapOverlayStatus"/);
});

test('saves, cancels, resets, and previews map overlay settings', () => {
  assert.match(source, /saveMapOverlaySettings/);
  assert.match(source, /draftMapOverlaySettings/);
  assert.match(source, /redrawMapOverlayPreview/);
  assert.match(source, /setMowerTrim/);
});
```

- [ ] **Step 2: Run the UI test and verify failure**

Run: `node --test public/mapOverlayUi.test.js`

Expected: FAIL because the controls and settings integration do not exist.

- [ ] **Step 3: Add the Boundary overlay section to Settings**

Insert this section in `public/map.html` after the contribution-strength section and before `.panel-actions`:

```html
<div class="panel-section boundary-settings" aria-labelledby="boundarySettingsTitle">
  <p id="boundarySettingsTitle" class="field-label">Boundary overlay</p>
  <p id="mapOverlayStatus" class="overlay-status" aria-live="polite"></p>

  <label class="range-label" for="overlayEastInput">
    <span>West</span>
    <output id="overlayEastValue" for="overlayEastInput">0.0 m</output>
    <span>East</span>
  </label>
  <input id="overlayEastInput" class="semantic-range" type="range" min="-20" max="20" step="0.1" value="0" />

  <label class="range-label boundary-settings__north-label" for="overlayNorthInput">
    <span>South</span>
    <output id="overlayNorthValue" for="overlayNorthInput">0.0 m</output>
    <span>North</span>
  </label>
  <input id="overlayNorthInput" class="semantic-range" type="range" min="-20" max="20" step="0.1" value="0" />
</div>
```

Change the settings button accessible name from `Configure heatmap` to `Configure map`, and change the setup kicker from `Heatmap setup` to `Map setup`.

- [ ] **Step 4: Add concise CSS for values and status**

Append near the existing settings rules in `public/map.css`:

```css
.boundary-settings output {
  color: var(--text);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

.boundary-settings__north-label {
  margin-top: 18px;
}

.overlay-status {
  min-height: 1.4em;
  margin: 0 0 12px;
  color: var(--muted);
  font-size: 0.82rem;
  line-height: 1.4;
}
```

- [ ] **Step 5: Integrate draft settings and controls in `public/map.js`**

Extend the Task 6 settings import:

```js
import {
  DEFAULT_MAP_OVERLAY_SETTINGS,
  getMowerTrim,
  loadMapOverlaySettings,
  saveMapOverlaySettings,
  setMowerTrim
} from './mapOverlaySettings.js';
```

Add DOM references and draft state:

```js
const mapOverlayStatus = document.getElementById('mapOverlayStatus');
const overlayEastInput = document.getElementById('overlayEastInput');
const overlayNorthInput = document.getElementById('overlayNorthInput');
const overlayEastValue = document.getElementById('overlayEastValue');
const overlayNorthValue = document.getElementById('overlayNorthValue');
let draftMapOverlaySettings = null;
```

Add helpers:

```js
function signedMetres(value) {
  const normalized = Math.abs(value) < 0.05 ? 0 : value;
  return `${normalized > 0 ? '+' : ''}${normalized.toFixed(1)} m`;
}

function renderOverlayControls(settings) {
  const trim = getMowerTrim(settings, selectedMowerId);
  overlayEastInput.value = String(trim.eastMetres);
  overlayNorthInput.value = String(trim.northMetres);
  overlayEastValue.value = signedMetres(trim.eastMetres);
  overlayNorthValue.value = signedMetres(trim.northMetres);
  mapOverlayStatus.textContent = mapOverlayMessage;
}

function readOverlayDraftFromControls(settings) {
  return setMowerTrim(settings, selectedMowerId, {
    eastMetres: Number(overlayEastInput.value),
    northMetres: Number(overlayNorthInput.value)
  });
}
```

Update the existing lifecycle functions exactly as follows:

```js
function enterConfigureMode() {
  draftHeatmapSettings = structuredClone(heatmapSettings);
  draftMapOverlaySettings = structuredClone(mapOverlaySettings);
  setSettingsError('');
  renderSettingsControls(draftHeatmapSettings);
  renderOverlayControls(draftMapOverlaySettings);
  setPanelMode('config');
  heatColorLow.focus();
}

function previewDraftSettings() {
  draftHeatmapSettings = readDraftFromControls();
  draftMapOverlaySettings = readOverlayDraftFromControls(draftMapOverlaySettings);
  renderSettingsControls(draftHeatmapSettings);
  renderOverlayControls(draftMapOverlaySettings);
  redrawHeatmapPreview(draftHeatmapSettings);
  redrawMapOverlayPreview(draftMapOverlaySettings);
}

function cancelConfigureMode() {
  draftHeatmapSettings = null;
  draftMapOverlaySettings = null;
  setSettingsError('');
  redrawHeatmapPreview(heatmapSettings);
  redrawMapOverlayPreview(mapOverlaySettings);
  setPanelMode('status');
  settingsButton.focus();
}

function resetDraftSettings() {
  draftHeatmapSettings = structuredClone(DEFAULT_HEATMAP_SETTINGS);
  draftMapOverlaySettings = setMowerTrim(
    draftMapOverlaySettings ?? DEFAULT_MAP_OVERLAY_SETTINGS,
    selectedMowerId,
    { eastMetres: 0, northMetres: 0 }
  );
  renderSettingsControls(draftHeatmapSettings);
  renderOverlayControls(draftMapOverlaySettings);
  redrawHeatmapPreview(draftHeatmapSettings);
  redrawMapOverlayPreview(draftMapOverlaySettings);
}

function saveConfigureMode() {
  try {
    heatmapSettings = saveHeatmapSettings(undefined, readDraftFromControls());
    mapOverlaySettings = saveMapOverlaySettings(
      undefined,
      readOverlayDraftFromControls(draftMapOverlaySettings)
    );
    draftHeatmapSettings = null;
    draftMapOverlaySettings = null;
    setSettingsError('');
    redrawHeatmapPreview(heatmapSettings);
    redrawMapOverlayPreview(mapOverlaySettings);
    setPanelMode('status');
    settingsButton.focus();
  } catch (error) {
    console.error(error);
    setSettingsError('Could not save settings in this browser.');
  }
}
```

Add `overlayEastInput` and `overlayNorthInput` to the existing input-listener array. Whenever `loadMapOverlay` changes `mapOverlayMessage`, update `mapOverlayStatus.textContent` if the Settings panel is open.

On mower selection change while setup mode is open, discard the old mower's overlay draft by cloning `mapOverlaySettings`, render the new selected mower's controls, and load its map. Do not carry unsaved trim from the previous mower.

- [ ] **Step 6: Run all frontend module/source tests**

Run: `node --test public/heatmapSettings.test.js public/mapOverlaySettings.test.js public/mapProjection.test.js public/mapOverlayUi.test.js public/mapRefresh.test.js public/mapCss.test.js`

Expected: all tests PASS.

- [ ] **Step 7: Commit Settings integration**

```bash
git add public/map.html public/map.css public/map.js public/mapOverlayUi.test.js
git commit -m "Add mower map overlay trim controls"
```

---

### Task 8: Document, run regressions, and verify the browser flow

**Files:**
- Modify: `README.md`
- Verify: all changed files from Tasks 1-7

**Interfaces:**
- Produces: operator documentation and final verification evidence.
- Consumes: all prior tasks.

- [ ] **Step 1: Document the overlay and its assumptions**

Add a `## Generated mower map overlay` section after the map URL in `README.md`:

```markdown
## Generated mower map overlay

For each selected mower, the server downloads Husqvarna's generated SVG map
from `/v1/mowers/{mower-id}/maps/generated` and exposes only normalized geometry
to the browser. The overlay uses the final recorded position from the latest
completed `GOING_HOME` session as its charging-station anchor.

The current conversion assumes 1,000 SVG units per metre, SVG X pointing east,
SVG Y pointing south, and zero rotation. Working areas, islands, guides, and the
charging-station reference are drawn as outlines. The Settings panel stores
per-mower east/west and north/south trim in browser local storage.

If no generated map or completed return-home position is available, the normal
heatmap and mower trail continue to work without the boundary overlay. The
overlay is informational and is not a mower navigation or safety boundary.
```

- [ ] **Step 2: Run focused non-database tests**

Run:

```bash
node --test \
  src/mowerMapSvg.test.js \
  src/mowerMapClient.test.js \
  src/mowerMapRoute.test.js \
  public/heatmapSettings.test.js \
  public/mapOverlaySettings.test.js \
  public/mapProjection.test.js \
  public/mapOverlayUi.test.js \
  public/mapRefresh.test.js \
  public/mapCss.test.js
```

Expected: all focused tests PASS with zero failures.

- [ ] **Step 3: Run the complete repository test suite**

Run: `npm test`

Environment: `TEST_DATABASE_URL` must be exported as described in `README.md`.

Expected: the complete Node test suite PASSes with zero failures, including the new DB anchor tests.

- [ ] **Step 4: Start the app and verify live map behavior**

Run: `npm start`

Expected startup output includes successful PostgreSQL readiness, initial mower state, WebSocket connection, and `HTTP server listening at http://localhost:3000/map.html`.

Open `http://localhost:3000/map.html` and verify:

1. A mower with a generated SVG and completed `GOING_HOME` session shows green working-area, red island, blue guide, and amber station outlines.
2. No region is filled and no black shape closes the guide line.
3. The overlay follows the existing map during pan and zoom and remains below mower/message markers.
4. North/south orientation matches the base map; SVG positive Y appears south.
5. The reference SVG spans roughly 51 by 47 metres relative to GPS telemetry.
6. East trim moves the overlay east, north trim moves it north, and both preview immediately.
7. Cancel restores saved values, Reset previews zero values, and Save survives reload.
8. Switching mower loads that mower's saved trim and never carries an unsaved trim from the previous mower.
9. A mower without a map or anchor shows a concise Settings explanation while heatmap, trail, markers, and status remain usable.
10. Simulated upstream failure after a successful map load serves the cached geometry with the stale message.

Capture a screenshot of the outline overlay and Settings trim controls for the pull-request description because `public/` changes alter UX.

- [ ] **Step 5: Check diff quality and security boundaries**

Run:

```bash
git diff --check
git status --short
rg -n "Authorization|X-Api-Key|access.token|<svg|DOCTYPE|ENTITY" public src/mowerMap*.js
```

Expected:

- `git diff --check` prints nothing.
- `git status --short` lists only intended feature/documentation files.
- Public files contain no Husqvarna authorization header or raw SVG handling.
- Server files contain only header construction, parser rejection checks, and normalized geometry handling; no credentials or SVG bodies are logged.

- [ ] **Step 6: Commit documentation and final verification adjustments**

```bash
git add README.md
git commit -m "Document mower map overlay"
```

If verification required code or test corrections, include those exact files in this final commit only when the correction is inseparable from the documentation handoff; otherwise amend the task commit that introduced the defect before requesting review.

---

## Completion Gate

Before claiming implementation complete:

- Every task commit exists with its tests passing.
- The full `npm test` suite passes against the isolated PostgreSQL test schema.
- Manual verification confirms outline-only rendering, correct axis inversion, trim semantics, mower isolation, and graceful unavailable states.
- No raw SVG or credentials are present in browser responses or browser source.
- `git diff --check` is clean and the worktree contains no unrelated changes.
- The implementation still matches every acceptance criterion in `docs/superpowers/specs/2026-07-13-mower-svg-map-overlay-design.md`.
