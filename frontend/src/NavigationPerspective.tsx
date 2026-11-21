import { useEffect, useRef, useState } from "react";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import {
  AttributionControl, Map as LibreMap, Marker, setWorkerUrl,
  type GeoJSONSource, type PaddingOptions, type StyleSpecification,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useCompassHeading, type Coordinate } from "./navigationHeading";
import { reportPoint, type ClosedPath, type Report } from "./reports";
import "maplibre-gl/dist/maplibre-gl.css";

type RouteLine = { geometry: Coordinate[] };
type NavigationRoute = { approach?: RouteLine | null; ride: RouteLine | null; walk: RouteLine };

export type PerspectiveProps = {
  session: number;
  position: Coordinate;
  heading: number;
  live: boolean;
  route: NavigationRoute | null;
  destination?: Coordinate;
  parking?: Coordinate;
  racks: Coordinate[];
  hazards: Report[];
  closures: ClosedPath[];
  following: boolean;
  padding: () => PaddingOptions;
  onMap: (map: LibreMap | null) => void;
  onExplore: () => void;
  onUnavailable: () => void;
};

const pitch = 55;
const guidanceZoom = 17;

function lngLat([latitude, longitude]: Coordinate): Coordinate {
  return [longitude, latitude];
}

function emptyFeatures(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function makeStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      base: {
        type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19,
        attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
      },
      racks: { type: "geojson", data: emptyFeatures() },
      route: { type: "geojson", data: emptyFeatures() },
      hazards: { type: "geojson", data: emptyFeatures() },
      closures: { type: "geojson", data: emptyFeatures() },
    },
    layers: [
      { id: "ground", type: "background", paint: { "background-color": "#e5ede3" } },
      { id: "base", type: "raster", source: "base", paint: { "raster-saturation": -0.35 } },
      { id: "racks", type: "circle", source: "racks", paint: {
        "circle-radius": 3, "circle-color": "#276954", "circle-opacity": 0.48,
        "circle-stroke-color": "#ffffff", "circle-stroke-width": 1,
        "circle-pitch-alignment": "viewport", "circle-pitch-scale": "viewport",
      } },
      { id: "outline", type: "line", source: "route", filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 10, "line-opacity": 0.94 } },
      { id: "ride", type: "line", source: "route", filter: ["==", ["get", "role"], "ride"],
        layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#08755c", "line-width": 6 } },
      { id: "walk", type: "line", source: "route", filter: ["==", ["get", "role"], "walk"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#b45921", "line-width": 5, "line-dasharray": [0.6, 1.6] } },
      { id: "closures", type: "line", source: "closures",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#a83234", "line-width": 7, "line-dasharray": [1.15, 0.85] } },
      { id: "endpoints", type: "circle", source: "route", filter: ["==", ["geometry-type"], "Point"], paint: {
        "circle-color": ["match", ["get", "role"], "parking", "#08755c", "#a54d13"], "circle-radius": 6,
        "circle-stroke-width": 2, "circle-stroke-color": "#ffffff",
        "circle-pitch-alignment": "viewport", "circle-pitch-scale": "viewport",
      } },
      { id: "hazards", type: "circle", source: "hazards", paint: {
        "circle-radius": 7, "circle-color": "#b84b18", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2,
        "circle-pitch-alignment": "viewport", "circle-pitch-scale": "viewport",
      } },
    ],
  };
}

function pointFeature(point: Coordinate, role?: string): Feature<Point> {
  return { type: "Feature", properties: role ? { role } : {}, geometry: { type: "Point", coordinates: lngLat(point) } };
}

function routeFeatures(route: NavigationRoute | null, destination?: Coordinate, parking?: Coordinate): FeatureCollection {
  const features: Array<Feature<LineString | Point>> = [];
  if (route) {
    for (const leg of ["approach", "ride", "walk"] as const) {
      const geometry = route[leg]?.geometry;
      if (!geometry || geometry.length < 2) continue;
      features.push({
        type: "Feature", properties: { role: leg === "ride" ? "ride" : "walk" },
        geometry: { type: "LineString", coordinates: geometry.map(lngLat) },
      });
    }
  }
  if (parking) features.push(pointFeature(parking, "parking"));
  if (destination) features.push(pointFeature(destination, "destination"));
  return { type: "FeatureCollection", features };
}

export default function NavigationPerspective(props: PerspectiveProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const marker = useRef<Marker | null>(null);
  const initial = useRef(props);
  const [map, setMap] = useState<LibreMap | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const first = initial.current;
    let instance: LibreMap;
    try {
      setWorkerUrl(workerUrl);
      instance = new LibreMap({
        container: container.current,
        style: makeStyle(),
        center: lngLat(first.position),
        bearing: first.heading,
        pitch,
        zoom: guidanceZoom,
        minZoom: 12,
        maxZoom: 20,
        maxPitch: 62,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        renderWorldCopies: false,
        attributionControl: false,
      });
    } catch {
      first.onUnavailable();
      return;
    }
    instance.addControl(new AttributionControl({ compact: false }), "bottom-right");
    instance.jumpTo({ padding: first.padding() });

    const element = document.createElement("div");
    element.className = "navigation-arrow";
    element.setAttribute("aria-hidden", "true");
    const arrow = new Marker({ element, rotationAlignment: "map", pitchAlignment: "viewport" })
      .setLngLat(lngLat(first.position)).setRotation(first.heading).addTo(instance);
    marker.current = arrow;

    const canvas = instance.getCanvas();
    const loadTimeout = window.setTimeout(first.onUnavailable, 12000);
    canvas.addEventListener("webglcontextlost", first.onUnavailable);
    instance.on("dragstart", first.onExplore);
    instance.once("load", () => {
      window.clearTimeout(loadTimeout);
      setMap(instance);
      first.onMap(instance);
    });
    return () => {
      window.clearTimeout(loadTimeout);
      canvas.removeEventListener("webglcontextlost", first.onUnavailable);
      first.onMap(null);
      arrow.remove();
      marker.current = null;
      instance.remove();
    };
  }, []);

  const { closures, destination, following, hazards, live, padding, parking, position, racks, route, session } = props;
  const heading = useCompassHeading(session) ?? props.heading;

  useEffect(() => {
    (map?.getSource("racks") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection", features: racks.map((point) => pointFeature(point)),
    });
  }, [map, racks]);

  useEffect(() => {
    (map?.getSource("route") as GeoJSONSource | undefined)?.setData(routeFeatures(route, destination, parking));
  }, [destination, map, parking, route]);

  useEffect(() => {
    (map?.getSource("hazards") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection", features: hazards.map((report) => pointFeature(reportPoint(report))),
    });
  }, [hazards, map]);

  useEffect(() => {
    (map?.getSource("closures") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: closures.map(({ geometry }) => ({
        type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: geometry.map(lngLat) },
      })),
    });
  }, [closures, map]);

  useEffect(() => {
    if (!map || !marker.current) return;
    marker.current.setLngLat(lngLat(position)).setRotation(heading);
    marker.current.getElement().classList.toggle("is-live", live);
    if (!following) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.easeTo({
      center: lngLat(position), bearing: heading, pitch,
      padding: padding(), zoom: Math.max(guidanceZoom, map.getZoom()),
      duration: reducedMotion ? 0 : 320,
    });
  }, [following, heading, live, map, padding, position]);

  return <div ref={container} className="navigation-perspective" aria-label="Heading-up navigation map" />;
}
