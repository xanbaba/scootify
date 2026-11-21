from uuid import UUID

from pydantic import BaseModel, ValidationError

from .campus import (
    NETWORK_FILE, CampusGraph, CampusNetwork, CampusNode, Coordinate, PathSegment,
    RackConnection, distance_m, within_bounds,
)
from .parking import load_racks


class MapDestination(BaseModel):
    id: str
    name: str
    point: Coordinate


class MapRack(BaseModel):
    id: UUID
    name: str
    point: Coordinate


class CampusMapData(BaseModel):
    bounds: tuple[Coordinate, Coordinate]
    bookstore: Coordinate
    destinations: list[MapDestination]
    routable_racks: list[MapRack]


def load_route_graph(demo: CampusGraph) -> CampusGraph:
    network = CampusNetwork.model_validate_json(NETWORK_FILE.read_bytes())
    nodes = {node.id: (node.latitude, node.longitude) for node in network.nodes}
    demo_nodes = {node.id: (node.latitude, node.longitude) for node in demo.nodes}
    named_racks = {rack.rack_id: rack.name for rack in demo.rack_connections}
    try:
        sources = [(rack.id, (rack.latitude, rack.longitude)) for rack in load_racks()]
    except (OSError, ValidationError):
        sources = [(rack.rack_id, demo_nodes[rack.node_id]) for rack in demo.rack_connections]

    mode_nodes = {mode: set() for mode in ("walk", "bike")}
    for segment in network.segments:
        for mode in segment.modes:
            mode_nodes[mode].update((segment.from_node, segment.to_node))
    shared_nodes = sorted(mode_nodes["walk"] & mode_nodes["bike"])

    connections = []
    for rack_id, point in sources:
        if not within_bounds(point, network.bounds):
            continue
        nearest = min(shared_nodes, key=lambda node: distance_m(point, nodes[node]))
        length = distance_m(point, nodes[nearest])
        if length > 65:
            continue

        rack_node = f"rack-{rack_id}"
        name = named_racks.get(rack_id, "Campus parking rack")
        network.nodes.append(CampusNode(id=rack_node, latitude=point[0], longitude=point[1]))
        network.segments.append(PathSegment(
            id=f"access-{rack_id}", name="Parking rack access", from_node=nearest, to_node=rack_node,
            geometry=[nodes[nearest], point], length_m=max(length, 0.01), modes=["walk", "bike"],
        ))
        connections.append(RackConnection(rack_id=rack_id, node_id=rack_node, name=name))

    return CampusGraph(
        bounds=network.bounds, nodes=network.nodes, segments=network.segments,
        rack_connections=connections, destinations=network.destinations,
        preset_origin_node=demo.default_start_node,
    )


def make_map_data(graph: CampusGraph) -> CampusMapData:
    assert graph.bounds is not None
    locations = {node.id: (node.latitude, node.longitude) for node in graph.nodes}
    return CampusMapData(
        bounds=graph.bounds,
        bookstore=locations[graph.default_start_node],
        destinations=[
            MapDestination(id=entry.id, name=entry.name, point=locations[entry.entrance_node])
            for entry in graph.destinations
        ],
        routable_racks=[
            MapRack(id=rack.rack_id, name=rack.name, point=locations[rack.node_id])
            for rack in graph.rack_connections
        ],
    )
