import type { Category } from "./categories.js";
import { INDEX_SCHEMA_VERSION, type AssetKind, type Deliverable, type LibraryAsset, type LibraryIndex } from "./library.js";

/**
 * A realistic index for the harness and the tests, modelled on the actual
 * library: alpha ProRes deliverables with direction/orientation variants,
 * a master text project expanded into comps, and a few oversized 4K files.
 */

const NOW = "2026-09-07T12:00:00.000Z";

function deliverable(relPath: string, over: Partial<Deliverable> = {}): Deliverable {
  return {
    relPath,
    bytes: 20_983_732,
    mtimeMs: 1_757_000_000_000,
    hash: `${over.bytes ?? 20_983_732}-1757000000000`,
    codec: "prores_4444",
    width: 1920,
    height: 1080,
    fps: 24,
    alpha: "unknown",
    probed: true,
    warnings: [],
    ...over,
  };
}

export function assetFixture(over: Partial<LibraryAsset> & { id: string; name: string; category: Category }): LibraryAsset {
  const kind: AssetKind = over.kind ?? "video-alpha";
  const folder = over.categoryFolder ?? over.category;
  return {
    version: 1,
    kind,
    tags: [],
    deliverables: [deliverable(`${folder}/${over.name}/${over.name}.mov`)],
    preview: { relPath: `${folder}/${over.name}/Preview.mp4`, bytes: 22_307_881, mtimeMs: 1_757_000_000_000 },
    poster: { cacheKey: `${over.id}.png` },
    source: null,
    requires: { fonts: [], effects: [] },
    status: "approved",
    updatedAt: NOW,
    categoryFolder: folder,
    ...over,
  } as LibraryAsset;
}

export function sampleIndex(libraryRoot = "G:\\Shared drives\\Motion\\Hamza\\2026\\Motion Library"): LibraryIndex {
  const assets: LibraryAsset[] = [
    assetFixture({
      id: "transitions/arrows",
      name: "Arrows",
      category: "transitions",
      categoryFolder: "Transitions",
      tags: ["TRA", "arrow", "alpha"],
      deliverables: [
        deliverable("Transitions/Arrows/01_TRA_Arrows_D_H_ALPHA.mov", { direction: "D", orientation: "H" }),
        deliverable("Transitions/Arrows/01_TRA_Arrows_U_H_ALPHA.mov", { direction: "U", orientation: "H" }),
        deliverable("Transitions/Arrows/01_TRA_Arrows_D_V_ALPHA.mov", { direction: "D", orientation: "V", width: 1080, height: 1920 }),
      ],
      source: { relPath: "Transitions/SOURCE_/Arrows.aep" },
    }),
    assetFixture({
      id: "transitions/angeled-arrow",
      name: "Angeled Arrow",
      category: "transitions",
      categoryFolder: "Transitions",
      tags: ["TRA", "arrow", "alpha"],
      deliverables: [
        deliverable("Transitions/Angeled Arrow/Angeled Arrow_Down.mov", { direction: "D", codec: "prores_4444_xq", warnings: ["prores-xq"] }),
        deliverable("Transitions/Angeled Arrow/Angeled Arrow_Up.mov", { direction: "U", codec: "prores_4444_xq", warnings: ["prores-xq"] }),
      ],
    }),
    assetFixture({
      id: "3d/coin",
      name: "Coin",
      category: "3d",
      categoryFolder: "3D",
      tags: ["3D", "coin", "alpha"],
      deliverables: [
        deliverable("3D/Coin/1-3D-Rotating Coin-Alpha-H.mov", { orientation: "H", width: 3840, height: 2160, fps: 30, bytes: 910_000_000, warnings: ["4k", "oversized"] }),
        deliverable("3D/Coin/3-3D-Transition Coin2-Alpha-H.mov", { orientation: "H", width: 3840, height: 2160, fps: 30, bytes: 620_000_000, warnings: ["4k", "oversized"] }),
        deliverable("3D/Coin/4-3D-Floating Coins-Alpha-H.mov", { orientation: "H", width: 3840, height: 2160, fps: 30, bytes: 2_700_000_000, warnings: ["4k", "oversized"] }),
      ],
      version: 2,
    }),
    assetFixture({
      id: "backgrounds/dark-blue",
      name: "Dark Blue",
      category: "backgrounds",
      categoryFolder: "Backgrounds - خلفيات",
      nameAr: "أزرق داكن",
      tags: ["BG", "alpha"],
      deliverables: [
        deliverable("Backgrounds - خلفيات/01_BG_DARK BLUE_H_ALPHA.mov", { orientation: "H" }),
        deliverable("Backgrounds - خلفيات/01_BG_DARK BLUE_V_ALPHA.mov", { orientation: "V", width: 1080, height: 1920 }),
      ],
      preview: { relPath: "Backgrounds - خلفيات/Preview.mp4", bytes: 18_000_000, mtimeMs: 1_757_000_000_000 },
    }),
    assetFixture({
      id: "illustrations/people",
      name: "People",
      category: "illustrations",
      categoryFolder: "Illustrations",
      tags: ["alpha"],
      deliverables: [deliverable("Illustrations/People/1.mov", { bytes: 3_100_000_000, warnings: ["oversized"] })],
    }),
    assetFixture({
      id: "animated-texts/all-preview/fade-up",
      name: "Fade Up",
      category: "animated-texts",
      categoryFolder: "Animated Texts",
      kind: "comp",
      tags: ["text"],
      deliverables: [deliverable("Animated Texts/All & Preview.aep", { codec: undefined, width: undefined, height: undefined, fps: undefined, probed: false, bytes: 4_200_000 })],
      preview: { relPath: "Animated Texts/Preview.mp4", bytes: 30_000_000, mtimeMs: 1_757_000_000_000 },
      source: { relPath: "Animated Texts/_SOURCE/Fade Up.aep", compName: "Fade Up" },
      requires: { fonts: ["DINNextLTArabic-Regular"], effects: ["ADBE Gaussian Blur 2"] },
      comp: { compName: "Fade Up", fps: 25, width: 1920, height: 1080, duration: 2.5 },
    }),
    assetFixture({
      id: "animated-texts/all-preview/typewriter",
      name: "Typewriter",
      category: "animated-texts",
      categoryFolder: "Animated Texts",
      kind: "comp",
      tags: ["text"],
      deliverables: [deliverable("Animated Texts/All & Preview.aep", { codec: undefined, width: undefined, height: undefined, fps: undefined, probed: false, bytes: 4_200_000 })],
      preview: { relPath: "Animated Texts/Preview.mp4", bytes: 30_000_000, mtimeMs: 1_757_000_000_000 },
      source: null,
      requires: { fonts: [], effects: ["Plugin Deep Glow"] },
      comp: { compName: "Typewriter", fps: 25, width: 1920, height: 1080, duration: 3 },
    }),
    assetFixture({
      id: "counters/counter-01",
      name: "Counter 01",
      category: "counters",
      categoryFolder: "Counters",
      kind: "comp",
      tags: ["counter"],
      deliverables: [deliverable("Counters/Counter 01.aep", { codec: undefined, width: undefined, height: undefined, fps: undefined, probed: false, bytes: 1_100_000 })],
      preview: { relPath: "Counters/Preview.mp4", bytes: 12_000_000, mtimeMs: 1_757_000_000_000 },
      status: "draft",
      comp: { compName: "Counter 01", fps: 25, width: 1920, height: 1080, duration: 1.8 },
    }),
  ];

  return { schemaVersion: INDEX_SCHEMA_VERSION, libraryRoot, scannedAt: NOW, assets, fingerprints: {} };
}

/** Forty-plus cards, for the "one video element" performance tests. */
export function largeIndex(count = 48): LibraryIndex {
  const base = sampleIndex();
  const categories: { c: Category; f: string }[] = [
    { c: "transitions", f: "Transitions" },
    { c: "backgrounds", f: "Backgrounds - خلفيات" },
    { c: "3d", f: "3D" },
    { c: "illustrations", f: "Illustrations" },
  ];
  for (let i = base.assets.length; i < count; i++) {
    const { c, f } = categories[i % categories.length]!;
    base.assets.push(
      assetFixture({
        id: `${c}/generated-${i}`,
        name: `Generated ${i}`,
        category: c,
        categoryFolder: f,
        tags: ["alpha"],
        deliverables: [deliverable(`${f}/Generated ${i}/Generated ${i}_H_ALPHA.mov`, { orientation: "H" })],
      }),
    );
  }
  return base;
}
