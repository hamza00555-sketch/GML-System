import type { FolderFs } from "./fs.js";

/**
 * Google Drive for Desktop mirrors a Shared Drive as an ordinary folder. That
 * folder is the library: no OAuth, no API, no upload code — Drive does the
 * syncing and the panel reads and writes files. This finds where Drive put it.
 */

export const LIBRARY_FOLDER_NAMES = ["GML_Library", "GML Library", "GML"] as const;

export interface DriveMount {
  /** The Drive root, e.g. "G:\\Shared drives" or "~/Library/CloudStorage/GoogleDrive-x/Shared drives". */
  root: string;
  kind: "shared" | "my-drive";
}

export interface DriveCandidate {
  path: string;
  /** True when a library folder already exists at this path. */
  exists: boolean;
  mount: DriveMount;
}

export interface DetectOptions {
  platform: "darwin" | "win32" | string;
  homedir: string;
}

function safeReaddir(fs: FolderFs, p: string): string[] {
  try {
    return fs.exists(p) && fs.stat(p).isDirectory ? fs.readdir(p) : [];
  } catch {
    return [];
  }
}

function isDir(fs: FolderFs, p: string): boolean {
  try {
    return fs.exists(p) && fs.stat(p).isDirectory;
  } catch {
    return false;
  }
}

/** Every Drive mount visible on this machine, Shared Drives first. */
export function findDriveMounts(fs: FolderFs, opts: DetectOptions): DriveMount[] {
  const mounts: DriveMount[] = [];
  const push = (root: string, kind: DriveMount["kind"]) => {
    if (isDir(fs, root) && !mounts.some((m) => m.root === root)) mounts.push({ root, kind });
  };

  if (opts.platform === "darwin") {
    const cloud = fs.join(opts.homedir, "Library", "CloudStorage");
    for (const entry of safeReaddir(fs, cloud)) {
      if (!entry.startsWith("GoogleDrive")) continue;
      push(fs.join(cloud, entry, "Shared drives"), "shared");
      push(fs.join(cloud, entry, "My Drive"), "my-drive");
    }
    // Older Drive for Desktop releases mounted a volume instead.
    push("/Volumes/GoogleDrive/Shared drives", "shared");
    push("/Volumes/GoogleDrive/My Drive", "my-drive");
  } else if (opts.platform === "win32") {
    // Drive for Desktop mounts a drive letter (G: by default, but configurable).
    for (let code = "D".charCodeAt(0); code <= "Z".charCodeAt(0); code++) {
      const letter = String.fromCharCode(code);
      push(`${letter}:\\Shared drives`, "shared");
      push(`${letter}:\\My Drive`, "my-drive");
    }
    push(fs.join(opts.homedir, "Google Drive", "Shared drives"), "shared");
    push(fs.join(opts.homedir, "Google Drive"), "my-drive");
  }

  return mounts.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "shared" ? -1 : 1));
}

/**
 * Where a library folder is, or could be. Existing folders come first; each
 * mount also yields one "create here" suggestion so a fresh team can start.
 */
export function findLibraryCandidates(fs: FolderFs, opts: DetectOptions): DriveCandidate[] {
  const candidates: DriveCandidate[] = [];
  for (const mount of findDriveMounts(fs, opts)) {
    let found = false;
    for (const name of LIBRARY_FOLDER_NAMES) {
      const direct = fs.join(mount.root, name);
      if (isDir(fs, direct)) {
        candidates.push({ path: direct, exists: true, mount });
        found = true;
      }
    }
    // A Shared Drive named for the team, with the library one level down.
    if (mount.kind === "shared") {
      for (const drive of safeReaddir(fs, mount.root)) {
        for (const name of LIBRARY_FOLDER_NAMES) {
          const nested = fs.join(mount.root, drive, name);
          if (isDir(fs, nested)) {
            candidates.push({ path: nested, exists: true, mount });
            found = true;
          }
        }
      }
    }
    if (!found) {
      candidates.push({ path: fs.join(mount.root, LIBRARY_FOLDER_NAMES[0]), exists: false, mount });
    }
  }
  return candidates.sort((a, b) => Number(b.exists) - Number(a.exists));
}
