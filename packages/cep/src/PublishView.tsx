import { useMemo, useState } from "react";
import { DELIVERABLE_SOFT_CAP_BYTES, formatBytes } from "@gml/core";
import { safeFolderName, type PublishProgress } from "@gml/storage";
import type { LibraryRuntime } from "./runtime.js";

/**
 * Publish writes exactly what a human would have created by hand: one folder
 * per asset inside the category folder, Preview.mp4 beside the deliverables.
 * Render standards are shown as warnings, never blockers.
 */
function pathOf(file: File | undefined): string {
  return (file as (File & { path?: string }) | undefined)?.path ?? "";
}

export function PublishView({ runtime, onDone, onClose }: { runtime: LibraryRuntime; onDone: () => void; onClose: () => void }) {
  const index = runtime.currentIndex();
  const folders = useMemo(() => [...new Set(index.assets.map((a) => a.categoryFolder))].sort(), [index]);
  const [categoryFolder, setCategoryFolder] = useState(folders[0] ?? "");
  const [name, setName] = useState("");
  const [deliverables, setDeliverables] = useState<{ path: string; size: number }[]>([]);
  const [preview, setPreview] = useState<{ path: string; size: number } | null>(null);
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const warnings: string[] = [];
  for (const d of deliverables) {
    const file = d.path.split(/[\\/]/).pop() ?? d.path;
    if (d.size > DELIVERABLE_SOFT_CAP_BYTES) warnings.push(`${file} is ${formatBytes(d.size)} — above the 500 MB soft cap. Prefer ProRes 4444 (not XQ) at 1080p.`);
    if (!/\.(mov|mp4|webm|aep|ai|png|psd)$/i.test(file)) warnings.push(`${file}: unexpected file type.`);
  }
  if (preview && !/\.mp4$/i.test(preview.path)) warnings.push("The preview should be an H.264 MP4 so every panel can play it.");

  const ready = Boolean(categoryFolder && safeFolderName(name) && deliverables.length > 0 && preview);

  const submit = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      await runtime.publish(
        { categoryFolder, name, deliverables: deliverables.map((d) => ({ localPath: d.path })), previewLocalPath: preview.path },
        setProgress,
      );
      await runtime.scan().catch(() => {});
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="gml-diag" data-testid="publish">
      <header className="gml-diag__head">
        <strong>Publish to Library</strong>
        <span className="gml-diag__summary">writes {categoryFolder || "…"}/{safeFolderName(name) || "…"}/</span>
        <button type="button" className="gml-toolbar__btn" onClick={onClose} disabled={busy}>Close</button>
      </header>

      <div className="gml-diag__body gml-form">
        <label className="gml-form__row">
          <span>Category</span>
          <select className="gml-form__input" value={categoryFolder} onChange={(e) => setCategoryFolder(e.target.value)}>
            {folders.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="gml-form__row">
          <span>Name</span>
          <input className="gml-form__input" value={name} dir="auto" placeholder="Arrows" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="gml-form__row">
          <span>Deliverables</span>
          <input
            type="file"
            multiple
            className="gml-form__file"
            accept=".mov,.mp4,.webm,.aep,.ai,.png,.psd"
            onChange={(e) => setDeliverables(Array.from(e.target.files ?? []).map((f) => ({ path: pathOf(f), size: f.size })).filter((f) => f.path))}
          />
        </label>
        <label className="gml-form__row">
          <span>Preview MP4</span>
          <input
            type="file"
            className="gml-form__file"
            accept="video/mp4,.mp4"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setPreview(f && pathOf(f) ? { path: pathOf(f), size: f.size } : null);
            }}
          />
        </label>

        <h3 className="gml-diag__h3">Render standards</h3>
        <p className="gml-diag__detail">ProRes 4444 (not XQ) · 1080p unless the element is genuinely used full-frame · under 500 MB per file. Warnings do not block.</p>
        {warnings.map((w) => (
          <p key={w} className="gml-inspector__warn">{w}</p>
        ))}

        {progress && (
          <p className="gml-diag__detail">
            {progress.file} · {formatBytes(progress.done)} / {formatBytes(progress.total)} · file {progress.index + 1} of {progress.count}
          </p>
        )}
        {error && <p className="gml-error" role="alert">{error}</p>}

        <div className="gml-form__actions">
          <button type="button" className="gml-primary" disabled={!ready || busy} onClick={() => void submit()}>
            {busy ? "Publishing…" : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}
