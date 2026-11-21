import { useState } from "react";
import { Ban, Check, ChevronDown, MapPin, TriangleAlert } from "lucide-react";
import { categories, reportRequest, useReports, type ClosedPath, type Report } from "./reports";
import "./admin.css";

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const statusLabels = { open: "Open", in_progress: "In progress", resolved: "Resolved" };
const filters = {
  all: "All reports",
  active: "Active",
  closed: "Path closed",
  resolved: "Resolved",
};
type Filter = keyof typeof filters;

function formatDate(value: string) {
  return dateTime.format(new Date(value));
}

function LocationLink({ latitude, longitude }: { latitude: number; longitude: number }) {
  const url = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=19/${latitude}/${longitude}`;
  return <a className="staff-location" href={url} target="_blank" rel="noreferrer"><MapPin aria-hidden="true" size={16} /> View location</a>;
}

function ClosedBadge() {
  return <span className="staff-badge" data-status="closed"><Ban aria-hidden="true" size={13} /> Path closed</span>;
}

export function AdminReports() {
  const { reports, closures, loading, error, refresh } = useReports(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const closureBySegment = new Map(closures.map((closure) => [closure.segment_id, closure]));
  const reportSegments = new Set(reports.map((report) => report.segment_id));
  const standaloneClosures = closures.filter((closure) => !reportSegments.has(closure.segment_id));
  const reportsByFilter = {
    all: reports,
    active: reports.filter((report) => report.status !== "resolved"),
    closed: reports.filter((report) => closureBySegment.has(report.segment_id)),
    resolved: reports.filter((report) => report.status === "resolved"),
  };
  const visibleReports = reportsByFilter[filter];
  const showStandalone = filter === "all" || filter === "closed";
  const empty = !visibleReports.length && (!showStandalone || !standaloneClosures.length);

  async function save(endpoint: string, body?: { closed: boolean }) {
    setSaving(endpoint);
    setSaveError("");
    try {
      await reportRequest(endpoint, {
        method: "PUT",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save the change.");
    } finally {
      setSaving(null);
    }
  }

  function closureButton(segmentId: string, closed: boolean) {
    const endpoint = "/api/admin/segments/" + encodeURIComponent(segmentId) + "/closure";
    return (
      <button className="staff-action" data-intent={closed ? "normal" : "danger"} type="button"
        disabled={saving !== null} onClick={() => void save(endpoint, { closed: !closed })}>
        {saving === endpoint ? "Saving…" : closed ? "Reopen path" : "Close path"}
      </button>
    );
  }

  function reportRow(report: Report) {
    const closure = closureBySegment.get(report.segment_id);
    const endpoint = "/api/admin/reports/" + report.id;
    const resolved = report.status === "resolved";
    return (
      <details className="staff-report" key={report.id}>
        <summary className="staff-report-summary">
          <span className="staff-report-icon" data-resolved={resolved}>
            {resolved ? <Check aria-hidden="true" size={20} /> : <TriangleAlert aria-hidden="true" size={20} />}
          </span>
          <span className="staff-report-title">
            <strong>{categories[report.category]}</strong>
            <span>{report.description || "Reported " + formatDate(report.created_at)}</span>
          </span>
          <span className="staff-report-badges">
            <span className="staff-badge" data-status={report.status}>{statusLabels[report.status]}</span>
            {closure && <ClosedBadge />}
          </span>
          <ChevronDown aria-hidden="true" className="staff-row-chevron" size={18} />
        </summary>
        <div className="staff-report-detail">
          <div className="staff-observations">
            <LocationLink latitude={report.latitude} longitude={report.longitude} />
            {report.description && <small>Reported {formatDate(report.created_at)}</small>}
            <div className="staff-report-votes" aria-label="Rider observations">
              <span><strong>{report.still_there}</strong> Still there</span>
              <span><strong>{report.looks_clear}</strong> Looks clear</span>
            </div>
            {report.last_confirmed_at && <small>Last confirmed {formatDate(report.last_confirmed_at)}</small>}
          </div>
          <div className="staff-controls">
            <div className="staff-control-group">
              <h2>Report status</h2>
              {report.resolved_at ? <small>Resolved {formatDate(report.resolved_at)}</small> : (
                <div className="staff-buttons">
                  {report.status === "open" && (
                    <button className="staff-action" data-intent="primary" type="button" disabled={saving !== null}
                      onClick={() => void save(endpoint + "/work")}>
                      {saving === endpoint + "/work" ? "Saving…" : "Start work"}
                    </button>
                  )}
                  <button className="staff-action" data-intent={report.status === "open" ? "normal" : "primary"}
                    type="button" disabled={saving !== null} onClick={() => void save(endpoint + "/resolution")}>
                    {saving === endpoint + "/resolution" ? "Saving…" : "Mark resolved"}
                  </button>
                </div>
              )}
            </div>
            <div className="staff-control-group">
              <h2>Path access</h2>
              {closure && <small>Closed {formatDate(closure.closed_at)}</small>}
              {(closure || !resolved) && <div className="staff-buttons">{closureButton(report.segment_id, Boolean(closure))}</div>}
              {!closure && resolved && <small>Open</small>}
            </div>
          </div>
        </div>
      </details>
    );
  }

  function standaloneClosureRow(closure: ClosedPath) {
    const [latitude, longitude] = closure.geometry[0];
    return (
      <details className="staff-report" key={closure.segment_id}>
        <summary className="staff-report-summary">
          <span className="staff-report-icon"><Ban aria-hidden="true" size={20} /></span>
          <span className="staff-report-title"><strong>{closure.name}</strong><span>Closed {formatDate(closure.closed_at)}</span></span>
          <span className="staff-report-badges"><ClosedBadge /></span>
          <ChevronDown aria-hidden="true" className="staff-row-chevron" size={18} />
        </summary>
        <div className="staff-report-detail">
          <LocationLink latitude={latitude} longitude={longitude} />
          <div className="staff-buttons">{closureButton(closure.segment_id, true)}</div>
        </div>
      </details>
    );
  }

  return (
    <section className="staff-dashboard" aria-labelledby="staff-heading">
      <h1 id="staff-heading">Campus maintenance</h1>
      <div className="staff-filters" role="group" aria-label="Filter hazard reports">
        {(Object.keys(filters) as Filter[]).map((key) => {
          const count = reportsByFilter[key].length + (key === "all" || key === "closed" ? standaloneClosures.length : 0);
          return <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {filters[key]} <span>{count}</span>
          </button>;
        })}
      </div>
      {loading && <p className="staff-message" role="status">Loading reports…</p>}
      {error && <p className="staff-message" role="alert">{error} <button type="button" className="staff-action" onClick={refresh}>Retry</button></p>}
      {saveError && <p className="staff-message" role="alert">{saveError}</p>}
      {!loading && !error && empty && (
        <p className="staff-message">{filter === "all" ? "No hazards reported yet." : "No reports match this filter."}</p>
      )}
      <div className="staff-queue">
        {visibleReports.map(reportRow)}
        {showStandalone && standaloneClosures.map(standaloneClosureRow)}
      </div>
    </section>
  );
}
