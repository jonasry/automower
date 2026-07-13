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
  assert.equal(JSON.stringify(parsed).includes('fill'), false);
});

test('drops unsupported executable and external content from normalized geometry', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg">
    <polygon id="main_area_0" points="0,0 1000,0 1000,1000" />
    <polyline id="lona_cs" points="0,0 1000,0" />
    <script>alert('not serialized')</script>
    <image href="https://example.invalid/tracker.png" />
  </svg>`;
  const serialized = JSON.stringify(parseMowerMapSvg(svg));

  assert.equal(serialized.includes('alert'), false);
  assert.equal(serialized.includes('example.invalid'), false);
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

test('enforces configurable production guards', () => {
  const svg = '<svg><polygon id="main_area_0" points="0,0 1,0 1,1"/><polyline id="lona_cs" points="0,0 1,1"/></svg>';
  assert.throws(
    () => parseMowerMapSvg(svg, {
      limits: {
        maxBytes: 16,
        maxElements: 256,
        maxPointsPerElement: 10000,
        maxTotalPoints: 50000
      }
    }),
    /size limit/
  );
  assert.throws(
    () => parseMowerMapSvg(svg, {
      limits: {
        maxBytes: 2097152,
        maxElements: 1,
        maxPointsPerElement: 10000,
        maxTotalPoints: 50000
      }
    }),
    /element limit/
  );
});
