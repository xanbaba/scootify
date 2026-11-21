import { useEffect, useState } from "react";

export type Coordinate = [number, number];

const radians = Math.PI / 180;

export function normalizeHeading(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

function offsetMeters(from: Coordinate, to: Coordinate): Coordinate {
  const longitudeScale = 111_195 * Math.cos((from[0] + to[0]) * radians / 2);
  return [(to[0] - from[0]) * 111_195, (to[1] - from[1]) * longitudeScale];
}

export function distanceBetween(from: Coordinate, to: Coordinate): number {
  return Math.hypot(...offsetMeters(from, to));
}

export function headingBetween(from: Coordinate, to: Coordinate): number {
  const [north, east] = offsetMeters(from, to);
  return normalizeHeading(Math.atan2(east, north) / radians);
}

export function routeHeading(geometry: Coordinate[]): number {
  const start = geometry[0];
  if (!start) return 0;
  const ahead = geometry.find((point) => distanceBetween(start, point) >= 8) ?? geometry.at(-1) ?? start;
  return headingBetween(start, ahead);
}

type CompassEvent = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};

function compassHeading(event: CompassEvent): number | null {
  const nativeHeading = event.webkitCompassHeading;
  if (typeof nativeHeading === "number" && Number.isFinite(nativeHeading) && nativeHeading >= 0
    && (event.webkitCompassAccuracy === undefined || event.webkitCompassAccuracy >= 0)) {
    return normalizeHeading(nativeHeading);
  }
  if ((!event.absolute && event.type !== "deviceorientationabsolute") || event.alpha === null) return null;

  // Project the direction out of the back of a raised phone onto the horizontal plane.
  const alpha = event.alpha * radians;
  const beta = (event.beta ?? 0) * radians;
  const gamma = (event.gamma ?? 0) * radians;
  const east = -Math.cos(alpha) * Math.sin(gamma) - Math.sin(alpha) * Math.sin(beta) * Math.cos(gamma);
  const north = -Math.sin(alpha) * Math.sin(gamma) + Math.cos(alpha) * Math.sin(beta) * Math.cos(gamma);
  if (Math.hypot(east, north) > 0.5) return normalizeHeading(Math.atan2(east, north) / radians);

  return normalizeHeading(-event.alpha + (screen.orientation?.angle ?? 0));
}

export function requestCompassAccess() {
  const sensor = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
    requestPermission?: (absolute?: boolean) => Promise<string>;
  };
  // Safari and other permission-gated implementations require a user gesture here.
  void sensor?.requestPermission?.(true).catch(() => undefined);
}

export function useCompassHeading(session: number | null): number | null {
  const [reading, setReading] = useState<{ session: number; heading: number } | null>(null);

  useEffect(() => {
    if (session === null) return;
    const activeSession = session;
    let timer: number | undefined;
    let pending: number | null = null;
    let last: number | null = null;

    function onOrientation(event: Event) {
      if (document.visibilityState !== "visible") return;
      const heading = compassHeading(event as CompassEvent);
      if (heading === null) return;
      pending = heading;
      if (timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        if (pending === null || document.visibilityState !== "visible") return;
        const delta = last === null ? 360 : Math.abs(normalizeHeading(pending - last + 180) - 180);
        if (delta >= 3) {
          last = pending;
          setReading({ session: activeSession, heading: pending });
        }
      }, 100);
    }

    window.addEventListener("deviceorientation", onOrientation);
    window.addEventListener("deviceorientationabsolute", onOrientation);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("deviceorientation", onOrientation);
      window.removeEventListener("deviceorientationabsolute", onOrientation);
    };
  }, [session]);

  return reading?.session === session ? reading.heading : null;
}
