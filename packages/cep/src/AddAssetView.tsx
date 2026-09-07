import { useEffect, useMemo, useState } from "react";
import { CATEGORIES, CATEGORY_LABELS, type Category, type MotionAsset } from "@gml/core";
import { pathToFileUrl, type FolderLibraryProvider } from "@gml/storage";
import { inspectComp, saveProject, type CompInspection } from "./host-calls.js";
import { assessComp, buildMotionPackage, bumpPatch, slugFromName, type Assessment } from "./package-builder.js";
import { extractPosterFromVideo } from "./poster.js";

/**
 * "Publish to Library" for After Effects.
 *
 * The designer renders the preview MP4 the way they already do (Render Queue
 * or Media Encoder); the panel reads the comp, judges it, extracts a poster
 * from the preview, and writes the package into the library folder through
 * the staged protocol. Nothing here modifies the project.
 */

type MotionCategory = Exclude<Category, "audio">;
const MOTION_CATEGORIES = CATEGORIES.filter((c): c is MotionCategory => c !== "audio");

/** CEP populates File.path when Node is enabled; a plain browser does not. */
function pathOf(file: File | undefined): string {
  return (file as (File & { path?: string }) | undefined)?.path ?? "";
}

export function AddAssetView({
  provider,
  author,
  onDone,
  onClose,
}: {
  provider: FolderLibraryProvider;
  author: string;
  onDone: (asset: MotionAsset) => void;
  onClose: () => void;
}) {
  const [inspection, setInspection] = useState<CompInspection | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");

  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [version, setVersion] = useState("1.0.0");
  const [category, setCategory] = useState<MotionCategory>("animated-texts");
  const [tags, setTags] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"draft" | "approved">("draft");
  const [previewPath, setPreviewPath] = useState("");
  const [posterPath, setPosterPath] = useState("");

  const refresh = async () => {
    setInspectError(null);
    try {
      const next = await inspectComp();
      setInspection(next);
      if (!nameEn) setNameEn(next.compName.replace(/^GML[_-]?/i, "").replace(/[_-]+/g, " ").trim());
    } catch (e) {
      setInspection(null);
      setInspectError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!idTouched) setId(slugFromName(nameEn));
  }, [nameEn, idTouched]);

  useEffect(() => {
    // A second publish of the same id defaults to the next patch version.
    if (!id) return;
    const latest = provider.assetSync(id, version) ? version : null;
    if (latest) setVersion(bumpPatch(latest));
  }, [id]);

  const assessment: Assessment | null = useMemo(() => (inspection ? assessComp(inspection) : null), [inspection]);
  const canApprove = assessment?.footage === "bundled";

  useEffect(() => {
    if (!canApprove) setStatus("draft");
  }, [canApprove]);

  const submit = async () => {
    if (!inspection || !assessment) return;
    setBusy(true);
    setError(null);
    try {
      if (inspection.projectDirty) {
        setProgress("Saving project…");
        await saveProject();
        const fresh = await inspectComp();
        setInspection(fresh);
        if (fresh.projectDirty) throw new Error("The project still has unsaved changes.");
      }

      let posterBytes: Uint8Array | undefined;
      if (!posterPath) {
        setProgress("Extracting poster from preview…");
        posterBytes = await extractPosterFromVideo(pathToFileUrl(previewPath));
      }

      setProgress("Writing package…");
      const asset = await buildMotionPackage(provider, inspection, {
        id,
        version,
        nameEn,
        nameAr,
        description,
        category,
        tags: tags.split(/[,،]/),
        status,
        author,
        previewPath,
        posterPath: posterPath || undefined,
        posterBytes,
      });
      onDone(asset);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const ready =
    Boolean(inspection && assessment?.report.ok) &&
    /^gml_[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(id) &&
    /^\d+\.\d+\.\d+$/.test(version) &&
    nameEn.trim().length > 0 &&
    previewPath.length > 0;

  return (
    <div className="gml-diag" data-testid="add-asset">
      <header className="gml-diag__head">
        <strong>Publish to Library</strong>
        <span className="gml-diag__summary">{inspection ? inspection.compName : "…"}</span>
        <button type="button" className="gml-toolbar__btn" onClick={() => void refresh()} disabled={busy}>
          Re-read comp
        </button>
        <button type="button" className="gml-toolbar__btn" onClick={onClose} disabled={busy}>
          Close
        </button>
      </header>

      <div className="gml-diag__body gml-form">
        {inspectError && (
          <p className="gml-error" role="alert">
            {inspectError}
          </p>
        )}

        {inspection && assessment && (
          <>
            <h3 className="gml-diag__h3">Composition</h3>
            <p className="gml-diag__detail">
              {inspection.width}×{inspection.height} · {inspection.fps} fps · {inspection.duration.toFixed(2)}s ·{" "}
              {inspection.footage.length} footage item(s) · {inspection.fonts.length} font(s) ·{" "}
              {assessment.plugins.length} third-party effect(s)
            </p>

            <h3 className="gml-diag__h3">Readiness</h3>
            {assessment.report.blockers.map((b) => (
              <div key={b.code + b.message} className="gml-diag__row">
                <span className="gml-diag__verdict" style={{ color: "var(--danger)" }}>
                  BLOCK
                </span>
                <div>
                  <div className="gml-diag__label">{b.message}</div>
                  {b.detail && <div className="gml-diag__detail">{b.detail}</div>}
                </div>
              </div>
            ))}
            <div className="gml-diag__row">
              <span
                className="gml-diag__verdict"
                style={{ color: assessment.footage === "bundled" ? "var(--accent)" : "var(--warn)" }}
              >
                {assessment.footage === "bundled" ? "OK" : "WARN"}
              </span>
              <div>
                <div className="gml-diag__label">
                  {assessment.footage === "bundled"
                    ? "No file footage — the package is self-contained"
                    : `${assessment.externalFiles.length} footage file(s) are not bundled — draft only`}
                </div>
                {assessment.footage === "external" && (
                  <div className="gml-diag__detail">
                    {assessment.externalFiles.slice(0, 5).join(" · ")}
                    {assessment.externalFiles.length > 5 ? " …" : ""}
                    <br />
                    Collecting footage into the package arrives with M3 (after Spike A). Until then this
                    asset only renders on machines that have these files.
                  </div>
                )}
              </div>
            </div>
            {assessment.fonts.map((f) => (
              <div key={f} className="gml-diag__row">
                <span className="gml-diag__verdict" style={{ color: "var(--warn)" }}>
                  FONT
                </span>
                <div className="gml-diag__label">{f}</div>
              </div>
            ))}
            {assessment.plugins.map((p) => (
              <div key={p.matchName} className="gml-diag__row">
                <span className="gml-diag__verdict" style={{ color: "var(--warn)" }}>
                  PLUGIN
                </span>
                <div className="gml-diag__label">{p.name}</div>
              </div>
            ))}
            {inspection.projectDirty && (
              <p className="gml-diag__detail">The project will be saved before packaging.</p>
            )}

            <h3 className="gml-diag__h3">Details</h3>
            <label className="gml-form__row">
              <span>Name (EN)</span>
              <input className="gml-form__input" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </label>
            <label className="gml-form__row">
              <span>الاسم (AR)</span>
              <input className="gml-form__input" dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
            </label>
            <label className="gml-form__row">
              <span>ID</span>
              <input
                className="gml-form__input gml-form__mono"
                value={id}
                onChange={(e) => {
                  setIdTouched(true);
                  setId(e.target.value);
                }}
              />
            </label>
            <label className="gml-form__row">
              <span>Version</span>
              <input className="gml-form__input gml-form__mono" value={version} onChange={(e) => setVersion(e.target.value)} />
            </label>
            <label className="gml-form__row">
              <span>Category</span>
              <select className="gml-form__input" value={category} onChange={(e) => setCategory(e.target.value as MotionCategory)}>
                {MOTION_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c].en} · {CATEGORY_LABELS[c].ar}
                  </option>
                ))}
              </select>
            </label>
            <label className="gml-form__row">
              <span>Tags</span>
              <input className="gml-form__input" placeholder="intro, clean" value={tags} onChange={(e) => setTags(e.target.value)} />
            </label>
            <label className="gml-form__row">
              <span>Description</span>
              <input className="gml-form__input" value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <label className="gml-form__row">
              <span>Status</span>
              <select
                className="gml-form__input"
                value={status}
                disabled={!canApprove}
                onChange={(e) => setStatus(e.target.value as "draft" | "approved")}
              >
                <option value="draft">Draft</option>
                <option value="approved">Approved</option>
              </select>
            </label>

            <h3 className="gml-diag__h3">Media</h3>
            <label className="gml-form__row">
              <span>Preview MP4</span>
              <input
                type="file"
                accept="video/mp4,.mp4"
                className="gml-form__file"
                onChange={(e) => setPreviewPath(pathOf(e.target.files?.[0]))}
              />
            </label>
            <label className="gml-form__row">
              <span />
              <input
                className="gml-form__input gml-form__mono"
                placeholder="…or paste the full path to preview.mp4"
                value={previewPath}
                onChange={(e) => setPreviewPath(e.target.value)}
              />
            </label>
            <label className="gml-form__row">
              <span>Poster PNG</span>
              <input
                type="file"
                accept="image/png,.png"
                className="gml-form__file"
                onChange={(e) => setPosterPath(pathOf(e.target.files?.[0]))}
              />
            </label>
            <p className="gml-diag__detail">
              Poster is optional: without one, a frame is taken from the preview. Render the preview at
              comp size, H.264, no audio — the same file the library shows on hover.
            </p>

            {error && (
              <p className="gml-error" role="alert">
                {error}
              </p>
            )}
            <div className="gml-form__actions">
              <span className="gml-diag__detail">{progress}</span>
              <button type="button" className="gml-primary" disabled={!ready || busy} onClick={() => void submit()}>
                {busy ? "Publishing…" : status === "approved" ? "Publish as approved" : "Publish draft"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
