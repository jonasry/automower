import express from 'express';
import path from 'path';
import db from './db.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/positions', (req, res) => {
  const rows = db.prepare(`
    SELECT lat, lon FROM positions
    WHERE activity = 'MOWING'
  `).all();

  const data = rows.map(row => [row.lat, row.lon, 1]);
  res.json(data);
});

export function startHttpServer(port = 3000) {
  app.listen(port, () => {
    console.log(`🌍 HTTP server listening at http://localhost:${port}`);
  });
}
