// ── CONFIG — swap these before pushing to GitHub ─────────────────────────
mapboxgl.accessToken = 'pk.eyJ1IjoiY29sZS1oYWRkb2NrIiwiYSI6ImNtbWtxbWRzaTF0ZWEycHByYmhxanVydGsifQ.BeBPsJNRNCmbHeqcaN35-A';

const STYLE_URL = 'mapbox://styles/mapbox/light-v11';  // swap for your custom style later

const DOTS_URL  = 'data/all_posting_dots_corrected.geojson';
const LINES_URL = 'data/combined_verified_sweeps.geojson';

// ── State ─────────────────────────────────────────────────────────────────
let selectedLocationId = null;  // unique_location_id of clicked dot's location
let selectedPostingId  = null;  // posting_id of the clicked dot
let selectedSweepId    = null;  // sweep_event_id of clicked dot
let activeFilter          = 'all';
let allDotFeatures        = [];    // stashed on load for count resets
let postingIdToGeomLoc    = {};    // fallback: posting_id → geometry location string
let focusMode             = true;  // when true, dots hide on location select
let geomByLocation        = {};    // location string → geometry feature (for district/zone fallback)

// ── Geometry-type filter constants ────────────────────────────────────────
const IS_LINE = ['==', ['geometry-type'], 'LineString'];
const IS_POLY = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
const NOMATCH  = ['==', ['get', 'location'], '!!NOMATCH!!'];

// ── Map init ──────────────────────────────────────────────────────────────
const map = new mapboxgl.Map({
  container: 'map',
  style: STYLE_URL,
  center: [-122.2712, 37.8044],
  zoom: 12,
  minZoom: 10,
  maxZoom: 18,
});

map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

// ── Search box ────────────────────────────────────────────────────────────
// Runs after Search JS script has loaded
window.addEventListener('load', () => {
  const searchBox = document.getElementById('search-box');
  if (!searchBox) return;
  searchBox.accessToken = mapboxgl.accessToken;
  searchBox.options = {
    language:  'en',
    country:   'US',
    proximity: { lng: -122.2712, lat: 37.8044 },  // bias toward Oakland
  };
  searchBox.bindMap(map);
});

// ── Load data and build layers ────────────────────────────────────────────
map.on('load', async () => {

  // Fetch both files in parallel
  const [dotsResp, linesResp] = await Promise.all([
    fetch(DOTS_URL),
    fetch(LINES_URL),
  ]);

  const dotsGJ  = await dotsResp.json();
  const linesGJ = await linesResp.json();

  // Stash original features for filter count
  allDotFeatures = dotsGJ.features;
  updateDotCount(allDotFeatures.length);

  // Build posting_id → geometry location fallback for encoding mismatches
  linesGJ.features.forEach(f => {
    const loc = f.properties.location;
    parseSweepIds(f.properties.posting_ids).forEach(pid => {
      postingIdToGeomLoc[String(pid)] = loc;
    });
  });

  // ── Sources ────────────────────────────────────────────────────────────
  map.addSource('lines', { type: 'geojson', data: linesGJ });
  map.addSource('dots',  { type: 'geojson', data: dotsGJ  });

  // ── LAYER 1: Base line segments — light gray, always visible ───────────
  map.addLayer({
    id: 'lines-base',
    type: 'line',
    source: 'lines',
    filter: IS_LINE,
    paint: {
      'line-color': '#b5aeae',
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        10, 1.5,
        14, 3,
        16, 5,
      ],
      'line-opacity': 0.7,
    },
  });

  // ── LAYER 2: Co-sweep highlight — orange, hidden by default ───────────
  map.addLayer({
    id: 'lines-sweep-highlight',
    type: 'line',
    source: 'lines',
    filter: ['all', IS_LINE, NOMATCH],
    paint: {
      'line-color': '#ac0000',
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        10, 3,
        14, 6,
        16, 9,
      ],
      'line-opacity': 0.85,
    },
  });

  // ── LAYER 3: Selected location highlight — red, hidden by default ──────
  map.addLayer({
    id: 'lines-selected-highlight',
    type: 'line',
    source: 'lines',
    filter: ['all', IS_LINE, NOMATCH],
    paint: {
      'line-color': '#5d0000',
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        10, 4,
        14, 7,
        16, 10,
      ],
      'line-opacity': 1,
    },
  });

  // ── LAYER 4: Base polygon fills — light gray, always visible ──────────
  map.addLayer({
    id: 'polygons-base',
    type: 'fill',
    source: 'lines',
    filter: IS_POLY,
    paint: {
      'fill-color': '#b5aeae',
      'fill-opacity': 0.4,
      'fill-outline-color': '#b5aeae',
    },
  });

  // ── LAYER 5: Co-sweep polygon highlight — orange, hidden by default ────
  map.addLayer({
    id: 'polygons-sweep-highlight',
    type: 'fill',
    source: 'lines',
    filter: ['all', IS_POLY, NOMATCH],
    paint: {
      'fill-color': '#ac0000',
      'fill-opacity': 0.55,
      'fill-outline-color': '#ac0000',
    },
  });

  // ── LAYER 6: Selected polygon highlight — red, hidden by default ───────
  map.addLayer({
    id: 'polygons-selected-highlight',
    type: 'fill',
    source: 'lines',
    filter: ['all', IS_POLY, NOMATCH],
    paint: {
      'fill-color': '#5d0000',
      'fill-opacity': 0.7,
      'fill-outline-color': '#5d0000',
    },
  });

  // ── LAYER 7: Dots — colored by intervention type ──────────────────────
  // Closure → red, Deep Cleaning → blue, Other/mixed → gray
  map.addLayer({
    id: 'dots-layer',
    type: 'circle',
    source: 'dots',
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        10, 3,
        13, 5,
        16, 8,
      ],
      'circle-color': [
        'case',
        ['in', 'Closure', ['get', 'intervention']], '#ac0000',
        ['in', 'Deep Clean', ['get', 'intervention']], '#5c2d6e',
        '#6b6464',
      ],
      'circle-opacity': 0.7,
      'circle-stroke-width': ['case', ['boolean', ['get', 'is_clicked'], false], 1.5, 0],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-opacity': 0.85,
    },
  });

  // ── LAYER 5: Selected dot ring — highlights clicked dot ────────────────
  map.addLayer({
    id: 'dots-selected-ring',
    type: 'circle',
    source: 'dots',
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        10, 7,
        13, 10,
        16, 14,
      ],
      'circle-color': 'transparent',
      'circle-stroke-width': 2.5,
      'circle-stroke-color': '#ac0000',
      'circle-opacity': 0,
    },
    filter: ['==', ['get', 'posting_id'], -1],  // hidden by default
  });

  // ── Cursor changes ─────────────────────────────────────────────────────
  ['dots-layer', 'lines-base', 'polygons-base'].forEach(layer => {
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
  });

  // ── Click a dot ────────────────────────────────────────────────────────
  map.on('click', 'dots-layer', e => {
    e.preventDefault();
    handleDotClick(e.features[0].properties);
  });

  // ── Click a line or polygon → find a matching dot and open sidebar ─────
  ['lines-base', 'polygons-base'].forEach(layer => {
    map.on('click', layer, e => {
      e.preventDefault();
      // If dots are currently visible at this point, let the dot handler take precedence
      const dotsHere = map.queryRenderedFeatures(e.point, { layers: ['dots-layer'] });
      const dotsVisible = !focusMode || selectedLocationId === null;
      if (dotsVisible && dotsHere.length > 0) return;

      // Pick the smallest polygon/line at this point by bounding box area
      const hits = map.queryRenderedFeatures(e.point, { layers: ['lines-base', 'polygons-base'] });
      const smallest = hits.reduce((best, f) => {
        const coords = f.geometry.type === 'MultiPolygon'
          ? f.geometry.coordinates.flat(2)
          : f.geometry.type === 'Polygon'
            ? f.geometry.coordinates.flat(1)
            : f.geometry.coordinates;  // LineString: already [[lng, lat], ...]
        const lons = coords.map(c => c[0]);
        const lats = coords.map(c => c[1]);
        const area = (Math.max(...lons) - Math.min(...lons)) * (Math.max(...lats) - Math.min(...lats));
        return (!best || area < best.area) ? { f, area } : best;
      }, null);

      if (!smallest) return;
      const location = smallest.f.properties.location;
      let match = allDotFeatures.find(f => f.properties.location === location);
      if (!match) {
        const pids = new Set(parseSweepIds(smallest.f.properties.posting_ids).map(String));
        match = allDotFeatures.find(f => pids.has(String(f.properties.posting_id)));
      }
      if (match) handleDotClick(match.properties);
    });
  });

  // ── Click map background → reset ───────────────────────────────────────
  map.on('click', e => {
    const hits = map.queryRenderedFeatures(e.point, {
      layers: ['dots-layer', 'lines-base', 'polygons-base'],
    });
    if (hits.length === 0) closeSidebar();
  });

});

// ── Handle dot click ──────────────────────────────────────────────────────
function handleDotClick(props) {
  const locId    = props.unique_location_id;
  const postId   = props.posting_id;
  const sweepId  = props.sweep_event_id;
  const location = props.location;

  selectedLocationId = locId;
  selectedPostingId  = postId;
  selectedSweepId    = sweepId;

  // 1. Highlight selected line/polygon red
  // Use posting_id lookup as fallback for encoding-mismatched location strings
  const geomLocation = postingIdToGeomLoc[String(postId)] || location;
  const locMatch = ['==', ['get', 'location'], geomLocation];
  map.setFilter('lines-selected-highlight',    ['all', IS_LINE, locMatch]);
  map.setFilter('polygons-selected-highlight', ['all', IS_POLY, locMatch]);

  // 2. Highlight co-sweep lines/polygons
  const coSweepLocations = getCoSweepLocations(sweepId, geomLocation);
  applyCoSweepHighlights(coSweepLocations);

  // 3. Show ring on clicked dot
  map.setFilter('dots-selected-ring', [
    '==', ['get', 'posting_id'], postId
  ]);

  // 4. Offset dots at this location + co-sweep locations to clicked positions
  offsetDotsForLocation(locId, sweepId);

  // 5. Hide dots if focus mode is on
  if (focusMode) hideDots(); else showDots();

  // 6. Build and open sidebar
  buildSidebar(locId, postId, props);
  document.getElementById('sidebar').classList.add('open');
}

// ── Get co-sweep location names for a given sweep event ───────────────────
function getCoSweepLocations(sweepId, excludeLocation) {
  const allLines = map.getSource('lines')._data.features;
  return allLines
    .filter(f => {
      if (f.properties.location === excludeLocation) return false;
      return parseSweepIds(f.properties.sweep_event_ids).includes(sweepId);
    })
    .map(f => f.properties.location);
}

// ── Apply co-sweep highlights to lines/polygon layers ─────────────────────
function applyCoSweepHighlights(coSweepLocations) {
  if (coSweepLocations.length > 0) {
    const inLocs = ['in', ['get', 'location'], ['literal', coSweepLocations]];
    map.setFilter('lines-sweep-highlight',    ['all', IS_LINE, inLocs]);
    map.setFilter('polygons-sweep-highlight', ['all', IS_POLY, inLocs]);
  } else {
    map.setFilter('lines-sweep-highlight',    ['all', IS_LINE, NOMATCH]);
    map.setFilter('polygons-sweep-highlight', ['all', IS_POLY, NOMATCH]);
  }
}

// ── Parse sweep_event_ids field (handles array or Python string) ──────────
function parseSweepIds(val) {
  if (Array.isArray(val)) return val;
  if (typeof val !== 'string') return [];
  // Handle JSON array string: '["2_12", "2_13"]'
  try { return JSON.parse(val); } catch {}
  // Handle Python-style: "['2_12', '2_13']" or "[ '2_12' '2_13']"
  return val
    .replace(/[\[\]'"\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// ── Update dot clicked state without resetting unaffected dots ────────────
function offsetDotsForLocation(locId, sweepId) {
  const source   = map.getSource('dots');
  const features = source._data.features;

  const coSweepLocIds = new Set(
    features
      .filter(f => f.properties.sweep_event_id === sweepId && f.properties.unique_location_id !== locId)
      .map(f => f.properties.unique_location_id)
  );

  const updated = {
    ...source._data,
    features: features.map(f => {
      const p          = f.properties;
      const shouldClick = p.unique_location_id === locId || coSweepLocIds.has(p.unique_location_id);
      const isClicked   = !!p.is_clicked;

      if (shouldClick && !isClicked) {
        return {
          ...f,
          properties: { ...p, is_clicked: true },
          geometry: { type: 'Point', coordinates: [p.clicked_lon, p.clicked_lat] },
        };
      }
      if (!shouldClick && isClicked) {
        return {
          ...f,
          properties: { ...p, is_clicked: false },
          geometry: { type: 'Point', coordinates: [p.load_lon, p.load_lat] },
        };
      }
      return f;
    }),
  };

  source.setData(updated);
}

// ── Reset all dots back to their load positions ───────────────────────────
function resetDotPositions() {
  const source  = map.getSource('dots');
  if (!source) return;
  const current = source._data;

  const updated = {
    ...current,
    features: current.features.map(f => ({
      ...f,
      properties: { ...f.properties, is_clicked: false },
      geometry: {
        type: 'Point',
        coordinates: [f.properties.load_lon, f.properties.load_lat],
      },
    })),
  };

  source.setData(updated);
}

// ── Build sidebar table ───────────────────────────────────────────────────
function buildSidebar(locId, activePostId, clickedProps) {
  // Pull all dots for this location from the source
  const source   = map.getSource('dots');
  const features = source._data.features.filter(
    f => f.properties.unique_location_id === locId
  );

  // Sort by date ascending
  features.sort((a, b) =>
    new Date(a.properties.operation_start_date) -
    new Date(b.properties.operation_start_date)
  );

  const uniqueOps = new Set(features.map(f => f.properties.sweep_event_id)).size;

  // Fall back to geometry feature for district/sensitivity_zone if dot is missing them
  let district        = clickedProps.district;
  let sensitivityZone = clickedProps.sensitivity_zone;
  if (!district || !sensitivityZone) {
    const geomLoc  = postingIdToGeomLoc[String(clickedProps.posting_id)] || clickedProps.location;
    const geomFeat = map.getSource('lines')._data.features.find(f => f.properties.location === geomLoc);
    if (geomFeat) {
      const dedup = val => {
        if (!val) return null;
        if (Array.isArray(val)) return [...new Set(val)].join(', ');
        return [...new Set(val.split(',').map(s => s.trim()))].join(', ');
      };
      district        = district        || dedup(geomFeat.properties.district);
      sensitivityZone = sensitivityZone || dedup(geomFeat.properties.sensitivity_zone);
    }
  }

  // Location header
  document.getElementById('sb-location').textContent = clickedProps.location;
  document.getElementById('sb-count').textContent    = features.length;
  document.getElementById('sb-ops').textContent      = uniqueOps;

  // Meta chips
  document.getElementById('sb-meta').innerHTML = `
    <span class="meta-chip district">${district || '—'}</span>
    <span class="meta-chip">${sensitivityZone || '—'}</span>
  `;

  // Assign alternating band per sweep event (in order of first appearance)
  const sweepBand = {};
  let bandCounter = 0;
  features.forEach(f => {
    const sid = f.properties.sweep_event_id;
    if (sid && !(sid in sweepBand)) sweepBand[sid] = bandCounter++ % 2;
  });

  // Compute per-sweep stats from the full dataset (all locations, not just this one)
  const sweepStats = {};
  allDotFeatures.forEach(f => {
    const p   = f.properties;
    const sid = p.sweep_event_id;
    if (!sid) return;
    if (!sweepStats[sid]) sweepStats[sid] = { min: null, max: null, postings: 0, locs: new Set() };
    const s = new Date(p.operation_start_date);
    const e = new Date(p.operation_end_date);
    if (!sweepStats[sid].min || s < sweepStats[sid].min) sweepStats[sid].min = s;
    if (!sweepStats[sid].max || e > sweepStats[sid].max) sweepStats[sid].max = e;
    sweepStats[sid].postings++;
    sweepStats[sid].locs.add(p.unique_location_id);
  });

  // ── Postings table
  const tbody = document.getElementById('sb-tbody');
  tbody.innerHTML = features.map(f => {
    const p        = f.properties;
    const sid      = p.sweep_event_id;
    const isActive = p.posting_id === activePostId;
    const start    = formatDate(p.operation_start_date);
    const end      = formatDate(p.operation_end_date);
    const dateStr  = start === end ? start : `${start} – ${end}`;
    const bandClass = isActive ? 'active-row' : `sweep-band-${sweepBand[sid] ?? 0}`;
    const stats    = sweepStats[sid];
    const opDays   = stats && stats.min
      ? Math.round((stats.max - stats.min) / 86400000) + 1
      : 1;

    return `
      <tr class="${bandClass}"
          data-posting-id="${p.posting_id}"
          data-band="${sweepBand[sid] ?? 0}"
          onclick="selectPostingFromTable(${p.posting_id}, ${locId})">
        <td class="td-dot-cell"><span class="td-dot" style="background:${interventionColor(p.intervention)};"></span></td>
        <td class="td-date">${dateStr}</td>
        <td class="td-intervention">${p.intervention || p.intervention_types || '—'}</td>
      </tr>
    `;
  }).join('');

  // ── Operations table — one row per unique sweep event at this location
  const opsTbody = document.getElementById('sb-ops-tbody');
  const sweepOrder = [...new Set(features.map(f => f.properties.sweep_event_id))];
  opsTbody.innerHTML = sweepOrder.map((sid, i) => {
    const stats   = sweepStats[sid];
    const opDays  = stats && stats.min
      ? Math.round((stats.max - stats.min) / 86400000) + 1
      : 1;
    const dateRange = stats && stats.min
      ? `${formatDate(stats.min.toISOString())} – ${formatDate(stats.max.toISOString())}`
      : '—';
    const bandClass = `sweep-band-${i % 2}`;
    return `
      <tr class="${bandClass}"
          data-sweep-id="${sid}"
          data-band="${i % 2}"
          onclick="selectOperationFromTable('${sid}', ${locId})">
        <td class="td-sweep-id">${sid || '—'}</td>
        <td class="td-date">${dateRange}</td>
        <td class="td-oplen">${opDays}d</td>
        <td class="td-oplen">${stats ? stats.postings : '—'}</td>
        <td class="td-oplen">${stats ? stats.locs.size : '—'}</td>
      </tr>
    `;
  }).join('');

  // Scroll active row into view
  setTimeout(() => {
    const activeRow = tbody.querySelector('.active-row');
    if (activeRow) activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, 50);
}

// ── Click a table row ─────────────────────────────────────────────────────
function selectPostingFromTable(postingId, locId) {
  selectedPostingId = postingId;

  // Look up this posting's sweep_event_id and location
  const feat = map.getSource('dots')._data.features
    .find(f => f.properties.posting_id === postingId);
  if (feat) {
    const sweepId  = feat.properties.sweep_event_id;
    const location = feat.properties.location;
    selectedSweepId = sweepId;
    const coSweepLocations = getCoSweepLocations(sweepId, location);
    applyCoSweepHighlights(coSweepLocations);
    offsetDotsForLocation(locId, sweepId);
  }

  // Move ring to this dot
  map.setFilter('dots-selected-ring', [
    '==', ['get', 'posting_id'], postingId
  ]);

  // Update active row in table, restoring band class on deactivated rows
  const tbody = document.getElementById('sb-tbody');
  tbody.querySelectorAll('tr').forEach(row => {
    const isActive = parseInt(row.dataset.postingId) === postingId;
    row.classList.toggle('active-row', isActive);
    if (!isActive) {
      const band = row.dataset.band;
      row.className = band ? `sweep-band-${band}` : 'sweep-band-0';
    }
  });

  // Scroll into view
  const activeRow = tbody.querySelector('.active-row');
  if (activeRow) activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ── Click an operation row ────────────────────────────────────────────────
function selectOperationFromTable(sweepId, locId) {
  selectedSweepId = sweepId;

  // Find the first posting at this location belonging to this sweep
  const feat = map.getSource('dots')._data.features
    .find(f => f.properties.unique_location_id === locId && f.properties.sweep_event_id === sweepId);

  if (feat) {
    const postingId = feat.properties.posting_id;
    const location  = feat.properties.location;
    selectedPostingId = postingId;
    const coSweepLocations = getCoSweepLocations(sweepId, location);
    applyCoSweepHighlights(coSweepLocations);
    offsetDotsForLocation(locId, sweepId);
    map.setFilter('dots-selected-ring', ['==', ['get', 'posting_id'], postingId]);

    // Sync active row in postings table
    const tbody = document.getElementById('sb-tbody');
    tbody.querySelectorAll('tr').forEach(row => {
      const isActive = parseInt(row.dataset.postingId) === postingId;
      row.classList.toggle('active-row', isActive);
      if (!isActive) {
        const band = row.dataset.band;
        row.className = band ? `sweep-band-${band}` : 'sweep-band-0';
      }
    });
    const activePosting = tbody.querySelector('.active-row');
    if (activePosting) activePosting.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Update active row in operations table
  const opsTbody = document.getElementById('sb-ops-tbody');
  opsTbody.querySelectorAll('tr').forEach(row => {
    const isActive = row.dataset.sweepId === sweepId;
    row.classList.toggle('active-row', isActive);
    if (!isActive) {
      const band = row.dataset.band;
      row.className = band ? `sweep-band-${band}` : 'sweep-band-0';
    }
  });
  const activeOp = opsTbody.querySelector('.active-row');
  if (activeOp) activeOp.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ── Close sidebar + reset everything ─────────────────────────────────────
function closeSidebar() {
  selectedLocationId = null;
  selectedPostingId  = null;
  selectedSweepId    = null;

  // Clear all highlights
  map.setFilter('lines-selected-highlight',    ['all', IS_LINE, NOMATCH]);
  map.setFilter('lines-sweep-highlight',       ['all', IS_LINE, NOMATCH]);
  map.setFilter('polygons-selected-highlight', ['all', IS_POLY, NOMATCH]);
  map.setFilter('polygons-sweep-highlight',    ['all', IS_POLY, NOMATCH]);
  map.setFilter('dots-selected-ring',          ['==', ['get', 'posting_id'], -1]);

  // Restore dots if focus mode hid them
  showDots();

  // Reset dots back to line positions
  resetDotPositions();

  // Close panel
  document.getElementById('sidebar').classList.remove('open');
}

function toggleFocusMode() {
  focusMode = !focusMode;
  const btn = document.getElementById('btn-focus');
  btn.classList.toggle('active', focusMode);
  btn.textContent = focusMode ? 'Dots Off' : 'Dots On';
  // If toggling off while a location is selected, restore dots
  if (!focusMode) showDots();
  // If toggling on while a location is selected, hide dots
  if (focusMode && selectedLocationId) hideDots();
}

function hideDots() {
  map.setPaintProperty('dots-layer', 'circle-opacity', 0);
  map.setPaintProperty('dots-layer', 'circle-stroke-opacity', 0);
  map.setPaintProperty('dots-selected-ring', 'circle-stroke-opacity', 0);
}

function showDots() {
  map.setPaintProperty('dots-layer', 'circle-opacity', 0.7);
  map.setPaintProperty('dots-layer', 'circle-stroke-opacity', 0.85);
  map.setPaintProperty('dots-selected-ring', 'circle-stroke-opacity', 1);
}

// ── Filter buttons ────────────────────────────────────────────────────────
function setFilter(type) {
  activeFilter = type;

  // Update button active states
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`btn-${type}`);
  if (btn) btn.classList.add('active');

  // Build Mapbox filter expression for dots layer
  let expr = null;
  switch (type) {
    case 'after':
      expr = ['==', ['get', 'before_after_grants_pass'], 'After'];
      break;
    case 'before':
      expr = ['==', ['get', 'before_after_grants_pass'], 'Before'];
      break;
    case 'closure':
      expr = ['in', 'Closure', ['downcase', ['get', 'intervention']]];
      break;
    case 'cleaning':
      expr = ['in', 'Deep Cleaning', ['get', 'intervention']];
      break;
    default:
      expr = null;  // show all
  }

  map.setFilter('dots-layer', expr);

  // Update count display
  // querySourceFeatures is approximate at current zoom — use full feature list for 'all'
  if (expr === null) {
    updateDotCount(allDotFeatures.length);
  } else {
    const visible = map.querySourceFeatures('dots', { filter: expr });
    updateDotCount(visible.length);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────
function interventionColor(intervention) {
  if (!intervention) return '#6b6464';
  if (intervention.includes('Closure'))    return '#ac0000';
  if (intervention.includes('Deep Clean')) return '#5c2d6e';
  return '#6b6464';
}

function formatDate(str) {
  if (!str) return '—';
  const d = new Date(str.includes('T') ? str : str + 'T00:00:00');
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day:   'numeric',
    year:  'numeric',
  });
}

function updateDotCount(n) {
  document.getElementById('dot-count').textContent =
    `${Number(n).toLocaleString()} postings`;
}