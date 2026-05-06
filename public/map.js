const gardenGradient = {
  0.2: 'rgba(131, 164, 113, 0.55)',
  0.45: '#7ea36a',
  0.7: '#d8b65f',
  1.0: '#df7f64'
};

const map = L.map('map', {
  zoomControl: true
}).setView([55.7, 13.2], 17);

let heatLayer = null;
let recentLayer = null;
let boundsFitted = false;

document.getElementById('activityBadge').textContent = 'Mowing now';
document.getElementById('freshnessText').textContent = 'Last updated just now';
document.getElementById('sessionTitle').textContent = 'Latest garden run';
document.getElementById('sessionSummary').textContent = 'Showing recent path and coverage heat from recorded mower positions.';

function setMapMessage(message) {
  const el = document.getElementById('mapMessage');
  el.hidden = !message;
  el.textContent = message || '';
}

function setPanelLoading(isLoading) {
  document.body.classList.toggle('is-loading', isLoading);
}

function setStatusValue(value) {
  document.getElementById('statusValue').textContent = value;
}

function updateBattery(pct) {
  const clamped = Math.max(0, Math.min(100, pct | 0));
  const level = document.getElementById('batteryLevel');
  const text = document.getElementById('batteryText');
  level.style.setProperty('--level', `${clamped}%`);
  level.dataset.state = clamped < 20 ? 'critical' : clamped < 50 ? 'attention' : 'normal';
  text.textContent = `${clamped}%`;
}

function renderSessionStats({ heat, recent }) {
  document.getElementById('pointsValue').textContent = heat.length ? heat.length.toLocaleString() : '-';
  document.getElementById('durationValue').textContent = recent.length > 1 ? 'Active' : '-';
  document.getElementById('startValue').textContent = recent.length ? 'Recorded' : '-';
  document.getElementById('endValue').textContent = recent.length ? 'Latest' : '-';
  document.getElementById('statusValue').textContent = heat.length ? 'Coverage data loaded' : 'Waiting for data';
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

function renderHeatmap(heat) {
  if (!heat.length) return;

  heatLayer = L.heatLayer(heat, {
    radius: 11,
    blur: 8,
    maxZoom: 20,
    gradient: gardenGradient
  }).addTo(map);

  if (!boundsFitted) {
    const latLngs = heat.map((point) => L.latLng(point[0], point[1]));
    map.fitBounds(L.latLngBounds(latLngs), { padding: [28, 28] });
    boundsFitted = true;
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

async function loadData() {
  setMapMessage('');
  setPanelLoading(true);

  try {
    const res = await fetch('/api/positions');
    if (!res.ok) throw new Error(`Positions request failed: ${res.status}`);

    const { heat = [], recent = [] } = await res.json();
    clearLayers();
    renderHeatmap(heat);
    renderRecentPath(recent);
    renderSessionStats({ heat, recent });

    if (!heat.length) {
      setMapMessage('Waiting for mower position data');
      setStatusValue('Waiting for data');
    } else {
      setStatusValue('Coverage data loaded');
    }

    document.getElementById('freshnessText').textContent = 'Last updated just now';
  } catch (err) {
    console.error(err);
    clearLayers();
    renderSessionStats({ heat: [], recent: [] });
    setMapMessage('Could not load mower positions. Retrying soon.');
    setStatusValue('Update delayed');
    document.getElementById('freshnessText').textContent = 'Update delayed';
  } finally {
    setPanelLoading(false);
  }
}

updateBattery(45);
loadData();
setInterval(loadData, 30000);
