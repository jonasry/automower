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
  const rows = getRecentPositions("MOWING", 50);
  const coords = rows.map(r => [r.lat, r.lon]);
  res.json(coords);
});

export function startHttpServer(port = 3000) {
  app.listen(port, () => {
    console.log(`🌍 HTTP server listening at http://localhost:${port}/public/map.html`);
  });
}
