import {
  DEFAULT_HEATMAP_SETTINGS,
  applyContributionStrength,
  buildGradient,
  buildHeatmapOptions,
  loadHeatmapSettings,
  normalizeHeatmapSettings,
  saveHeatmapSettings
} from './heatmapSettings.js';
import {
  getMowerTrim,
  loadMapOverlaySettings
} from './mapOverlaySettings.js';
import { projectMowerMap } from './mapProjection.js';

const REFRESH_FALLBACK_MS = 30000;

const map = L.map('map', {
  zoomControl: true
}).setView([55.7, 13.2], 17);
map.createPane('mowerMapPane');
map.getPane('mowerMapPane').style.zIndex = '425';

let heatLayer = null;
let recentLayer = null;
let messageLayer = null;
let mapOverlayLayer = null;
let latestMapPayload = null;
let latestMapRequestId = 0;
let mapOverlayMessage = '';
let mapOverlaySettings = loadMapOverlaySettings();
let activeRequests = 0;
let latestRequestId = 0;
let hasRenderedData = false;
let statusSnapshot = null;
let selectedMowerId = null;
let selectedSessionId = 'latest';
let boundsKey = null;
let suppressSessionChange = false;
let heatmapSettings = loadHeatmapSettings();
let draftHeatmapSettings = null;
let isConfigMode = false;
let latestHeat = [];
let latestFitKey = null;
let refreshFallbackTimer = null;
let refreshInFlight = null;

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
const eventLog = document.getElementById('eventLog');
const batteryLevel = document.getElementById('batteryLevel');
const batteryText = document.getElementById('batteryText');
const statusPanelContent = document.getElementById('statusPanelContent');
const configPanelContent = document.getElementById('configPanelContent');
const settingsButton = document.getElementById('settingsButton');
const settingsError = document.getElementById('settingsError');
const gradientPreview = document.getElementById('gradientPreview');
const heatColorLow = document.getElementById('heatColorLow');
const heatColorMedium = document.getElementById('heatColorMedium');
const heatColorHigh = document.getElementById('heatColorHigh');
const heatColorPeak = document.getElementById('heatColorPeak');
const softnessInput = document.getElementById('softnessInput');
const strengthInput = document.getElementById('strengthInput');
const resetSettingsButton = document.getElementById('resetSettingsButton');
const cancelSettingsButton = document.getElementById('cancelSettingsButton');
const saveSettingsButton = document.getElementById('saveSettingsButton');

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

function getSeverityIcon(severity) {
  if (severity === 'ERROR') return '!';
  if (severity === 'WARNING') return '!';
  return '';
}

function setMapMessage(message) {
  const el = document.getElementById('mapMessage');
  el.hidden = !message;
  el.textContent = message || '';
}

function setPanelLoading(isLoading) {
  document.body.classList.toggle('is-loading', isLoading);
}

function setActivityBadge(value) {
  activityBadge.textContent = value;
}

function resetMapFit() {
  boundsKey = null;
}

function setSettingsError(message) {
  settingsError.hidden = !message;
  settingsError.textContent = message || '';
}

function updateGradientPreview(settings) {
  const gradient = buildGradient(settings);
  gradientPreview.style.background = `linear-gradient(90deg, ${gradient[0.2]}, ${gradient[0.45]}, ${gradient[0.7]}, ${gradient[1.0]})`;
}

function renderSettingsControls(settings) {
  heatColorLow.value = settings.colors.low;
  heatColorMedium.value = settings.colors.medium;
  heatColorHigh.value = settings.colors.high;
  heatColorPeak.value = settings.colors.peak;
  softnessInput.value = String(settings.softness);
  strengthInput.value = String(settings.strength);
  updateGradientPreview(settings);
}

function readDraftFromControls() {
  return normalizeHeatmapSettings({
    version: 1,
    colors: {
      low: heatColorLow.value,
      medium: heatColorMedium.value,
      high: heatColorHigh.value,
      peak: heatColorPeak.value
    },
    softness: Number(softnessInput.value),
    strength: Number(strengthInput.value)
  });
}

function setPanelMode(mode) {
  isConfigMode = mode === 'config';
  statusPanelContent.hidden = isConfigMode;
  configPanelContent.hidden = !isConfigMode;
}

function enterConfigureMode() {
  draftHeatmapSettings = structuredClone(heatmapSettings);
  setSettingsError('');
  renderSettingsControls(draftHeatmapSettings);
  setPanelMode('config');
  heatColorLow.focus();
}

function previewDraftSettings() {
  draftHeatmapSettings = readDraftFromControls();
  renderSettingsControls(draftHeatmapSettings);
  redrawHeatmapPreview(draftHeatmapSettings);
}

function cancelConfigureMode() {
  draftHeatmapSettings = null;
  setSettingsError('');
  redrawHeatmapPreview(heatmapSettings);
  setPanelMode('status');
  settingsButton.focus();
}

function resetDraftSettings() {
  draftHeatmapSettings = structuredClone(DEFAULT_HEATMAP_SETTINGS);
  renderSettingsControls(draftHeatmapSettings);
  redrawHeatmapPreview(draftHeatmapSettings);
}

function saveConfigureMode() {
  try {
    heatmapSettings = saveHeatmapSettings(undefined, readDraftFromControls());
    draftHeatmapSettings = null;
    setSettingsError('');
    redrawHeatmapPreview(heatmapSettings);
    setPanelMode('status');
    settingsButton.focus();
  } catch (err) {
    console.error(err);
    setSettingsError('Could not save settings in this browser.');
  }
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

  pointsValue.textContent = Number.isFinite(displaySummary?.points)
    ? displaySummary.points.toLocaleString()
    : (heat.length ? heat.length.toLocaleString() : '-');
  durationValue.textContent = displaySummary
    ? formatDurationMinutes(displaySummary.durationMinutes)
    : formatDurationMs(session?.durationMs);
  startValue.textContent = formatTimestamp(displaySummary?.start ?? session?.start);
  endValue.textContent = formatTimestamp(displaySummary?.end ?? session?.end);
}

function renderEventLog(messages = []) {
  eventLog.innerHTML = '';

  if (!Array.isArray(messages) || messages.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'event-log__empty';
    empty.textContent = 'No mower messages recorded';
    eventLog.appendChild(empty);
    return;
  }

  messages.slice(0, 5).forEach((message) => {
    const row = document.createElement('div');
    row.className = 'event-row';

    const severity = document.createElement('span');
    severity.className = 'event-row__severity';
    const icon = getSeverityIcon(message.severity);
    severity.textContent = icon ? `${icon} ${message.severity}` : (message.severity ?? 'INFO');

    const time = document.createElement('time');
    time.className = 'event-row__time';
    time.dateTime = message.timestamp ?? '';
    time.textContent = formatTimestamp(message.timestamp);

    const code = document.createElement('span');
    code.className = 'event-row__code';
    code.textContent = message.code != null ? String(message.code) : '-';

    const description = document.createElement('span');
    description.className = 'event-row__message';
    description.textContent = message.description ?? 'Unknown message';

    row.append(severity, time, code, description);
    eventLog.appendChild(row);
  });
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
    renderEventLog([]);
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
  renderEventLog(activeMower.messages);

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

  if (messageLayer) {
    map.removeLayer(messageLayer);
    messageLayer = null;
  }
}

const mapLineStyles = {
  workingArea: { color: '#315f3c', weight: 2 },
  island: { color: '#a8493f', weight: 2 },
  guide: { color: '#2f6fbd', weight: 3 },
  station: { color: '#ad7a1f', weight: 3 }
};

function clearMapOverlay() {
  if (mapOverlayLayer) map.removeLayer(mapOverlayLayer);
  mapOverlayLayer = null;
  latestMapPayload = null;
}

function renderMapOverlay(payload, settings = mapOverlaySettings) {
  const projected = projectMowerMap(
    payload,
    getMowerTrim(settings, selectedMowerId)
  );
  const replacement = L.layerGroup();
  const options = (style) => ({
    ...style,
    fill: false,
    interactive: false,
    pane: 'mowerMapPane'
  });

  projected.workingAreas.forEach((area) => {
    L.polygon(area.latLngs, options(mapLineStyles.workingArea))
      .addTo(replacement);
  });
  projected.islands.forEach((island) => {
    L.polygon(island.latLngs, options(mapLineStyles.island))
      .addTo(replacement);
  });
  projected.guides.forEach((guide) => {
    L.polyline(guide.latLngs, options(mapLineStyles.guide))
      .addTo(replacement);
  });
  L.polyline(
    projected.chargingStationLine.latLngs,
    options(mapLineStyles.station)
  ).addTo(replacement);

  if (mapOverlayLayer) map.removeLayer(mapOverlayLayer);
  replacement.addTo(map);
  mapOverlayLayer = replacement;
  latestMapPayload = payload;
}

function redrawMapOverlayPreview(settings = mapOverlaySettings) {
  if (!latestMapPayload || latestMapPayload.status !== 'ready') return;
  renderMapOverlay(latestMapPayload, settings);
}

function renderHeatmap(heat, fitKey, settings = heatmapSettings) {
  latestHeat = heat;
  latestFitKey = fitKey;

  if (!heat.length) {
    boundsKey = null;
    return;
  }

  const adjustedHeat = applyContributionStrength(heat, settings);
  heatLayer = L.heatLayer(adjustedHeat, buildHeatmapOptions(settings)).addTo(map);

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

function redrawHeatmapPreview(settings) {
  if (heatLayer) {
    map.removeLayer(heatLayer);
    heatLayer = null;
  }
  renderHeatmap(latestHeat, latestFitKey, settings);
}

function makeEndpointMarker(className, label) {
  return L.divIcon({
    className: `endpoint-marker ${className}`,
    html: `<span aria-hidden="true"></span><span class="visually-hidden">${label}</span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
}

function makeMessageMarker(severity, icon) {
  const severityClass = severity === 'ERROR' ? 'message-marker--error' : 'message-marker--warning';
  const label = severity === 'ERROR' ? 'Error message location' : 'Warning message location';
  const markerShape = severity === 'ERROR'
    ? `<span class="message-marker__circle" aria-hidden="true">${icon}</span>`
    : `<svg class="message-marker__warning-icon" aria-hidden="true" viewBox="0 0 32 32" focusable="false">
        <path d="M16 3.5c.85 0 1.65.46 2.1 1.25l12.15 21.05c.9 1.56-.22 3.5-2.1 3.5H3.85c-1.88 0-3-1.94-2.1-3.5L13.9 4.75A2.4 2.4 0 0 1 16 3.5Z"></path>
        <line x1="16" y1="12" x2="16" y2="19.5"></line>
        <circle cx="16" cy="24" r="1.55"></circle>
      </svg>`;
  return L.divIcon({
    className: `message-marker ${severityClass}`,
    html: `${markerShape}<span class="visually-hidden">${label}</span>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
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

function renderMessageMarkers(messages = []) {
  messageLayer = L.layerGroup();

  messages.forEach((message) => {
    const lat = Number(message.lat);
    const lon = Number(message.lon);
    const icon = getSeverityIcon(message.severity);
    if (!icon || !Number.isFinite(lat) || !Number.isFinite(lon)) return;

    L.marker([lat, lon], {
      icon: makeMessageMarker(message.severity, icon)
    }).addTo(messageLayer);
  });

  messageLayer.addTo(map);
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
    renderHeatmap(heat, fitKey, isConfigMode && draftHeatmapSettings ? draftHeatmapSettings : heatmapSettings);
    renderRecentPath(recent);
    renderMessageMarkers(context?.mower?.messages ?? []);
    renderSessionStats({ heat, recent, session, summary: context?.summary, mower: context?.mower });
    hasRenderedData = heat.length > 0;

    if (!heat.length) {
      setMapMessage('Waiting for mower position data');
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
    setActivityBadge('Update delayed');
    freshnessText.textContent = 'Update delayed';
  } finally {
    activeRequests = Math.max(0, activeRequests - 1);
    setPanelLoading(shouldShowSkeleton && activeRequests > 0);
  }
}

function overlayMessageFor(code) {
  if (code === 'MAP_NOT_AVAILABLE') {
    return 'No generated boundary map is available for this mower.';
  }
  if (code === 'MAP_INVALID') {
    return 'The generated boundary map could not be read.';
  }
  if (code === 'UNKNOWN_MOWER') {
    return 'Boundary map is unavailable for this mower.';
  }
  return 'Boundary map is temporarily unavailable.';
}

async function loadMapOverlay() {
  const requestId = ++latestMapRequestId;
  const mowerId = selectedMowerId;
  if (!mowerId) {
    clearMapOverlay();
    mapOverlayMessage = 'Select a mower to load its boundary map.';
    return;
  }

  try {
    const response = await fetch(
      `/api/mowers/${encodeURIComponent(selectedMowerId)}/map`
    );
    const payload = await response.json();
    if (requestId !== latestMapRequestId || mowerId !== selectedMowerId) return;
    if (!response.ok) {
      clearMapOverlay();
      mapOverlayMessage = overlayMessageFor(payload?.error?.code);
      return;
    }
    if (payload.status === 'anchor-unavailable') {
      clearMapOverlay();
      mapOverlayMessage = 'Boundary map is waiting for a completed return-home position.';
      return;
    }

    renderMapOverlay(payload);
    mapOverlayMessage = payload.stale
      ? 'Showing the last available boundary map.'
      : '';
  } catch (error) {
    console.error(error);
    if (requestId !== latestMapRequestId || mowerId !== selectedMowerId) return;
    clearMapOverlay();
    mapOverlayMessage = 'Boundary map is temporarily unavailable.';
  }
}

async function refreshAll() {
  const context = await fetchStatus();
  await Promise.all([loadData(context), loadMapOverlay()]);
}

function scheduleFallbackRefresh() {
  if (refreshFallbackTimer) clearTimeout(refreshFallbackTimer);
  refreshFallbackTimer = setTimeout(() => {
    refreshFromNotification();
  }, REFRESH_FALLBACK_MS);
}

async function refreshFromNotification() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = refreshAll()
    .catch((err) => {
      console.error(err);
    })
    .finally(() => {
      refreshInFlight = null;
      scheduleFallbackRefresh();
    });

  return refreshInFlight;
}

function startServerNotifications() {
  if (!('EventSource' in window)) {
    scheduleFallbackRefresh();
    return;
  }

  const events = new EventSource('/api/events');
  events.addEventListener('mower-data', () => {
    refreshFromNotification();
  });
  events.onerror = () => {
    scheduleFallbackRefresh();
  };
  scheduleFallbackRefresh();
}

mowerPicker.addEventListener('change', () => {
  if (!mowerPicker.value) return;
  latestMapRequestId += 1;
  clearMapOverlay();
  selectedMowerId = mowerPicker.value;
  selectedSessionId = 'latest';
  resetMapFit();
  const context = renderStatus();
  Promise.all([loadData(context), loadMapOverlay()]);
});

sessionSelect.addEventListener('change', () => {
  if (suppressSessionChange) return;
  selectedSessionId = sessionSelect.value;
  resetMapFit();
  const context = renderStatus();
  loadData(context);
});

settingsButton.addEventListener('click', enterConfigureMode);
cancelSettingsButton.addEventListener('click', cancelConfigureMode);
resetSettingsButton.addEventListener('click', resetDraftSettings);
saveSettingsButton.addEventListener('click', saveConfigureMode);

[
  heatColorLow,
  heatColorMedium,
  heatColorHigh,
  heatColorPeak,
  softnessInput,
  strengthInput
].forEach((input) => {
  input.addEventListener('input', previewDraftSettings);
});

refreshFromNotification();
startServerNotifications();
