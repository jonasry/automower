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
        return res.status(404).json({
          error: { code: 'UNKNOWN_MOWER', message: 'Unknown mower' }
        });
      }

      const state = getMowerState(mowerId);
      const excludeSessionId = state?.activity === 'GOING_HOME'
        ? state.sessionId ?? null
        : null;
      const [map, anchor] = await Promise.all([
        getGeometry(mowerId),
        state?.suppressMapAnchor
          ? Promise.resolve(null)
          : getAnchor(mowerId, { excludeSessionId })
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
        return res.status(status).json({
          error: { code: error.code, message }
        });
      }
      return next(error);
    }
  };
}
