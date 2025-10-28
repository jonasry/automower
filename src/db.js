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
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mower_id TEXT,
    session_id INTEGER,
    activity TEXT,
    lat REAL,
    lon REAL,
    timestamp TEXT,
    event_id INTEGER,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
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

const positionColumns = db.prepare('PRAGMA table_info(positions)').all();
const hasEventIdColumn = positionColumns.some((column) => column.name === 'event_id');

if (!hasEventIdColumn) {
  db.exec('ALTER TABLE positions ADD COLUMN event_id INTEGER');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mower_id TEXT,
    event_type TEXT NOT NULL,
    event_timestamp TEXT,
    received_at TEXT NOT NULL,
    lat REAL,
    lon REAL,
    message_code INTEGER,
    message_severity TEXT,
    payload TEXT NOT NULL
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_events_mower_timestamp
  ON events (mower_id, event_timestamp);
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_events_type_timestamp
  ON events (event_type, event_timestamp);
`);

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_events_unique
  ON events (mower_id, event_type, event_timestamp, payload);
`);

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_event_unique
  ON positions (event_id)
  WHERE event_id IS NOT NULL;
`);

if (!hasEventIdColumn) {
  const backfillPositionsStmt = db.prepare(`
    UPDATE positions
    SET event_id = (
      SELECT id
      FROM events
      WHERE events.mower_id = positions.mower_id
        AND events.event_type = 'position-event-v2'
        AND COALESCE(events.event_timestamp, '') = COALESCE(positions.timestamp, '')
        AND COALESCE(events.lat, 0) = COALESCE(positions.lat, 0)
        AND COALESCE(events.lon, 0) = COALESCE(positions.lon, 0)
      ORDER BY id DESC
      LIMIT 1
    )
    WHERE event_id IS NULL
  `);
  backfillPositionsStmt.run();
}

const insertPositionStmt = db.prepare(
  'INSERT OR IGNORE INTO positions (mower_id, session_id, activity, lat, lon, timestamp, event_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
);

const updatePositionEventIdStmt = db.prepare(`
  UPDATE positions
  SET event_id = ?
  WHERE mower_id = ?
    AND timestamp = ?
    AND lat = ?
    AND lon = ?
    AND (event_id IS NULL OR event_id = ?)
`);

const insertEventStmt = db.prepare(`
  INSERT INTO events (
    mower_id,
    event_type,
    event_timestamp,
    received_at,
    lat,
    lon,
    message_code,
    message_severity,
    payload
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const selectEventIdStmt = db.prepare(`
  SELECT id
  FROM events
  WHERE mower_id = ?
    AND event_type = ?
    AND COALESCE(event_timestamp, '') = COALESCE(?, '')
    AND payload = ?
  ORDER BY id DESC
  LIMIT 1
`);

const updateEventReceivedAtStmt = db.prepare(`
  UPDATE events
  SET received_at = ?
  WHERE id = ?
`);

const sessionSummaryStmt = db.prepare(`
  SELECT
    mower_id,
    session_id,
    MIN(timestamp) AS start,
    MAX(timestamp) AS end,
    COUNT(*) AS points
  FROM positions
  WHERE mower_id = ?
    AND session_id IS NOT NULL
  GROUP BY mower_id, session_id
  ORDER BY MAX(timestamp) DESC
  LIMIT ?
`);

const sessionMessagesStmt = db.prepare(`
  SELECT
    event_timestamp,
    message_code,
    message_severity
  FROM events
  WHERE mower_id = ?
    AND event_type = 'message-event-v2'
    AND event_timestamp IS NOT NULL
    AND event_timestamp >= ?
    AND event_timestamp <= ?
  ORDER BY event_timestamp DESC
  LIMIT ?
`);

const latestMessageStmt = db.prepare(`
  SELECT
    event_timestamp,
    message_code,
    message_severity
  FROM events
  WHERE mower_id = ?
    AND event_type = 'message-event-v2'
    AND event_timestamp IS NOT NULL
  ORDER BY event_timestamp DESC
  LIMIT 1
`);

const latestBatteryStmt = db.prepare(`
  SELECT
    event_timestamp,
    payload
  FROM events
  WHERE mower_id = ?
    AND event_type = 'battery-event-v2'
    AND event_timestamp IS NOT NULL
  ORDER BY event_timestamp DESC
  LIMIT 1
`);

function storeEvent({
  mowerId,
  eventType,
  eventTimestamp,
  receivedAt,
  lat,
  lon,
  messageCode,
  messageSeverity,
  payload
}) {
  try {
    const result = insertEventStmt.run(
      mowerId,
      eventType,
      eventTimestamp,
      receivedAt,
      lat,
      lon,
      messageCode,
      messageSeverity,
      payload
    );
    return Number(result.lastInsertRowid);
  } catch (err) {
    if (err.code !== 'SQLITE_CONSTRAINT_UNIQUE') {
      throw err;
    }
    const existing = selectEventIdStmt.get(
      mowerId,
      eventType,
      eventTimestamp,
      payload
    );
    if (!existing) {
      throw err;
    }
    updateEventReceivedAtStmt.run(receivedAt, existing.id);
    return existing.id;
  }
}

function storePosition({ mowerId, sessionId, state, lat, lon, timestamp, eventId }) {
  const result = insertPositionStmt.run(
    mowerId,
    sessionId,
    state,
    lat,
    lon,
    timestamp,
    eventId ?? null
  );
  if (result.changes === 0 && eventId != null) {
    updatePositionEventIdStmt.run(
      eventId,
      mowerId,
      timestamp,
      lat,
      lon,
      eventId
    );
  }
}

function getPositions({ mowerId, sessionId } = {}) {
  let query = `
    SELECT mower_id, session_id, lat, lon, timestamp, activity
    FROM positions
  `;
  const clauses = [];
  const params = [];

  if (mowerId) {
    clauses.push('mower_id = ?');
    params.push(mowerId);
  }
  if (sessionId != null && sessionId !== '') {
    clauses.push('session_id = ?');
    params.push(sessionId);
  }

  if (clauses.length > 0) {
    query += ` WHERE ${clauses.join(' AND ')}`;
  }

  if (clauses.length === 0) {
    query += ' ORDER BY mower_id, timestamp';
  } else if (clauses.length === 1 && clauses[0].startsWith('mower_id')) {
    query += ' ORDER BY timestamp';
  } else {
    query += ' ORDER BY mower_id, timestamp';
  }

  const stmt = db.prepare(query);
  return stmt.all(...params);
}

function toDurationMinutes(start, end) {
  const startMs = Date.parse(start ?? '');
  const endMs = Date.parse(end ?? '');
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  if (endMs < startMs) return 0;
  return Math.round((endMs - startMs) / 60000);
}

function getSessionSummaries({ mowerId, limit = 5, messageLimit = 3 } = {}) {
  if (!mowerId) return [];
  const limitValue = Number(limit);
  const lim = Number.isFinite(limitValue) ? Math.max(1, Math.floor(limitValue)) : 5;
  const msgLimitValue = Number(messageLimit);
  const msgLim = Number.isFinite(msgLimitValue) ? Math.max(0, Math.floor(msgLimitValue)) : 3;
  const rows = sessionSummaryStmt.all(mowerId, lim);

  return rows.map((row) => {
    const messages = msgLim > 0
      ? sessionMessagesStmt.all(mowerId, row.start, row.end, msgLim).filter((msg) => msg.message_code != null)
      : [];

    return {
      mowerId: row.mower_id,
      sessionId: row.session_id,
      start: row.start,
      end: row.end,
      durationMinutes: toDurationMinutes(row.start, row.end),
      points: row.points,
      messages: messages.map((msg) => ({
        timestamp: msg.event_timestamp,
        code: msg.message_code,
        severity: msg.message_severity
      }))
    };
  });
}

function getLatestMessage(mowerId) {
  if (!mowerId) return null;
  const row = latestMessageStmt.get(mowerId);
  if (!row) return null;
  return {
    timestamp: row.event_timestamp,
    code: row.message_code,
    severity: row.message_severity
  };
}

function getLatestBatteryReading(mowerId) {
  if (!mowerId) return null;
  const row = latestBatteryStmt.get(mowerId);
  if (!row) return null;

  let batteryPercent = null;
  if (row.payload) {
    try {
      const parsed = JSON.parse(row.payload);
      const raw = parsed?.attributes?.battery?.batteryPercent;
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        batteryPercent = Math.round(raw);
      } else if (typeof raw === 'string') {
        const numeric = Number(raw);
        if (Number.isFinite(numeric)) {
          batteryPercent = Math.round(numeric);
        }
      }
    } catch (err) {
      // ignore malformed JSON
    }
  }

  return {
    timestamp: row.event_timestamp,
    batteryPercent
  };
}

export {
  storePosition,
  getPositions,
  storeEvent,
  getSessionSummaries,
  getLatestMessage,
  getLatestBatteryReading
};
export function closeDb() {
  try { db.close(); } catch {}
}
