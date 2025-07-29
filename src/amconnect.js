import WebSocket from 'ws';
import { storePosition } from './db.js';
import { mowerStates } from './state.js';
import { getToken } from './auth.js'

let pingInterval = null;

function handleIncomingEvent(data) {
  if (!data.length) return;

  try {
    const text = data.toString();
    const message = JSON.parse(text);

    //console.log('message', message);

    if (message.ready) {
      console.log("🔒 Connected")
    }

    const { type, attributes, id: mowerId } = message;
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

export async function startWebSocket(apiKey, apiSecret) {
  console.log('🔐 Connecting...');

  let token = await getToken(apiKey, apiSecret);

  const wss = new WebSocket('wss://ws.openapi.husqvarna.dev/v1', {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  wss.on('message', handleIncomingEvent);
  wss.on('close', async (code, reason) => {
    console.warn(`🔓 Disconnected: ${code} - ${reason}`);
    await startWebSocket(apiKey, apiSecret);
  });
  wss.on('error', (err) => {
    console.error('⚠️ Connection error:', err);
  });

  if (pingInterval) {
    clearInterval(pingInterval);
  }

  pingInterval = setInterval(() => {
    if (wss.readyState === WebSocket.OPEN) {
      wss.send('ping');
    }
  }, 60000);
}
