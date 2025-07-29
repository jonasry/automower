import { getPositions } from './db.js';

function interpolatePointsTimed(lat1, lon1, lat2, lon2, totalDistance, weight = 1, step = 1) {
  const points = [];
  const steps = Math.floor(totalDistance / step);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push([
      lat1 + t * (lat2 - lat1),
      lon1 + t * (lon2 - lon1),
      weight
    ]);
  }
  return points;
}

function daysBetween(dateA, dateB) {
  const start = new Date(dateA.getFullYear(), dateA.getMonth(), dateA.getDate());
  const end = new Date(dateB.getFullYear(), dateB.getMonth(), dateB.getDate());
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((end - start) / msPerDay);
}

function haversineDistance(a, b) {
    const R = 6371000; // Earth radius in meters
    const toRad = deg => deg * Math.PI / 180;

    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const c = Math.sin(dLat/2) *
              Math.sin(dLat/2) +
              Math.cos(toRad(a.lat)) *
              Math.cos(toRad(b.lat)) *
              Math.sin(dLon/2) *
              Math.sin(dLon/2);
    const d = 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1-c));
    return R * d;
}

function interpolateSession(points, output) {
  const first = points[0];
  const ageInDays = daysBetween(new Date(first.timestamp), new Date());
  const a = 1 + Math.max(0, Math.min(7, ageInDays));
  const weight = Math.pow(2, -a);

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];

    const dist = haversineDistance(a, b);

    if (!isFinite(dist)) continue;

    if (dist < 1) {
        output.push([a.lat, a.lon, weight]);
        output.push([b.lat, b.lon, weight]);

    } else {
        const segment = interpolatePointsTimed(
            a.lat, a.lon,
            b.lat, b.lon,
            dist,
            weight,
            0.5 // step size
        );

        output.push(...segment);
    }
  }
}

function getInterpolatedPositions() {
  const rows = getPositions();

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

export { getInterpolatedPositions };
