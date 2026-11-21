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

Run `npm.cmd run build` from `frontend` to type-check and build the frontend. Run `.\.venv\Scripts\python.exe -m unittest discover` from the repository root to check graph connectivity, rack ranking, and route availability.

## HackJam demo

- **Primary track** — Home Turf. Scootify addresses a local USF Tampa problem by connecting students who report path hazards with the campus staff who can fix them. [HackJam ’26 tracks](https://www.mlh.com/events/hackjam-26)
- **Trip** — Under **Set start** or **Change**, choose **Use Bookstore**, then choose **Library** for a repeatable demo. The map uses a solid line for the ride to parking and dashed lines for walking. [USF campus ride, checkpoints 3–4](https://www.cutr.usf.edu/2026/07/roll-safe-bulls/) · [Tampa Library entrance](https://lib.usf.edu/news/new-entrance-for-tampa-library-sets-november-opening/)
- **Closure scenario** — Simulate a pothole on the Collins Boulevard approach path (`osm-43877414-3566360615-557390886`). The campus graph gives the Bookstore trip a different approach to the east rack when that segment is removed.
- **Live guidance** — Preview the full trip from overhead. Tap **Go** for a tilted view with your heading at the top. If the trip starts on foot, tap **Start riding** when you reach the riding path. Tap **I parked** to switch to the final walk. **End trip** stops tracking and restores the overhead preview.

## Campus data

- **Parking** — The importer reads all 258 Tampa rack records observed on November 21, 2026, along with their coordinates, condition, and locking-loop counts. USF designates bicycle racks for both bicycles and e-scooters. Its public ArcGIS service item has a blank license field. Git ignores the local export. On API startup, the router connects racks to accessible network junctions. If the import is unavailable, it uses the three demo racks. [USF ArcGIS service item](https://www.arcgis.com/home/item.html?id=f886ea3ed4084c609d6f35c81b92f7dc) · [USF scooter parking guidance](https://www.usf.edu/public-safety/environmental-health-safety/programs-services/e-scooter.aspx)
- **Paths** — `backend/data/usf-tampa-network.json` contains the main Tampa campus path network and named building entrances. Segments retain walking and cycling access and direction. Rebuild it with `.\.venv\Scripts\python.exe -m backend.import_campus_paths <osm-xml-extract>` using a campus extract covering 28.0538°–28.0700° N and 82.4270°–82.4007° W. The graph data is available under the Open Database License. [OpenStreetMap contributors and ODbL](https://www.openstreetmap.org/copyright) · [USF campus boundaries](https://services6.arcgis.com/eohpBf8Xt7P2A4up/ArcGIS/rest/services/USF_Campus_Boundaries/FeatureServer/0)

## Route preview

The path graph connects adjacent junctions on mapped pedestrian-area boundaries for walking, including the shortcut outside Engineering II.

The student view uses the browser’s current location when permission is granted. Search for a building or use **Drop a pin**. Use **Pin start** if location is unavailable or to choose another start. Pins show the selected coordinates. When the start is away from the path network, the first walking leg includes a straight-line estimate to the nearest mapped path. Scootify has no indoor path data.

**Go** uses `navigator.geolocation.watchPosition` while the trip is active and the page is visible. The watch is cleared when the trip ends or the page goes into the background. A deployed app needs HTTPS for location access. The local loopback address works for development. [Browser geolocation requirements](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition)

The navigation camera uses the phone compass when permitted, then the device’s GPS course or recent movement. Before a heading is available, it faces the planned route. Devices without a working WebGL context use the overhead GPS view. [Device orientation API](https://www.w3.org/TR/orientation-event/)

`POST /api/route` accepts either a `destination_id` or a `destination` coordinate, plus an optional `start` coordinate. Coordinates have `latitude` and `longitude` fields. Omit `start` for the explicit Bookstore preset. The response contains the selected rack ID, the `approach` (optional first walk), `ride`, and `walk` legs, and the distances from the pins to the network. Each leg includes its coordinates, segment IDs, distance, and estimated time.

The planner checks which riding paths the student can reach on foot, then uses those walking times to calculate the fastest ride to each rack. It includes the final walk from the rack to the destination. The app shows the initial walk only when it appears in the selected trip. Estimates assume 4 m/s on the bike and 1.4 m/s on foot.

## Frameworks, data, and AI credits

- Frontend uses [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vite.dev/), [Leaflet](https://leafletjs.com/), and [React Leaflet](https://react-leaflet.js.org/). The tilted camera uses [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/). Icons use [Lucide](https://lucide.dev/), and the student view uses [Manrope](https://fontsource.org/fonts/manrope).
- Backend uses [FastAPI](https://fastapi.tiangolo.com/), [Pydantic](https://docs.pydantic.dev/), and [Uvicorn](https://www.uvicorn.org/).
- OpenAI Codex helped plan milestones and generated the initial scaffold, rack importer, demo graph, routing, student interface, live GPS integration, tests, and documentation. The project entrant supplied the concept, parking and navigation requirements, interface reference, campus use case, stack choice, and event rules. Update this record as the project develops and include AI use in the HackJam submission.
