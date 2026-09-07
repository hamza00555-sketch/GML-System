import type { AssetManifest, GmlAsset } from "@gml/core";
import { MANIFEST_EXCLUDED, gmlAssetSchema, safeParseAsset } from "@gml/core";
import type { FolderFs, Hashes } from "./fs.js";
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

/**
 * A library that is a folder — typically one Google Drive for Desktop keeps in
 * sync with a Shared Drive, but a network share or a local folder work too.
 *
 *   <root>/
 *     approved/<id>/meta.json …     what designers see as approved
 *     drafts/<id>/meta.json …       published but not yet approved
 *     _staging/<uploadId>/          in-flight publishes; readers ignore it
 *
 * The publish protocol is the same one the Drive API design uses: files land
 * in _staging, are verified against the manifest, meta.json is written last as
 * the completion marker, and the folder is renamed into place — one atomic
 * operation from a reader's point of view. A folder without meta.json is not
 * an asset and is skipped.
 */

export const STATUS_DIRS = ["approved", "drafts"] as const;
export const STAGING_DIR = "_staging";

export interface FolderProviderOptions {
  root: string;
  fs: FolderFs;
  hashes: Hashes;
  /** Wall clock, injectable for tests. */
  now?: () => number;
  idFactory?: () => string;
}

export interface LibraryProblem {
  path: string;
  message: string;
}

interface Indexed {
  asset: GmlAsset;
  packagePath: string;
}

export class FolderLibraryProvider implements LibraryProvider {
  readonly root: string;
  private readonly fs: FolderFs;
  private readonly hashes: Hashes;
  private readonly now: () => number;
  private readonly newId: () => string;
  private index = new Map<string, Indexed>();
  private indexed = false;
  /** Folders that looked like packages but failed validation — for diagnostics. */
  problems: LibraryProblem[] = [];

  constructor(options: FolderProviderOptions) {
    this.root = options.root;
    this.fs = options.fs;
    this.hashes = options.hashes;
    this.now = options.now ?? (() => Date.now());
    this.newId =
      options.idFactory ??
      (() => `${this.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  }

  /** Creates the folder layout. Safe to call on an existing library. */
  ensureLayout(): void {
    for (const dir of [...STATUS_DIRS, STAGING_DIR]) {
      const p = this.fs.join(this.root, dir);
      if (!this.fs.exists(p)) this.fs.mkdir(p);
    }
  }

  private key(id: string, version: string): string {
    return `${id}/${version}`;
  }

  /** Re-reads every meta.json. Cheap: one small file per asset. */
  refresh(): void {
    const next = new Map<string, Indexed>();
    const problems: LibraryProblem[] = [];

    for (const status of STATUS_DIRS) {
      const dir = this.fs.join(this.root, status);
      if (!this.fs.exists(dir)) continue;
      for (const entry of this.fs.readdir(dir)) {
        const packagePath = this.fs.join(dir, entry);
        const metaPath = this.fs.join(packagePath, MANIFEST_EXCLUDED);
        try {
          if (!this.fs.stat(packagePath).isDirectory) continue;
          // No meta.json means not finished, not an asset — never shown.
          if (!this.fs.exists(metaPath)) continue;
          const text = new TextDecoder().decode(this.fs.readFile(metaPath));
          const parsed = safeParseAsset(JSON.parse(text));
          if (!parsed.success) {
            problems.push({ path: packagePath, message: parsed.error.issues.map((i) => i.message).join("; ") });
            continue;
          }
          // The folder decides: a meta.json saying "approved" inside drafts/ is
          // still a draft. Approval is the folder move, not the field.
          const asset: GmlAsset = { ...parsed.data, status: status === "approved" ? "approved" : "draft" };
          next.set(this.key(asset.id, asset.version), { asset, packagePath });
        } catch (error) {
          problems.push({ path: packagePath, message: error instanceof Error ? error.message : String(error) });
        }
      }
    }

    this.index = next;
    this.problems = problems;
    this.indexed = true;
  }

  private ensureIndexed(): void {
    if (!this.indexed) this.refresh();
  }

  private sorted(): Indexed[] {
    this.ensureIndexed();
    return [...this.index.values()].sort((a, b) =>
      a.asset.id === b.asset.id
        ? a.asset.version.localeCompare(b.asset.version)
        : a.asset.id.localeCompare(b.asset.id),
    );
  }

  async list(opts: ListOptions = {}): Promise<Page<GmlAsset>> {
    // Always re-read: Drive may have synced a colleague's publish since last time.
    this.refresh();
    let items = this.sorted().map((x) => x.asset);
    if (opts.since) items = items.filter((a) => a.updatedAt > opts.since!);
    return { items };
  }

  async get(id: string, version?: string): Promise<GmlAsset> {
    this.ensureIndexed();
    const found = version
      ? this.index.get(this.key(id, version))?.asset
      : this.sorted().filter((x) => x.asset.id === id).at(-1)?.asset;
    if (!found) throw new Error(`not found: ${id}${version ? `@${version}` : ""}`);
    return found;
  }

  /** Synchronous lookups for the bridge: URLs and apply payloads need them without awaiting. */
  packagePath(id: string, version: string): string | null {
    this.ensureIndexed();
    return this.index.get(this.key(id, version))?.packagePath ?? null;
  }

  assetSync(id: string, version: string): GmlAsset | null {
    this.ensureIndexed();
    return this.index.get(this.key(id, version))?.asset ?? null;
  }

  /**
   * The package is already local — Drive for Desktop streams files on first
   * access. Sizes are checked so a half-synced package is reported rather than
   * imported with a truncated source.aep.
   */
  async fetchPackage(id: string, version: string, onProgress?: ProgressFn): Promise<string> {
    const found = this.index.get(this.key(id, version)) ?? (this.refresh(), this.index.get(this.key(id, version)));
    if (!found) throw new Error(`not found: ${id}@${version}`);

    const entries = Object.entries(found.asset.assets);
    const problems: string[] = [];
    entries.forEach(([rel, expected], i) => {
      const p = this.fs.join(found.packagePath, ...rel.split("/"));
      if (!this.fs.exists(p)) problems.push(`missing file: ${rel}`);
      else if (this.fs.stat(p).size !== expected.bytes) problems.push(`size mismatch: ${rel}`);
      onProgress?.(i + 1, entries.length);
    });
    if (problems.length > 0) {
      throw new PublishVerificationError(`package ${id}@${version} is incomplete — still syncing?`, problems);
    }
    return found.packagePath;
  }

  private stagingPath(handle: StagingHandle): string {
    return this.fs.join(this.root, STAGING_DIR, handle.uploadId);
  }

  async beginPublish(id: string, version: string): Promise<StagingHandle> {
    this.ensureLayout();
    const handle: StagingHandle = { uploadId: `${id}-${version}-${this.newId()}`, id, version };
    this.fs.mkdir(this.stagingPath(handle));
    return handle;
  }

  async uploadToStaging(handle: StagingHandle, file: LocalFile): Promise<UploadedRef> {
    const dest = this.fs.join(this.stagingPath(handle), ...file.path.split("/"));
    this.fs.writeFile(dest, file.data);
    const written = this.fs.readFile(dest);
    return { path: file.path, bytes: written.byteLength, md5: this.hashes.md5(written) };
  }

  /**
   * Copies a file from disk into staging without loading it through the
   * caller: source.aep and previews can be large, and the panel only needs the
   * digests back to build the manifest.
   */
  stageFileFromPath(handle: StagingHandle, relativePath: string, absolutePath: string): LocalFile & UploadedRef {
    const dest = this.fs.join(this.stagingPath(handle), ...relativePath.split("/"));
    this.fs.copyFile(absolutePath, dest);
    const data = this.fs.readFile(dest);
    return {
      path: relativePath,
      bytes: data.byteLength,
      sha256: this.hashes.sha256(data),
      md5: this.hashes.md5(data),
      data,
    };
  }

  stageBytes(handle: StagingHandle, relativePath: string, data: Uint8Array): LocalFile & UploadedRef {
    const dest = this.fs.join(this.stagingPath(handle), ...relativePath.split("/"));
    this.fs.writeFile(dest, data);
    return {
      path: relativePath,
      bytes: data.byteLength,
      sha256: this.hashes.sha256(data),
      md5: this.hashes.md5(data),
      data,
    };
  }

  /** What is actually in staging right now, hashed — the remote's view of the upload. */
  private stagedRefs(handle: StagingHandle): UploadedRef[] {
    const base = this.stagingPath(handle);
    const refs: UploadedRef[] = [];
    const walk = (dir: string, rel: string) => {
      for (const entry of this.fs.readdir(dir)) {
        const p = this.fs.join(dir, entry);
        const r = rel ? `${rel}/${entry}` : entry;
        if (this.fs.stat(p).isDirectory) walk(p, r);
        else if (r !== MANIFEST_EXCLUDED) {
          const data = this.fs.readFile(p);
          refs.push({ path: r, bytes: data.byteLength, md5: this.hashes.md5(data) });
        }
      }
    };
    walk(base, "");
    return refs;
  }

  async finalizePublish(handle: StagingHandle, meta: GmlAsset): Promise<GmlAsset> {
    const staging = this.stagingPath(handle);
    if (!this.fs.exists(staging)) throw new Error(`no such staging upload: ${handle.uploadId}`);

    const asset = gmlAssetSchema.parse(meta);
    const problems = verifyStagedUpload(asset.assets as AssetManifest, this.stagedRefs(handle));
    if (problems.length > 0) {
      throw new PublishVerificationError(`upload for ${handle.id}@${handle.version} is incomplete`, problems);
    }

    // meta.json last: it is the completion marker readers key on.
    this.fs.writeFile(this.fs.join(staging, MANIFEST_EXCLUDED), JSON.stringify(asset, null, 2));

    const statusDir = asset.status === "approved" ? "approved" : "drafts";
    const dest = this.fs.join(this.root, statusDir, asset.id);
    if (this.fs.exists(dest)) this.fs.rm(dest);
    // Same status folder for the other state is removed too: one id lives in one place.
    const other = this.fs.join(this.root, statusDir === "approved" ? "drafts" : "approved", asset.id);
    if (this.fs.exists(other)) this.fs.rm(other);
    this.fs.rename(staging, dest);

    this.refresh();
    return asset;
  }

  async abortPublish(handle: StagingHandle): Promise<void> {
    const staging = this.stagingPath(handle);
    if (this.fs.exists(staging)) this.fs.rm(staging);
  }

  /** Approval is a folder move — visible to every synced machine at once. */
  async setStatus(id: string, status: "draft" | "approved"): Promise<GmlAsset> {
    this.refresh();
    const current = this.sorted().filter((x) => x.asset.id === id).at(-1);
    if (!current) throw new Error(`not found: ${id}`);
    const asset: GmlAsset = { ...current.asset, status, updatedAt: new Date(this.now()).toISOString() };
    this.fs.writeFile(this.fs.join(current.packagePath, MANIFEST_EXCLUDED), JSON.stringify(asset, null, 2));
    const dest = this.fs.join(this.root, status === "approved" ? "approved" : "drafts", id);
    if (dest !== current.packagePath) {
      if (this.fs.exists(dest)) this.fs.rm(dest);
      this.fs.rename(current.packagePath, dest);
    }
    this.refresh();
    return asset;
  }

  async remove(id: string, version?: string): Promise<void> {
    this.refresh();
    for (const entry of [...this.index.values()]) {
      if (entry.asset.id === id && (!version || entry.asset.version === version)) {
        this.fs.rm(entry.packagePath);
      }
    }
    this.refresh();
  }

  /** Drops staged uploads older than the cutoff — an interrupted publish never becomes visible anyway. */
  async collectGarbage(maxAgeMs = 24 * 60 * 60 * 1000): Promise<string[]> {
    const dir = this.fs.join(this.root, STAGING_DIR);
    if (!this.fs.exists(dir)) return [];
    const cutoff = this.now() - maxAgeMs;
    const dropped: string[] = [];
    for (const entry of this.fs.readdir(dir)) {
      const p = this.fs.join(dir, entry);
      if (this.fs.stat(p).mtimeMs < cutoff) {
        this.fs.rm(p);
        dropped.push(entry);
      }
    }
    return dropped;
  }
}
