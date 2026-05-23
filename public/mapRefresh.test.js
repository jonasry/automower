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
