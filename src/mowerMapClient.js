import { Buffer } from 'node:buffer';

import {
  MAX_SVG_BYTES,
  MowerMapError,
  parseMowerMapSvg
} from './mowerMapSvg.js';

export const MAP_CACHE_TTL_MS = 60 * 60 * 1000;
const MAP_FETCH_TIMEOUT_MS = 10000;

async function readLimitedText(response, maxBytes = MAX_SVG_BYTES) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new MowerMapError('MAP_INVALID', 'Generated map exceeds size limit');
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new MowerMapError('MAP_INVALID', 'Generated map exceeds size limit');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

export function createMowerMapClient({
  apiKey,
  apiSecret,
  getToken,
  refreshToken,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  cacheTtlMs = MAP_CACHE_TTL_MS
}) {
  const cache = new Map();
  const inFlight = new Map();

  async function request(mowerId, token) {
    const encodedMowerId = encodeURIComponent(mowerId);
    return fetchImpl(`https://api.amc.husqvarna.dev/v1/mowers/${encodedMowerId}/maps/generated`, {
      headers: {
        'Authorization-Provider': 'husqvarna',
        Authorization: `Bearer ${token}`,
        'X-Api-Key': apiKey
      },
      signal: AbortSignal.timeout(MAP_FETCH_TIMEOUT_MS)
    });
  }

  async function download(mowerId) {
    let token = await getToken(apiKey, apiSecret);
    let response = await request(mowerId, token);
    if (response.status === 401 || response.status === 403) {
      token = await refreshToken(apiKey, apiSecret);
      response = await request(mowerId, token);
    }
    if (response.status === 404) {
      throw new MowerMapError(
        'MAP_NOT_AVAILABLE',
        'No generated mower map is available'
      );
    }
    if (!response.ok) {
      throw new MowerMapError(
        'MAP_FETCH_FAILED',
        `Generated map request failed with status ${response.status}`
      );
    }

    const parsed = parseMowerMapSvg(await readLimitedText(response));
    const fetchedMs = now();
    return {
      ...parsed,
      fetchedAt: new Date(fetchedMs).toISOString(),
      fetchedMs,
      cacheKey: `${mowerId}:${fetchedMs}`
    };
  }

  async function refresh(mowerId, previous) {
    try {
      const entry = await download(mowerId);
      cache.set(mowerId, entry);
      return { ...entry, stale: false };
    } catch (error) {
      if (previous) return { ...previous, stale: true };
      if (error instanceof MowerMapError) throw error;
      throw new MowerMapError(
        'MAP_FETCH_FAILED',
        'Generated map request failed',
        { cause: error }
      );
    }
  }

  async function getGeometry(mowerId) {
    const previous = cache.get(mowerId);
    if (previous && now() - previous.fetchedMs < cacheTtlMs) {
      return { ...previous, stale: false };
    }
    if (inFlight.has(mowerId)) return inFlight.get(mowerId);

    const pending = refresh(mowerId, previous)
      .finally(() => inFlight.delete(mowerId));
    inFlight.set(mowerId, pending);
    return pending;
  }

  return {
    getGeometry,
    clear: () => cache.clear()
  };
}
