import { useEffect, useMemo, useState } from "react";
import { formatBytes } from "@gml/core";
import { findDriveMounts, looksSynced, type ScanReport } from "@gml/storage";
import { DEFAULT_CACHE_CAP_GB, driveRootPathFromMount, type GmlConfig } from "./config.js";
import type { PanelNode } from "./node.js";
import type { LibraryRuntime } from "./runtime.js";

/**
 * Library folder, index, cache and transport in one place. Everything here is
 * per machine; the library itself is never touched.
 */
export function SettingsView({
  node,
  runtime,
  config,
  onSave,
  onClose,
  canScan,
}: {
  node: PanelNode | null;
  runtime: LibraryRuntime | null;
  config: GmlConfig;
  onSave: (next: GmlConfig) => void;
  onClose?: () => void;
  /** After Effects can expand master projects; Illustrator only re-reads files. */
  canScan: boolean;
}) {
  const [draft, setDraft] = useState<GmlConfig>(config);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanLog, setScanLog] = useState<string>("");
  const [report, setReport] = useState<ScanReport | null>(runtime?.lastScan ?? null);
  const [tick, setTick] = useState(0);

  useEffect(() => setDraft(config), [config]);

  const status = runtime?.status();
  const usage = useMemo(() => runtime?.store.usage() ?? null, [runtime, tick, report]);
  const pins = runtime?.store.readPins().size ?? 0;
  const mounts = useMemo(() => (node ? findDriveMounts(node.fs, { platform: node.platform, homedir: node.homedir }) : []), [node]);
  const cacheWarning = draft.cacheRoot ? looksSynced(draft.cacheRoot) : null;
  const driveRoot = draft.drive?.rootPath || (draft.libraryRoot ? driveRootPathFromMount(draft.libraryRoot) : null);

  const save = () => {
    setError(null);
    if (node && draft.libraryRoot && !node.exists(draft.libraryRoot)) {
      setError(`Folder not found: ${draft.libraryRoot}`);
      return;
    }
    onSave(draft);
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setTick((n) => n + 1);
    }
  };

  if (!node) {
    return (
      <div className="gml-diag" data-testid="settings">
        <header className="gml-diag__head">
          <strong>Settings</strong>
          {onClose && <button type="button" className="gml-toolbar__btn" onClick={onClose}>Close</button>}
        </header>
        <div className="gml-diag__body">
          <p className="gml-error">Node.js is not available in this panel, so the library cannot be read. Open Diagnostics and send me the report.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="gml-diag" data-testid="settings">
      <header className="gml-diag__head">
        <strong>Settings</strong>
        <span className="gml-diag__summary">
          {status ? `${status.assets} assets · ${status.transport} · ${status.signedIn ? `signed in${status.account ? ` as ${status.account}` : ""}` : "not signed in"}` : "no library yet"}
        </span>
        <button type="button" className="gml-primary" onClick={save} disabled={busy !== null}>Save</button>
        {onClose && <button type="button" className="gml-toolbar__btn" onClick={onClose} disabled={busy !== null}>Close</button>}
      </header>

      <div className="gml-diag__body gml-form">
        <h3 className="gml-diag__h3">Library folder (Google Drive for Desktop)</h3>
        <label className="gml-form__row">
          <span>Folder</span>
          <input
            className="gml-form__input gml-form__mono"
            value={draft.libraryRoot ?? ""}
            placeholder={node.platform === "win32" ? "G:\\Shared drives\\Motion\\Hamza\\2026\\Motion Library" : "~/Library/CloudStorage/GoogleDrive-…/Shared drives/Motion/…"}
            onChange={(e) => setDraft({ ...draft, libraryRoot: e.target.value })}
            data-testid="library-root"
          />
        </label>
        {mounts.length > 0 && (
          <p className="gml-diag__detail">
            Drive mounts here: {mounts.map((m) => m.root).join(" · ")}
          </p>
        )}
        <div className="gml-form__row">
          <span>Index</span>
          <span className="gml-diag__detail gml-form__grow">
            {status?.indexedAt ? `${status.assets} assets · scanned ${status.indexedAt.slice(0, 16).replace("T", " ")}` : "not scanned yet"}
            {!status?.libraryMounted && draft.libraryRoot ? " · folder not reachable right now" : ""}
          </span>
          <button
            type="button"
            className="gml-toolbar__btn"
            disabled={busy !== null || !runtime || !draft.libraryRoot}
            data-testid="rescan"
            onClick={() =>
              run("scan", async () => {
                if (draft.libraryRoot !== config.libraryRoot) onSave(draft);
                const r = await runtime!.scan((m) => setScanLog(m));
                setReport(r);
                setScanLog("");
              })
            }
          >
            {busy === "scan" ? "Scanning…" : canScan ? "Rescan" : "Re-read index"}
          </button>
        </div>
        {scanLog && <p className="gml-diag__detail">{scanLog}</p>}
        {report && (
          <p className="gml-diag__detail">
            {report.index.assets.length} assets · {report.probed} files probed · {report.reusedDirs} folders reused
            {report.unknownFolders.length > 0 && ` · not a category: ${report.unknownFolders.join(", ")}`}
            {report.uninspectedProjects.length > 0 && ` · ${report.uninspectedProjects.length} project(s) await After Effects to list their comps`}
          </p>
        )}

        <h3 className="gml-diag__h3">Local cache</h3>
        <label className="gml-form__row">
          <span>Folder</span>
          <input
            className="gml-form__input gml-form__mono"
            value={draft.cacheRoot ?? runtime?.cacheRoot ?? ""}
            onChange={(e) => setDraft({ ...draft, cacheRoot: e.target.value || undefined })}
            data-testid="cache-root"
          />
        </label>
        {cacheWarning && <p className="gml-error">That is {cacheWarning}. Use a local disk — a scratch SSD is ideal.</p>}
        <label className="gml-form__row">
          <span>Size cap</span>
          <input
            className="gml-form__input"
            type="number"
            min={1}
            step={1}
            value={draft.cacheCapGB ?? DEFAULT_CACHE_CAP_GB}
            onChange={(e) => setDraft({ ...draft, cacheCapGB: Math.max(1, Number(e.target.value) || DEFAULT_CACHE_CAP_GB) })}
            style={{ flex: "0 0 80px" }}
          />
          <span className="gml-diag__detail">GB</span>
        </label>
        {usage && (
          <>
            <div className="gml-form__row">
              <span>Used</span>
              <span className="gml-diag__detail gml-form__grow">
                {formatBytes(usage.bytes)} of {draft.cacheCapGB ?? DEFAULT_CACHE_CAP_GB} GB · {usage.byKey.size} cached version(s) · {pins} pinned by the open project
              </span>
              <button
                type="button"
                className="gml-toolbar__btn"
                disabled={busy !== null || !runtime}
                onClick={() =>
                  run("clean", async () => {
                    runtime!.store.clean();
                  })
                }
              >
                Clean
              </button>
            </div>
            <div className="gml-meter">
              <span className="gml-meter__fill" data-over={usage.bytes > runtime!.capBytes() || undefined} style={{ inlineSize: `${Math.min(100, (usage.bytes / runtime!.capBytes()) * 100)}%` }} />
            </div>
          </>
        )}

        <h3 className="gml-diag__h3">Transport</h3>
        <label className="gml-form__row">
          <span>Fetch via</span>
          <select className="gml-form__input" value={draft.transport ?? "mount"} onChange={(e) => setDraft({ ...draft, transport: e.target.value as "mount" | "drive" })}>
            <option value="mount">Google Drive for Desktop mount (no sign-in)</option>
            <option value="drive">Google Drive API (sign in — resumable, works without the mount)</option>
          </select>
        </label>
        <label className="gml-form__row">
          <span>Client ID</span>
          <input className="gml-form__input gml-form__mono" value={draft.drive?.clientId ?? ""} placeholder="….apps.googleusercontent.com" onChange={(e) => setDraft({ ...draft, drive: { ...draft.drive, clientId: e.target.value } })} />
        </label>
        <label className="gml-form__row">
          <span>Client secret</span>
          <input className="gml-form__input gml-form__mono" value={draft.drive?.clientSecret ?? ""} placeholder="desktop-app secret (public by design)" onChange={(e) => setDraft({ ...draft, drive: { ...draft.drive, clientSecret: e.target.value } })} />
        </label>
        <label className="gml-form__row">
          <span>Drive path</span>
          <input className="gml-form__input gml-form__mono" value={draft.drive?.rootPath ?? ""} placeholder={driveRoot ?? "Motion/Hamza/2026/Motion Library"} onChange={(e) => setDraft({ ...draft, drive: { ...draft.drive, rootPath: e.target.value } })} />
        </label>
        <div className="gml-form__row">
          <span />
          {status?.signedIn ? (
            <button type="button" className="gml-toolbar__btn" disabled={busy !== null} onClick={() => run("auth", () => runtime!.signOut())}>
              Sign out
            </button>
          ) : (
            <button
              type="button"
              className="gml-toolbar__btn"
              disabled={busy !== null || !runtime || !draft.drive?.clientId}
              onClick={() =>
                run("auth", async () => {
                  onSave(draft);
                  await runtime!.signIn();
                })
              }
            >
              {busy === "auth" ? "Waiting for the browser…" : "Sign in with Google"}
            </button>
          )}
          <span className="gml-diag__detail">Scopes: drive.readonly + drive.file. Access follows Shared Drive membership.</span>
        </div>

        {error && (
          <p className="gml-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
