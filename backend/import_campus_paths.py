import argparse
import json
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from hashlib import sha256
from pathlib import Path

from .campus import CampusNode, Destination, NETWORK_FILE, PathSegment, distance_m, load_graph, within_bounds


BOUNDS = ((28.0547, -82.4260), (28.0692, -82.4019))
PATH_TYPES = {
    "cycleway", "footway", "path", "pedestrian", "steps", "track", "service", "road",
    "residential", "living_street", "unclassified", "tertiary", "tertiary_link", "secondary",
}
RESTRICTED = {"no", "private", "customers", "permit", "delivery", "agricultural", "forestry"}
PUBLIC_ACCESS = {"yes", "designated", "permissive", "official"}


def tags(element: ET.Element) -> dict[str, str]:
    return {tag.attrib["k"]: tag.attrib["v"] for tag in element.findall("tag")}


def node_refs(way: ET.Element) -> list[str]:
    return [node.attrib["ref"] for node in way.findall("nd")]


def modes_for(attributes: dict[str, str]) -> list[str]:
    highway = attributes.get("highway")
    if highway not in PATH_TYPES or attributes.get("area") == "yes" or attributes.get("indoor") == "yes":
        return []
    general_access = attributes.get("access") not in RESTRICTED
    mode_tags = {"walk": attributes.get("foot"), "bike": attributes.get("bicycle")}
    modes = [
        mode for mode, access in mode_tags.items()
        if access in PUBLIC_ACCESS or (general_access and access not in RESTRICTED)
    ]
    if "bike" in modes and (highway == "steps" or mode_tags["bike"] in {"dismount", "use_sidepath"}):
        modes.remove("bike")
    if "walk" in modes and attributes.get("foot") == "use_sidepath":
        modes.remove("walk")
    return modes


def main_component(segments: list[PathSegment], mode: str) -> set[str]:
    linked = defaultdict(list)
    for segment in segments:
        if mode in segment.modes:
            linked[segment.from_node].append(segment.to_node)
            linked[segment.to_node].append(segment.from_node)
    visited: set[str] = set()
    largest: set[str] = set()
    for node in linked:
        if node in visited:
            continue
        component = {node}
        queue = [node]
        for current in queue:
            for neighbor in linked[current]:
                if neighbor not in component:
                    component.add(neighbor)
                    queue.append(neighbor)
        visited.update(component)
        if len(component) > len(largest):
            largest = component
    return largest


def build_network(source: Path) -> None:
    osm = ET.parse(source).getroot()
    points = {
        node.attrib["id"]: (float(node.attrib["lat"]), float(node.attrib["lon"]))
        for node in osm.findall("node")
    }
    entrances = {
        node.attrib["id"]: attributes["entrance"]
        for node in osm.findall("node")
        if (attributes := tags(node)).get("entrance") in {"main", "yes"}
        and attributes.get("access") not in RESTRICTED
    }
    ways = [(way, tags(way), node_refs(way)) for way in osm.findall("way")]
    path_ways = [(way, attrs, refs, modes) for way, attrs, refs in ways if (modes := modes_for(attrs))]
    demo = load_graph()
    junction_counts = Counter(node for _, _, refs, _ in path_ways for node in refs)
    split_nodes = {node for node, count in junction_counts.items() if count > 1}
    split_nodes.update(entrances)
    split_nodes.update(node.id for node in demo.nodes)

    segments = []
    segment_ids: set[str] = set()
    for way, attrs, refs, modes in path_ways:
        if len(refs) < 2 or any(ref not in points for ref in refs):
            continue
        bike_direction = attrs.get("oneway:bicycle", attrs.get("oneway"))
        if bike_direction is None and attrs.get("junction") == "roundabout":
            bike_direction = "yes"
        if attrs.get("highway") in {"footway", "path", "pedestrian"} and "oneway:bicycle" not in attrs:
            bike_direction = None
        walk_direction = {"yes": "forward", "-1": "backward"}.get(attrs.get("oneway:foot"), "both")
        cuts = [0, *(i for i, node in enumerate(refs[1:-1], 1) if node in split_nodes), len(refs) - 1]
        if refs[0] == refs[-1] and len(cuts) == 2:
            cuts.insert(1, len(refs) // 2)
        for begin, end in zip(cuts, cuts[1:]):
            ids = refs[begin:end + 1]
            direction = walk_direction
            if bike_direction == "-1":
                ids.reverse()
                direction = {"forward": "backward", "backward": "forward"}.get(direction, "both")
            start, finish = ids[0], ids[-1]
            geometry = [points[node] for node in ids]
            length = sum(distance_m(a, b) for a, b in zip(geometry, geometry[1:]))
            if length == 0 or start == finish:
                continue
            low, high = sorted((start, finish))
            segment_id = f"osm-{way.attrib['id']}-{low}-{high}"
            if segment_id in segment_ids:
                suffix = sha256("/".join(ids).encode()).hexdigest()[:10]
                segment_id = f"{segment_id}-{suffix}"
            if segment_id in segment_ids:
                continue
            segment_ids.add(segment_id)
            segments.append(PathSegment(
                id=segment_id,
                name=attrs.get("name", attrs["highway"].replace("_", " ").capitalize()),
                from_node=start, to_node=finish, geometry=geometry, length_m=round(length, 3),
                modes=modes, one_way=bike_direction in {"yes", "1", "true", "-1"}, walk_direction=direction,
            ))

    components = {mode: main_component(segments, mode) for mode in ("bike", "walk")}
    connected = []
    for segment in segments:
        modes = [mode for mode in segment.modes if segment.from_node in components[mode]]
        if modes:
            connected.append(segment.model_copy(update={"modes": modes}))

    node_ids = {node for segment in connected for node in (segment.from_node, segment.to_node)}
    nodes = [CampusNode(id=node, latitude=points[node][0], longitude=points[node][1]) for node in sorted(node_ids)]
    destinations = [item for item in demo.destinations if item.entrance_node in components["walk"]]
    entrance_ids = {item.entrance_node for item in destinations}
    destination_names = {item.name.casefold() for item in destinations}
    for way, attrs, refs in ways:
        name = attrs.get("name")
        if "building" not in attrs or not name or name.casefold() in destination_names:
            continue
        candidates = [
            node for node in refs if node in entrances and node in components["walk"]
            and node not in entrance_ids and within_bounds(points[node], BOUNDS)
        ]
        if candidates:
            entrance = min(candidates, key=lambda node: (entrances[node] != "main", node))
            destinations.append(Destination(id=f"osm-building-{way.attrib['id']}", name=name, entrance_node=entrance))
            entrance_ids.add(entrance)
            destination_names.add(name.casefold())

    if not destinations or demo.default_start_node not in components["bike"]:
        raise ValueError("The map extract is missing the Bookstore or Library connection")
    if len({segment.id for segment in connected}) != len(connected):
        raise ValueError("The map extract produced duplicate segment IDs")

    with NETWORK_FILE.open("w", encoding="utf-8", newline="\n") as output:
        output.write('{\n  "bounds": ' + json.dumps(BOUNDS) + ",\n")
        destinations.sort(key=lambda destination: destination.name.casefold())
        for key, entries in (("nodes", nodes), ("segments", connected), ("destinations", destinations)):
            output.write(f'  "{key}": [\n')
            output.write(",\n".join("    " + entry.model_dump_json(exclude_none=True) for entry in entries))
            output.write("\n  ]" + (",\n" if key != "destinations" else "\n"))
        output.write("}\n")
    print(f"Imported {len(nodes)} junctions, {len(connected)} paths, and {len(destinations)} entrances.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build the campus graph from a local OpenStreetMap XML extract.")
    parser.add_argument("source", type=Path)
    build_network(parser.parse_args().source)
