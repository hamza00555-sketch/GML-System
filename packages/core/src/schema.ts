import { z } from "zod";
import { CATEGORIES } from "./categories.js";

/** Current schema revision. Bump only for breaking shape changes. */
export const SCHEMA_VERSION = 1;

/**
 * The manifest never describes `meta.json` itself — that file *carries* the
 * manifest, so it cannot contain its own hash.
 */
export const MANIFEST_EXCLUDED = "meta.json";

const relativePath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !/^[A-Za-z]:/.test(p), {
    message: "must be a package-relative path, not absolute",
  })
  .refine((p) => !p.split("/").includes(".."), {
    message: "must not escape the package root",
  })
  .refine((p) => !p.includes("\\"), {
    message: "must use forward slashes",
  });

export const assetFileSchema = z.object({
  bytes: z.number().int().nonnegative(),
  /** Primary local integrity check — computed by us on publish and after download. */
  sha256: z.string().regex(/^[a-f0-9]{64}$/, "expected lowercase hex sha256"),
  /**
   * Required, not optional: Drive does not populate sha256Checksum or
   * sha1Checksum for items in Shared Drives, so md5 is the only checksum
   * available for verifying that an upload landed intact.
   */
  md5: z.string().regex(/^[a-f0-9]{32}$/, "expected lowercase hex md5"),
});

export type AssetFile = z.infer<typeof assetFileSchema>;

export const assetManifestSchema = z
  .record(relativePath, assetFileSchema)
  .refine((m) => !(MANIFEST_EXCLUDED in m), {
    message: `${MANIFEST_EXCLUDED} must not appear in assets — it carries the manifest`,
  });

export type AssetManifest = z.infer<typeof assetManifestSchema>;

const baseShape = {
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z
    .string()
    .regex(/^gml_[a-z0-9]+(?:[-_][a-z0-9]+)*$/, "expected gml_<slug> in lowercase"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "expected semver major.minor.patch"),
  nameAr: z.string().min(1),
  nameEn: z.string().min(1),
  description: z.string().default(""),
  category: z.enum(CATEGORIES),
  tags: z.array(z.string()).default([]),
  duration: z.number().positive(),
  status: z.enum(["draft", "approved"]),
  author: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  assets: assetManifestSchema,
};

export const dependenciesSchema = z.object({
  /** "external" is never valid for an approved asset — see preflight. */
  footage: z.enum(["bundled", "external"]),
  fonts: z.array(z.string()).default([]),
  plugins: z
    .array(
      z.object({
        name: z.string(),
        matchName: z.string(),
        version: z.string().optional(),
      }),
    )
    .default([]),
  aeMinVersion: z.string().optional(),
});

export type Dependencies = z.infer<typeof dependenciesSchema>;

export const motionAssetSchema = z
  .object({
    ...baseShape,
    assetType: z.literal("motion"),
    category: z.enum(CATEGORIES).refine((c) => c !== "audio", {
      message: "a motion asset cannot live in the audio category",
    }),
    compName: z.string().min(1),
    fps: z.number().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    source: relativePath.default("source.aep"),
    preview: relativePath.default("preview.mp4"),
    previewGif: relativePath.default("preview.gif"),
    poster: relativePath.default("poster.png"),
    dependencies: dependenciesSchema,
    /**
     * Reserved so a flattened render can be offered when a required plugin is
     * missing. Declared from day one so enabling it is not a breaking change.
     */
    fallback: z
      .object({
        type: z.literal("rendered"),
        file: relativePath,
        codec: z.literal("prores4444"),
      })
      .optional(),
    /** Reserved for Essential Graphics controls. */
    controls: z.array(z.unknown()).default([]),
  })
  .strict();

export const audioAssetSchema = z
  .object({
    ...baseShape,
    assetType: z.literal("audio"),
    category: z.literal("audio"),
    master: relativePath.default("audio.wav"),
    previewFile: relativePath.default("preview.mp3"),
    sampleRate: z.number().int().positive(),
    channels: z.number().int().min(1).max(8),
    /** Precomputed at publish time — the panel never decodes audio to draw a waveform. */
    peaks: relativePath.optional(),
    kind: z.enum(["sfx", "music", "ui", "ambience"]).optional(),
  })
  .strict();

export type MotionAsset = z.infer<typeof motionAssetSchema>;
export type AudioAsset = z.infer<typeof audioAssetSchema>;
export type GmlAsset = MotionAsset | AudioAsset;
export type AssetType = GmlAsset["assetType"];

/**
 * Every file an asset points at must also be described in its manifest,
 * otherwise the package cannot be verified after download.
 */
function referencedFiles(asset: GmlAsset): string[] {
  return asset.assetType === "motion"
    ? [
        asset.source,
        asset.preview,
        asset.previewGif,
        asset.poster,
        ...(asset.fallback ? [asset.fallback.file] : []),
      ]
    : [asset.master, asset.previewFile, ...(asset.peaks ? [asset.peaks] : [])];
}

export const gmlAssetSchema = z
  .discriminatedUnion("assetType", [motionAssetSchema, audioAssetSchema])
  .superRefine((asset, ctx) => {
    for (const file of referencedFiles(asset)) {
      if (!(file in asset.assets)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `referenced file "${file}" is missing from assets manifest`,
          path: ["assets", file],
        });
      }
    }
  });

export function isMotionAsset(a: GmlAsset): a is MotionAsset {
  return a.assetType === "motion";
}

export function isAudioAsset(a: GmlAsset): a is AudioAsset {
  return a.assetType === "audio";
}

export function parseAsset(input: unknown): GmlAsset {
  return gmlAssetSchema.parse(input);
}

export function safeParseAsset(input: unknown) {
  return gmlAssetSchema.safeParse(input);
}
