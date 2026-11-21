import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowLeft, ArrowRight, ArrowUpRight, Bike, ChevronDown, CircleParking, Compass,
  Crosshair, Footprints, LocateFixed, MapPin, Minus, Navigation, Plus, Route, X,
} from "lucide-react";
import { latLngBounds, type Map as LeafletMap, type PathOptions } from "leaflet";
import { Circle, CircleMarker, MapContainer, Polyline, Popup, Rectangle, TileLayer, Tooltip, useMapEvents } from "react-leaflet";
import { DestinationSearch, placeName, type CampusPlace } from "./DestinationSearch";
import { useLiveLocation } from "./useLiveLocation";
import "@fontsource-variable/manrope";
import "leaflet/dist/leaflet.css";
import "./navigator.css";

type Coordinate = [number, number];
type Location = { latitude: number; longitude: number };
type Rack = Location & { id: string; condition: string | null; loops: number | null };
type CampusData = {
  bounds: [Coordinate, Coordinate];
  bookstore: Coordinate;
  destinations: CampusPlace[];
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

const rideStyle = { className: "trip-ride", color: "#08755c", weight: 7, interactive: false };
const walkStyle = { className: "trip-walk", color: "#b45921", weight: 6, dashArray: "3 8", interactive: false };
const routeOutline = { color: "#ffffff", weight: 11, opacity: 0.94, interactive: false };
const rackStyle = { className: "parking-rack", color: "#fff", weight: 1.4, fillColor: "#276954", fillOpacity: 0.9 };

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

function MapInteraction({ onPick, onDrag }: { onPick: ((point: Coordinate) => void) | null; onDrag: () => void }) {
  useMapEvents({ click: ({ latlng }) => onPick?.([latlng.lat, latlng.lng]), dragstart: onDrag });
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

function NavigatorHeader() {
  return (
    <header className="navigator-header">
      <a href="/" className="navigator-brand" aria-label="Scootify home">
        <span className="navigator-brand-mark"><Route aria-hidden="true" size={24} strokeWidth={2.5} /></span>
        <span className="navigator-brand-text"><strong>Scootify</strong><small>USF Tampa</small></span>
      </a>
      <a href="/admin" className="staff-link">Staff dashboard <ArrowUpRight aria-hidden="true" size={15} /></a>
    </header>
  );
}

function IconButton({ label, onClick, children, pressed }: {
  label: string; onClick: () => void; children: ReactNode; pressed?: boolean;
}) {
  return (
    <button className="map-icon-button" type="button" onClick={onClick} title={label} aria-label={label} aria-pressed={pressed}>
      {children}
    </button>
  );
}

function LoadedCampusMap({ campus, racks }: { campus: CampusData; racks: Rack[] | null }) {
  const map = useRef<LeafletMap | null>(null);
  const sheet = useRef<HTMLElement | null>(null);
  const locationRequest = useRef(0);
  const navigationSequence = useRef(0);
  const alignedSession = useRef<number | null>(null);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [start, setStart] = useState<StartSelection | null>(null);
  const [destination, setDestination] = useState<DestinationSelection | null>(null);
  const [picking, setPicking] = useState<MapSelection | null>(null);
  const [pinMessage, setPinMessage] = useState("");
  const [showStartOptions, setShowStartOptions] = useState(false);
  const [showRacks, setShowRacks] = useState(true);
  const [locating, setLocating] = useState(true);
  const [locationMessage, setLocationMessage] = useState("");
  const [result, setResult] = useState<RouteResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [navigation, setNavigation] = useState<number | null>(null);
  const [following, setFollowing] = useState(true);
  const [walking, setWalking] = useState(false);
  const tracking = useLiveLocation(navigation);
  const liveFix = tracking?.fix;
  const route = result && "route" in result ? result.route : null;
  const failure = result && "error" in result ? result : null;
  const namedId = destination && "id" in destination ? destination.id : "";
  const namedDestination = campus.destinations.find(({ id }) => id === namedId);
  const destinationPin = destination && "point" in destination ? destination.point : null;
  const destinationPoint = destinationPin ?? namedDestination?.point;
  const destinationLabel = namedDestination ? placeName(namedDestination) : "Pinned destination";
  const parkingPoint = route?.walk.geometry[0];
  const parkingSide = parkingPoint && destinationPoint && parkingPoint[1] > destinationPoint[1] ? "right" : "left";
  const parkingName = campus.routable_racks.find(({ id }) => id === route?.rack_id)?.name ?? "Parking rack";
  const selectedRack = racks?.find(({ id }) => id === route?.rack_id);
  const campusBounds = latLngBounds(campus.bounds);
  const liveOnCampus = liveFix && campusBounds.contains(liveFix.point);
  const isNavigating = navigation !== null;
  const offPathPins = route && (route.snap_distance_m >= 8 || route.destination_snap_distance_m >= 8);

  useEffect(() => {
    if (!sheet.current) return;
    const observer = new ResizeObserver(([entry]) => setSheetHeight(entry.target.getBoundingClientRect().height));
    observer.observe(sheet.current);
    return () => observer.disconnect();
  }, []);

  const locate = useCallback(() => {
    const request = ++locationRequest.current;
    setPicking(null);
    setShowStartOptions(false);
    setLocating(true);
    setLocationMessage("");

    function locationFailed(message: string) {
      if (request !== locationRequest.current) return;
      setLocating(false);
      setLocationMessage(message);
    }

    if (!navigator.geolocation) {
      locationFailed("Location is unavailable in this browser. Pin a start on the map.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (request !== locationRequest.current) return;
        const point: Coordinate = [coords.latitude, coords.longitude];
        if (!latLngBounds(campus.bounds).contains(point)) {
          locationFailed("Your location is outside USF Tampa. Pin a start on campus.");
          return;
        }
        setLocating(false);
        setResult(null);
        setStart({ point, source: "gps" });
      },
      (error) => {
        locationFailed(error.code === 1
          ? "Location access is off. Allow it in your browser or pin a start."
          : "Your location is unavailable. Try again or pin a start.");
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

  const viewportPadding = useCallback(() => {
    const bounds = sheet.current?.getBoundingClientRect();
    const size = map.current?.getSize();
    const mobile = window.matchMedia("(max-width: 720px)").matches;
    const left = mobile ? 24 : Math.min((bounds?.right ?? 400) + 32, (size?.x ?? 1200) * 0.5);
    const bottom = mobile ? Math.min((bounds?.height ?? 320) + 42, (size?.y ?? 800) * 0.68) : 52;
    return { paddingTopLeft: [left, 102] as Coordinate, paddingBottomRight: [64, bottom] as Coordinate };
  }, []);

  const fitCampus = useCallback(() => {
    map.current?.fitBounds(latLngBounds(campus.bounds), { ...viewportPadding(), maxZoom: 17, animate: false });
  }, [campus.bounds, viewportPadding]);

  const attachMap = useCallback((instance: LeafletMap | null) => {
    map.current = instance;
    if (instance) fitCampus();
  }, [fitCampus]);

  useEffect(() => {
    if (isNavigating || !route || !start || !destinationPoint) return;
    const points = [start.point, destinationPoint, ...route.ride.geometry, ...route.walk.geometry];
    map.current?.fitBounds(latLngBounds(points), { ...viewportPadding(), maxZoom: 18, animate: false });
  }, [route, start, destinationPoint, isNavigating, viewportPadding]);

  useEffect(() => {
    if (navigation === null || !liveFix || !liveOnCampus || !start || !map.current) return;
    if (alignedSession.current === navigation) return;
    alignedSession.current = navigation;
    if (map.current.distance(start.point, liveFix.point) > Math.max(35, liveFix.accuracy)) {
      setResult(null);
      setStart({ point: liveFix.point, source: "gps" });
    }
  }, [liveFix, liveOnCampus, navigation, start]);

  const centerOn = useCallback((point: Coordinate) => {
    const instance = map.current;
    if (!instance) return;
    const zoom = Math.max(instance.getZoom(), 17);
    const { paddingTopLeft: [left, top], paddingBottomRight: [right, bottom] } = viewportPadding();
    const center = instance.unproject(instance.project(point, zoom).subtract([(left - right) / 2, (top - bottom) / 2]), zoom);
    instance.setView(center, zoom, { animate: false });
  }, [viewportPadding]);

  useEffect(() => {
    if (isNavigating && liveFix && liveOnCampus && following) centerOn(liveFix.point);
  }, [centerOn, following, isNavigating, liveFix, liveOnCampus]);

  function chooseStart(point: Coordinate, source: StartSelection["source"]) {
    locationRequest.current += 1;
    setLocating(false);
    setLocationMessage("");
    setResult(null);
    setStart({ point, source });
    setPicking(null);
    setShowStartOptions(false);
  }

  function chooseDestination(selection: DestinationSelection | null) {
    setResult(null);
    setDestination(selection);
    setPicking(null);
  }

  function pickPoint(selection: MapSelection) {
    if (selection === "start") {
      locationRequest.current += 1;
      setLocating(false);
    }
    map.current?.closePopup();
    setShowStartOptions(false);
    setPinMessage("");
    setPicking(selection);
  }

  function onMapPoint(point: Coordinate) {
    if (!campusBounds.contains(point)) {
      setPinMessage("Choose a point inside the campus outline.");
      return;
    }
    if (picking === "start") chooseStart(point, "pin");
    if (picking === "destination") chooseDestination({ point });
  }

  function beginNavigation() {
    setNavigation(++navigationSequence.current);
    setFollowing(true);
    setWalking(false);
  }

  function endNavigation() {
    setNavigation(null);
    if (liveFix && liveOnCampus) chooseStart(liveFix.point, "gps");
  }

  function recenter() {
    if (isNavigating) {
      setFollowing(true);
      if (liveFix && liveOnCampus) centerOn(liveFix.point);
      else if (tracking?.error) setNavigation(++navigationSequence.current);
    } else if (start?.source === "gps") {
      centerOn(start.point);
    } else {
      locate();
    }
  }

  const rackMarkers = useMemo(() => racks?.map((rack) => ({
    id: rack.id, point: [rack.latitude, rack.longitude] as Coordinate, rack, name: "Parking rack",
  })) ?? campus.routable_racks.map(({ id, point, name }) => ({ id, point, rack: undefined, name })), [campus.routable_racks, racks]);
  const liveMessage = tracking?.error
    ?? (liveFix && !liveOnCampus ? "Live location is outside the campus map."
      : liveFix ? "Live location" : "Waiting for GPS…");
  const rackLabel = parkingName === "Campus parking rack" ? "Parking rack" : parkingName;

  return (
    <main
      className="navigator"
      data-picking={picking ?? undefined}
      style={{ "--sheet-height": sheetHeight + "px" } as CSSProperties}
    >
      <MapContainer
        ref={attachMap}
        bounds={campusBounds}
        boundsOptions={{ padding: [26, 26], maxZoom: 17 }}
        className="campus-map"
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <MapInteraction onPick={picking ? onMapPoint : null} onDrag={() => setFollowing(false)} />
        {picking && <Rectangle bounds={campusBounds} pathOptions={{ color: "#164f3e", weight: 2, dashArray: "6 6", fillOpacity: 0.035, interactive: false }} />}
        {route && route.ride.geometry.length > 1 && (
          <>
            <Polyline positions={route.ride.geometry} pathOptions={routeOutline} />
            <Polyline positions={route.ride.geometry} pathOptions={rideStyle} />
          </>
        )}
        {route && route.walk.geometry.length > 1 && (
          <>
            <Polyline positions={route.walk.geometry} pathOptions={{ ...routeOutline, weight: 8 }} />
            <Polyline positions={route.walk.geometry} pathOptions={walkStyle} />
          </>
        )}
        {showRacks && rackMarkers.filter(({ id }) => id !== route?.rack_id).map(({ id, point, rack, name }) => (
          <CircleMarker
            key={id}
            center={point}
            radius={3.5}
            pathOptions={rackStyle}
          >
            <Popup><strong>{name}</strong><RackDetails rack={rack} /></Popup>
          </CircleMarker>
        ))}
        {start && (!isNavigating || !liveOnCampus) && (
          <TripMarker point={start.point} accent={start.source === "gps" ? "#156eca" : "#124437"} label={start.source === "gps" ? "You" : "Start"} side="left" className="trip-start" />
        )}
        {parkingPoint && (
          <TripMarker point={parkingPoint} accent="#08755c" label={rackLabel} side={parkingSide} className="parking-rack trip-parking">
            <RackDetails rack={selectedRack} />
          </TripMarker>
        )}
        {destinationPoint && (
          <TripMarker point={destinationPoint} accent="#a54d13" label={destinationPin ? "Destination" : "Entrance"} side={parkingSide === "left" ? "right" : "left"} className="trip-entrance" />
        )}
        {isNavigating && liveFix && liveOnCampus && (
          <>
            <Circle center={liveFix.point} radius={liveFix.accuracy} pathOptions={{ color: "#156eca", weight: 1, opacity: 0.25, fillOpacity: 0.14, interactive: false }} />
            <TripMarker point={liveFix.point} accent="#156eca" label="You" side="left" className="live-position" />
          </>
        )}
      </MapContainer>
      <NavigatorHeader />

      <div className="navigator-map-actions" role="group" aria-label="Map controls">
        <IconButton label="Fit campus" onClick={() => { setFollowing(false); fitCampus(); }}><Compass aria-hidden="true" size={21} /></IconButton>
        <IconButton label={(showRacks ? "Hide" : "Show") + " parking racks"} onClick={() => setShowRacks(!showRacks)} pressed={showRacks}>
          <CircleParking aria-hidden="true" size={21} />
        </IconButton>
        <div className="navigator-zoom">
          <IconButton label="Zoom in" onClick={() => map.current?.zoomIn()}><Plus aria-hidden="true" size={19} /></IconButton>
          <IconButton label="Zoom out" onClick={() => map.current?.zoomOut()}><Minus aria-hidden="true" size={19} /></IconButton>
        </div>
        <IconButton label={isNavigating ? "Follow my location" : "Center on my location"} onClick={recenter} pressed={isNavigating ? following : undefined}>
          <LocateFixed aria-hidden="true" size={21} />
        </IconButton>
      </div>

      <section className="navigator-sheet" ref={sheet} aria-label="Campus trip">
        {picking ? (
          <div className="sheet-picking">
            <span className="sheet-picking-icon"><MapPin aria-hidden="true" size={22} /></span>
            <div><h1>Pin your {picking}</h1><p role="status">{pinMessage || "Tap a point on the campus map."}</p></div>
            <button className="plain-icon" type="button" aria-label="Cancel picking" onClick={() => setPicking(null)}><X aria-hidden="true" size={21} /></button>
          </div>
        ) : isNavigating ? (
          <>
            <div className="sheet-heading">
              <div>
                <p className="live-status" role="status"><span className={liveFix && liveOnCampus && !tracking?.error ? "live-dot active" : "live-dot"} />{liveMessage}</p>
                <h1>{destinationLabel}</h1>
              </div>
              <button className="sheet-secondary" type="button" onClick={endNavigation}>End trip</button>
            </div>
            {route && (
              <div className="next-leg">
                <span className={walking ? "leg-icon walk" : "leg-icon"}>{walking ? <Footprints aria-hidden="true" size={22} /> : <Bike aria-hidden="true" size={22} />}</span>
                <div><strong>{walking ? "Walk to destination" : "Bike to " + rackLabel}</strong><small>Follow the {walking ? "dashed" : "solid"} line</small></div>
                {!walking && <button className="sheet-secondary" type="button" onClick={() => setWalking(true)}>I parked <ArrowRight aria-hidden="true" size={15} /></button>}
              </div>
            )}
            {!route && <p className="sheet-note" role="status">{failure?.error ?? "Updating your route…"}</p>}
            {tracking?.error && <button className="sheet-secondary gps-retry" type="button" onClick={() => setNavigation(++navigationSequence.current)}>Retry GPS</button>}
          </>
        ) : (
          <>
            {destination ? (
              <>
                <div className="sheet-heading preview-heading">
                  <button className="plain-icon preview-back" type="button" aria-label="Choose another destination" onClick={() => chooseDestination(null)}><ArrowLeft aria-hidden="true" size={21} /></button>
                  <h1>{destinationLabel}</h1>
                  {route && <span className="estimate" title="Estimated trip time">{formatTime(route.ride.duration_seconds + route.walk.duration_seconds)}</span>}
                </div>
                {route && (
                  <>
                    <div className="route-breakdown" aria-label="Trip legs">
                      <div><span className="leg-icon"><Bike aria-hidden="true" size={19} /></span><span>Bike to {rackLabel}<small>Ride</small></span><strong>{formatTime(route.ride.duration_seconds)}</strong></div>
                      <div><span className="leg-icon walk"><Footprints aria-hidden="true" size={19} /></span><span>{destinationPin ? "Walk to destination" : "Walk to entrance"}<small>On foot</small></span><strong>{formatTime(route.walk.duration_seconds)}</strong></div>
                    </div>
                    <button className="go-button" type="button" onClick={beginNavigation}><Navigation aria-hidden="true" size={18} /> Go</button>
                  </>
                )}
                {!route && <p className={failure ? "sheet-note route-error" : "sheet-note"} role="status">
                  {failure?.error ?? (!start ? "Set your start to see the route." : "Calculating your trip…")}
                </p>}
                {failure?.retryable && <button className="sheet-secondary" type="button" onClick={() => {
                  setResult(null);
                  setAttempt((previous) => previous + 1);
                }}>Retry route</button>}
              </>
            ) : (
              <>
                <div className="sheet-heading">
                  <h1>Where to?</h1>
                  <button className="sheet-secondary pin-button" type="button" onClick={() => pickPoint("destination")}><MapPin aria-hidden="true" size={16} /> Drop a pin</button>
                </div>
                <DestinationSearch places={campus.destinations} onChoose={(place) => chooseDestination({ id: place.id })} />
              </>
            )}
            <div className="origin-row">
              <Crosshair aria-hidden="true" size={17} />
              <span><small>Starting from</small><strong>{locating ? "Finding your location…" : start ? startLabels[start.source] : "Choose a start"}</strong></span>
              <button type="button" className="origin-button" aria-expanded={showStartOptions} onClick={() => setShowStartOptions(!showStartOptions)}>
                {start ? "Change" : "Set start"} <ChevronDown aria-hidden="true" size={15} />
              </button>
            </div>
            {showStartOptions && (
              <div className="origin-options" role="group" aria-label="Start options">
                <button className="sheet-secondary" type="button" onClick={locate} disabled={locating}><LocateFixed aria-hidden="true" size={16} /> Use my location</button>
                <button className="sheet-secondary" type="button" onClick={() => pickPoint("start")}><MapPin aria-hidden="true" size={16} /> Pin start</button>
                <button className="sheet-secondary" type="button" onClick={() => chooseStart(campus.bookstore, "bookstore")}>Use Bookstore</button>
              </div>
            )}
            {locationMessage && <p className="sheet-note" role="status">{locationMessage}</p>}
            {offPathPins && <p className="sheet-note">Route lines use mapped paths near your pins.</p>}
          </>
        )}
      </section>
    </main>
  );
}

function TripMarker({ point, accent, label, side, className, children }: {
  point: Coordinate; accent: string; label: string; side: "left" | "right"; className: string; children?: ReactNode;
}) {
  const style: PathOptions = { className, color: "#fff", weight: 2.5, fillColor: accent, fillOpacity: 1 };
  return (
    <CircleMarker center={point} radius={7} pathOptions={style}>
      <Tooltip permanent direction={side} offset={[side === "left" ? -9 : 9, 0]}>{label}</Tooltip>
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

  if (data) return <LoadedCampusMap {...data} />;

  return (
    <main className="navigator navigator-loading">
      <NavigatorHeader />
      <div className="navigator-load-status" role="status">
        <Compass aria-hidden="true" size={24} />
        <p>{unavailable ? "Campus map unavailable. Check the API and reload." : "Opening the campus map…"}</p>
      </div>
    </main>
  );
}
