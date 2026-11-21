import { useEffect, useRef, useState } from "react";
import { latLngBounds, type Map as LeafletMap, type PathOptions } from "leaflet";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";

type Location = { latitude: number; longitude: number };
type Coordinate = [number, number];
type Rack = Location & { id: string; condition: string | null; loops: number | null };
type CampusNode = Location & { id: string };
type Segment = {
  id: string;
  name: string;
  geometry: Coordinate[];
  modes: ("walk" | "bike")[];
};
type CampusGraph = {
  nodes: CampusNode[];
  segments: Segment[];
  rack_connections: { rack_id: string; node_id: string }[];
  demo: {
    origin_node: string;
    parking_node: string;
    entrance_node: string;
    closure_segment: string;
    primary_segments: string[];
    detour_segments: string[];
    walk_segments: string[];
  };
};

const pathStyles = {
  primary: { color: "#127453", weight: 5, opacity: 0.95 },
  detour: { color: "#3456a1", weight: 5, opacity: 0.95, dashArray: "9 6" },
  shared: { color: "#324744", weight: 5, opacity: 0.9 },
  walk: { color: "#a54d13", weight: 5, opacity: 0.95, dashArray: "2 7" },
} satisfies Record<string, PathOptions>;

function position(location: Location): Coordinate {
  return [location.latitude, location.longitude];
}

async function getCampusData<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) {
    throw new Error(`Campus data request returned ${response.status}`);
  }
  return response.json();
}

function RackDetails({ rack }: { rack?: Rack }) {
  return (
    <>
      <div>Bicycles and scooters</div>
      {rack?.loops != null && <div>Locking loops: {rack.loops}</div>}
      {rack?.condition && <div>USF condition rating: {rack.condition.toLowerCase()}</div>}
    </>
  );
}

function LoadedCampusMap({ graph, racks }: { graph: CampusGraph; racks: Rack[] | null }) {
  const map = useRef<LeafletMap | null>(null);
  const { demo } = graph;
  const demoBounds = latLngBounds(graph.nodes.map(position));
  const racksById = new Map(racks?.map((rack) => [rack.id, rack]));
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const racksByNode = new Map(graph.rack_connections.map(({ node_id, rack_id }) => [node_id, rack_id]));
  const places = [
    { node: demo.origin_node, label: "Start · USF Bookstore", color: "#127453", side: "left" },
    { node: demo.parking_node, label: "Library rack", color: "#3456a1", side: "left" },
    { node: demo.entrance_node, label: "Library entrance", color: "#a54d13", side: "right" },
  ] as const;
  const featuredRackIds = new Set(places.map(({ node }) => racksByNode.get(node)));
  const primary = new Set(demo.primary_segments);
  const detour = new Set(demo.detour_segments);
  const walk = new Set(demo.walk_segments);

  function segmentStyle(id: string) {
    if (primary.has(id) && detour.has(id)) return pathStyles.shared;
    if (primary.has(id)) return pathStyles.primary;
    if (detour.has(id)) return pathStyles.detour;
    return walk.has(id) ? pathStyles.walk : pathStyles.shared;
  }

  const boundsOptions = { padding: [35, 35] as Coordinate, maxZoom: 18 };

  return (
    <>
      <div className="map-toolbar">
        <span>{racks ? `${racks.length} shared parking racks` : "Demo parking racks"}</span>
        <div className="map-controls" aria-label="Map view">
          <button type="button" onClick={() => map.current?.fitBounds(demoBounds, boundsOptions)}>
            Demo area
          </button>
          {racks && (
            <button
              type="button"
              onClick={() => map.current?.fitBounds(latLngBounds(racks.map(position)), boundsOptions)}
            >
              All racks
            </button>
          )}
        </div>
      </div>
      <MapContainer
        ref={map}
        bounds={demoBounds}
        boundsOptions={boundsOptions}
        className="campus-map"
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        {graph.segments.map((segment) => (
          <Polyline key={segment.id} positions={segment.geometry} pathOptions={segmentStyle(segment.id)}>
            <Popup>
              <strong>{segment.name}</strong>
              <div>{segment.modes.map((mode) => mode === "walk" ? "Walking" : "Cycling").join(" · ")}</div>
              {segment.id === demo.closure_segment && <div>Closure demo segment</div>}
            </Popup>
          </Polyline>
        ))}
        {racks?.filter((rack) => !featuredRackIds.has(rack.id)).map((rack) => (
          <CircleMarker
            key={rack.id}
            center={position(rack)}
            radius={5}
              pathOptions={{
                className: "parking-rack", color: "#fff", weight: 1.5,
                fillColor: "#3456a1", fillOpacity: 0.9,
              }}
          >
            <Popup>
              <strong>Parking rack</strong>
              <RackDetails rack={rack} />
            </Popup>
          </CircleMarker>
        ))}
        {!racks && graph.rack_connections.filter(({ rack_id }) => !featuredRackIds.has(rack_id)).map(({ rack_id, node_id }) => {
          const node = nodesById.get(node_id);
          if (!node) return null;
          return (
            <CircleMarker key={rack_id} center={position(node)} radius={5} pathOptions={{ color: "#3456a1" }}>
              <Popup>Demo parking rack</Popup>
            </CircleMarker>
          );
        })}
        {places.map(({ node, label, color, side }) => {
          const rackId = racksByNode.get(node);
          const rack = rackId ? racksById.get(rackId) : undefined;
          const location = rack ?? nodesById.get(node);
          if (!location) return null;
          return (
            <CircleMarker
              key={node}
              center={position(location)}
              radius={8}
              pathOptions={{
                className: rack ? "parking-rack demo-marker" : "demo-marker",
                color: "#fff", weight: 2, fillColor: color, fillOpacity: 1,
              }}
            >
              <Tooltip permanent direction={side} offset={[side === "left" ? -9 : 9, 0]}>
                {label}
              </Tooltip>
              <Popup>
                <strong>{label}</strong>
                {rackId && <RackDetails rack={rack} />}
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
      <ul className="map-legend" aria-label="Map legend">
        <li className="legend-primary">Primary approach</li>
        <li className="legend-detour">Detour</li>
        <li className="legend-shared">Shared path</li>
        <li className="legend-walk">Walk to entrance</li>
        <li className="legend-rack">Parking rack</li>
      </ul>
      {!racks && <p role="status" className="map-message">The full USF parking inventory is unavailable. Demo racks are shown.</p>}
    </>
  );
}

export function CampusMap() {
  const [data, setData] = useState<{ graph: CampusGraph; racks: Rack[] | null } | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    Promise.allSettled([
      getCampusData<CampusGraph>("/api/campus/graph", signal),
      getCampusData<Rack[]>("/api/campus/racks", signal),
    ]).then(([graph, racks]) => {
      if (signal.aborted) return;
      if (graph.status === "rejected") {
        setUnavailable(true);
        return;
      }
      setData({ graph: graph.value, racks: racks.status === "fulfilled" ? racks.value : null });
    });

    return () => controller.abort();
  }, []);

  return (
    <section className="map-panel" aria-label="USF Tampa campus map">
      {data ? <LoadedCampusMap {...data} /> : (
        <p role="status" className="map-message">
          {unavailable ? "Campus map unavailable. Check the API and reload the page." : "Loading campus map…"}
        </p>
      )}
    </section>
  );
}
