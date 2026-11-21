import { useCallback, useEffect, useState } from "react";
import type { Coordinate } from "./navigationHeading";

export const categories = {
  pothole: "Pothole",
  debris: "Debris",
  blocked_path: "Blocked path",
  slippery: "Slippery surface",
  other: "Other",
} as const;

export type Category = keyof typeof categories;
export type Vote = "still_there" | "looks_clear";
export type ReportPath = {
  segment_id: string;
  name: string;
  geometry: Coordinate[];
  point: Coordinate;
  distance_m: number;
  modes: ("walk" | "bike")[];
};
export type Report = {
  id: string;
  segment_id: string;
  category: Category;
  description: string;
  latitude: number;
  longitude: number;
  created_at: string;
  status: "open" | "in_progress" | "resolved";
  resolved_at: string | null;
  still_there: number;
  looks_clear: number;
  last_confirmed_at: string | null;
};

export type ClosedPath = {
  segment_id: string;
  closed_at: string;
  name: string;
  geometry: Coordinate[];
};

type RoutingState = { reports: Report[]; closures: ClosedPath[] };

export async function reportRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.detail === "string" ? body.detail : "The report service is unavailable.");
  }
  return response.json();
}

export function useReports(staff = false) {
  const [state, setState] = useState<RoutingState>({ reports: [], closures: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((previous) => previous + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      try {
        const next = await reportRequest<RoutingState>(staff ? "/api/admin/routing-state" : "/api/routing-state", { signal: controller.signal });
        if (!controller.signal.aborted) {
          setState(next);
          setError("");
        }
      } catch {
        if (!controller.signal.aborted) setError("Could not load campus reports and closures.");
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    const updateWhenVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = window.setInterval(updateWhenVisible, 2000);
    document.addEventListener("visibilitychange", updateWhenVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", updateWhenVisible);
    };
  }, [revision, staff]);

  return { ...state, loading, error, refresh };
}

let riderId: string | undefined;

export function getRiderId(): string {
  if (!riderId) {
    const key = "scootify-rider";
    riderId = crypto.randomUUID();
    try {
      const stored = localStorage.getItem(key);
      if (stored) riderId = stored;
      else localStorage.setItem(key, riderId);
    } catch {
      // Keep one identity in this tab even when browser storage is disabled.
    }
  }
  return riderId;
}

export function reportPoint(report: Report): Coordinate {
  return [report.latitude, report.longitude];
}
