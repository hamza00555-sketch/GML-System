import type { InstalledEnvironment, LibraryAsset, Stamp } from "@gml/core";
import {
  AE_CAPABILITIES,
  AI_CAPABILITIES,
  placeholderPoster,
  type ApplyItem,
  type HostBridge,
  type HostCapabilities,
  type HostResult,
  type HostTarget,
} from "@gml/ui";

/**
 * Stands in for CSInterface.evalScript. Every call the panel would make into
 * ExtendScript is answered here instead, which is what lets the whole UI be
 * designed and reviewed without After Effects or Illustrator running.
 */

export type HostChoice = "ae" | "ai";

export interface HarnessLogEntry {
  at: string;
  call: string;
  detail: string;
}

export class BrowserHostBridge implements HostBridge {
  readonly capabilities: HostCapabilities;

  constructor(
    choice: HostChoice,
    private readonly log: (entry: HarnessLogEntry) => void,
  ) {
    this.capabilities = choice === "ai" ? AI_CAPABILITIES : AE_CAPABILITIES;
  }

  private record(call: string, detail = "") {
    this.log({ at: new Date().toLocaleTimeString(), call, detail });
  }

  async getTarget(): Promise<HostTarget> {
    return this.capabilities.hostKind === "ai" ? { kind: "artboard", name: "Shot_03" } : { kind: "comp", name: "Homepage_Intro" };
  }

  async getEnvironment(): Promise<InstalledEnvironment> {
    // Deliberately missing Deep Glow and the Arabic font, so the readiness
    // badges are visible while designing.
    return { fonts: [], effectMatchNames: ["ADBE Gaussian Blur 2"] };
  }

  async getProjectStamps(): Promise<Stamp[]> {
    // The pretend project already holds an older Coin — shows "update available".
    return [{ id: "3d/coin", version: 1 }];
  }

  async applyAssets(items: readonly ApplyItem[]): Promise<HostResult> {
    const verb = this.capabilities.primaryAction === "place" ? "place" : "apply";
    this.record(verb, items.map((i) => `${i.asset.id}@v${i.asset.version} ← ${i.localPath}`).join("\n"));
    return { ok: true };
  }

  posterUrl(asset: LibraryAsset): string {
    return placeholderPoster(asset.id, asset.category);
  }

  previewUrl(): string | null {
    // No stand-in clip: cards keep showing their poster, which is exactly what
    // they do in CEP before the preview has been cached.
    return null;
  }

  async setTagsVisible(visible: boolean): Promise<HostResult> {
    this.record("setTagsVisible", String(visible));
    return { ok: true };
  }

  async resyncTags(): Promise<HostResult> {
    this.record("resyncTags");
    return { ok: true };
  }

  async exportStoryboard(): Promise<HostResult> {
    this.record("exportStoryboard", "storyboard.gml.json");
    return { ok: true };
  }

  async publishComp(): Promise<HostResult> {
    this.record("publishComp", "opens the publish form in the real panel");
    return { ok: true };
  }

  async saveCopy(item: ApplyItem): Promise<HostResult> {
    this.record("saveCopy", item.localPath);
    return { ok: true, message: "Saved (pretend)" };
  }

  async revealSource(asset: LibraryAsset): Promise<HostResult> {
    this.record("revealSource", asset.source?.relPath ?? "");
    return { ok: true };
  }
}
