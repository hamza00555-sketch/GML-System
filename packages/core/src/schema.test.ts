import { describe, expect, it } from "vitest";
import {
  MANIFEST_EXCLUDED,
  SCHEMA_VERSION,
  gmlAssetSchema,
  isAudioAsset,
  isMotionAsset,
  safeParseAsset,
} from "./schema.js";
import { audioFixture, manifestFor, motionFixture } from "./fixtures.js";

describe("GmlAsset discriminated union", () => {
  it("accepts a motion asset and narrows on assetType", () => {
    const parsed = gmlAssetSchema.parse(motionFixture());
    expect(isMotionAsset(parsed)).toBe(true);
    if (!isMotionAsset(parsed)) throw new Error("expected motion");
    expect(parsed.compName).toBe("GML_fade-up");
  });

  it("accepts an audio asset and narrows on assetType", () => {
    const parsed = gmlAssetSchema.parse(audioFixture());
    expect(isAudioAsset(parsed)).toBe(true);
    if (!isAudioAsset(parsed)) throw new Error("expected audio");
    expect(parsed.sampleRate).toBe(48000);
  });

  it("rejects motion-only fields on an audio asset", () => {
    const bad = { ...audioFixture(), compName: "GML_nope" };
    expect(safeParseAsset(bad).success).toBe(false);
  });

  it("rejects an audio asset outside the audio category", () => {
    const bad = { ...audioFixture(), category: "counters" };
    expect(safeParseAsset(bad).success).toBe(false);
  });

  it("rejects a motion asset inside the audio category", () => {
    const bad = { ...motionFixture(), category: "audio" };
    expect(safeParseAsset(bad).success).toBe(false);
  });

  it("pins the schema version so drift is caught", () => {
    const bad = { ...motionFixture(), schemaVersion: SCHEMA_VERSION + 1 };
    expect(safeParseAsset(bad).success).toBe(false);
  });
});

describe("assets manifest", () => {
  it("never contains meta.json — the file that carries it", () => {
    const asset = motionFixture();
    const bad = {
      ...asset,
      assets: { ...asset.assets, ...manifestFor([MANIFEST_EXCLUDED]) },
    };
    const result = safeParseAsset(bad);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.error.issues)).toContain(MANIFEST_EXCLUDED);
  });

  it("keys by relative path so same-named files in different folders differ", () => {
    const asset = motionFixture({
      assets: manifestFor([
        "source.aep",
        "preview.mp4",
        "preview.gif",
        "poster.png",
        "footage/a/logo.png",
        "footage/b/logo.png",
      ]),
    });
    const parsed = gmlAssetSchema.parse(asset);
    expect(Object.keys(parsed.assets)).toContain("footage/a/logo.png");
    expect(Object.keys(parsed.assets)).toContain("footage/b/logo.png");
    expect(parsed.assets["footage/a/logo.png"]).not.toEqual(
      parsed.assets["footage/b/logo.png"],
    );
  });

  it("requires every file to carry bytes, sha256 and md5", () => {
    const asset = motionFixture();
    for (const entry of Object.values(asset.assets)) {
      expect(entry.bytes).toBeTypeOf("number");
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.md5).toMatch(/^[a-f0-9]{32}$/);
    }
  });

  it("rejects absolute paths and parent traversal", () => {
    for (const path of ["/etc/passwd", "C:/x.png", "../outside.png"]) {
      const asset = motionFixture();
      const bad = { ...asset, assets: { ...asset.assets, ...manifestFor([path]) } };
      expect(safeParseAsset(bad).success).toBe(false);
    }
  });

  it("rejects an asset referencing a file absent from its manifest", () => {
    const bad = motionFixture({ assets: manifestFor(["source.aep", "preview.mp4"]) });
    const result = safeParseAsset(bad);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.error.issues)).toContain("poster.png");
  });
});
