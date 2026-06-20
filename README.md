# UniMap

A mobile indoor/outdoor navigation and campus mapping application for the **International Hellenic University (IHU)** campus in Sindos, Thessaloniki. Built with Angular/Ionic and powered by a custom graph-based pathfinding backend.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [API Reference](#api-reference)
- [Accessibility](#accessibility)
- [Building for Android](#building-for-android)
- [How Routing Works](#how-routing-works)

---

## Overview

UniMap helps students, staff, and visitors navigate the IHU Sindos campus — both outdoors between buildings and indoors to specific rooms, departments, and services. The app uses the device's GPS to track the user's real-time position, snaps it to the nearest walkable path, and provides turn-by-turn guidance with automatic rerouting if the user goes off-course.

---

## Features

| Feature | Description |
|---|---|
| Interactive map | Leaflet.js map centered on IHU Sindos campus |
| Real-time GPS | Live position tracking with EMA smoothing and jump-rejection |
| Snap-to-path | User marker snaps to the nearest graph edge while navigating |
| Turn-by-turn navigation | Heading-up camera, progress bar, distance remaining |
| Auto-reroute | Detects off-route movement and recalculates automatically |
| Accessibility mode (AMEA) | Avoids staircases, routes through ramps and accessible entrances |
| Campus destinations | Search for departments, labs, services, and facilities by name |
| Outdoor routing | Proxies OSRM for walking routes outside campus boundaries |
| Multi-language | Full Greek and English UI via ngx-translate |
| Walked trail | Visual breadcrumb trail of the user's path |
| Works on Android & web | Capacitor bridges native GPS on Android; web fallback via browser Geolocation API |

---

## Architecture

```
┌─────────────────────────────────────┐
│         Ionic/Angular Frontend       │
│  Leaflet map · GPS service · UI      │
└────────────────┬────────────────────┘
                 │ HTTP (localhost:3000)
┌────────────────▼────────────────────┐
│        Node.js / Express Backend     │
│  Campus graph · A* pathfinding · OSRM proxy│
└─────────────────────────────────────┘
```

- The **frontend** handles all map rendering, GPS polling, marker management, route polylines, and user interaction.
- The **backend** owns pathfinding. It builds a weighted undirected graph from three data sources (OSM nodes, manually-mapped campus nodes, POI nodes) and runs A* to compute the shortest path.
- For outdoor routes (outside campus), the backend proxies the public [OSRM](https://project-osrm.org/) API.

---

## Tech Stack

### Frontend
| Package | Version | Purpose |
|---|---|---|
| Angular | 19 | Application framework |
| Ionic | 8 | Mobile UI components |
| Capacitor | 7 | Native Android/iOS bridge |
| Leaflet.js | 1.9 | Map rendering |
| @capacitor/geolocation | 7 | GPS on native device |
| ngx-translate | 17 | i18n (Greek / English) |
| RxJS | 7.8 | Reactive state |

### Backend
| Package | Version | Purpose |
|---|---|---|
| Node.js / Express | 4.18 | HTTP server |
| TypeScript | 5.3 | Type safety |
| ts-node-dev | 2 | Dev server with hot-reload |
| node-fetch | 3 | OSRM proxy requests |

---

## Project Structure

```
UniMap/
├── src/
│   ├── app/
│   │   ├── home/                  # Main map page (home.page.ts)
│   │   ├── splash/                # Splash/loading screen
│   │   ├── components/
│   │   │   ├── search-bar/        # Destination search input
│   │   │   ├── settings-modal/    # Language, accessibility toggles
│   │   │   ├── privacy-modal/     # Privacy notice
│   │   │   ├── department-popup/  # Building/department info popup
│   │   │   ├── app-dialog/        # Generic dialog
│   │   │   └── app-confirm-dialog/
│   │   ├── services/
│   │   │   ├── gps.service.ts     # GPS polling, smoothing, jump-detection
│   │   │   ├── map.service.ts     # Leaflet map init and marker management
│   │   │   ├── route.service.ts   # Route polylines, snap-to-path, rerouting
│   │   │   ├── routing.service.ts # Off-route detection logic
│   │   │   ├── api.service.ts     # HTTP calls to backend
│   │   │   ├── settings.service.ts# Persistent user preferences
│   │   │   └── ui-dialog.service.ts
│   │   └── models/
│   │       └── destination.model.ts
│   └── assets/
│       └── i18n/
│           ├── el.json            # Greek translations
│           └── en.json            # English translations
├── backend/
│   └── src/
│       ├── app.ts                 # Express app setup
│       ├── index.ts               # Server entry point (port 3000)
│       ├── types.ts               # Shared TypeScript interfaces
│       ├── data/
│       │   ├── osm-nodes.ts       # Nodes & edges from OpenStreetMap
│       │   ├── manual-nodes.ts    # Hand-mapped campus paths
│       │   ├── poi-nodes.ts       # Points of interest (departments, labs)
│       │   └── destinations.ts    # Named destination list for search
│       ├── routes/
│       │   ├── campus.ts          # POST /api/route/campus
│       │   ├── outdoor.ts         # GET  /api/route/outdoor
│       │   └── destinations.ts    # GET  /api/destinations
│       └── services/
│           ├── campus-graph.ts    # Graph builder + A* pathfinding
│           ├── geo.ts             # Haversine distance, bearing utils
│           └── accessibility.ts   # Edge tagging (STAIRS / RAMP / ALL)
└── android/                       # Native Android project (Capacitor)
```

---

## Getting Started

### Prerequisites

- **Node.js** v18+ and **npm**
- **Angular CLI**: `npm install -g @angular/cli@19`
- **Ionic CLI**: `npm install -g @ionic/cli`

### 1. Clone and install

```bash
git clone <repo-url>
cd UniMap
npm install
```

### 2. Start the backend

```bash
cd backend
npm install
npm run dev
# API running at http://localhost:3000
```

### 3. Start the frontend

```bash
# from UniMap/ root
npm start
# App running at http://localhost:4200
```

Open `http://localhost:4200` in your browser. Allow location permissions when prompted.

---

## API Reference

### `POST /api/route/campus`

Calculate a walking route within the campus graph.

**Request body:**
```json
{
  "fromLat": 40.6789,
  "fromLng": 22.8012,
  "destinationName": "Τμήμα Μηχανολόγων Μηχανικών",
  "destLat": 40.6801,
  "destLng": 22.8034,
  "wheelchair": false
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `fromLat` / `fromLng` | number | Yes | User's current GPS position |
| `destinationName` | string | No | Name of the destination (Greek or English). Looked up first. |
| `destLat` / `destLng` | number | No | Fallback coordinates if name lookup fails |
| `wheelchair` | boolean | No | If `true`, excludes staircase edges |

**Response:**
```json
{
  "path": [
    { "lat": 40.6789, "lng": 22.8012 },
    { "lat": 40.6795, "lng": 22.8020 }
  ],
  "lengthM": 183
}
```

---

### `GET /api/route/outdoor`

Proxy to OSRM for walking routes outside the campus boundary.

**Query parameters:** `fromLat`, `fromLng`, `toLat`, `toLng`

**Response:**
```json
{
  "path": [
    { "lat": 40.678, "lng": 22.800 },
    { "lat": 40.679, "lng": 22.801 }
  ]
}
```

---

### `GET /api/destinations`

Returns the full list of searchable campus destinations.

**Response:** Array of destination objects with `id`, `name`, `lat`, `lng`, and category info.

---

### `GET /api/destinations/:id`

Returns a single destination by ID.

---

### `GET /health`

Health check — returns `{ "status": "ok" }`.

---

## Accessibility

The app includes a **wheelchair / AMEA mode** that modifies the routing graph at query time:

- Edges tagged `STAIRS` are excluded from the graph.
- Edges tagged `RAMP` are always included.
- When a destination has an accessible entrance alternative, the route targets that entrance instead.
- If no wheelchair flag is set, the backend computes routes to both the standard and accessible entrances and returns the shorter one.

Toggle accessibility mode from the **Settings** menu inside the app.

---

## Building for Android

1. Build the web bundle:
```bash
npm run build
```

2. Sync with the native Android project:
```bash
npx cap sync android
```

3. Build the APK:
```bash
cd android
./gradlew assembleDebug
```

The debug APK is output to `android/app/build/outputs/apk/debug/app-debug.apk`.

To open in Android Studio:
```bash
npx cap open android
```

---

## How Routing Works

1. At startup, the backend constructs a **weighted undirected graph** by merging three node sets:
   - `osm-nodes.ts` — footpaths extracted from OpenStreetMap
   - `manual-nodes.ts` — hand-mapped internal campus walkways
   - `poi-nodes.ts` — building entrances and named points of interest

2. Edge weights are **Euclidean distances in metres** (Haversine formula).

3. When a route is requested, the backend injects a **virtual start node** at the user's GPS position, connects it to the nearest graph nodes, runs **A\*** (with Haversine heuristic), then removes the virtual node and returns the `path` array.

4. The frontend draws the path as a Leaflet polyline and begins tracking the user. As the user moves, GPS updates are **smoothed with EMA** when stationary and **jump-rejected** (positions implying > 7 m/s movement are discarded).

5. The user marker is **snapped to the nearest edge** of the current route segment. If the user drifts more than a threshold distance off-route for several consecutive GPS fixes, the app automatically requests a new route from the current position.
