/* Bangladesh Web GIS demo — plain JavaScript, Leaflet + OpenStreetMap.
   Sections: config · state · data · map · sidebar · search · dashboard · detail · import · init */
(() => {
  'use strict';

  /* ---------- Config ---------- */
  // To add a new built-in dataset (colleges, hospitals, ...), add a file path here.
  const DATA_FILES = ['data/institutions.json', 'data/airports.json'];
  const BD_CENTER = [23.8, 90.4];
  const BD_BOUNDS = { latMin: 20.5, latMax: 26.7, lngMin: 88.0, lngMax: 92.8 };
  // Optional: fixed colours for known types. Anything else gets a palette colour.
  const COLORS = {
    'Educational Institution': '#e3a43a',
    'International Airport': '#4a9de0',
    'Domestic Airport': '#3fb6a8'
  };
  const PALETTE = ['#c576e0', '#e5766d', '#8fb84a', '#d9658f', '#7a8ae0', '#5bc0c0'];

  /* ---------- State ---------- */
  const state = {
    records: [],            // all loaded records (built-in + imported)
    hidden: new Set(),      // hidden filter keys "category|type"
    query: '',
    markers: new Map(),     // id -> Leaflet marker
    selectedId: null
  };
  const $ = (id) => document.getElementById(id);
  const keyOf = (r) => `${r.category}|${r.type}`;
  const norm = (s) => String(s ?? '').toLowerCase();

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function safeUrl(u) {
    try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; }
  }
  const colorCache = {};
  function colorFor(r) {
    const k = r.type in COLORS ? r.type : r.category in COLORS ? r.category : keyOf(r);
    if (COLORS[k]) return COLORS[k];
    if (!colorCache[k]) colorCache[k] = PALETTE[Object.keys(colorCache).length % PALETTE.length];
    return colorCache[k];
  }
  const isUnverified = (r) => !r.verification || /unverified|approximate|confirm|not verified/i.test(r.verification) || /placeholder/i.test(r.notes || '');

  /* ---------- Map ---------- */
  const map = L.map('map', { zoomControl: true }).setView(BD_CENTER, 7);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  const layer = L.layerGroup().addTo(map);

  function makeIcon(r) {
    return L.divIcon({
      className: '',
      html: `<div class="pin${isUnverified(r) ? ' unverified' : ''}" style="background:${colorFor(r)}"></div>`,
      iconSize: [22, 22], iconAnchor: [11, 22], popupAnchor: [0, -22]
    });
  }

  function popupNode(r) {
    const el = document.createElement('div');
    el.className = 'pop';
    const place = [r.address, r.district].filter(Boolean).join(', ');
    el.innerHTML =
      `<h3>${escapeHtml(r.name)}</h3>` +
      `<div class="sub">${escapeHtml(r.category)} · ${escapeHtml(r.type)}${r.ownership ? ' · ' + escapeHtml(r.ownership) : ''}</div>` +
      (isUnverified(r) ? '<div class="flag">Incomplete / unverified data</div><br>' : '') +
      (place ? `<div>${escapeHtml(place)}</div>` : '<div class="sub">Address not available</div>') +
      '<div class="actions"></div>';
    const actions = el.querySelector('.actions');
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = 'View Database Details';
    b.addEventListener('click', () => showDetail(r.id));
    const a = document.createElement('a');
    a.href = gmapsUrl(r); a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'Open in Google Maps';
    actions.append(b, a);
    return el;
  }
  const gmapsUrl = (r) => `https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`;

  function rebuildMarkers() {
    layer.clearLayers();
    state.markers.clear();
    state.records.forEach((r) => {
      const m = L.marker([r.lat, r.lng], { icon: makeIcon(r), title: r.name, keyboard: true });
      m.bindPopup(() => popupNode(r));
      state.markers.set(r.id, m);
    });
    applyFilters();
  }

  function isVisible(r) {
    if (state.hidden.has(keyOf(r))) return false;
    if (!state.query) return true;
    return searchText(r).includes(state.query);
  }
  const searchText = (r) => norm([r.name, r.category, r.type, r.district, r.division, r.iata, r.icao, r.ownership].filter(Boolean).join(' '));

  function applyFilters() {
    state.records.forEach((r) => {
      const m = state.markers.get(r.id);
      if (!m) return;
      if (isVisible(r)) { if (!layer.hasLayer(m)) layer.addLayer(m); }
      else layer.removeLayer(m);
    });
    renderResults();
    renderDashboard();
  }

  function fitVisible() {
    const pts = state.records.filter(isVisible).map((r) => [r.lat, r.lng]);
    if (pts.length === 1) map.setView(pts[0], 12);
    else if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40], maxZoom: 10 });
  }

  function focusRecord(id) {
    const r = state.records.find((x) => x.id === id);
    const m = state.markers.get(id);
    if (!r || !m) return;
    if (!layer.hasLayer(m)) layer.addLayer(m);
    map.setView([r.lat, r.lng], Math.max(map.getZoom(), 11));
    m.openPopup();
  }

  /* ---------- Data ---------- */
  async function loadBuiltIn() {
    const out = [];
    for (const file of DATA_FILES) {
      const res = await fetch(file);
      if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
      const json = await res.json();
      const { valid, errors } = validateRecords(json, out);
      if (errors.length) console.warn(file, errors);
      valid.forEach((r) => out.push({ ...r, _source: 'builtin' }));
    }
    return out;
  }

  // Accepts an array of records or { records: [...] }. Returns valid records + error strings.
  function validateRecords(json, existing = []) {
    const list = Array.isArray(json) ? json : json && Array.isArray(json.records) ? json.records : null;
    if (!list) return { fatal: 'File must be a JSON array of records or an object with a "records" array.', valid: [], errors: [] };
    if (!list.length) return { fatal: 'The file contains no records.', valid: [], errors: [] };
    const seen = new Set(existing.map((r) => r.id));
    const valid = [], errors = [], warnings = [];
    list.forEach((raw, i) => {
      const at = `Record ${i + 1}`;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return errors.push(`${at}: not an object.`);
      const lat = Number(raw.lat), lng = Number(raw.lng);
      if (typeof raw.name !== 'string' || !raw.name.trim()) return errors.push(`${at}: "name" is required.`);
      if (typeof raw.category !== 'string' || !raw.category.trim()) return errors.push(`${at} (${raw.name}): "category" is required.`);
      if (raw.lat === undefined || raw.lng === undefined || raw.lat === null || raw.lng === null || raw.lat === '' || raw.lng === '' || !Number.isFinite(lat) || !Number.isFinite(lng))
        return errors.push(`${at} (${raw.name}): "lat" and "lng" must be numbers.`);
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return errors.push(`${at} (${raw.name}): coordinates out of range.`);
      const id = raw.id !== undefined && raw.id !== '' ? String(raw.id) : `rec-${Date.now().toString(36)}-${i}`;
      if (seen.has(id)) return errors.push(`${at} (${raw.name}): duplicate id "${id}".`);
      seen.add(id);
      if (lat < BD_BOUNDS.latMin || lat > BD_BOUNDS.latMax || lng < BD_BOUNDS.lngMin || lng > BD_BOUNDS.lngMax)
        warnings.push(`${at} (${raw.name}): outside Bangladesh bounds — check lat/lng order.`);
      valid.push({
        id, name: raw.name.trim(), category: raw.category.trim(), type: String(raw.type || raw.category).trim(),
        ownership: raw.ownership ?? null, address: raw.address ?? null, district: raw.district ?? null, division: raw.division ?? null,
        lat, lng, description: raw.description ?? null, website: raw.website ?? null,
        iata: raw.iata ?? null, icao: raw.icao ?? null, verification: raw.verification ?? 'unverified', notes: raw.notes ?? null
      });
    });
    return { valid, errors, warnings };
  }

  /* ---------- Sidebar: category tree ---------- */
  function renderTree() {
    const groups = new Map(); // category -> Map(type -> count)
    state.records.forEach((r) => {
      if (!groups.has(r.category)) groups.set(r.category, new Map());
      const g = groups.get(r.category);
      g.set(r.type, (g.get(r.type) || 0) + 1);
    });
    const tree = $('layer-tree');
    tree.innerHTML = '';
    groups.forEach((types, cat) => {
      const keys = [...types.keys()].map((t) => `${cat}|${t}`);
      const parent = document.createElement('label');
      const pcb = document.createElement('input');
      pcb.type = 'checkbox';
      const total = [...types.values()].reduce((a, b) => a + b, 0);
      parent.append(pcb, document.createTextNode(cat));
      const pc = document.createElement('span'); pc.className = 'count'; pc.textContent = total; parent.append(pc);
      tree.append(parent);
      const syncParent = () => {
        const on = keys.filter((k) => !state.hidden.has(k)).length;
        pcb.checked = on === keys.length; pcb.indeterminate = on > 0 && on < keys.length;
      };
      pcb.addEventListener('change', () => {
        keys.forEach((k) => (pcb.checked ? state.hidden.delete(k) : state.hidden.add(k)));
        tree.querySelectorAll(`input[data-cat="${CSS.escape(cat)}"]`).forEach((c) => (c.checked = pcb.checked));
        applyFilters();
      });
      types.forEach((count, type) => {
        const k = `${cat}|${type}`;
        const l = document.createElement('label'); l.className = 'child';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.dataset.cat = cat; cb.checked = !state.hidden.has(k);
        const dot = document.createElement('span'); dot.className = 'dot';
        dot.style.background = colorFor({ category: cat, type });
        const c = document.createElement('span'); c.className = 'count'; c.textContent = count;
        l.append(cb, dot, document.createTextNode(type), c);
        cb.addEventListener('change', () => { cb.checked ? state.hidden.delete(k) : state.hidden.add(k); syncParent(); applyFilters(); });
        tree.append(l);
      });
      syncParent();
    });
  }

  /* ---------- Search ---------- */
  function renderResults() {
    const ul = $('results');
    if (!state.query) { ul.hidden = true; ul.innerHTML = ''; return; }
    const hits = state.records.filter(isVisible).slice(0, 30);
    ul.innerHTML = '';
    if (!hits.length) { const li = document.createElement('li'); li.textContent = 'No matching records.'; ul.append(li); }
    hits.forEach((r) => {
      const li = document.createElement('li'); li.tabIndex = 0;
      li.innerHTML = `${escapeHtml(r.name)}<small>${escapeHtml(r.type)}${r.district ? ' · ' + escapeHtml(r.district) : ''}</small>`;
      const go = () => { focusRecord(r.id); if (window.innerWidth <= 900) closeSidebar(); };
      li.addEventListener('click', go);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      ul.append(li);
    });
    ul.hidden = false;
  }

  /* ---------- Dashboard (computed only from loaded records) ---------- */
  function renderDashboard() {
    const count = (fn) => state.records.filter(fn).length;
    const inst = count((r) => norm(r.category) === 'educational institution');
    const apt = count((r) => norm(r.category) === 'airport');
    const intl = count((r) => norm(r.category) === 'airport' && norm(r.type) === 'international airport');
    const dom = count((r) => norm(r.category) === 'airport' && norm(r.type) === 'domestic airport');
    const other = state.records.length - inst - apt;
    const items = [['Institutions', inst], ['Airports', apt], ['International', intl], ['Domestic', dom]];
    if (other > 0) items.push(['Other categories', other]);
    $('dashboard').innerHTML = items.map(([l, n]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');
    const shown = state.records.filter(isVisible).length;
    $('dash-note').textContent = `${state.records.length} loaded records · ${shown} shown on map`;
  }

  /* ---------- Detail panel ---------- */
  function showDetail(id) {
    const r = state.records.find((x) => x.id === id);
    if (!r) return;
    state.selectedId = id;
    const site = r.website ? safeUrl(r.website) : null;
    const rows = [
      ['ID', r.id], ['Category', r.category], ['Type', r.type], ['Status', r.ownership],
      ['IATA', r.iata], ['ICAO', r.icao], ['Address', r.address], ['District', r.district], ['Division', r.division],
      ['Latitude', r.lat], ['Longitude', r.lng], ['Description', r.description]
    ];
    const dl = rows.map(([k, v]) => `<dt>${k}</dt>` + (v !== null && v !== undefined && v !== '' ? `<dd>${escapeHtml(v)}</dd>` : '<dd class="empty">Not available</dd>')).join('') +
      '<dt>Website</dt>' + (site ? `<dd><a href="${escapeHtml(site)}" target="_blank" rel="noopener noreferrer">${escapeHtml(site)}</a></dd>` : '<dd class="empty">Not verified</dd>') +
      `<dt>Verification</dt><dd>${escapeHtml(r.verification || 'unverified')}</dd>` +
      (r.notes ? `<dt>Notes</dt><dd>${escapeHtml(r.notes)}</dd>` : '') +
      `<dt>Source</dt><dd>${r._source === 'import' ? 'Imported file (preview)' : 'Built-in demo JSON'}</dd>`;
    $('detail-body').innerHTML =
      `<h2>${escapeHtml(r.name)}</h2>` +
      `<span class="badge${isUnverified(r) ? ' warn' : ''}">${isUnverified(r) ? 'Incomplete / unverified' : 'Verified'}</span>` +
      `<dl>${dl}</dl><div class="row" style="margin-top:14px"><a class="btn" href="${gmapsUrl(r)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none">Open in Google Maps</a></div>`;
    $('detail').hidden = false;
    map.invalidateSize();
  }
  function hideDetail() { $('detail').hidden = true; map.invalidateSize(); }

  /* ---------- Import ---------- */
  function setMsg(text, kind) { const m = $('import-msg'); m.textContent = text; m.className = 'msg' + (kind ? ' ' + kind : ''); }

  async function handleImport(file) {
    if (!file) return;
    if (!/\.json$/i.test(file.name) && file.type !== 'application/json') return setMsg('Please choose a .json file.', 'err');
    let json;
    try { json = JSON.parse(await file.text()); }
    catch (e) { return setMsg(`Invalid JSON: ${e.message}`, 'err'); }
    const { valid, errors, warnings = [], fatal } = validateRecords(json, state.records);
    if (fatal) return setMsg(fatal, 'err');
    if (!valid.length) return setMsg('No valid records found.\n' + errors.slice(0, 6).join('\n'), 'err');
    valid.forEach((r) => state.records.push({ ...r, _source: 'import' }));
    renderTree(); rebuildMarkers(); fitVisible();
    $('clear-import').hidden = false;
    let msg = `Imported ${valid.length} record(s) from ${file.name}.`;
    if (errors.length) msg += `\nSkipped ${errors.length}:\n` + errors.slice(0, 5).join('\n') + (errors.length > 5 ? `\n…and ${errors.length - 5} more` : '');
    if (warnings.length) msg += '\nWarnings:\n' + warnings.slice(0, 3).join('\n');
    setMsg(msg, errors.length || warnings.length ? 'err' : 'ok');
  }

  function clearImported() {
    state.records = state.records.filter((r) => r._source !== 'import');
    state.hidden.forEach((k) => { if (!state.records.some((r) => keyOf(r) === k)) state.hidden.delete(k); });
    renderTree(); rebuildMarkers();
    $('clear-import').hidden = true; hideDetail(); setMsg('Imported records removed.', 'ok');
  }

  /* ---------- Sidebar toggle (mobile) ---------- */
  const closeSidebar = () => $('sidebar').classList.remove('open');

  /* ---------- Init ---------- */
  async function init() {
    $('search').addEventListener('input', (e) => { state.query = norm(e.target.value.trim()); applyFilters(); });
    $('search').addEventListener('keydown', (e) => { if (e.key === 'Enter') fitVisible(); });
    $('import-btn').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', (e) => { handleImport(e.target.files[0]); e.target.value = ''; });
    $('clear-import').addEventListener('click', clearImported);
    $('detail-close').addEventListener('click', hideDetail);
    $('menu-btn').addEventListener('click', () => $('sidebar').classList.toggle('open'));
    map.on('click', closeSidebar);

    try {
      state.records = await loadBuiltIn();
    } catch (e) {
      const box = $('load-error');
      box.hidden = false;
      box.textContent = location.protocol === 'file:'
        ? 'Could not load data files. Browsers block fetch() on file:// — run a local server (see README).'
        : `Could not load data: ${e.message}`;
      return;
    }
    renderTree(); rebuildMarkers(); fitVisible();
  }
  init();
})();
