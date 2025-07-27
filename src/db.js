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
    activity TEXT,
    lat REAL,
    lon REAL,
    timestamp TEXT
  )
`);

export default db;
