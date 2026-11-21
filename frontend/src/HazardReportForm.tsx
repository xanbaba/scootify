import { useEffect, useState, type FormEvent } from "react";
import { MapPin, TriangleAlert, X } from "lucide-react";
import type { Coordinate } from "./navigationHeading";
import { categories, reportRequest, type Category, type Report, type ReportPath } from "./reports";

type Props = {
  point: Coordinate | null;
  locationMessage: string;
  onSelectPath: (path: ReportPath | null) => void;
  onClose: () => void;
  onPosted: (reportId: string) => void;
};

function suggestCategory(description: string): Category | null {
  if (/\b(pot\s?holes?|holes? in (?:the )?(?:road|path))\b/i.test(description)) return "pothole";
  if (/\b(blocked|blocking|impassable|path is closed)\b/i.test(description)) return "blocked_path";
  if (/\b(debris|branches?|broken glass|rubbish)\b/i.test(description)) return "debris";
  if (/\b(slippery|ice|oil spill|slick)\b/i.test(description)) return "slippery";
  return null;
}

export function HazardReportForm({ point, locationMessage, onSelectPath, onClose, onPosted }: Props) {
  const [description, setDescription] = useState("");
  const [manualCategory, setManualCategory] = useState<Category | null>(null);
  const [result, setResult] = useState<{ point: Coordinate; paths: ReportPath[]; error?: string } | null>(null);
  const [selection, setSelection] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");
  const category = manualCategory ?? suggestCategory(description);
  const current = result?.point === point ? result : null;
  const paths = current?.paths ?? [];
  const selected = paths.find((path) => path.segment_id === selection) ?? paths[0];

  useEffect(() => {
    if (!point) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ latitude: String(point[0]), longitude: String(point[1]) });
    reportRequest<ReportPath[]>("/api/report-paths?" + params, { signal: controller.signal })
      .then((paths) => {
        if (!controller.signal.aborted) {
          setSelection("");
          setResult({ point, paths });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ point, paths: [], error: "Could not find nearby paths. Tap the map to retry." });
      });
    return () => controller.abort();
  }, [point]);

  useEffect(() => {
    onSelectPath(selected ?? null);
  }, [onSelectPath, selected]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!point || !selected || !category || posting) return;
    setPosting(true);
    setPostError("");
    try {
      const report = await reportRequest<Report>("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category, description, segment_id: selected.segment_id,
          point: { latitude: point[0], longitude: point[1] },
        }),
      });
      onPosted(report.id);
    } catch (error) {
      setPostError(error instanceof Error ? error.message : "Could not post the hazard.");
      setPosting(false);
    }
  }

  return (
    <form className="hazard-form" onSubmit={submit}>
      <div className="sheet-heading">
        <h1><TriangleAlert aria-hidden="true" size={24} /> Report a hazard</h1>
        <button type="button" className="plain-icon" aria-label="Cancel hazard report" onClick={onClose} disabled={posting}><X aria-hidden="true" size={22} /></button>
      </div>
      <div className="hazard-categories" role="group" aria-label="Hazard category">
        {(Object.entries(categories) as [Category, string][]).map(([key, label]) => (
          <button type="button" className="sheet-secondary" key={key} aria-pressed={category === key} onClick={() => setManualCategory(key)}>{label}</button>
        ))}
      </div>
      <label className="hazard-field">
        <span>Description <small>Optional</small></span>
        <textarea rows={2} maxLength={280} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Type or use your keyboard’s mic" />
      </label>
      <div className="hazard-location">
        <p className="sheet-note" role="status"><MapPin aria-hidden="true" size={16} />{locationMessage}</p>
        {point && selected && (
          <label className="hazard-field">
            <span>Affected path</span>
            <select value={selected.segment_id} onChange={(event) => setSelection(event.target.value)}>
              {paths.map((path, index) => (
                <option key={path.segment_id} value={path.segment_id}>
                  {index + 1}. {path.name} · {Math.round(path.distance_m)} m away{path.modes.includes("bike") ? "" : " · Walk"}
                </option>
              ))}
            </select>
          </label>
        )}
        {point && !selected && <p className="sheet-note" role="status">{current?.error ?? (current ? "No path nearby. Move the pin closer to the hazard." : "Finding nearby paths…")}</p>}
      </div>
      {postError && <p className="sheet-note route-error" role="alert">{postError}</p>}
      <button type="submit" className="go-button" disabled={!category || !selected || posting}>{posting ? "Posting…" : "Post hazard"}</button>
    </form>
  );
}
