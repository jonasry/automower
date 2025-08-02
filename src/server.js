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

  const recent = [];
  if (data && data.length > 0) {
    const lastSessionId = data[data.length - 1][3];

    for (let i = data.length - 1; i >= 0; i--) {
      const entry = data[i];
      if (entry[3] !== lastSessionId) break;
      if (entry[4] === true) {
        recent.push([entry[0], entry[1]]);
      }
    }
  }

  res.json({ heat, recent });
});

export function startHttpServer(port = 3000) {
  app.listen(port, () => {
    console.log(`🌍 HTTP server listening at http://localhost:${port}/map.html`);
  });
}
