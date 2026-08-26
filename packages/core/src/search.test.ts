import { describe, expect, it } from "vitest";
import { normalize, searchAssets } from "./search.js";
import { audioFixture, motionFixture, sampleLibrary } from "./fixtures.js";

describe("normalisation", () => {
  it("folds Arabic alef, ya, taa marbuta and diacritics to one form", () => {
    expect(normalize("أنيميشن")).toBe(normalize("انيميشن"));
    expect(normalize("مكتبة")).toBe(normalize("مكتبه"));
    expect(normalize("عَنْوان")).toBe(normalize("عنوان"));
    expect(normalize("انتقــال")).toBe(normalize("انتقال"));
  });

  it("lowercases Latin and collapses punctuation", () => {
    expect(normalize("Fade-Up  Title!")).toBe("fade up title");
  });
});

describe("searching the library", () => {
  const library = sampleLibrary();

  it("matches English names", () => {
    const hits = searchAssets(library, { query: "counter" });
    expect(hits.map((a) => a.id)).toContain("gml_counter-up");
  });

  it("matches Arabic names regardless of alef spelling", () => {
    const hits = searchAssets(library, { query: "انتقال" });
    expect(hits.map((a) => a.id)).toContain("gml_wipe-diagonal");
  });

  it("matches tags", () => {
    const hits = searchAssets(library, { query: "loop" });
    expect(hits.map((a) => a.id)).toContain("gml_grid-bg");
  });

  it("requires every term to land somewhere", () => {
    expect(searchAssets(library, { query: "counter zzzz" })).toHaveLength(0);
  });

  it("ranks a name prefix above a tag match", () => {
    const assets = [
      motionFixture({ id: "gml_tagged", nameEn: "Something", tags: ["wave"] }),
      motionFixture({ id: "gml_named", nameEn: "Wave Motion", tags: [] }),
    ];
    expect(searchAssets(assets, { query: "wave" })[0]?.id).toBe("gml_named");
  });

  it("filters to a single category", () => {
    const hits = searchAssets(library, { category: "audio" });
    expect(hits.every((a) => a.assetType === "audio")).toBe(true);
  });

  it("hides whole categories — Illustrator hides audio", () => {
    const hits = searchAssets(library, { hiddenCategories: ["audio"] });
    expect(hits.some((a) => a.category === "audio")).toBe(false);
    expect(hits.length).toBeGreaterThan(0);
  });

  it("does not leak a hidden category even when explicitly requested", () => {
    const hits = searchAssets(library, {
      category: "audio",
      hiddenCategories: ["audio"],
    });
    expect(hits).toHaveLength(0);
  });

  it("filters to favourites", () => {
    const favorites = new Set(["gml_fade-up"]);
    const hits = searchAssets(library, { favorites, onlyFavorites: true });
    expect(hits.map((a) => a.id)).toEqual(["gml_fade-up"]);
  });

  it("returns everything when no query or filter is given", () => {
    expect(searchAssets(library)).toHaveLength(library.length);
  });

  it("searches audio assets by kind tag", () => {
    const hits = searchAssets([audioFixture()], { query: "ui" });
    expect(hits).toHaveLength(1);
  });
});
