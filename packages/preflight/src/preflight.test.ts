import { describe, expect, it } from "vitest";
import {
  classifyFootage,
  detectSequencePattern,
  planCollect,
  relinkMethodFor,
} from "./classify.js";
import { checkPortability, isInside, normalizePath } from "./portability.js";
import { preflight, preflightAfterCollect, preflightBeforeCollect, thirdPartyEffects } from "./rules.js";
import type { FootageSnapshot, ProjectSnapshot } from "./types.js";

const PKG = "/tmp/gml/gml_fade-up";

function footage(over: Partial<FootageSnapshot> = {}): FootageSnapshot {
  return {
    itemId: 1,
    name: "clip",
    sourceKind: "file",
    filePath: `${PKG}/footage/bg.mp4`,
    isStill: false,
    hasVideo: true,
    hasAudio: false,
    hasProxy: false,
    ...over,
  };
}

function snapshot(over: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    projectPath: "/work/promo.aep",
    projectDirty: false,
    compName: "GML_fade-up",
    compNames: ["GML_fade-up", "Other"],
    aeVersion: "25.0",
    footage: [footage()],
    fonts: [],
    effectMatchNames: ["ADBE Gaussian Blur 2"],
    ...over,
  };
}

describe("footage classification", () => {
  it("treats an audio-only file as a single file", () => {
    const item = footage({
      filePath: `${PKG}/footage/vo.wav`,
      hasVideo: false,
      hasAudio: true,
    });
    expect(classifyFootage(item)).toBe("audio");
    expect(relinkMethodFor("audio")).toBe("replace");
  });

  it("treats a video file as a single file", () => {
    expect(classifyFootage(footage({ filePath: `${PKG}/footage/bg.mp4` }))).toBe("video");
    expect(classifyFootage(footage({ filePath: `${PKG}/footage/bg.mov` }))).toBe("video");
  });

  it("treats a still image as a single file", () => {
    const item = footage({ filePath: `${PKG}/footage/logo.png`, isStill: true });
    expect(classifyFootage(item)).toBe("still");
  });

  it("only calls it a sequence when neighbouring frames confirm the pattern", () => {
    const siblings = ["seq_0001.png", "seq_0002.png", "seq_0003.png"];
    const item = footage({
      filePath: `${PKG}/footage/seq_0001.png`,
      siblingNames: siblings,
    });
    expect(classifyFootage(item)).toBe("sequence");
    expect(relinkMethodFor("sequence")).toBe("replaceWithSequence");
  });

  it("recognises an EXR sequence", () => {
    const item = footage({
      filePath: `${PKG}/footage/render_0100.exr`,
      siblingNames: ["render_0100.exr", "render_0101.exr"],
    });
    expect(classifyFootage(item)).toBe("sequence");
  });

  it("does not call a lone numbered image a sequence", () => {
    const item = footage({
      filePath: `${PKG}/footage/shot_01.png`,
      siblingNames: ["shot_01.png", "notes.txt"],
    });
    expect(classifyFootage(item)).not.toBe("sequence");
  });

  it("never mistakes a video for a sequence just because isStill is false", () => {
    const item = footage({
      filePath: `${PKG}/footage/bg_0001.mp4`,
      siblingNames: ["bg_0001.mp4", "bg_0002.mp4"],
    });
    expect(classifyFootage(item)).toBe("video");
  });

  it("ignores solids and flags placeholders as missing", () => {
    expect(classifyFootage(footage({ sourceKind: "solid", filePath: undefined }))).toBe("solid");
    expect(classifyFootage(footage({ sourceKind: "placeholder", filePath: undefined }))).toBe("missing");
    expect(classifyFootage(footage({ missingFootagePath: "/gone/logo.ai" }))).toBe("missing");
  });
});

describe("sequence pattern detection", () => {
  it("captures prefix, suffix, padding and every member", () => {
    const p = detectSequencePattern("seq_0001.png", [
      "seq_0001.png",
      "seq_0002.png",
      "other.png",
    ]);
    expect(p).not.toBeNull();
    expect(p!.prefix).toBe("seq_");
    expect(p!.suffix).toBe(".png");
    expect(p!.digits).toBe(4);
    expect(p!.members).toEqual(["seq_0001.png", "seq_0002.png"]);
  });

  it("does not mix different padding widths", () => {
    const p = detectSequencePattern("f_001.png", ["f_001.png", "f_0002.png"]);
    expect(p).toBeNull();
  });

  it("returns null for an unnumbered name", () => {
    expect(detectSequencePattern("logo.png", ["logo.png", "logo2.png"])).toBeNull();
  });
});

describe("collect planning", () => {
  it("copies a whole sequence, not just the first frame", () => {
    const plan = planCollect([
      footage({
        filePath: "/src/seq_0001.png",
        siblingNames: ["seq_0001.png", "seq_0002.png", "seq_0003.png"],
      }),
    ]);
    expect(plan[0]!.method).toBe("replaceWithSequence");
    expect(plan[0]!.filesToCopy).toEqual([
      "/src/seq_0001.png",
      "/src/seq_0002.png",
      "/src/seq_0003.png",
    ]);
  });

  it("copies exactly one file for video, audio and stills", () => {
    const plan = planCollect([
      footage({ itemId: 1, filePath: "/src/bg.mp4" }),
      footage({ itemId: 2, filePath: "/src/vo.wav", hasVideo: false, hasAudio: true }),
      footage({ itemId: 3, filePath: "/src/logo.png", isStill: true }),
    ]);
    expect(plan.map((e) => e.filesToCopy.length)).toEqual([1, 1, 1]);
    expect(plan.every((e) => e.method === "replace")).toBe(true);
  });

  it("copies nothing for a solid", () => {
    const plan = planCollect([footage({ sourceKind: "solid", filePath: undefined })]);
    expect(plan[0]!.filesToCopy).toEqual([]);
    expect(plan[0]!.method).toBe("none");
  });
});

describe("path containment", () => {
  it("compares case-insensitively by default", () => {
    expect(isInside("/Pkg", "/pkg/footage/a.png")).toBe(true);
  });

  it("can compare case-sensitively for Linux", () => {
    expect(isInside("/Pkg", "/pkg/a.png", { caseInsensitive: false })).toBe(false);
  });

  it("normalises Windows separators", () => {
    expect(isInside("C:\\pkg", "C:\\pkg\\footage\\a.png")).toBe(true);
    expect(normalizePath("C:\\pkg\\a")).toBe("c:/pkg/a");
  });

  it("does not treat a sibling folder with a shared prefix as inside", () => {
    expect(isInside("/pkg", "/pkg-other/a.png")).toBe(false);
  });

  it("resolves symlinks before comparing", () => {
    const realPath = (p: string) => p.replace("/link", "/pkg");
    expect(isInside("/pkg", "/link/footage/a.png", { realPath })).toBe(true);
  });
});

describe("phase A — before collect", () => {
  it("blocks an unsaved project", () => {
    const r = preflightBeforeCollect(snapshot({ projectPath: null }));
    expect(r.ok).toBe(false);
    expect(r.blockers.map((b) => b.code)).toContain("project-unsaved");
  });

  it("blocks a project with unsaved changes", () => {
    const r = preflightBeforeCollect(snapshot({ projectDirty: true }));
    expect(r.blockers.map((b) => b.code)).toContain("project-dirty");
  });

  it("blocks a duplicated comp name", () => {
    const r = preflightBeforeCollect(
      snapshot({ compNames: ["GML_fade-up", "GML_fade-up"] }),
    );
    expect(r.blockers.map((b) => b.code)).toContain("comp-name-duplicate");
  });

  it("blocks missing footage and names the file", () => {
    const r = preflightBeforeCollect(
      snapshot({ footage: [footage({ name: "logo.ai", missingFootagePath: "/gone/logo.ai" })] }),
    );
    expect(r.ok).toBe(false);
    const finding = r.blockers.find((b) => b.code === "footage-missing");
    expect(finding?.message).toContain("logo.ai");
  });

  it("accepts external footage at this stage — collect has not run yet", () => {
    const r = preflightBeforeCollect(
      snapshot({ footage: [footage({ filePath: "/Users/designer/Desktop/bg.mov" })] }),
    );
    expect(r.ok).toBe(true);
  });
});

describe("phase B — final portability check", () => {
  it("passes when every required file sits inside the package", () => {
    const r = preflightAfterCollect({ snapshot: snapshot(), packageRoot: PKG });
    expect(r.ok).toBe(true);
  });

  it("blocks — never warns — on footage left outside the package", () => {
    const r = preflightAfterCollect({
      snapshot: snapshot({ footage: [footage({ filePath: "/Users/designer/Desktop/bg.mov" })] }),
      packageRoot: PKG,
    });
    expect(r.ok).toBe(false);
    const codes = r.blockers.map((b) => b.code);
    expect(codes).toContain("footage-outside-package");
    expect(r.warnings.map((w) => w.code)).not.toContain("footage-outside-package");
  });

  it("blocks a Windows desktop path too", () => {
    const r = checkPortability(
      [footage({ filePath: "C:\\Users\\Designer\\Desktop\\logo.ai" })],
      PKG,
    );
    expect(r.ok).toBe(false);
    expect(r.external).toHaveLength(1);
  });

  it("blocks a proxy that survived collect", () => {
    const r = preflightAfterCollect({
      snapshot: snapshot({ footage: [footage({ hasProxy: true })] }),
      packageRoot: PKG,
    });
    expect(r.blockers.map((b) => b.code)).toContain("proxy-present");
  });

  it("ignores solids, which have no file to keep inside", () => {
    const r = checkPortability(
      [footage({ sourceKind: "solid", filePath: undefined })],
      PKG,
    );
    expect(r.ok).toBe(true);
  });

  it("warns but does not block on fonts and third-party plugins", () => {
    const r = preflightAfterCollect({
      snapshot: snapshot({
        fonts: ["DINNextLTArabic-Regular"],
        effectMatchNames: ["ADBE Gaussian Blur 2", "Plugin Deep Glow"],
      }),
      packageRoot: PKG,
      installedFonts: [],
    });
    expect(r.ok).toBe(true);
    const codes = r.warnings.map((w) => w.code);
    expect(codes).toContain("font-required");
    expect(codes).toContain("plugin-required");
  });

  it("does not warn about a font the machine already has", () => {
    const r = preflightAfterCollect({
      snapshot: snapshot({ fonts: ["DINNextLTArabic-Regular"] }),
      packageRoot: PKG,
      installedFonts: ["DINNextLTArabic-Regular"],
    });
    expect(r.warnings.map((w) => w.code)).not.toContain("font-required");
  });

  it("identifies third-party effects by their non-ADBE matchName", () => {
    expect(
      thirdPartyEffects(["ADBE Gaussian Blur 2", "Plugin Deep Glow", "ADBE Glo2"]),
    ).toEqual(["Plugin Deep Glow"]);
  });
});

describe("combined preflight", () => {
  it("does not run the portability check while phase A is still failing", () => {
    const r = preflight({
      snapshot: snapshot({ projectPath: null, footage: [footage({ filePath: "/elsewhere/a.mp4" })] }),
      packageRoot: PKG,
    });
    expect(r.ok).toBe(false);
    expect(r.blockers.map((b) => b.code)).toEqual(["project-unsaved"]);
  });

  it("reports a clean asset as ready to publish", () => {
    const r = preflight({ snapshot: snapshot(), packageRoot: PKG, installedFonts: [] });
    expect(r.ok).toBe(true);
    expect(r.blockers).toEqual([]);
  });
});
