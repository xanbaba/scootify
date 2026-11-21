from pathlib import Path
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class CampusNode(BaseModel):
    id: str
    latitude: float
    longitude: float


class PathSegment(BaseModel):
    id: str
    name: str
    from_node: str
    to_node: str
    geometry: list[tuple[float, float]] = Field(min_length=2)
    length_m: float = Field(gt=0)
    modes: list[Literal["walk", "bike"]] = Field(min_length=1)
    one_way: bool = False


class RackConnection(BaseModel):
    rack_id: UUID
    node_id: str


class DemoTrip(BaseModel):
    origin_node: str
    parking_node: str
    entrance_node: str
    closure_segment: str
    primary_segments: list[str]
    detour_segments: list[str]
    walk_segments: list[str]


class CampusGraph(BaseModel):
    nodes: list[CampusNode]
    segments: list[PathSegment]
    rack_connections: list[RackConnection]
    demo: DemoTrip


GRAPH_FILE = Path(__file__).with_name("data") / "usf-tampa-demo.json"


def load_graph() -> CampusGraph:
    return CampusGraph.model_validate_json(GRAPH_FILE.read_bytes())
