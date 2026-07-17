import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'map.css');
const css = readFileSync(cssPath, 'utf8');

function declarationsFor(selector) {
  const pattern = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{(?<body>[^}]+)\\}`);
  const match = css.match(pattern);
  assert.ok(match?.groups?.body, `Expected ${selector} rule to exist`);

  return Object.fromEntries(match.groups.body
    .split(';')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(':').map((part) => part.trim())));
}

test('activity badge keeps longer mower states on one line', () => {
  const statusBadge = declarationsFor('.status-badge');

  assert.equal(statusBadge.flex, '0 0 auto');
  assert.equal(statusBadge.width, 'max-content');
  assert.equal(statusBadge['white-space'], 'nowrap');
});

test('shows direct manipulation cursors during overlay trim', () => {
  assert.equal(
    declarationsFor('#map.is-overlay-trim-mode').cursor,
    'grab'
  );
  assert.equal(
    declarationsFor('#map.is-overlay-trim-mode.is-overlay-trim-dragging').cursor,
    'grabbing'
  );
});
