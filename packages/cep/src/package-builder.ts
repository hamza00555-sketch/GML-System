import type { AssetManifest, Category, MotionAsset } from "@gml/core";
import { SCHEMA_VERSION } from "@gml/core";
import { preflightBeforeCollect, thirdPartyEffects, type PreflightReport } from "@gml/preflight";
import type { FolderLibraryProvider, StagingHandle } from "@gml/storage";
import type { CompInspection } from "./host-calls.js";

/**
 * Turns a comp plus a designer-rendered preview into a library package.
 *
 * This is deliberately the collect-free path: the project file is copied as
 * it is, and the asset records whether its footage is bundled (no file footage
 * reachable from the comp — the common case for titles, counters, transitions)
 * or external (reachable file footage that collect would gather — M3, gated on
 * Spike A). An external package can only be a draft; approval needs bundling.
 */

export interface Assessment {
  report: PreflightReport;
  footage: "bundled" | "external";
  externalFiles: string[];
  fonts: string[];
  plugins: { name: string; matchName: string }[];
}

export function assessComp(inspection: CompInspection): Assessment {
  const report = preflightBeforeCollect({
    projectPath: inspection.projectPath,
    projectDirty: inspection.projectDirty,
    compName: inspection.compName,
    compNames: inspection.compNames,
    aeVersion: inspection.aeVersion,
    footage: inspection.footage,
    fonts: inspection.fonts,
    effectMatchNames: inspection.effects.map((e) => e.matchName),
  });

  const externalFiles = inspection.footage
    .filter((f) => f.sourceKind === "file" && f.filePath)
    .map((f) => f.filePath!);

  const thirdParty = new Set(thirdPartyEffects(inspection.effects.map((e) => e.matchName)));
  const plugins = inspection.effects
    .filter((e) => thirdParty.has(e.matchName))
    .map((e) => ({ name: e.name, matchName: e.matchName }));

  return {
    report,
    footage: externalFiles.length === 0 ? "bundled" : "external",
    externalFiles,
    fonts: inspection.fonts,
    plugins,
  };
}

export interface AddAssetInput {
  id: string;
  version: string;
  nameEn: string;
  nameAr: string;
  description: string;
  category: Exclude<Category, "audio">;
  tags: string[];
  status: "draft" | "approved";
  author: string;
  /** Absolute path to the H.264 preview the designer rendered. */
  previewPath: string;
  /** Either a PNG on disk or bytes extracted from the preview in the panel. */
  posterPath?: string;
  posterBytes?: Uint8Array;
}

export function slugFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `gml_${slug}` : "";
}

export function bumpPatch(version: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) return "1.0.0";
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

export interface BuildOptions {
  now?: () => Date;
}

export async function buildMotionPackage(
  provider: FolderLibraryProvider,
  inspection: CompInspection,
  input: AddAssetInput,
  options: BuildOptions = {},
): Promise<MotionAsset> {
  const assessment = assessComp(inspection);
  if (!assessment.report.ok) {
    throw new Error(assessment.report.blockers.map((b) => b.message).join("\n"));
  }
  if (input.status === "approved" && assessment.footage === "external") {
    throw new Error(
      "This comp uses file footage that is not bundled yet, so it can only be published as a draft.",
    );
  }
  if (!inspection.projectPath) throw new Error("Save the project first.");
  if (!input.posterPath && !input.posterBytes) throw new Error("A poster image is required.");

  const now = (options.now ?? (() => new Date()))().toISOString();
  const existing = provider.assetSync(input.id, input.version);
  if (existing) {
    throw new Error(`${input.id}@${input.version} is already in the library — bump the version.`);
  }

  let handle: StagingHandle | null = null;
  try {
    handle = await provider.beginPublish(input.id, input.version);

    const source = provider.stageFileFromPath(handle, "source.aep", inspection.projectPath);
    const preview = provider.stageFileFromPath(handle, "preview.mp4", input.previewPath);
    const poster = input.posterBytes
      ? provider.stageBytes(handle, "poster.png", input.posterBytes)
      : provider.stageFileFromPath(handle, "poster.png", input.posterPath!);

    const assets: AssetManifest = {};
    for (const f of [source, preview, poster]) {
      assets[f.path] = { bytes: f.bytes, sha256: f.sha256, md5: f.md5 };
    }

    const meta: MotionAsset = {
      schemaVersion: SCHEMA_VERSION,
      assetType: "motion",
      id: input.id,
      version: input.version,
      nameEn: input.nameEn.trim(),
      nameAr: input.nameAr.trim() || input.nameEn.trim(),
      description: input.description.trim(),
      category: input.category,
      tags: input.tags.map((t) => t.trim()).filter(Boolean),
      duration: inspection.duration,
      status: input.status,
      author: input.author,
      createdAt: now,
      updatedAt: now,
      compName: inspection.compName,
      fps: inspection.fps,
      width: inspection.width,
      height: inspection.height,
      source: "source.aep",
      preview: "preview.mp4",
      poster: "poster.png",
      dependencies: {
        footage: assessment.footage,
        fonts: assessment.fonts,
        plugins: assessment.plugins,
        aeMinVersion: inspection.aeVersion,
      },
      controls: [],
      assets,
    };

    return (await provider.finalizePublish(handle, meta)) as MotionAsset;
  } catch (error) {
    if (handle) await provider.abortPublish(handle);
    throw error;
  }
}
