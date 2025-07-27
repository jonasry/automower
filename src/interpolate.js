import db from './db.js';

function interpolatePointsTimed(lat1, lon1, lat2, lon2, totalSeconds, stepSeconds = 5) {
  const points = [];
  const steps = Math.floor(totalSeconds / stepSeconds);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push([
      lat1 + t * (lat2 - lat1),
      lon1 + t * (lon2 - lon1)
    ]);
  }
  return points;
}

function getInterpolatedPositions() {
  const rows = db.prepare(`
    SELECT mower_id, lat, lon, timestamp, activity
    FROM positions
    ORDER BY mower_id, timestamp
  `).all();

  const interpolated = [];
  const grouped = new Map();

  // Group rows by mower ID
  rows.forEach(row => {
    if (!grouped.has(row.mower_id)) grouped.set(row.mower_id, []);
    grouped.get(row.mower_id).push(row);
  });

  for (const [mowerId, points] of grouped.entries()) {
    let session = [];

    for (let i = 0; i < points.length; i++) {
      const curr = points[i];

      if (curr.activity === 'MOWING') {
        session.push(curr);
      } else if (session.length > 1) {
        // Process session when interrupted
        interpolateSession(session, interpolated);
        session = [];
      } else {
        session = [];
      }
    }

    if (session.length > 1) {
      interpolateSession(session, interpolated);
    }
  }

  return interpolated;
}

function interpolateSession(points, output) {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];

    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    const deltaSec = (timeB - timeA) / 1000;

    if (!isFinite(deltaSec)) continue;

    if (deltaSec < 5) {
        output.push([a.lat, a.lon]);
        output.push([b.lat, b.lon]);

    } else {
        const segment = interpolatePointsTimed(
            a.lat, a.lon,
            b.lat, b.lon,
            deltaSec,
            5 // step size
        );

        output.push(...segment);
    }
  }
}

export { getInterpolatedPositions };
