import { assetKey, decodeStamp, emptyIndex, type Deliverable, type LibraryAsset, type LibraryIndex, type Stamp } from "@gml/core";
import {
  AssetFetcher,
  CACHE_LAYOUT,
  CacheStore,
  DriveApiTransport,
  MountTransport,
  TokenManager,
  defaultCacheRoot,
  pathToFileUrl,
  publishAsset,
  scanLibrary,
  type AepComp,
  type AssetTransport,
  type FetchState as StorageFetchState,
  type IdCache,
  type PublishInput,
  type PublishProgress,
  type ScanReport,
} from "@gml/storage";
import type { FetchService, FetchState, LibrarySource } from "@gml/ui";
import { fileTokenStore, signInWithGoogle } from "./auth-flow.js";
import { DEFAULT_CACHE_CAP_GB, driveRootPathFromMount, type GmlConfig } from "./config.js";
import type { PanelNode } from "./node.js";

/**
 * Everything the panel needs from Node in one object: the cache, the index,
 * the fetcher and its transport, posters, sign-in and publishing. The UI
 * talks to it only through LibrarySource, FetchService and the HostBridge.
 */
export interface RuntimeStatus {
  libraryRoot: string | null;
  libraryMounted: boolean;
  cacheRoot: string;
  transport: string;
  signedIn: boolean;
  account?: string;
  indexedAt: string | null;
  assets: number;
}

export interface RuntimeOptions {
  node: PanelNode;
  config: GmlConfig;
  /** Browser-side PNG extraction; injected so this module stays DOM-free. */
  makePoster?: (fileUrl: string) => Promise<Uint8Array>;
  /** After Effects reads comps out of project files; Illustrator cannot. */
  inspectAep?: (absPath: string) => Promise<AepComp[]>;
  onLog?: (message: string) => void;
}

export class LibraryRuntime {
  readonly node: PanelNode;
  config: GmlConfig;
  readonly store: CacheStore;
  readonly fetcher: AssetFetcher;
  readonly cacheRoot: string;
  private index: LibraryIndex;
  private tokens: TokenManager | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly makePoster?: (fileUrl: string) => Promise<Uint8Array>;
  private readonly inspectAep?: (absPath: string) => Promise<AepComp[]>;
  private readonly log: (m: string) => void;
  private posterRun: Promise<void> | null = null;
  scanning = false;
  lastScan: ScanReport | null = null;

  constructor(options: RuntimeOptions) {
    this.node = options.node;
    this.config = options.config;
    this.makePoster = options.makePoster;
    this.inspectAep = options.inspectAep;
    this.log = options.onLog ?? (() => {});

    const node = this.node;
    this.cacheRoot =
      this.config.cacheRoot ?? defaultCacheRoot({ platform: node.platform, homedir: node.homedir, env: node.env }, (...p) => node.path.join(...p));
    this.store = new CacheStore({ root: this.cacheRoot, fs: node.fs });
    this.store.ensureLayout();
    this.index = this.store.readIndex() ?? emptyIndex(this.config.libraryRoot ?? "");

    this.fetcher = new AssetFetcher({
      store: this.store,
      fs: node.fs,
      transport: this.buildTransport(),
      hashes: node.hashes,
      pid: node.pid,
      isAlive: (pid) => node.isProcessAlive(pid),
    });
  }

  // ---- configuration ------------------------------------------------------

  private tokenStore() {
    return fileTokenStore(this.node, this.store.authPath("google.json"));
  }

  private driveClient() {
    const id = this.config.drive?.clientId?.trim();
    if (!id) return null;
    return { clientId: id, clientSecret: this.config.drive?.clientSecret?.trim() || undefined };
  }

  private idCache(): IdCache {
    const p = this.node.path.join(this.cacheRoot, CACHE_LAYOUT.driveIds);
    let map: Record<string, string> = {};
    try {
      if (this.node.exists(p)) map = JSON.parse(new TextDecoder().decode(this.node.readFile(p))) as Record<string, string>;
    } catch {
      map = {};
    }
    const flush = () => this.store.writeAtomic(p, JSON.stringify(map));
    return {
      get: (rel) => map[rel],
      set: (rel, id) => {
        map[rel] = id;
        flush();
      },
      clear: () => {
        map = {};
        flush();
      },
    };
  }

  private buildTransport(): AssetTransport {
    const client = this.driveClient();
    if (this.config.transport === "drive" && client) {
      this.tokens = new TokenManager(this.node.http, client, this.tokenStore());
      const rootPath = this.config.drive?.rootPath?.trim() || (this.config.libraryRoot ? driveRootPathFromMount(this.config.libraryRoot) : null);
      if (this.tokens.signedIn() && rootPath) {
        return new DriveApiTransport({ http: this.node.http, tokens: this.tokens, rootPath, idCache: this.idCache() });
      }
    } else {
      this.tokens = null;
    }
    return new MountTransport(this.node.fs, this.config.libraryRoot ?? "");
  }

  /** Re-reads config; swaps the transport underneath the fetcher without touching anything else. */
  applyConfig(config: GmlConfig): void {
    this.config = config;
    this.fetcher.setTransport(this.buildTransport());
    this.emit();
  }

  status(): RuntimeStatus {
    const root = this.config.libraryRoot ?? null;
    return {
      libraryRoot: root,
      libraryMounted: Boolean(root && this.node.exists(root)),
      cacheRoot: this.cacheRoot,
      transport: this.fetcher.transportName,
      signedIn: this.tokens?.signedIn() ?? false,
      account: this.tokens?.account(),
      indexedAt: this.index.assets.length > 0 ? this.index.scannedAt : null,
      assets: this.index.assets.length,
    };
  }

  // ---- sign-in ----------------------------------------------------------------

  async signIn(): Promise<void> {
    const client = this.driveClient();
    if (!client) throw new Error("Enter the OAuth client ID first.");
    await signInWithGoogle(this.node, client, this.tokenStore());
    this.applyConfig({ ...this.config, transport: "drive" });
  }

  async signOut(): Promise<void> {
    if (this.tokens) await this.tokens.signOut();
    else this.tokenStore().clear();
    this.applyConfig({ ...this.config, transport: "mount" });
  }

  // ---- index ------------------------------------------------------------------

  currentIndex(): LibraryIndex {
    return this.index;
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  readonly source: LibrarySource = {
    load: async () => this.index,
    subscribe: (listener) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },
  };

  async scan(onProgress?: (message: string) => void): Promise<ScanReport> {
    const root = this.config.libraryRoot;
    if (!root) throw new Error("Choose the library folder first.");
    if (!this.node.exists(root)) throw new Error(`The library is not reachable at ${root}. Is Google Drive for Desktop running?`);
    this.scanning = true;
    try {
      const report = await scanLibrary({
        fs: this.node.fs,
        libraryRoot: root,
        previous: this.index.libraryRoot === root ? this.index : null,
        inspectAep: this.inspectAep,
        onProgress: (m) => {
          this.log(m);
          onProgress?.(m);
        },
      });
      this.index = report.index;
      this.store.writeIndex(report.index);
      this.lastScan = report;
      this.emit();
      void this.ensurePosters();
      return report;
    } finally {
      this.scanning = false;
    }
  }

  // ---- posters and previews -------------------------------------------------

  posterUrl(asset: LibraryAsset): string | null {
    const p = this.store.posterPath(asset.poster.cacheKey);
    return this.store.isComplete(p) ? pathToFileUrl(p) : null;
  }

  previewUrl(asset: LibraryAsset): string | null {
    if (!asset.preview) return null;
    const p = this.store.previewPath(asset.id);
    return this.store.isComplete(p, asset.preview.bytes) ? pathToFileUrl(p) : null;
  }

  /**
   * Previews are light and fetched eagerly; posters are generated from them
   * once. Runs in the background, one file at a time, and never twice at once.
   */
  ensurePosters(): Promise<void> {
    if (this.posterRun) return this.posterRun;
    this.posterRun = (async () => {
      for (const asset of this.index.assets) {
        try {
          if (!asset.preview) continue;
          const previewPath = this.store.previewPath(asset.id);
          if (!this.store.isComplete(previewPath, asset.preview.bytes)) {
            await this.fetcher.fetchPreview(asset);
            this.emit();
          }
          const posterPath = this.store.posterPath(asset.poster.cacheKey);
          if (!this.store.isComplete(posterPath) && this.makePoster) {
            const png = await this.makePoster(pathToFileUrl(previewPath));
            this.store.writeAtomic(posterPath, png);
            this.emit();
          }
        } catch (error) {
          this.log(`poster for ${asset.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    })().finally(() => {
      this.posterRun = null;
    });
    return this.posterRun;
  }

  // ---- fetching -------------------------------------------------------------

  private toUiState(state: StorageFetchState): FetchState {
    return { status: state.status, done: state.done, total: state.total, error: state.error };
  }

  readonly fetchService: FetchService = {
    state: (asset, deliverable) => this.toUiState(this.fetcher.state(asset, deliverable)),
    subscribe: (listener) => this.fetcher.subscribe(() => listener()),
    fetch: (asset, deliverable) => this.fetcher.fetch(asset, deliverable),
    prefetch: (asset, deliverable) => {
      void this.fetcher.fetch(asset, deliverable).catch(() => {});
    },
  };

  localPath(asset: LibraryAsset, deliverable: Deliverable): string {
    return this.fetcher.localPath(asset, deliverable);
  }

  libraryPath(relPath: string): string | null {
    return this.config.libraryRoot ? this.node.path.join(this.config.libraryRoot, ...relPath.split("/")) : null;
  }

  // ---- cache management -------------------------------------------------------

  capBytes(): number {
    return (this.config.cacheCapGB ?? DEFAULT_CACHE_CAP_GB) * 1024 ** 3;
  }

  /** Pins every version the open project references, then evicts to the cap. */
  refreshPins(stamps: readonly Stamp[]): { pinned: number; removed: string[] } {
    const pins = stamps.map((s) => assetKey(s.id, s.version));
    this.store.writePins(pins);
    const result = this.store.evict(this.capBytes(), new Set(pins));
    return { pinned: pins.length, removed: result.removed };
  }

  static stampsFrom(raw: readonly string[]): Stamp[] {
    return raw.map((s) => decodeStamp(s)).filter((s): s is Stamp => s !== null);
  }

  // ---- publishing ---------------------------------------------------------------

  async publish(input: PublishInput, onProgress?: (p: PublishProgress) => void): Promise<{ relDir: string; files: string[] }> {
    const transport = this.fetcher.transportName === "drive-api" ? this.buildTransport() : new MountTransport(this.node.fs, this.config.libraryRoot ?? "");
    if (transport.name === "mount" && !this.node.exists(this.config.libraryRoot ?? "")) {
      throw new Error("The library folder is not reachable; publishing needs Google Drive for Desktop or a Drive sign-in.");
    }
    return publishAsset(this.node.fs, transport, input, onProgress);
  }
}
