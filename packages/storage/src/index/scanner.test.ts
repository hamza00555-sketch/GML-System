import { describe, expect, it } from "vitest";
import { MemoryFs } from "../fs.js";
import { categoryForFolder, isCategoryFolder, kindForCategory } from "./categories.js";
import { displayName, parseDeliverableName, slug, variantGroupKey } from "./filename.js";
import { isNoiseDir, isNoiseFile, isPreviewFile } from "./noise.js";
import { scanLibrary, type AepComp } from "./scanner.js";

const ROOT = "G:/Shared drives/Motion/Hamza/2026/Motion Library";

/** The real library's three shapes plus every kind of noise, in miniature. */
function buildLibrary(): MemoryFs {
  const fs = new MemoryFs();
  const f = (rel: string, size = 1000, mtime = 1_757_000_000_000) => fs.writeSparse(`${ROOT}/${rel}`, size, mtime);

  // GML scaffolding, empty
  for (const d of ["_inbox", "_staging", "approved", "drafts"]) fs.mkdir(`${ROOT}/${d}`);

  // Shape C — Transitions
  f("Transitions/Preview.mp4", 5000);
  f("Transitions/Arrows/Preview.mp4", 22_307_881);
  f("Transitions/Arrows/01_TRA_Arrows_D_H_ALPHA.mov", 20_983_732);
  f("Transitions/Arrows/01_TRA_Arrows_U_H_ALPHA.mov", 20_100_000);
  f("Transitions/Arrows/01_TRA_Arrows_D_V_ALPHA.mov", 19_000_000);
  f("Transitions/Angeled Arrow/Preview.mp4", 3000);
  f("Transitions/Angeled Arrow/Angeled Arrow_Down.mov", 14_000_000);
  f("Transitions/Angeled Arrow/Angeled Arrow_Up.mov", 14_000_000);
  f("Transitions/SOURCE_/Arrows.aep", 3_000_000);
  f("Transitions/SOURCE_/Angeled Arrow.aep", 3_000_000);
  f("Transitions/Arrows/Adobe After Effects Auto-Save/Arrows auto-save 1.aep", 100);
  f("Transitions/Arrows/Arrows.aep Logs/log.txt", 10);

  // Shape C with noise — 3D
  f("3D/Coin/Preview.mp4", 8000);
  f("3D/Coin/1-3D-Rotating Coin-Alpha-H.mov", 910_000_000);
  f("3D/Coin/4-3D-Floating Coins-Alpha-H.mov", 2_700_000_000);
  for (let i = 0; i < 30; i++) f(`3D/Coin/Render/coin_${String(i).padStart(4, "0")}.png`, 500);
  f("3D/Coin/desktop.ini", 10);
  f("3D/Coin/archive.zip", 10);
  f("3D/_SOURCE/Coin.aep", 1000);

  // Shape A — Backgrounds (Arabic folder), flat variants + one preview
  f("Backgrounds - خلفيات/Preview.mp4", 6000);
  f("Backgrounds - خلفيات/01_BG_DARK BLUE_H_ALPHA.mov", 40_000_000);
  f("Backgrounds - خلفيات/01_BG_DARK BLUE_V_ALPHA.mov", 38_000_000);
  f("Backgrounds - خلفيات/02_BG_LIGHT_H_ALPHA.mov", 41_000_000);

  // Illustrations with an Arabic-Indic .ai and a big mov
  f("Illustrations/People/Preview.mp4", 100);
  f("Illustrations/People/1.mov", 3_100_000_000);
  f("Illustrations/Icons/Preview.mp4", 100);
  f("Illustrations/Icons/Gosi Illustarions-٦٢.ai", 900_000);

  // Shape B — Animated Texts master project
  f("Animated Texts/Preview.mp4", 30_000_000);
  f("Animated Texts/All & Preview.aep", 4_200_000);
  f("Animated Texts/_SOURCE/Fade Up.aep", 1000);
  f("Animated Texts/_SOURCE/Typewriter.aep", 1000);

  // Shape A comp category — Counters
  f("Counters/Preview.mp4", 12_000_000);
  f("Counters/Counter 01.aep", 1_100_000);
  f("Counters/Counter 02.aep", 1_200_000);

  // Excluded and unknown
  f("Guideline/Brand.pdf", 100);
  f("Guideline/Logo.ai", 100);
  f("Random Stuff/thing.mov", 100);
  f("~$lockfile.aep", 1);
  return fs;
}

const inspectAep = async (abs: string): Promise<AepComp[]> => {
  if (abs.endsWith("All & Preview.aep")) {
    return [
      { compName: "Fade Up", fps: 25, width: 1920, height: 1080, duration: 2.5, fonts: ["DINNextLTArabic-Regular"], effects: ["ADBE Gaussian Blur 2"], numLayers: 3 },
      { compName: "Typewriter", fps: 25, width: 1920, height: 1080, duration: 3, fonts: [], effects: ["Plugin Deep Glow"], numLayers: 2 },
    ];
  }
  if (abs.includes("Counter")) {
    const name = abs.endsWith("01.aep") ? "Counter 01" : "Counter 02";
    return [{ compName: name, fps: 25, width: 1920, height: 1080, duration: 1.8, fonts: [], effects: [], numLayers: 4 }];
  }
  return [];
};

describe("filename convention", () => {
  it("parses underscore names with direction and orientation", () => {
    const p = parseDeliverableName("01_TRA_Arrows_D_H_ALPHA.mov");
    expect(p).toMatchObject({ index: 1, type: "TRA", name: "Arrows", direction: "D", orientation: "H", alpha: true });
    expect(p.tags).toEqual(expect.arrayContaining(["TRA", "D", "H", "alpha", "arrows"]));
  });

  it("parses a background with a two-word name and no direction", () => {
    expect(parseDeliverableName("01_BG_DARK BLUE_H_ALPHA.mov")).toMatchObject({ index: 1, type: "BG", name: "DARK BLUE", orientation: "H", alpha: true });
  });

  it("parses the dash-delimited 3D variant", () => {
    const p = parseDeliverableName("1-3D-Rotating Coin-Alpha-H.mov");
    expect(p).toMatchObject({ index: 1, type: "3D", name: "Rotating Coin", orientation: "H", alpha: true });
  });

  it("parses direction words", () => {
    expect(parseDeliverableName("Angeled Arrow_Down.mov")).toMatchObject({ name: "Angeled Arrow", direction: "D" });
  });

  it("groups variants of one asset together and not different assets", () => {
    const a = variantGroupKey(parseDeliverableName("01_BG_DARK BLUE_H_ALPHA.mov"));
    const b = variantGroupKey(parseDeliverableName("01_BG_DARK BLUE_V_ALPHA.mov"));
    const c = variantGroupKey(parseDeliverableName("02_BG_LIGHT_H_ALPHA.mov"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("normalises Arabic-Indic digits without touching the disk name", () => {
    expect(parseDeliverableName("Gosi Illustarions-٦٢.ai").name).toBe("Gosi Illustarions 62");
    expect(slug("Gosi Illustarions-٦٢")).toBe("gosi-illustarions-62");
  });

  it("slugs Arabic to stable ASCII and title-cases shouting names", () => {
    expect(slug("خلفيات")).toMatch(/^[a-z0-9]+$/);
    expect(slug("خلفيات")).toBe(slug("خلفيات"));
    expect(displayName("DARK BLUE")).toBe("Dark Blue");
    expect(displayName("Angeled Arrow")).toBe("Angeled Arrow");
  });
});

describe("noise and categories", () => {
  it("recognises every noise pattern from the brief", () => {
    expect(isNoiseDir("Adobe After Effects Auto-Save")).toBe(true);
    expect(isNoiseDir("Arrows.aep Logs")).toBe(true);
    expect(isNoiseDir("Render")).toBe(true);
    expect(isNoiseFile("desktop.ini")).toBe(true);
    expect(isNoiseFile("archive.zip")).toBe(true);
    expect(isNoiseFile("~$x.aep")).toBe(true);
    expect(isNoiseFile(".DS_Store")).toBe(true);
    expect(isNoiseDir("Arrows")).toBe(false);
    expect(isPreviewFile("Preview.mp4")).toBe(true);
    expect(isPreviewFile("preview_v2.mp4")).toBe(true);
    expect(isPreviewFile("01_TRA_Arrows_D_H_ALPHA.mov")).toBe(false);
  });

  it("maps folder names to categories and kinds", () => {
    expect(categoryForFolder("Backgrounds - خلفيات")).toBe("backgrounds");
    expect(categoryForFolder("3D")).toBe("3d");
    expect(categoryForFolder("Animated Texts")).toBe("animated-texts");
    expect(categoryForFolder("Random Stuff")).toBeNull();
    expect(isCategoryFolder("Guideline")).toBe(false);
    expect(isCategoryFolder("_inbox")).toBe(false);
    expect(kindForCategory("counters")).toBe("comp");
    expect(kindForCategory("transitions")).toBe("video-alpha");
  });
});

describe("scanner", () => {
  it("indexes the three shapes and nothing from the noise list", async () => {
    const fs = buildLibrary();
    const { index, unknownFolders, uninspectedProjects } = await scanLibrary({ fs, libraryRoot: ROOT, inspectAep, probe: () => null });
    const ids = index.assets.map((a) => a.id).sort();

    expect(ids).toEqual(
      [
        "3d/coin",
        "animated-texts/all-preview/fade-up",
        "animated-texts/all-preview/typewriter",
        "backgrounds/dark-blue",
        "backgrounds/light",
        "counters/counter-01",
        "counters/counter-02",
        "illustrations/icons",
        "illustrations/people",
        "transitions/angeled-arrow",
        "transitions/arrows",
      ].sort(),
    );

    const all = index.assets.flatMap((a) => a.deliverables.map((d) => d.relPath));
    for (const rel of all) {
      expect(rel).not.toMatch(/Render\/|SOURCE_|_SOURCE|Auto-Save|Logs|desktop\.ini|\.zip|Guideline/);
      expect(rel).not.toMatch(/^[A-Za-z]:|\\/);
    }
    expect(unknownFolders).toEqual(["Random Stuff"]);
    expect(uninspectedProjects).toEqual([]);
  });

  it("assigns kinds by category", async () => {
    const { index } = await scanLibrary({ fs: buildLibrary(), libraryRoot: ROOT, inspectAep, probe: () => null });
    const kind = (id: string) => index.assets.find((a) => a.id === id)!.kind;
    expect(kind("transitions/arrows")).toBe("video-alpha");
    expect(kind("3d/coin")).toBe("video-alpha");
    expect(kind("backgrounds/dark-blue")).toBe("video-alpha");
    expect(kind("illustrations/people")).toBe("video-alpha");
    expect(kind("illustrations/icons")).toBe("still");
    expect(kind("animated-texts/all-preview/fade-up")).toBe("comp");
    expect(kind("counters/counter-01")).toBe("comp");
  });

  it("groups shape A variants and reads shape C variants, with previews resolved", async () => {
    const { index } = await scanLibrary({ fs: buildLibrary(), libraryRoot: ROOT, inspectAep, probe: () => null });
    const byId = new Map(index.assets.map((a) => [a.id, a]));

    const arrows = byId.get("transitions/arrows")!;
    expect(arrows.deliverables.map((d) => `${d.direction}${d.orientation}`).sort()).toEqual(["DH", "DV", "UH"]);
    expect(arrows.preview?.relPath).toBe("Transitions/Arrows/Preview.mp4");
    expect(arrows.source?.relPath).toBe("Transitions/SOURCE_/Arrows.aep");
    expect(arrows.tags).toEqual(expect.arrayContaining(["TRA", "arrows", "alpha", "D", "U", "H", "V"]));

    const dark = byId.get("backgrounds/dark-blue")!;
    expect(dark.name).toBe("Dark Blue");
    expect(dark.deliverables).toHaveLength(2);
    expect(dark.preview?.relPath).toBe("Backgrounds - خلفيات/Preview.mp4");
    expect(dark.categoryFolder).toBe("Backgrounds - خلفيات");

    const coin = byId.get("3d/coin")!;
    expect(coin.deliverables.map((d) => d.warnings)).toEqual([["oversized"], ["oversized"]]);
    expect(coin.source?.relPath).toBe("3D/_SOURCE/Coin.aep");
  });

  it("expands a master project into one asset per comp with requires and source links", async () => {
    const { index } = await scanLibrary({ fs: buildLibrary(), libraryRoot: ROOT, inspectAep, probe: () => null });
    const fade = index.assets.find((a) => a.id === "animated-texts/all-preview/fade-up")!;
    expect(fade.comp).toEqual({ compName: "Fade Up", fps: 25, width: 1920, height: 1080, duration: 2.5 });
    expect(fade.requires).toEqual({ fonts: ["DINNextLTArabic-Regular"], effects: ["ADBE Gaussian Blur 2"] });
    expect(fade.source).toEqual({ relPath: "Animated Texts/_SOURCE/Fade Up.aep", compName: "Fade Up" });
    expect(fade.deliverables[0]!.relPath).toBe("Animated Texts/All & Preview.aep");
    expect(fade.preview?.relPath).toBe("Animated Texts/Preview.mp4");

    const counter = index.assets.find((a) => a.id === "counters/counter-01")!;
    expect(counter.comp?.compName).toBe("Counter 01");
  });

  it("lists a project as one asset when no inspector is available (Illustrator)", async () => {
    const { index, uninspectedProjects } = await scanLibrary({ fs: buildLibrary(), libraryRoot: ROOT, probe: () => null });
    expect(uninspectedProjects).toEqual(expect.arrayContaining(["Animated Texts/All & Preview.aep"]));
    expect(index.assets.find((a) => a.id === "animated-texts/all-preview")?.kind).toBe("comp");
  });

  it("is incremental: unchanged folders are reused without probing, and a changed file bumps the version", async () => {
    const fs = buildLibrary();
    let probes = 0;
    const probe = () => {
      probes += 1;
      return { codec: "prores_4444", fourcc: "ap4h", width: 1920, height: 1080, fps: 24, alpha: "unknown" as const };
    };
    const first = await scanLibrary({ fs, libraryRoot: ROOT, inspectAep, probe });
    const firstProbes = probes;
    expect(firstProbes).toBeGreaterThan(0);
    expect(first.index.assets.find((a) => a.id === "transitions/arrows")!.deliverables[0]!.probed).toBe(true);

    const second = await scanLibrary({ fs, libraryRoot: ROOT, previous: first.index, inspectAep, probe });
    expect(probes).toBe(firstProbes);
    expect(second.reusedDirs).toBeGreaterThan(0);
    expect(second.index.assets.map((a) => `${a.id}@${a.version}`).sort()).toEqual(first.index.assets.map((a) => `${a.id}@${a.version}`).sort());

    // A re-rendered variant: only that asset bumps, and only that file is probed.
    fs.writeSparse(`${ROOT}/Transitions/Arrows/01_TRA_Arrows_D_H_ALPHA.mov`, 21_000_000, 1_758_000_000_000);
    const third = await scanLibrary({ fs, libraryRoot: ROOT, previous: second.index, inspectAep, probe });
    expect(probes).toBe(firstProbes + 1);
    const arrows = third.index.assets.find((a) => a.id === "transitions/arrows")!;
    expect(arrows.version).toBe(2);
    expect(third.index.assets.find((a) => a.id === "3d/coin")!.version).toBe(1);
  });

  it("does not re-read a master project through AE when it has not changed", async () => {
    const fs = buildLibrary();
    let inspections = 0;
    const counting = async (abs: string) => {
      inspections += 1;
      return inspectAep(abs);
    };
    const first = await scanLibrary({ fs, libraryRoot: ROOT, inspectAep: counting, probe: () => null });
    const before = inspections;
    await scanLibrary({ fs, libraryRoot: ROOT, previous: first.index, inspectAep: counting, probe: () => null });
    expect(inspections).toBe(before);
  });
});
