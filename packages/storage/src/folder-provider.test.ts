import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { motionFixture } from "@gml/core";
import type { GmlAsset } from "@gml/core";
import { MemoryFs, hashesFrom } from "./fs.js";
import { FolderLibraryProvider } from "./folder-provider.js";
import { PublishVerificationError } from "./provider.js";
import { pathToFileUrl } from "./file-url.js";
import { findDriveMounts, findLibraryCandidates } from "./drive-detect.js";

const hashes = hashesFrom({ createHash });
const bytes = (s: string) => new TextEncoder().encode(s);

function makeProvider(now = () => 1_000_000) {
  const fs = new MemoryFs();
  fs.mkdir("/lib");
  const provider = new FolderLibraryProvider({ root: "/lib", fs, hashes, now, idFactory: () => "u1" });
  return { fs, provider };
}

/** Publishes a minimal motion package through the staged protocol. */
async function publish(provider: FolderLibraryProvider, over: Partial<GmlAsset> = {}) {
  const template = motionFixture(over as never);
  const handle = await provider.beginPublish(template.id, template.version);
  const files = {
    "source.aep": provider.stageBytes(handle, "source.aep", bytes(`aep-${template.id}`)),
    "preview.mp4": provider.stageBytes(handle, "preview.mp4", bytes("mp4")),
    "poster.png": provider.stageBytes(handle, "poster.png", bytes("png")),
  };
  const meta: GmlAsset = {
    ...template,
    previewGif: undefined,
    assets: Object.fromEntries(
      Object.entries(files).map(([p, f]) => [p, { bytes: f.bytes, sha256: f.sha256, md5: f.md5 }]),
    ),
  };
  return provider.finalizePublish(handle, meta);
}

describe("FolderLibraryProvider", () => {
  it("lists nothing from an empty or unstructured folder", async () => {
    const { provider } = makeProvider();
    expect((await provider.list()).items).toEqual([]);
  });

  it("publishes through staging and lands in drafts/<id> with meta.json written last", async () => {
    const { fs, provider } = makeProvider();
    const asset = await publish(provider, { status: "draft" });

    expect(fs.exists("/lib/drafts/gml_fade-up/meta.json")).toBe(true);
    expect(fs.exists("/lib/drafts/gml_fade-up/source.aep")).toBe(true);
    expect(fs.readdir("/lib/_staging")).toEqual([]);
    expect(asset.status).toBe("draft");

    const listed = await provider.list();
    expect(listed.items.map((a) => a.id)).toEqual(["gml_fade-up"]);
    expect(provider.packagePath("gml_fade-up", "1.0.0")).toBe("/lib/drafts/gml_fade-up");
  });

  it("an approved publish lands in approved/", async () => {
    const { fs, provider } = makeProvider();
    await publish(provider, { status: "approved" });
    expect(fs.exists("/lib/approved/gml_fade-up/meta.json")).toBe(true);
    expect(fs.exists("/lib/drafts/gml_fade-up")).toBe(false);
  });

  it("ignores a folder without meta.json — an interrupted publish is never an asset", async () => {
    const { fs, provider } = makeProvider();
    fs.writeFile("/lib/drafts/gml_half/source.aep", bytes("x"));
    fs.mkdir("/lib/_staging/gml_other-1.0.0-abc");
    fs.writeFile("/lib/_staging/gml_other-1.0.0-abc/meta.json", JSON.stringify(motionFixture()));
    expect((await provider.list()).items).toEqual([]);
  });

  it("reports an invalid meta.json as a problem instead of throwing", async () => {
    const { fs, provider } = makeProvider();
    fs.writeFile("/lib/drafts/gml_bad/meta.json", "{not json");
    fs.writeFile("/lib/drafts/gml_bad2/meta.json", JSON.stringify({ id: "nope" }));
    expect((await provider.list()).items).toEqual([]);
    expect(provider.problems.map((p) => p.path).sort()).toEqual(["/lib/drafts/gml_bad", "/lib/drafts/gml_bad2"]);
  });

  it("refuses to finalize when a staged file does not match the manifest", async () => {
    const { fs, provider } = makeProvider();
    const template = motionFixture();
    const handle = await provider.beginPublish(template.id, template.version);
    const src = provider.stageBytes(handle, "source.aep", bytes("aep"));
    const mp4 = provider.stageBytes(handle, "preview.mp4", bytes("mp4"));
    const png = provider.stageBytes(handle, "poster.png", bytes("png"));
    const meta: GmlAsset = {
      ...template,
      previewGif: undefined,
      assets: {
        "source.aep": { bytes: src.bytes, sha256: src.sha256, md5: src.md5 },
        "preview.mp4": { bytes: mp4.bytes, sha256: mp4.sha256, md5: mp4.md5 },
        "poster.png": { bytes: png.bytes, sha256: png.sha256, md5: png.md5 },
      },
    };
    // Simulate a truncated write after hashing.
    fs.writeFile("/lib/_staging/gml_fade-up-1.0.0-u1/source.aep", bytes("ae"));

    await expect(provider.finalizePublish(handle, meta)).rejects.toBeInstanceOf(PublishVerificationError);
    expect(fs.exists("/lib/drafts/gml_fade-up")).toBe(false);
    expect((await provider.list()).items).toEqual([]);

    await provider.abortPublish(handle);
    expect(fs.exists("/lib/_staging/gml_fade-up-1.0.0-u1")).toBe(false);
  });

  it("the folder decides the status: meta.json claiming approved inside drafts/ is a draft", async () => {
    const { fs, provider } = makeProvider();
    await publish(provider, { status: "draft" });
    const metaPath = "/lib/drafts/gml_fade-up/meta.json";
    const meta = JSON.parse(new TextDecoder().decode(fs.readFile(metaPath))) as GmlAsset;
    fs.writeFile(metaPath, JSON.stringify({ ...meta, status: "approved" }));
    expect((await provider.get("gml_fade-up")).status).toBe("draft");
  });

  it("approval is a folder move visible to every synced machine", async () => {
    const { fs, provider } = makeProvider();
    await publish(provider, { status: "draft" });
    const approved = await provider.setStatus("gml_fade-up", "approved");
    expect(approved.status).toBe("approved");
    expect(fs.exists("/lib/approved/gml_fade-up/meta.json")).toBe(true);
    expect(fs.exists("/lib/drafts/gml_fade-up")).toBe(false);
    expect((await provider.get("gml_fade-up")).status).toBe("approved");
  });

  it("republishing an id replaces the previous package rather than duplicating it", async () => {
    const { fs, provider } = makeProvider();
    await publish(provider, { status: "draft" });
    await publish(provider, { status: "approved", version: "1.1.0" });
    expect(fs.exists("/lib/drafts/gml_fade-up")).toBe(false);
    const items = (await provider.list()).items;
    expect(items).toHaveLength(1);
    expect(items[0]!.version).toBe("1.1.0");
  });

  it("fetchPackage returns the package path and detects a half-synced file", async () => {
    const { fs, provider } = makeProvider();
    await publish(provider, { status: "approved" });
    expect(await provider.fetchPackage("gml_fade-up", "1.0.0")).toBe("/lib/approved/gml_fade-up");

    fs.writeFile("/lib/approved/gml_fade-up/source.aep", bytes("trunc"));
    await expect(provider.fetchPackage("gml_fade-up", "1.0.0")).rejects.toThrow(/incomplete/);
  });

  it("sees a package another machine synced in, without a restart", async () => {
    const { fs, provider } = makeProvider();
    expect((await provider.list()).items).toEqual([]);
    // A colleague's publish arrives via Drive sync.
    const other = new FolderLibraryProvider({ root: "/lib", fs, hashes, idFactory: () => "u2" });
    await publish(other, { status: "approved" });
    expect((await provider.list()).items.map((a) => a.id)).toEqual(["gml_fade-up"]);
  });

  it("stages a file from a path and returns its digests", async () => {
    const { fs, provider } = makeProvider();
    fs.writeFile("/Users/d/project.aep", bytes("real project"));
    const handle = await provider.beginPublish("gml_x", "1.0.0");
    const staged = provider.stageFileFromPath(handle, "source.aep", "/Users/d/project.aep");
    expect(staged.bytes).toBe(12);
    expect(staged.sha256).toBe(createHash("sha256").update("real project").digest("hex"));
    expect(fs.exists("/lib/_staging/gml_x-1.0.0-u1/source.aep")).toBe(true);
  });

  it("garbage-collects stale staging folders", async () => {
    let t = 0;
    const { fs, provider } = makeProvider(() => t);
    await provider.beginPublish("gml_old", "1.0.0");
    t = 48 * 60 * 60 * 1000;
    const dropped = await provider.collectGarbage();
    expect(dropped).toEqual(["gml_old-1.0.0-u1"]);
    expect(fs.readdir("/lib/_staging")).toEqual([]);
  });
});

describe("file URLs", () => {
  it("converts POSIX and Windows paths", () => {
    expect(pathToFileUrl("/Users/d/Shared drives/GML/poster.png")).toBe(
      "file:///Users/d/Shared%20drives/GML/poster.png",
    );
    expect(pathToFileUrl("G:\\Shared drives\\GML_Library\\approved\\x\\poster.png")).toBe(
      "file:///G:/Shared%20drives/GML_Library/approved/x/poster.png",
    );
    expect(pathToFileUrl("\\\\server\\share\\a.png")).toBe("file://server/share/a.png");
  });
});

describe("Drive for Desktop detection", () => {
  it("finds the macOS CloudStorage mount and an existing library inside a Shared Drive", () => {
    const fs = new MemoryFs();
    const home = "/Users/hamza";
    fs.mkdir(`${home}/Library/CloudStorage/GoogleDrive-hamza@gosi.gov.sa/Shared drives/Motion Team/GML_Library/approved`);
    fs.mkdir(`${home}/Library/CloudStorage/GoogleDrive-hamza@gosi.gov.sa/My Drive`);

    const mounts = findDriveMounts(fs, { platform: "darwin", homedir: home });
    expect(mounts.map((m) => m.kind)).toEqual(["shared", "my-drive"]);

    const candidates = findLibraryCandidates(fs, { platform: "darwin", homedir: home });
    expect(candidates[0]).toMatchObject({
      exists: true,
      path: `${home}/Library/CloudStorage/GoogleDrive-hamza@gosi.gov.sa/Shared drives/Motion Team/GML_Library`,
    });
    // My Drive has no library yet, so a create-here suggestion is offered.
    expect(candidates.some((c) => !c.exists && c.path.endsWith("My Drive/GML_Library"))).toBe(true);
  });

  it("scans drive letters on Windows", () => {
    const fs = new MemoryFs();
    fs.mkdir("H:/Shared drives/GML_Library");
    const candidates = findLibraryCandidates(fs, { platform: "win32", homedir: "C:/Users/h" });
    expect(candidates[0]).toMatchObject({ exists: true, path: "H:/Shared drives/GML_Library" });
  });

  it("returns nothing where Drive is not installed", () => {
    const fs = new MemoryFs();
    expect(findLibraryCandidates(fs, { platform: "linux", homedir: "/home/x" })).toEqual([]);
  });
});
