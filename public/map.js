const gardenGradient = {
  0.2: 'rgba(131, 164, 113, 0.55)',
  0.45: '#7ea36a',
  0.7: '#d8b65f',
  1.0: '#df7f64'
};

const STATUS_POLL_MS = 30000;

const map = L.map('map', {
  zoomControl: true
}).setView([55.7, 13.2], 17);

let heatLayer = null;
let recentLayer = null;
let activeRequests = 0;
let latestRequestId = 0;
let hasRenderedData = false;
let statusSnapshot = null;
let selectedMowerId = null;
let selectedSessionId = 'latest';
let boundsKey = null;
let suppressSessionChange = false;

const mowerPicker = document.getElementById('mowerPicker');
const sessionSelect = document.getElementById('sessionSelect');
const activityBadge = document.getElementById('activityBadge');
const freshnessText = document.getElementById('freshnessText');
const sessionTitle = document.getElementById('sessionTitle');
const sessionSummary = document.getElementById('sessionSummary');
const pointsValue = document.getElementById('pointsValue');
const durationValue = document.getElementById('durationValue');
const startValue = document.getElementById('startValue');
const endValue = document.getElementById('endValue');
const statusValue = document.getElementById('statusValue');
const batteryLevel = document.getElementById('batteryLevel');
const batteryText = document.getElementById('batteryText');

const sessionLabelFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

function parseTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toTitleCase(value) {
  if (!value) return 'Unknown';
  return value
    .toString()
    .toLowerCase()
    .split(/[_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatRelativeTime(iso) {
  const ts = Date.parse(iso ?? '');
  if (!Number.isFinite(ts)) return 'Last updated -';
  const diffMs = Date.now() - ts;
  if (diffMs < 60000) return 'Last updated just now';
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 60) return `Last updated ${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `Last updated ${diffHours}h ago`;
  return `Last updated ${Math.floor(diffHours / 24)}d ago`;
}

function formatDurationMs(ms) {
  if (!Number.isFinite(ms)) return '-';

  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function formatDurationMinutes(minutes) {
  if (!Number.isFinite(minutes)) return '-';
  return formatDurationMs(minutes * 60000);
}

function formatTimestamp(value) {
  const date = parseTimestamp(value);
  if (!date) return '-';
  return sessionLabelFormatter.format(date);
}

function formatSessionOptionLabel(session) {
  const startLabel = formatTimestamp(session.start);
  const durationLabel = formatDurationMinutes(session.durationMinutes);
  const pointsLabel = Number.isFinite(session.points) ? `${session.points} pts` : '-';
  return `${startLabel} | ${durationLabel} | ${pointsLabel}`;
}

function describeMessage(msg) {
  if (!msg) return null;
  const parts = [];
  const ts = formatTimestamp(msg.timestamp);
  if (ts !== '-') parts.push(ts);
  const severity = msg.severity ?? 'INFO';
  const code = msg.code != null ? ` ${msg.code}` : '';
  parts.push(`${severity}${code}`);
  if (msg.description) parts.push(msg.description);
  return parts.join(' - ');
}

function setMapMessage(message) {
  const el = document.getElementById('mapMessage');
  el.hidden = !message;
  el.textContent = message || '';
}

function setPanelLoading(isLoading) {
  document.body.classList.toggle('is-loading', isLoading);
}

function setStatusValue(value) {
  statusValue.textContent = value;
}

function setActivityBadge(value) {
  activityBadge.textContent = value;
}

function resetMapFit() {
  boundsKey = null;
}

function updateBattery(pct) {
  const clamped = Number.isFinite(pct) ? Math.max(0, Math.min(100, Math.round(pct))) : null;
  batteryLevel.style.setProperty('--level', `${clamped ?? 0}%`);
  if (clamped == null) {
    batteryLevel.dataset.state = 'unknown';
    batteryText.textContent = '-';
    return;
  }

  batteryLevel.dataset.state = clamped < 20 ? 'critical' : clamped < 50 ? 'attention' : 'normal';
  batteryText.textContent = `${clamped}%`;
}

function resolveSelectedSessionSummary(summaries) {
  if (!Array.isArray(summaries) || summaries.length === 0) return null;
  if (selectedSessionId === 'latest' || selectedSessionId == null) return summaries[0];
  return summaries.find((session) => String(session.id) === String(selectedSessionId)) ?? summaries[0];
}

function getSelectedSessionSummaries() {
  return statusSnapshot?.sessions?.[selectedMowerId] ?? [];
}

function getEffectiveSessionId() {
  return resolveSelectedSessionSummary(getSelectedSessionSummaries())?.id ?? null;
}

function renderSessionStats({ heat, session, summary, mower }) {
  const displaySummary = summary ?? null;
  const messageText = describeMessage(displaySummary?.messages?.[0] ?? mower?.lastMessage);
  const statusText = messageText ?? (heat.length ? 'Coverage data loaded' : 'Waiting for data');

  pointsValue.textContent = Number.isFinite(displaySummary?.points)
    ? displaySummary.points.toLocaleString()
    : (heat.length ? heat.length.toLocaleString() : '-');
  durationValue.textContent = displaySummary
    ? formatDurationMinutes(displaySummary.durationMinutes)
    : formatDurationMs(session?.durationMs);
  startValue.textContent = formatTimestamp(displaySummary?.start ?? session?.start);
  endValue.textContent = formatTimestamp(displaySummary?.end ?? session?.end);
  statusValue.textContent = statusText;
}

function updateMowerPickerOptions(mowers) {
  const incomingIds = mowers.map((mower) => mower.id);
  const existingIds = Array.from(mowerPicker.options).map((option) => option.value);
  const needsUpdate =
    existingIds.length !== incomingIds.length ||
    existingIds.some((id, index) => id !== incomingIds[index]);

  if (needsUpdate) {
    mowerPicker.innerHTML = '';
    for (const mower of mowers) {
      const option = document.createElement('option');
      option.value = mower.id;
      option.textContent = mower.name ?? mower.id;
      mowerPicker.appendChild(option);
    }
  }

  mowerPicker.disabled = mowers.length <= 1;
  if (selectedMowerId && incomingIds.includes(selectedMowerId)) {
    mowerPicker.value = selectedMowerId;
  } else {
    selectedMowerId = incomingIds[0] ?? null;
    mowerPicker.value = selectedMowerId ?? '';
  }
}

function populateSessionSelect(summaries) {
  suppressSessionChange = true;
  sessionSelect.innerHTML = '';

  const latestOption = document.createElement('option');
  latestOption.value = 'latest';
  latestOption.textContent = 'Latest session';
  sessionSelect.appendChild(latestOption);

  for (const session of summaries) {
    const option = document.createElement('option');
    option.value = String(session.id);
    option.textContent = formatSessionOptionLabel(session);
    sessionSelect.appendChild(option);
  }

  if (selectedSessionId !== 'latest') {
    const hasSelection = summaries.some((session) => String(session.id) === String(selectedSessionId));
    if (!hasSelection) selectedSessionId = 'latest';
  }

  sessionSelect.value = selectedSessionId ?? 'latest';
  sessionSelect.disabled = summaries.length === 0;
  suppressSessionChange = false;
}

function renderStatus() {
  if (!statusSnapshot || !Array.isArray(statusSnapshot.mowers) || statusSnapshot.mowers.length === 0) {
    mowerPicker.innerHTML = '<option value="">No mowers</option>';
    mowerPicker.disabled = true;
    sessionSelect.innerHTML = '<option value="latest">Latest session</option>';
    sessionSelect.disabled = true;
    selectedMowerId = null;
    setActivityBadge('Waiting for data');
    freshnessText.textContent = 'Last updated -';
    sessionTitle.textContent = 'Latest garden run';
    sessionSummary.textContent = 'Showing recent path and coverage heat from recorded mower positions.';
    updateBattery(null);
    return null;
  }

  if (!selectedMowerId || !statusSnapshot.mowers.some((mower) => mower.id === selectedMowerId)) {
    selectedMowerId = statusSnapshot.mowers[0].id;
  }

  updateMowerPickerOptions(statusSnapshot.mowers);
  const activeMower = statusSnapshot.mowers.find((mower) => mower.id === selectedMowerId) ?? statusSnapshot.mowers[0];
  const summaries = getSelectedSessionSummaries();
  const activeSummary = resolveSelectedSessionSummary(summaries);

  populateSessionSelect(summaries);
  updateBattery(activeMower.batteryPercent);
  setActivityBadge(toTitleCase(activeMower.activity));
  if (activeMower.charging && activeMower.activity !== 'CHARGING') {
    activityBadge.textContent += ' (Charging)';
  }
  freshnessText.textContent = formatRelativeTime(activeMower.lastUpdate);
  sessionTitle.textContent = selectedSessionId === 'latest' ? 'Latest garden run' : 'Selected garden run';
  sessionSummary.textContent = activeMower.name
    ? `Showing coverage and recent path for ${activeMower.name}.`
    : 'Showing recent path and coverage heat from recorded mower positions.';

  return { mower: activeMower, summary: activeSummary };
}

function clearLayers() {
  if (heatLayer) {
    map.removeLayer(heatLayer);
    heatLayer = null;
  }

  if (recentLayer) {
    map.removeLayer(recentLayer);
    recentLayer = null;
  }
}

function renderHeatmap(heat, fitKey) {
  if (!heat.length) {
    boundsKey = null;
    return;
  }

  heatLayer = L.heatLayer(heat, {
    radius: 11,
    blur: 8,
    maxZoom: 20,
    gradient: gardenGradient
  }).addTo(map);

  if (boundsKey !== fitKey) {
    const latLngs = heat
      .map(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon) ? L.latLng(lat, lon) : null)
      .filter(Boolean);
    if (latLngs.length) {
      map.fitBounds(L.latLngBounds(latLngs), { padding: [28, 28] });
      boundsKey = fitKey;
    }
  }
}

function makeEndpointMarker(className, label) {
  return L.divIcon({
    className: `endpoint-marker ${className}`,
    html: `<span aria-hidden="true"></span><span class="visually-hidden">${label}</span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
}

function renderRecentPath(recent) {
  recentLayer = L.layerGroup();
  const polylinePoints = [];

  recent.forEach(([lat, lon]) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    L.circleMarker([lat, lon], {
      radius: 3,
      color: '#315f3c',
      weight: 1,
      fillColor: '#315f3c',
      fillOpacity: 0.85
    }).addTo(recentLayer);
    polylinePoints.push([lat, lon]);
  });

  if (polylinePoints.length > 1) {
    L.polyline(polylinePoints, {
      color: '#315f3c',
      weight: 2.5,
      dashArray: '7, 6',
      opacity: 0.72
    }).addTo(recentLayer);

    const startPoint = polylinePoints[polylinePoints.length - 1];
    const endPoint = polylinePoints[0];
    L.marker(startPoint, { icon: makeEndpointMarker('endpoint-marker--start', 'Session start') }).addTo(recentLayer);
    L.marker(endPoint, { icon: makeEndpointMarker('endpoint-marker--end', 'Latest mower position') }).addTo(recentLayer);
  }

  recentLayer.addTo(map);
}

async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error(`Status request failed: ${res.status}`);
    statusSnapshot = await res.json();
  } catch (err) {
    console.error(err);
  }
  return renderStatus();
}

async function loadData(statusContext = null) {
  const requestId = ++latestRequestId;
  const shouldShowSkeleton = !hasRenderedData;
  activeRequests += 1;
  setMapMessage('');
  setPanelLoading(shouldShowSkeleton);

  const params = new URLSearchParams();
  if (selectedMowerId) params.set('mowerId', selectedMowerId);
  const sessionToLoad = getEffectiveSessionId();
  if (sessionToLoad != null) params.set('sessionId', sessionToLoad);
  const url = params.toString().length ? `/api/positions?${params}` : '/api/positions';

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Positions request failed: ${res.status}`);

    const { heat = [], recent = [], session = null } = await res.json();
    if (requestId !== latestRequestId) return;

    const context = statusContext ?? renderStatus();
    const fitKey = `${selectedMowerId || 'all'}::${sessionToLoad ?? 'latest'}`;
    clearLayers();
    renderHeatmap(heat, fitKey);
    renderRecentPath(recent);
    renderSessionStats({ heat, recent, session, summary: context?.summary, mower: context?.mower });
    hasRenderedData = heat.length > 0;

    if (!heat.length) {
      setMapMessage('Waiting for mower position data');
      setStatusValue('Waiting for data');
    } else {
      setMapMessage('');
    }
  } catch (err) {
    console.error(err);
    if (requestId !== latestRequestId) return;

    if (!hasRenderedData) {
      clearLayers();
      renderSessionStats({ heat: [], recent: [], session: null, summary: null, mower: null });
    }
    setMapMessage('Could not load mower positions. Retrying soon.');
    setStatusValue('Update delayed');
    setActivityBadge('Update delayed');
    freshnessText.textContent = 'Update delayed';
  } finally {
    activeRequests = Math.max(0, activeRequests - 1);
    setPanelLoading(shouldShowSkeleton && activeRequests > 0);
  }
}

async function refreshAll() {
  const context = await fetchStatus();
  await loadData(context);
}

mowerPicker.addEventListener('change', () => {
  if (!mowerPicker.value) return;
  selectedMowerId = mowerPicker.value;
  selectedSessionId = 'latest';
  resetMapFit();
  const context = renderStatus();
  loadData(context);
});

sessionSelect.addEventListener('change', () => {
  if (suppressSessionChange) return;
  selectedSessionId = sessionSelect.value;
  resetMapFit();
  const context = renderStatus();
  loadData(context);
});

refreshAll();
setInterval(refreshAll, STATUS_POLL_MS);
