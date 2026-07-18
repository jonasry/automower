import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./map.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('./map.css', import.meta.url), 'utf8');
const source = readFileSync(new URL('./map.js', import.meta.url), 'utf8');

test('provides a checked-by-default Display Mower Track checkbox', () => {
  assert.match(
    html,
    /<label class="track-toggle" for="displayMowerTrack">[\s\S]+<input id="displayMowerTrack" type="checkbox" checked \/>[\s\S]+<span>Display Mower Track<\/span>[\s\S]+<\/label>/
  );
  assert.match(css, /\.track-toggle\s*\{/);
  assert.match(css, /\.track-toggle input\s*\{/);
});
