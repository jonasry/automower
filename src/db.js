import { closePool, getPool, toSafeInteger } from './dbPool.js';

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

async function readNotImplemented() {
  throw new Error('PostgreSQL read helpers are not implemented');
}

const getPositions = readNotImplemented;
const getSessionSummaries = readNotImplemented;
const getLatestMessage = readNotImplemented;
const getLatestMessages = readNotImplemented;
const getLatestBatteryReading = readNotImplemented;
const getStoredMowerIds = readNotImplemented;

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
