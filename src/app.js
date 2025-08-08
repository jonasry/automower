import { startHttpServer } from './server.js';
import { startWebSocket } from './amconnect.js';
import { mowerStates } from './state.js';
import { getToken, loadCredentials } from './auth.js'

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

async function loadMowerState(token, apiKey) {
  try {
    const initialData = await getMowerData(token, apiKey);
    const timestamp = initialData.attributes?.metadata?.statusTimestamp || Date.now();
    for (const mower of initialData.data ?? []) {
      const mowerId = mower.id;
      const mowerName = mower.attributes?.system?.name || "Unknown";
      const activity = mower.attributes?.mower?.activity ?? 'UNKNOWN';
      console.log(`📍 ${mowerName} (${mowerId}): ${activity} at ${new Date(timestamp).toISOString()}`);
      mowerStates.set(mowerId, { activity, mowerName, timestamp });
    }
  } catch (err) {
    console.warn('⚠️ Failed to fetch initial mower state:', err);
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

  await loadMowerState(token, apiKey);
  await startWebSocket(apiKey, apiSecret);
})();
