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
- **Closure scenario** — Start the **Use Bookstore → Library** trip in Fast mode and open the staff dashboard in another tab. Expand the Collins Boulevard report and click **Start work**, then **Close path**. The student route changes when it next checks for updates. Resolve the report while the path is closed to see that the detour stays in place. Then click **Reopen path** in the same report to restore access.
- **Hazard scenario** — From the student map, use **Report** to mark a pothole on the Collins Boulevard segment at approximately 28.0606169, −82.4128801. Verify the highlighted segment before posting. Plan **Use Bookstore → Library** in **Fast** to see a warning and in **Safer** to see the detour. Use the staff dashboard to review rider observations and mark the hazard resolved. [Demo report pin](https://www.openstreetmap.org/?mlat=28.0606169&mlon=-82.4128801#map=19/28.0606169/-82.4128801)
- **Live guidance** — Preview the full trip from overhead. Tap **Go** for a tilted view with your heading at the top. If the trip starts on foot, tap **Start riding** when you reach the riding path. Tap **I parked** to switch to the final walk. **End trip** stops tracking and restores the overhead preview.

## Campus data

- **Parking** — The importer reads all 258 Tampa rack records observed on November 21, 2026, along with their coordinates, condition, and locking-loop counts. USF designates bicycle racks for both bicycles and e-scooters. Its public ArcGIS service item has a blank license field. Git ignores the local export. On API startup, the router connects racks to accessible network junctions. If the import is unavailable, it uses the three demo racks. [USF ArcGIS service item](https://www.arcgis.com/home/item.html?id=f886ea3ed4084c609d6f35c81b92f7dc) · [USF scooter parking guidance](https://www.usf.edu/public-safety/environmental-health-safety/programs-services/e-scooter.aspx)
- **Paths** — `backend/data/usf-tampa-network.json` contains the main Tampa campus path network and named building entrances. Segments retain walking and cycling access and direction. Rebuild it with `.\.venv\Scripts\python.exe -m backend.import_campus_paths <osm-xml-extract>` using a campus extract covering 28.0538°–28.0700° N and 82.4270°–82.4007° W. The graph data is available under the Open Database License. [OpenStreetMap contributors and ODbL](https://www.openstreetmap.org/copyright) · [USF campus boundaries](https://services6.arcgis.com/eohpBf8Xt7P2A4up/ArcGIS/rest/services/USF_Campus_Boundaries/FeatureServer/0)

## Route preview

The path graph connects walkable path junctions along mapped plaza boundaries. It follows the corners between entrances, so the first walk can take the west side of the Engineering II plaza. These boundary links support walking. Mapped linear paths and walls take precedence over inferred links.

The student view uses the browser’s current location when permission is granted. Search for a building or use **Drop a pin**. Use **Pin start** if location is unavailable or to choose another start. Pins show the selected coordinates. When the start is away from the path network, the first walking leg includes a straight-line estimate to the nearest mapped path. Scootify has no indoor path data.

**Go** uses `navigator.geolocation.watchPosition` while the trip is active and the page is visible. The watch is cleared when the trip ends or the page goes into the background. A deployed app needs HTTPS for location access. The local loopback address works for development. [Browser geolocation requirements](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition)

The navigation camera uses the phone compass when permitted, then the device’s GPS course or recent movement. Before a heading is available, it faces the planned route. Devices without a working WebGL context use the overhead GPS view. [Device orientation API](https://www.w3.org/TR/orientation-event/)

`POST /api/route` accepts either a `destination_id` or a `destination` coordinate, plus an optional `start` coordinate. Coordinates have `latitude` and `longitude` fields. Omit `start` for the explicit Bookstore preset. The response contains the selected rack ID, the `approach` (optional first walk), `ride`, and `walk` legs, and the distances from the pins to the network. Each leg includes its coordinates, segment IDs, distance, and estimated time.

The planner checks which riding paths the student can reach on foot, then uses those walking times to calculate the fastest ride to each rack. It includes the final walk from the rack to the destination. The app shows the initial walk only when it appears in the selected trip. Estimates assume 4 m/s on the bike and 1.4 m/s on foot.

## Campus hazard reports

Tap **Report** on the student map. The form suggests a GPS pin and lets the rider move it by tapping the map. It highlights the selected path before posting. The description supports phone keyboard dictation and suggests a category from common phrases. The rider can select a category directly.

Fast mode minimizes travel time. Safer adds a 60-second routing cost to each traversal of a segment with an active report. The ETA uses physical travel time in both modes. During GPS navigation, an on-route hazard ahead appears in a dismissible banner. After the GPS check detects a pass, **Still there** and **Looks clear** stay available for up to 25 seconds.

SQLite stores reports, rider observations, and path closures at `backend/data/scootify.sqlite3`. Set `SCOOTIFY_DB_PATH` before running the API to use a separate database. The demo counts one current observation per report and browser. Staff can move a report from Open to In progress to Resolved. Resolving it clears the warning and cost. Staff can close and reopen its path independently.

The student view checks routing updates every two seconds while visible and checks again when brought to the foreground. Both modes exclude closed segments from every leg. During navigation, Scootify replans from the latest reliable campus GPS fix when available. Once parked, it replans the remaining walk. Reloading the student tab restores the selected trip and mode. The local prototype uses a shared demo admin view without staff sign-in.

## Frameworks, data, and AI credits

- Frontend uses [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vite.dev/), [Leaflet](https://leafletjs.com/), and [React Leaflet](https://react-leaflet.js.org/). The tilted camera uses [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/). Icons use [Lucide](https://lucide.dev/), and the student view uses [Manrope](https://fontsource.org/fonts/manrope).
- Backend uses [FastAPI](https://fastapi.tiangolo.com/), [Pydantic](https://docs.pydantic.dev/), and [Uvicorn](https://www.uvicorn.org/).
- OpenAI Codex helped plan milestones and generated the initial scaffold, rack importer, demo graph, routing, student interface, live GPS integration, hazard reporting and voting, staff queue, path closures, live rerouting, tests, and documentation. The project entrant supplied the concept, parking and navigation requirements, interface reference, campus use case, stack choice, and event rules. Update this record as the project develops and include AI use in the HackJam submission.
