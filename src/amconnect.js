import WebSocket from 'ws';
import { storePosition, storeEvent } from './db.js';
import { getMowerState, updateMowerState } from './state.js';
import { getToken } from './auth.js';
import { messageDescriptions, severitySymbols } from './amcmessages.js';
import { shapeEventForStorage, toIsoTimestamp } from './events.js';

let pingInterval = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let wss = null;

export function handleIncomingEvent(data) {
  if (!data.length) return;

  try {
    const text = data.toString();
    const message = JSON.parse(text);

    //console.log('message', message);

    if (message.ready) {
      console.log("🔒 Connected")
    }

    const shapedEvent = shapeEventForStorage(message);
    let eventId = null;
    let eventTimestampIso = null;
    if (shapedEvent) {
      eventTimestampIso = shapedEvent.eventTimestamp;
      try {
        eventId = storeEvent(shapedEvent);
      } catch (err) {
        console.error('Failed to persist event:', err);
      }
    }

    const { type, attributes, id: mowerId } = message;
    if (!type || !attributes || !mowerId) return;

    const mowerIdShort = mowerId.substring(0, 8);
    const currentState = getMowerState(mowerId);
    const mowerName = currentState?.mowerName || 'Unknown';
    const lastEventTimestamp = eventTimestampIso ?? shapedEvent?.receivedAt ?? new Date().toISOString();

    if (type === 'mower-event-v2') {
      const activity = attributes?.mower?.activity;
      if (activity) {
        if (activity != currentState?.activity) {
          const activityTimestampIso = toIsoTimestamp(attributes?.metadata?.timestamp) ?? new Date().toISOString();
          const activityTimestampMs = Date.parse(activityTimestampIso);
          console.log(`📍 Activity changed for ${mowerName} (${mowerIdShort}): ${activity} at ${activityTimestampIso}`);
          const sessionId = Number.isNaN(activityTimestampMs) ? Date.now() : activityTimestampMs;
          updateMowerState(mowerId, {
            mowerName,
            activity,
            sessionId,
            lastActivityAt: activityTimestampIso,
            lastEventAt: lastEventTimestamp,
            isCharging: activity === 'CHARGING'
          });
        }
      } else {
        updateMowerState(mowerId, {
          mowerName,
          lastEventAt: lastEventTimestamp
        });
      }

    } else if (type === 'position-event-v2') {
      const lat = attributes?.position?.latitude;
      const lon = attributes?.position?.longitude;
      const timestamp = toIsoTimestamp(attributes?.metadata?.timestamp) ?? new Date().toISOString();

      if (lat != null && lon != null) {
        const sessionId = currentState?.sessionId ?? currentState?.timestamp ?? Date.now();
        const state = currentState?.activity ?? 'UNKNOWN';

        storePosition({
          mowerId,
          sessionId,
          state,
          lat,
          lon,
          timestamp,
          eventId
        });

        updateMowerState(mowerId, {
          mowerName,
          lastPosition: { lat, lon, timestamp, eventId },
          lastEventAt: lastEventTimestamp
        });
      }

    } else if (type === 'message-event-v2') {
      const lat = attributes?.message?.latitude;
      const lon = attributes?.message?.longitude;
      const timestampIso = toIsoTimestamp(attributes?.message?.time) ?? new Date().toISOString();
      const code = attributes?.message?.code ?? null;
      const severity = attributes?.message?.severity ?? null;

      const emoji = severitySymbols.get(severity) || '📍';
      const desc = code != null ? (messageDescriptions.get(code) || 'Unknown message') : 'Message event';

      console.log(`${emoji} Message from ${mowerName} (${mowerIdShort}): ${severity} "${code} ${desc}" at ${timestampIso} [${lat}, ${lon}]`);

      updateMowerState(mowerId, {
        mowerName,
        lastEventAt: lastEventTimestamp ?? timestampIso,
        lastMessage: code != null || severity != null ? {
          code,
          severity,
          description: desc,
          timestamp: timestampIso,
          lat,
          lon
        } : currentState?.lastMessage
      });

    } else if (type === 'battery-event-v2') {
      const pctRaw = attributes?.battery?.batteryPercent;
      const pct = typeof pctRaw === 'number' ? Math.round(pctRaw) : pctRaw;
      updateMowerState(mowerId, {
        mowerName,
        batteryPercent: Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : null,
        lastBatteryAt: lastEventTimestamp,
        lastEventAt: lastEventTimestamp
      });
    } else {
      updateMowerState(mowerId, {
        mowerName,
        lastEventAt: lastEventTimestamp
      });
    }

  } catch (err) {
    console.error('WebSocket event error:', err);
  }
}

export async function startWebSocket(apiKey, apiSecret) {
  console.log('🔐 Connecting...');

  let token = await getToken(apiKey, apiSecret);

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  wss = new WebSocket('wss://ws.openapi.husqvarna.dev/v1', {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  wss.on('message', handleIncomingEvent);
  wss.on('close', async (code, reason) => {
    console.warn(`🔓 Disconnected: ${code} - ${reason}`);
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    reconnectAttempts += 1;
    let delay = 0;
    if (reconnectAttempts > 1) {
      const base = Math.min(30000, 1000 * 2 ** Math.min(reconnectAttempts - 1, 5));
      const jitter = Math.floor(Math.random() * 250);
      delay = base + jitter;
    }
    reconnectTimer = setTimeout(() => {
      startWebSocket(apiKey, apiSecret).catch((err) => {
        console.error('Reconnect attempt failed:', err);
      });
    }, delay);
  });
  wss.on('error', (err) => {
    console.error('⚠️ Connection error:', err);
  });

  if (pingInterval) {
    clearInterval(pingInterval);
  }

  pingInterval = setInterval(() => {
    if (wss && wss.readyState === WebSocket.OPEN) {
      try { wss.ping(); } catch {}
    }
  }, 60000);

  wss.on('open', () => {
    reconnectAttempts = 0;
  });
}

export async function stopWebSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  if (wss && (wss.readyState === WebSocket.OPEN || wss.readyState === WebSocket.CONNECTING)) {
    try { wss.close(); } catch {}
  }
}
