import { describe, expect, it } from "vitest";
import { decodeStamp, encodeStamp, findStamp, stampsMatch } from "./stamp.js";

describe("traceability stamp", () => {
  it("round-trips a path-shaped id and an integer version", () => {
    const encoded = encodeStamp("transitions/arrows", 3);
    expect(encoded).toBe("gml:transitions/arrows@v3");
    expect(decodeStamp(encoded)).toEqual({ id: "transitions/arrows", version: 3 });
  });

  it("returns null for anything that is not a stamp", () => {
    for (const value of ["", null, undefined, "gml:bad", "notastamp", "gml:x@1.2.0", "gml:X/y@v1"]) {
      expect(decodeStamp(value)).toBeNull();
    }
  });

  it("finds a stamp sitting alongside a designer's own note", () => {
    const found = findStamp("hero title gml:animated-texts/all-preview/fade-up@v2 needs review");
    expect(found).toEqual({ id: "animated-texts/all-preview/fade-up", version: 2 });
  });

  it("distinguishes same id at different versions", () => {
    const a = decodeStamp("gml:3d/coin@v1")!;
    const b = decodeStamp("gml:3d/coin@v2")!;
    expect(a.id).toBe(b.id);
    expect(stampsMatch(a, b)).toBe(false);
  });
});
