import { useEffect, useRef, useState, type ReactNode } from "react";
import { latLngBounds, type Map as LeafletMap, type PathOptions } from "leaflet";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";

type Location = { latitude: number; longitude: number };
type Coordinate = [number, number];
type Rack = Location & { id: string; condition: string | null; loops: number | null };
type CampusNode = Location & { id: string };
type CampusGraph = {
  nodes: CampusNode[];
  segments: { id: string; geometry: Coordinate[]; modes: ("walk" | "bike")[] }[];
  rack_connections: { rack_id: string; node_id: string; name: string }[];
  destinations: { id: string; name: string; entrance_node: string }[];
  demo: { origin_node: string };
};
type RouteLeg = { geometry: Coordinate[]; distance_m: number; duration_seconds: number };
type TripRoute = { rack_id: string; ride: RouteLeg; walk: RouteLeg; snap_distance_m: number };
type RouteResult = { route: TripRoute } | { error: string; retryable?: boolean };

const rideStyle = { className: "trip-ride", color: "#127453", weight: 6, interactive: false };
const walkStyle = { className: "trip-walk", color: "#a54d13", weight: 5, dashArray: "4 5", interactive: false };

function position(location: Location): Coordinate {
  return [location.latitude, location.longitude];
}

async function getCampusData<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) {
    throw new Error("Campus data request returned " + response.status);
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

function MapStartPicker({ onPick }: { onPick: ((point: Coordinate) => void) | null }) {
  useMapEvents({
    click: ({ latlng }) => onPick?.([latlng.lat, latlng.lng]),
  });
  return null;
}

function formatTime(seconds: number): string {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return minutes ? minutes + " min" + (remainder ? " " + remainder + " sec" : "") : rounded + " sec";
}

const boundsOptions = { padding: [42, 42] as Coordinate, maxZoom: 18 };

function LoadedCampusMap({ graph, racks }: { graph: CampusGraph; racks: Rack[] | null }) {
  const map = useRef<LeafletMap | null>(null);
  const [destinationId, setDestinationId] = useState("");
  const [start, setStart] = useState<Coordinate | null>(null);
  const [selectingStart, setSelectingStart] = useState(false);
  const [result, setResult] = useState<RouteResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const route = result && "route" in result ? result.route : null;
  const failure = result && "error" in result ? result : null;

  const destination = graph.destinations.find(({ id }) => id === destinationId);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const originNode = nodesById.get(graph.demo.origin_node);
  const entranceNode = destination && nodesById.get(destination.entrance_node);
  const startPoint = route?.ride.geometry[0] ?? start ?? (originNode && position(originNode));
  const parkingPoint = route?.walk.geometry[0];
  const parkingName = graph.rack_connections.find(({ rack_id }) => rack_id === route?.rack_id)?.name ?? "Selected rack";
  const selectedRack = racks?.find(({ id }) => id === route?.rack_id);
  const demoBounds = latLngBounds(graph.nodes.map(position));

  useEffect(() => {
    if (!destinationId) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort();
      setResult({ error: "The route service timed out.", retryable: true });
    }, 8000);

    async function calculateTrip() {
      try {
        const response = await fetch("/api/route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            destination_id: destinationId,
            start: start ? { latitude: start[0], longitude: start[1] } : null,
          }),
          signal: controller.signal,
        });
        if (response.ok) {
          const trip: TripRoute = await response.json();
          if (!controller.signal.aborted) setResult({ route: trip });
        } else if (response.status === 404) {
          const body: { detail?: unknown } = await response.json();
          if (!controller.signal.aborted) {
            setResult({ error: typeof body.detail === "string" ? body.detail : "No route is available." });
          }
        } else {
          throw new Error("The route service returned an unexpected status.");
        }
      } catch {
        if (!controller.signal.aborted) {
          setResult({ error: "The route service is unavailable.", retryable: true });
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }

    void calculateTrip();
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [destinationId, start, attempt]);

  useEffect(() => {
    if (route) {
      const tripBounds = latLngBounds([...route.ride.geometry, ...route.walk.geometry]);
      map.current?.fitBounds(tripBounds, boundsOptions);
    }
  }, [route]);

  function chooseStart(point: Coordinate | null) {
    setResult(null);
    setStart(point);
    setSelectingStart(false);
  }

  const rackMarkers = racks?.map((rack) => ({ id: rack.id, point: position(rack), rack, name: "Parking rack" }))
    ?? graph.rack_connections.flatMap(({ rack_id, node_id, name }) => {
      const node = nodesById.get(node_id);
      return node ? [{ id: rack_id, point: position(node), rack: undefined, name }] : [];
    });

  return (
    <>
      <div className="planner">
        <label className="destination-field">
          <span>Destination</span>
          <select value={destinationId} onChange={(event) => {
            setResult(null);
            setDestinationId(event.target.value);
          }}>
            <option value="">Choose a destination</option>
            {graph.destinations.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <div className="planner-start">
          <span>{start ? "Start on map" : "Start at USF Bookstore"}</span>
          <div className="map-controls">
            <button type="button" aria-pressed={selectingStart} onClick={() => setSelectingStart(!selectingStart)}>
              {selectingStart ? "Cancel picking" : "Pick start on map"}
            </button>
            {start && <button type="button" onClick={() => chooseStart(null)}>Use Bookstore</button>}
          </div>
        </div>
        {selectingStart && <p className="planner-hint">Tap near a highlighted cycling path to set your start.</p>}
      </div>
      <div className="route-status" role="status" aria-live="polite">
        {route && (
          <div className="route-summary">
            <strong>{formatTime(route.ride.duration_seconds + route.walk.duration_seconds)} estimated</strong>
            <span>Bike to {parkingName} · {formatTime(route.ride.duration_seconds)}</span>
            <span>Walk to entrance · {formatTime(route.walk.duration_seconds)}</span>
          </div>
        )}
        {route && route.snap_distance_m >= 1 && <p className="map-message">Start snapped to the nearest cycling path.</p>}
        {destinationId && !result && <p className="map-message">Calculating your trip…</p>}
        {failure && <p className="map-message route-error">{failure.error}</p>}
      </div>
      {failure?.retryable && (
        <div className="map-controls route-retry">
          <button type="button" onClick={() => {
            setResult(null);
            setAttempt((previous) => previous + 1);
          }}>Retry route</button>
        </div>
      )}
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
        <MapStartPicker onPick={selectingStart ? chooseStart : null} />
        {selectingStart && graph.segments.filter(({ modes }) => modes.includes("bike")).map(({ id, geometry }) => (
          <Polyline key={id} positions={geometry} pathOptions={{ color: "#596c64", weight: 4, interactive: false }} />
        ))}
        {route && route.ride.geometry.length > 1 && <Polyline positions={route.ride.geometry} pathOptions={rideStyle} />}
        {route && route.walk.geometry.length > 1 && <Polyline positions={route.walk.geometry} pathOptions={walkStyle} />}
        {rackMarkers.filter(({ id }) => id !== route?.rack_id).map(({ id, point, rack, name }) => (
          <CircleMarker
            key={id}
            center={point}
            radius={5}
            pathOptions={{
              className: "parking-rack", color: "#fff", weight: 1.5,
              fillColor: "#3456a1", fillOpacity: 0.9,
            }}
          >
            <Popup><strong>{name}</strong><RackDetails rack={rack} /></Popup>
          </CircleMarker>
        ))}
        {startPoint && (
          <TripMarker point={startPoint} accent="#127453" label="Start" side="left" className="trip-start" />
        )}
        {parkingPoint && (
          <TripMarker point={parkingPoint} accent="#3456a1" label={parkingName} side="left" className="parking-rack trip-parking">
            <RackDetails rack={selectedRack} />
          </TripMarker>
        )}
        {entranceNode && (
          <TripMarker point={position(entranceNode)} accent="#a54d13" label="Entrance" side="right" className="trip-entrance" />
        )}
      </MapContainer>
      <ul className="map-legend" aria-label="Map legend">
        {route && <li className="legend-ride">Bike to rack</li>}
        {route && <li className="legend-walk">Walk to entrance</li>}
        <li className="legend-rack">Parking rack</li>
      </ul>
      <div className="map-toolbar">
        <span>{racks ? racks.length + " shared parking racks" : "Demo parking racks"}</span>
        <div className="map-controls" role="group" aria-label="Map view">
          <button type="button" onClick={() => map.current?.fitBounds(demoBounds, boundsOptions)}>Route area</button>
          {racks && (
            <button type="button" onClick={() => map.current?.fitBounds(latLngBounds(racks.map(position)), boundsOptions)}>
              All racks
            </button>
          )}
        </div>
      </div>
      {!racks && <p role="status" className="map-message">The full USF parking inventory is unavailable. Demo racks are shown.</p>}
    </>
  );
}

function TripMarker({ point, accent, label, side, className, children }: {
  point: Coordinate;
  accent: string;
  label: string;
  side: "left" | "right";
  className: string;
  children?: ReactNode;
}) {
  const style: PathOptions = { className, color: "#fff", weight: 2, fillColor: accent, fillOpacity: 1 };
  return (
    <CircleMarker center={point} radius={6} pathOptions={style}>
      <Tooltip permanent direction={side} offset={[side === "left" ? -8 : 8, 0]}>{label}</Tooltip>
      {children && <Popup><strong>{label}</strong>{children}</Popup>}
    </CircleMarker>
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
