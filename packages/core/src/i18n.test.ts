import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, assetName, directionFor, formatDuration, t } from "./i18n.js";
import { assetFixture } from "./fixtures.js";

describe("locale", () => {
  it("defaults to English", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(t("apply")).toBe("Apply");
  });

  it("translates chrome to Arabic on request", () => {
    expect(t("apply", "ar")).toBe("تطبيق");
    expect(t("search", "ar")).toBe("بحث");
  });

  it("maps Arabic to right-to-left and English to left-to-right", () => {
    expect(directionFor("ar")).toBe("rtl");
    expect(directionFor("en")).toBe("ltr");
  });
});

describe("asset names", () => {
  it("picks the name for the active locale", () => {
    const asset = assetFixture({ id: "x/y", name: "Fade Up Title", nameAr: "عنوان يظهر للأعلى", category: "transitions" });
    expect(assetName(asset, "en")).toBe("Fade Up Title");
    expect(assetName(asset, "ar")).toBe("عنوان يظهر للأعلى");
  });

  it("falls back to the other locale when one side is blank", () => {
    expect(assetName({ name: "Fade Up Title" }, "ar")).toBe("Fade Up Title");
    expect(assetName({ name: " ", nameAr: "عنوان يظهر للأعلى" }, "en")).toBe("عنوان يظهر للأعلى");
  });
});

describe("duration formatting", () => {
  it("shows seconds below a minute", () => {
    expect(formatDuration(2.5)).toBe("2.5s");
    expect(formatDuration(2)).toBe("2s");
  });

  it("shows minutes and seconds above a minute", () => {
    expect(formatDuration(95)).toBe("1:35");
  });
});
