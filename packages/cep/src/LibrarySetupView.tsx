import { useMemo, useState } from "react";
import { STAGING_DIR, STATUS_DIRS, type DriveCandidate } from "@gml/storage";
import { libraryCandidates, validateLibraryRoot } from "./library.js";
import type { PanelNode } from "./node.js";

/**
 * Choosing the library folder. The expected answer is the GML_Library folder
 * inside the team's Shared Drive, which Google Drive for Desktop keeps synced;
 * any folder works, which is what makes a network share or a local test
 * folder possible too.
 */
export function LibrarySetupView({
  node,
  current,
  onChoose,
  onClose,
}: {
  node: PanelNode | null;
  current?: string;
  onChoose: (root: string) => void;
  onClose?: () => void;
}) {
  const candidates = useMemo<DriveCandidate[]>(() => (node ? libraryCandidates(node) : []), [node]);
  const [path, setPath] = useState(current ?? candidates.find((c) => c.exists)?.path ?? "");
  const [error, setError] = useState<string | null>(null);

  if (!node) {
    return (
      <div className="gml-diag" data-testid="library-setup">
        <header className="gml-diag__head">
          <strong>Library</strong>
          {onClose && (
            <button type="button" className="gml-toolbar__btn" onClick={onClose}>
              Close
            </button>
          )}
        </header>
        <div className="gml-diag__body">
          <p className="gml-error">
            Node.js is not available in this panel, so the library folder cannot be read. Open
            Diagnostics and send me the report.
          </p>
        </div>
      </div>
    );
  }

  const use = (root: string, create = false) => {
    const trimmed = root.trim();
    if (create) {
      try {
        node.fs.mkdir(trimmed);
        for (const dir of [...STATUS_DIRS, STAGING_DIR]) node.fs.mkdir(node.fs.join(trimmed, dir));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    const problem = validateLibraryRoot(node, trimmed);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    onChoose(trimmed);
  };

  return (
    <div className="gml-diag" data-testid="library-setup">
      <header className="gml-diag__head">
        <strong>Library folder</strong>
        <span className="gml-diag__summary">Where the team's assets live — usually a Shared Drive</span>
        {onClose && (
          <button type="button" className="gml-toolbar__btn" onClick={onClose}>
            Close
          </button>
        )}
      </header>

      <div className="gml-diag__body gml-form">
        {candidates.length > 0 ? (
          <>
            <h3 className="gml-diag__h3">Google Drive on this machine</h3>
            {candidates.map((c) => (
              <div key={c.path} className="gml-diag__row">
                <span className="gml-diag__verdict" style={{ color: c.exists ? "var(--accent)" : "var(--text-3)" }}>
                  {c.exists ? "FOUND" : "NEW"}
                </span>
                <div className="gml-form__grow">
                  <div className="gml-diag__label">{c.path}</div>
                  <div className="gml-diag__detail">
                    {c.mount.kind === "shared" ? "Shared Drive" : "My Drive"} ·{" "}
                    {c.exists ? "library folder exists" : "no library here yet"}
                  </div>
                </div>
                <button
                  type="button"
                  className={c.exists ? "gml-primary" : "gml-toolbar__btn"}
                  onClick={() => use(c.path, !c.exists)}
                >
                  {c.exists ? "Use" : "Create here"}
                </button>
              </div>
            ))}
          </>
        ) : (
          <p className="gml-diag__detail">
            Google Drive for Desktop was not found. Install it, add the team's Shared Drive, and
            reopen this panel — or enter any folder below.
          </p>
        )}

        <h3 className="gml-diag__h3">Or enter a folder</h3>
        <label className="gml-form__row">
          <input
            className="gml-form__input"
            value={path}
            placeholder={node.platform === "win32" ? "G:\\Shared drives\\GML_Library" : "~/Library/CloudStorage/GoogleDrive-…/Shared drives/…/GML_Library"}
            onChange={(e) => setPath(e.target.value)}
            data-testid="library-path"
          />
          <button type="button" className="gml-primary" onClick={() => use(path)} disabled={!path.trim()}>
            Use folder
          </button>
          <button type="button" className="gml-toolbar__btn" onClick={() => use(path, true)} disabled={!path.trim()}>
            Create
          </button>
        </label>
        {error && (
          <p className="gml-error" role="alert">
            {error}
          </p>
        )}

        <h3 className="gml-diag__h3">How it works</h3>
        <p className="gml-diag__detail">
          Every asset is a folder with a <code>meta.json</code>. Publishing writes into{" "}
          <code>_staging</code>, verifies every file, then moves the folder into <code>drafts</code>{" "}
          or <code>approved</code>. Drive syncs it to everyone; a half-synced folder is never shown.
        </p>
      </div>
    </div>
  );
}
