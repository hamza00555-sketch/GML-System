import type { FootageSnapshot } from "./types.js";

/**
 * `isStill === false` only means the footage has a time component — it covers
 * video, audio and image sequences alike. Classifying on it alone would copy a
 * sequence as a single frame, so extension and numbering are checked too.
 */
export type FootageClass =
  | "audio"
  | "still"
  /** A single time-based file: video, or an image format AE reads as animated. */
  | "video"
  | "sequence"
  | "solid"
  | "missing";

export const STILL_IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "tif",
  "tiff",
  "exr",
  "dpx",
  "tga",
  "hdr",
  "bmp",
  "gif",
] as const;

export function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? "";
}

export function isStillImageExtension(ext: string): boolean {
  return (STILL_IMAGE_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}

export interface SequencePattern {
  /** Everything before the frame number, e.g. "seq_". */
  prefix: string;
  /** Everything after it, including the dot, e.g. ".png". */
  suffix: string;
  digits: number;
  /** File names in the folder that belong to this sequence, in order. */
  members: string[];
}

/**
 * Confirms a numbering pattern against the files actually sitting next to it.
 * `isFileNameNumbered()` is deliberately not used: it does not appear in the
 * official FileSource or FootageItem documentation.
 */
export function detectSequencePattern(
  fileName: string,
  siblingNames: readonly string[] = [],
): SequencePattern | null {
  const match = /^(.*?)(\d+)(\.[^.]+)$/.exec(fileName);
  if (!match) return null;

  const [, prefix = "", frame = "", suffix = ""] = match;
  const digits = frame.length;
  const memberRe = new RegExp(
    `^${escapeRegExp(prefix)}(\\d{${digits}})${escapeRegExp(suffix)}$`,
  );

  const pool = siblingNames.includes(fileName) ? siblingNames : [fileName, ...siblingNames];
  const members = pool.filter((n) => memberRe.test(n)).sort();

  // One file matching its own pattern is just a file that happens to end in digits.
  return members.length >= 2 ? { prefix, suffix, digits, members } : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function classifyFootage(item: FootageSnapshot): FootageClass {
  if (item.sourceKind === "placeholder") return "missing";
  if (item.missingFootagePath && item.missingFootagePath.length > 0) return "missing";
  if (item.sourceKind === "solid") return "solid";
  if (!item.filePath) return "missing";

  if (item.hasAudio && !item.hasVideo) return "audio";
  if (item.isStill) return "still";

  const ext = extensionOf(item.filePath);
  if (isStillImageExtension(ext)) {
    const pattern = detectSequencePattern(fileNameOf(item.filePath), item.siblingNames);
    if (pattern) return "sequence";
  }

  // A single time-based file. `replace()` handles it losslessly either way.
  return "video";
}

export type RelinkMethod = "replace" | "replaceWithSequence" | "none";

export function relinkMethodFor(cls: FootageClass): RelinkMethod {
  switch (cls) {
    case "sequence":
      return "replaceWithSequence";
    case "audio":
    case "still":
    case "video":
      return "replace";
    case "solid":
    case "missing":
      return "none";
  }
}

export interface CollectPlanEntry {
  itemId: number;
  name: string;
  class: FootageClass;
  method: RelinkMethod;
  /** Every file to copy. A sequence contributes all of its frames. */
  filesToCopy: string[];
}

function directoryOf(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx === -1 ? "" : path.slice(0, idx + 1);
}

/**
 * Turns a snapshot into the exact copy/relink work the collect step performs.
 * Producing it as data keeps the ExtendScript side thin and this side tested.
 */
export function planCollect(footage: readonly FootageSnapshot[]): CollectPlanEntry[] {
  return footage.map((item) => {
    const cls = classifyFootage(item);
    const method = relinkMethodFor(cls);

    let filesToCopy: string[] = [];
    if (item.filePath && (cls === "video" || cls === "still" || cls === "audio")) {
      filesToCopy = [item.filePath];
    } else if (item.filePath && cls === "sequence") {
      const pattern = detectSequencePattern(fileNameOf(item.filePath), item.siblingNames);
      const dir = directoryOf(item.filePath);
      filesToCopy = pattern ? pattern.members.map((n) => `${dir}${n}`) : [item.filePath];
    }

    return { itemId: item.itemId, name: item.name, class: cls, method, filesToCopy };
  });
}
