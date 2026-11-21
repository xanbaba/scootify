# Scootify

Scootify helps USF Tampa students plan a trip through campus parking and lets campus staff turn maintenance decisions into route updates.

## Run locally

Use Node.js 22.12+ and Python 3.11+. From the repository root, open two PowerShell terminals.

Backend:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe -m backend.parking
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend:

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev -- --host 127.0.0.1
```

- [Student view](http://127.0.0.1:5173/)
- [Admin view](http://127.0.0.1:5173/admin)
- [API health](http://127.0.0.1:8000/api/health) returns `{"status":"ok"}`. Both React views also check this endpoint through the Vite proxy.

Open both views and check for **API connected**. If the API starts after the frontend, use **Retry** to run the health check again.

Run `npm.cmd run build` from `frontend` to type-check and build the frontend. Run `.\.venv\Scripts\python.exe -m unittest backend.test_campus` from the repository root to check graph connectivity and the closure detour.

## HackJam demo

- **Primary track** — Home Turf. Scootify addresses a local USF Tampa problem by connecting students who report path hazards with the campus staff who can fix them. [HackJam ’26 tracks](https://www.mlh.com/events/hackjam-26)
- **Trip** — Start at the USF Bookstore rack. Ride to the east rack in front of Tampa Library and walk to the main entrance. The map shows the primary approach via Apple Drive and the detour via the southbound Leroy Collins Boulevard bike lane. The checked-in graph connects the Bookstore rack and both front library racks. [USF campus ride, checkpoints 3–4](https://www.cutr.usf.edu/2026/07/roll-safe-bulls/) · [Tampa Library entrance](https://lib.usf.edu/news/new-entrance-for-tampa-library-sets-november-opening/)
- **Closure scenario** — Simulate a pothole on the Collins Boulevard approach path (`osm-43877414-557390886-557390911`). The 544 m primary approach uses this segment. The 570 m detour avoids it. Both connect to the same rack and its 23 m walking approach. Select the path on the map to find the closure demo segment.
- **Navigation design** — Open to a map with destination search. Pick a destination, preview the ride to parking and walk to the entrance, then tap **Go** to follow your GPS position. Allow reporting a path problem from the map. Keep reports and closure controls in a staff dashboard.

## Campus data

- **Parking** — The importer reads all 258 Tampa rack records observed on November 21, 2026, along with their coordinates, condition, and locking-loop counts. USF designates bicycle racks for both bicycles and e-scooters. The [USF ArcGIS service item](https://www.arcgis.com/home/item.html?id=f886ea3ed4084c609d6f35c81b92f7dc) is public and its license field is blank. The app reads a local cache that Git ignores. If the import is unavailable, the map still shows the demo graph and its three linked rack locations. [USF rack layer](https://gis.usf.edu/fmserver/rest/services/Campus_Transportation/Parking_Transportation/MapServer/18) · [USF e-scooter parking guidance](https://www.usf.edu/public-safety/environmental-health-safety/programs-services/e-scooter.aspx)
- **Paths** — `backend/data/usf-tampa-demo.json` uses OpenStreetMap geometry and a small set of rack connections. The graph data is available under the Open Database License (ODbL). Segments have stable IDs, walking and bicycle access flags, and direction where applicable. The graph covers the demo corridor. The student can zoom out to see the full rack inventory. [OpenStreetMap contributors and ODbL](https://www.openstreetmap.org/copyright)

## Frameworks, data, and AI credits

- Frontend uses [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vite.dev/), [Leaflet](https://leafletjs.com/), and [React Leaflet](https://react-leaflet.js.org/).
- Backend uses [FastAPI](https://fastapi.tiangolo.com/), [Pydantic](https://docs.pydantic.dev/), and [Uvicorn](https://www.uvicorn.org/).
- OpenAI Codex helped plan milestones and generated the initial scaffold, rack importer, demo graph and checks, interactive map, and documentation. The project entrant supplied the concept, parking and navigation requirements, campus use case, stack choice, and event rules. Update this record as the project develops and include AI use in the HackJam submission.
