import { useCallback, useEffect, useMemo, useState } from "react";
import { CATEGORIES, CATEGORY_LABELS, isCategory, type Category } from "@gml/core";
import { listInbox, pathToFileUrl, removeInboxItem, type FolderLibraryProvider, type InboxItem } from "@gml/storage";
import { inspectAep, type AepComp } from "./host-calls.js";
import type { PanelNode } from "./node.js";
import { assessComp, buildMotionPackage, bumpPatch, slugFromName } from "./package-builder.js";
import { extractPosterFromVideo } from "./poster.js";

/**
 * Turns whatever was dropped into GML_Library/_inbox into verified packages.
 *
 * Each inbox folder is read through After Effects (gmlInspectAep) so the comp
 * list, size, fps and dependencies come from the project itself rather than
 * from a hand-written file. asset.json in the folder pre-fills the form; the
 * folder name is the fallback for the asset name.
 */

type MotionCategory = Exclude<Category, "audio">;
const MOTION_CATEGORIES = CATEGORIES.filter((c): c is MotionCategory => c !== "audio");

interface Row {
  item: InboxItem;
  comps: AepComp[] | null;
  inspectError: string | null;
  compName: string;
  nameEn: string;
  nameAr: string;
  id: string;
  version: string;
  category: MotionCategory;
  tags: string;
  description: string;
  status: "draft" | "approved";
  state: "idle" | "importing" | "done" | "failed";
  message: string;
}

/** Prefer a comp nothing else uses — the "main" one — when asset.json does not say. */
function pickDefaultComp(comps: AepComp[], wanted?: string): string {
  if (wanted && comps.some((c) => c.compName === wanted)) return wanted;
  if (comps.length === 1) return comps[0]!.compName;
  const gml = comps.find((c) => /^GML[_-]/i.test(c.compName));
  if (gml) return gml.compName;
  const largest = [...comps].sort((a, b) => b.numLayers - a.numLayers)[0];
  return largest?.compName ?? "";
}

function rowFor(item: InboxItem, provider: FolderLibraryProvider): Row {
  const d = item.defaults;
  const nameEn = d.nameEn ?? item.name.replace(/[_-]+/g, " ").trim();
  const id = d.id ?? slugFromName(nameEn);
  let version = d.version ?? "1.0.0";
  while (id && provider.assetSync(id, version)) version = bumpPatch(version);
  return {
    item,
    comps: null,
    inspectError: null,
    compName: d.compName ?? "",
    nameEn,
    nameAr: d.nameAr ?? "",
    id,
    version,
    category: d.category && isCategory(d.category) && d.category !== "audio" ? d.category : "animated-texts",
    tags: (d.tags ?? []).join(", "),
    description: d.description ?? "",
    status: d.status === "approved" ? "approved" : "draft",
    state: "idle",
    message: item.problems.join(" · "),
  };
}

export function InboxView({
  node,
  provider,
  author,
  onImported,
  onClose,
}: {
  node: PanelNode;
  provider: FolderLibraryProvider;
  author: string;
  onImported: (count: number) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  const update = useCallback((folder: string, patch: Partial<Row> | ((r: Row) => Partial<Row>)) => {
    setRows((current) =>
      current.map((r) => (r.item.folder === folder ? { ...r, ...(typeof patch === "function" ? patch(r) : patch) } : r)),
    );
  }, []);

  const scan = useCallback(async () => {
    const items = listInbox(node.fs, provider.root);
    const initial = items.map((item) => rowFor(item, provider));
    setRows(initial);

    // Inspect sequentially: each call imports and removes a project in AE.
    for (const row of initial) {
      if (!row.item.aep) continue;
      try {
        const { comps } = await inspectAep(row.item.aep);
        update(row.item.folder, (r) => ({
          comps,
          compName: pickDefaultComp(comps, r.compName || r.item.defaults.compName),
          inspectError: comps.length === 0 ? "no compositions in this project" : null,
        }));
      } catch (e) {
        update(row.item.folder, { inspectError: e instanceof Error ? e.message : String(e) });
      }
    }
  }, [node, provider, update]);

  useEffect(() => {
    void scan();
  }, [scan]);

  const readyRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.state !== "done" &&
          r.item.problems.length === 0 &&
          r.comps &&
          r.comps.some((c) => c.compName === r.compName) &&
          /^gml_[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(r.id) &&
          /^\d+\.\d+\.\d+$/.test(r.version) &&
          r.nameEn.trim().length > 0,
      ),
    [rows],
  );

  const importRow = async (row: Row): Promise<boolean> => {
    const comp = row.comps?.find((c) => c.compName === row.compName);
    if (!comp || !row.item.preview) return false;
    update(row.item.folder, { state: "importing", message: "packaging…" });
    try {
      let posterBytes: Uint8Array | undefined;
      if (!row.item.poster) {
        update(row.item.folder, { message: "extracting poster…" });
        posterBytes = await extractPosterFromVideo(pathToFileUrl(row.item.preview));
      }
      const asset = await buildMotionPackage(provider, comp, {
        id: row.id,
        version: row.version,
        nameEn: row.nameEn,
        nameAr: row.nameAr,
        description: row.description,
        category: row.category,
        tags: row.tags.split(/[,،]/),
        status: row.status,
        author,
        previewPath: row.item.preview,
        posterPath: row.item.poster ?? undefined,
        posterBytes,
      });
      removeInboxItem(node.fs, row.item);
      update(row.item.folder, { state: "done", message: `→ ${asset.status}/${asset.id}` });
      return true;
    } catch (e) {
      update(row.item.folder, { state: "failed", message: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };

  const importAll = async () => {
    setBusy(true);
    let count = 0;
    try {
      for (const row of readyRows) {
        if (await importRow(row)) count += 1;
      }
    } finally {
      setBusy(false);
      if (count > 0) onImported(count);
    }
  };

  return (
    <div className="gml-diag" data-testid="inbox">
      <header className="gml-diag__head">
        <strong>Inbox</strong>
        <span className="gml-diag__summary">
          {rows.length === 0 ? "nothing in _inbox" : `${rows.length} folder(s) · ${readyRows.length} ready`}
        </span>
        <button type="button" className="gml-toolbar__btn" onClick={() => void scan()} disabled={busy}>
          Rescan
        </button>
        <button type="button" className="gml-primary" onClick={() => void importAll()} disabled={busy || readyRows.length === 0}>
          {busy ? "Importing…" : `Import ${readyRows.length}`}
        </button>
        <button type="button" className="gml-toolbar__btn" onClick={onClose} disabled={busy}>
          Close
        </button>
      </header>

      <div className="gml-diag__body gml-form">
        {rows.length === 0 && (
          <p className="gml-diag__detail">
            Drop a folder per asset into <code>{node.fs.join(provider.root, "_inbox")}</code> — one .aep, one
            .mp4 preview, an optional poster.png and an optional asset.json — then press Rescan.
          </p>
        )}

        {rows.map((row) => {
          const comp = row.comps?.find((c) => c.compName === row.compName);
          const assessment = comp ? assessComp(comp) : null;
          const canApprove = assessment?.footage === "bundled";
          const color =
            row.state === "done" ? "var(--accent)" : row.state === "failed" || row.item.problems.length > 0 || row.inspectError ? "var(--danger)" : "var(--text-2)";
          return (
            <section key={row.item.folder} className="gml-inbox__item" data-testid={`inbox-${row.item.name}`}>
              <div className="gml-diag__row">
                <span className="gml-diag__verdict" style={{ color }}>
                  {row.state === "done" ? "DONE" : row.state === "failed" ? "FAIL" : row.item.problems.length > 0 ? "SKIP" : row.comps ? "READY" : "…"}
                </span>
                <div className="gml-form__grow">
                  <div className="gml-diag__label">{row.item.name}</div>
                  <div className="gml-diag__detail">
                    {row.inspectError ?? row.message ?? ""}
                    {comp && assessment && (
                      <>
                        {" "}
                        {comp.width}×{comp.height} · {comp.fps} fps · {comp.duration.toFixed(2)}s ·{" "}
                        {assessment.footage === "bundled" ? "self-contained" : `${assessment.externalFiles.length} external file(s) — draft only`}
                        {assessment.report.blockers.length > 0 && ` · ${assessment.report.blockers.map((b) => b.message).join("; ")}`}
                        {!row.item.poster && " · poster from preview"}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {row.state !== "done" && row.item.problems.length === 0 && (
                <div className="gml-inbox__fields">
                  <label className="gml-form__row">
                    <span>Comp</span>
                    <select
                      className="gml-form__input"
                      value={row.compName}
                      disabled={!row.comps || busy}
                      onChange={(e) => update(row.item.folder, { compName: e.target.value })}
                    >
                      {!row.comps && <option value="">reading…</option>}
                      {row.comps?.map((c) => (
                        <option key={c.compId} value={c.compName}>
                          {c.compName} ({c.numLayers} layers)
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="gml-form__row">
                    <span>Name EN / AR</span>
                    <input className="gml-form__input" value={row.nameEn} disabled={busy} onChange={(e) => update(row.item.folder, { nameEn: e.target.value, id: slugFromName(e.target.value) })} />
                    <input className="gml-form__input" dir="rtl" value={row.nameAr} disabled={busy} onChange={(e) => update(row.item.folder, { nameAr: e.target.value })} />
                  </label>
                  <label className="gml-form__row">
                    <span>ID @ version</span>
                    <input className="gml-form__input gml-form__mono" value={row.id} disabled={busy} onChange={(e) => update(row.item.folder, { id: e.target.value })} />
                    <input className="gml-form__input gml-form__mono gml-inbox__short" value={row.version} disabled={busy} onChange={(e) => update(row.item.folder, { version: e.target.value })} />
                  </label>
                  <label className="gml-form__row">
                    <span>Category · status</span>
                    <select className="gml-form__input" value={row.category} disabled={busy} onChange={(e) => update(row.item.folder, { category: e.target.value as MotionCategory })}>
                      {MOTION_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABELS[c].en} · {CATEGORY_LABELS[c].ar}
                        </option>
                      ))}
                    </select>
                    <select
                      className="gml-form__input gml-inbox__short"
                      value={canApprove ? row.status : "draft"}
                      disabled={busy || !canApprove}
                      onChange={(e) => update(row.item.folder, { status: e.target.value as "draft" | "approved" })}
                    >
                      <option value="draft">Draft</option>
                      <option value="approved">Approved</option>
                    </select>
                  </label>
                  <label className="gml-form__row">
                    <span>Tags</span>
                    <input className="gml-form__input" value={row.tags} disabled={busy} placeholder="intro, clean" onChange={(e) => update(row.item.folder, { tags: e.target.value })} />
                  </label>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
