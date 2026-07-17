import test from 'node:test';
import assert from 'node:assert/strict';
import { trimFromGeographicDrag } from './mapOverlayDrag.js';

const closeTo = (actual, expected, tolerance = 0.0001) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`
  );
};

test('decomposes a diagonal drag into east and north trim', () => {
  const trim = trimFromGeographicDrag(
    { eastMetres: 2, northMetres: -1 },
    { lat: 60, lng: 15 },
    { lat: 60.00001, lng: 15.00002 }
  );

  closeTo(trim.eastMetres, 3.1131949);
  closeTo(trim.northMetres, 0.1131949);
});

test('keeps horizontal and vertical drag directions direct', () => {
  const west = trimFromGeographicDrag(
    { eastMetres: 0, northMetres: 0 },
    { lat: 60, lng: 15 },
    { lat: 60, lng: 14.99999 }
  );
  const south = trimFromGeographicDrag(
    { eastMetres: 0, northMetres: 0 },
    { lat: 60, lng: 15 },
    { lat: 59.99999, lng: 15 }
  );

  assert.ok(west.eastMetres < 0);
  closeTo(west.northMetres, 0);
  closeTo(south.eastMetres, 0);
  assert.ok(south.northMetres < 0);
});

test('calculates every move from the gesture initial trim', () => {
  const initialTrim = { eastMetres: 5, northMetres: 7 };
  const start = { lat: 60, lng: 15 };

  const halfway = trimFromGeographicDrag(
    initialTrim,
    start,
    { lat: 60.000005, lng: 15.000005 }
  );
  const finished = trimFromGeographicDrag(
    initialTrim,
    start,
    { lat: 60.00001, lng: 15.00001 }
  );

  closeTo(finished.eastMetres - initialTrim.eastMetres, 2 * (
    halfway.eastMetres - initialTrim.eastMetres
  ));
  closeTo(finished.northMetres - initialTrim.northMetres, 2 * (
    halfway.northMetres - initialTrim.northMetres
  ));
});

test('returns null for non-finite input or a polar reference latitude', () => {
  assert.equal(trimFromGeographicDrag(
    { eastMetres: Number.NaN, northMetres: 0 },
    { lat: 60, lng: 15 },
    { lat: 60, lng: 15 }
  ), null);
  assert.equal(trimFromGeographicDrag(
    { eastMetres: 0, northMetres: 0 },
    { lat: 90, lng: 15 },
    { lat: 90, lng: 15.1 }
  ), null);
});
