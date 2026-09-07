import { assetKey, fileNameOf, type Deliverable, type LibraryAsset } from "@gml/core";
import type { FolderFs, Hashes } from "../fs.js";
import { TransportError, type AssetTransport } from "../transport/types.js";
import type { CacheStore } from "./store.js";

/**
 * fetchAsset(assetId, version, onProgress) → local absolute path.
 *
 * Every deliverable After Effects links to comes through here. Rules:
 *  - never hand back a path that is not fully materialised;
 *  - download to <file>.part, verify size (and md5 when the remote gives one),
 *    then rename — a half-written 2.7 GB file is never importable;
 *  - resume from the .part's length after an interruption;
 *  - one download per file across AE instances, via a lock file.
 */

export type FetchStatus = "cloud" | "fetching" | "ready" | "failed";

export interface FetchState {
  status: FetchStatus;
  done: number;
  total: number;
  error?: string;
}

export type FetchListener = (fileKey: string, state: FetchState) => void;

export interface FetcherOptions {
  store: CacheStore;
  fs: FolderFs;
  transport: AssetTransport;
  hashes?: Hashes;
  pid?: number;
  /** For waiting on another process's lock. */
  sleep?: (ms: number) => Promise<void>;
  isAlive?: (pid: number) => boolean;
}

/** id@vN/file — one deliverable of one version. */
export function fileKey(asset: Pick<LibraryAsset, "id" | "version">, deliverable: Pick<Deliverable, "relPath">): string {
  return `${assetKey(asset.id, asset.version)}/${fileNameOf(deliverable.relPath)}`;
}

export class AssetFetcher {
  private readonly store: CacheStore;
  private readonly fs: FolderFs;
  private transport: AssetTransport;
  private readonly hashes?: Hashes;
  private readonly pid: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly isAlive?: (pid: number) => boolean;
  private readonly listeners = new Set<FetchListener>();
  private readonly states = new Map<string, FetchState>();
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(options: FetcherOptions) {
    this.store = options.store;
    this.fs = options.fs;
    this.transport = options.transport;
    this.hashes = options.hashes;
    this.pid = options.pid ?? 0;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.isAlive = options.isAlive;
  }

  /** The transport is the one swappable piece; nothing else changes. */
  setTransport(transport: AssetTransport): void {
    this.transport = transport;
  }

  get transportName(): string {
    return this.transport.name;
  }

  subscribe(listener: FetchListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(key: string, state: FetchState): void {
    this.states.set(key, state);
    for (const l of this.listeners) l(key, state);
  }

  localPath(asset: Pick<LibraryAsset, "id" | "version">, deliverable: Pick<Deliverable, "relPath">): string {
    return this.store.deliverablePath(asset.id, asset.version, fileNameOf(deliverable.relPath));
  }

  /** Synchronous, cheap: disk truth first, then in-memory progress. */
  state(asset: Pick<LibraryAsset, "id" | "version">, deliverable: Pick<Deliverable, "relPath" | "bytes">): FetchState {
    const key = fileKey(asset, deliverable);
    const live = this.states.get(key);
    if (live && live.status === "fetching") return live;
    const path = this.localPath(asset, deliverable);
    if (this.store.isComplete(path, deliverable.bytes)) return { status: "ready", done: deliverable.bytes, total: deliverable.bytes };
    if (live?.status === "failed") return live;
    const partial = this.store.partialBytes(path);
    return { status: "cloud", done: partial, total: deliverable.bytes };
  }

  async fetch(
    asset: Pick<LibraryAsset, "id" | "version">,
    deliverable: Pick<Deliverable, "relPath" | "bytes">,
    options: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
  ): Promise<string> {
    const key = fileKey(asset, deliverable);
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const run = this.fetchUncached(asset, deliverable, key, options).finally(() => this.inflight.delete(key));
    this.inflight.set(key, run);
    return run;
  }

  private async fetchUncached(
    asset: Pick<LibraryAsset, "id" | "version">,
    deliverable: Pick<Deliverable, "relPath" | "bytes">,
    key: string,
    options: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal },
  ): Promise<string> {
    const dest = this.localPath(asset, deliverable);
    const part = `${dest}.part`;
    const expected = deliverable.bytes;

    if (this.store.isComplete(dest, expected)) {
      this.emit(key, { status: "ready", done: expected, total: expected });
      this.store.touch(assetKey(asset.id, asset.version));
      return dest;
    }

    // Someone else (another AE instance) may be fetching this very file.
    for (let waited = 0; !this.store.acquireLock(dest, this.pid, this.isAlive); waited++) {
      this.emit(key, { status: "fetching", done: this.store.partialBytes(dest), total: expected });
      await this.sleep(500);
      if (this.store.isComplete(dest, expected)) {
        this.emit(key, { status: "ready", done: expected, total: expected });
        return dest;
      }
      if (waited > 7200) throw new Error(`another After Effects instance has held ${fileNameOf(dest)} for an hour`);
    }

    try {
      const dir = this.fs.dirname(dest);
      if (!this.fs.exists(dir)) this.fs.mkdir(dir);

      let offset = this.store.partialBytes(dest);
      if (offset > expected && expected > 0) {
        // A .part longer than the file is from a different version of the file; start over.
        this.fs.rm(part);
        offset = 0;
      }
      if (offset === 0 && !this.fs.exists(part)) this.fs.writeFile(part, new Uint8Array(0));

      this.emit(key, { status: "fetching", done: offset, total: expected });
      let lastBeat = 0;
      const result = await this.transport.fetchRange(deliverable.relPath, {
        offset,
        expectedBytes: expected,
        signal: options.signal,
        onChunk: (chunk) => this.fs.appendFile(part, chunk),
        onProgress: (done, total) => {
          const t = total || expected;
          this.emit(key, { status: "fetching", done, total: t });
          options.onProgress?.(done, t);
          if (done - lastBeat > 64 * 1024 * 1024) {
            this.store.touchLock(dest, this.pid);
            lastBeat = done;
          }
        },
      });

      const finalBytes = this.fs.stat(part).size;
      const wanted = result.bytes || expected;
      if (wanted > 0 && finalBytes !== wanted) {
        throw new TransportError(`download of ${fileNameOf(dest)} ended at ${finalBytes} of ${wanted} bytes`, undefined, true);
      }
      if (result.md5 && this.hashes) {
        const md5 = this.md5Of(part, finalBytes);
        if (md5 !== result.md5) {
          this.fs.rm(part);
          throw new TransportError(`checksum mismatch for ${fileNameOf(dest)} — the download was discarded`, undefined, true);
        }
      }

      if (this.fs.exists(dest)) this.fs.rm(dest);
      this.fs.rename(part, dest);
      this.store.touch(assetKey(asset.id, asset.version));
      this.emit(key, { status: "ready", done: finalBytes, total: finalBytes });
      return dest;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The .part stays for resume unless it was found corrupt above.
      this.emit(key, { status: "failed", done: this.store.partialBytes(dest), total: expected, error: message });
      throw error;
    } finally {
      this.store.releaseLock(dest);
    }
  }

  private md5Of(path: string, size: number): string {
    const stream = this.hashes!.md5Stream();
    const chunk = 8 * 1024 * 1024;
    for (let offset = 0; offset < size; offset += chunk) {
      stream.update(this.fs.readRange(path, offset, Math.min(chunk, size - offset)));
    }
    return stream.digest();
  }

  /** Previews are light and cached eagerly; same protocol, different folder. */
  async fetchPreview(asset: LibraryAsset, signal?: AbortSignal): Promise<string | null> {
    if (!asset.preview) return null;
    const dest = this.store.previewPath(asset.id);
    if (this.store.isComplete(dest, asset.preview.bytes)) return dest;
    const key = `preview:${asset.id}`;
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const run = (async () => {
      const part = `${dest}.part`;
      const dir = this.fs.dirname(dest);
      if (!this.fs.exists(dir)) this.fs.mkdir(dir);
      if (this.fs.exists(part)) this.fs.rm(part);
      this.fs.writeFile(part, new Uint8Array(0));
      await this.transport.fetchRange(asset.preview!.relPath, {
        offset: 0,
        expectedBytes: asset.preview!.bytes,
        signal,
        onChunk: (chunk) => this.fs.appendFile(part, chunk),
      });
      if (this.fs.exists(dest)) this.fs.rm(dest);
      this.fs.rename(part, dest);
      return dest;
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, run);
    return run;
  }
}
