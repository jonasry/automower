import { closePool, getPool, toSafeInteger } from './dbPool.js';
import { SESSION_SUMMARY_SQL } from './sessionSummaryQuery.js';

function parsePayload(payload) {
  if (typeof payload !== 'string') return payload;
  return JSON.parse(payload);
}

async function storeEvent({
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
  const result = await getPool().query(`
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
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (
      (COALESCE(mower_id, '')),
      event_type,
      (COALESCE(event_timestamp, '-infinity'::TIMESTAMPTZ)),
      payload
    ) DO UPDATE SET received_at = EXCLUDED.received_at
    RETURNING id
  `, [
    mowerId,
    eventType,
    eventTimestamp,
    receivedAt,
    lat,
    lon,
    messageCode,
    messageSeverity,
    parsePayload(payload)
  ]);

  return toSafeInteger(result.rows[0].id, 'events.id');
}

async function storePosition({ mowerId, sessionId, state, lat, lon, timestamp, eventId }) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO positions (
        mower_id,
        session_id,
        activity,
        lat,
        lon,
        timestamp,
        event_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (
        (COALESCE(mower_id, '')),
        (COALESCE(timestamp, '-infinity'::TIMESTAMPTZ)),
        (COALESCE(lat, 'NaN'::DOUBLE PRECISION)),
        (COALESCE(lon, 'NaN'::DOUBLE PRECISION))
      ) DO NOTHING
    `, [mowerId, sessionId, state, lat, lon, timestamp, eventId ?? null]);

    if (eventId != null) {
      await client.query(`
        UPDATE positions
        SET event_id = $1
        WHERE mower_id IS NOT DISTINCT FROM $2
          AND timestamp IS NOT DISTINCT FROM $3
          AND lat IS NOT DISTINCT FROM $4
          AND lon IS NOT DISTINCT FROM $5
          AND (event_id IS NULL OR event_id = $1)
      `, [eventId, mowerId, timestamp, lat, lon]);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function iso(value) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function normalizedLimit(value, fallback, minimum = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(minimum, Math.floor(numeric)) : fallback;
}

async function getPositions({ mowerId, sessionId } = {}) {
  const clauses = [];
  const params = [];

  if (mowerId) {
    params.push(mowerId);
    clauses.push(`mower_id = $${params.length}`);
  }
  if (sessionId != null && sessionId !== '') {
    params.push(sessionId);
    clauses.push(`session_id = $${params.length}`);
  }

  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const order = mowerId && sessionId == null ? 'timestamp' : 'mower_id, timestamp';
  const result = await getPool().query(`
    SELECT mower_id, session_id, lat, lon, timestamp, activity
    FROM positions${where}
    ORDER BY ${order}
  `, params);

  return result.rows.map((row) => ({
    ...row,
    session_id: row.session_id == null ? null : toSafeInteger(row.session_id, 'positions.session_id'),
    timestamp: iso(row.timestamp)
  }));
}

function toDurationMinutes(start, end) {
  const startMs = Date.parse(start ?? '');
  const endMs = Date.parse(end ?? '');
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  if (endMs < startMs) return 0;
  return Math.round((endMs - startMs) / 60000);
}

async function getSessionSummaries({ mowerId, limit = 5, messageLimit = 3 } = {}) {
  if (!mowerId) return [];
  const lim = normalizedLimit(limit, 5);
  const msgLim = normalizedLimit(messageLimit, 3, 0);
  const result = await getPool().query(SESSION_SUMMARY_SQL, [mowerId, lim]);

  return Promise.all(result.rows.map(async (row) => {
    const start = iso(row.start);
    const end = iso(row.end);
    let messageRows = [];
    if (msgLim > 0) {
      const messages = await getPool().query(`
        SELECT event_timestamp, message_code, message_severity
        FROM events
        WHERE mower_id = $1
          AND event_type = 'message-event-v2'
          AND event_timestamp IS NOT NULL
          AND event_timestamp >= $2
          AND event_timestamp <= $3
        ORDER BY event_timestamp DESC
        LIMIT $4
      `, [mowerId, start, end, msgLim]);
      messageRows = messages.rows.filter((message) => message.message_code != null);
    }

    return {
      mowerId: row.mower_id,
      sessionId: toSafeInteger(row.session_id, 'positions.session_id'),
      start,
      end,
      durationMinutes: toDurationMinutes(start, end),
      points: toSafeInteger(row.points, 'session.points'),
      messages: messageRows.map((message) => ({
        timestamp: iso(message.event_timestamp),
        code: message.message_code,
        severity: message.message_severity
      }))
    };
  }));
}

async function getLatestMessage(mowerId) {
  if (!mowerId) return null;
  const result = await getPool().query(`
    SELECT event_timestamp, message_code, message_severity
    FROM events
    WHERE mower_id = $1
      AND event_type = 'message-event-v2'
      AND event_timestamp IS NOT NULL
    ORDER BY event_timestamp DESC
    LIMIT 1
  `, [mowerId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    timestamp: iso(row.event_timestamp),
    code: row.message_code,
    severity: row.message_severity
  };
}

async function getLatestMessages(mowerId, limit = 5) {
  if (!mowerId) return [];
  const lim = normalizedLimit(limit, 5);
  const result = await getPool().query(`
    SELECT event_timestamp, message_code, message_severity, lat, lon
    FROM events
    WHERE mower_id = $1
      AND event_type = 'message-event-v2'
      AND event_timestamp IS NOT NULL
    ORDER BY event_timestamp DESC
    LIMIT $2
  `, [mowerId, lim]);
  return result.rows.map((row) => ({
    timestamp: iso(row.event_timestamp),
    code: row.message_code,
    severity: row.message_severity,
    lat: row.lat,
    lon: row.lon
  }));
}

async function getLatestBatteryReading(mowerId) {
  if (!mowerId) return null;
  const result = await getPool().query(`
    SELECT event_timestamp, payload
    FROM events
    WHERE mower_id = $1
      AND event_type = 'battery-event-v2'
      AND event_timestamp IS NOT NULL
    ORDER BY event_timestamp DESC
    LIMIT 1
  `, [mowerId]);
  const row = result.rows[0];
  if (!row) return null;

  const raw = row.payload?.attributes?.battery?.batteryPercent;
  const numeric = Number(raw);
  return {
    timestamp: iso(row.event_timestamp),
    batteryPercent: raw != null && Number.isFinite(numeric) ? Math.round(numeric) : null
  };
}

async function getStoredMowerIds() {
  const result = await getPool().query(`
    SELECT mower_id
    FROM (
      SELECT DISTINCT mower_id FROM events WHERE mower_id IS NOT NULL AND mower_id != ''
      UNION
      SELECT DISTINCT mower_id FROM positions WHERE mower_id IS NOT NULL AND mower_id != ''
    ) stored_mowers
    ORDER BY mower_id
  `);
  return result.rows.map((row) => row.mower_id);
}

async function closeDb() {
  await closePool();
}

export {
  closeDb,
  getLatestBatteryReading,
  getLatestMessage,
  getLatestMessages,
  getPositions,
  getSessionSummaries,
  getStoredMowerIds,
  storeEvent,
  storePosition
};
