# UniMap

A mobile indoor navigation and campus mapping application for the Aristotle University of Thessaloniki (IHU) campus, built with Angular/Ionic and powered by Dijkstra's algorithm for real-time pathfinding.

## Features

- Interactive campus map with Leaflet.js
- Real-time GPS tracking with smart snap-to-path
- Turn-by-turn navigation with heading-up camera
- Automatic rerouting when deviating from path
- Accessibility mode (AMEA) for wheelchair-accessible routes
- Multi-language support (Greek & English)
- Distance and progress tracking
- Works on Android and web

## Tech Stack

**Frontend**
- Angular 19 + Ionic 8
- Leaflet.js + Leaflet Routing Machine
- Capacitor 7 (Android/iOS bridge)
- ngx-translate (i18n)
- RxJS

**Backend**
- Node.js + Express
- TypeScript
- Dijkstra.js for pathfinding

## Getting Started

### Prerequisites

- Node.js & npm
- Angular CLI: `npm install -g @angular/cli@19`
- Ionic CLI: `npm install -g @ionic/cli`

### Frontend

```bash
npm install
npm start
App runs at http://localhost:4200

Backend

cd backend
npm install
npm run dev
API runs at http://localhost:3000

Build for Android

ng build
npx cap sync android
cd android && ./gradlew assembleDebug
API Endpoints
Method	Endpoint	Description
POST	/api/route/campus	Calculate campus route
POST	/api/route/outdoor	Calculate outdoor route
GET	/api/destinations	List campus destinations
Project Structure

UniMap/
├── src/
│   ├── app/
│   │   ├── home/           # Main map page
│   │   ├── services/       # GPS, Map, Route, Settings
│   │   └── components/     # Search bar, modals, dialogs
│   └── assets/
│       └── i18n/           # el.json, en.json
├── backend/
│   └── src/
│       ├── routes/         # Express routes
│       ├── services/       # Pathfinding, geo, accessibility
│       └── data/           # OSM nodes, POIs, destinations
└── android/                # Native Android project
