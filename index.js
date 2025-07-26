// Simple script to fetch Automower data using Automower Connect API
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const API_KEY = process.env.HQ_API_KEY;
const API_SECRET = process.env.HQ_API_SECRET;

const CONFIG_DIR = path.join(os.homedir(), '.config', 'autoplanner');
const TOKEN_FILE = path.join(CONFIG_DIR, 'access_token.json');

if (!API_KEY || !API_SECRET) {
  console.error('HQ_API_KEY and HQ_API_SECRET must be provided as environment variables');
  process.exit(1);
}

async function loadStoredToken() {
  try {
    const raw = await fs.readFile(TOKEN_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (data.access_token && data.expires_at && new Date() < new Date(data.expires_at)) {
      return data.access_token;
    }
  } catch {
    // ignore errors (file may not exist or invalid JSON)
  }
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
  await fs.chmod(TOKEN_FILE, 0o600);
}

async function getAccessToken() {
  const url = 'https://api.authentication.husqvarnagroup.dev/v1/oauth2/token';
  const params = new URLSearchParams();
  params.append('client_id', API_KEY);
  params.append('client_secret', API_SECRET);
  params.append('grant_type', 'client_credentials');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params
  });

  if (!response.ok) {
    throw new Error(`Authentication failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  await saveToken(data.access_token, data.expires_in);
  return data.access_token;
}

async function getMowerData(accessToken) {
  const response = await fetch('https://api.amc.husqvarna.dev/v1/mowers', {
    headers: {
      'Authorization-Provider': 'husqvarna',
      'Authorization': `Bearer ${accessToken}`,
      'X-Api-Key': API_KEY
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

function printMowerInfo(mowers) {
  if (!Array.isArray(mowers.data)) {
    console.log('No mower data received');
    return;
  }
  mowers.data.forEach((item) => {
    const name = item.attributes?.system?.name;
    const model = item.attributes?.system?.model;
    const activity = item.attributes?.mower?.activity;
    const battery = item.attributes?.battery?.batteryPercent;
    console.log(`${name} (${model}): ${activity} (${battery}%)`);
  });
}

async function main() {
  try {
    let token = await loadStoredToken();
    if (!token) {
      token = await getAccessToken();
    }

    let mowers;
    try {
      mowers = await getMowerData(token);
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        token = await getAccessToken();
        mowers = await getMowerData(token);
      } else {
        throw err;
      }
    }

    printMowerInfo(mowers);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
