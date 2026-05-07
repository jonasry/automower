import { summarizeLatestSession } from './sessionSummary.js';

function buildPositionsPayload({ heatData = [], trailData = heatData, selectedSessionId = null } = {}) {
  const heat = heatData.map(([lat, lon, weight]) => [lat, lon, weight]);

  const recent = [];
  if (trailData.length > 0) {
    const targetSessionId = selectedSessionId ?? trailData[trailData.length - 1][3];

    for (let i = trailData.length - 1; i >= 0; i--) {
      const entry = trailData[i];
      if (entry[3] !== targetSessionId) break;
      if (entry[4] === true) {
        recent.push([entry[0], entry[1]]);
      }
    }
  }

  return {
    heat,
    recent,
    session: summarizeLatestSession(trailData)
  };
}

export { buildPositionsPayload };
