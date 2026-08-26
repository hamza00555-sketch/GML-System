import { describe, expect, it } from "vitest";
import { MANIFEST_EXCLUDED, motionFixture, sampleLibrary } from "@gml/core";
import { buildManifest, verifyPackage } from "./hash.js";
import { MemoryPackageCache, cacheKey } from "./cache.js";
import { MockLibraryProvider } from "./mock-provider.js";
import { PublishVerificationError, verifyStagedUpload } from "./provider.js";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("manifest building", () => {
  it("never includes meta.json — it carries the manifest", () => {
    const manifest = buildManifest([
      { path: "source.aep", data: bytes("aep") },
      { path: MANIFEST_EXCLUDED, data: bytes("{}") },
    ]);
    expect(Object.keys(manifest)).toEqual(["source.aep"]);
  });

  it("keys by relative path so same-named files in different folders differ", () => {
    const manifest = buildManifest([
      { path: "footage/a/logo.png", data: bytes("A") },
      { path: "footage/b/logo.png", data: bytes("B") },
    ]);
    expect(Object.keys(manifest)).toHaveLength(2);
    expect(manifest["footage/a/logo.png"]!.sha256).not.toBe(
      manifest["footage/b/logo.png"]!.sha256,
    );
  });

  it("records bytes, sha256 and md5 for every file", () => {
    const manifest = buildManifest([{ path: "preview.mp4", data: bytes("video") }]);
    const entry = manifest["preview.mp4"]!;
    expect(entry.bytes).toBe(5);
    expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(entry.md5).toMatch(/^[a-f0-9]{32}$/);
  });

  it("detects a corrupted file after download", () => {
    const files = [{ path: "source.aep", data: bytes("original") }];
    const manifest = buildManifest(files);
    const problems = verifyPackage(manifest, [
      { path: "source.aep", data: bytes("tampered") },
    ]);
    expect(problems.join(" ")).toContain("sha256 mismatch");
  });

  it("detects a file missing from a download", () => {
    const manifest = buildManifest([
      { path: "source.aep", data: bytes("a") },
      { path: "poster.png", data: bytes("b") },
    ]);
    const problems = verifyPackage(manifest, [{ path: "source.aep", data: bytes("a") }]);
    expect(problems).toContain("missing file: poster.png");
  });
});

describe("staged upload verification", () => {
  const manifest = buildManifest([
    { path: "source.aep", data: bytes("aep") },
    { path: "poster.png", data: bytes("png") },
  ]);

  it("passes when every file arrived intact", () => {
    const uploaded = Object.entries(manifest).map(([path, f]) => ({
      path,
      bytes: f.bytes,
      md5: f.md5,
    }));
    expect(verifyStagedUpload(manifest, uploaded)).toEqual([]);
  });

  it("fails when the connection died partway", () => {
    const uploaded = [{ path: "source.aep", ...manifest["source.aep"]! }];
    expect(verifyStagedUpload(manifest, uploaded).join(" ")).toContain(
      "missing from upload: poster.png",
    );
  });

  it("fails on an md5 that does not match what we sent", () => {
    const uploaded = Object.entries(manifest).map(([path, f]) => ({
      path,
      bytes: f.bytes,
      md5: path === "poster.png" ? "0".repeat(32) : f.md5,
    }));
    expect(verifyStagedUpload(manifest, uploaded).join(" ")).toContain("md5 mismatch");
  });
});

describe("package cache", () => {
  it("treats the same id at different versions as separate entries", async () => {
    const cache = new MemoryPackageCache();
    await cache.put("gml_fade-up", "1.1.0", "/c/a");
    await cache.put("gml_fade-up", "1.3.0", "/c/b");
    expect(await cache.keys()).toHaveLength(2);
    expect(await cache.path("gml_fade-up", "1.1.0")).toBe("/c/a");
    expect(await cache.path("gml_fade-up", "1.3.0")).toBe("/c/b");
  });

  it("evicts a single version or every version of an id", async () => {
    const cache = new MemoryPackageCache();
    await cache.put("gml_a", "1.0.0", "/x");
    await cache.put("gml_a", "2.0.0", "/y");
    await cache.evict("gml_a", "1.0.0");
    expect(await cache.keys()).toEqual([cacheKey("gml_a", "2.0.0")]);
    await cache.evict("gml_a");
    expect(await cache.keys()).toEqual([]);
  });
});

describe("provider publish flow", () => {
  const asset = motionFixture({ id: "gml_new", version: "1.0.0" });
  const filesFor = (a = asset) =>
    Object.keys(a.assets).map((p) => {
      const entry = a.assets[p]!;
      // Reproduce exactly what the manifest promises for this fixture.
      return { path: p, data: new Uint8Array(), bytes: entry.bytes, md5: entry.md5, sha256: entry.sha256 };
    });

  it("publishes only after every file is verified", async () => {
    const provider = new MockLibraryProvider();
    const handle = await provider.beginPublish(asset.id, asset.version);
    for (const f of filesFor()) await provider.uploadToStaging(handle, f);

    const published = await provider.finalizePublish(handle, asset);
    expect(published.id).toBe("gml_new");
    expect((await provider.list()).items.map((a) => a.id)).toContain("gml_new");
    expect(provider.stagingCount()).toBe(0);
  });

  it("never publishes an asset whose upload was interrupted", async () => {
    const provider = new MockLibraryProvider();
    const handle = await provider.beginPublish(asset.id, asset.version);

    const all = filesFor();
    // Simulate the network dropping after the first file.
    await provider.uploadToStaging(handle, all[0]!);

    await expect(provider.finalizePublish(handle, asset)).rejects.toBeInstanceOf(
      PublishVerificationError,
    );
    expect((await provider.list()).items).toHaveLength(0);
    await expect(provider.get(asset.id, asset.version)).rejects.toThrow();
  });

  it("garbage-collects staged uploads left behind by an interruption", async () => {
    let clock = 0;
    const provider = new MockLibraryProvider({ now: () => clock });
    await provider.beginPublish("gml_orphan", "1.0.0");
    expect(provider.stagingCount()).toBe(1);

    clock += 25 * 60 * 60 * 1000;
    const dropped = await provider.collectGarbage();
    expect(dropped).toHaveLength(1);
    expect(provider.stagingCount()).toBe(0);
    expect((await provider.list()).items).toHaveLength(0);
  });

  it("keeps staged uploads that are still recent", async () => {
    let clock = 0;
    const provider = new MockLibraryProvider({ now: () => clock });
    await provider.beginPublish("gml_fresh", "1.0.0");
    clock += 60 * 1000;
    expect(await provider.collectGarbage()).toHaveLength(0);
  });
});

describe("provider reads", () => {
  it("paginates with an opaque cursor", async () => {
    const provider = new MockLibraryProvider({ seed: sampleLibrary(), pageSize: 4 });
    const first = await provider.list();
    expect(first.items).toHaveLength(4);
    expect(first.cursor).toBeDefined();

    const seen = [...first.items];
    let cursor = first.cursor;
    while (cursor) {
      const page = await provider.list({ cursor });
      seen.push(...page.items);
      cursor = page.cursor;
    }
    expect(seen).toHaveLength(sampleLibrary().length);
    expect(new Set(seen.map((a) => a.id)).size).toBe(seen.length);
  });

  it("downloads a version once and serves the cache after that", async () => {
    const provider = new MockLibraryProvider({ seed: sampleLibrary() });
    await provider.fetchPackage("gml_fade-up", "1.0.0");
    await provider.fetchPackage("gml_fade-up", "1.0.0");
    expect(provider.downloads).toBe(1);
  });

  it("downloads separately for a different version of the same asset", async () => {
    const provider = new MockLibraryProvider({
      seed: [motionFixture({ version: "1.1.0" }), motionFixture({ version: "1.3.0" })],
    });
    await provider.fetchPackage("gml_fade-up", "1.1.0");
    await provider.fetchPackage("gml_fade-up", "1.3.0");
    expect(provider.downloads).toBe(2);
  });

  it("resolves the latest version when none is named", async () => {
    const provider = new MockLibraryProvider({
      seed: [motionFixture({ version: "1.1.0" }), motionFixture({ version: "1.3.0" })],
    });
    expect((await provider.get("gml_fade-up")).version).toBe("1.3.0");
  });
});
