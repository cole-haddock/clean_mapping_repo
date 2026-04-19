// ── CONFIG — swap these before pushing to GitHub ─────────────────────────
mapboxgl.accessToken = 'pk.eyJ1IjoiY29sZS1oYWRkb2NrIiwiYSI6ImNtbWtxbWRzaTF0ZWEycHByYmhxanVydGsifQ.BeBPsJNRNCmbHeqcaN35-A';

const STYLE_URL = 'mapbox://styles/mapbox/light-v11';  // swap for your custom style later

const DOTS_URL  = 'data/all_posting_dots.geojson';
const LINES_URL = 'data/combined_sweeps.geojson';

// ── State ─────────────────────────────────────────────────────────────────
let selectedLocationId = null;  // unique_location_id of clicked dot's location
let selectedPostingId  = null;  // posting_id of the clicked dot
let selectedSweepId    = null;  // sweep_event_id of clicked dot
let activeFilter       = 'all';
let allDotFeatures     = [];    // stashed on load for count resets

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

  // Keep only LineStrings (skip polygons for now)
  linesGJ.features = linesGJ.features.filter(
    f => f.geometry.type === 'LineString'
  );

  // Stash original features for filter count
  allDotFeatures = dotsGJ.features;
  updateDotCount(allDotFeatures.length);

  // ── Sources ────────────────────────────────────────────────────────────
  map.addSource('lines', { type: 'geojson', data: linesGJ });
  map.addSource('dots',  { type: 'geojson', data: dotsGJ  });

  // ── LAYER 1: Base line segments — light gray, always visible ───────────
  map.addLayer({
    id: 'lines-base',
    type: 'line',
    source: 'lines',
    paint: {
      'line-color': '#c8c4bc',
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
    paint: {
      'line-color': '#d4762a',
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        10, 3,
        14, 6,
        16, 9,
      ],
      'line-opacity': 0.85,
    },
    filter: ['==', ['get', 'location'], '!!NOMATCH!!'],
  });

  // ── LAYER 3: Selected location highlight — red, hidden by default ──────
  map.addLayer({
    id: 'lines-selected-highlight',
    type: 'line',
    source: 'lines',
    paint: {
      'line-color': '#cc3333',
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        10, 4,
        14, 7,
        16, 10,
      ],
      'line-opacity': 1,
    },
    filter: ['==', ['get', 'location'], '!!NOMATCH!!'],
  });

  // ── LAYER 4: Dots — always on top of lines ─────────────────────────────
  // Before GP: low opacity. After GP: higher opacity. Matches old Folium look.
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
      'circle-color': '#cc3333',
      'circle-opacity': [
        'case',
        ['==', ['get', 'before_after_grants_pass'], 'Before'], 0.25,
        0.65,
      ],
      'circle-stroke-width': 0,
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
      'circle-stroke-color': '#cc3333',
      'circle-opacity': 0,
    },
    filter: ['==', ['get', 'posting_id'], -1],  // hidden by default
  });

  // ── Cursor changes ─────────────────────────────────────────────────────
  map.on('mouseenter', 'dots-layer', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'dots-layer', () => {
    map.getCanvas().style.cursor = '';
  });

  // ── Click a dot ────────────────────────────────────────────────────────
  map.on('click', 'dots-layer', e => {
    // Stop event bubbling so map-background click doesn't also fire
    e.preventDefault();
    const props = e.features[0].properties;
    handleDotClick(props);
  });

  // ── Click map background → reset ───────────────────────────────────────
  map.on('click', e => {
    const hits = map.queryRenderedFeatures(e.point, { layers: ['dots-layer'] });
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

  // 1. Highlight selected line red
  map.setFilter('lines-selected-highlight', [
    '==', ['get', 'location'], location
  ]);

  // 2. Highlight co-sweep lines orange.
  //    We can't use Mapbox array expressions reliably because sweep_event_ids
  //    is inconsistently serialized in the GeoJSON (some are arrays, some strings).
  //    Instead: find matching location names in JS, then filter by those names.
  const linesSource  = map.getSource('lines');
  const allLines     = linesSource._data.features;

  const coSweepLocations = allLines
    .filter(f => {
      if (f.properties.location === location) return false; // skip selected
      const ids = parseSweepIds(f.properties.sweep_event_ids);
      return ids.includes(sweepId);
    })
    .map(f => f.properties.location);

  if (coSweepLocations.length > 0) {
    map.setFilter('lines-sweep-highlight', [
      'in', ['get', 'location'], ['literal', coSweepLocations]
    ]);
  } else {
    map.setFilter('lines-sweep-highlight', ['==', ['get', 'location'], '!!NOMATCH!!']);
  }

  // 3. Show ring on clicked dot
  map.setFilter('dots-selected-ring', [
    '==', ['get', 'posting_id'], postId
  ]);

  // 4. Offset dots at this location to clicked positions
  offsetDotsForLocation(locId);

  // 5. Build and open sidebar
  buildSidebar(locId, postId, props);
  document.getElementById('sidebar').classList.add('open');
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

// ── Move dots at selected location to offset (clicked) positions ──────────
function offsetDotsForLocation(locId) {
  const source  = map.getSource('dots');
  const current = source._data;

  const updated = {
    ...current,
    features: current.features.map(f => {
      if (f.properties.unique_location_id !== locId) return f;
      return {
        ...f,
        geometry: {
          type: 'Point',
          coordinates: [
            f.properties.clicked_lon,
            f.properties.clicked_lat,
          ],
        },
      };
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
      geometry: {
        type: 'Point',
        coordinates: [
          f.properties.load_lon,
          f.properties.load_lat,
        ],
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

  // Location header
  document.getElementById('sb-location').textContent = clickedProps.location;
  document.getElementById('sb-count').textContent    = features.length;

  // Meta chips
  document.getElementById('sb-meta').innerHTML = `
    <span class="meta-chip district">${clickedProps.district || '—'}</span>
    <span class="meta-chip">${clickedProps.sensitivity_zone || '—'}</span>
  `;

  // Table rows
  const tbody = document.getElementById('sb-tbody');
  tbody.innerHTML = features.map(f => {
    const p        = f.properties;
    const isActive = p.posting_id === activePostId;
    const start    = formatDate(p.operation_start_date);
    const end      = formatDate(p.operation_end_date);
    const dateStr  = start === end ? start : `${start} – ${end}`;
    const gpBadge  = p.before_after_grants_pass === 'Before'
      ? `<span class="badge-before">Before</span>`
      : `<span class="badge-after">After</span>`;

    return `
      <tr class="${isActive ? 'active-row' : ''}"
          data-posting-id="${p.posting_id}"
          onclick="selectPostingFromTable(${p.posting_id}, ${locId})">
        <td class="td-date">${dateStr}</td>
        <td class="td-intervention">${p.intervention || p.intervention_types || '—'}</td>
        <td>${p.district || '—'}</td>
        <td>${gpBadge}</td>
        <td class="td-sweep">${p.sweep_event_id || '—'}</td>
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

  // Move ring to this dot
  map.setFilter('dots-selected-ring', [
    '==', ['get', 'posting_id'], postingId
  ]);

  // Update active row in table
  const tbody = document.getElementById('sb-tbody');
  tbody.querySelectorAll('tr').forEach(row => {
    row.classList.toggle(
      'active-row',
      parseInt(row.dataset.postingId) === postingId
    );
  });

  // Scroll into view
  const activeRow = tbody.querySelector('.active-row');
  if (activeRow) activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ── Close sidebar + reset everything ─────────────────────────────────────
function closeSidebar() {
  selectedLocationId = null;
  selectedPostingId  = null;
  selectedSweepId    = null;

  // Clear all highlights
  map.setFilter('lines-selected-highlight', ['==', ['get', 'location'], '!!NOMATCH!!']);
  map.setFilter('lines-sweep-highlight',    ['==', ['get', 'location'], '!!NOMATCH!!']);
  map.setFilter('dots-selected-ring',       ['==', ['get', 'posting_id'], -1]);

  // Reset dots back to line positions
  resetDotPositions();

  // Close panel
  document.getElementById('sidebar').classList.remove('open');
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
function formatDate(str) {
  if (!str) return '—';
  const d = new Date(str + 'T00:00:00');  // force local time, avoid UTC offset issues
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