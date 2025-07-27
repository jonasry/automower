import WebSocket from 'ws';
import db from './db.js';
import { mowerStates } from './state.js';

const stmt = db.prepare(
  'INSERT INTO positions (mower_id, activity, lat, lon, timestamp) VALUES (?, ?, ?, ?, ?)'
);

function storePosition(mowerId, state, lat, lon, timestamp) {
  stmt.run(mowerId, state, lat, lon, timestamp);
}

function handleIncomingEvent(data) {
  if (!data.length) return;

  try {
    const text = data.toString();
    const json = JSON.parse(text);
    const { type, attributes, id: mowerId } = json;
    if (!type || !attributes || !mowerId) return;

    if (type === 'mower-event-v2') {
      const activity = attributes?.mower?.activity;
      if (activity) {
        mowerStates.set(mowerId, { activity, timestamp: new Date() });
      }

    } else if (type === 'position-event-v2') {
      const lat = attributes?.position?.latitude;
      const lon = attributes?.position?.longitude;
      const timestamp = attributes?.metadata?.timestamp || new Date().toISOString();
      const state = mowerStates.get(mowerId);

      if (lat != null && lon != null) {
        storePosition(mowerId, state?.activity ?? 'UNKNOWN', lat, lon, timestamp);
      }
    }

  } catch (err) {
    console.error('WebSocket event error:', err);
  }
}

export function startWebSocket(token) {
  const wss = new WebSocket('wss://ws.openapi.husqvarna.dev/v1', {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  wss.on('message', handleIncomingEvent);

  setInterval(() => {
    wss.send('ping');
  }, 60000);
}
