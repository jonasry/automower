import test from 'node:test';
import assert from 'node:assert/strict';

import { projectMowerMap, svgPointToLatLng } from './mapProjection.js';

const coordinateSystem = {
  unitsPerMetre: 1000,
  xAxis: 'east',
  yAxis: 'north',
  rotationDegrees: 0,
  stationOrigin: { x: -1000, y: 500 }
};
const anchor = { lat: 55.7, lon: 13.2 };

test('maps origin to anchor and applies east-positive, north-positive millimetres', () => {
  const trim = { eastMetres: 0, northMetres: 0 };
  const origin = svgPointToLatLng(
    { x: -1000, y: 500 },
    coordinateSystem,
    anchor,
    trim
  );
  const east = svgPointToLatLng(
    { x: 0, y: 500 },
    coordinateSystem,
    anchor,
    trim
  );
  const north = svgPointToLatLng(
    { x: -1000, y: 1500 },
    coordinateSystem,
    anchor,
    trim
  );

  assert.deepEqual(origin, [55.7, 13.2]);
  assert.ok(east[1] > origin[1]);
  assert.ok(Math.abs(east[0] - origin[0]) < 1e-12);
  assert.ok(north[0] > origin[0]);
});

test('applies positive trim north and east without mutating source geometry', () => {
  const payload = {
    status: 'ready',
    coordinateSystem,
    anchor,
    geometry: {
      workingAreas: [{
        id: 'main_area_0',
        points: [
          { x: -1000, y: 500 },
          { x: 0, y: 500 },
          { x: 0, y: 1500 }
        ]
      }],
      islands: [],
      guides: [],
      chargingStationLine: {
        id: 'lona_cs',
        points: [{ x: -1000, y: 500 }, { x: 0, y: -1000 }]
      }
    }
  };
  const before = structuredClone(payload);

  const projected = projectMowerMap(payload, {
    eastMetres: 1,
    northMetres: 1
  });

  assert.ok(projected.workingAreas[0].latLngs[0][0] > anchor.lat);
  assert.ok(projected.workingAreas[0].latLngs[0][1] > anchor.lon);
  assert.deepEqual(payload, before);
});

test('rejects unsupported coordinate contracts and non-finite points', () => {
  assert.throws(
    () => svgPointToLatLng(
      { x: Number.NaN, y: 0 },
      coordinateSystem,
      anchor,
      { eastMetres: 0, northMetres: 0 }
    ),
    /finite/
  );
  assert.throws(
    () => svgPointToLatLng(
      { x: 0, y: 0 },
      { ...coordinateSystem, rotationDegrees: 1 },
      anchor,
      { eastMetres: 0, northMetres: 0 }
    ),
    /coordinate system/
  );
});
