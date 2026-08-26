import type { FootageSnapshot, Finding } from "./types.js";
import { classifyFootage } from "./classify.js";

/**
 * After collect + relink, every file the comp still needs must live inside the
 * package. A path left pointing at the designer's desktop means the package is
 * broken for everyone else, so it blocks publishing rather than warning.
 */

export interface PathOptions {
  /** Windows and macOS compare paths case-insensitively; Linux does not. */
  caseInsensitive?: boolean;
  /** Injected so symlink resolution is testable without touching a disk. */
  realPath?: (path: string) => string;
}

export function normalizePath(path: string, opts: PathOptions = {}): string {
  const resolved = opts.realPath ? opts.realPath(path) : path;
  let out = resolved.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
  return opts.caseInsensitive === false ? out : out.toLowerCase();
}

export function isInside(root: string, candidate: string, opts: PathOptions = {}): boolean {
  const nRoot = normalizePath(root, opts);
  const nCandidate = normalizePath(candidate, opts);
  if (nCandidate === nRoot) return true;
  // The trailing slash stops "/pkg-other/x" from counting as inside "/pkg".
  return nCandidate.startsWith(nRoot.endsWith("/") ? nRoot : `${nRoot}/`);
}

export interface PortabilityResult {
  ok: boolean;
  /** Absolute paths still required from outside the package. */
  external: string[];
  findings: Finding[];
}

/**
 * The final gate before an asset is allowed into the library — in draft as
 * well as approved. A draft may be unreviewed; it may not be technically broken.
 */
export function checkPortability(
  footage: readonly FootageSnapshot[],
  packageRoot: string,
  opts: PathOptions = {},
): PortabilityResult {
  const external: string[] = [];
  const findings: Finding[] = [];

  for (const item of footage) {
    const cls = classifyFootage(item);

    if (cls === "missing") {
      findings.push({
        severity: "blocker",
        code: "footage-missing",
        message: `Missing: ${item.name}`,
        detail: item.missingFootagePath ?? item.filePath,
      });
      continue;
    }

    // Solids carry no file, so there is nothing to keep inside the package.
    if (cls === "solid" || !item.filePath) continue;

    if (!isInside(packageRoot, item.filePath, opts)) {
      external.push(item.filePath);
      findings.push({
        severity: "blocker",
        code: "footage-outside-package",
        message: `Outside the package: ${item.name}`,
        detail: item.filePath,
      });
    }

    if (item.hasProxy) {
      findings.push({
        severity: "blocker",
        code: "proxy-present",
        message: `Proxy still attached: ${item.name}`,
        detail: "Proxies are local working conveniences and must be removed before publishing.",
      });
    }
  }

  return { ok: findings.length === 0, external, findings };
}
