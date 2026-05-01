if (document.referrer) {
  document.getElementById('intro-overlay').classList.add('hidden');
}

function toggleInfoTip(id) {
  const tip = document.getElementById(id);
  const btn = tip.previousElementSibling.querySelector('.ls-info-btn');
  const isVisible = tip.classList.toggle('visible');
  btn.classList.toggle('active', isVisible);
}

// ── CONFIG — swap these before pushing to GitHub ─────────────────────────
mapboxgl.accessToken = 'pk.eyJ1IjoiY29sZS1oYWRkb2NrIiwiYSI6ImNtbWtxbWRzaTF0ZWEycHByYmhxanVydGsifQ.BeBPsJNRNCmbHeqcaN35-A';

const STYLE_URL = 'mapbox://styles/mapbox/light-v11';  // swap for your custom style later

const DOTS_URL      = 'data/all_posting_dots_corrected.geojson';
const LINES_URL     = 'data/combined_verified_sweeps.geojson';
const DISTRICTS_URL = 'data/CouncilDistrict_20260422.geojson';
const CITY_URL      = 'data/City_Limits_20260422.geojson';

// ── State ─────────────────────────────────────────────────────────────────
let selectedLocationId = null;  // unique_location_id of clicked dot's location
let selectedPostingId  = null;  // posting_id of the clicked dot
let selectedSweepId    = null;  // sweep_event_id of clicked dot
let activeFilter          = 'all';
let dateFrom              = null;   // YYYY-MM-DD string or null
let dateTo                = null;   // YYYY-MM-DD string or null
let sensitivityFilter     = new Set();  // 'High', 'Low', or both
let districtFilter        = new Set();  // '1'–'7', empty = all
let interventionFilter    = new Set();  // 'closure', 'cleaning', 'other', empty = all
let allDotFeatures        = [];    // stashed on load for count resets
let postingIdToGeomLoc    = {};    // fallback: posting_id → geometry location string
let focusMode             = true;  // when true, dots hide on location select
let geomByLocation        = {};    // location string → geometry feature (for district/zone fallback)
let drawingActive         = false;
let activeZonePolygon     = null;
let draw                  = null;
let animating             = false;
let animationInterval     = null;
let animationCurrentDate  = null;

// ── Geometry-type filter constants ────────────────────────────────────────
const IS_LINE = ['==', ['geometry-type'], 'LineString'];
const IS_POLY = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
const NOMATCH  = ['==', ['get', 'location'], '!!NOMATCH!!'];

const GP_DATE = '2024-06-28';  // Grants Pass v. Johnson decision date

const MAYOR_TERMS = [
  { id: 'mayor-schaaf',   start: '2015-01-05', end: '2023-01-09' },
  { id: 'mayor-thao',     start: '2023-01-09', end: '2024-12-17' },
  { id: 'mayor-bas',      start: '2024-12-17', end: '2025-01-06' },
  { id: 'mayor-jenkins',  start: '2025-01-06', end: '2025-05-20' },
  { id: 'mayor-lee',      start: '2025-05-20', end: '2099-12-31' },
];

// ── MapboxDraw styles (red to match site palette) ─────────────────────────
const DRAW_STYLES = [
  { id: 'gl-draw-polygon-fill-inactive',   type: 'fill',   filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']], paint: { 'fill-color': '#ac0000', 'fill-outline-color': '#ac0000', 'fill-opacity': 0.08 } },
  { id: 'gl-draw-polygon-fill-active',     type: 'fill',   filter: ['all', ['==', 'active', 'true'],  ['==', '$type', 'Polygon']], paint: { 'fill-color': '#ac0000', 'fill-outline-color': '#ac0000', 'fill-opacity': 0.12 } },
  { id: 'gl-draw-polygon-stroke-inactive', type: 'line',   filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']], paint: { 'line-color': '#ac0000', 'line-width': 2 } },
  { id: 'gl-draw-polygon-stroke-active',   type: 'line',   filter: ['all', ['==', 'active', 'true'],  ['==', '$type', 'Polygon']], paint: { 'line-color': '#ac0000', 'line-dasharray': [0.2, 2], 'line-width': 2 } },
  { id: 'gl-draw-line-active',             type: 'line',   filter: ['all', ['==', '$type', 'LineString'], ['==', 'active', 'true']], paint: { 'line-color': '#ac0000', 'line-dasharray': [0.2, 2], 'line-width': 2 } },
  { id: 'gl-draw-polygon-midpoint',        type: 'circle', filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'midpoint']], paint: { 'circle-radius': 3, 'circle-color': '#ac0000' } },
  { id: 'gl-draw-vertex-halo',             type: 'circle', filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']], paint: { 'circle-radius': 6, 'circle-color': '#fff' } },
  { id: 'gl-draw-vertex',                  type: 'circle', filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']], paint: { 'circle-radius': 4, 'circle-color': '#ac0000' } },
];

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
    proximity: { lng: -122.2712, lat: 37.8044 },
    bbox:      [-122.55, 37.60, -121.85, 37.95],   // restrict to East Bay
  };
  searchBox.bindMap(map);
});

// ── Load data and build layers ────────────────────────────────────────────
map.on('load', async () => {

  // Fetch all files in parallel
  const [dotsResp, linesResp, districtsResp, cityResp] = await Promise.all([
    fetch(DOTS_URL),
    fetch(LINES_URL),
    fetch(DISTRICTS_URL),
    fetch(CITY_URL),
  ]);

  const dotsGJ      = await dotsResp.json();
  const linesGJ     = await linesResp.json();
  const districtsGJ = await districtsResp.json();
  const cityGJ      = await cityResp.json();

  // Build posting_id → sweep properties lookup for patching missing fields
  const sweepByPostingId = {};
  linesGJ.features.forEach(f => {
    parseSweepIds(f.properties.posting_ids).forEach(pid => {
      if (!sweepByPostingId[pid]) sweepByPostingId[pid] = f.properties;
    });
  });

  // Patch dots missing sensitivity_zone or district from the sweep data
  dotsGJ.features = dotsGJ.features.map(f => {
    const p = f.properties;
    if (p.sensitivity_zone && p.district) return f;
    const sweep = sweepByPostingId[String(p.posting_id)];
    if (!sweep) return f;
    const dedup = val => {
      if (!val) return null;
      const parts = String(val).split(/[,|]/).map(s => s.trim()).filter(Boolean);
      return [...new Set(parts)].join(' | ');
    };
    return {
      ...f,
      properties: {
        ...p,
        sensitivity_zone: p.sensitivity_zone || dedup(sweep.sensitivity_zone),
        district:         p.district         || dedup(sweep.district),
      },
    };
  });

  // Stash original features for filter count
  allDotFeatures = dotsGJ.features;
  updateCounts(allDotFeatures);
  updateDistrictCounts();
  initAnimationDateInputs();

  // Build posting_id → geometry location fallback for encoding mismatches
  linesGJ.features.forEach(f => {
    const loc = f.properties.location;
    parseSweepIds(f.properties.posting_ids).forEach(pid => {
      postingIdToGeomLoc[String(pid)] = loc;
    });
  });

  // Tag each sweep feature with the earliest posting date via posting_id lookup
  const dotDateByPid = {};
  dotsGJ.features.forEach(f => {
    dotDateByPid[String(f.properties.posting_id)] =
      (f.properties.operation_start_date || '').slice(0, 10);
  });
  linesGJ.features = linesGJ.features.map(f => {
    const pids  = parseSweepIds(f.properties.posting_ids);
    const dates = pids.map(pid => dotDateByPid[String(pid)]).filter(Boolean).sort();
    return { ...f, properties: { ...f.properties, _min_posting_date: dates[0] || '' } };
  });

  // ── Sources ────────────────────────────────────────────────────────────
  map.addSource('city',      { type: 'geojson', data: cityGJ      });
  map.addSource('districts', { type: 'geojson', data: districtsGJ });
  map.addSource('lines',     { type: 'geojson', data: linesGJ });
  map.addSource('dots',      { type: 'geojson', data: dotsGJ  });

  // ── City boundary — dark outer border ────────────────────────────────
  map.addLayer({
    id: 'city-boundary',
    type: 'line',
    source: 'city',
    paint: {
      'line-color': '#888080',
      'line-width': 2,
      'line-opacity': 0.55,
    },
  });

  // ── District outline — subtle border, always visible ──────────────────
  map.addLayer({
    id: 'districts-outline',
    type: 'line',
    source: 'districts',
    paint: {
      'line-color': '#888080',
      'line-width': 1.5,
      'line-opacity': 0.3,
    },
  });

  // ── District fill — highlights active districts, hidden by default ─────
  map.addLayer({
    id: 'districts-fill',
    type: 'fill',
    source: 'districts',
    filter: ['==', ['get', 'name'], '!!NOMATCH!!'],
    paint: {
      'fill-color': '#ac0000',
      'fill-opacity': 0.08,
    },
  });

  // ── District active outline — stronger border for highlighted districts ─
  map.addLayer({
    id: 'districts-active-outline',
    type: 'line',
    source: 'districts',
    filter: ['==', ['get', 'name'], '!!NOMATCH!!'],
    paint: {
      'line-color': '#ac0000',
      'line-width': 2,
      'line-opacity': 0.6,
    },
  });

  // ── LAYER 1: Base line segments — light gray, always visible ───────────
  map.addLayer({
    id: 'lines-base',
    type: 'line',
    source: 'lines',
    filter: IS_LINE,
    paint: {
      'line-color': '#343131',
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        10, 1.5,
        14, 3,
        16, 5,
      ],
      'line-opacity': 0.45,
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
      'fill-color': '#343131',
      'fill-opacity': 0.2,
      'fill-outline-color': '#343131',
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
        ['==', ['get', 'intervention'], 'Closure'], '#ac0000',
        ['==', ['get', 'intervention'], 'Deep Cleaning'], '#5c2d6e',
        '#4a5568',
      ],
      'circle-opacity': 0.7,
      'circle-opacity-transition': { duration: 250, delay: 0 },
      'circle-stroke-width': ['case', ['boolean', ['get', 'is_clicked'], false], 1.5, 0],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-opacity': 0.85,
      'circle-stroke-opacity-transition': { duration: 250, delay: 0 },
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
      'circle-stroke-opacity-transition': { duration: 250, delay: 0 },
    },
    filter: ['==', ['get', 'posting_id'], -1],  // hidden by default
  });

  // ── Cursor changes ─────────────────────────────────────────────────────
  ['dots-layer', 'lines-base', 'polygons-base'].forEach(layer => {
    map.on('mouseenter', layer, () => { if (!drawingActive) map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layer, () => { if (!drawingActive) map.getCanvas().style.cursor = ''; });
  });

  // ── Click a dot ────────────────────────────────────────────────────────
  map.on('click', 'dots-layer', e => {
    if (drawingActive) return;
    e.preventDefault();
    handleDotClick(e.features[0].properties);
  });

  // ── Click a line or polygon → find a matching dot and open sidebar ─────
  ['lines-base', 'polygons-base'].forEach(layer => {
    map.on('click', layer, e => {
      if (drawingActive) return;
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
    if (drawingActive) return;
    closeContentPanel();
    const hits = map.queryRenderedFeatures(e.point, {
      layers: ['dots-layer', 'lines-base', 'polygons-base'],
    });
    if (hits.length === 0) { restoreLineFilter(); closeSidebar(); }
  });

  // ── Draw tool init ──────────────────────────────────────────────────────
  draw = new MapboxDraw({ displayControlsDefault: false, styles: DRAW_STYLES });
  map.addControl(draw);

  map.on('draw.create', e => { if (e.features[0]) finishDrawZone(e.features[0]); });

  // Enter closes the polygon; Escape cancels (MapboxDraw handles Escape internally,
  // but we need to sync our UI state when it does)
  document.addEventListener('keydown', e => {
    if (!drawingActive || e.key !== 'Enter') return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    draw.changeMode('simple_select');
  });

  map.on('draw.modechange', e => {
    if (drawingActive && e.mode === 'simple_select') {
      drawingActive = false;
      const btn = document.getElementById('btn-draw-zone');
      btn.textContent = activeZonePolygon ? 'Redraw Zone' : 'Draw Zone';
      btn.classList.remove('active');
    }
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

  // 4. Hide dots if focus mode is on — do this before any setData to avoid flash
  if (focusMode) hideDots(); else showDots();

  // 5. Offset dots only when visible — setData causes a one-frame flash at defined opacity
  if (!focusMode) offsetDotsForLocation(locId, sweepId);

  // 6. Build and open sidebar
  buildSidebar(locId, postId, props);
  requestAnimationFrame(() => {
    document.getElementById('sidebar').classList.add('open');
  });
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
    <span class="meta-chip">Sensitivity Zone: ${sensitivityZone || '—'}</span>
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
    const bandClass = isActive ? 'active-row' : `sweep-band-${sweepBand[sid] ?? 0}`;

    return `
      <tr class="${bandClass}"
          data-posting-id="${p.posting_id}"
          data-band="${sweepBand[sid] ?? 0}"
          onclick="selectPostingFromTable(${p.posting_id}, ${locId})">
        <td class="td-dot-cell"><span class="td-dot" style="background:${interventionColor(p.intervention)};"></span></td>
        <td class="td-date">${start}</td>
        <td class="td-date">${end}</td>
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
    const startStr = stats && stats.min ? formatDate(stats.min.toISOString()) : '—';
    const endStr   = stats && stats.max ? formatDate(stats.max.toISOString()) : '—';
    const bandClass = `sweep-band-${i % 2}`;
    return `
      <tr class="${bandClass}"
          data-sweep-id="${sid}"
          data-band="${i % 2}"
          onclick="selectOperationFromTable('${sid}', ${locId})">
        <td class="td-sweep-id">${sid || '—'}</td>
        <td class="td-date">${startStr}</td>
        <td class="td-date">${endStr}</td>
        <td class="td-oplen${opDays >= 10 ? ' td-oplen-long' : ''}">${opDays}</td>
        <td class="td-oplen${stats && stats.postings >= 10 ? ' td-oplen-long' : ''}">${stats ? stats.postings : '—'}</td>
        <td class="td-oplen">${stats ? stats.locs.size : '—'}</td>
      </tr>
    `;
  }).join('');

  // Scroll active posting into view and sync ops table
  setTimeout(() => {
    const activeRow = tbody.querySelector('.active-row');
    const activeFeat = features.find(f => f.properties.posting_id === activePostId);
    if (activeFeat) setActiveOpRow(activeFeat.properties.sweep_event_id);
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
    if (!focusMode) offsetDotsForLocation(locId, sweepId);
  }

  // Move ring to this dot
  map.setFilter('dots-selected-ring', [
    '==', ['get', 'posting_id'], postingId
  ]);

  // Update active row in postings table
  const tbody = document.getElementById('sb-tbody');
  tbody.querySelectorAll('tr').forEach(row => {
    const isActive = parseInt(row.dataset.postingId) === postingId;
    row.classList.toggle('active-row', isActive);
    if (!isActive) {
      const band = row.dataset.band;
      row.className = band ? `sweep-band-${band}` : 'sweep-band-0';
    }
  });
  const activeRow = tbody.querySelector('.active-row');

  // Sync active row in operations table to match this posting's sweep
  if (selectedSweepId) setActiveOpRow(selectedSweepId);
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
    if (!focusMode) offsetDotsForLocation(locId, sweepId);
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
  }

  setActiveOpRow(sweepId);
}

function setActiveOpRow(sweepId) {
  const opsTbody = document.getElementById('sb-ops-tbody');
  if (!opsTbody) return;
  opsTbody.querySelectorAll('tr').forEach(row => {
    const isActive = row.dataset.sweepId === String(sweepId);
    row.classList.toggle('active-row', isActive);
    if (!isActive) {
      const band = row.dataset.band;
      row.className = band ? `sweep-band-${band}` : 'sweep-band-0';
    }
  });
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

function toggleLegend() {
  document.getElementById('legend').classList.toggle('collapsed');
}

function toggleLeftSidebar() {
  document.getElementById('left-sidebar').classList.toggle('open');
}

function toggleFiltersPanel() {
  document.getElementById('filters-body').classList.toggle('closed');
  document.getElementById('filters-chevron').classList.toggle('closed');
}

function toggleMayorsPanel() {
  document.getElementById('mayors-body').classList.toggle('closed');
  document.getElementById('mayors-chevron').classList.toggle('closed');
}

function toggleDistrictsPanel() {
  document.getElementById('districts-body').classList.toggle('closed');
  document.getElementById('districts-chevron').classList.toggle('closed');
}

function toggleFocusMode() {
  focusMode = !focusMode;
  const btn = document.getElementById('btn-focus');
  btn.classList.toggle('active', focusMode);
  btn.textContent = focusMode ? 'See Posting Dots' : 'Hide Posting Dots';
  if (!focusMode) {
    showDots();
    if (selectedLocationId !== null) offsetDotsForLocation(selectedLocationId, selectedSweepId);
  }
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

// ── Mayor term helpers ────────────────────────────────────────────────────
function getCheckedMayors() {
  return MAYOR_TERMS.filter(m => {
    const el = document.getElementById(m.id);
    return el ? el.checked : true;
  });
}

function buildMayorFilter() {
  const checked = getCheckedMayors();
  if (checked.length === MAYOR_TERMS.length) return null;
  if (checked.length === 0) return ['==', ['literal', 1], 0];
  const ranges = checked.map(m => ['all',
    ['>=', ['slice', ['get', 'operation_start_date'], 0, 10], m.start],
    ['<',  ['slice', ['get', 'operation_start_date'], 0, 10], m.end],
  ]);
  return ranges.length === 1 ? ranges[0] : ['any', ...ranges];
}

// ── Build combined Mapbox filter expression ───────────────────────────────
function buildDotFilter() {
  const parts = [];

  switch (activeFilter) {
    case 'after':  parts.push(['>=', ['slice', ['get', 'operation_start_date'], 0, 10], GP_DATE]); break;
    case 'before': parts.push(['<',  ['slice', ['get', 'operation_start_date'], 0, 10], GP_DATE]); break;
    case 'closure':  parts.push(['==', ['get', 'intervention'], 'Closure']); break;
    case 'cleaning': parts.push(['==', ['get', 'intervention'], 'Deep Cleaning']); break;
  }

  if (dateFrom) parts.push(['>=', ['slice', ['get', 'operation_start_date'], 0, 10], dateFrom]);
  if (dateTo)   parts.push(['<=', ['slice', ['get', 'operation_start_date'], 0, 10], dateTo]);

  const mayorFilter = buildMayorFilter();
  if (mayorFilter) parts.push(mayorFilter);

  if (sensitivityFilter.size > 0) {
    const szParts = [...sensitivityFilter].map(sz => ['in', sz, ['get', 'sensitivity_zone']]);
    parts.push(szParts.length === 1 ? szParts[0] : ['any', ...szParts]);
  }

  if (districtFilter.size > 0) {
    const dParts = [...districtFilter].map(d => ['in', d, ['get', 'district']]);
    parts.push(dParts.length === 1 ? dParts[0] : ['any', ...dParts]);
  }

  if (interventionFilter.size > 0) {
    const ivParts = [];
    if (interventionFilter.has('closure'))  ivParts.push(['==', ['get', 'intervention'], 'Closure']);
    if (interventionFilter.has('cleaning')) ivParts.push(['==', ['get', 'intervention'], 'Deep Cleaning']);
    if (interventionFilter.has('other'))    ivParts.push(['all',
      ['!=', ['get', 'intervention'], 'Closure'],
      ['!=', ['get', 'intervention'], 'Deep Cleaning'],
    ]);
    parts.push(ivParts.length === 1 ? ivParts[0] : ['any', ...ivParts]);
  }

  if (activeZonePolygon) {
    parts.push(['within', activeZonePolygon.geometry]);
  }

  return parts.length === 0 ? null : parts.length === 1 ? parts[0] : ['all', ...parts];
}

// ── JS-side filter for count updates ─────────────────────────────────────
function applyJsFilter(features) {
  return features.filter(f => {
    const p = f.properties;
    const d = p.operation_start_date ? p.operation_start_date.slice(0, 10) : null;
    if (activeFilter === 'after'   && (!d || d <  GP_DATE)) return false;
    if (activeFilter === 'before'  && (!d || d >= GP_DATE)) return false;
    if (activeFilter === 'closure'  && p.intervention !== 'Closure')       return false;
    if (activeFilter === 'cleaning' && p.intervention !== 'Deep Cleaning') return false;
    if (dateFrom && d && d < dateFrom) return false;
    if (dateTo   && d && d > dateTo)   return false;
    const checked = getCheckedMayors();
    if (checked.length < MAYOR_TERMS.length && d) {
      if (!checked.some(m => d >= m.start && d < m.end)) return false;
    }
    if (sensitivityFilter.size > 0) {
      const sz = p.sensitivity_zone || '';
      if (![...sensitivityFilter].some(v => sz.includes(v))) return false;
    }
    if (districtFilter.size > 0) {
      const dist = p.district || '';
      if (![...districtFilter].some(v => dist.includes(v))) return false;
    }
    if (interventionFilter.size > 0) {
      const iv = p.intervention || '';
      const isClosure  = iv === 'Closure';
      const isCleaning = iv === 'Deep Cleaning';
      const isOther    = !isClosure && !isCleaning;
      const match =
        (interventionFilter.has('closure')  && isClosure)  ||
        (interventionFilter.has('cleaning') && isCleaning) ||
        (interventionFilter.has('other')    && isOther);
      if (!match) return false;
    }
    if (activeZonePolygon) {
      if (!turf.booleanPointInPolygon(f, activeZonePolygon)) return false;
    }
    return true;
  });
}

// ── Mayor checkbox filter ─────────────────────────────────────────────────
function applyMayorFilter() {
  map.setFilter('dots-layer', buildDotFilter());
  updateCounts(applyJsFilter(allDotFeatures));
  document.dispatchEvent(new Event('filtersChanged'));
}

// ── Intervention type filter ──────────────────────────────────────────────
function toggleIntervention(value) {
  if (interventionFilter.has(value)) {
    interventionFilter.delete(value);
  } else {
    interventionFilter.add(value);
  }
  document.getElementById('iv-closure').classList.toggle('active',  interventionFilter.has('closure'));
  document.getElementById('iv-cleaning').classList.toggle('active', interventionFilter.has('cleaning'));
  document.getElementById('iv-other').classList.toggle('active',    interventionFilter.has('other'));
  map.setFilter('dots-layer', buildDotFilter());
  updateCounts(applyJsFilter(allDotFeatures));
  document.dispatchEvent(new Event('filtersChanged'));
}

// ── Council district checkbox filter ─────────────────────────────────────
function applyDistrictFilter() {
  districtFilter.clear();
  [1, 2, 3, 4, 5, 6, 7].forEach(n => {
    const el = document.getElementById(`district-${n}`);
    if (el && el.checked) districtFilter.add(String(n));
  });
  if (districtFilter.size === 7) districtFilter.clear();  // all checked = no filter

  // Sync district highlight layers
  if (districtFilter.size > 0) {
    const ccdNames = [...districtFilter].map(n => `CCD${n}`);
    const f = ['in', ['get', 'name'], ['literal', ccdNames]];
    map.setFilter('districts-fill',          f);
    map.setFilter('districts-active-outline', f);
  } else {
    map.setFilter('districts-fill',          ['==', ['get', 'name'], '!!NOMATCH!!']);
    map.setFilter('districts-active-outline', ['==', ['get', 'name'], '!!NOMATCH!!']);
  }

  map.setFilter('dots-layer', buildDotFilter());
  updateCounts(applyJsFilter(allDotFeatures));
  document.dispatchEvent(new Event('filtersChanged'));
}

// ── Sensitivity zone filter ───────────────────────────────────────────────
function toggleSensitivityZone(value) {
  if (sensitivityFilter.has(value)) {
    sensitivityFilter.delete(value);
  } else {
    sensitivityFilter.add(value);
  }
  document.getElementById('sz-high').classList.toggle('active', sensitivityFilter.has('High'));
  document.getElementById('sz-low').classList.toggle('active',  sensitivityFilter.has('Low'));
  map.setFilter('dots-layer', buildDotFilter());
  updateCounts(applyJsFilter(allDotFeatures));
  document.dispatchEvent(new Event('filtersChanged'));
}

// ── Filter buttons ────────────────────────────────────────────────────────
function setFilter(type) {
  activeFilter = (activeFilter === type) ? 'all' : type;

  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`btn-${type}`);
  if (btn) btn.classList.add('active');

  document.getElementById('gp-before').classList.toggle('active', activeFilter === 'before');
  document.getElementById('gp-after').classList.toggle('active', activeFilter === 'after');

  map.setFilter('dots-layer', buildDotFilter());
  updateCounts(applyJsFilter(allDotFeatures));
  document.dispatchEvent(new Event('filtersChanged'));
}

// ── Date range filter ─────────────────────────────────────────────────────
function applyDateFilter() {
  dateFrom = document.getElementById('ls-date-from').value || null;
  dateTo   = document.getElementById('ls-date-to').value   || null;

  map.setFilter('dots-layer', buildDotFilter());
  updateCounts(applyJsFilter(allDotFeatures));
  document.dispatchEvent(new Event('filtersChanged'));
}

function resetFilters() {
  clearZone();
  finishAnimation();
  restoreLineFilter();
  dateFrom = null;
  dateTo   = null;
  const fromEl = document.getElementById('ls-date-from');
  const toEl   = document.getElementById('ls-date-to');
  if (fromEl) fromEl.value = '';
  if (toEl)   toEl.value   = '';
  MAYOR_TERMS.forEach(m => {
    const el = document.getElementById(m.id);
    if (el) el.checked = true;
  });
  sensitivityFilter.clear();
  document.getElementById('sz-high').classList.remove('active');
  document.getElementById('sz-low').classList.remove('active');
  districtFilter.clear();
  [1, 2, 3, 4, 5, 6, 7].forEach(n => {
    const el = document.getElementById(`district-${n}`);
    if (el) el.checked = false;
  });
  map.setFilter('districts-fill',           ['==', ['get', 'name'], '!!NOMATCH!!']);
  map.setFilter('districts-active-outline', ['==', ['get', 'name'], '!!NOMATCH!!']);
  interventionFilter.clear();
  document.getElementById('iv-closure').classList.remove('active');
  document.getElementById('iv-cleaning').classList.remove('active');
  document.getElementById('iv-other').classList.remove('active');
  setFilter('all');
}

// ── Animation ─────────────────────────────────────────────────────────────
function initAnimationDateInputs() {
  const { min, max } = getDatasetDateRange();

  // Restrict all four date pickers to the dataset's actual date range
  ['ls-date-from', 'ls-date-to', 'anim-date-from', 'anim-date-to'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.min = min;
    el.max = max;
  });

  const fromEl = document.getElementById('anim-date-from');
  const toEl   = document.getElementById('anim-date-to');
  if (fromEl && !fromEl.value) fromEl.value = min;
  if (toEl   && !toEl.value)   toEl.value   = max;
}

function getAnimBounds() {
  const { min, max } = getDatasetDateRange();
  return {
    from: document.getElementById('anim-date-from').value || min,
    to:   document.getElementById('anim-date-to').value   || max,
  };
}

function getDatasetDateRange() {
  const dates = allDotFeatures
    .map(f => f.properties.operation_start_date)
    .filter(Boolean)
    .map(d => d.slice(0, 10))
    .sort();
  return { min: dates[0], max: dates[dates.length - 1] };
}

function buildMonthlySteps(fromStr, toStr) {
  const steps = [];
  const end   = new Date(toStr + 'T00:00:00');
  const start = new Date(fromStr + 'T00:00:00');
  let year  = start.getFullYear();
  let month = start.getMonth();

  while (true) {
    const lastOfMonth = new Date(year, month + 1, 0);
    const stepDate    = lastOfMonth <= end ? lastOfMonth : end;
    steps.push(stepDate.toISOString().slice(0, 10));
    if (stepDate >= end) break;
    month++;
    if (month > 11) { month = 0; year++; }
  }
  return steps;
}

function updateAnimationDisplay(dateStr) {
  const el = document.getElementById('anim-date-display');
  if (!dateStr) { el.textContent = '—'; return; }
  const d = new Date(dateStr + 'T00:00:00');
  el.textContent = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function applyAnimationFilter() {
  const savedDateTo = dateTo;
  dateTo = null;
  const base = buildDotFilter();
  dateTo = savedDateTo;
  const upper = ['<=', ['slice', ['get', 'operation_start_date'], 0, 10], animationCurrentDate];
  map.setFilter('dots-layer', base ? ['all', base, upper] : upper);
}

function applyAnimLineFilter() {
  const savedDateTo = dateTo;
  dateTo = null;
  const visibleDots = applyJsFilter(allDotFeatures).filter(f => {
    const d = (f.properties.operation_start_date || '').slice(0, 10);
    return d && d <= animationCurrentDate;
  });
  dateTo = savedDateTo;

  const locs = [...new Set(
    visibleDots.map(f => postingIdToGeomLoc[String(f.properties.posting_id)] || f.properties.location)
  )].filter(Boolean);

  if (locs.length === 0) {
    map.setFilter('lines-sweep-highlight',    ['all', IS_LINE, NOMATCH]);
    map.setFilter('polygons-sweep-highlight', ['all', IS_POLY, NOMATCH]);
    return;
  }

  const locFilter = ['in', ['get', 'location'], ['literal', locs]];
  map.setFilter('lines-sweep-highlight',    ['all', IS_LINE, locFilter]);
  map.setFilter('polygons-sweep-highlight', ['all', IS_POLY, locFilter]);
}

function restoreLineFilter() {
  map.setFilter('lines-sweep-highlight',    ['all', IS_LINE, NOMATCH]);
  map.setFilter('polygons-sweep-highlight', ['all', IS_POLY, NOMATCH]);
}

function toggleAnimation() {
  animating ? pauseAnimation() : playAnimation();
}

function playAnimation() {
  const { from, to } = getAnimBounds();

  if (!animationCurrentDate || animationCurrentDate >= to) animationCurrentDate = from;

  const steps = buildMonthlySteps(animationCurrentDate, to);
  let stepIndex = 0;

  animating = true;
  document.getElementById('btn-anim-play').textContent = 'Pause';
  document.getElementById('btn-anim-play').classList.add('active');

  updateAnimationDisplay(animationCurrentDate);
  applyAnimationFilter();
  applyAnimLineFilter();

  animationInterval = setInterval(() => {
    stepIndex++;
    if (stepIndex >= steps.length) { finishAnimation(); return; }
    animationCurrentDate = steps[stepIndex];
    updateAnimationDisplay(animationCurrentDate);
    applyAnimationFilter();
    applyAnimLineFilter();
  }, 250);
}

function pauseAnimation() {
  clearInterval(animationInterval);
  animationInterval = null;
  animating = false;
  document.getElementById('btn-anim-play').textContent = 'Play';
  document.getElementById('btn-anim-play').classList.remove('active');
}

function finishAnimation() {
  pauseAnimation();
  animationCurrentDate = null;
  updateAnimationDisplay(null);
  map.setFilter('dots-layer', buildDotFilter());
  updateCounts(applyJsFilter(allDotFeatures));
  document.dispatchEvent(new Event('filtersChanged'));
}

function animSeekStart() {
  if (animating) pauseAnimation();
  animationCurrentDate = getAnimBounds().from;
  updateAnimationDisplay(animationCurrentDate);
  applyAnimationFilter();
}

function animSeekEnd() {
  if (animating) pauseAnimation();
  animationCurrentDate = getAnimBounds().to;
  updateAnimationDisplay(animationCurrentDate);
  applyAnimationFilter();
}

// ── Zone draw functions ───────────────────────────────────────────────────
function toggleDrawZone() {
  drawingActive ? cancelDrawZone() : startDrawZone();
}

function startDrawZone() {
  draw.deleteAll();
  activeZonePolygon = null;
  document.getElementById('zone-results').classList.remove('visible');
  document.getElementById('btn-draw-zone').textContent = 'Draw polygon then press Enter';
  document.getElementById('btn-draw-zone').classList.add('active');
  drawingActive = true;
  draw.changeMode('draw_polygon');
}

function cancelDrawZone() {
  drawingActive = false;
  draw.changeMode('simple_select');
  document.getElementById('btn-draw-zone').textContent = 'Draw Zone';
  document.getElementById('btn-draw-zone').classList.remove('active');
}

function clearZone() {
  if (!draw) return;
  draw.deleteAll();
  activeZonePolygon = null;
  cancelDrawZone();
  document.getElementById('zone-results').classList.remove('visible');
  map.setFilter('dots-layer', buildDotFilter());
  updateCounts(applyJsFilter(allDotFeatures));
  document.dispatchEvent(new Event('filtersChanged'));
}

function finishDrawZone(polygon) {
  activeZonePolygon = polygon;
  drawingActive = false;
  document.getElementById('btn-draw-zone').textContent = 'Redraw Zone';
  document.getElementById('btn-draw-zone').classList.remove('active');
  map.setFilter('dots-layer', buildDotFilter());
  updateCounts(applyJsFilter(allDotFeatures));
  document.dispatchEvent(new Event('filtersChanged'));
  computeZoneStats(polygon);
}

function computeZoneStats(polygon) {
  const filtered = applyJsFilter(allDotFeatures);
  const within   = turf.pointsWithinPolygon(turf.featureCollection(filtered), polygon);
  const features = within.features;

  const postings  = features.length;
  const ops       = new Set(features.map(f => f.properties.sweep_event_id).filter(Boolean)).size;
  const closures  = features.filter(f => f.properties.intervention === 'Closure').length;
  const cleanings = features.filter(f => f.properties.intervention === 'Deep Cleaning').length;
  const other     = features.filter(f => f.properties.intervention !== 'Closure' && f.properties.intervention !== 'Deep Cleaning').length;

  document.getElementById('zone-postings').textContent  = postings.toLocaleString();
  document.getElementById('zone-ops').textContent       = ops.toLocaleString();
  document.getElementById('zone-closures').textContent  = closures.toLocaleString();
  document.getElementById('zone-cleanings').textContent = cleanings.toLocaleString();
  document.getElementById('zone-other').textContent     = other.toLocaleString();
  document.getElementById('zone-results').classList.add('visible');
}

function refreshZoneIfActive() {
  if (activeZonePolygon) computeZoneStats(activeZonePolygon);
}

// ── Helpers ───────────────────────────────────────────────────────────────
function interventionColor(intervention) {
  if (intervention === 'Closure')      return '#ac0000';
  if (intervention === 'Deep Cleaning') return '#5c2d6e';
  return '#4a5568';
}

function formatDate(str) {
  if (!str) return '—';
  const d = new Date(str.includes('T') ? str : str + 'T00:00:00');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm} - ${dd} - ${yyyy}`;
}

function updateCounts(features) {
  refreshZoneIfActive();
  const postings = features.length;
  const ops = new Set(features.map(f => f.properties.sweep_event_id).filter(Boolean)).size;
  document.getElementById('dot-count').textContent = Number(postings).toLocaleString();
  document.getElementById('op-count').textContent  = Number(ops).toLocaleString();

  const dates = features
    .map(f => f.properties.operation_start_date)
    .filter(Boolean)
    .map(d => d.slice(0, 10))
    .sort();
  if (dates.length) {
    const fmt = d => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    document.getElementById('date-range').textContent = `${fmt(dates[0])}  —  ${fmt(dates[dates.length - 1])}`;
  } else {
    document.getElementById('date-range').textContent = '—';
  }
}

// ── District posting counts ───────────────────────────────────────────────
function updateDistrictCounts() {
  [1, 2, 3, 4, 5, 6, 7].forEach(n => {
    const count = allDotFeatures.filter(f =>
      (f.properties.district || '').includes(String(n))
    ).length;
    const el = document.getElementById(`district-count-${n}`);
    if (el) el.textContent = count.toLocaleString();
  });
}

// ── Content panel ─────────────────────────────────────────────────────────
function openOralHistoriesPanel() {
  const panel = document.getElementById('content-panel');
  const body  = document.getElementById('content-panel-body');
  body.innerHTML = `
    <div class="cp-title">Oral Histories</div>
    <p class="cp-p">Street Spirit is in the process of archiving testimonies from people who have been present at sweeps, including residents, activists, and others.</p>
    <a class="cp-submit-btn" href="https://docs.google.com/forms/d/e/1FAIpQLSffifZMZL6kkHMTVJLlKq2mVQRgCYWXfK87klzgFxLQYEogQw/viewform?usp=dialog" target="_blank" rel="noopener">Submit Oral Histories</a>
    <div class="cp-section-header">Evicting sweeping towing<br><span class="cp-section-by">by Tiny Gray-Garcia of POOR Magazine</span></div>
    <div class="cp-poem">Evicting towing sweeping killing
Evicting deporting /stealing hoarding
Sweeping evicting towing killing
Towing sweeping evicting drilling
This is a colonial desecration song
Written through centuries of colonial wrongs
Carved in blood of indigenous moms
Bled into false settler colonial borders and walls
Incarcerated with white supremacist laws

Until there's only bones
Of roofless homes
Car parts
And broken shopping carts
And payday loans
And police and ICE drones

The desecration the destruction the eruptions
Get out of that tiny house
U don't even deserve

Evicting sweeping towing killing
Evicting sweeping towing drilling
Evicting deporting /stealing hoarding

Our blood is spilling
Poor and houseless Families towed and swept and barely living Over land already stolen
Taken so u could keep making more
Broken souls with broken hearts with holes in them
What about Homefulness?
What about Wood Street Commons
What about reclaiming homes
What about Land Back Black land
What about the houseless mamas

But u wanna keep
Evicting towing sweeping killing
Evicting deporting /stealing hoarding

Taking taking taking more and more in
Evicting sweeping towing killing
Evicting deporting stealing hoarding

This is settler promises
obsessed with profit
And every houseless elder
Who crosses
False borders into more hardship
Only learns
Only earns
Evicting sweeping towing killing
Evicting deporting /stealing drilling
Evicting sweeping towing killing</div>
  `;
  panel.classList.add('open');
}

function openAboutUsPanel() {
  const panel = document.getElementById('content-panel');
  const body  = document.getElementById('content-panel-body');
  body.innerHTML = `
    <img src="data/mesro_logo.png" class="au-logo" alt="MESRO" />
    <div class="cp-title">About the Project</div>
    <p class="cp-p"><em>Swept Off the Map</em> is a seven-month investigation into the scope and scale of encampment sweeps in Berkeley, Richmond and Oakland. This map is one of five published pieces that comprise this investigation. The other pieces include: a guide to homeless management in all three cities, a community profile of an encampment in Berkeley at risk of getting swept out, a piece about how sweeps affect LifeLong Street Medicine, and a profile of RV residents in Richmond at risk of getting towed. All pieces are published with Street Spirit.</p>
    <a class="cp-submit-btn" href="#" target="_blank" rel="noopener">Project Website</a>

    <div class="cp-section-header">About the Authors</div>
    <p class="cp-p"><strong>Cole Haddock and Maria Toldi</strong> are journalists and researchers whose collaborative work centers on homelessness, displacement, and community resilience in the Bay Area. Their partnership began in 2023 producing the documentary <em>Unhoused and Unseen</em> for San Quentin News, and has continued through ongoing collaborations with Street Spirit. Over the past three years, their work has centered on dignifying and respectful journalism, mutual aid, and collaborative storytelling.</p>
    <p class="cp-p"><strong>Cole Haddock</strong> is a graduate of the Geography Department of the University of California, Berkeley and the Human Rights Center at UC Berkeley Law. He will work this summer as a daily news reporter for the Daily Sitka Sentinel in Alaska.</p>
    <p class="cp-p"><strong>Maria Toldi</strong> graduated from University of California, Berkeley in 2025, where she earned her degree in Interdisciplinary Research Studies with a minor in Political Economy. Her academic work has integrated sociology, public policy, ethnic studies, and psychology to critically examine structural inequality and systems of social control.</p>

    <div class="cp-section-header">The Judith Lee Stronach Prize</div>
    <p class="cp-p">This project was fully funded by UC Berkeley's Judith Lee Stronach Baccalaureate Prize, which supports intellectual and creative pursuits that heighten awareness of issues of social consciousness and contribute to the public good.</p>

    <div class="cp-section-header">Advisors</div>
    <div class="au-advisor-name">Alastair Boone</div>
    <div class="au-advisor-role">Director of Street Spirit newspaper and KALW Beat Reporter</div>
    <p class="cp-p">Alastair led the editorial oversight for Swept Off the Map. She provided project management, edited individual stories, provided a framework for ethical reporting and fact-checking, and offered subject matter expertise.</p>
    <div class="au-advisor-name">Dr. Desiree Fields</div>
    <div class="au-advisor-role">UC Berkeley Geography Department Chair</div>
    <p class="cp-p">Dr. Fields offered editorial support and guidance on research methods.</p>
    <div class="au-advisor-name">Georgia von Minden</div>
    <div class="au-advisor-role">Adjunct Professor at University of San Francisco</div>
    <p class="cp-p">Georgia provided computer science guidance for Swept Off the Map. She taught proper data and code organization standards, as well as assisted with fact-checking.</p>

    <div class="cp-section-header">Community Partners</div>
    <p class="cp-p"><span class="au-inline-name">SOS Richmond</span> is a community-rooted nonprofit serving Richmond, CA, where unhoused and housed community members collaborate to address homelessness. They operate a wellness center and resource center to offer job support, food and clothing access, laundry services, and direct connections to essential county services. SOS Richmond also delivers hands-on encampment services, including mobile showers, trash pickup, portable toilets, and other supplies. Cole and Maria brought breakfast to the SOS Richmond warehouse nearly every week during their wellness center hours and talked about the Street Spirit newspaper with potential authors, vendors, and readers.</p>
    <p class="cp-p"><span class="au-inline-name">Episcopal Church of the Good Shepherd</span> is a historic congregation in West Berkeley, with a long and deeply rooted commitment to serving its surrounding community — from hosting an early Black Panthers' breakfast program for schoolchildren to developing a prototype of the Head Start Program. Today, the church has an active food pantry and weekly food program. Since fall 2024, Cole and Maria have partnered with Good Shepherd for their food program, delivering 120 lunches weekly (more than 9,000 in total) to day laborers and encampment residents in the East Bay.</p>

    <div class="cp-section-header">Special Thanks</div>
    <p class="au-thanks-item"><span class="au-inline-name">Wali Henderson</span> — <em>San Quentin News</em></p>
    <p class="au-thanks-item"><span class="au-inline-name">Yesica Prado</span> — <em>El Tecolote</em></p>
    <p class="au-thanks-item"><span class="au-inline-name">Paul Kealoha-Blake</span> — <em>Consider the Homeless</em></p>
    <p class="au-thanks-item"><span class="au-inline-name">Kelsey Hubbard</span> — <em>Oakland Revealed</em></p>
    <p class="au-thanks-item"><span class="au-inline-name">Brigitte Nicoletti</span> — <em>East Bay Community Law</em></p>
    <p class="au-thanks-item"><span class="au-inline-name">Osha Neumann</span> — <em>East Bay Community Law</em></p>
    <p class="au-thanks-item"><span class="au-inline-name">Jessica Lin-Tupas</span> — <em>U.C. Berkeley</em></p>
    <p class="au-thanks-item"><span class="au-inline-name">Dr. Alexa Koenig</span> — <em>Human Rights Center</em></p>
    <p class="au-thanks-item"><span class="au-inline-name">Japjot Sethi</span> — <em>Free Meals on Wheels</em> and <em>Good Karma Water</em></p>
  `;
  panel.classList.add('open');
}

function openComingSoonPanel(title) {
  const panel = document.getElementById('content-panel');
  const body  = document.getElementById('content-panel-body');
  body.innerHTML = `
    <div class="cp-title">${title}</div>
    <p class="cp-p">Coming Soon.</p>
  `;
  panel.classList.add('open');
}

async function openContentPanel(url) {
  const panel = document.getElementById('content-panel');
  const body  = document.getElementById('content-panel-body');

  body.innerHTML = '<p class="cp-p" style="color:var(--text-dim)">Loading…</p>';
  panel.classList.add('open');

  const text = await fetch(url).then(r => r.text());
  body.innerHTML = parseTxt(text);
}

function closeContentPanel() {
  const panel = document.getElementById('content-panel');
  panel.classList.remove('open');
  panel.classList.remove('see-data');
}

function openSeeAllPanel() {
  const panel = document.getElementById('content-panel');
  panel.classList.add('see-data', 'open');
  refreshSeeAllPanel();
}

function refreshSeeAllPanel() {
  const panel = document.getElementById('content-panel');
  if (!panel.classList.contains('open') || !panel.classList.contains('see-data')) return;
  const body  = document.getElementById('content-panel-body');

  const filtered = [...applyJsFilter(allDotFeatures)].sort((a, b) =>
    (a.properties.operation_start_date || '') < (b.properties.operation_start_date || '') ? -1 : 1
  );

  // Build per-operation stats from filtered postings
  const opMap = {};
  filtered.forEach(f => {
    const p   = f.properties;
    const sid = p.sweep_event_id;
    if (!sid) return;
    if (!opMap[sid]) opMap[sid] = { sid, min: null, max: null, postings: 0, locs: new Set() };
    const s = new Date(p.operation_start_date);
    const e = new Date(p.operation_end_date);
    if (!opMap[sid].min || s < opMap[sid].min) opMap[sid].min = s;
    if (!opMap[sid].max || e > opMap[sid].max) opMap[sid].max = e;
    opMap[sid].postings++;
    opMap[sid].locs.add(p.unique_location_id);
  });
  const ops = Object.values(opMap).sort((a, b) => a.min - b.min);

  const postingRows = filtered.map(f => {
    const p   = f.properties;
    const lat = p.load_lat != null ? p.load_lat : f.geometry.coordinates[1];
    const lon = p.load_lon != null ? p.load_lon : f.geometry.coordinates[0];
    const coords = (lat != null && lon != null)
      ? `${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}`
      : '—';
    return `<tr>
      <td class="td-date">${formatDate(p.operation_start_date)}</td>
      <td class="td-date">${formatDate(p.operation_end_date)}</td>
      <td class="sa-loc">${p.location || '—'}</td>
      <td class="sa-intervention"><span class="td-dot" style="background:${interventionColor(p.intervention)};display:inline-block;width:8px;height:8px;border-radius:50%;vertical-align:middle;margin-right:5px;opacity:0.85;"></span>${p.intervention || '—'}</td>
      <td class="td-oplen">${p.district || '—'}</td>
      <td class="td-oplen">${p.sensitivity_zone || '—'}</td>
      <td class="td-oplen" style="white-space:nowrap;">${coords}</td>
    </tr>`;
  }).join('');

  const opRows = ops.map(op => {
    const days = op.min && op.max ? Math.round((op.max - op.min) / 86400000) + 1 : 1;
    return `<tr>
      <td class="td-sweep-id">${op.sid || '—'}</td>
      <td class="td-date">${op.min ? formatDate(op.min.toISOString()) : '—'}</td>
      <td class="td-date">${op.max ? formatDate(op.max.toISOString()) : '—'}</td>
      <td class="td-oplen">${days}</td>
      <td class="td-oplen">${op.postings}</td>
      <td class="td-oplen">${op.locs.size}</td>
    </tr>`;
  }).join('');

  body.innerHTML = `
    <div class="sa-section">
      <button class="sa-toggle" onclick="toggleSeeAll('sa-postings-body','sa-chev-postings','sa-expand-postings')">
        Postings <span class="sa-count">(${filtered.length})</span>
        <span class="sa-expand-btn" id="sa-expand-postings">Expand</span>
        <span class="sa-chevron" id="sa-chev-postings">▶</span>
      </button>
      <div id="sa-postings-body" class="sa-body hidden">
        <table><thead><tr><th>Start</th><th>End</th><th>Location</th><th>Intervention</th><th>District</th><th>Sens. Zone</th><th>Coordinates</th></tr></thead>
        <tbody>${postingRows}</tbody></table>
      </div>
    </div>
    <div class="sa-section">
      <button class="sa-toggle" onclick="toggleSeeAll('sa-ops-body','sa-chev-ops','sa-expand-ops')">
        Operations <span class="sa-count">(${ops.length})</span>
        <span class="sa-expand-btn" id="sa-expand-ops">Expand</span>
        <span class="sa-chevron" id="sa-chev-ops">▶</span>
      </button>
      <div id="sa-ops-body" class="sa-body hidden">
        <table><thead><tr><th>Sweep</th><th>Start</th><th>End</th><th>Days</th><th>Postings</th><th>Locations</th></tr></thead>
        <tbody>${opRows}</tbody></table>
      </div>
    </div>
    <div class="sa-export-row">
      <button class="sa-export-btn" onclick="exportPostingsCSV()">Export Postings</button>
      <button class="sa-export-btn" onclick="exportOpsCSV()">Export Operations</button>
    </div>
  `;
}

document.addEventListener('filtersChanged', refreshSeeAllPanel);

function downloadCSV(rows, filename) {
  const csv = rows.map(r =>
    r.map(v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportPostingsCSV() {
  const filtered = [...applyJsFilter(allDotFeatures)].sort((a, b) =>
    (a.properties.operation_start_date || '') < (b.properties.operation_start_date || '') ? -1 : 1
  );
  const rows = [['Posting ID', 'Start', 'End', 'Location', 'Intervention', 'District', 'Sensitivity Zone', 'Latitude', 'Longitude', 'Sweep ID']];
  filtered.forEach(f => {
    const p   = f.properties;
    const lat = p.load_lat != null ? p.load_lat : f.geometry.coordinates[1];
    const lon = p.load_lon != null ? p.load_lon : f.geometry.coordinates[0];
    rows.push([
      p.posting_id           ?? '',
      p.operation_start_date || '',
      p.operation_end_date   || '',
      p.location             || '',
      p.intervention         || '',
      p.district             || '',
      p.sensitivity_zone     || '',
      lat != null ? Number(lat).toFixed(6) : '',
      lon != null ? Number(lon).toFixed(6) : '',
      p.sweep_event_id       || '',
    ]);
  });
  downloadCSV(rows, 'oakland-encampment-postings.csv');
}

function exportOpsCSV() {
  const filtered = applyJsFilter(allDotFeatures);
  const opMap = {};
  filtered.forEach(f => {
    const p   = f.properties;
    const sid = p.sweep_event_id;
    if (!sid) return;
    if (!opMap[sid]) opMap[sid] = { sid, min: null, max: null, postings: 0, locs: new Set(), postingIds: new Set() };
    const s = new Date(p.operation_start_date);
    const e = new Date(p.operation_end_date);
    if (!opMap[sid].min || s < opMap[sid].min) opMap[sid].min = s;
    if (!opMap[sid].max || e > opMap[sid].max) opMap[sid].max = e;
    opMap[sid].postings++;
    opMap[sid].locs.add(p.unique_location_id);
    if (p.posting_id != null) opMap[sid].postingIds.add(p.posting_id);
  });
  const rows = [['Sweep ID', 'Start', 'End', 'Days', 'Postings', 'Unique Locations', 'Posting IDs']];
  Object.values(opMap).sort((a, b) => a.min - b.min).forEach(op => {
    const days = op.min && op.max ? Math.round((op.max - op.min) / 86400000) + 1 : 1;
    rows.push([
      op.sid,
      op.min ? op.min.toISOString().slice(0, 10) : '',
      op.max ? op.max.toISOString().slice(0, 10) : '',
      days,
      op.postings,
      op.locs.size,
      [...op.postingIds].sort((a, b) => a - b).join('; '),
    ]);
  });
  downloadCSV(rows, 'oakland-encampment-operations.csv');
}

function toggleSeeAll(bodyId, chevId, expandId) {
  const el = document.getElementById(bodyId);
  el.classList.toggle('hidden');
  const collapsed = el.classList.contains('hidden');
  document.getElementById(chevId).textContent = collapsed ? '▶' : '▼';
  document.getElementById(expandId).textContent = collapsed ? 'Expand' : 'Collapse';
}

function parseTxt(text) {
  const lines  = text.split('\n');
  const blocks = [];
  let current  = [];

  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length) { blocks.push(current); current = []; }
    } else {
      current.push(line.trim());
    }
  }
  if (current.length) blocks.push(current);

  let html = '';
  let firstBlock = true;

  for (const block of blocks) {
    const joined = block.join(' ');
    const single = block.length === 1;
    const short  = joined.length < 80;
    const noEnd  = !/[.!?]$/.test(joined);

    // First block = meta (author / date)
    if (firstBlock) {
      html += `<div class="cp-meta">${block.join(' &nbsp;·&nbsp; ')}</div>`;
      firstBlock = false;
      continue;
    }

    // Page title — second block
    if (html.indexOf('cp-title') === -1 && short && noEnd) {
      html += `<div class="cp-title">${joined}</div>`;
      continue;
    }

    // Section header — short, no end punctuation, single line
    if (single && short && noEnd) {
      html += `<div class="cp-section-header">${joined}</div>`;
      continue;
    }

    // Location examples — lines starting with a quote
    if (block.every(l => l.startsWith("'"))) {
      html += block.map(l => `<div class="cp-location">${l}</div>`).join('');
      continue;
    }

    // List — multiple lines each ending with ; or starts with keyword pattern
    if (block.length > 2 && block.slice(0, -1).every(l => /[;,]$/.test(l))) {
      html += `<ul class="cp-list">${block.map(l => `<li>${l.replace(/;$/, '')}</li>`).join('')}</ul>`;
      continue;
    }

    // Plain paragraph
    html += `<p class="cp-p">${block.join('<br>')}</p>`;
  }

  return html;
}