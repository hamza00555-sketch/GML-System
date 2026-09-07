import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FolderLibraryProvider, MemoryFs, hashesFrom } from "@gml/storage";
import { assessComp, buildMotionPackage, bumpPatch, slugFromName, type AddAssetInput } from "./package-builder.js";
import type { CompInspection } from "./host-calls.js";

const bytes = (s: string) => new TextEncoder().encode(s);

function inspection(over: Partial<CompInspection> = {}): CompInspection {
  return {
    compName: "GML_fade-up",
    compId: 12,
    fps: 25,
    width: 1920,
    height: 1080,
    duration: 2.5,
    projectPath: "/Users/d/work/titles.aep",
    projectDirty: false,
    aeVersion: "24.6",
    compNames: ["GML_fade-up", "Main"],
    footage: [
      { itemId: 1, name: "Solid", sourceKind: "solid", isStill: true, hasVideo: true, hasAudio: false, hasProxy: false },
    ],
    fonts: ["DINNextLTArabic-Regular"],
    effects: [
      { matchName: "ADBE Gaussian Blur 2", name: "Gaussian Blur" },
      { matchName: "Plugin Deep Glow", name: "Deep Glow" },
    ],
    ...over,
  };
}

function setup() {
  const fs = new MemoryFs();
  fs.mkdir("/lib");
  fs.writeFile("/Users/d/work/titles.aep", bytes("aep-bytes"));
  fs.writeFile("/Users/d/renders/fade.mp4", bytes("mp4-bytes"));
  fs.writeFile("/Users/d/renders/fade.png", bytes("png-bytes"));
  const provider = new FolderLibraryProvider({ root: "/lib", fs, hashes: hashesFrom({ createHash }), idFactory: () => "u" });
  return { fs, provider };
}

const input: AddAssetInput = {
  id: "gml_fade-up",
  version: "1.0.0",
  nameEn: "Fade Up",
  nameAr: "",
  description: "",
  category: "animated-texts",
  tags: ["intro", " clean ", ""],
  status: "draft",
  author: "hamza",
  previewPath: "/Users/d/renders/fade.mp4",
  posterPath: "/Users/d/renders/fade.png",
};

describe("assessComp", () => {
  it("treats a comp with only solids and nested comps as bundled", () => {
    const a = assessComp(inspection());
    expect(a.footage).toBe("bundled");
    expect(a.report.ok).toBe(true);
    expect(a.plugins).toEqual([{ name: "Deep Glow", matchName: "Plugin Deep Glow" }]);
    expect(a.fonts).toEqual(["DINNextLTArabic-Regular"]);
  });

  it("flags reachable file footage as external", () => {
    const a = assessComp(
      inspection({
        footage: [
          { itemId: 2, name: "bg.mp4", sourceKind: "file", filePath: "/Users/d/bg.mp4", isStill: false, hasVideo: true, hasAudio: false, hasProxy: false },
        ],
      }),
    );
    expect(a.footage).toBe("external");
    expect(a.externalFiles).toEqual(["/Users/d/bg.mp4"]);
  });

  it("blocks on missing footage and an unsaved project", () => {
    const a = assessComp(
      inspection({
        projectPath: null,
        footage: [
          { itemId: 3, name: "logo.ai", sourceKind: "file", missingFootagePath: "/gone/logo.ai", isStill: true, hasVideo: true, hasAudio: false, hasProxy: false },
        ],
      }),
    );
    expect(a.report.ok).toBe(false);
    expect(a.report.blockers.map((b) => b.code).sort()).toEqual(["footage-missing", "project-unsaved"]);
  });
});

describe("buildMotionPackage", () => {
  it("writes a verifiable package into drafts with meta.json describing every file", async () => {
    const { fs, provider } = setup();
    const asset = await buildMotionPackage(provider, inspection(), input, { now: () => new Date("2026-09-06T10:00:00Z") });

    expect(asset.id).toBe("gml_fade-up");
    expect(asset.nameAr).toBe("Fade Up"); // falls back to the English name
    expect(asset.tags).toEqual(["intro", "clean"]);
    expect(asset.dependencies).toEqual({
      footage: "bundled",
      fonts: ["DINNextLTArabic-Regular"],
      plugins: [{ name: "Deep Glow", matchName: "Plugin Deep Glow" }],
      aeMinVersion: "24.6",
    });
    expect(Object.keys(asset.assets).sort()).toEqual(["poster.png", "preview.mp4", "source.aep"]);
    expect(asset.previewGif).toBeUndefined();

    expect(fs.exists("/lib/drafts/gml_fade-up/meta.json")).toBe(true);
    expect(new TextDecoder().decode(fs.readFile("/lib/drafts/gml_fade-up/source.aep"))).toBe("aep-bytes");
    expect(await provider.fetchPackage("gml_fade-up", "1.0.0")).toBe("/lib/drafts/gml_fade-up");
  });

  it("accepts poster bytes extracted in the panel instead of a file", async () => {
    const { fs, provider } = setup();
    await buildMotionPackage(provider, inspection(), { ...input, posterPath: undefined, posterBytes: bytes("png-from-canvas") });
    expect(new TextDecoder().decode(fs.readFile("/lib/drafts/gml_fade-up/poster.png"))).toBe("png-from-canvas");
  });

  it("refuses approved status when footage is not bundled, and leaves no staging behind", async () => {
    const { fs, provider } = setup();
    const ext = inspection({
      footage: [{ itemId: 2, name: "bg.mp4", sourceKind: "file", filePath: "/Users/d/bg.mp4", isStill: false, hasVideo: true, hasAudio: false, hasProxy: false }],
    });
    await expect(buildMotionPackage(provider, ext, { ...input, status: "approved" })).rejects.toThrow(/draft/);
    expect(fs.exists("/lib/drafts/gml_fade-up")).toBe(false);

    const draft = await buildMotionPackage(provider, ext, input);
    expect(draft.dependencies.footage).toBe("external");
  });

  it("refuses a duplicate id@version and a blocked preflight", async () => {
    const { provider } = setup();
    await buildMotionPackage(provider, inspection(), input);
    await expect(buildMotionPackage(provider, inspection(), input)).rejects.toThrow(/bump the version/);
    await expect(buildMotionPackage(provider, inspection({ projectDirty: true }), { ...input, version: "1.0.1" })).rejects.toThrow(/unsaved/);
  });

  it("aborts staging when a media file is missing", async () => {
    const { fs, provider } = setup();
    await expect(buildMotionPackage(provider, inspection(), { ...input, previewPath: "/nope.mp4" })).rejects.toThrow();
    expect(fs.readdir("/lib/_staging")).toEqual([]);
  });
});

describe("helpers", () => {
  it("slugs names into ids", () => {
    expect(slugFromName("Fade Up Title")).toBe("gml_fade-up-title");
    expect(slugFromName("  Counter — 01 ")).toBe("gml_counter-01");
    expect(slugFromName("عنوان")).toBe("");
  });

  it("bumps the patch version", () => {
    expect(bumpPatch("1.2.3")).toBe("1.2.4");
    expect(bumpPatch("x")).toBe("1.0.0");
  });
});
