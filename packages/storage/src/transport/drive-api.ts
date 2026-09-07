import { withBackoff, type BackoffOptions } from "./backoff.js";
import { bodyJson, bodyText, type HttpClient } from "./http.js";
import type { TokenManager } from "./oauth.js";
import { TransportError, isAborted, type AssetTransport, type FetchRangeOptions, type FetchRangeResult, type FileSource, type RemoteStat } from "./types.js";

/**
 * Google Drive API v3 transport.
 *
 *  - Library-relative paths resolve to file ids by walking the Shared Drive
 *    folder by folder; ids are cached because names never move underneath us.
 *  - Downloads use files.get?alt=media with an HTTP Range, so an interrupted
 *    multi-gigabyte fetch resumes instead of restarting.
 *  - 403 rateLimitExceeded / userRateLimitExceeded, 429 and 5xx back off
 *    exponentially with jitter, capped at 64 s.
 *  - Uploads (publishing) use resumable sessions in 8 MB chunks.
 */

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const ALL_DRIVES = "supportsAllDrives=true&includeItemsFromAllDrives=true";

export interface IdCache {
  get(relPath: string): string | undefined;
  set(relPath: string, id: string): void;
  clear(): void;
}

export interface DriveApiOptions {
  http: HttpClient;
  tokens: TokenManager;
  /**
   * Where the library root sits: the Shared Drive's name, then the folder
   * path inside it — "Motion/Hamza/2026/Motion Library".
   */
  rootPath: string;
  idCache?: IdCache;
  backoff?: BackoffOptions;
  uploadChunkBytes?: number;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  md5Checksum?: string;
  modifiedTime?: string;
}

const FOLDER = "application/vnd.google-apps.folder";

export function escapeQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function isRetryableStatus(status: number, body: string): boolean {
  if (status === 429 || status >= 500) return true;
  if (status === 403 && /rateLimitExceeded|userRateLimitExceeded/i.test(body)) return true;
  return false;
}

class MemoryIdCache implements IdCache {
  private readonly map = new Map<string, string>();
  get(rel: string) {
    return this.map.get(rel);
  }
  set(rel: string, id: string) {
    this.map.set(rel, id);
  }
  clear() {
    this.map.clear();
  }
}

export class DriveApiTransport implements AssetTransport {
  readonly name = "drive-api";
  private readonly http: HttpClient;
  private readonly tokens: TokenManager;
  private readonly rootPath: string;
  private readonly ids: IdCache;
  private readonly backoff: BackoffOptions;
  private readonly uploadChunkBytes: number;

  constructor(options: DriveApiOptions) {
    this.http = options.http;
    this.tokens = options.tokens;
    this.rootPath = options.rootPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    this.ids = options.idCache ?? new MemoryIdCache();
    this.backoff = options.backoff ?? {};
    this.uploadChunkBytes = options.uploadChunkBytes ?? 8 * 1024 * 1024;
  }

  private async call<T>(method: "GET" | "POST" | "PUT" | "PATCH", url: string, init: { body?: string | Uint8Array; headers?: Record<string, string> } = {}): Promise<T> {
    return withBackoff(
      async () => {
        const token = await this.tokens.accessToken();
        const res = await this.http.request({
          method,
          url,
          headers: { authorization: `Bearer ${token}`, ...init.headers },
          body: init.body,
        });
        if (res.status >= 400) {
          const text = bodyText(res);
          throw new TransportError(`Drive ${res.status}: ${text.slice(0, 300)}`, res.status, isRetryableStatus(res.status, text));
        }
        return bodyJson<T>(res);
      },
      { ...this.backoff, isRetryable: (e) => e instanceof TransportError && e.retryable },
    );
  }

  private async findChild(parentId: string | null, name: string, driveId: string | null): Promise<DriveFile | null> {
    const q = parentId ? `name = '${escapeQuery(name)}' and '${parentId}' in parents and trashed = false` : `name = '${escapeQuery(name)}' and trashed = false`;
    const corpora = driveId ? `&corpora=drive&driveId=${driveId}` : "";
    const url = `${API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("files(id,name,mimeType,size,md5Checksum,modifiedTime)")}&${ALL_DRIVES}${corpora}&pageSize=10`;
    const res = await this.call<{ files: DriveFile[] }>("GET", url);
    return res.files[0] ?? null;
  }

  private async sharedDriveId(name: string): Promise<string> {
    const cached = this.ids.get(`drive:${name}`);
    if (cached) return cached;
    const url = `${API}/drives?q=${encodeURIComponent(`name = '${escapeQuery(name)}'`)}&fields=${encodeURIComponent("drives(id,name)")}&pageSize=10`;
    const res = await this.call<{ drives: { id: string; name: string }[] }>("GET", url);
    const drive = res.drives.find((d) => d.name === name) ?? res.drives[0];
    if (!drive) throw new TransportError(`Shared Drive "${name}" not found or not shared with this account`, 404);
    this.ids.set(`drive:${name}`, drive.id);
    return drive.id;
  }

  /** Resolves a library-relative path to a Drive file id, caching every step. */
  async resolve(relPath: string, createFolders = false): Promise<{ id: string; driveId: string; file?: DriveFile }> {
    const segments = [...this.rootPath.split("/"), ...relPath.split("/")].filter(Boolean);
    const driveName = segments[0]!;
    const driveId = await this.sharedDriveId(driveName);
    let parentId = driveId;
    let file: DriveFile | undefined;
    let walked = driveName;

    for (let i = 1; i < segments.length; i++) {
      const name = segments[i]!;
      walked = `${walked}/${name}`;
      const cached = this.ids.get(walked);
      // Folders are trusted from the cache; a file leaf is always re-checked
      // so a re-rendered deliverable is picked up by id.
      if (cached && (i < segments.length - 1 || createFolders)) {
        parentId = cached;
        continue;
      }
      let found = await this.findChild(parentId, name, driveId);
      if (!found) {
        // createFolders is only ever passed for folder paths (publishing),
        // so every missing segment, the last included, is a folder to make.
        if (!createFolders) throw new TransportError(`not in Drive: ${walked}`, 404);
        found = await this.call<DriveFile>("POST", `${API}/files?supportsAllDrives=true&fields=id,name,mimeType`, {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }),
        });
      }
      this.ids.set(walked, found.id);
      parentId = found.id;
      file = found;
    }
    return { id: parentId, driveId, file };
  }

  async stat(relPath: string): Promise<RemoteStat | null> {
    try {
      const { id } = await this.resolve(relPath);
      const meta = await this.call<DriveFile>("GET", `${API}/files/${id}?fields=size,md5Checksum,modifiedTime&supportsAllDrives=true`);
      return {
        bytes: Number(meta.size ?? 0),
        md5: meta.md5Checksum,
        mtimeMs: meta.modifiedTime ? Date.parse(meta.modifiedTime) : undefined,
      };
    } catch (error) {
      if (error instanceof TransportError && error.status === 404) return null;
      throw error;
    }
  }

  async fetchRange(relPath: string, options: FetchRangeOptions): Promise<FetchRangeResult> {
    const { id } = await this.resolve(relPath);
    const meta = await this.stat(relPath);
    const total = meta?.bytes ?? options.expectedBytes ?? 0;
    let offset = options.offset;
    if (total > 0 && offset >= total) return { bytes: total, md5: meta?.md5 };

    await withBackoff(
      async () => {
        if (isAborted(options.signal)) throw new TransportError("fetch aborted");
        const token = await this.tokens.accessToken();
        const res = await this.http.request({
          method: "GET",
          url: `${API}/files/${id}?alt=media&supportsAllDrives=true`,
          headers: { authorization: `Bearer ${token}`, range: `bytes=${offset}-` },
          signal: options.signal,
          onChunk: (chunk) => {
            options.onChunk(chunk);
            offset += chunk.byteLength;
            options.onProgress?.(offset, total);
          },
        });
        if (res.status === 416) return; // nothing left — we already hold it all
        if (res.status !== 200 && res.status !== 206) {
          const text = bodyText(res);
          throw new TransportError(`Drive download ${res.status}: ${text.slice(0, 300)}`, res.status, isRetryableStatus(res.status, text));
        }
        if (res.status === 200 && options.offset > 0 && offset > options.offset) {
          // The server ignored the Range: everything already streamed is a
          // restart from zero, which the caller cannot append. Refuse loudly.
          throw new TransportError("Drive ignored the Range header; cannot resume", 200, false);
        }
      },
      {
        ...this.backoff,
        // A retry resumes from `offset`, which the onChunk above kept current.
        isRetryable: (e) => e instanceof TransportError && e.retryable && !isAborted(options.signal),
      },
    );
    return { bytes: total || offset, md5: meta?.md5 };
  }

  /** Resumable upload into the folder the path names; folders are created as needed. */
  async putFile(relPath: string, source: FileSource, onProgress?: (done: number, total: number) => void): Promise<void> {
    const slash = relPath.lastIndexOf("/");
    const dir = slash === -1 ? "" : relPath.slice(0, slash);
    const name = slash === -1 ? relPath : relPath.slice(slash + 1);
    const { id: parentId, driveId } = await this.resolve(dir, true);

    // Replace rather than duplicate: Drive happily stores two files of one name.
    const existing = await this.findChild(parentId, name, driveId);
    const sessionUrl = existing
      ? `${UPLOAD}/files/${existing.id}?uploadType=resumable&supportsAllDrives=true`
      : `${UPLOAD}/files?uploadType=resumable&supportsAllDrives=true`;

    const token = await this.tokens.accessToken();
    const start = await this.http.request({
      method: existing ? "PATCH" : "POST",
      url: sessionUrl,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-length": String(source.size),
      },
      body: JSON.stringify(existing ? {} : { name, parents: [parentId] }),
    });
    if (start.status !== 200) throw new TransportError(`Drive upload session ${start.status}: ${bodyText(start).slice(0, 300)}`, start.status);
    const location = start.headers.location ?? start.headers.Location;
    if (!location) throw new TransportError("Drive upload session returned no Location");

    let offset = 0;
    while (offset < source.size) {
      const length = Math.min(this.uploadChunkBytes, source.size - offset);
      const chunk = source.read(offset, length);
      const end = offset + chunk.byteLength - 1;
      const res = await withBackoff(
        async () => {
          const r = await this.http.request({
            method: "PUT",
            url: location,
            headers: { "content-range": `bytes ${offset}-${end}/${source.size}`, "content-length": String(chunk.byteLength) },
            body: chunk,
          });
          if (r.status >= 500 || r.status === 429) throw new TransportError(`Drive upload ${r.status}`, r.status, true);
          return r;
        },
        { ...this.backoff, isRetryable: (e) => e instanceof TransportError && e.retryable },
      );
      if (res.status === 308) {
        const range = res.headers.range ?? res.headers.Range;
        const m = range ? /bytes=\d+-(\d+)/.exec(range) : null;
        offset = m ? Number(m[1]) + 1 : offset + chunk.byteLength;
      } else if (res.status === 200 || res.status === 201) {
        offset = source.size;
      } else {
        throw new TransportError(`Drive upload ${res.status}: ${bodyText(res).slice(0, 300)}`, res.status);
      }
      onProgress?.(offset, source.size);
    }
  }
}
