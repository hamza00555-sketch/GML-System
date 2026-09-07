import { assetKey, sampleIndex, type Deliverable, type InstalledEnvironment, type LibraryAsset, type LibraryIndex, type Stamp } from "@gml/core";
import type { FetchService, FetchState } from "./fetch.js";
import { AE_CAPABILITIES, AI_CAPABILITIES, type ApplyItem, type HostBridge, type HostCapabilities, type HostResult, type HostTarget } from "./host.js";
import type { LibrarySource } from "./library.js";
import { placeholderPoster } from "./placeholder.js";

/**
 * Fakes for the harness and the tests: a HostBridge that records what the
 * panel asked for, a FetchService whose downloads can be driven by hand, and
 * a LibrarySource over a fixture index.
 */
export class FakeHostBridge implements HostBridge {
  readonly applied: ApplyItem[][] = [];
  readonly savedCopies: ApplyItem[] = [];
  tagsVisible = true;
  resyncCount = 0;
  exportCount = 0;
  publishCount = 0;

  constructor(
    readonly capabilities: HostCapabilities = AE_CAPABILITIES,
    private readonly options: {
      target?: HostTarget;
      environment?: InstalledEnvironment;
      applyResult?: HostResult;
      stamps?: Stamp[];
      /** Which assets have a cached preview; all by default. */
      previews?: "all" | "none";
    } = {},
  ) {}

  async getTarget(): Promise<HostTarget> {
    return this.options.target ?? { kind: "comp", name: "Homepage_Intro" };
  }

  async getEnvironment(): Promise<InstalledEnvironment> {
    return this.options.environment ?? { fonts: [], effectMatchNames: [] };
  }

  async getProjectStamps(): Promise<Stamp[]> {
    return this.options.stamps ?? [];
  }

  async applyAssets(items: readonly ApplyItem[]): Promise<HostResult> {
    this.applied.push([...items]);
    return this.options.applyResult ?? { ok: true };
  }

  posterUrl(asset: LibraryAsset): string {
    return placeholderPoster(asset.id, asset.category);
  }

  previewUrl(asset: LibraryAsset): string | null {
    return this.options.previews === "none" ? null : `gml-preview://${assetKey(asset.id, asset.version)}`;
  }

  async setTagsVisible(visible: boolean): Promise<HostResult> {
    this.tagsVisible = visible;
    return { ok: true };
  }

  async resyncTags(): Promise<HostResult> {
    this.resyncCount += 1;
    return { ok: true };
  }

  async exportStoryboard(): Promise<HostResult> {
    this.exportCount += 1;
    return { ok: true };
  }

  async publishComp(): Promise<HostResult> {
    this.publishCount += 1;
    return { ok: true };
  }

  async saveCopy(item: ApplyItem): Promise<HostResult> {
    this.savedCopies.push(item);
    return { ok: true, message: `saved ${item.localPath}` };
  }
}

export function aeBridge(options?: ConstructorParameters<typeof FakeHostBridge>[1]) {
  return new FakeHostBridge(AE_CAPABILITIES, options);
}

export function aiBridge(options?: ConstructorParameters<typeof FakeHostBridge>[1]) {
  return new FakeHostBridge(AI_CAPABILITIES, { target: { kind: "artboard", name: "Shot_03" }, ...options });
}

export function fakeSource(index: LibraryIndex = sampleIndex()): LibrarySource & { index: LibraryIndex } {
  return { index, load: async () => index };
}

/**
 * Deterministic fetches. In "manual" mode a fetch stays at `fetching` until
 * the test calls `advance(key, bytes)` or `complete(key)`, which is how the
 * cloud → fetching → ready sequence is asserted.
 */
export class FakeFetchService implements FetchService {
  private readonly states = new Map<string, FetchState>();
  private readonly waiters = new Map<string, (path: string) => void>();
  private readonly listeners = new Set<() => void>();
  readonly fetched: string[] = [];
  readonly prefetched: string[] = [];

  constructor(
    private readonly mode: "instant" | "manual" = "instant",
    private readonly cacheRoot = "C:/Users/h/AppData/Local/GML",
    ready: string[] = [],
  ) {
    for (const key of ready) this.states.set(key, { status: "ready", done: 1, total: 1 });
  }

  key(asset: LibraryAsset, deliverable: Deliverable): string {
    return `${assetKey(asset.id, asset.version)}/${deliverable.relPath.split("/").pop()}`;
  }

  private localPath(asset: LibraryAsset, deliverable: Deliverable): string {
    return `${this.cacheRoot}/assets/${asset.id}/v${asset.version}/${deliverable.relPath.split("/").pop()}`;
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  state(asset: LibraryAsset, deliverable: Deliverable): FetchState {
    return this.states.get(this.key(asset, deliverable)) ?? { status: "cloud", done: 0, total: deliverable.bytes };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  prefetch(asset: LibraryAsset, deliverable: Deliverable): void {
    this.prefetched.push(this.key(asset, deliverable));
    void this.fetch(asset, deliverable).catch(() => {});
  }

  fetch(asset: LibraryAsset, deliverable: Deliverable): Promise<string> {
    const key = this.key(asset, deliverable);
    const path = this.localPath(asset, deliverable);
    const current = this.state(asset, deliverable);
    if (current.status === "ready") return Promise.resolve(path);
    this.fetched.push(key);
    if (this.mode === "instant") {
      this.states.set(key, { status: "ready", done: deliverable.bytes, total: deliverable.bytes });
      this.emit();
      return Promise.resolve(path);
    }
    this.states.set(key, { status: "fetching", done: 0, total: deliverable.bytes });
    this.emit();
    return new Promise((resolve) => this.waiters.set(key, resolve));
  }

  advance(key: string, done: number): void {
    const current = this.states.get(key);
    if (!current) return;
    this.states.set(key, { ...current, status: "fetching", done });
    this.emit();
  }

  complete(key: string): void {
    const current = this.states.get(key);
    const total = current?.total ?? 1;
    this.states.set(key, { status: "ready", done: total, total });
    this.emit();
    const [id, version, file] = key.match(/^(.+)@v(\d+)\/(.+)$/)!.slice(1);
    this.waiters.get(key)?.(`${this.cacheRoot}/assets/${id}/v${version}/${file}`);
    this.waiters.delete(key);
  }
}
