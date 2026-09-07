import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assetFixture } from "@gml/core";
import { MemoryFs, hashesFrom } from "../fs.js";
import { MountTransport } from "../transport/mount.js";
import { TransportError, type AssetTransport, type FetchRangeOptions } from "../transport/types.js";
import { AssetFetcher, fileKey } from "./fetcher.js";
import { defaultCacheRoot, looksSynced } from "./paths.js";
import { CacheStore, LOCK_STALE_MS } from "./store.js";

const LIB = "G:/Shared drives/Motion/Hamza/2026/Motion Library";

/** Byte-for-byte equality without vitest's element-by-element diff on 10 MB arrays. */
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
const CACHE = "C:/Users/h/AppData/Local/GML";

function payload(n: number, seed = 7): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * seed + 13) & 0xff;
  return out;
}

function setup() {
  const fs = new MemoryFs();
  const data = payload(10 * 1024 * 1024 + 123);
  fs.writeFile(`${LIB}/Transitions/Arrows/01_TRA_Arrows_D_H_ALPHA.mov`, data);
  fs.writeFile(`${LIB}/Transitions/Arrows/Preview.mp4`, payload(5000, 3));
  const store = new CacheStore({ root: CACHE, fs, now: () => 1_000 });
  store.ensureLayout();
  const asset = assetFixture({
    id: "transitions/arrows",
    name: "Arrows",
    category: "transitions",
    categoryFolder: "Transitions",
    deliverables: [
      { relPath: "Transitions/Arrows/01_TRA_Arrows_D_H_ALPHA.mov", bytes: data.byteLength, mtimeMs: 1, hash: "x", alpha: "unknown", probed: false, warnings: [] },
    ],
    preview: { relPath: "Transitions/Arrows/Preview.mp4", bytes: 5000, mtimeMs: 1 },
  });
  return { fs, data, store, asset, deliverable: asset.deliverables[0]! };
}

describe("cache paths", () => {
  const join = (...p: string[]) => p.join("/");
  it("uses LOCALAPPDATA on Windows and Application Support on macOS — never a synced folder", () => {
    expect(defaultCacheRoot({ platform: "win32", homedir: "C:/Users/h", env: { LOCALAPPDATA: "C:/Users/h/AppData/Local" } }, join)).toBe("C:/Users/h/AppData/Local/GML");
    expect(defaultCacheRoot({ platform: "darwin", homedir: "/Users/h", env: {} }, join)).toBe("/Users/h/Library/Application Support/GML");
  });

  it("warns about synced locations", () => {
    expect(looksSynced("C:\\Users\\h\\AppData\\Roaming\\GML")).toMatch(/roaming/);
    expect(looksSynced("/Users/h/Documents/GML")).toMatch(/Documents/);
    expect(looksSynced("G:\\Shared drives\\cache")).toMatch(/Shared Drive/);
    expect(looksSynced("D:\\scratch\\GML")).toBeNull();
  });
});

describe("cache store", () => {
  it("writes atomically: a .part is never left where a file should be", () => {
    const { fs, store } = setup();
    store.writeAtomic(`${CACHE}/index.json`, "{}");
    expect(fs.exists(`${CACHE}/index.json`)).toBe(true);
    expect(fs.exists(`${CACHE}/index.json.part`)).toBe(false);
  });

  it("keeps versions side by side and evicts least recently used, never pinned", () => {
    const { fs, store } = setup();
    const put = (id: string, v: number, size: number) => fs.writeFile(store.deliverablePath(id, v, "a.mov"), payload(size, 1));
    put("transitions/arrows", 1, 300);
    put("transitions/arrows", 2, 300);
    put("3d/coin", 1, 300);
    let t = 10;
    const clock = { now: () => t };
    const s = new CacheStore({ root: CACHE, fs, now: clock.now });
    s.touch("transitions/arrows@v1");
    t = 20;
    s.touch("3d/coin@v1");
    t = 30;
    s.touch("transitions/arrows@v2");
    s.writePins(["transitions/arrows@v1"]);

    expect(s.usage().bytes).toBe(900);
    const result = s.evict(600);
    // arrows@v1 is oldest but pinned; coin@v1 goes next.
    expect(result.removed).toEqual(["3d/coin@v1"]);
    expect(fs.exists(s.deliverablePath("transitions/arrows", 1, "a.mov"))).toBe(true);
    expect(fs.exists(s.deliverablePath("transitions/arrows", 2, "a.mov"))).toBe(true);
    expect(fs.exists(s.deliverablePath("3d/coin", 1, "a.mov"))).toBe(false);
  });

  it("locks are per file, respect a live holder, and are taken over when stale", () => {
    const { fs } = setup();
    let t = 1000;
    const store = new CacheStore({ root: CACHE, fs, now: () => t });
    const file = `${CACHE}/assets/x/v1/a.mov`;
    expect(store.acquireLock(file, 111)).toBe(true);
    expect(store.acquireLock(file, 222)).toBe(false);
    t += LOCK_STALE_MS + 1;
    expect(store.acquireLock(file, 222)).toBe(true);
    store.releaseLock(file);
    expect(store.readLock(file)).toBeNull();
    // A dead process is detected without waiting for staleness.
    expect(store.acquireLock(file, 333)).toBe(true);
    expect(store.acquireLock(file, 444, () => false)).toBe(true);
  });
});

/** A transport that dies after a set number of bytes, once. */
class FlakyTransport implements AssetTransport {
  readonly name = "flaky";
  calls = 0;
  offsetsSeen: number[] = [];
  constructor(
    private readonly inner: AssetTransport,
    private readonly failAfter: number,
  ) {}
  stat(rel: string) {
    return this.inner.stat(rel);
  }
  async fetchRange(rel: string, options: FetchRangeOptions) {
    this.calls += 1;
    this.offsetsSeen.push(options.offset);
    if (this.calls === 1) {
      let sent = 0;
      return this.inner.fetchRange(rel, {
        ...options,
        onChunk: (chunk) => {
          if (sent + chunk.byteLength > this.failAfter) throw new TransportError("network died", undefined, true);
          sent += chunk.byteLength;
          options.onChunk(chunk);
        },
      });
    }
    return this.inner.fetchRange(rel, options);
  }
}

describe("fetcher", () => {
  it("reports cloud, fetches with real progress, and hands back a fully materialised local path", async () => {
    const { fs, data, store, asset, deliverable } = setup();
    const fetcher = new AssetFetcher({ store, fs, transport: new MountTransport(fs, LIB, 1024 * 1024), pid: 1 });
    expect(fetcher.state(asset, deliverable).status).toBe("cloud");

    const progress: number[] = [];
    const path = await fetcher.fetch(asset, deliverable, { onProgress: (d) => progress.push(d) });
    expect(path).toBe(`${CACHE}/assets/transitions/arrows/v1/01_TRA_Arrows_D_H_ALPHA.mov`);
    expect(path.startsWith(CACHE)).toBe(true);
    expect(same(fs.readFile(path), data)).toBe(true);
    expect(fs.exists(`${path}.part`)).toBe(false);
    expect(fs.exists(`${path}.lock`)).toBe(false);
    expect(progress.at(-1)).toBe(data.byteLength);
    expect(progress.length).toBeGreaterThan(3);
    expect(fetcher.state(asset, deliverable).status).toBe("ready");
    expect(store.lastUsed()["transitions/arrows@v1"]).toBe(1_000);
  });

  it("resumes an interrupted download from the .part instead of restarting", async () => {
    const { fs, data, store, asset, deliverable } = setup();
    const flaky = new FlakyTransport(new MountTransport(fs, LIB, 1024 * 1024), 3 * 1024 * 1024);
    const fetcher = new AssetFetcher({ store, fs, transport: flaky, pid: 1 });
    const dest = fetcher.localPath(asset, deliverable);

    await expect(fetcher.fetch(asset, deliverable)).rejects.toThrow(/network died/);
    expect(fs.exists(`${dest}.part`)).toBe(true);
    const partial = fs.stat(`${dest}.part`).size;
    expect(partial).toBe(3 * 1024 * 1024);
    expect(fetcher.state(asset, deliverable)).toMatchObject({ status: "failed", done: partial });
    expect(fs.exists(dest)).toBe(false);

    const path = await fetcher.fetch(asset, deliverable);
    expect(flaky.offsetsSeen).toEqual([0, partial]);
    expect(same(fs.readFile(path), data)).toBe(true);
  });

  it("discards a download whose checksum does not match", async () => {
    const { fs, store, asset, deliverable } = setup();
    const inner = new MountTransport(fs, LIB);
    const lying: AssetTransport = {
      name: "lying",
      stat: (r) => inner.stat(r),
      fetchRange: async (r, o) => ({ ...(await inner.fetchRange(r, o)), md5: "00000000000000000000000000000000" }),
    };
    const fetcher = new AssetFetcher({ store, fs, transport: lying, hashes: hashesFrom({ createHash }), pid: 1 });
    await expect(fetcher.fetch(asset, deliverable)).rejects.toThrow(/checksum/);
    expect(fs.exists(fetcher.localPath(asset, deliverable))).toBe(false);
    expect(fs.exists(`${fetcher.localPath(asset, deliverable)}.part`)).toBe(false);
  });

  it("waits for another instance's download rather than fetching twice", async () => {
    const { fs, data, store, asset, deliverable } = setup();
    const transport = new MountTransport(fs, LIB, 1024 * 1024);
    const other = new AssetFetcher({ store, fs, transport, pid: 2 });
    const dest = other.localPath(asset, deliverable);
    store.acquireLock(dest, 2);

    let polls = 0;
    const mine = new AssetFetcher({
      store,
      fs,
      transport,
      pid: 1,
      isAlive: () => true,
      sleep: async () => {
        polls += 1;
        if (polls === 3) {
          // The other instance finishes.
          fs.writeFile(dest, data);
          store.releaseLock(dest);
        }
      },
    });
    const path = await mine.fetch(asset, deliverable);
    expect(path).toBe(dest);
    expect(polls).toBe(3);
  });

  it("fetches previews into the previews folder", async () => {
    const { fs, store, asset } = setup();
    const fetcher = new AssetFetcher({ store, fs, transport: new MountTransport(fs, LIB), pid: 1 });
    const path = await fetcher.fetchPreview(asset);
    expect(path).toBe(`${CACHE}/previews/transitions/arrows.mp4`);
    expect(fs.stat(path!).size).toBe(5000);
  });

  it("keys files by id, version and name", () => {
    const { asset, deliverable } = setup();
    expect(fileKey(asset, deliverable)).toBe("transitions/arrows@v1/01_TRA_Arrows_D_H_ALPHA.mov");
  });
});
