#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleIncomingEvent } from '../src/amconnect.js';
import { mowerStates } from '../src/state.js';
import { closeDb } from '../src/db.js';
import { toIsoTimestamp } from '../src/events.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_CSV = path.resolve(__dirname, '../data.csv');
const BATTERY_START_PERCENT = 100;
const BATTERY_END_PERCENT = 30;
const BATTERY_STEP = 5;
const DEFAULT_MAX_DELAY_MS = 60_000;

function parseArgs(argv) {
  const options = {
    csvPath: DEFAULT_CSV,
    realtime: false,
    speed: 1,
    maxDelayMs: DEFAULT_MAX_DELAY_MS,
    useRecordedTimestamps: false
  };

  const positional = [];

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--real-time' || arg === '--realtime') {
      options.realtime = true;
    } else if (arg === '--no-real-time' || arg === '--norealtime') {
      options.realtime = false;
    } else if (arg === '--use-recorded-timestamps') {
      options.useRecordedTimestamps = true;
    } else if (arg === '--ignore-recorded-timestamps') {
      options.useRecordedTimestamps = false;
    } else if (arg.startsWith('--speed=')) {
      const value = Number(arg.split('=')[1]);
      if (Number.isFinite(value) && value > 0) {
        options.speed = value;
        options.realtime = true;
      }
    } else if (arg === '--speed') {
      const next = argv[i + 1];
      i += 1;
      const value = Number(next);
      if (Number.isFinite(value) && value > 0) {
        options.speed = value;
        options.realtime = true;
      }
    } else if (arg.startsWith('--max-delay=')) {
      const raw = Number(arg.split('=')[1]);
      if (Number.isFinite(raw)) {
        options.maxDelayMs = raw < 0 ? Infinity : raw;
      }
    } else if (arg === '--max-delay') {
      const next = argv[i + 1];
      i += 1;
      const raw = Number(next);
      if (Number.isFinite(raw)) {
        options.maxDelayMs = raw < 0 ? Infinity : raw;
      }
    } else if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    } else {
      console.warn(`Unknown option "${arg}" will be ignored.`);
    }
  }

  if (positional[0]) {
    options.csvPath = path.resolve(process.cwd(), positional[0]);
  }

  return options;
}

function parseCsv(content) {
  return content
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [id, mowerId, sessionId, activity, lat, lon, timestamp] = line.split(',');
      return {
        id: Number(id),
        mowerId,
        sessionId,
        activity: activity?.trim() || null,
        lat: lat ? Number(lat) : null,
        lon: lon ? Number(lon) : null,
        timestamp: timestamp?.trim() || null
      };
    })
    .filter((row) => row.mowerId && row.timestamp);
}

function groupByMowerAndSession(rows) {
  const sessions = new Map();

  for (const row of rows) {
    const key = `${row.mowerId}::${row.sessionId || 'unknown'}`;
    if (!sessions.has(key)) {
      sessions.set(key, []);
    }
    sessions.get(key).push(row);
  }

  for (const [key, sessionRows] of sessions.entries()) {
    sessionRows.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    sessions.set(key, sessionRows);
  }

  return sessions;
}

function createMetadata(timestamp) {
  const iso = toIsoTimestamp(timestamp);
  return iso ? { timestamp: iso } : undefined;
}

function createMowerEvent(row) {
  return {
    id: row.mowerId,
    type: 'mower-event-v2',
    attributes: {
      mower: {
        activity: row.activity ?? 'UNKNOWN'
      },
      metadata: createMetadata(row.timestamp)
    }
  };
}

function createPositionEvent(row) {
  if (row.lat == null || row.lon == null) return null;

  return {
    id: row.mowerId,
    type: 'position-event-v2',
    attributes: {
      position: {
        latitude: row.lat,
        longitude: row.lon
      },
      metadata: createMetadata(row.timestamp)
    }
  };
}

function generateBatteryEvents(sessionRows) {
  const events = [];
  if (!sessionRows.length) return events;

  const startRow = sessionRows.find((row) => row.activity === 'LEAVING') ?? sessionRows[0];
  const endRow =
    sessionRows.find((row) => row.activity === 'GOING_HOME') ?? sessionRows[sessionRows.length - 1];

  if (!startRow?.timestamp || !endRow?.timestamp) {
    return events;
  }

  const startTime = Date.parse(startRow.timestamp);
  const endTime = Date.parse(endRow.timestamp);
  const duration = Math.max(endTime - startTime, 0);

  const levels = [];
  for (let percent = BATTERY_START_PERCENT; percent >= BATTERY_END_PERCENT; percent -= BATTERY_STEP) {
    levels.push(percent);
  }
  if (levels[levels.length - 1] !== BATTERY_END_PERCENT) {
    levels.push(BATTERY_END_PERCENT);
  }

  const steps = Math.max(levels.length - 1, 1);

  levels.forEach((percent, index) => {
    const ratio = steps ? index / steps : 0;
    const timestampMs = duration ? Math.round(startTime + duration * ratio) : startTime;
    const iso = new Date(timestampMs).toISOString();

    events.push({
      id: startRow.mowerId,
      type: 'battery-event-v2',
      attributes: {
        battery: {
          batteryPercent: percent
        },
        metadata: {
          timestamp: iso
        }
      }
    });
  });

  return events;
}

function deriveEventTime(event) {
  if (event.ready) return Number.NEGATIVE_INFINITY;

  const metadataTimestamp = event?.attributes?.metadata?.timestamp;
  const messageTimestamp = event?.attributes?.message?.time;

  const iso =
    toIsoTimestamp(metadataTimestamp) ??
    toIsoTimestamp(messageTimestamp) ??
    new Date().toISOString();

  return Date.parse(iso);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyLiveTimestamps(event) {
  const now = new Date();
  const nowIso = now.toISOString();
  if (event?.attributes?.metadata) {
    event.attributes.metadata.timestamp = nowIso;
  }
  if (event?.attributes?.message && Object.prototype.hasOwnProperty.call(event.attributes.message, 'time')) {
    event.attributes.message.time = Math.floor(now.getTime() / 1000);
  }
}

async function main() {
  const options = parseArgs(process.argv);
  const { csvPath, realtime, speed, maxDelayMs, useRecordedTimestamps } = options;

  const csvContent = await fs.readFile(csvPath, 'utf8');
  const rows = parseCsv(csvContent);

  if (!rows.length) {
    console.warn('No rows found in CSV. Nothing to replay.');
    return;
  }

  const sessions = groupByMowerAndSession(rows);

  const events = [
    {
      ready: true,
      connectionId: 'simulator'
    }
  ];

  for (const sessionRows of sessions.values()) {
    let lastActivity = null;

    for (const row of sessionRows) {
      const positionEvent = createPositionEvent(row);
      if (positionEvent) {
        events.push(positionEvent);
      }

      if (row.activity && row.activity !== lastActivity) {
        events.push(createMowerEvent(row));
        lastActivity = row.activity;
      }
    }

    events.push(...generateBatteryEvents(sessionRows));
  }

  events.sort((a, b) => deriveEventTime(a) - deriveEventTime(b));

  mowerStates.clear();

  const counts = new Map();
  let previousEventTime = null;

  if (realtime) {
    const delayInfo =
      maxDelayMs === Infinity
        ? `replay speed ${speed}x with unlimited gaps`
        : `replay speed ${speed}x (max gap ${maxDelayMs}ms)`;
    console.log(`⏱️  Real-time playback enabled: ${delayInfo}`);
  }

  for (const event of events) {
    if (realtime) {
      const eventTime = deriveEventTime(event);
      if (previousEventTime != null && Number.isFinite(eventTime)) {
        const gap = Math.max(0, eventTime - previousEventTime);
        let delayMs = gap / speed;
        if (Number.isFinite(maxDelayMs)) {
          delayMs = Math.min(delayMs, maxDelayMs);
        }
        if (delayMs > 1) {
          await wait(delayMs);
        }
      }
      if (Number.isFinite(eventTime)) {
        previousEventTime = eventTime;
      }
    } else {
      const eventTime = deriveEventTime(event);
      if (Number.isFinite(eventTime)) {
        previousEventTime = eventTime;
      }
    }

    if (!useRecordedTimestamps) {
      applyLiveTimestamps(event);
    }

    const payload = Buffer.from(JSON.stringify(event));
    handleIncomingEvent(payload);

    const type = event.type || (event.ready ? 'connection-event' : 'unknown');
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }

  const relativePath = path.relative(process.cwd(), csvPath);
  console.log(`Replayed ${events.length} events from ${relativePath || csvPath}`);
  for (const [type, count] of counts.entries()) {
    console.log(`  ${type}: ${count}`);
  }
}

main()
  .catch((err) => {
    console.error('Replay failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      closeDb();
    } catch {
      // ignore close errors
    }
  });
