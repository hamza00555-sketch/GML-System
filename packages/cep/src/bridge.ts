import type { Category, GmlAsset, InstalledEnvironment } from "@gml/core";
import { placeholderPeaks, placeholderPoster } from "@gml/ui";
import type { AssetRef, HostBridge, HostCapabilities, HostResult, HostTarget } from "@gml/ui";
import { pathToFileUrl, type FolderLibraryProvider } from "@gml/storage";
import { callHost, cepAvailable, extensionId, systemPath } from "./csinterface.js";

/**
 * The real HostBridge: every call becomes an ExtendScript function invocation.
 *
 * The two panels differ only in their capabilities and in which host functions
 * exist, so one implementation serves both.
 */
export interface CepBridgeOptions {
  capabilities: HostCapabilities;
  /** Surfaces host failures in the panel rather than swallowing them. */
  onError?: (context: string, error: unknown) => void;
  /** "Publish to Library" opens the panel's own form instead of calling the host. */
  onPublishRequest?: () => void;
}

/** What the host needs to import one asset: where its package is and which comp to pull. */
export interface ApplyRef extends AssetRef {
  packagePath: string | null;
  source: string;
  compName: string;
  footage?: "bundled" | "external";
}

export class CepHostBridge implements HostBridge {
  readonly capabilities: HostCapabilities;
  private readonly onError: (context: string, error: unknown) => void;
  private library: FolderLibraryProvider | null = null;
  onPublishRequest: (() => void) | undefined;

  constructor(options: CepBridgeOptions) {
    this.capabilities = options.capabilities;
    this.onError = options.onError ?? (() => {});
    this.onPublishRequest = options.onPublishRequest;
  }

  /** Media URLs and apply payloads come from the library's packages once one is open. */
  attachLibrary(provider: FolderLibraryProvider | null): void {
    this.library = provider;
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

  private applyRef(ref: AssetRef): ApplyRef {
    const asset = this.library?.assetSync(ref.id, ref.version) ?? null;
    const motion = asset && asset.assetType === "motion" ? asset : null;
    return {
      id: ref.id,
      version: ref.version,
      packagePath: this.library?.packagePath(ref.id, ref.version) ?? null,
      source: motion?.source ?? "source.aep",
      compName: motion?.compName ?? "",
      footage: motion?.dependencies.footage,
    };
  }

  async applyAssets(refs: readonly AssetRef[]): Promise<HostResult> {
    try {
      const data = await callHost<{ applied: boolean; message?: string }>(
        "gmlApply",
        { refs: refs.map((r) => this.applyRef(r)) },
        60000,
      );
      return { ok: true, message: data.message };
    } catch (error) {
      this.onError("applyAssets", error);
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Package media is served straight from the synced library folder over
   * file://, which is also where the panel itself is loaded from. Without a
   * library, generated placeholders keep the layout reviewable.
   */
  resolveUrl(ref: { id: string; version: string }, relativePath: string): string {
    const packagePath = this.library?.packagePath(ref.id, ref.version);
    if (packagePath) {
      return pathToFileUrl(`${packagePath}/${relativePath}`);
    }
    const asset: GmlAsset | null = this.library?.assetSync(ref.id, ref.version) ?? null;
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
    if (this.onPublishRequest) {
      this.onPublishRequest();
      return { ok: true };
    }
    return { ok: false, message: "Publishing is not available in this panel." };
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
