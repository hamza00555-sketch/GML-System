/**
 * What the scanner must never turn into an asset. The library is authored by
 * hand next to After Effects' own droppings, so this list is part of the
 * contract — see the M1 brief.
 */

/** GML's own scaffolding from the earlier design, still present at top level. */
export const SCAFFOLDING_DIRS = new Set(["_inbox", "_staging", "approved", "drafts"]);

/** Brand reference material, not library assets. */
export const EXCLUDED_CATEGORY_FOLDERS = new Set(["guideline"]);

export const SOURCE_DIR_NAMES = new Set(["source_", "_source", "source", "_sources", "sources"]);

const NOISE_DIR_EXACT = new Set(["render", "renders", "adobe after effects auto-save", "__macosx"]);

export function isSourceDir(name: string): boolean {
  return SOURCE_DIR_NAMES.has(name.toLowerCase());
}

export function isNoiseDir(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith("~") || lower.startsWith(".")) return true;
  if (NOISE_DIR_EXACT.has(lower)) return true;
  if (lower.endsWith(".aep logs") || lower.endsWith(" logs")) return true;
  if (lower.includes("auto-save")) return true;
  return false;
}

const NOISE_FILE_EXACT = new Set(["desktop.ini", "thumbs.db", ".ds_store"]);

export function isNoiseFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith("~") || lower.startsWith(".")) return true;
  if (NOISE_FILE_EXACT.has(lower)) return true;
  if (lower.endsWith(".zip") || lower.endsWith(".rar") || lower.endsWith(".7z")) return true;
  if (lower.endsWith(".part") || lower.endsWith(".tmp") || lower.endsWith(".lock")) return true;
  return false;
}

export const VIDEO_EXTENSIONS = new Set(["mov", "mp4", "webm", "mxf", "avi"]);
export const PROJECT_EXTENSIONS = new Set(["aep"]);
export const STILL_EXTENSIONS = new Set(["ai", "png", "psd", "svg", "jpg", "jpeg", "tif", "tiff"]);

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/** "Preview.mp4" and close relatives — the card's hover clip, never a deliverable. */
export function isPreviewFile(name: string): boolean {
  const lower = name.toLowerCase();
  return /^preview(?:[ _-].*)?\.(mp4|mov|webm)$/.test(lower) || lower === "preview.gif";
}
