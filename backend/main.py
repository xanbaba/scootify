from contextlib import asynccontextmanager
from typing import Annotated, Literal
from uuid import UUID

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, ValidationError

from .campus import CampusGraph, load_graph, within_bounds
from .campus_wide import CampusMapData, load_route_graph, make_map_data
from .parking import ParkingRack, load_racks
from .reports import DB_PATH, REPORT_PATH_RADIUS_M, Report, ReportDraft, ReportPath, ReportStore, ReportVote
from .routing import MapPoint, RouteRequest, RouteUnavailable, TripRoute, path_projections, plan_route


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


reports = ReportStore(DB_PATH)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    reports.initialize()
    yield


app = FastAPI(title="Scootify API", lifespan=lifespan)
route_graph = load_route_graph(load_graph())
map_data = make_map_data(route_graph)
reportable_segments = {segment.id: segment for segment in route_graph.segments if not segment.id.startswith("access-")}


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


@app.get("/api/campus/graph", response_model_exclude_none=True)
def get_campus_graph() -> CampusGraph:
    return route_graph


@app.get("/api/campus/map")
def get_campus_map() -> CampusMapData:
    return map_data


@app.post("/api/route")
def get_route(request: RouteRequest) -> TripRoute:
    active_reports = reports.list_reports()
    try:
        trip = plan_route(route_graph, request, {report.segment_id for report in active_reports})
    except RouteUnavailable as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    route_segments = {segment_id for leg in (trip.approach, trip.ride, trip.walk) if leg for segment_id in leg.segment_ids}
    trip.warning_ids = [report.id for report in active_reports if report.segment_id in route_segments]
    return trip


def check_report_point(point: MapPoint) -> None:
    if not within_bounds((point.latitude, point.longitude), map_data.bounds):
        raise HTTPException(status_code=422, detail="Place the report pin within the campus map.")


@app.get("/api/report-paths")
def get_report_paths(point: Annotated[MapPoint, Query()]) -> list[ReportPath]:
    check_report_point(point)
    closest = sorted(path_projections(point, reportable_segments.values()), key=lambda snap: snap.distance_m)
    return [
        ReportPath(
            segment_id=snap.segment.id, name=snap.segment.name, geometry=snap.segment.geometry,
            point=snap.point, distance_m=round(snap.distance_m, 1), modes=snap.segment.modes,
        )
        for snap in closest[:5] if snap.distance_m <= REPORT_PATH_RADIUS_M
    ]


@app.get("/api/reports")
def get_reports() -> list[Report]:
    return reports.list_reports()


@app.post("/api/reports", status_code=201)
def post_report(draft: ReportDraft) -> Report:
    check_report_point(draft.point)
    segment = reportable_segments.get(draft.segment_id)
    snap = next(path_projections(draft.point, [segment]), None) if segment is not None else None
    if snap is None or snap.distance_m > REPORT_PATH_RADIUS_M:
        raise HTTPException(status_code=422, detail="Move the pin closer to the affected path and select it again.")
    return reports.create(draft, snap.point)


@app.put("/api/reports/{report_id}/vote")
def vote_on_report(report_id: UUID, vote: ReportVote) -> Report:
    report = reports.vote(report_id, vote)
    if report is None:
        raise HTTPException(status_code=404, detail="This hazard is no longer active.")
    return report


@app.get("/api/admin/reports")
def get_admin_reports() -> list[Report]:
    return reports.list_reports(include_resolved=True)


@app.put("/api/admin/reports/{report_id}/resolution")
def resolve_report(report_id: UUID) -> Report:
    report = reports.resolve(report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="This report does not exist.")
    return report


@app.get("/api/campus/racks")
def campus_racks() -> list[ParkingRack]:
    try:
        return load_racks()
    except (OSError, ValidationError) as error:
        raise HTTPException(
            status_code=503,
            detail="USF rack inventory unavailable. Run python -m backend.parking to import it.",
        ) from error
