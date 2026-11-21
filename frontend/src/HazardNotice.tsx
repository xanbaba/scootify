import { useEffect, useMemo, useRef, useState } from "react";
import { TriangleAlert, X } from "lucide-react";
import type { Coordinate } from "./navigationHeading";
import { categories, getRiderId, reportPoint, reportRequest, type Report, type Vote } from "./reports";
import type { LiveFix } from "./useLiveLocation";

type ActiveRouteLeg = { geometry: Coordinate[]; segment_ids: string[] };
const PASS_PROMPT_MS = 25_000;

function projectAlong(point: Coordinate, line: Coordinate[]) {
  const longitudeScale = 111195 * Math.cos(point[0] * Math.PI / 180);
  const offsets = line.map(([lat, lon]) => [(lat - point[0]) * 111195, (lon - point[1]) * longitudeScale]);
  let distance = Infinity;
  let along = 0;
  let traversed = 0;
  for (let index = 1; index < offsets.length; index++) {
    const [y, x] = offsets[index - 1];
    const dy = offsets[index][0] - y;
    const dx = offsets[index][1] - x;
    const length = Math.hypot(dy, dx);
    if (!length) continue;
    const fraction = Math.max(0, Math.min(1, -(y * dy + x * dx) / (length * length)));
    const gap = Math.hypot(y + fraction * dy, x + fraction * dx);
    if (gap < distance) {
      distance = gap;
      along = traversed + fraction * length;
    }
    traversed += length;
  }
  return { along, distance };
}

export function HazardNotice({ leg, liveFix, reports, hidden, onVoted }: {
  leg: ActiveRouteLeg | undefined;
  liveFix: LiveFix | undefined;
  reports: Report[];
  hidden: boolean;
  onVoted: () => void;
}) {
  const seen = useRef(new Set<string>());
  const lastPosition = useRef<{ geometry: Coordinate[]; along: number } | null>(null);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [voting, setVoting] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const locations = useMemo(() => {
    if (!leg) return [];
    const segments = new Set(leg.segment_ids);
    return reports.filter((report) => segments.has(report.segment_id))
      .map((report) => ({ report, ...projectAlong(reportPoint(report), leg.geometry) }))
      .filter(({ distance }) => distance <= 5);
  }, [leg, reports]);
  const projectedPosition = leg && liveFix && liveFix.accuracy <= 40 ? projectAlong(liveFix.point, leg.geometry) : null;
  const along = projectedPosition && projectedPosition.distance <= 30 ? projectedPosition.along : null;
  const nearby = along !== null
    ? locations.filter(({ report }) => !dismissed.has(report.id))
      .map(({ report, along: marker }) => ({ report, ahead: marker - along }))
      .sort((a, b) => Math.abs(a.ahead) - Math.abs(b.ahead))
    : [];
  const upcoming = nearby.find(({ ahead }) => ahead >= -8 && ahead <= 65);
  const upcomingId = upcoming?.report.id;
  const feedback = reports.find(({ id }) => id === feedbackId && !dismissed.has(id));

  useEffect(() => {
    if (hidden || !leg || along === null) return;
    const previous = lastPosition.current;
    lastPosition.current = { geometry: leg.geometry, along };
    if (upcomingId) seen.current.add(upcomingId);
    if (feedbackId) return;
    const passed = locations.find(({ report, along: marker }) => {
      const past = along - marker;
      if (dismissed.has(report.id) || past <= 8 || past > 110) return false;
      return seen.current.has(report.id) || (
        previous?.geometry === leg.geometry && previous.along <= marker && along - previous.along <= 150
      );
    });
    if (passed) setFeedbackId(passed.report.id);
  }, [along, dismissed, feedbackId, hidden, leg, locations, upcomingId]);

  useEffect(() => {
    if (!feedbackId) return;
    const timer = window.setTimeout(() => {
      setDismissed((previous) => new Set([...previous, feedbackId]));
      setFeedbackId(null);
    }, PASS_PROMPT_MS);
    return () => window.clearTimeout(timer);
  }, [feedbackId]);

  function dismiss(reportId: string) {
    setDismissed((previous) => new Set([...previous, reportId]));
    setFeedbackId((previous) => previous === reportId ? null : previous);
  }

  async function submitVote(reportId: string, vote: Vote) {
    if (voting) return;
    setVoting(reportId);
    setError(null);
    try {
      await reportRequest<Report>("/api/reports/" + reportId + "/vote", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rider_id: getRiderId(), vote }),
      });
      dismiss(reportId);
      onVoted();
    } catch (error) {
      setError({ id: reportId, message: error instanceof Error ? error.message : "Could not save your vote." });
    } finally {
      setVoting(null);
    }
  }

  const report = feedback ?? upcoming?.report;
  if (hidden || !report) return null;
  return (
    <aside className="hazard-notice" aria-label="Route hazard">
      <div className="hazard-notice-heading">
        <TriangleAlert aria-hidden="true" size={21} />
        <div role="status">
          <strong>{categories[report.category]} {feedback ? "just passed" : "ahead"}</strong>
          {report.description && <small>{report.description}</small>}
        </div>
        <button type="button" className="plain-icon" aria-label="Dismiss hazard warning" onClick={() => dismiss(report.id)}><X aria-hidden="true" size={20} /></button>
      </div>
      {feedback && (
        <div className="hazard-votes">
          <button type="button" className="sheet-secondary" disabled={voting !== null} onClick={() => void submitVote(report.id, "still_there")}>Still there</button>
          <button type="button" className="sheet-secondary" disabled={voting !== null} onClick={() => void submitVote(report.id, "looks_clear")}>Looks clear</button>
        </div>
      )}
      {error?.id === report.id && <p className="sheet-note route-error" role="alert">{error.message}</p>}
    </aside>
  );
}
