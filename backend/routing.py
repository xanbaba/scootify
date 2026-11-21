from collections import defaultdict
from dataclasses import dataclass
from heapq import heappop, heappush
from math import cos, hypot, radians
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from .campus import CampusGraph, Coordinate, PathSegment


BIKE_SPEED_MPS = 4.0
WALK_SPEED_MPS = 1.4
MAX_SNAP_DISTANCE_M = 35
METERS_PER_DEGREE = 111_195
MAP_START_NODE = "map-start"


class MapPoint(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class RouteRequest(BaseModel):
    destination_id: str
    start: MapPoint | None = None


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


def build_adjacency(
    segments: list[PathSegment], mode: Literal["bike", "walk"], *, reverse: bool = False
) -> Adjacency:
    adjacency: Adjacency = defaultdict(list)
    for segment in segments:
        if mode not in segment.modes:
            continue
        start, end, geometry = segment.from_node, segment.to_node, segment.geometry
        if reverse:
            start, end, geometry = end, start, geometry[::-1]
        adjacency[start].append(Traversal(end, segment.id, geometry, segment.length_m))
        if not segment.one_way:
            adjacency[end].append(Traversal(start, segment.id, geometry[::-1], segment.length_m))
    return adjacency


def shortest_paths(adjacency: Adjacency, start: str, speed_mps: float) -> ShortestPaths:
    durations = {start: 0.0}
    previous: dict[str, tuple[str, Traversal]] = {}
    queue = [(0.0, start)]
    while queue:
        duration, node = heappop(queue)
        if duration != durations[node]:
            continue
        for traversal in adjacency.get(node, ()):
            candidate = duration + traversal.length_m / speed_mps
            if candidate < durations.get(traversal.target, float("inf")):
                durations[traversal.target] = candidate
                previous[traversal.target] = (node, traversal)
                heappush(queue, (candidate, traversal.target))
    return ShortestPaths(durations, previous)


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
        duration_seconds=round(paths.durations[target], 1),
    )


def prepare_map_start(
    point: MapPoint, segments: list[PathSegment], bike_graph: Adjacency
) -> tuple[str, Coordinate, float]:
    # Project coordinates onto a local plane at the clicked latitude.
    longitude_scale = METERS_PER_DEGREE * cos(radians(point.latitude))

    def offset(coordinate: Coordinate) -> tuple[float, float]:
        latitude, longitude = coordinate
        return (latitude - point.latitude) * METERS_PER_DEGREE, (longitude - point.longitude) * longitude_scale

    nearest = None
    nearest_distance = float("inf")
    for segment in segments:
        if "bike" not in segment.modes:
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

    if nearest is None or nearest_distance > MAX_SNAP_DISTANCE_M:
        raise RouteUnavailable(f"Choose a start within {MAX_SNAP_DISTANCE_M} m of a mapped cycling path.")

    segment, index, fraction = nearest
    geometry = segment.geometry
    a, b = geometry[index - 1], geometry[index]
    if fraction == 0:
        snapped = a
    elif fraction == 1:
        snapped = b
    else:
        snapped = (a[0] + fraction * (b[0] - a[0]), a[1] + fraction * (b[1] - a[1]))
    if snapped == geometry[0]:
        return segment.from_node, snapped, nearest_distance
    if snapped == geometry[-1]:
        return segment.to_node, snapped, nearest_distance

    leading = geometry[:index]
    trailing = geometry[index:]
    if leading[-1] != snapped:
        leading.append(snapped)
    if trailing[0] != snapped:
        trailing.insert(0, snapped)

    def shape_length(shape: list[Coordinate]) -> float:
        return sum(
            hypot((p[0] - q[0]) * METERS_PER_DEGREE, (p[1] - q[1]) * longitude_scale)
            for p, q in zip(shape, shape[1:])
        )

    start_distance = shape_length(leading)
    end_distance = shape_length(trailing)
    scale = segment.length_m / (start_distance + end_distance)
    bike_graph[MAP_START_NODE] = [Traversal(segment.to_node, segment.id, trailing, end_distance * scale)]
    if not segment.one_way:
        bike_graph[MAP_START_NODE].append(
            Traversal(segment.from_node, segment.id, leading[::-1], start_distance * scale)
        )
    return MAP_START_NODE, snapped, nearest_distance


def plan_route(graph: CampusGraph, request: RouteRequest) -> TripRoute:
    destination = next((item for item in graph.destinations if item.id == request.destination_id), None)
    if destination is None:
        raise RouteUnavailable("Choose a mapped campus destination.")

    locations = {node.id: (node.latitude, node.longitude) for node in graph.nodes}
    bike_graph = build_adjacency(graph.segments, "bike")
    if request.start is None:
        origin = graph.demo.origin_node
        start, snap_distance = locations[origin], 0.0
    else:
        origin, start, snap_distance = prepare_map_start(request.start, graph.segments, bike_graph)

    ride_paths = shortest_paths(bike_graph, origin, BIKE_SPEED_MPS)
    walk_graph = build_adjacency(graph.segments, "walk", reverse=True)
    walk_paths = shortest_paths(walk_graph, destination.entrance_node, WALK_SPEED_MPS)
    candidates = []
    for rack in graph.rack_connections:
        ride_time = ride_paths.durations.get(rack.node_id)
        walk_time = walk_paths.durations.get(rack.node_id)
        if ride_time is not None and walk_time is not None:
            candidates.append((ride_time + walk_time, rack.rack_id, rack.node_id))

    if not candidates:
        raise RouteUnavailable("No bike-and-walk trip is available from this start. Choose another point.")

    _, rack_id, rack_node = min(candidates)
    return TripRoute(
        rack_id=rack_id,
        ride=make_leg(ride_paths, rack_node, start),
        walk=make_leg(walk_paths, rack_node, locations[destination.entrance_node], reverse=True),
        snap_distance_m=round(snap_distance, 1),
    )
