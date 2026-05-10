export function toIsoTimestamp(value) {
  if (value == null) return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 1e12 ? value : value * 1000;
    return new Date(millis).toISOString();
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.length) return null;

    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) {
      return toIsoTimestamp(numeric);
    }

    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return null;
}

function getTimeZoneOffsetMs(timeZone, instantMs) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(instantMs))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );

  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  ) - instantMs;
}

export function toIsoTimestampFromLocalTime(value, timeZone) {
  if (!timeZone) return toIsoTimestamp(value);

  const utcIso = toIsoTimestamp(value);
  if (!utcIso) return null;

  try {
    const utcDate = new Date(utcIso);
    let instantMs = Date.UTC(
      utcDate.getUTCFullYear(),
      utcDate.getUTCMonth(),
      utcDate.getUTCDate(),
      utcDate.getUTCHours(),
      utcDate.getUTCMinutes(),
      utcDate.getUTCSeconds(),
      utcDate.getUTCMilliseconds()
    );

    for (let i = 0; i < 3; i += 1) {
      instantMs = Date.parse(utcIso) - getTimeZoneOffsetMs(timeZone, instantMs);
    }

    return new Date(instantMs).toISOString();
  } catch {
    return utcIso;
  }
}

function extractCoordinates(eventType, attributes) {
  if (!attributes) return { lat: null, lon: null };

  if (eventType === 'position-event-v2') {
    const lat = attributes?.position?.latitude ?? null;
    const lon = attributes?.position?.longitude ?? null;
    return { lat, lon };
  }

  if (eventType === 'message-event-v2') {
    const lat = attributes?.message?.latitude ?? null;
    const lon = attributes?.message?.longitude ?? null;
    return { lat, lon };
  }

  return { lat: null, lon: null };
}

function extractMessageDetails(attributes) {
  if (!attributes?.message) return { code: null, severity: null };
  return {
    code: attributes.message.code ?? null,
    severity: attributes.message.severity ?? null
  };
}

function deriveTimestamp(message, { mowerTimeZone } = {}) {
  const attributes = message?.attributes ?? {};

  return (
    toIsoTimestamp(attributes?.metadata?.timestamp) ??
    toIsoTimestampFromLocalTime(attributes?.message?.time, mowerTimeZone) ??
    toIsoTimestampFromLocalTime(attributes?.mower?.errorCodeTimestamp, mowerTimeZone) ??
    toIsoTimestampFromLocalTime(attributes?.planner?.nextStartTimestamp, mowerTimeZone) ??
    toIsoTimestamp(attributes?.position?.timestamp) ??
    null
  );
}

export function shapeEventForStorage(message, options = {}) {
  if (!message || typeof message !== 'object') return null;

  const receivedAt = new Date().toISOString();

  if (message.ready) {
    return {
      mowerId: null,
      eventType: 'connection-event',
      eventTimestamp: receivedAt,
      receivedAt,
      lat: null,
      lon: null,
      messageCode: null,
      messageSeverity: null,
      payload: JSON.stringify(message)
    };
  }

  const { id: mowerId, type, attributes } = message;
  if (!type || !mowerId) return null;

  const eventTimestamp = deriveTimestamp(message, options) ?? receivedAt;
  const { lat, lon } = extractCoordinates(type, attributes);
  const { code: messageCode, severity: messageSeverity } = extractMessageDetails(attributes);

  return {
    mowerId,
    eventType: type,
    eventTimestamp,
    receivedAt,
    lat,
    lon,
    messageCode,
    messageSeverity,
    payload: JSON.stringify(message)
  };
}
