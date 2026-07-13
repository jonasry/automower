import { configureMowerMapClient, startHttpServer } from './server.js';
import { drainIncomingEvents, startWebSocket, stopWebSocket } from './amconnect.js';
import { updateMowerState } from './state.js';
import { getToken, refreshToken, loadCredentials } from './auth.js';
import { closeDb } from './db.js';
import { assertDatabaseReady } from './dbMigrations.js';
import { createShutdown, startRuntime } from './appLifecycle.js';
import { createMowerMapClient } from './mowerMapClient.js';

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
    const nowIso = new Date(nowTs).toISOString();
    for (const mower of initialData.data ?? []) {
      const mowerId = mower.id;
      const mowerName = mower.attributes?.system?.name || 'Unknown';
      const timeZone = mower.attributes?.settings?.timeZone ?? null;
      const activity = mower.attributes?.mower?.activity ?? 'UNKNOWN';
      const batteryRaw = mower.attributes?.battery?.batteryPercent;
      const batteryPercent = batteryRaw == null ? null : Math.round(Number(batteryRaw));
      const state = updateMowerState(mowerId, {
        mowerName,
        timeZone,
        activity,
        sessionId: nowTs,
        lastActivityAt: nowIso,
        lastEventAt: nowIso,
        batteryPercent: Number.isFinite(batteryPercent) ? batteryPercent : null,
        lastBatteryAt: Number.isFinite(batteryPercent) ? nowIso : null,
        isCharging: activity === 'CHARGING'
      });

      console.log(`📍 ${state.mowerName} (${mowerId}): ${state.activity} at ${nowIso}`);
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

  configureMowerMapClient(createMowerMapClient({
    apiKey,
    apiSecret,
    getToken,
    refreshToken
  }));

  let token = await getToken(apiKey, apiSecret);

  const server = await startRuntime({
    assertDatabaseReady,
    startHttpServer,
    loadMowerState,
    startWebSocket,
    token,
    apiKey,
    apiSecret
  });

  const closeHttpServer = () => new Promise((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close((error) => error ? reject(error) : resolve());
  });
  const shutdown = createShutdown({
    stopWebSocket,
    closeHttpServer,
    drainIncomingEvents,
    closeDb,
    timeoutMs: 10000
  });
  const handleSignal = () => {
    shutdown()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error('Graceful shutdown failed:', error);
        process.exit(1);
      });
  };
  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);
})().catch((error) => {
  console.error('Application startup failed:', error);
  process.exitCode = 1;
});
