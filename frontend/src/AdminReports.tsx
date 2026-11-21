import { useState } from "react";
import { Ban, Check, MapPin, TriangleAlert } from "lucide-react";
import { categories, reportRequest, useReports, type Report } from "./reports";

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const statusLabels = { open: "Open", in_progress: "In progress", resolved: "Resolved" };

export function AdminReports() {
  const { reports, closures, loading, error, refresh } = useReports(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const open = reports.filter((report) => report.status !== "resolved");
  const resolved = reports.filter((report) => report.status === "resolved");
  const closedIds = new Set(closures.map(({ segment_id }) => segment_id));

  async function save(key: string, endpoint: string, body?: { closed: boolean }) {
    setSaving(key);
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

  function changeClosure(segmentId: string, closed: boolean) {
    return save(segmentId, "/api/admin/segments/" + encodeURIComponent(segmentId) + "/closure", { closed });
  }

  function reportCard(report: Report) {
    const mapLink = "https://www.openstreetmap.org/?mlat=" + report.latitude + "&mlon=" + report.longitude
      + "#map=19/" + report.latitude + "/" + report.longitude;
    return (
      <article className="staff-report" key={report.id}>
        <div className="staff-report-heading">
          <span className="staff-report-icon">{report.resolved_at ? <Check aria-hidden="true" size={20} /> : <TriangleAlert aria-hidden="true" size={20} />}</span>
          <div><h3>{categories[report.category]}</h3><small>Reported {dateTime.format(new Date(report.created_at))}</small></div>
          <span className="staff-report-status" data-status={report.status}>{statusLabels[report.status]}</span>
        </div>
        {report.description && <p>{report.description}</p>}
        <div className="staff-report-votes" aria-label="Rider observations">
          <span><strong>{report.still_there}</strong> still there</span>
          <span><strong>{report.looks_clear}</strong> looks clear</span>
        </div>
        {report.last_confirmed_at && <small>Last confirmed {dateTime.format(new Date(report.last_confirmed_at))}</small>}
        <div className="staff-report-actions">
          <a href={mapLink} target="_blank" rel="noreferrer"><MapPin aria-hidden="true" size={17} /> View location</a>
          <div className="staff-report-buttons">
            {closedIds.has(report.segment_id) ? <small className="staff-path-closed">Path closed</small>
              : report.status !== "resolved" && (
                <button type="button" className="staff-close-path" disabled={saving !== null}
                  onClick={() => void changeClosure(report.segment_id, true)}>Close path</button>
              )}
            {report.status === "open" && (
              <button type="button" disabled={saving !== null}
                onClick={() => void save(report.id, "/api/admin/reports/" + report.id + "/work")}>Start work</button>
            )}
            {report.resolved_at ? <small>Resolved {dateTime.format(new Date(report.resolved_at))}</small>
              : <button type="button" disabled={saving !== null}
                onClick={() => void save(report.id, "/api/admin/reports/" + report.id + "/resolution")}>Mark resolved</button>}
          </div>
        </div>
      </article>
    );
  }

  return (
    <>
      <h1>Campus maintenance</h1>
      <section className="staff-queue" aria-labelledby="reports-title">
        {closures.length > 0 && (
          <section className="staff-closures" aria-labelledby="closures-title">
            <div className="staff-queue-heading"><h2 id="closures-title">Closed paths</h2><span>{closures.length}</span></div>
            {closures.map((path) => {
              const report = reports.find(({ segment_id }) => segment_id === path.segment_id);
              const [lat, lon] = report ? [report.latitude, report.longitude] : path.geometry[0];
              return (
                <div className="staff-report staff-closure" key={path.segment_id}>
                  <div className="staff-report-heading">
                    <Ban aria-hidden="true" size={20} />
                    <div><h3>{path.name}{report ? " · " + categories[report.category] : ""}</h3>
                      <small>Closed {dateTime.format(new Date(path.closed_at))}</small></div>
                  </div>
                  <div className="staff-report-actions">
                    <a href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=19/${lat}/${lon}`} target="_blank" rel="noreferrer">
                      <MapPin aria-hidden="true" size={17} /> View location
                    </a>
                    <button type="button" disabled={saving !== null} onClick={() => void changeClosure(path.segment_id, false)}>Reopen path</button>
                  </div>
                </div>
              );
            })}
          </section>
        )}
        <div className="staff-queue-heading"><h2 id="reports-title">Active reports</h2><span>{open.length}</span></div>
        {loading && <p role="status">Loading reports…</p>}
        {error && <p role="alert">{error} <button type="button" onClick={refresh}>Retry</button></p>}
        {saveError && <p role="alert">{saveError}</p>}
        {!loading && !error && !open.length && <p className="panel">No open hazards on campus.</p>}
        {open.map(reportCard)}
        {resolved.length > 0 && (
          <details className="staff-history">
            <summary>Resolved reports ({resolved.length})</summary>
            <div>{resolved.map(reportCard)}</div>
          </details>
        )}
      </section>
    </>
  );
}
