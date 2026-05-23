import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getInterpolatedPositions } from './interpolate.js';
import { buildPositionsPayload } from './positionsPayload.js';
import { mowerStates, updateMowerState } from './state.js';
import { getLatestBatteryReading, getLatestMessage, getLatestMessages, getSessionSummaries, getStoredMowerIds } from './db.js';
import { messageDescriptions } from './amcmessages.js';
import { clientEventBus } from './clientEvents.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
let statusCache = { data: null, expires: 0 };

app.disable('x-powered-by');

clientEventBus.onPublish(() => {
  statusCache = { data: null, expires: 0 };
});

app.get('/api/events', (req, res) => {
  clientEventBus.subscribe(res);
});

app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/positions', (req, res) => {
  const { mowerId, sessionId } = req.query;
  const heatFilters = {};
  const trailFilters = {};
  let selectedSessionId = null;

  if (typeof mowerId === 'string' && mowerId.trim().length > 0) {
    const selectedMowerId = mowerId.trim();
    heatFilters.mowerId = selectedMowerId;
    trailFilters.mowerId = selectedMowerId;
  }
  if (typeof sessionId === 'string' && sessionId.trim().length > 0) {
    const parsed = Number(sessionId);
    if (Number.isFinite(parsed)) {
      trailFilters.sessionId = parsed;
      selectedSessionId = parsed;
    }
  }

  const heatData = getInterpolatedPositions(heatFilters);
  const trailData = selectedSessionId == null
    ? heatData
    : getInterpolatedPositions(trailFilters);

  res.set('Cache-Control', 'public, max-age=15');
  res.json(buildPositionsPayload({ heatData, trailData, selectedSessionId }));
});

app.get('/api/status', (req, res) => {
  const now = Date.now();
  if (statusCache.data && statusCache.expires > now) {
    res.set('Cache-Control', 'public, max-age=10');
    return res.json(statusCache.data);
  }

  const payload = buildStatusPayload();
  statusCache = { data: payload, expires: now + 10000 };
  res.set('Cache-Control', 'public, max-age=10');
  res.json(payload);
});

function buildStatusPayload() {
  const mowers = [];
  const sessions = {};

  const safeParseTime = (value) => {
    if (!value) return NaN;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  };

  const pickLatestIso = (...values) => {
    let latestIso = null;
    let latestTs = Number.NEGATIVE_INFINITY;
    for (const value of values) {
      const ts = safeParseTime(value);
      if (!Number.isNaN(ts) && ts > latestTs) {
        latestIso = value;
        latestTs = ts;
      }
    }
    return latestIso;
  };

  const mowerIds = new Set([
    ...mowerStates.keys(),
    ...getStoredMowerIds()
  ]);

  for (const mowerId of mowerIds) {
    const state = mowerStates.get(mowerId) ?? {};
    const latestMessageFromDb = state.lastMessage ? null : getLatestMessage(mowerId);
    const lastMessage = state.lastMessage ?? latestMessageFromDb;
    const lastMessageDescription = lastMessage?.description ?? (
      lastMessage?.code != null ? messageDescriptions.get(lastMessage.code) ?? null : null
    );
    const latestMessages = getLatestMessages(mowerId, 5).map((message) => ({
      code: message.code ?? null,
      severity: message.severity ?? null,
      timestamp: message.timestamp ?? null,
      description: message.code != null ? messageDescriptions.get(message.code) ?? null : null,
      lat: message.lat ?? null,
      lon: message.lon ?? null
    }));

    const batteryFromDb = getLatestBatteryReading(mowerId);
    const stateBatteryTs = state.lastBatteryAt ?? null;
    const dbBatteryTs = batteryFromDb?.timestamp ?? null;
    const stateBatteryMs = safeParseTime(stateBatteryTs);
    const dbBatteryMs = safeParseTime(dbBatteryTs);

    let batteryPercent = state.batteryPercent ?? null;
    let batteryTimestamp = stateBatteryTs;
    let batterySource = 'state';

    if (!Number.isNaN(dbBatteryMs) && (Number.isNaN(stateBatteryMs) || dbBatteryMs > stateBatteryMs)) {
      batteryPercent = batteryFromDb?.batteryPercent ?? batteryPercent;
      batteryTimestamp = dbBatteryTs ?? batteryTimestamp;
      batterySource = 'db';
    }

    if (batterySource === 'db' && (batteryPercent != null || batteryTimestamp != null)) {
      updateMowerState(mowerId, {
        batteryPercent,
        lastBatteryAt: batteryTimestamp
      });
    }

    const lastUpdate = pickLatestIso(
      state.lastEventAt,
      state.lastActivityAt,
      batteryTimestamp,
      state.lastPosition?.timestamp,
      lastMessage?.timestamp
    );

    const mowerSummary = {
      id: mowerId,
      name: state.mowerName ?? 'Unknown',
      activity: state.activity ?? 'UNKNOWN',
      batteryPercent,
      charging: state.isCharging ?? (state.activity === 'CHARGING'),
      lastUpdate,
      sessionId: state.sessionId ?? null,
      lastMessage: lastMessage
        ? {
            code: lastMessage.code ?? null,
            severity: lastMessage.severity ?? null,
            description: lastMessageDescription,
            timestamp: lastMessage.timestamp ?? null
          }
        : null,
      messages: latestMessages,
      lastPosition: state.lastPosition ?? null
    };
    mowers.push(mowerSummary);

    sessions[mowerId] = getSessionSummaries({ mowerId, limit: 5, messageLimit: 3 }).map((session) => ({
      id: session.sessionId,
      start: session.start,
      end: session.end,
      durationMinutes: session.durationMinutes,
      points: session.points,
      messages: session.messages.map((msg) => ({
        code: msg.code,
        severity: msg.severity,
        timestamp: msg.timestamp,
        description: msg.code != null ? messageDescriptions.get(msg.code) ?? null : null
      }))
    }));
  }

  return { mowers, sessions };
}

export function startHttpServer(port = process.env.PORT || 3000) {
  app.listen(port, () => {
    console.log(`🌍 HTTP server listening at http://localhost:${port}/map.html`);
  });
}

export { app, buildStatusPayload };
