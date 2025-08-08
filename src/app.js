import { startHttpServer } from './server.js';
import { startWebSocket, stopWebSocket } from './amconnect.js';
import { mowerStates } from './state.js';
import { getToken, refreshToken, loadCredentials } from './auth.js'
import { closeDb } from './db.js';

async function getMowerData(accessToken, apiKey) {
  const response = await fetch('https://api.amc.husqvarna.dev/v1/mowers', {
    headers: {
      'Authorization-Provider': 'husqvarna',
      'Authorization': `Bearer ${accessToken}`,
      'X-Api-Key': apiKey
    }
  });

  if (response.status === 401 || response.status === 403) {
    const err = new Error('Unauthorized');
    err.status = response.status;
    throw err;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch mowers: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data;
}

async function loadMowerState(token, apiKey, apiSecret) {
  try {
    const initialData = await getMowerData(token, apiKey);
    const nowTs = Date.now();
    for (const mower of initialData.data ?? []) {
      const mowerId = mower.id;
      const mowerName = mower.attributes?.system?.name || "Unknown";
      const activity = mower.attributes?.mower?.activity ?? 'UNKNOWN';
      console.log(`📍 ${mowerName} (${mowerId}): ${activity} at ${new Date(nowTs).toISOString()}`);
      mowerStates.set(mowerId, { activity, mowerName, timestamp: nowTs });
    }
  } catch (err) {
    if (err?.status === 401 || err?.status === 403) {
      console.warn('🔁 Token expired during initial load. Refreshing...');
      const newToken = await refreshToken(apiKey, apiSecret);
      try {
        await loadMowerState(newToken, apiKey, apiSecret);
        return;
      } catch (e2) {
        console.warn('⚠️ Failed after refresh while fetching initial mower state:', e2);
      }
    } else {
      console.warn('⚠️ Failed to fetch initial mower state:', err);
    }
  }
}

(async function main() {
  const { apiKey, apiSecret } = await loadCredentials();
  if (!apiKey || !apiSecret) {
    console.error('🚷 Missing API credentials.');
    process.exit(1);
  }

  let token = await getToken(apiKey, apiSecret);

  startHttpServer();

  await loadMowerState(token, apiKey, apiSecret);
  await startWebSocket(apiKey, apiSecret);

  const shutdown = async () => {
    try {
      await stopWebSocket();
      closeDb();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})();
