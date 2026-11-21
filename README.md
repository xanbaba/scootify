# Scootify

Scootify helps USF Tampa students plan a trip through campus parking and lets campus staff turn maintenance decisions into route updates.

## Run locally

Use Node.js 22.12+ and Python 3.11+. From the repository root, open two PowerShell terminals.

Backend:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
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

Run `npm.cmd run build` from `frontend` to type-check and build the frontend.

## HackJam demo

- **Primary track** — Home Turf. Scootify addresses a local USF Tampa problem by connecting students who report path hazards with the campus staff who can fix them. [HackJam ’26 tracks](https://www.mlh.com/events/hackjam-26)
- **Trip** — Start at the USF Bookstore bike rack. Ride via Acorn Court past the John and Grace Allen Building to the bike rack in front of Tampa Library. Walk from the rack to the library’s main entrance. [USF campus ride, checkpoints 3–4](https://www.cutr.usf.edu/2026/07/roll-safe-bulls/) · [Tampa Library entrance](https://lib.usf.edu/news/new-entrance-for-tampa-library-sets-november-opening/)
- **Closure scenario** — Report a simulated pothole on the Acorn Court path beside the Collins Boulevard Parking Facility. Use the route via the Leroy Collins Boulevard bike lane and USF Apple Drive as the candidate detour. Show Fast carrying a warning, Safer choosing the detour, and both modes detouring when staff close the affected segment. Reopen the segment to restore access. [USF campus ride and bike lanes](https://www.cutr.usf.edu/2026/07/roll-safe-bulls/) · [USF parking map](https://www.usf.edu/parking/documents/parkingmap.pdf)
- **Path graph verification** — Confirm the rack and entrance coordinates, which links connect the detour to the rack, and where riding is allowed when building the graph. The milestone 1 views show the demo setup and API connection.

## Frameworks, data, and AI credits

- Frontend uses [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), and [Vite](https://vite.dev/).
- Backend uses [FastAPI](https://fastapi.tiangolo.com/), [Pydantic](https://docs.pydantic.dev/), and [Uvicorn](https://www.uvicorn.org/).
- Demo planning references include the [USF facilities maps](https://www.usf.edu/facilities/facilities-information-services/maps.aspx), [Tampa Library directions](https://lib.usf.edu/about/maps-directions/), and [USF Parking and Transportation GIS service](https://maps.usf.edu/server/rest/services/Parking_and_Transportation/MapServer). Data import is part of the next milestone.
- OpenAI Codex helped break down milestones, generate the initial React and FastAPI scaffold, define the demo trip using USF sources, and verify the app locally. The project entrant supplied the concept, campus use case, stack choice, and event rules. Update this record as the project develops and include AI use in the HackJam submission.
