import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { latLngBounds, type Map as LeafletMap, type PathOptions } from "leaflet";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";

type Coordinate = [number, number];
type Location = { latitude: number; longitude: number };
type Rack = Location & { id: string; condition: string | null; loops: number | null };
type CampusData = {
  bounds: [Coordinate, Coordinate];
  bookstore: Coordinate;
  destinations: { id: string; name: string; point: Coordinate }[];
  routable_racks: { id: string; name: string; point: Coordinate }[];
};
type StartSelection = { point: Coordinate; source: "gps" | "pin" | "bookstore" };
type DestinationSelection = { id: string } | { point: Coordinate };
type MapSelection = "start" | "destination";
type RouteLeg = { geometry: Coordinate[]; duration_seconds: number };
type TripRoute = {
  rack_id: string;
  ride: RouteLeg;
  walk: RouteLeg;
  snap_distance_m: number;
  destination_snap_distance_m: number;
};
type RouteResult = { route: TripRoute } | { error: string; retryable?: boolean };

const rideStyle = { className: "trip-ride", color: "#127453", weight: 6, interactive: false };
const walkStyle = { className: "trip-walk", color: "#a54d13", weight: 5, dashArray: "4 5", interactive: false };
const boundsOptions = { padding: [42, 42] as Coordinate, maxZoom: 18 };

function requestPoint(point: Coordinate): Location {
  return { latitude: point[0], longitude: point[1] };
}

async function getCampusData<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error("Campus data request returned " + response.status);
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

function MapPointPicker({ onPick }: { onPick: ((point: Coordinate) => void) | null }) {
  useMapEvents({ click: ({ latlng }) => onPick?.([latlng.lat, latlng.lng]) });
  return null;
}

function formatTime(seconds: number): string {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return minutes ? minutes + " min" + (remainder ? " " + remainder + " sec" : "") : rounded + " sec";
}

const startLabels = {
  gps: "Your current location",
  pin: "Pinned start",
  bookstore: "USF Bookstore",
};

function LoadedCampusMap({ campus, racks }: { campus: CampusData; racks: Rack[] | null }) {
  const map = useRef<LeafletMap | null>(null);
  const locationRequest = useRef(0);
  const [start, setStart] = useState<StartSelection | null>(null);
  const [destination, setDestination] = useState<DestinationSelection | null>(null);
  const [picking, setPicking] = useState<MapSelection | null>(null);
  const [locating, setLocating] = useState(true);
  const [locationMessage, setLocationMessage] = useState("");
  const [result, setResult] = useState<RouteResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const route = result && "route" in result ? result.route : null;
  const failure = result && "error" in result ? result : null;
  const namedId = destination && "id" in destination ? destination.id : "";
  const namedDestination = campus.destinations.find(({ id }) => id === namedId);
  const destinationPin = destination && "point" in destination ? destination.point : null;
  const destinationPoint = destinationPin ?? namedDestination?.point;
  const parkingPoint = route?.walk.geometry[0];
  const parkingSide = parkingPoint && destinationPoint && parkingPoint[1] > destinationPoint[1] ? "right" : "left";
  const parkingName = campus.routable_racks.find(({ id }) => id === route?.rack_id)?.name ?? "Parking rack";
  const selectedRack = racks?.find(({ id }) => id === route?.rack_id);
  const campusBounds = latLngBounds(campus.bounds);

  const locate = useCallback(() => {
    const request = ++locationRequest.current;
    setPicking(null);
    setLocating(true);
    setLocationMessage("");

    function locationFailed(message: string) {
      if (request !== locationRequest.current) return;
      setLocating(false);
      setLocationMessage(message);
    }

    if (!navigator.geolocation) {
      locationFailed("Location is unavailable in this browser. Pick a start on the map.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (request !== locationRequest.current) return;
        const point: Coordinate = [coords.latitude, coords.longitude];
        if (!latLngBounds(campus.bounds).contains(point)) {
          locationFailed("Your location is outside USF Tampa. Pick a start on campus.");
          return;
        }
        setLocating(false);
        setResult(null);
        setStart({ point, source: "gps" });
      },
      (error) => {
        if (error.code === 1) {
          locationFailed("Location permission is off. Allow it in your browser or pick a start on the map.");
        } else {
          locationFailed("Your location is unavailable. Try again or pick a start on the map.");
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }, [campus.bounds]);

  useEffect(() => {
    locate();
    return () => { locationRequest.current += 1; };
  }, [locate]);

  useEffect(() => {
    if (!start || !destination) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort();
      setResult({ error: "The route service timed out.", retryable: true });
    }, 8000);

    async function calculateTrip(origin: StartSelection, target: DestinationSelection) {
      try {
        const response = await fetch("/api/route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...("id" in target ? { destination_id: target.id } : { destination: requestPoint(target.point) }),
            start: origin.source === "bookstore" ? null : requestPoint(origin.point),
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

    void calculateTrip(start, destination);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [start, destination, attempt]);

  useEffect(() => {
    if (!route || !start || !destinationPoint) return;
    const points = [start.point, destinationPoint, ...route.ride.geometry, ...route.walk.geometry];
    map.current?.fitBounds(latLngBounds(points), boundsOptions);
  }, [route, start, destinationPoint]);

  function chooseStart(point: Coordinate, source: StartSelection["source"]) {
    locationRequest.current += 1;
    setLocating(false);
    setLocationMessage("");
    setResult(null);
    setStart({ point, source });
    setPicking(null);
  }

  function chooseDestination(selection: DestinationSelection | null) {
    setResult(null);
    setDestination(selection);
    setPicking(null);
  }

  function togglePicker(selection: MapSelection) {
    if (selection === "start") {
      locationRequest.current += 1;
      setLocating(false);
    }
    map.current?.closePopup();
    setPicking((previous) => previous === selection ? null : selection);
  }

  function onMapPoint(point: Coordinate) {
    if (picking === "start") chooseStart(point, "pin");
    if (picking === "destination") chooseDestination({ point });
  }

  const rackMarkers = racks?.map((rack) => ({
    id: rack.id, point: [rack.latitude, rack.longitude] as Coordinate, rack, name: "Parking rack",
  })) ?? campus.routable_racks.map(({ id, point, name }) => ({ id, point, rack: undefined, name }));
  const offPathPins = route && (route.snap_distance_m >= 8 || route.destination_snap_distance_m >= 8);

  return (
    <>
      <div className="planner">
        <div className="destination-field">
          <label htmlFor="destination">Destination</label>
          <div className="destination-controls map-controls">
            <select id="destination" value={namedId} onChange={(event) => {
              chooseDestination(event.target.value ? { id: event.target.value } : null);
            }}>
              <option value="">{destinationPin ? "Pinned destination" : "Choose a building"}</option>
              {campus.destinations.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select>
            <button type="button" aria-pressed={picking === "destination"} onClick={() => togglePicker("destination")}>
              {picking === "destination" ? "Cancel picking" : "Pin destination"}
            </button>
          </div>
        </div>
        <div className="planner-start">
          <span>{locating ? "Finding your location…" : start ? startLabels[start.source] : "Choose a start"}</span>
          <div className="map-controls">
            <button type="button" onClick={locate} disabled={locating}>Use my location</button>
            <button type="button" aria-pressed={picking === "start"} onClick={() => togglePicker("start")}>
              {picking === "start" ? "Cancel picking" : "Pin start"}
            </button>
            <button type="button" onClick={() => chooseStart(campus.bookstore, "bookstore")}>Use Bookstore</button>
          </div>
        </div>
        {picking && <p className="planner-hint" role="status">Tap the campus map to set your {picking}.</p>}
        {locationMessage && <p className="planner-hint" role="status">{locationMessage}</p>}
      </div>
      <div className="route-status" role="status" aria-live="polite">
        {route && (
          <div className="route-summary">
            <strong>{formatTime(route.ride.duration_seconds + route.walk.duration_seconds)} estimated</strong>
            <span>Bike to {parkingName} · {formatTime(route.ride.duration_seconds)}</span>
            <span>{destinationPin ? "Walk to destination" : "Walk to entrance"} · {formatTime(route.walk.duration_seconds)}</span>
          </div>
        )}
        {offPathPins && <p className="map-message">Route lines reach the nearest mapped paths to your pins.</p>}
        {destination && !start && !locating && <p className="map-message">Choose a start to see the route.</p>}
        {start && destination && !result && <p className="map-message">Calculating your trip…</p>}
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
        bounds={campusBounds}
        boundsOptions={boundsOptions}
        className="campus-map"
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <MapPointPicker onPick={picking ? onMapPoint : null} />
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
        {start && (
          <TripMarker
            point={start.point} accent="#127453" label={start.source === "gps" ? "You" : "Start"}
            side="left" className="trip-start"
          />
        )}
        {parkingPoint && (
          <TripMarker point={parkingPoint} accent="#3456a1" label={parkingName} side={parkingSide} className="parking-rack trip-parking">
            <RackDetails rack={selectedRack} />
          </TripMarker>
        )}
        {destinationPoint && (
          <TripMarker
            point={destinationPoint} accent="#a54d13" label={destinationPin ? "Destination" : "Entrance"}
            side={parkingSide === "left" ? "right" : "left"} className="trip-entrance"
          />
        )}
      </MapContainer>
      <ul className="map-legend" aria-label="Map legend">
        {route && <li className="legend-ride">Bike to rack</li>}
        {route && <li className="legend-walk">Walk to destination</li>}
        <li className="legend-rack">Parking rack</li>
      </ul>
      <div className="map-toolbar">
        <span>{rackMarkers.length} shared parking racks</span>
        <div className="map-controls" role="group" aria-label="Map view">
          <button type="button" onClick={() => map.current?.fitBounds(campusBounds, boundsOptions)}>Fit campus</button>
        </div>
      </div>
      {!racks && <p role="status" className="map-message">Rack condition and locking-loop counts are unavailable.</p>}
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
  const [data, setData] = useState<{ campus: CampusData; racks: Rack[] | null } | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    Promise.allSettled([
      getCampusData<CampusData>("/api/campus/map", signal),
      getCampusData<Rack[]>("/api/campus/racks", signal),
    ]).then(([campus, racks]) => {
      if (signal.aborted) return;
      if (campus.status === "rejected") {
        setUnavailable(true);
        return;
      }
      setData({ campus: campus.value, racks: racks.status === "fulfilled" ? racks.value : null });
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
