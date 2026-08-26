import type { GmlAsset, InstalledEnvironment } from "@gml/core";
import { sampleLibrary } from "@gml/core";
import { MockLibraryProvider } from "@gml/storage";
import type { LibraryProvider } from "@gml/storage";
import {
  AE_CAPABILITIES,
  AI_CAPABILITIES,
  type AssetRef,
  type HostBridge,
  type HostCapabilities,
  type HostResult,
  type HostTarget,
} from "./host.js";

/**
 * A HostBridge that records what the panel asked for instead of talking to
 * Adobe. This is what lets the whole UI be exercised in the harness and in CI
 * without After Effects or Illustrator running.
 */
export class FakeHostBridge implements HostBridge {
  readonly applied: AssetRef[][] = [];
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
    } = {},
  ) {}

  async getTarget(): Promise<HostTarget> {
    return this.options.target ?? { kind: "comp", name: "Homepage_Intro" };
  }

  async getEnvironment(): Promise<InstalledEnvironment> {
    return this.options.environment ?? { fonts: [], effectMatchNames: [] };
  }

  async applyAssets(refs: readonly AssetRef[]): Promise<HostResult> {
    this.applied.push([...refs]);
    return this.options.applyResult ?? { ok: true };
  }

  resolveUrl(asset: { id: string; version: string }, relativePath: string): string {
    return `gml://${asset.id}/${asset.version}/${relativePath}`;
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
}

export function aeBridge(options?: ConstructorParameters<typeof FakeHostBridge>[1]) {
  return new FakeHostBridge(AE_CAPABILITIES, options);
}

export function aiBridge(options?: ConstructorParameters<typeof FakeHostBridge>[1]) {
  return new FakeHostBridge(AI_CAPABILITIES, {
    target: { kind: "artboard", name: "Shot_03" },
    ...options,
  });
}

export function mockProvider(seed: readonly GmlAsset[] = sampleLibrary()): LibraryProvider {
  return new MockLibraryProvider({ seed });
}
