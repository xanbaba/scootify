from math import cos, hypot, radians
from pathlib import Path
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


Coordinate = tuple[float, float]


def distance_m(a: Coordinate, b: Coordinate) -> float:
    latitude_scale = 111_195
    longitude_scale = latitude_scale * cos(radians((a[0] + b[0]) / 2))
    return hypot((b[0] - a[0]) * latitude_scale, (b[1] - a[1]) * longitude_scale)


def within_bounds(point: Coordinate, bounds: tuple[Coordinate, Coordinate]) -> bool:
    (south, west), (north, east) = bounds
    return south <= point[0] <= north and west <= point[1] <= east


class CampusNode(BaseModel):
    id: str
    latitude: float
    longitude: float


class PathSegment(BaseModel):
    id: str
    name: str
    from_node: str
    to_node: str
    geometry: list[Coordinate] = Field(min_length=2)
    length_m: float = Field(gt=0)
    modes: list[Literal["walk", "bike"]] = Field(min_length=1)
    one_way: bool = False
    walk_direction: Literal["both", "forward", "backward"] | None = None


class RackConnection(BaseModel):
    rack_id: UUID
    node_id: str
    name: str


class Destination(BaseModel):
    id: str
    name: str
    entrance_node: str


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
    destinations: list[Destination]
    demo: DemoTrip | None = None
    bounds: tuple[Coordinate, Coordinate] | None = None
    preset_origin_node: str | None = None

    @property
    def default_start_node(self) -> str:
        if self.preset_origin_node is not None:
            return self.preset_origin_node
        assert self.demo is not None
        return self.demo.origin_node


class CampusNetwork(BaseModel):
    bounds: tuple[Coordinate, Coordinate]
    nodes: list[CampusNode]
    segments: list[PathSegment]
    destinations: list[Destination]


GRAPH_FILE = Path(__file__).with_name("data") / "usf-tampa-demo.json"
NETWORK_FILE = GRAPH_FILE.with_name("usf-tampa-network.json")


def load_graph() -> CampusGraph:
    return CampusGraph.model_validate_json(GRAPH_FILE.read_bytes())
