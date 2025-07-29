import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getInterpolatedPositions } from './interpolate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/positions', (req, res) => {
  const data = getInterpolatedPositions();
  const heat = data.map(([lat, lon, weight]) => [lat, lon, weight]);
  res.json(heat);
});

export function startHttpServer(port = 3000) {
  app.listen(port, () => {
    console.log(`🌍 HTTP server listening at http://localhost:${port}/public/map.html`);
  });
}
