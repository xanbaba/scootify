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
  resolved_at: string | null;
  still_there: number;
  looks_clear: number;
  last_confirmed_at: string | null;
};

export async function reportRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.detail === "string" ? body.detail : "The report service is unavailable.");
  }
  return response.json();
}

export function useReports(staff = false) {
  const [reports, setReports] = useState<Report[]>([]);
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
        const next = await reportRequest<Report[]>(staff ? "/api/admin/reports" : "/api/reports", { signal: controller.signal });
        if (!controller.signal.aborted) {
          setReports(next);
          setError("");
        }
      } catch {
        if (!controller.signal.aborted) setError("Could not load hazard reports.");
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 5000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [revision, staff]);

  return { reports, loading, error, refresh };
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
