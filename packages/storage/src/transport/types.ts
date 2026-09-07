/**
 * The one seam every byte crosses. Google Drive today; an object-storage
 * mirror tomorrow must be swappable without touching any other module.
 */

export interface FetchRangeOptions {
  /** Resume point: the number of bytes the caller already holds. */
  offset: number;
  /** Total size when known — lets progress be a real percentage. */
  expectedBytes?: number;
  onChunk(chunk: Uint8Array): void;
  onProgress?(done: number, total: number): void;
  signal?: AbortSignal;
}

export interface FetchRangeResult {
  /** Total bytes of the remote file, offset included. */
  bytes: number;
  /** When the remote can vouch for content; verified after the download. */
  md5?: string;
}

export interface RemoteStat {
  bytes: number;
  md5?: string;
  mtimeMs?: number;
}

/** A local file handed to putFile, read in ranges so multi-GB uploads stream. */
export interface FileSource {
  size: number;
  read(offset: number, length: number): Uint8Array;
}

export interface AssetTransport {
  readonly name: string;
  fetchRange(relPath: string, options: FetchRangeOptions): Promise<FetchRangeResult>;
  stat(relPath: string): Promise<RemoteStat | null>;
  /** Publishing. Writes are always user-initiated. */
  putFile?(relPath: string, source: FileSource, onProgress?: (done: number, total: number) => void): Promise<void>;
}

export class TransportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "TransportError";
  }
}

export function isAborted(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted);
}
