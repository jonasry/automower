const EARTH_RADIUS_METRES = 6378137;
const RADIANS_TO_DEGREES = 180 / Math.PI;

function finite(value, name) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be finite`);
  }
  return value;
}

export function svgPointToLatLng(point, coordinateSystem, anchor, trim) {
  if (
    coordinateSystem?.unitsPerMetre !== 1000 ||
    coordinateSystem?.xAxis !== 'east' ||
    coordinateSystem?.yAxis !== 'south' ||
    coordinateSystem?.rotationDegrees !== 0
  ) {
    throw new TypeError('Unsupported mower map coordinate system');
  }

  const x = finite(point?.x, 'SVG x');
  const y = finite(point?.y, 'SVG y');
  const originX = finite(coordinateSystem.stationOrigin?.x, 'station origin x');
  const originY = finite(coordinateSystem.stationOrigin?.y, 'station origin y');
  const anchorLat = finite(anchor?.lat, 'anchor latitude');
  const anchorLon = finite(anchor?.lon, 'anchor longitude');
  const eastTrim = finite(trim?.eastMetres ?? 0, 'east trim');
  const northTrim = finite(trim?.northMetres ?? 0, 'north trim');
  if (Math.abs(anchorLat) >= 90 || Math.abs(anchorLon) > 180) {
    throw new RangeError('Invalid anchor coordinate');
  }

  const eastMetres = (x - originX) / 1000 + eastTrim;
  const northMetres = (originY - y) / 1000 + northTrim;
  const latitude = anchorLat +
    northMetres / EARTH_RADIUS_METRES * RADIANS_TO_DEGREES;
  const longitude = anchorLon +
    eastMetres /
      (EARTH_RADIUS_METRES * Math.cos(anchorLat / RADIANS_TO_DEGREES)) *
      RADIANS_TO_DEGREES;
  return [latitude, longitude];
}

function projectElements(elements, coordinateSystem, anchor, trim) {
  if (!Array.isArray(elements)) {
    throw new TypeError('Map geometry must be an array');
  }
  return elements.map((element) => ({
    id: element.id,
    ...(element.title ? { title: element.title } : {}),
    latLngs: element.points.map((point) => (
      svgPointToLatLng(point, coordinateSystem, anchor, trim)
    ))
  }));
}

export function projectMowerMap(payload, trim) {
  if (payload?.status !== 'ready' || !payload.anchor || !payload.geometry) {
    throw new TypeError('Ready mower map payload is required');
  }
  return {
    workingAreas: projectElements(
      payload.geometry.workingAreas,
      payload.coordinateSystem,
      payload.anchor,
      trim
    ),
    islands: projectElements(
      payload.geometry.islands,
      payload.coordinateSystem,
      payload.anchor,
      trim
    ),
    guides: projectElements(
      payload.geometry.guides,
      payload.coordinateSystem,
      payload.anchor,
      trim
    ),
    chargingStationLine: projectElements(
      [payload.geometry.chargingStationLine],
      payload.coordinateSystem,
      payload.anchor,
      trim
    )[0]
  };
}
