import WebSocket from 'ws';
import { storePosition, storeEvent } from './db.js';
import { getMowerState, updateMowerState } from './state.js';
import { getToken } from './auth.js';
import { messageDescriptions, severitySymbols } from './amcmessages.js';
import { shapeEventForStorage, toIsoTimestamp } from './events.js';
import { clientEventBus } from './clientEvents.js';

let pingInterval = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let wss = null;
const pendingPersistence = new Set();
export const MAX_PENDING_PERSISTENCE = 100;

export function createConnectionLifecycle() {
  let generation = 0;
  let stopped = true;

  return {
    start() {
      stopped = false;
      generation += 1;
      return generation;
    },
    stop() {
      stopped = true;
      generation += 1;
    },
    isCurrent(candidate) {
      return !stopped && candidate === generation;
    },
    shouldReconnect(candidate) {
      return !stopped && candidate === generation;
    }
  };
}

export function waitForWebSocketClose(socket) {
  if (!socket || socket.readyState === WebSocket.CLOSED) return Promise.resolve();

  return new Promise((resolve) => {
    socket.once('close', resolve);
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      try {
        socket.close();
      } catch {
        socket.removeListener('close', resolve);
        resolve();
      }
    }
  });
}

const connectionLifecycle = createConnectionLifecycle();

function publishClientChange({ type, mowerId, eventId, timestamp, changed }) {
  clientEventBus.publish({ type, mowerId, eventId, timestamp, changed });
}

async function persistIncomingEvent(shapedEvent, position) {
  let eventId = null;
  if (shapedEvent) {
    try {
      eventId = await storeEvent(shapedEvent);
    } catch (err) {
      console.error('Failed to persist event:', err);
    }
  }

  if (position) {
    try {
      await storePosition({ ...position, eventId });
    } catch (err) {
      console.error('Failed to persist position:', err);
    }
  }

  return eventId;
}

export async function handleIncomingEvent(data, { persist = true } = {}) {
  if (!data.length) return;

  try {
    const text = data.toString();
    const message = JSON.parse(text);

    //console.log('message', message);

    if (message.ready) {
      console.log("🔒 Connected")
    }

    const { type, attributes, id: mowerId } = message;
    const currentState = mowerId ? getMowerState(mowerId) : null;
    const mowerTimeZone = currentState?.timeZone ?? attributes?.settings?.timeZone ?? null;
    const shapedEvent = shapeEventForStorage(message, { mowerTimeZone });
    let eventId = null;
    const eventTimestampIso = shapedEvent?.eventTimestamp ?? null;
    let positionToStore = null;

    if (!type || !attributes || !mowerId) {
      if (persist) await persistIncomingEvent(shapedEvent, null);
      return;
    }

    const mowerIdShort = mowerId.substring(0, 8);
    const mowerName = currentState?.mowerName || 'Unknown';
    const timeZone = mowerTimeZone ?? currentState?.timeZone ?? null;
    const lastEventTimestamp = eventTimestampIso ?? shapedEvent?.receivedAt ?? new Date().toISOString();

    if (type === 'mower-event-v2') {
      const activity = attributes?.mower?.activity;
      if (activity) {
        if (activity != currentState?.activity) {
          const activityTimestampIso = toIsoTimestamp(attributes?.metadata?.timestamp) ?? new Date().toISOString();
          const activityTimestampMs = Date.parse(activityTimestampIso);
          console.log(`📍 Activity changed for ${mowerName} (${mowerIdShort}): ${activity} at ${activityTimestampIso}`);
          updateMowerState(mowerId, {
            mowerName,
            timeZone,
            activity,
            sessionId: Number.isNaN(activityTimestampMs) ? Date.now() : activityTimestampMs,
            lastActivityAt: activityTimestampIso,
            lastEventAt: lastEventTimestamp,
            isCharging: activity === 'CHARGING',
            suppressMapAnchor: false
          });
          publishClientChange({
            type,
            mowerId,
            eventId,
            timestamp: activityTimestampIso,
            changed: ['status']
          });
        }
      } else {
        updateMowerState(mowerId, {
          mowerName,
          timeZone,
          lastEventAt: lastEventTimestamp
        });
        publishClientChange({
          type,
          mowerId,
          eventId,
          timestamp: lastEventTimestamp,
          changed: ['status']
        });
      }

    } else if (type === 'position-event-v2') {
      const lat = attributes?.position?.latitude;
      const lon = attributes?.position?.longitude;
      const timestamp = toIsoTimestamp(attributes?.metadata?.timestamp) ?? new Date().toISOString();

      if (lat != null && lon != null) {
        const sessionId = currentState?.sessionId ?? currentState?.timestamp ?? Date.now();
        const state = currentState?.activity ?? 'UNKNOWN';

        positionToStore = { mowerId, sessionId, state, lat, lon, timestamp };

        updateMowerState(mowerId, {
          mowerName,
          timeZone,
          lastPosition: { lat, lon, timestamp, eventId },
          lastEventAt: lastEventTimestamp
        });
        publishClientChange({
          type,
          mowerId,
          eventId,
          timestamp,
          changed: ['position']
        });
      }

    } else if (type === 'message-event-v2') {
      const lat = attributes?.message?.latitude;
      const lon = attributes?.message?.longitude;
      const timestampIso = eventTimestampIso ?? new Date().toISOString();
      const code = attributes?.message?.code ?? null;
      const severity = attributes?.message?.severity ?? null;

      const emoji = severitySymbols.get(severity) || '📍';
      const desc = code != null ? (messageDescriptions.get(code) || 'Unknown message') : 'Message event';

      console.log(`${emoji} Message from ${mowerName} (${mowerIdShort}): ${severity} "${code} ${desc}" at ${timestampIso} [${lat}, ${lon}]`);

      updateMowerState(mowerId, {
        mowerName,
        timeZone,
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
      publishClientChange({
        type,
        mowerId,
        eventId,
        timestamp: timestampIso,
        changed: ['message']
      });

    } else if (type === 'battery-event-v2') {
      const pctRaw = attributes?.battery?.batteryPercent;
      const pct = pctRaw == null ? null : Math.round(Number(pctRaw));
      updateMowerState(mowerId, {
        mowerName,
        timeZone,
        batteryPercent: Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : null,
        lastBatteryAt: lastEventTimestamp,
        lastEventAt: lastEventTimestamp
      });
      publishClientChange({
        type,
        mowerId,
        eventId,
        timestamp: lastEventTimestamp,
        changed: ['battery']
      });
    } else {
      updateMowerState(mowerId, {
        mowerName,
        timeZone,
        lastEventAt: lastEventTimestamp
      });
      publishClientChange({
        type,
        mowerId,
        eventId,
        timestamp: lastEventTimestamp,
        changed: ['status']
      });
    }

    if (persist) {
      eventId = await persistIncomingEvent(shapedEvent, positionToStore);
      if (positionToStore && eventId != null) {
        const latestState = getMowerState(mowerId);
        if (latestState?.lastPosition?.timestamp === positionToStore.timestamp) {
          updateMowerState(mowerId, {
            lastPosition: { ...latestState.lastPosition, eventId }
          });
        }
      }
    }

  } catch (err) {
    console.error('WebSocket event error:', err);
  }
}

export function enqueueIncomingEvent(data) {
  if (pendingPersistence.size >= MAX_PENDING_PERSISTENCE) {
    console.warn('Dropping event persistence because the database backlog is full');
    return handleIncomingEvent(data, { persist: false });
  }

  const task = handleIncomingEvent(data);
  pendingPersistence.add(task);
  task.then(
    () => pendingPersistence.delete(task),
    () => pendingPersistence.delete(task)
  );
  return task;
}

export function drainIncomingEvents() {
  return Promise.allSettled([...pendingPersistence]);
}

export function getPendingPersistenceCount() {
  return pendingPersistence.size;
}

async function connectWebSocket(apiKey, apiSecret, generation) {
  console.log('🔐 Connecting...');

  const token = await getToken(apiKey, apiSecret);
  if (!connectionLifecycle.isCurrent(generation)) return;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const socket = new WebSocket('wss://ws.openapi.husqvarna.dev/v1', {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  wss = socket;

  socket.on('message', enqueueIncomingEvent);
  socket.on('close', (code, reason) => {
    console.warn(`🔓 Disconnected: ${code} - ${reason}`);
    if (wss === socket) {
      wss = null;
    }
    if (wss === null && pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    if (!connectionLifecycle.shouldReconnect(generation)) return;

    reconnectAttempts += 1;
    let delay = 0;
    if (reconnectAttempts > 1) {
      const base = Math.min(30000, 1000 * 2 ** Math.min(reconnectAttempts - 1, 5));
      const jitter = Math.floor(Math.random() * 250);
      delay = base + jitter;
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!connectionLifecycle.shouldReconnect(generation)) return;
      connectWebSocket(apiKey, apiSecret, generation).catch((err) => {
        console.error('Reconnect attempt failed:', err);
      });
    }, delay);
  });
  socket.on('error', (err) => {
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

  socket.on('open', () => {
    if (connectionLifecycle.isCurrent(generation) && wss === socket) {
      reconnectAttempts = 0;
    }
  });
}

export async function startWebSocket(apiKey, apiSecret) {
  const generation = connectionLifecycle.start();
  return connectWebSocket(apiKey, apiSecret, generation);
}

export async function stopWebSocket() {
  console.warn('⚠️ Stop WebSocket called');
  connectionLifecycle.stop();

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  const socket = wss;
  wss = null;
  await waitForWebSocketClose(socket);
}
