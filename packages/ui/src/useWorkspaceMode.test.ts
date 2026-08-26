import { describe, expect, it } from "vitest";
import { BREAKPOINTS, HYSTERESIS, resolveMode } from "./useWorkspaceMode.js";

describe("workspace mode", () => {
  it("picks the mode from width on first measure", () => {
    expect(resolveMode(260, null)).toBe("compact");
    expect(resolveMode(400, null)).toBe("standard");
    expect(resolveMode(800, null)).toBe("explorer");
  });

  it("uses the documented breakpoints", () => {
    expect(resolveMode(BREAKPOINTS.compact - 1, null)).toBe("compact");
    expect(resolveMode(BREAKPOINTS.compact, null)).toBe("standard");
    expect(resolveMode(BREAKPOINTS.standard, null)).toBe("explorer");
  });

  describe("hysteresis", () => {
    it("holds the mode while the width wobbles around a breakpoint", () => {
      for (const width of [640, 645, 650, 655, 660]) {
        expect(resolveMode(width, "standard")).toBe("standard");
      }
    });

    it("switches up once the width clears the boundary by the dead band", () => {
      expect(resolveMode(BREAKPOINTS.standard + HYSTERESIS, "standard")).toBe("explorer");
    });

    it("holds explorer while shrinking back through the boundary", () => {
      for (const width of [660, 650, 645, 640]) {
        expect(resolveMode(width, "explorer")).toBe("explorer");
      }
      expect(resolveMode(BREAKPOINTS.standard - HYSTERESIS - 1, "explorer")).toBe("standard");
    });

    it("applies the same dead band at the compact boundary", () => {
      expect(resolveMode(285, "compact")).toBe("compact");
      expect(resolveMode(BREAKPOINTS.compact + HYSTERESIS, "compact")).toBe("standard");
      expect(resolveMode(270, "standard")).toBe("standard");
      expect(resolveMode(BREAKPOINTS.compact - HYSTERESIS - 1, "standard")).toBe("compact");
    });

    it("jumps straight to the right mode on a large resize", () => {
      expect(resolveMode(900, "compact")).toBe("explorer");
      expect(resolveMode(100, "explorer")).toBe("compact");
    });

    it("never oscillates: re-resolving its own answer is stable", () => {
      for (const width of [100, 279, 280, 400, 649, 650, 900]) {
        const first = resolveMode(width, null);
        expect(resolveMode(width, first)).toBe(first);
      }
    });
  });
});
