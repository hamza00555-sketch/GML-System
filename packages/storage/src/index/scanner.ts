import {
  DELIVERABLE_SOFT_CAP_BYTES,
  INDEX_SCHEMA_VERSION,
  type AlphaMode,
  type AssetKind,
  type Category,
  type CompInfo,
  type Deliverable,
  type DeliverableWarning,
  type LibraryAsset,
  type LibraryIndex,
} from "@gml/core";
import type { FolderFs } from "../fs.js";
import { categoryForFolder, isCategoryFolder, kindForCategory } from "./categories.js";
import { displayName, parseDeliverableName, slug, variantGroupKey } from "./filename.js";
import {
  PROJECT_EXTENSIONS,
  SCAFFOLDING_DIRS,
  STILL_EXTENSIONS,
  VIDEO_EXTENSIONS,
  extensionOf,
  isNoiseDir,
  isNoiseFile,
  isPreviewFile,
  isSourceDir,
} from "./noise.js";
import { inferFromName, probeContainer, type MediaInfo } from "./probe.js";

/**
 * Builds the index by walking the hand-authored library. Three shapes coexist
 * and are all recognised:
 *
 *   A  flat        deliverables directly in the category folder, one Preview.mp4
 *   B  master      one .aep holding many comps, one Preview.mp4, sources in _SOURCE/
 *   C  item folder one folder per asset with its own Preview.mp4 and deliverables
 *
 * An asset is anything with at least one deliverable and a reachable preview
 * (its own, else the nearest ancestor's). Everything in the noise list is
 * skipped. The scan is incremental: a directory whose listing fingerprint has
 * not changed since the previous index is reused wholesale, probes included.
 */

export interface AepComp extends CompInfo {
  fonts: string[];
  effects: string[];
  numLayers: number;
}

export interface ScanOptions {
  fs: FolderFs;
  libraryRoot: string;
  previous?: LibraryIndex | null;
  /** Reads comps out of a project file; only After Effects can. Optional. */
  inspectAep?: (absPath: string) => Promise<AepComp[]>;
  /** Container probe; defaults to the bounded MOV/MP4 parser. */
  probe?: (absPath: string, size: number) => MediaInfo | null;
  now?: () => Date;
  onProgress?: (message: string) => void;
}

export interface ScanReport {
  index: LibraryIndex;
  /** Top-level folders that map to no category, listed so the team can see them. */
  unknownFolders: string[];
  /** Directories reused from the previous index without re-reading. */
  reusedDirs: number;
  /** Deliverables whose container was read. */
  probed: number;
  /** Project files that could not be expanded because no inspector was given. */
  uninspectedProjects: string[];
}

interface Entry {
  name: string;
  abs: string;
  rel: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
}

interface PreviewRef {
  relPath: string;
  bytes: number;
  mtimeMs: number;
}

interface Ctx extends Required<Pick<ScanOptions, "fs" | "libraryRoot" | "probe">> {
  inspectAep: ScanOptions["inspectAep"];
  previousById: Map<string, LibraryAsset>;
  previousFingerprints: Record<string, string>;
  fingerprints: Record<string, string>;
  assets: LibraryAsset[];
  report: Omit<ScanReport, "index">;
  onProgress: (m: string) => void;
  now: string;
}

function listEntries(fs: FolderFs, abs: string, rel: string): Entry[] {
  const out: Entry[] = [];
  for (const name of fs.readdir(abs)) {
    const childAbs = fs.join(abs, name);
    let stat;
    try {
      stat = fs.stat(childAbs);
    } catch {
      continue;
    }
    const childRel = rel ? `${rel}/${name}` : name;
    if (stat.isDirectory ? isNoiseDir(name) : isNoiseFile(name)) continue;
    out.push({ name, abs: childAbs, rel: childRel, isDir: stat.isDirectory, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
}

/** Listing fingerprint: names, sizes and mtimes of direct children. */
function fingerprintOf(entries: Entry[]): string {
  return entries.map((e) => `${e.isDir ? "d" : "f"}:${e.name}:${e.size}:${Math.round(e.mtimeMs)}`).join("|");
}

function deliverableKind(name: string): AssetKind | null {
  const ext = extensionOf(name);
  if (isPreviewFile(name)) return null;
  if (VIDEO_EXTENSIONS.has(ext)) return "video-alpha";
  if (PROJECT_EXTENSIONS.has(ext)) return "comp";
  if (STILL_EXTENSIONS.has(ext)) return "still";
  return null;
}

function warningsFor(bytes: number, info: Partial<MediaInfo>): DeliverableWarning[] {
  const warnings: DeliverableWarning[] = [];
  if (bytes > DELIVERABLE_SOFT_CAP_BYTES) warnings.push("oversized");
  if (info.codec === "prores_4444_xq") warnings.push("prores-xq");
  if ((info.width ?? 0) >= 3800 || (info.height ?? 0) >= 3800) warnings.push("4k");
  return warnings;
}

function hashOf(entry: Entry): string {
  return `${entry.size}-${Math.round(entry.mtimeMs)}`;
}

function buildDeliverable(ctx: Ctx, entry: Entry, kind: AssetKind, previous?: Deliverable): Deliverable {
  const parsed = parseDeliverableName(entry.name);
  const hash = hashOf(entry);

  // Unchanged file: keep the previous record, probe included.
  if (previous && previous.hash === hash) return { ...previous, relPath: entry.rel };

  let info: Partial<MediaInfo> = inferFromName(entry.name);
  let probed = false;
  if (kind === "video-alpha") {
    const result = ctx.probe(entry.abs, entry.size);
    if (result) {
      info = result;
      probed = true;
      ctx.report.probed += 1;
    }
  }

  const alpha: AlphaMode = info.alpha ?? "unknown";
  return {
    relPath: entry.rel,
    bytes: entry.size,
    mtimeMs: entry.mtimeMs,
    hash,
    direction: parsed.direction,
    orientation: parsed.orientation,
    codec: info.codec,
    width: info.width,
    height: info.height,
    fps: info.fps,
    alpha,
    probed,
    warnings: warningsFor(entry.size, info),
  };
}

function previousDeliverable(prev: LibraryAsset | undefined, rel: string): Deliverable | undefined {
  return prev?.deliverables.find((d) => d.relPath === rel);
}

function nextVersion(prev: LibraryAsset | undefined, deliverables: Deliverable[]): number {
  if (!prev) return 1;
  const before = prev.deliverables.map((d) => `${d.relPath}:${d.hash}`).sort().join("|");
  const after = deliverables.map((d) => `${d.relPath}:${d.hash}`).sort().join("|");
  return before === after ? prev.version : prev.version + 1;
}

function findSource(fs: FolderFs, categoryAbs: string, categoryRel: string, name: string): string | null {
  // A SOURCE_/_SOURCE sibling with a project named like the asset is the link.
  let entries: string[];
  try {
    entries = fs.readdir(categoryAbs);
  } catch {
    return null;
  }
  const wanted = slug(name);
  for (const dir of entries) {
    if (!isSourceDir(dir)) continue;
    const abs = fs.join(categoryAbs, dir);
    try {
      if (!fs.stat(abs).isDirectory) continue;
      for (const file of fs.readdir(abs)) {
        if (extensionOf(file) === "aep" && slug(file.replace(/\.aep$/i, "")) === wanted) {
          return `${categoryRel}/${dir}/${file}`;
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

function pushAsset(ctx: Ctx, asset: LibraryAsset): void {
  const prev = ctx.previousById.get(asset.id);
  ctx.assets.push({ ...asset, updatedAt: prev && prev.version === asset.version ? prev.updatedAt : ctx.now });
}

function makeAsset(
  ctx: Ctx,
  args: {
    id: string;
    name: string;
    category: Category;
    categoryFolder: string;
    kind: AssetKind;
    tags: string[];
    deliverables: Deliverable[];
    preview: PreviewRef | null;
    source: { relPath: string; compName?: string } | null;
    requires?: { fonts: string[]; effects: string[] };
    comp?: CompInfo;
  },
): LibraryAsset {
  const prev = ctx.previousById.get(args.id);
  return {
    id: args.id,
    version: nextVersion(prev, args.deliverables),
    name: args.name,
    category: args.category,
    categoryFolder: args.categoryFolder,
    kind: args.kind,
    tags: [...new Set(args.tags)],
    deliverables: args.deliverables,
    preview: args.preview,
    poster: { cacheKey: `${args.id}.png` },
    source: args.source,
    requires: args.requires ?? { fonts: [], effects: [] },
    status: args.preview ? "approved" : "draft",
    updatedAt: ctx.now,
    comp: args.comp,
  };
}

/** Shape B: a project file becomes one asset per comp, when AE can read it. */
async function expandProject(
  ctx: Ctx,
  entry: Entry,
  category: Category,
  categoryFolder: string,
  categoryAbs: string,
  categoryRel: string,
  preview: PreviewRef | null,
  idBase: string,
  nameBase: string,
): Promise<void> {
  const hash = hashOf(entry);
  const prevForFile = [...ctx.previousById.values()].filter(
    (a) => a.kind === "comp" && a.deliverables[0]?.relPath === entry.rel,
  );
  const unchanged = prevForFile.length > 0 && prevForFile.every((a) => a.deliverables[0]?.hash === hash);

  let comps: AepComp[] | null = null;
  if (unchanged) {
    // Reuse the previous expansion — including requires — without touching AE.
    for (const a of prevForFile) pushAsset(ctx, { ...a, preview: preview ?? a.preview, categoryFolder });
    return;
  }
  if (ctx.inspectAep) {
    ctx.onProgress(`Reading comps in ${entry.rel}`);
    try {
      comps = await ctx.inspectAep(entry.abs);
    } catch {
      comps = null;
    }
  }

  const deliverable: Deliverable = {
    relPath: entry.rel,
    bytes: entry.size,
    mtimeMs: entry.mtimeMs,
    hash,
    alpha: "unknown",
    probed: false,
    warnings: warningsFor(entry.size, {}),
  };

  if (!comps || comps.length === 0) {
    ctx.report.uninspectedProjects.push(entry.rel);
    // Still an asset — the whole project — so it is visible before AE has read it.
    pushAsset(
      ctx,
      makeAsset(ctx, {
        id: idBase,
        name: nameBase,
        category,
        categoryFolder,
        kind: "comp",
        tags: [...parseDeliverableName(entry.name).tags, "project"],
        deliverables: [deliverable],
        preview,
        source: null,
      }),
    );
    return;
  }

  const single = comps.length === 1;
  for (const comp of comps) {
    const id = single ? idBase : `${idBase}/${slug(comp.compName)}`;
    const name = single ? nameBase : displayName(comp.compName.replace(/^GML[_-]?/i, ""));
    const source = findSource(ctx.fs, categoryAbs, categoryRel, comp.compName) ?? findSource(ctx.fs, categoryAbs, categoryRel, name);
    pushAsset(
      ctx,
      makeAsset(ctx, {
        id,
        name,
        category,
        categoryFolder,
        kind: "comp",
        tags: [...parseDeliverableName(entry.name).tags, ...parseDeliverableName(comp.compName).tags],
        deliverables: [deliverable],
        preview,
        source: source ? { relPath: source, compName: comp.compName } : null,
        requires: { fonts: comp.fonts, effects: comp.effects },
        comp: { compName: comp.compName, fps: comp.fps, width: comp.width, height: comp.height, duration: comp.duration },
      }),
    );
  }
}

/** Shape C: the folder is the asset; every deliverable inside is a variant. */
function itemFolderAsset(
  ctx: Ctx,
  dir: Entry,
  entries: Entry[],
  category: Category,
  categoryFolder: string,
  kind: AssetKind,
  inheritedPreview: PreviewRef | null,
  idBase: string,
  categoryAbs: string,
  categoryRel: string,
): LibraryAsset | null {
  const ownPreview = entries.find((e) => !e.isDir && isPreviewFile(e.name));
  const preview: PreviewRef | null = ownPreview
    ? { relPath: ownPreview.rel, bytes: ownPreview.size, mtimeMs: ownPreview.mtimeMs }
    : inheritedPreview;

  const files = entries.filter((e) => !e.isDir);
  const wanted = kind === "comp" ? "comp" : kind;
  let candidates = files.filter((e) => deliverableKind(e.name) === wanted);
  // A video-alpha folder that only holds stills (e.g. an .ai illustration) is still an asset.
  let actualKind = kind;
  if (candidates.length === 0 && kind === "video-alpha") {
    candidates = files.filter((e) => deliverableKind(e.name) === "still");
    if (candidates.length > 0) actualKind = "still";
  }
  if (candidates.length === 0) return null;

  const id = `${idBase}/${slug(dir.name)}`;
  const prev = ctx.previousById.get(id);
  const deliverables = candidates.map((e) => buildDeliverable(ctx, e, actualKind, previousDeliverable(prev, e.rel)));
  const tags = candidates.flatMap((e) => parseDeliverableName(e.name).tags);
  const source = findSource(ctx.fs, categoryAbs, categoryRel, dir.name);

  return makeAsset(ctx, {
    id,
    name: displayName(dir.name),
    category,
    categoryFolder,
    kind: actualKind,
    tags,
    deliverables,
    preview,
    source: source ? { relPath: source } : null,
  });
}

async function scanFolder(
  ctx: Ctx,
  abs: string,
  rel: string,
  category: Category,
  categoryFolder: string,
  categoryAbs: string,
  categoryRel: string,
  inheritedPreview: PreviewRef | null,
  idBase: string,
  depth: number,
): Promise<void> {
  const entries = listEntries(ctx.fs, abs, rel);
  const fingerprint = fingerprintOf(entries);
  ctx.fingerprints[rel] = fingerprint;

  const kind = kindForCategory(category);
  const ownPreview = entries.find((e) => !e.isDir && isPreviewFile(e.name));
  const preview: PreviewRef | null = ownPreview
    ? { relPath: ownPreview.rel, bytes: ownPreview.size, mtimeMs: ownPreview.mtimeMs }
    : inheritedPreview;

  // Shape A: deliverables directly here, grouped into variants by name.
  const files = entries.filter((e) => !e.isDir);
  const groups = new Map<string, Entry[]>();
  for (const file of files) {
    const fileKind = deliverableKind(file.name);
    if (!fileKind) continue;
    if (fileKind === "comp") {
      const stem = file.name.replace(/\.aep$/i, "");
      await expandProject(
        ctx,
        file,
        category,
        categoryFolder,
        categoryAbs,
        categoryRel,
        preview,
        `${idBase}/${slug(stem)}`,
        displayName(stem),
      );
      continue;
    }
    if (fileKind !== kind && !(kind === "video-alpha" && fileKind === "still")) continue;
    const key = variantGroupKey(parseDeliverableName(file.name));
    const list = groups.get(key) ?? [];
    list.push(file);
    groups.set(key, list);
  }
  for (const group of groups.values()) {
    const parsed = parseDeliverableName(group[0]!.name);
    const groupKind: AssetKind = deliverableKind(group[0]!.name) === "still" ? "still" : kind;
    const id = `${idBase}/${slug(parsed.name)}`;
    const prev = ctx.previousById.get(id);
    const deliverables = group.map((e) => buildDeliverable(ctx, e, groupKind, previousDeliverable(prev, e.rel)));
    const source = findSource(ctx.fs, categoryAbs, categoryRel, parsed.name);
    pushAsset(
      ctx,
      makeAsset(ctx, {
        id,
        name: displayName(parsed.name),
        category,
        categoryFolder,
        kind: groupKind,
        tags: group.flatMap((e) => parseDeliverableName(e.name).tags),
        deliverables,
        preview,
        source: source ? { relPath: source } : null,
      }),
    );
  }

  // Shape C and sub-groupings.
  for (const dir of entries.filter((e) => e.isDir)) {
    if (isSourceDir(dir.name)) continue;
    const dirEntries = listEntries(ctx.fs, dir.abs, dir.rel);
    const dirFingerprint = fingerprintOf(dirEntries);
    const childId = `${idBase}/${slug(dir.name)}`;

    // Unchanged since last time: reuse every asset under it without probing.
    if (ctx.previousFingerprints[dir.rel] === dirFingerprint && dirEntries.every((e) => !e.isDir)) {
      const reused = [...ctx.previousById.values()].filter((a) => a.id === childId || a.id.startsWith(`${childId}/`));
      if (reused.length > 0) {
        ctx.fingerprints[dir.rel] = dirFingerprint;
        for (const a of reused) ctx.assets.push(a);
        ctx.report.reusedDirs += 1;
        continue;
      }
    }

    const hasDeliverables = dirEntries.some((e) => !e.isDir && deliverableKind(e.name) !== null && deliverableKind(e.name) !== "comp");
    const hasProjects = dirEntries.some((e) => !e.isDir && deliverableKind(e.name) === "comp");
    const hasSubdirs = dirEntries.some((e) => e.isDir && !isSourceDir(e.name));

    if (kind !== "comp" && hasDeliverables && !hasSubdirs) {
      ctx.fingerprints[dir.rel] = dirFingerprint;
      const asset = itemFolderAsset(ctx, dir, dirEntries, category, categoryFolder, kind, preview, idBase, categoryAbs, categoryRel);
      if (asset) pushAsset(ctx, asset);
      continue;
    }
    if (kind === "comp" && hasProjects && !hasSubdirs) {
      // A comp category may keep each asset's project in its own folder.
      await scanFolder(ctx, dir.abs, dir.rel, category, categoryFolder, categoryAbs, categoryRel, preview, idBase, depth + 1);
      continue;
    }
    if (depth < 3 && (hasSubdirs || hasDeliverables || hasProjects)) {
      await scanFolder(ctx, dir.abs, dir.rel, category, categoryFolder, categoryAbs, categoryRel, preview, childId, depth + 1);
    }
  }
}

export async function scanLibrary(options: ScanOptions): Promise<ScanReport> {
  const { fs, libraryRoot } = options;
  const ctx: Ctx = {
    fs,
    libraryRoot,
    probe: options.probe ?? ((abs, size) => probeContainer(fs, abs, size)),
    inspectAep: options.inspectAep,
    previousById: new Map((options.previous?.assets ?? []).map((a) => [a.id, a])),
    previousFingerprints: options.previous?.libraryRoot === libraryRoot ? (options.previous?.fingerprints ?? {}) : {},
    fingerprints: {},
    assets: [],
    report: { unknownFolders: [], reusedDirs: 0, probed: 0, uninspectedProjects: [] },
    onProgress: options.onProgress ?? (() => {}),
    now: (options.now ?? (() => new Date()))().toISOString(),
  };

  const top = listEntries(fs, libraryRoot, "");
  for (const entry of top) {
    if (!entry.isDir) continue;
    if (!isCategoryFolder(entry.name)) {
      if (categoryForFolder(entry.name) === null && !entry.name.startsWith("_") && !SCAFFOLDING_DIRS.has(entry.name)) {
        ctx.report.unknownFolders.push(entry.name);
      }
      continue;
    }
    const category = categoryForFolder(entry.name)!;
    ctx.onProgress(`Scanning ${entry.name}`);
    await scanFolder(ctx, entry.abs, entry.rel, category, entry.name, entry.abs, entry.rel, null, category, 0);
  }

  // Deterministic order: by category folder, then by name.
  ctx.assets.sort((a, b) => a.categoryFolder.localeCompare(b.categoryFolder) || a.name.localeCompare(b.name, "en", { numeric: true }));

  const index: LibraryIndex = {
    schemaVersion: INDEX_SCHEMA_VERSION,
    libraryRoot,
    scannedAt: ctx.now,
    assets: ctx.assets,
    fingerprints: ctx.fingerprints,
  };
  return { index, ...ctx.report };
}
