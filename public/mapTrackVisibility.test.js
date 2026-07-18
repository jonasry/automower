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

test('caches session positions and renders the track only while checked', () => {
  assert.match(source, /let latestRecent = \[\];/);
  assert.match(
    source,
    /function renderRecentPath\(recent\) \{\s+latestRecent = recent;\s+clearRecentPath\(\);\s+if \(!displayMowerTrack\.checked\) return;/
  );
  assert.match(
    source,
    /displayMowerTrack\.addEventListener\('change', \(\) => \{\s+renderRecentPath\(latestRecent\);\s+\}\);/
  );
});

test('removes only the mower track layer when visibility changes', () => {
  assert.match(
    source,
    /function clearRecentPath\(\) \{\s+if \(!recentLayer\) return;\s+map\.removeLayer\(recentLayer\);\s+recentLayer = null;\s+\}/
  );
  assert.match(
    source,
    /function clearLayers\(\) \{[\s\S]+clearRecentPath\(\);[\s\S]+if \(messageLayer\)/
  );
});

test('keeps message markers and session statistics independent of track visibility', () => {
  assert.match(
    source,
    /if \(!displayMowerTrack\.checked\) return;[\s\S]+function renderMessageMarkers[\s\S]+renderRecentPath\(recent\);\s+renderMessageMarkers\([\s\S]+renderSessionStats\(\{ heat, recent, session, summary: context\?\.summary, mower: context\?\.mower \}\);/
  );
});
