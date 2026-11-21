import { useEffect, useMemo, useState } from "react";
import { TriangleAlert, X } from "lucide-react";
import type { Coordinate } from "./navigationHeading";
import { categories, getRiderId, reportPoint, reportRequest, type Report, type Vote } from "./reports";
import type { LiveFix } from "./useLiveLocation";

type ActiveRouteLeg = { geometry: Coordinate[]; segment_ids: string[] };

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
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
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
  const position = leg && liveFix && liveFix.accuracy <= 40 ? projectAlong(liveFix.point, leg.geometry) : null;
  const nearby = position && position.distance <= 30
    ? locations.filter(({ report }) => !dismissed.has(report.id))
      .map(({ report, along }) => ({ report, ahead: along - position.along }))
      .sort((a, b) => Math.abs(a.ahead) - Math.abs(b.ahead))
    : [];
  const upcoming = nearby.find(({ ahead }) => ahead >= -8 && ahead <= 65);
  const passed = nearby.find(({ report, ahead }) => ahead < -8 && ahead >= -50 && seen.has(report.id));
  const notice = passed ?? upcoming;
  const id = notice?.report.id;
  const isUpcoming = Boolean(notice && !passed);

  useEffect(() => {
    if (hidden || !id || !isUpcoming) return;
    setSeen((previous) => previous.has(id) ? previous : new Set([...previous, id]));
  }, [hidden, id, isUpcoming]);

  function dismiss(reportId: string) {
    setDismissed((previous) => new Set([...previous, reportId]));
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

  if (hidden || !notice) return null;
  const { report } = notice;
  return (
    <aside className="hazard-notice" aria-label="Route hazard">
      <div className="hazard-notice-heading">
        <TriangleAlert aria-hidden="true" size={21} />
        <div role="status">
          <strong>{categories[report.category]} {passed ? "just passed" : "ahead"}</strong>
          {report.description && <small>{report.description}</small>}
        </div>
        <button type="button" className="plain-icon" aria-label="Dismiss hazard warning" onClick={() => dismiss(report.id)}><X aria-hidden="true" size={20} /></button>
      </div>
      {passed && (
        <div className="hazard-votes">
          <button type="button" className="sheet-secondary" disabled={voting !== null} onClick={() => void submitVote(report.id, "still_there")}>Still there</button>
          <button type="button" className="sheet-secondary" disabled={voting !== null} onClick={() => void submitVote(report.id, "looks_clear")}>Looks clear</button>
        </div>
      )}
      {error?.id === report.id && <p className="sheet-note route-error" role="alert">{error.message}</p>}
    </aside>
  );
}
