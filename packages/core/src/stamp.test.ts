import { describe, expect, it } from "vitest";
import { decodeStamp, encodeStamp, findStamp, stampsMatch } from "./stamp.js";

describe("traceability stamp", () => {
  it("round-trips id and version", () => {
    const encoded = encodeStamp("gml_fade-up", "1.2.0");
    expect(encoded).toBe("gml:gml_fade-up@1.2.0");
    expect(decodeStamp(encoded)).toEqual({ id: "gml_fade-up", version: "1.2.0" });
  });

  it("returns null for anything that is not a stamp", () => {
    for (const value of ["", null, undefined, "gml:bad", "notastamp", "gml:x@1.2"]) {
      expect(decodeStamp(value)).toBeNull();
    }
  });

  it("finds a stamp sitting alongside a designer's own note", () => {
    const found = findStamp("hero title gml:gml_fade-up@1.2.0 needs review");
    expect(found).toEqual({ id: "gml_fade-up", version: "1.2.0" });
  });

  it("distinguishes same id at different versions", () => {
    const a = decodeStamp("gml:gml_fade-up@1.1.0")!;
    const b = decodeStamp("gml:gml_fade-up@1.3.0")!;
    expect(a.id).toBe(b.id);
    expect(stampsMatch(a, b)).toBe(false);
  });
});
