import { getPositions } from './db.js';

function interpolatePointsTimed(lat1, lon1, lat2, lon2, totalSeconds, weight = 1, stepSeconds = 5) {
  const points = [];
  const steps = Math.floor(totalSeconds / stepSeconds);
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

function interpolateSession(points, output) {
  const first = points[0];
  const ageInDays = daysBetween(new Date(first.timestamp), new Date());
  const a = 1 + Math.max(0, Math.min(7, ageInDays));
  const weight = Math.pow(2, -a);

  if (weight <= 0) return;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];

    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    const deltaSec = (timeB - timeA) / 1000;

    if (!isFinite(deltaSec)) continue;

    if (deltaSec < 5) {
        output.push([a.lat, a.lon, weight]);
        output.push([b.lat, b.lon, weight]);

    } else {
        const segment = interpolatePointsTimed(
            a.lat, a.lon,
            b.lat, b.lon,
            deltaSec,
            weight,
            5 // step size
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
