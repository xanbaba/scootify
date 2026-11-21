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
npm.cmd install
npm.cmd run dev
```

- [Student view](http://localhost:5173/)
- [Admin view](http://localhost:5173/admin)
- [API health](http://127.0.0.1:8000/api/health) returns `{"status":"ok"}`. Both React views also check this endpoint through the Vite proxy.

Run `npm.cmd run build` from `frontend` to type-check and build the frontend.

## HackJam demo

- **Primary track** — Home Turf. The project addresses USF Tampa campus travel and gives students a way to report path problems to the team that can act on them. Best Overall is an additional submission option for the same project.
- **Trip** — Start at Cooper Hall, ride to a verified bike rack near Tampa Library, and walk to the library entrance.
- **Closure scenario** — Close a segment on the shorter approach to the rack. Show the report warning in Fast mode, show the Safer detour, then show both modes avoiding an official closure. Reopen the segment at the end.
- **Map data gate** — Confirm the exact rack, entrance, closure segment, and connected alternate approach when building the path graph. The closure is a demo scenario.

## Frameworks, data, and AI credits

- Frontend uses [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), and [Vite](https://vite.dev/).
- Backend uses [FastAPI](https://fastapi.tiangolo.com/), [Pydantic](https://docs.pydantic.dev/), and [Uvicorn](https://www.uvicorn.org/).
- Demo planning references include the [USF facilities maps](https://www.usf.edu/facilities/facilities-information-services/maps.aspx), [Tampa Library directions](https://lib.usf.edu/about/maps-directions/), and [USF Parking and Transportation GIS service](https://maps.usf.edu/server/rest/services/Parking_and_Transportation/MapServer). Data import is part of the next milestone.
- OpenAI Codex helped break down milestones, draft setup documentation, and generate the initial React and FastAPI scaffold. The project entrant supplied the concept, campus use case, stack choice, and event rules. Update this record as the project develops and include AI use in the HackJam submission.
