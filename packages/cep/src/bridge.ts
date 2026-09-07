import type { InstalledEnvironment, LibraryAsset, Stamp } from "@gml/core";
import { placeholderPoster, type ApplyItem, type HostBridge, type HostCapabilities, type HostResult, type HostTarget } from "@gml/ui";
import { callHost, cepAvailable, extensionId, systemPath } from "./csinterface.js";
import type { LibraryRuntime } from "./runtime.js";

/**
 * The real HostBridge: every call becomes an ExtendScript function invocation,
 * and every file handed to the host comes from the local cache.
 */
export interface CepBridgeOptions {
  capabilities: HostCapabilities;
  runtime?: LibraryRuntime | null;
  /** Surfaces host failures in the panel rather than swallowing them. */
  onError?: (context: string, error: unknown) => void;
  /** "Publish to Library" opens the panel's own form instead of calling the host. */
  onPublishRequest?: () => void;
}

interface HostApplyItem {
  id: string;
  version: number;
  kind: string;
  name: string;
  localPath: string;
  alpha: string;
  compName: string;
}

export class CepHostBridge implements HostBridge {
  readonly capabilities: HostCapabilities;
  private readonly onError: (context: string, error: unknown) => void;
  runtime: LibraryRuntime | null;
  onPublishRequest: (() => void) | undefined;

  constructor(options: CepBridgeOptions) {
    this.capabilities = options.capabilities;
    this.onError = options.onError ?? (() => {});
    this.runtime = options.runtime ?? null;
    this.onPublishRequest = options.onPublishRequest;
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
    return this.safely("getTarget", () => callHost<HostTarget>("gmlGetTarget"), { kind: "none", name: "" });
  }

  async getEnvironment(): Promise<InstalledEnvironment> {
    // An empty object means "unknown", which is not the same as "nothing is
    // installed" — assetReadiness treats it as "claim nothing".
    return this.safely("getEnvironment", () => callHost<InstalledEnvironment>("gmlGetEnvironment"), {});
  }

  async getProjectStamps(): Promise<Stamp[]> {
    if (this.capabilities.hostKind !== "ae") return [];
    const raw = await this.safely("getProjectStamps", () => callHost<{ stamps: string[] }>("gmlProjectStamps"), { stamps: [] });
    const stamps = this.runtime ? (this.runtime.constructor as typeof LibraryRuntime).stampsFrom(raw.stamps) : [];
    // What the project references is pinned so eviction never pulls it away.
    this.runtime?.refreshPins(stamps);
    return stamps;
  }

  async applyAssets(items: readonly ApplyItem[]): Promise<HostResult> {
    const payload: HostApplyItem[] = items.map((i) => ({
      id: i.asset.id,
      version: i.asset.version,
      kind: i.asset.kind,
      name: i.asset.name,
      localPath: i.localPath,
      alpha: i.deliverable.alpha,
      compName: i.asset.comp?.compName ?? "",
    }));
    try {
      const data = await callHost<{ applied: boolean; message?: string }>("gmlApply", { items: payload }, 120000);
      return { ok: true, message: data.message };
    } catch (error) {
      this.onError("applyAssets", error);
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  posterUrl(asset: LibraryAsset): string | null {
    return this.runtime?.posterUrl(asset) ?? placeholderPoster(asset.id, asset.category);
  }

  previewUrl(asset: LibraryAsset): string | null {
    return this.runtime?.previewUrl(asset) ?? null;
  }

  async setTagsVisible(visible: boolean): Promise<HostResult> {
    try {
      const data = await callHost<{ changed: boolean; message?: string }>("gmlSetTagsVisible", { visible });
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
    if (this.onPublishRequest) {
      this.onPublishRequest();
      return { ok: true };
    }
    return { ok: false, message: "Publishing is not available in this panel." };
  }

  async saveCopy(item: ApplyItem): Promise<HostResult> {
    const node = this.runtime?.node;
    if (!node) return { ok: false, message: "No filesystem access" };
    const name = item.deliverable.relPath.split("/").pop() ?? "asset";
    const dest = node.showSaveDialog(name);
    if (!dest) return { ok: false, message: "Cancelled" };
    try {
      node.fs.copyFile(item.localPath, dest);
      return { ok: true, message: `Saved to ${dest}` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async revealSource(asset: LibraryAsset): Promise<HostResult> {
    const path = asset.source ? this.runtime?.libraryPath(asset.source.relPath) : null;
    if (!path) return { ok: false, message: "No source linked" };
    try {
      await callHost("gmlReveal", { path });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
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

/** After Effects reads comps out of a project file for the indexer. */
export function aeInspectAep(absPath: string) {
  return callHost<{ comps: { compName: string; fps: number; width: number; height: number; duration: number; numLayers: number; fonts: string[]; effects: string[] }[] }>(
    "gmlInspectAep",
    { path: absPath },
    180000,
  ).then((r) => r.comps);
}

export function cepContext() {
  return {
    available: cepAvailable(),
    extensionId: extensionId(),
    extensionPath: systemPath("extension"),
    userDataPath: systemPath("userData"),
  };
}
