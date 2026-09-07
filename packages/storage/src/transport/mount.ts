import type { FolderFs } from "../fs.js";
import { TransportError, isAborted, type AssetTransport, type FetchRangeOptions, type FetchRangeResult, type FileSource, type RemoteStat } from "./types.js";

/**
 * Transport over the Google Drive for Desktop mount (or any folder). Chunks
 * are read in ranges, so Drive streams only what is asked for and an
 * interrupted copy resumes where it stopped. This is also the fallback while
 * no OAuth client has been configured.
 */
export const MOUNT_CHUNK_BYTES = 4 * 1024 * 1024;

export class MountTransport implements AssetTransport {
  readonly name = "mount";

  constructor(
    private readonly fs: FolderFs,
    readonly libraryRoot: string,
    private readonly chunkBytes = MOUNT_CHUNK_BYTES,
  ) {}

  private abs(relPath: string): string {
    return this.fs.join(this.libraryRoot, ...relPath.split("/"));
  }

  async stat(relPath: string): Promise<RemoteStat | null> {
    const p = this.abs(relPath);
    if (!this.fs.exists(p)) return null;
    const s = this.fs.stat(p);
    return { bytes: s.size, mtimeMs: s.mtimeMs };
  }

  async fetchRange(relPath: string, options: FetchRangeOptions): Promise<FetchRangeResult> {
    const p = this.abs(relPath);
    if (!this.fs.exists(p)) throw new TransportError(`not in the library: ${relPath}`, 404);
    const total = this.fs.stat(p).size;
    let offset = options.offset;
    while (offset < total) {
      if (isAborted(options.signal)) throw new TransportError("fetch aborted", undefined, true);
      const chunk = this.fs.readRange(p, offset, Math.min(this.chunkBytes, total - offset));
      if (chunk.byteLength === 0) throw new TransportError(`short read at ${offset} of ${relPath}`, undefined, true);
      options.onChunk(chunk);
      offset += chunk.byteLength;
      options.onProgress?.(offset, total);
      // Yield so the panel can paint progress and honour aborts.
      await Promise.resolve();
    }
    return { bytes: total };
  }

  async putFile(relPath: string, source: FileSource, onProgress?: (done: number, total: number) => void): Promise<void> {
    const dest = this.abs(relPath);
    const dir = this.fs.dirname(dest);
    if (!this.fs.exists(dir)) this.fs.mkdir(dir);
    const part = `${dest}.part`;
    if (this.fs.exists(part)) this.fs.rm(part);
    this.fs.writeFile(part, new Uint8Array(0));
    let offset = 0;
    while (offset < source.size) {
      const chunk = source.read(offset, Math.min(this.chunkBytes, source.size - offset));
      this.fs.appendFile(part, chunk);
      offset += chunk.byteLength;
      onProgress?.(offset, source.size);
      await Promise.resolve();
    }
    if (this.fs.exists(dest)) this.fs.rm(dest);
    this.fs.rename(part, dest);
  }
}

/** Wraps a local file for putFile. */
export function fileSource(fs: FolderFs, absPath: string): FileSource {
  const size = fs.stat(absPath).size;
  return { size, read: (offset, length) => fs.readRange(absPath, offset, length) };
}
