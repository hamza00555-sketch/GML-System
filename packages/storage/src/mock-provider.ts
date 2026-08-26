import type { GmlAsset } from "@gml/core";
import { gmlAssetSchema } from "@gml/core";
import {
  PublishVerificationError,
  verifyStagedUpload,
  type LibraryProvider,
  type ListOptions,
  type LocalFile,
  type Page,
  type ProgressFn,
  type StagingHandle,
  type UploadedRef,
} from "./provider.js";
import { MemoryPackageCache, cacheKey, type PackageCache } from "./cache.js";

interface StagedUpload {
  handle: StagingHandle;
  files: UploadedRef[];
  startedAt: number;
}

export interface MockProviderOptions {
  seed?: readonly GmlAsset[];
  pageSize?: number;
  cache?: PackageCache;
  /** Wall clock, injectable so staging garbage collection is testable. */
  now?: () => number;
}

/**
 * In-memory provider used by the harness and the tests. It models the parts of
 * the real Drive flow that matter for correctness: staged uploads that are
 * invisible until verified, and per-version package caching.
 */
export class MockLibraryProvider implements LibraryProvider {
  private readonly published = new Map<string, GmlAsset>();
  private readonly staging = new Map<string, StagedUpload>();
  private readonly pageSize: number;
  private readonly cache: PackageCache;
  private readonly now: () => number;
  private counter = 0;

  /** Counts real downloads so tests can prove the cache prevents repeats. */
  downloads = 0;

  constructor(options: MockProviderOptions = {}) {
    this.pageSize = options.pageSize ?? 50;
    this.cache = options.cache ?? new MemoryPackageCache();
    this.now = options.now ?? (() => Date.now());
    for (const asset of options.seed ?? []) {
      this.published.set(cacheKey(asset.id, asset.version), asset);
    }
  }

  private sorted(): GmlAsset[] {
    return [...this.published.values()].sort((a, b) =>
      a.id === b.id ? a.version.localeCompare(b.version) : a.id.localeCompare(b.id),
    );
  }

  async list(opts: ListOptions = {}): Promise<Page<GmlAsset>> {
    let items = this.sorted();
    if (opts.since) items = items.filter((a) => a.updatedAt > opts.since!);

    const start = opts.cursor ? Number(opts.cursor) : 0;
    const slice = items.slice(start, start + this.pageSize);
    const next = start + this.pageSize;
    return next < items.length ? { items: slice, cursor: String(next) } : { items: slice };
  }

  async get(id: string, version?: string): Promise<GmlAsset> {
    if (version) {
      const found = this.published.get(cacheKey(id, version));
      if (!found) throw new Error(`not found: ${id}@${version}`);
      return found;
    }
    const versions = this.sorted().filter((a) => a.id === id);
    const latest = versions.at(-1);
    if (!latest) throw new Error(`not found: ${id}`);
    return latest;
  }

  async fetchPackage(
    id: string,
    version: string,
    onProgress?: ProgressFn,
  ): Promise<string> {
    const cached = await this.cache.path(id, version);
    if (cached) return cached;

    const asset = await this.get(id, version);
    const files = Object.keys(asset.assets);
    files.forEach((_, i) => onProgress?.(i + 1, files.length));

    this.downloads += 1;
    return this.cache.put(id, version, `/gml-cache/${cacheKey(id, version)}`);
  }

  async beginPublish(id: string, version: string): Promise<StagingHandle> {
    const handle: StagingHandle = { uploadId: `upload-${++this.counter}`, id, version };
    this.staging.set(handle.uploadId, { handle, files: [], startedAt: this.now() });
    return handle;
  }

  async uploadToStaging(handle: StagingHandle, file: LocalFile): Promise<UploadedRef> {
    const staged = this.staging.get(handle.uploadId);
    if (!staged) throw new Error(`no such staging upload: ${handle.uploadId}`);
    // The remote echoes back only what it can compute: size and md5.
    const ref: UploadedRef = { path: file.path, bytes: file.bytes, md5: file.md5 };
    staged.files.push(ref);
    return ref;
  }

  async finalizePublish(handle: StagingHandle, meta: GmlAsset): Promise<GmlAsset> {
    const staged = this.staging.get(handle.uploadId);
    if (!staged) throw new Error(`no such staging upload: ${handle.uploadId}`);

    const asset = gmlAssetSchema.parse(meta);
    const problems = verifyStagedUpload(asset.assets, staged.files);
    if (problems.length > 0) {
      // Deliberately leaves the staged folder in place for the caller to abort
      // or retry; nothing becomes visible to readers.
      throw new PublishVerificationError(
        `upload for ${handle.id}@${handle.version} is incomplete`,
        problems,
      );
    }

    this.staging.delete(handle.uploadId);
    this.published.set(cacheKey(asset.id, asset.version), asset);
    return asset;
  }

  async abortPublish(handle: StagingHandle): Promise<void> {
    this.staging.delete(handle.uploadId);
  }

  async remove(id: string, version?: string): Promise<void> {
    if (version) {
      this.published.delete(cacheKey(id, version));
      await this.cache.evict(id, version);
      return;
    }
    for (const key of [...this.published.keys()]) {
      if (key.startsWith(`${id}/`)) this.published.delete(key);
    }
    await this.cache.evict(id);
  }

  /** Mirrors the real `gc`: drop staged uploads older than the given age. */
  async collectGarbage(maxAgeMs = 24 * 60 * 60 * 1000): Promise<string[]> {
    const cutoff = this.now() - maxAgeMs;
    const dropped: string[] = [];
    for (const [uploadId, staged] of this.staging) {
      if (staged.startedAt < cutoff) {
        this.staging.delete(uploadId);
        dropped.push(uploadId);
      }
    }
    return dropped;
  }

  /** Test/debug helper — staged uploads are never visible through `list`. */
  stagingCount(): number {
    return this.staging.size;
  }
}
