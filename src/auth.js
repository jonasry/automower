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

async function getNewAccessToken(apiKey, apiSecret) {
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

  console.log("🔑 Got a new access token")

  const data = await response.json();
  await saveToken(data.access_token, data.expires_in);
  return data.access_token;
}

async function getToken(apiKey, apiSecret) {
  let token = await loadStoredToken();
  if (!token) {
    token = await getNewAccessToken(apiKey, apiSecret);
  }
  return token;
}

// Expose a refresh function for forced renewals on 401/403
async function refreshToken(apiKey, apiSecret) {
  return getNewAccessToken(apiKey, apiSecret);
}

export { getToken, refreshToken, loadCredentials };
