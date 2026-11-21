from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ValidationError

from .campus import CampusGraph, load_graph
from .campus_wide import CampusMapData, load_route_graph, make_map_data
from .parking import ParkingRack, load_racks
from .routing import RouteRequest, RouteUnavailable, TripRoute, plan_route


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


app = FastAPI(title="Scootify API")
route_graph = load_route_graph(load_graph())
map_data = make_map_data(route_graph)


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
    try:
        return plan_route(route_graph, request)
    except RouteUnavailable as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.get("/api/campus/racks")
def campus_racks() -> list[ParkingRack]:
    try:
        return load_racks()
    except (OSError, ValidationError) as error:
        raise HTTPException(
            status_code=503,
            detail="USF rack inventory unavailable. Run python -m backend.parking to import it.",
        ) from error
