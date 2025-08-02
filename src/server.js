import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getInterpolatedPositions } from './interpolate.js';
import { getRecentPositions } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/positions', (req, res) => {
  const data = getInterpolatedPositions();
  const heat = data.map(([lat, lon, weight]) => [lat, lon, weight]);
  res.json(heat);
});

app.get('/api/recent-positions', (req, res) => {
  const data = getInterpolatedPositions();
  if (!data || data.length === 0) {
    console.log("no positions")
    return res.json([]);
  }

  const lastSessionId = data[data.length - 1][3];
  const recentPositions = [];

  for (let i = data.length - 1; i >= 0; i--) {
    const entry = data[i];
    console.log(entry)
    if (entry[3] !== lastSessionId) break;
    if (entry[4] === true) {
      recentPositions.unshift([entry[0], entry[1]]);
    }
  }

  res.json(recentPositions);
});

export function startHttpServer(port = 3000) {
  app.listen(port, () => {
    console.log(`🌍 HTTP server listening at http://localhost:${port}/public/map.html`);
  });
}
