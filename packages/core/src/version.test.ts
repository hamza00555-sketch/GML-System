import { describe, expect, it } from "vitest";
import {
  compareVersions,
  decideVersionAction,
  relateVersions,
  versionedCompName,
} from "./version.js";

describe("version comparison", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.10", "1.2.9")).toBeGreaterThan(0);
  });

  it("rejects malformed versions loudly", () => {
    expect(() => compareVersions("1.2", "1.2.3")).toThrow();
  });
});

describe("project vs library version", () => {
  it("flags the library being ahead", () => {
    expect(relateVersions("1.1.0", "1.3.0")).toBe("library-newer");
  });

  it("never warns when versions match", () => {
    const d = decideVersionAction("1.2.0", "1.2.0");
    expect(d.requiresWarning).toBe(false);
    expect(d.choices).toEqual(["use-existing"]);
  });

  it("warns and offers both non-destructive choices, never a silent update", () => {
    const d = decideVersionAction("1.1.0", "1.3.0");
    expect(d.relation).toBe("library-newer");
    expect(d.requiresWarning).toBe(true);
    expect(d.choices).toEqual(["use-existing", "import-newer-separately"]);
    expect(d.choices).not.toContain("update-in-place");
  });

  it("names a separately imported version distinctly", () => {
    expect(versionedCompName("GML_fade-up", "1.3.0")).toBe("GML_fade-up_v1.3.0");
  });
});
