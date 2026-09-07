import { describe, expect, it } from "vitest";
import { sampleIndex, largeIndex } from "./fixtures.js";
import { assetKey, deliverableLabel, formatBytes, parseIndex, primaryDeliverable, safeParseIndex } from "./library.js";
import { assetReadiness } from "./readiness.js";
import { normalize, normalizeDigits, searchAssets } from "./search.js";

describe("index schema", () => {
  it("accepts the sample index and a 48-asset index", () => {
    expect(() => parseIndex(sampleIndex())).not.toThrow();
    expect(parseIndex(largeIndex()).assets.length).toBe(48);
  });

  it("rejects absolute and backslash paths — the index must stay portable", () => {
    const index = sampleIndex();
    index.assets[0]!.deliverables[0]!.relPath = "G:\\Shared drives\\x.mov";
    expect(safeParseIndex(index).success).toBe(false);
    index.assets[0]!.deliverables[0]!.relPath = "/abs/x.mov";
    expect(safeParseIndex(index).success).toBe(false);
  });

  it("rejects an id that is not slug/slug", () => {
    const index = sampleIndex();
    index.assets[0]!.id = "Transitions/Arrows";
    expect(safeParseIndex(index).success).toBe(false);
  });

  it("keys cached copies by id and integer version", () => {
    expect(assetKey("3d/coin", 2)).toBe("3d/coin@v2");
  });
});

describe("deliverables", () => {
  it("prefers the horizontal variant as primary", () => {
    const arrows = sampleIndex().assets.find((a) => a.id === "transitions/arrows")!;
    expect(primaryDeliverable(arrows).orientation).toBe("H");
  });

  it("labels variants by direction and orientation, else by file name", () => {
    const arrows = sampleIndex().assets.find((a) => a.id === "transitions/arrows")!;
    expect(deliverableLabel(arrows.deliverables[0]!)).toBe("Down · Horizontal");
    const people = sampleIndex().assets.find((a) => a.id === "illustrations/people")!;
    expect(deliverableLabel(people.deliverables[0]!)).toBe("1");
  });

  it("formats sizes for badges", () => {
    expect(formatBytes(2_700_000_000)).toBe("2.5 GB");
    expect(formatBytes(20_983_732)).toBe("20 MB");
  });
});

describe("readiness over requires", () => {
  const index = sampleIndex();
  const fadeUp = index.assets.find((a) => a.id === "animated-texts/all-preview/fade-up")!;
  const typewriter = index.assets.find((a) => a.id === "animated-texts/all-preview/typewriter")!;
  const arrows = index.assets.find((a) => a.id === "transitions/arrows")!;

  it("rendered video is always safe", () => {
    expect(assetReadiness(arrows, { fonts: [], effectMatchNames: [] }).status).toBe("safe");
  });

  it("flags a missing font, and ignores native effects", () => {
    const r = assetReadiness(fadeUp, { fonts: [], effectMatchNames: [] });
    expect(r.status).toBe("requires-font");
    expect(r.missingPlugins).toEqual([]);
  });

  it("flags a third-party effect that is not installed", () => {
    expect(assetReadiness(typewriter, { fonts: [], effectMatchNames: ["ADBE Gaussian Blur 2"] }).status).toBe("requires-plugin");
    expect(assetReadiness(typewriter, { fonts: [], effectMatchNames: ["Plugin Deep Glow"] }).status).toBe("safe");
  });

  it("claims nothing without an inventory", () => {
    expect(assetReadiness(fadeUp).status).toBe("safe");
  });
});

describe("search", () => {
  const assets = sampleIndex().assets;

  it("normalises Arabic-Indic digits so 62 finds ٦٢", () => {
    expect(normalizeDigits("Gosi Illustarions-٦٢")).toBe("Gosi Illustarions-62");
    expect(normalize("أزرق")).toBe(normalize("ازرق"));
  });

  it("matches names, Arabic names and parsed tags", () => {
    expect(searchAssets(assets, { query: "arrow" }).map((a) => a.id)).toEqual(
      expect.arrayContaining(["transitions/arrows", "transitions/angeled-arrow"]),
    );
    expect(searchAssets(assets, { query: "ازرق" })[0]?.id).toBe("backgrounds/dark-blue");
    expect(searchAssets(assets, { query: "TRA", category: "transitions" }).map((a) => a.id)).toEqual(
      expect.arrayContaining(["transitions/arrows", "transitions/angeled-arrow"]),
    );
  });

  it("filters by category and favourites", () => {
    expect(searchAssets(assets, { category: "counters" }).map((a) => a.id)).toEqual(["counters/counter-01"]);
    expect(searchAssets(assets, { onlyFavorites: true, favorites: new Set(["3d/coin"]) }).map((a) => a.id)).toEqual(["3d/coin"]);
  });
});
