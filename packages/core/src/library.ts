import { z } from "zod";
import { CATEGORIES } from "./categories.js";

/**
 * The library as the panel sees it: an index built by scanning the team's
 * hand-authored folder on the Shared Drive. The folder is the source of truth
 * and is never restructured — this schema describes what the scanner found,
 * not what the library must look like.
 *
 * Rendered alpha video is the deliverable. A comp inside a project file is the
 * deliverable only where the content is text-editable (Animated Texts,
 * Counters). Source projects are linked, never auto-imported: After Effects
 * copies on import, so a central .aep never propagates updates anyway.
 */

export const INDEX_SCHEMA_VERSION = 1;

export const ASSET_KINDS = ["video-alpha", "comp", "still"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const ALPHA_MODES = ["straight", "premultiplied", "unknown"] as const;
export type AlphaMode = (typeof ALPHA_MODES)[number];

export const DIRECTIONS = ["D", "U", "L", "R"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const ORIENTATIONS = ["H", "V"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

/** Render-standard findings surfaced as badges and publish warnings — never blockers. */
export const DELIVERABLE_WARNINGS = ["oversized", "prores-xq", "4k"] as const;
export type DeliverableWarning = (typeof DELIVERABLE_WARNINGS)[number];

/** Soft cap per deliverable; above it the card says "needs re-render". */
export const DELIVERABLE_SOFT_CAP_BYTES = 500 * 1024 * 1024;

/** Library-relative, forward slashes, never absolute — what makes projects portable across drive letters. */
const relPath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !/^[A-Za-z]:/.test(p) && !p.startsWith("\\\\"), "must be library-relative")
  .refine((p) => !p.includes("\\"), "must use forward slashes")
  .refine((p) => !p.split("/").includes(".."), "must not escape the library root");

export const deliverableSchema = z.object({
  relPath,
  bytes: z.number().int().nonnegative(),
  mtimeMs: z.number().nonnegative(),
  /** size+mtime composite for v1; a content hash can replace it without a schema change. */
  hash: z.string().min(1),
  direction: z.enum(DIRECTIONS).optional(),
  orientation: z.enum(ORIENTATIONS).optional(),
  codec: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fps: z.number().positive().optional(),
  alpha: z.enum(ALPHA_MODES).default("unknown"),
  /** True when codec/size came from the file's own headers, false when inferred from the name. */
  probed: z.boolean().default(false),
  warnings: z.array(z.enum(DELIVERABLE_WARNINGS)).default([]),
});
export type Deliverable = z.infer<typeof deliverableSchema>;

export const compInfoSchema = z.object({
  compName: z.string().min(1),
  fps: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  duration: z.number().nonnegative(),
});
export type CompInfo = z.infer<typeof compInfoSchema>;

export const libraryAssetSchema = z.object({
  /** Stable, derived from the library-relative path; slug segments joined by "/". */
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/, "expected slug/slug"),
  /** Bumps whenever a deliverable's hash changes. */
  version: z.number().int().positive(),
  name: z.string().min(1),
  nameAr: z.string().optional(),
  category: z.enum(CATEGORIES),
  /** The folder as it is spelled on disk, e.g. "Backgrounds - خلفيات". */
  categoryFolder: z.string().min(1),
  kind: z.enum(ASSET_KINDS),
  tags: z.array(z.string()).default([]),
  deliverables: z.array(deliverableSchema).min(1),
  preview: z.object({ relPath, bytes: z.number().int().nonnegative(), mtimeMs: z.number().nonnegative() }).nullable(),
  poster: z.object({ cacheKey: z.string().min(1) }),
  /** Linked, never auto-imported. */
  source: z.object({ relPath, compName: z.string().optional() }).nullable(),
  requires: z.object({ fonts: z.array(z.string()).default([]), effects: z.array(z.string()).default([]) }),
  status: z.enum(["approved", "draft"]),
  updatedAt: z.string(),
  /** Present for kind "comp" once After Effects has read the project. */
  comp: compInfoSchema.optional(),
});
export type LibraryAsset = z.infer<typeof libraryAssetSchema>;

export const libraryIndexSchema = z.object({
  schemaVersion: z.literal(INDEX_SCHEMA_VERSION),
  libraryRoot: z.string().min(1),
  scannedAt: z.string(),
  assets: z.array(libraryAssetSchema),
  /**
   * Per-directory fingerprints from the last scan, so an unchanged subtree
   * is skipped next time. Internal to the scanner; tolerated but ignored by
   * readers.
   */
  fingerprints: z.record(z.string(), z.string()).default({}),
});
export type LibraryIndex = z.infer<typeof libraryIndexSchema>;

export function parseIndex(input: unknown): LibraryIndex {
  return libraryIndexSchema.parse(input);
}

export function safeParseIndex(input: unknown) {
  return libraryIndexSchema.safeParse(input);
}

export function emptyIndex(libraryRoot: string, scannedAt = new Date(0).toISOString()): LibraryIndex {
  return { schemaVersion: INDEX_SCHEMA_VERSION, libraryRoot, scannedAt, assets: [], fingerprints: {} };
}

/** `id@v3` — the key a cached copy and an imported layer share. */
export function assetKey(id: string, version: number): string {
  return `${id}@v${version}`;
}

/** The deliverable Apply uses when the user has not picked a variant. */
export function primaryDeliverable(asset: LibraryAsset): Deliverable {
  const first = asset.deliverables[0]!;
  // Prefer horizontal, then the lowest index — matches how the library is authored.
  const horizontal = asset.deliverables.find((d) => d.orientation === "H");
  return horizontal ?? first;
}

export function deliverableLabel(d: Deliverable): string {
  const parts: string[] = [];
  if (d.direction) parts.push({ D: "Down", U: "Up", L: "Left", R: "Right" }[d.direction]);
  if (d.orientation) parts.push(d.orientation === "H" ? "Horizontal" : "Vertical");
  if (parts.length === 0) {
    const file = d.relPath.split("/").pop() ?? d.relPath;
    return file.replace(/\.[^.]+$/, "");
  }
  return parts.join(" · ");
}

export function fileNameOf(relPath: string): string {
  return relPath.split("/").pop() ?? relPath;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
