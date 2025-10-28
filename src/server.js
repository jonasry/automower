import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getInterpolatedPositions } from './interpolate.js';
import { mowerStates, updateMowerState } from './state.js';
import { getSessionSummaries, getLatestMessage, getLatestBatteryReading } from './db.js';
import { messageDescriptions } from './amcmessages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
let statusCache = { data: null, expires: 0 };

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/positions', (req, res) => {
  const { mowerId, sessionId } = req.query;
  const heatFilter = {};

  let sessionFilterId = null;
  if (typeof mowerId === 'string' && mowerId.trim().length > 0) {
    heatFilter.mowerId = mowerId.trim();
  }

  if (typeof sessionId === 'string' && sessionId.trim().length > 0) {
    const parsed = Number(sessionId);
    if (Number.isFinite(parsed)) {
      sessionFilterId = parsed;
    }
  }

  const heatData = getInterpolatedPositions(heatFilter);

  const heat = heatData.map(([lat, lon, weight]) => [lat, lon, weight]);

  let targetSessionId = sessionFilterId;
  if (targetSessionId == null && heatData.length > 0) {
    targetSessionId = heatData[heatData.length - 1][3];
  }

  const recent = [];
  if (targetSessionId != null) {
    for (let i = 0; i < heatData.length; i += 1) {
      const entry = heatData[i];
      if (entry[3] === targetSessionId && entry[4] === true) {
        recent.push([entry[0], entry[1]]);
      }
    }
  }

  res.set('Cache-Control', 'public, max-age=15');
  res.json({ heat, recent });
});

app.get('/api/status', (req, res) => {
  const now = Date.now();
  if (statusCache.data && statusCache.expires > now) {
    res.set('Cache-Control', 'public, max-age=10');
    return res.json(statusCache.data);
  }

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

  for (const [mowerId, state] of mowerStates.entries()) {
    const latestMessageFromDb = state.lastMessage ? null : getLatestMessage(mowerId);
    const lastMessage = state.lastMessage ?? latestMessageFromDb;
    const lastMessageDescription = lastMessage?.description ?? (
      lastMessage?.code != null ? messageDescriptions.get(lastMessage.code) ?? null : null
    );

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
      state.lastPosition?.timestamp
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
      lastPosition: state.lastPosition ?? null
    };
    mowers.push(mowerSummary);

    const summaries = getSessionSummaries({ mowerId, limit: 5, messageLimit: 3 }).map((session) => ({
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

    sessions[mowerId] = summaries;
  }

  const payload = { mowers, sessions };
  statusCache = { data: payload, expires: now + 10000 };
  res.set('Cache-Control', 'public, max-age=10');
  res.json(payload);
});

export function startHttpServer(port = process.env.PORT || 3000) {
  app.listen(port, () => {
    console.log(`🌍 HTTP server listening at http://localhost:${port}/map.html`);
  });
}
