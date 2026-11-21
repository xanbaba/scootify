import { useState } from "react";
import { Check, MapPin, TriangleAlert } from "lucide-react";
import { categories, reportRequest, useReports, type Report } from "./reports";

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function AdminReports() {
  const { reports, loading, error, refresh } = useReports(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const open = reports.filter((report) => !report.resolved_at);
  const resolved = reports.filter((report) => report.resolved_at);

  async function resolve(report: Report) {
    setSaving(report.id);
    setSaveError("");
    try {
      await reportRequest<Report>("/api/admin/reports/" + report.id + "/resolution", { method: "PUT" });
      refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not resolve the report.");
    } finally {
      setSaving(null);
    }
  }

  function reportCard(report: Report) {
    const mapLink = "https://www.openstreetmap.org/?mlat=" + report.latitude + "&mlon=" + report.longitude
      + "#map=19/" + report.latitude + "/" + report.longitude;
    return (
      <article className="staff-report" key={report.id}>
        <div className="staff-report-heading">
          <span className="staff-report-icon">{report.resolved_at ? <Check aria-hidden="true" size={20} /> : <TriangleAlert aria-hidden="true" size={20} />}</span>
          <div><h3>{categories[report.category]}</h3><small>Reported {dateTime.format(new Date(report.created_at))}</small></div>
        </div>
        {report.description && <p>{report.description}</p>}
        <div className="staff-report-votes" aria-label="Rider observations">
          <span><strong>{report.still_there}</strong> still there</span>
          <span><strong>{report.looks_clear}</strong> looks clear</span>
        </div>
        {report.last_confirmed_at && <small>Last confirmed {dateTime.format(new Date(report.last_confirmed_at))}</small>}
        <div className="staff-report-actions">
          <a href={mapLink} target="_blank" rel="noreferrer"><MapPin aria-hidden="true" size={17} /> View location</a>
          {report.resolved_at
            ? <small>Resolved {dateTime.format(new Date(report.resolved_at))}</small>
            : <button type="button" disabled={saving !== null} onClick={() => void resolve(report)}>{saving === report.id ? "Resolving…" : "Mark resolved"}</button>}
        </div>
      </article>
    );
  }

  return (
    <>
      <h1>Campus maintenance</h1>
      <section className="staff-queue" aria-labelledby="reports-title">
        <div className="staff-queue-heading"><h2 id="reports-title">Open reports</h2><span>{open.length}</span></div>
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
