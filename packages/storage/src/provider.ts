import type { AssetManifest, GmlAsset } from "@gml/core";

/**
 * The only storage surface the panels ever see. Swapping Google Drive for a
 * database does not require rewriting the AE panel, the Illustrator panel, or
 * the core product logic — authentication, permissions, pagination, queries,
 * concurrency and upload strategy may all change, but those changes stay
 * inside an implementation of this interface.
 */

export interface Page<T> {
  items: T[];
  /** Opaque; pass back to `list` to continue. Absent when the page is last. */
  cursor?: string;
}

export interface ListOptions {
  cursor?: string;
  /** ISO timestamp — providers may use it to return only what changed. */
  since?: string;
}

/** Handle for an in-flight publish. Nothing is visible to readers until finalize. */
export interface StagingHandle {
  uploadId: string;
  id: string;
  version: string;
}

export interface LocalFile {
  /** Package-relative path, e.g. "footage/logo.ai". */
  path: string;
  bytes: number;
  md5: string;
  sha256: string;
  data: Uint8Array;
}

/** What the remote reports back after storing a file. */
export interface UploadedRef {
  path: string;
  bytes: number;
  /**
   * Drive does not populate sha256Checksum or sha1Checksum for items in
   * Shared Drives, so md5 is the only checksum the remote can give us.
   */
  md5: string;
}

export type ProgressFn = (done: number, total: number) => void;

export interface LibraryProvider {
  list(opts?: ListOptions): Promise<Page<GmlAsset>>;
  get(id: string, version?: string): Promise<GmlAsset>;
  /** Downloads the whole package — never source.aep alone. Returns its local root. */
  fetchPackage(id: string, version: string, onProgress?: ProgressFn): Promise<string>;
  beginPublish(id: string, version: string): Promise<StagingHandle>;
  uploadToStaging(handle: StagingHandle, file: LocalFile): Promise<UploadedRef>;
  finalizePublish(handle: StagingHandle, meta: GmlAsset): Promise<GmlAsset>;
  abortPublish(handle: StagingHandle): Promise<void>;
  remove(id: string, version?: string): Promise<void>;
}

export class PublishVerificationError extends Error {
  constructor(
    message: string,
    readonly problems: readonly string[],
  ) {
    super(message);
    this.name = "PublishVerificationError";
  }
}

/**
 * Compares what the manifest promised against what the remote acknowledged.
 * An upload that died halfway fails here, so the asset never moves out of
 * staging and readers never see a half-written package.
 */
export function verifyStagedUpload(
  manifest: AssetManifest,
  uploaded: readonly UploadedRef[],
): string[] {
  const problems: string[] = [];
  const byPath = new Map(uploaded.map((u) => [u.path, u]));

  for (const [path, expected] of Object.entries(manifest)) {
    const actual = byPath.get(path);
    if (!actual) {
      problems.push(`missing from upload: ${path}`);
      continue;
    }
    if (actual.bytes !== expected.bytes) {
      problems.push(`size mismatch: ${path} (${actual.bytes} != ${expected.bytes})`);
    }
    if (actual.md5 !== expected.md5) {
      problems.push(`md5 mismatch: ${path}`);
    }
  }

  for (const u of uploaded) {
    if (!(u.path in manifest)) problems.push(`unexpected file in upload: ${u.path}`);
  }

  return problems;
}
