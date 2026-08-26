import type { Category, GmlAsset, InstalledEnvironment } from "@gml/core";
import { placeholderPeaks, placeholderPoster } from "@gml/ui";
import type { AssetRef, HostBridge, HostCapabilities, HostResult, HostTarget } from "@gml/ui";
import { callHost, cepAvailable, extensionId, systemPath } from "./csinterface.js";

/**
 * The real HostBridge: every call becomes an ExtendScript function invocation.
 *
 * The two panels differ only in their capabilities and in which host functions
 * exist, so one implementation serves both.
 */
export interface CepBridgeOptions {
  capabilities: HostCapabilities;
  /** Looked up to colour placeholder posters until the real cache exists. */
  assets?: readonly GmlAsset[];
  /** Surfaces host failures in the panel rather than swallowing them. */
  onError?: (context: string, error: unknown) => void;
}

export class CepHostBridge implements HostBridge {
  readonly capabilities: HostCapabilities;
  private readonly assets: readonly GmlAsset[];
  private readonly onError: (context: string, error: unknown) => void;

  constructor(options: CepBridgeOptions) {
    this.capabilities = options.capabilities;
    this.assets = options.assets ?? [];
    this.onError = options.onError ?? (() => {});
  }

  private async safely<T>(context: string, run: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await run();
    } catch (error) {
      this.onError(context, error);
      return fallback;
    }
  }

  async getTarget(): Promise<HostTarget> {
    return this.safely("getTarget", () => callHost<HostTarget>("gmlGetTarget"), {
      kind: "none",
      name: "",
    });
  }

  async getEnvironment(): Promise<InstalledEnvironment> {
    // An empty object means "unknown", which is not the same as "nothing is
    // installed" — assetReadiness treats it as "claim nothing".
    return this.safely("getEnvironment", () => callHost<InstalledEnvironment>("gmlGetEnvironment"), {});
  }

  async applyAssets(refs: readonly AssetRef[]): Promise<HostResult> {
    try {
      const data = await callHost<{ applied: boolean; message?: string; stub?: boolean }>(
        "gmlApply",
        { refs },
      );
      return { ok: true, message: data.message };
    } catch (error) {
      this.onError("applyAssets", error);
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Until the package cache exists (M1), media resolves to generated data URIs.
   * Nothing here touches the filesystem, so a missing cache cannot break the
   * panel while the layout is being verified.
   */
  resolveUrl(ref: { id: string; version: string }, relativePath: string): string {
    const asset = this.assets.find((a) => a.id === ref.id);
    const category: Category = asset?.category ?? "backgrounds";

    if (relativePath.endsWith(".json")) return placeholderPeaks(ref.id);
    if (relativePath.endsWith(".png")) return placeholderPoster(ref.id, category);
    return "";
  }

  async setTagsVisible(visible: boolean): Promise<HostResult> {
    try {
      const data = await callHost<{ changed: boolean; message?: string }>("gmlSetTagsVisible", {
        visible,
      });
      return { ok: true, message: data.message };
    } catch (error) {
      this.onError("setTagsVisible", error);
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async resyncTags(): Promise<HostResult> {
    return this.callSimple("resyncTags", "gmlResyncTags");
  }

  async exportStoryboard(): Promise<HostResult> {
    return this.callSimple("exportStoryboard", "gmlExportStoryboard");
  }

  async publishComp(): Promise<HostResult> {
    return this.callSimple("publishComp", "gmlPublishComp");
  }

  private async callSimple(context: string, fn: string): Promise<HostResult> {
    try {
      const data = await callHost<{ message?: string }>(fn);
      return { ok: true, message: data?.message };
    } catch (error) {
      this.onError(context, error);
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }
}

export function cepContext() {
  return {
    available: cepAvailable(),
    extensionId: extensionId(),
    extensionPath: systemPath("extension"),
    userDataPath: systemPath("userData"),
  };
}
