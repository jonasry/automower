import { startHttpServer } from './server.js';
import { startWebSocket } from './amconnect.js';
import { mowerStates } from './state.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'autoplanner');
const CREDENTIALS_FILE = path.join(CONFIG_DIR, 'credentials.json');
const TOKEN_FILE = path.join(CONFIG_DIR, 'access_token.json');

async function loadCredentials() {
  try {
    const raw = await fs.readFile(CREDENTIALS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (data['api-key'] && data['api-secret']) {
      return { apiKey: data['api-key'], apiSecret: data['api-secret'] };
    }
  } catch {}
  return { apiKey: process.env.HQ_API_KEY, apiSecret: process.env.HQ_API_SECRET };
}

async function loadStoredToken() {
  try {
    const raw = await fs.readFile(TOKEN_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (data.access_token && data.expires_at && new Date() < new Date(data.expires_at)) {
      return data.access_token;
    }
  } catch {}
  return null;
}

async function saveToken(accessToken, expiresIn) {
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  const contents = {
    access_token: accessToken,
    expires_at: expiresAt
  };
  await fs.writeFile(TOKEN_FILE, JSON.stringify(contents, null, 2), { mode: 0o600 });
}

async function getAccessToken(apiKey, apiSecret) {
  const url = 'https://api.authentication.husqvarnagroup.dev/v1/oauth2/token';
  const params = new URLSearchParams();
  params.append('client_id', apiKey);
  params.append('client_secret', apiSecret);
  params.append('grant_type', 'client_credentials');

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });

  if (!response.ok) throw new Error(`Auth failed: ${response.status} ${response.statusText}`);
  const data = await response.json();
  await saveToken(data.access_token, data.expires_in);
  return data.access_token;
}

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
    for (const mower of initialData.data ?? []) {
      const id = mower.id;
      const activity = mower.attributes?.mower?.activity ?? 'UNKNOWN';
      mowerStates.set(id, { activity, timestamp: new Date() });
    }
    console.log('✅ Initial mower state populated');
  } catch (err) {
    console.warn('⚠️ Failed to fetch initial mower state:', err);
  }
}

(async function main() {
  const { apiKey, apiSecret } = await loadCredentials();
  if (!apiKey || !apiSecret) {
    console.error('Missing API credentials.');
    process.exit(1);
  }

  let token = await loadStoredToken();
  if (!token) {
    token = await getAccessToken(apiKey, apiSecret);
  }

  await loadMowerState(token, apiKey);

  startWebSocket(token);
  startHttpServer();
})();
