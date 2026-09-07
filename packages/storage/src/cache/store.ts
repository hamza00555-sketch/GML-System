import { assetKey, safeParseIndex, type LibraryIndex } from "@gml/core";
import type { FolderFs } from "../fs.js";
import { CACHE_LAYOUT } from "./paths.js";

/**
 * The local cache: index, posters, previews and the deliverables After Effects
 * actually links to. Exports and renders never touch Google Drive.
 *
 *   GML/
 *   ├─ auth/                       refresh token, outside the extension folder
 *   ├─ index.json
 *   ├─ posters/<id>.png            all assets, tiny, eager
 *   ├─ previews/<id>.mp4           all assets, light, eager
 *   └─ assets/<id>/v<n>/<file>     deliverables, on demand only
 *
 * Every write is atomic (.part then rename), versions live side by side, and
 * eviction is LRU with a pin for anything an open project references.
 */

export interface CacheUsage {
  bytes: number;
  /** id@vN → bytes, deliverables only. */
  byKey: Map<string, number>;
  posters: number;
  previews: number;
}

export interface EvictionResult {
  removed: string[];
  freed: number;
}

export interface LockInfo {
  pid: number;
  at: number;
}

export const LOCK_STALE_MS = 10 * 60 * 1000;

export class CacheStore {
  readonly root: string;
  private readonly fs: FolderFs;
  private readonly now: () => number;

  constructor(options: { root: string; fs: FolderFs; now?: () => number }) {
    this.root = options.root;
    this.fs = options.fs;
    this.now = options.now ?? (() => Date.now());
  }

  ensureLayout(): void {
    for (const dir of [CACHE_LAYOUT.auth, CACHE_LAYOUT.posters, CACHE_LAYOUT.previews, CACHE_LAYOUT.assets]) {
      const p = this.fs.join(this.root, dir);
      if (!this.fs.exists(p)) this.fs.mkdir(p);
    }
  }

  // ---- paths ------------------------------------------------------------

  get indexPath(): string {
    return this.fs.join(this.root, CACHE_LAYOUT.index);
  }

  authPath(file: string): string {
    return this.fs.join(this.root, CACHE_LAYOUT.auth, file);
  }

  posterPath(cacheKey: string): string {
    return this.fs.join(this.root, CACHE_LAYOUT.posters, ...cacheKey.split("/"));
  }

  previewPath(assetId: string): string {
    return this.fs.join(this.root, CACHE_LAYOUT.previews, ...`${assetId}.mp4`.split("/"));
  }

  assetDir(assetId: string, version: number): string {
    return this.fs.join(this.root, CACHE_LAYOUT.assets, ...assetId.split("/"), `v${version}`);
  }

  deliverablePath(assetId: string, version: number, fileName: string): string {
    return this.fs.join(this.assetDir(assetId, version), fileName);
  }

  // ---- index --------------------------------------------------------------

  readIndex(): LibraryIndex | null {
    if (!this.fs.exists(this.indexPath)) return null;
    try {
      const parsed = safeParseIndex(JSON.parse(new TextDecoder().decode(this.fs.readFile(this.indexPath))));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  writeIndex(index: LibraryIndex): void {
    this.writeAtomic(this.indexPath, JSON.stringify(index));
  }

  // ---- files --------------------------------------------------------------

  /** A file is only ever visible complete: written as .part, then renamed. */
  writeAtomic(path: string, data: Uint8Array | string): void {
    const dir = this.fs.dirname(path);
    if (!this.fs.exists(dir)) this.fs.mkdir(dir);
    const part = `${path}.part`;
    if (this.fs.exists(part)) this.fs.rm(part);
    this.fs.writeFile(part, data);
    if (this.fs.exists(path)) this.fs.rm(path);
    this.fs.rename(part, path);
  }

  /** True only for a fully materialised file of the expected size. */
  isComplete(path: string, expectedBytes?: number): boolean {
    if (!this.fs.exists(path)) return false;
    try {
      const stat = this.fs.stat(path);
      if (stat.isDirectory) return false;
      return expectedBytes === undefined || stat.size === expectedBytes;
    } catch {
      return false;
    }
  }

  partialBytes(path: string): number {
    const part = `${path}.part`;
    try {
      return this.fs.exists(part) ? this.fs.stat(part).size : 0;
    } catch {
      return 0;
    }
  }

  // ---- locks --------------------------------------------------------------

  private lockPath(path: string): string {
    return `${path}.lock`;
  }

  readLock(path: string): LockInfo | null {
    const lock = this.lockPath(path);
    if (!this.fs.exists(lock)) return null;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(this.fs.readFile(lock))) as LockInfo;
      return typeof parsed.pid === "number" && typeof parsed.at === "number" ? parsed : null;
    } catch {
      return null;
    }
  }

  /**
   * Claims a download. Another live process holding the lock wins; a stale
   * lock (crashed process, machine slept) is taken over.
   */
  acquireLock(path: string, pid: number, isAlive?: (pid: number) => boolean): boolean {
    const existing = this.readLock(path);
    if (existing && existing.pid !== pid) {
      const stale = this.now() - existing.at > LOCK_STALE_MS || (isAlive ? !isAlive(existing.pid) : false);
      if (!stale) return false;
    }
    const dir = this.fs.dirname(path);
    if (!this.fs.exists(dir)) this.fs.mkdir(dir);
    this.fs.writeFile(this.lockPath(path), JSON.stringify({ pid, at: this.now() } satisfies LockInfo));
    return true;
  }

  /** Heartbeat so a long download is not mistaken for a stale lock. */
  touchLock(path: string, pid: number): void {
    this.fs.writeFile(this.lockPath(path), JSON.stringify({ pid, at: this.now() } satisfies LockInfo));
  }

  releaseLock(path: string): void {
    const lock = this.lockPath(path);
    if (this.fs.exists(lock)) this.fs.rm(lock);
  }

  // ---- usage, pins, eviction ------------------------------------------------

  private readJson<T>(file: string, fallback: T): T {
    const p = this.fs.join(this.root, file);
    if (!this.fs.exists(p)) return fallback;
    try {
      return JSON.parse(new TextDecoder().decode(this.fs.readFile(p))) as T;
    } catch {
      return fallback;
    }
  }

  private writeJson(file: string, value: unknown): void {
    this.writeAtomic(this.fs.join(this.root, file), JSON.stringify(value));
  }

  /** Records that id@vN was used now — Apply, prefetch or a project reference. */
  touch(key: string): void {
    const usage = this.readJson<Record<string, number>>(CACHE_LAYOUT.usage, {});
    usage[key] = this.now();
    this.writeJson(CACHE_LAYOUT.usage, usage);
  }

  lastUsed(): Record<string, number> {
    return this.readJson<Record<string, number>>(CACHE_LAYOUT.usage, {});
  }

  readPins(): Set<string> {
    return new Set(this.readJson<string[]>(CACHE_LAYOUT.pins, []));
  }

  writePins(pins: Iterable<string>): void {
    this.writeJson(CACHE_LAYOUT.pins, [...new Set(pins)].sort());
  }

  private dirBytes(dir: string): number {
    let total = 0;
    const walk = (p: string) => {
      for (const name of this.fs.readdir(p)) {
        const child = this.fs.join(p, name);
        const stat = this.fs.stat(child);
        if (stat.isDirectory) walk(child);
        else total += stat.size;
      }
    };
    if (this.fs.exists(dir)) walk(dir);
    return total;
  }

  /** Every cached deliverable version, keyed id@vN. */
  cachedKeys(): Map<string, string> {
    const out = new Map<string, string>();
    const assets = this.fs.join(this.root, CACHE_LAYOUT.assets);
    if (!this.fs.exists(assets)) return out;
    const walk = (dir: string, idParts: string[]) => {
      for (const name of this.fs.readdir(dir)) {
        const child = this.fs.join(dir, name);
        if (!this.fs.stat(child).isDirectory) continue;
        const version = /^v(\d+)$/.exec(name);
        if (version && idParts.length > 0) out.set(assetKey(idParts.join("/"), Number(version[1])), child);
        else walk(child, [...idParts, name]);
      }
    };
    walk(assets, []);
    return out;
  }

  usage(): CacheUsage {
    const byKey = new Map<string, number>();
    let bytes = 0;
    for (const [key, dir] of this.cachedKeys()) {
      const size = this.dirBytes(dir);
      byKey.set(key, size);
      bytes += size;
    }
    const posters = this.dirBytes(this.fs.join(this.root, CACHE_LAYOUT.posters));
    const previews = this.dirBytes(this.fs.join(this.root, CACHE_LAYOUT.previews));
    return { bytes: bytes + posters + previews, byKey, posters, previews };
  }

  removeVersion(key: string): void {
    const dir = this.cachedKeys().get(key);
    if (dir) this.fs.rm(dir);
  }

  /**
   * LRU eviction of deliverables down to the cap. Pinned keys — anything an
   * open project references — are never touched. Posters and previews stay.
   */
  evict(capBytes: number, pinned: ReadonlySet<string> = this.readPins()): EvictionResult {
    const usage = this.usage();
    if (usage.bytes <= capBytes) return { removed: [], freed: 0 };
    const lastUsed = this.lastUsed();
    const candidates = [...usage.byKey.entries()]
      .filter(([key]) => !pinned.has(key))
      .sort((a, b) => (lastUsed[a[0]] ?? 0) - (lastUsed[b[0]] ?? 0));

    let bytes = usage.bytes;
    const removed: string[] = [];
    let freed = 0;
    for (const [key, size] of candidates) {
      if (bytes <= capBytes) break;
      this.removeVersion(key);
      bytes -= size;
      freed += size;
      removed.push(key);
    }
    return { removed, freed };
  }

  /** Drops every deliverable except pinned ones; posters and previews are kept. */
  clean(pinned: ReadonlySet<string> = this.readPins()): EvictionResult {
    return this.evict(0, pinned);
  }
}
