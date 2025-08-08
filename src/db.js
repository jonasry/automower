import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(__dirname, '../db');
await fs.mkdir(dbDir, { recursive: true });
const dbPath = path.join(dbDir, 'mower-data.sqlite');

const db = new Database(dbPath);

// Improve durability and read concurrency
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

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

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_positions_mower_timestamp
  ON positions (mower_id, timestamp);
`);

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_unique
  ON positions (mower_id, timestamp, lat, lon);
`);

const insertStmt = db.prepare(
  'INSERT OR IGNORE INTO positions (mower_id, session_id, activity, lat, lon, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
);

const selectStmt = db.prepare(`
  SELECT mower_id, session_id, lat, lon, timestamp, activity
  FROM positions
  ORDER BY mower_id, timestamp
  `
);

function storePosition(mowerId, session_id, state, lat, lon, timestamp) {
  insertStmt.run(mowerId, session_id, state, lat, lon, timestamp);
}

function getPositions() {
  return selectStmt.all();
}

export { storePosition, getPositions };
export function closeDb() {
  try { db.close(); } catch {}
}
