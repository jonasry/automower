const EARTH_RADIUS_METRES = 6378137;
const DEGREES_TO_RADIANS = Math.PI / 180;

export function trimFromGeographicDrag(
  initialTrim,
  startLatLng,
  currentLatLng
) {
  const eastMetres = initialTrim?.eastMetres;
  const northMetres = initialTrim?.northMetres;
  const startLat = startLatLng?.lat;
  const startLng = startLatLng?.lng;
  const currentLat = currentLatLng?.lat;
  const currentLng = currentLatLng?.lng;
  const values = [
    eastMetres,
    northMetres,
    startLat,
    startLng,
    currentLat,
    currentLng
  ];

  if (!values.every(Number.isFinite) || Math.abs(startLat) >= 90) return null;

  const referenceLatitude = startLat * DEGREES_TO_RADIANS;
  return {
    eastMetres: eastMetres +
      (currentLng - startLng) * DEGREES_TO_RADIANS *
      EARTH_RADIUS_METRES * Math.cos(referenceLatitude),
    northMetres: northMetres +
      (currentLat - startLat) * DEGREES_TO_RADIANS * EARTH_RADIUS_METRES
  };
}
