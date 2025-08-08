import WebSocket from 'ws';
import { storePosition } from './db.js';
import { mowerStates } from './state.js';
import { getToken } from './auth.js'
import { messageDescriptions, severitySymbols } from './amcmessages.js'

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

    const mowerIdShort = mowerId.substring(0, 8);
    const currentState = mowerStates.get(mowerId);
    const mowerName = currentState?.mowerName || "Unknown";

    if (type === 'mower-event-v2') {
      const activity = attributes?.mower?.activity;
      if (activity) {
        if (activity != currentState?.activity) {
          const timestamp = Date.now();
          console.log(`📍 Activity changed for ${mowerName} (${mowerIdShort}): ${activity} at ${new Date(timestamp).toISOString()}`);
          mowerStates.set(mowerId, { activity, mowerName, timestamp });
        }
      }

    } else if (type === 'position-event-v2') {
      const lat = attributes?.position?.latitude;
      const lon = attributes?.position?.longitude;
      const timestamp = attributes?.metadata?.timestamp || new Date().toISOString();

      if (lat != null && lon != null) {
        storePosition(mowerId, currentState?.timestamp ?? 0, currentState?.activity ?? 'UNKNOWN', lat, lon, timestamp);
      }

    } else if (type === 'message-event-v2') {
      const lat = attributes?.message?.latitude;
      const lon = attributes?.message?.longitude;
      const timestamp = attributes?.message?.time || 0;
      const code = attributes?.message?.code;
      const severity = attributes?.message?.severity;

      const emoji = severitySymbols.get(severity) || '📍';
      const desc = messageDescriptions.get(code) || 'Unknown message';

      console.log(`${emoji} Message from ${mowerName} (${mowerIdShort}): ${severity} "${code} ${desc}" at ${new Date(timestamp * 1000).toISOString()} [${lat}, ${lon}]`);
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
