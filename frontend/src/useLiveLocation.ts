import { useEffect, useState } from "react";

export type LiveFix = { point: [number, number]; accuracy: number };

type LocationReading = {
  session: number;
  fix?: LiveFix;
  error?: string;
};

export function useLiveLocation(session: number | null) {
  const [reading, setReading] = useState<LocationReading | null>(null);

  useEffect(() => {
    if (session === null) return;
    const activeSession = session;
    const geolocation = navigator.geolocation;
    if (!geolocation) {
      setReading({ session, error: "This browser cannot access live location." });
      return;
    }

    let watch: number | null = null;
    let generation = 0;

    function stopWatching() {
      generation += 1;
      if (watch !== null) geolocation.clearWatch(watch);
      watch = null;
    }

    function updateWatch() {
      if (document.visibilityState !== "visible") {
        stopWatching();
        return;
      }
      if (watch !== null) return;

      const current = ++generation;
      watch = geolocation.watchPosition(
        ({ coords }) => {
          if (current !== generation) return;
          setReading({ session: activeSession, fix: { point: [coords.latitude, coords.longitude], accuracy: coords.accuracy } });
        },
        (error) => {
          if (current !== generation) return;
          const message = error.code === 1
            ? "Allow location access in your browser to follow this trip."
            : "Waiting for a GPS signal. Your route is still on the map.";
          setReading((previous) => ({
            session: activeSession, fix: previous?.session === activeSession ? previous.fix : undefined, error: message,
          }));
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
      );
    }

    updateWatch();
    document.addEventListener("visibilitychange", updateWatch);
    return () => {
      document.removeEventListener("visibilitychange", updateWatch);
      stopWatching();
    };
  }, [session]);

  return reading?.session === session ? reading : null;
}
