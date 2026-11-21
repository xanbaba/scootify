from collections import defaultdict
from dataclasses import dataclass
from heapq import heapify, heappop, heappush
from math import cos, hypot, radians
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from .campus import CampusGraph, Coordinate, PathSegment, distance_m, within_bounds


BIKE_SPEED_MPS = 4.0
WALK_SPEED_MPS = 1.4
METERS_PER_DEGREE = 111_195
START_SNAP_TOLERANCE_M = 8
MAP_START_NODE = "map-start"
MAP_DESTINATION_NODE = "map-destination"
Mode = Literal["bike", "walk"]


class MapPoint(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class RouteRequest(BaseModel):
    destination_id: str | None = None
    destination: MapPoint | None = None
    start: MapPoint | None = None

    @model_validator(mode="after")
    def require_one_destination(self) -> "RouteRequest":
        if (self.destination_id is None) == (self.destination is None):
            raise ValueError("Provide one named destination or one destination coordinate")
        return self


class RouteLeg(BaseModel):
    geometry: list[Coordinate]
    segment_ids: list[str]
    distance_m: float
    duration_seconds: float


class TripRoute(BaseModel):
    rack_id: UUID
    ride: RouteLeg
    walk: RouteLeg
    snap_distance_m: float
    destination_snap_distance_m: float
    approach: RouteLeg | None = None


class RouteUnavailable(Exception):
    pass


@dataclass(frozen=True)
class Traversal:
    target: str
    segment_id: str
    geometry: list[Coordinate]
    length_m: float


Adjacency = dict[str, list[Traversal]]


@dataclass
class ShortestPaths:
    durations: dict[str, float]
    previous: dict[str, tuple[str, Traversal]]
    starts: dict[str, str]


@dataclass(frozen=True)
class PathSnap:
    segment: PathSegment
    index: int
    point: Coordinate
    distance_m: float


def travel_direction(segment: PathSegment, mode: Mode) -> Literal["forward", "backward", "both"]:
    if mode == "walk" and segment.walk_direction is not None:
        return segment.walk_direction
    return "forward" if segment.one_way else "both"


def build_adjacency(
    segments: list[PathSegment], mode: Mode, *, reverse: bool = False
) -> Adjacency:
    adjacency: Adjacency = defaultdict(list)
    for segment in segments:
        if mode not in segment.modes:
            continue
        start, end, geometry = segment.from_node, segment.to_node, segment.geometry
        direction = travel_direction(segment, mode)
        if reverse != (direction == "backward"):
            start, end, geometry = end, start, geometry[::-1]
        adjacency[start].append(Traversal(end, segment.id, geometry, segment.length_m))
        if direction == "both":
            adjacency[end].append(Traversal(start, segment.id, geometry[::-1], segment.length_m))
    return adjacency


def shortest_paths(
    adjacency: Adjacency, start_times: dict[str, float], speed_mps: float
) -> ShortestPaths:
    durations = start_times.copy()
    previous: dict[str, tuple[str, Traversal]] = {}
    starts = {node: node for node in start_times}
    queue = [(duration, node) for node, duration in start_times.items()]
    heapify(queue)
    while queue:
        duration, node = heappop(queue)
        if duration != durations[node]:
            continue
        for traversal in adjacency.get(node, ()):
            candidate = duration + traversal.length_m / speed_mps
            if candidate < durations.get(traversal.target, float("inf")):
                durations[traversal.target] = candidate
                previous[traversal.target] = (node, traversal)
                starts[traversal.target] = starts[node]
                heappush(queue, (candidate, traversal.target))
    return ShortestPaths(durations, previous, starts)


def make_leg(
    paths: ShortestPaths, target: str, start: Coordinate, *, reverse: bool = False
) -> RouteLeg:
    traversals = []
    node = target
    while node in paths.previous:
        node, traversal = paths.previous[node]
        traversals.append(traversal)
    traversals.reverse()
    geometry = [start]
    segment_ids = []
    for traversal in traversals:
        geometry.extend(traversal.geometry[1:])
        segment_ids.append(traversal.segment_id)
    if reverse:
        geometry.reverse()
        segment_ids.reverse()
    return RouteLeg(
        geometry=geometry,
        segment_ids=segment_ids,
        distance_m=round(sum(traversal.length_m for traversal in traversals), 1),
        duration_seconds=round(paths.durations[target] - paths.durations[node], 1),
    )


def snap_map_point(point: MapPoint, graph: CampusGraph, endpoint: Literal["start", "destination"]) -> PathSnap:
    if graph.bounds and not within_bounds((point.latitude, point.longitude), graph.bounds):
        raise RouteUnavailable(f"The {endpoint} is outside the USF Tampa routing area. Pick a point on campus.")

    # Project coordinates onto a local plane at the clicked latitude.
    longitude_scale = METERS_PER_DEGREE * cos(radians(point.latitude))

    def offset(coordinate: Coordinate) -> tuple[float, float]:
        latitude, longitude = coordinate
        return (latitude - point.latitude) * METERS_PER_DEGREE, (longitude - point.longitude) * longitude_scale

    nearest = None
    nearest_distance = float("inf")
    for segment in graph.segments:
        if segment.id.startswith("access-") or (endpoint == "destination" and "walk" not in segment.modes):
            continue
        for index, (a, b) in enumerate(zip(segment.geometry, segment.geometry[1:]), start=1):
            ay, ax = offset(a)
            by, bx = offset(b)
            dy, dx = by - ay, bx - ax
            square_length = dy * dy + dx * dx
            if square_length == 0:
                continue
            fraction = max(0.0, min(1.0, -(ay * dy + ax * dx) / square_length))
            distance = hypot(ay + fraction * dy, ax + fraction * dx)
            if distance < nearest_distance:
                nearest = segment, index, fraction
                nearest_distance = distance

    if nearest is None:
        raise RouteUnavailable(f"No mapped path is available for this {endpoint}.")
    segment, index, fraction = nearest
    geometry = segment.geometry
    a, b = geometry[index - 1], geometry[index]
    if fraction == 0:
        snapped = a
    elif fraction == 1:
        snapped = b
    else:
        snapped = (a[0] + fraction * (b[0] - a[0]), a[1] + fraction * (b[1] - a[1]))
    return PathSnap(segment=segment, index=index, point=snapped, distance_m=nearest_distance)


def connect_snap(
    snap: PathSnap, adjacency: Adjacency, mode: Mode, virtual_node: str, *, reverse: bool = False,
) -> str:
    segment, index, snapped = snap.segment, snap.index, snap.point
    geometry = segment.geometry
    if snapped == geometry[0]:
        return segment.from_node
    if snapped == geometry[-1]:
        return segment.to_node
    if mode not in segment.modes:
        return virtual_node

    leading = geometry[:index]
    trailing = geometry[index:]
    if leading[-1] != snapped:
        leading.append(snapped)
    if trailing[0] != snapped:
        trailing.insert(0, snapped)

    start_distance = sum(distance_m(p, q) for p, q in zip(leading, leading[1:]))
    end_distance = sum(distance_m(p, q) for p, q in zip(trailing, trailing[1:]))
    scale = segment.length_m / (start_distance + end_distance)
    direction = travel_direction(segment, mode)
    trailing_allowed = direction != ("forward" if reverse else "backward")
    leading_allowed = direction != ("backward" if reverse else "forward")
    if trailing_allowed:
        adjacency[virtual_node].append(Traversal(segment.to_node, segment.id, trailing, end_distance * scale))
    if leading_allowed:
        adjacency[virtual_node].append(
            Traversal(segment.from_node, segment.id, leading[::-1], start_distance * scale)
        )
    return virtual_node


def plan_route(graph: CampusGraph, request: RouteRequest) -> TripRoute:
    locations = {node.id: (node.latitude, node.longitude) for node in graph.nodes}
    bike_graph = build_adjacency(graph.segments, "bike")
    approach_graph = build_adjacency(graph.segments, "walk")
    if request.start is None:
        origin = graph.default_start_node
        start, snap_distance = locations[origin], 0.0
    else:
        snap = snap_map_point(request.start, graph, "start")
        origin = connect_snap(snap, bike_graph, "bike", MAP_START_NODE)
        connect_snap(snap, approach_graph, "walk", MAP_START_NODE)
        start, snap_distance = snap.point, snap.distance_m
        locations[origin] = start

    walk_graph = build_adjacency(graph.segments, "walk", reverse=True)
    if request.destination is not None:
        snap = snap_map_point(request.destination, graph, "destination")
        entrance_node = connect_snap(snap, walk_graph, "walk", MAP_DESTINATION_NODE, reverse=True)
        entrance, destination_snap = snap.point, snap.distance_m
    else:
        destination = next((item for item in graph.destinations if item.id == request.destination_id), None)
        if destination is None:
            raise RouteUnavailable("Choose a mapped campus destination.")
        entrance_node = destination.entrance_node
        entrance, destination_snap = locations[entrance_node], 0.0

    # The costs to start cycling at reachable junctions are their approach walking times.
    approach_paths = shortest_paths(approach_graph, {origin: 0.0}, WALK_SPEED_MPS)
    parking_nodes = {rack.node_id for rack in graph.rack_connections}
    start_times = {
        node: duration for node, duration in approach_paths.durations.items()
        if node in bike_graph and node not in parking_nodes
    }
    ride_paths = shortest_paths(bike_graph, start_times, BIKE_SPEED_MPS)
    walk_paths = shortest_paths(walk_graph, {entrance_node: 0.0}, WALK_SPEED_MPS)
    candidates = []
    for rack in graph.rack_connections:
        ride_time = ride_paths.durations.get(rack.node_id)
        walk_time = walk_paths.durations.get(rack.node_id)
        if ride_time is not None and walk_time is not None:
            candidates.append((ride_time + walk_time, rack.rack_id, rack.node_id))

    if not candidates:
        raise RouteUnavailable("No bike-and-walk trip is available from this start. Choose another point.")

    _, rack_id, rack_node = min(candidates)
    boarding_node = ride_paths.starts[rack_node]
    approach = None
    if boarding_node != origin or snap_distance >= START_SNAP_TOLERANCE_M:
        approach = make_leg(approach_paths, boarding_node, start)
        if request.start is not None and snap_distance > 0:
            approach.geometry.insert(0, (request.start.latitude, request.start.longitude))
            approach.distance_m = round(approach.distance_m + snap_distance, 1)
            approach.duration_seconds = round(approach.duration_seconds + snap_distance / WALK_SPEED_MPS, 1)
    return TripRoute(
        rack_id=rack_id,
        approach=approach,
        ride=make_leg(ride_paths, rack_node, locations[boarding_node]),
        walk=make_leg(walk_paths, rack_node, entrance, reverse=True),
        snap_distance_m=round(snap_distance, 1),
        destination_snap_distance_m=round(destination_snap, 1),
    )
