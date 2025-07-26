// Simple script to fetch Automower data using Automower Connect API
const API_KEY = process.env.HQ_API_KEY;
const API_SECRET = process.env.HQ_API_SECRET;

if (!API_KEY || !API_SECRET) {
  console.error('HQ_API_KEY and HQ_API_SECRET must be provided as environment variables');
  process.exit(1);
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
    console.log(`${name} (${model}): ${activity}`);
  });
}

async function main() {
  try {
    const token = await getAccessToken();
    const mowers = await getMowerData(token);
    printMowerInfo(mowers);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
