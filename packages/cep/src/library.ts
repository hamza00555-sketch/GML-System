import { FolderLibraryProvider, findLibraryCandidates, type DriveCandidate } from "@gml/storage";
import type { PanelNode } from "./node.js";

/** Opens (and if needed lays out) the library at `root`. */
export function openLibrary(node: PanelNode, root: string): FolderLibraryProvider {
  const provider = new FolderLibraryProvider({ root, fs: node.fs, hashes: node.hashes });
  provider.ensureLayout();
  provider.refresh();
  return provider;
}

export function libraryCandidates(node: PanelNode): DriveCandidate[] {
  return findLibraryCandidates(node.fs, { platform: node.platform, homedir: node.homedir });
}

/** A folder is usable as a library root when it exists and is a directory. */
export function validateLibraryRoot(node: PanelNode, root: string): string | null {
  const trimmed = root.trim();
  if (!trimmed) return "Enter a folder path.";
  try {
    if (!node.fs.exists(trimmed)) return "That folder does not exist.";
    if (!node.fs.stat(trimmed).isDirectory) return "That path is a file, not a folder.";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return null;
}
