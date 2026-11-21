from collections import defaultdict
from collections.abc import Collection, Iterable, Iterator
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
HAZARD_PENALTY_SECONDS = 60
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
    mode: Literal["fast", "safer"] = "fast"
    parked_rack_id: UUID | None = None

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
    ride: RouteLeg | None
    walk: RouteLeg
    snap_distance_m: float
    destination_snap_distance_m: float
    approach: RouteLeg | None = None
    warning_ids: list[UUID] = Field(default_factory=list)


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
    fraction: float
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
    adjacency: Adjacency, start_times: dict[str, float], speed_mps: float,
    hazard_segments: Collection[str] = (),
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
            if traversal.length_m > 0 and traversal.segment_id in hazard_segments:
                candidate += HAZARD_PENALTY_SECONDS
            if candidate < durations.get(traversal.target, float("inf")):
                durations[traversal.target] = candidate
                previous[traversal.target] = (node, traversal)
                starts[traversal.target] = starts[node]
                heappush(queue, (candidate, traversal.target))
    return ShortestPaths(durations, previous, starts)


def make_leg(
    paths: ShortestPaths, target: str, start: Coordinate, speed_mps: float, *, reverse: bool = False
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
    distance = sum(traversal.length_m for traversal in traversals)
    return RouteLeg(
        geometry=geometry,
        segment_ids=segment_ids,
        distance_m=round(distance, 1),
        duration_seconds=round(distance / speed_mps, 1),
    )


def path_projections(point: MapPoint, segments: Iterable[PathSegment]) -> Iterator[PathSnap]:
    # Project coordinates onto a local plane at the clicked latitude.
    longitude_scale = METERS_PER_DEGREE * cos(radians(point.latitude))

    def offset(coordinate: Coordinate) -> tuple[float, float]:
        latitude, longitude = coordinate
        return (latitude - point.latitude) * METERS_PER_DEGREE, (longitude - point.longitude) * longitude_scale

    for segment in segments:
        nearest = None
        nearest_distance = float("inf")
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
                nearest = index, a, b, fraction
                nearest_distance = distance
        if nearest is not None:
            index, a, b, fraction = nearest
            if fraction == 0:
                snapped = a
            elif fraction == 1:
                snapped = b
            else:
                snapped = (a[0] + fraction * (b[0] - a[0]), a[1] + fraction * (b[1] - a[1]))
            yield PathSnap(segment=segment, index=index, fraction=fraction, point=snapped, distance_m=nearest_distance)


def snap_map_point(
    point: MapPoint, graph: CampusGraph, endpoint: Literal["start", "destination"], *, walk_only: bool = False,
) -> PathSnap:
    if graph.bounds and not within_bounds((point.latitude, point.longitude), graph.bounds):
        raise RouteUnavailable(f"The {endpoint} is outside the USF Tampa routing area. Pick a point on campus.")
    eligible = (
        segment for segment in graph.segments
        if not segment.id.startswith("access-")
        and ((not walk_only and endpoint != "destination") or "walk" in segment.modes)
    )
    nearest = min(path_projections(point, eligible), key=lambda projection: projection.distance_m, default=None)
    if nearest is None:
        raise RouteUnavailable(f"No mapped path is available for this {endpoint}.")
    return nearest


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


def connect_walk_origin(
    walk_graph: Adjacency, origin_snap: PathSnap, entrance_snap: PathSnap | None, entrance_node: str,
) -> str:
    # The walking search starts at the entrance and runs backward, so invert exits from the start pin.
    exits: Adjacency = defaultdict(list)
    origin = connect_snap(origin_snap, exits, "walk", MAP_START_NODE)
    for traversal in exits[origin]:
        walk_graph[traversal.target].append(
            Traversal(origin, traversal.segment_id, traversal.geometry[::-1], traversal.length_m)
        )

    if entrance_snap is None or entrance_snap.segment.id != origin_snap.segment.id or origin == entrance_node:
        return origin
    if origin_snap.point == entrance_snap.point:
        walk_graph[entrance_node].append(Traversal(origin, origin_snap.segment.id, [origin_snap.point], 0))
        return origin
    # Two pins on the same path can walk directly between their projections.
    start, end = sorted((origin_snap, entrance_snap), key=lambda snap: (snap.index, snap.fraction))
    direction = travel_direction(start.segment, "walk")
    if (start is origin_snap and direction == "backward") or (end is origin_snap and direction == "forward"):
        return origin
    geometry = [start.point, *start.segment.geometry[start.index:end.index], end.point]
    if start is origin_snap:
        geometry.reverse()
    length = sum(distance_m(a, b) for a, b in zip(geometry, geometry[1:]))
    walk_graph[entrance_node].append(Traversal(origin, start.segment.id, geometry, length))
    return origin


def plan_route(
    graph: CampusGraph, request: RouteRequest, hazard_segments: Collection[str] = (), *,
    closed_segments: Collection[str] = (),
) -> TripRoute:
    if closed_segments:
        graph = graph.model_copy(update={"segments": [segment for segment in graph.segments if segment.id not in closed_segments]})
    locations = {node.id: (node.latitude, node.longitude) for node in graph.nodes}
    penalties = hazard_segments if request.mode == "safer" else ()
    walk_graph = build_adjacency(graph.segments, "walk", reverse=True)
    entrance_snap = None
    if request.destination is not None:
        entrance_snap = snap_map_point(request.destination, graph, "destination")
        entrance_node = connect_snap(entrance_snap, walk_graph, "walk", MAP_DESTINATION_NODE, reverse=True)
        entrance, destination_snap = entrance_snap.point, entrance_snap.distance_m
    else:
        destination = next((item for item in graph.destinations if item.id == request.destination_id), None)
        if destination is None:
            raise RouteUnavailable("Choose a mapped campus destination.")
        entrance_node = destination.entrance_node
        entrance, destination_snap = locations[entrance_node], 0.0

    if request.parked_rack_id is not None:
        rack = next((rack for rack in graph.rack_connections if rack.rack_id == request.parked_rack_id), None)
        if rack is None:
            raise RouteUnavailable("The parked rack is no longer on the campus map.")
        origin, snap_distance = rack.node_id, 0.0
        if request.start is not None:
            snap = snap_map_point(request.start, graph, "start", walk_only=True)
            origin = connect_walk_origin(walk_graph, snap, entrance_snap, entrance_node)
            snap_distance = snap.distance_m
        walk_paths = shortest_paths(walk_graph, {entrance_node: 0.0}, WALK_SPEED_MPS, penalties)
        if origin not in walk_paths.durations:
            raise RouteUnavailable("No walking route is available to this destination.")
        return TripRoute(
            rack_id=rack.rack_id, ride=None, walk=make_leg(walk_paths, origin, entrance, WALK_SPEED_MPS, reverse=True),
            snap_distance_m=round(snap_distance, 1), destination_snap_distance_m=round(destination_snap, 1),
        )

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

    # The costs to start cycling at reachable junctions are their approach walking times.
    approach_paths = shortest_paths(approach_graph, {origin: 0.0}, WALK_SPEED_MPS, penalties)
    parking_nodes = {rack.node_id for rack in graph.rack_connections}
    start_times = {
        node: duration for node, duration in approach_paths.durations.items()
        if node in bike_graph and node not in parking_nodes
    }
    ride_paths = shortest_paths(bike_graph, start_times, BIKE_SPEED_MPS, penalties)
    walk_paths = shortest_paths(walk_graph, {entrance_node: 0.0}, WALK_SPEED_MPS, penalties)
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
        approach = make_leg(approach_paths, boarding_node, start, WALK_SPEED_MPS)
        if request.start is not None and snap_distance > 0:
            approach.geometry.insert(0, (request.start.latitude, request.start.longitude))
            approach.distance_m = round(approach.distance_m + snap_distance, 1)
            approach.duration_seconds = round(approach.duration_seconds + snap_distance / WALK_SPEED_MPS, 1)
    return TripRoute(
        rack_id=rack_id,
        approach=approach,
        ride=make_leg(ride_paths, rack_node, locations[boarding_node], BIKE_SPEED_MPS),
        walk=make_leg(walk_paths, rack_node, entrance, WALK_SPEED_MPS, reverse=True),
        snap_distance_m=round(snap_distance, 1),
        destination_snap_distance_m=round(destination_snap, 1),
    )
