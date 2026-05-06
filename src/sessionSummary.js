function parseTimestamp(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function summarizeLatestSession(data) {
  if (!Array.isArray(data) || data.length === 0) return null;

  const latestSessionId = data[data.length - 1][3];
  const timestamps = [];

  for (let i = data.length - 1; i >= 0; i--) {
    const entry = data[i];
    if (entry[3] !== latestSessionId) break;
    if (entry[4] !== true) continue;

    const time = parseTimestamp(entry[5]);
    if (time != null) {
      timestamps.push({ iso: entry[5], time });
    }
  }

  if (timestamps.length === 0) {
    return {
      sessionId: latestSessionId,
      start: null,
      end: null,
      durationMs: null,
      points: 0
    };
  }

  timestamps.sort((a, b) => a.time - b.time);
  const start = timestamps[0];
  const end = timestamps[timestamps.length - 1];

  return {
    sessionId: latestSessionId,
    start: start.iso,
    end: end.iso,
    durationMs: Math.max(0, end.time - start.time),
    points: timestamps.length
  };
}

export { summarizeLatestSession };
