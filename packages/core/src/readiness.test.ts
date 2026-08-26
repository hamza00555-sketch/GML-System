import { describe, expect, it } from "vitest";
import { assetReadiness } from "./readiness.js";
import { audioFixture, motionFixture } from "./fixtures.js";

const needsPlugin = motionFixture({
  dependencies: { footage: "bundled", fonts: [], plugins: [{ name: "Deep Glow", matchName: "Plugin Deep Glow" }] },
});
const needsFont = motionFixture({
  dependencies: { footage: "bundled", fonts: ["DINNextLTArabic-Regular"], plugins: [] },
});

describe("asset readiness", () => {
  it("reports a plain asset as safe", () => {
    expect(assetReadiness(motionFixture(), { fonts: [], effectMatchNames: [] }).status).toBe("safe");
  });

  it("reports a missing plugin", () => {
    const r = assetReadiness(needsPlugin, { fonts: [], effectMatchNames: [] });
    expect(r.status).toBe("requires-plugin");
    expect(r.missingPlugins).toEqual(["Deep Glow"]);
  });

  it("reports a missing font", () => {
    const r = assetReadiness(needsFont, { fonts: [], effectMatchNames: [] });
    expect(r.status).toBe("requires-font");
    expect(r.missingFonts).toEqual(["DINNextLTArabic-Regular"]);
  });

  it("is satisfied once the dependency is installed", () => {
    expect(
      assetReadiness(needsPlugin, { fonts: [], effectMatchNames: ["Plugin Deep Glow"] }).status,
    ).toBe("safe");
    expect(
      assetReadiness(needsFont, { fonts: ["DINNextLTArabic-Regular"], effectMatchNames: [] }).status,
    ).toBe("safe");
  });

  it("ranks a missing plugin above a missing font", () => {
    const both = motionFixture({
      dependencies: {
        footage: "bundled",
        fonts: ["Missing Font"],
        plugins: [{ name: "Deep Glow", matchName: "Plugin Deep Glow" }],
      },
    });
    expect(assetReadiness(both, { fonts: [], effectMatchNames: [] }).status).toBe("requires-plugin");
  });

  it("claims nothing when the host cannot report what is installed", () => {
    expect(assetReadiness(needsPlugin).status).toBe("safe");
  });

  it("treats audio as always safe — it has no fonts or effects", () => {
    expect(assetReadiness(audioFixture(), { fonts: [], effectMatchNames: [] }).status).toBe("safe");
  });
});
