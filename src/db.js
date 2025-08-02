import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(__dirname, '../db');
await fs.mkdir(dbDir, { recursive: true });
const dbPath = path.join(dbDir, 'mower-data.sqlite');

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mower_id TEXT,
    session_id INTEGER,
    activity TEXT,
    lat REAL,
    lon REAL,
    timestamp TEXT
  )
`);

const insertStmt = db.prepare(
  'INSERT INTO positions (mower_id, session_id, activity, lat, lon, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
);

const selectStmt = db.prepare(`
  SELECT mower_id, session_id, lat, lon, timestamp, activity
  FROM positions
  ORDER BY mower_id, timestamp
  `
);

const recentStmt = db.prepare(
  `SELECT mower_id, lat, lon, timestamp, activity
   FROM positions
   WHERE activity = ?
   ORDER BY timestamp DESC
   LIMIT ?`
);

function storePosition(mowerId, session_id, state, lat, lon, timestamp) {
  insertStmt.run(mowerId, session_id, state, lat, lon, timestamp);
}

function getPositions() {
  return selectStmt.all();
}

function getRecentPositions(session_id, activity = "MOWING") {
  return recentStmt.all(session_id, activity);
}

export { storePosition, getPositions, getRecentPositions };
