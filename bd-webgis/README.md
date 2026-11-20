# Bangladesh Web GIS Demo

Leaflet + OpenStreetMap demo. Plain HTML/CSS/JS, no build step, no API keys.
Data is loaded from local JSON files — this is NOT a live database.

## Run locally
Browsers block `fetch()` of local JSON when opening `index.html` directly (file://), so use a local server:

    cd bd-webgis
    python3 -m http.server 8000      # or: npx serve .
    # open http://localhost:8000

(VS Code: "Live Server" extension also works.) Internet access is needed for map tiles and Leaflet (CDN).

## Files
- index.html, style.css, app.js
- data/institutions.json, data/airports.json

## Add a new category (e.g. hospitals)
1. Create `data/hospitals.json` using the same record shape.
2. Add its path to `DATA_FILES` in `app.js`.
The sidebar, search, markers and dashboard pick up new categories automatically.
Optionally add a colour in `COLORS`.

## Record fields
id, name, category, type, ownership, address, district, division, lat, lng,
description, website, iata, icao, verification, notes. Required: name, category, lat, lng.

## Data accuracy
- Airport coordinates are approximate (public references); confirm with CAAB.
- The Rajshahi Government Survey Institute marker is a city-centre PLACEHOLDER;
  address, website and exact coordinates are not verified. Edit `data/institutions.json`.
- Some airfields are intentionally omitted until verified.
