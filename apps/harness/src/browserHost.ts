import type { GmlAsset, InstalledEnvironment } from "@gml/core";
import {
  AE_CAPABILITIES,
  AI_CAPABILITIES,
  type AssetRef,
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

const PALETTE: Record<string, [string, string]> = {
  "3d": ["#2b3a55", "#41d37e"],
  "animated-texts": ["#2f2a3d", "#41d37e"],
  backgrounds: ["#1f3330", "#41d37e"],
  counters: ["#3a3126", "#41d37e"],
  guideline: ["#26333a", "#41d37e"],
  illustrations: ["#3a2630", "#41d37e"],
  transitions: ["#242c3a", "#41d37e"],
  audio: ["#2a2a2a", "#41d37e"],
};

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

/** A stand-in poster so the grid reads like the real thing while designing. */
function posterDataUri(asset: { id: string }, category: string): string {
  const [bg, fg] = PALETTE[category] ?? ["#2e2e2e", "#41d37e"];
  const seed = hash(asset.id);
  const bars = Array.from({ length: 7 }, (_, i) => {
    const h = 12 + ((seed >> (i * 3)) % 46);
    return `<rect x="${18 + i * 22}" y="${100 - h}" width="12" height="${h}" rx="2" fill="${fg}" opacity="${0.35 + (i % 3) * 0.2}"/>`;
  }).join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 180 101">
    <rect width="180" height="101" fill="${bg}"/>${bars}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Deterministic peaks so the audio cards render a real-looking waveform. */
function peaksDataUri(asset: { id: string }): string {
  const seed = hash(asset.id);
  const peaks = Array.from({ length: 48 }, (_, i) => {
    const n = Math.sin((seed % 97) + i * 0.7) * Math.cos(i * 0.21);
    return Math.abs(n) * 0.8 + 0.15;
  });
  return `data:application/json;utf8,${encodeURIComponent(JSON.stringify(peaks))}`;
}

export class BrowserHostBridge implements HostBridge {
  readonly capabilities: HostCapabilities;

  constructor(
    choice: HostChoice,
    private readonly assets: readonly GmlAsset[],
    private readonly log: (entry: HarnessLogEntry) => void,
  ) {
    this.capabilities = choice === "ai" ? AI_CAPABILITIES : AE_CAPABILITIES;
  }

  private record(call: string, detail = "") {
    this.log({ at: new Date().toLocaleTimeString(), call, detail });
  }

  async getTarget(): Promise<HostTarget> {
    return this.capabilities.hostKind === "ai"
      ? { kind: "artboard", name: "Shot_03" }
      : { kind: "comp", name: "Homepage_Intro" };
  }

  async getEnvironment(): Promise<InstalledEnvironment> {
    // Deliberately missing Deep Glow and the Arabic font, so the readiness
    // badges are visible while designing.
    return { fonts: [], effectMatchNames: ["ADBE Gaussian Blur 2"] };
  }

  async applyAssets(refs: readonly AssetRef[]): Promise<HostResult> {
    const verb = this.capabilities.primaryAction === "place" ? "place" : "apply";
    this.record(verb, refs.map((r) => `${r.id}@${r.version}`).join(", "));
    return { ok: true };
  }

  resolveUrl(ref: { id: string; version: string }, relativePath: string): string {
    const asset = this.assets.find((a) => a.id === ref.id);
    const category = asset?.category ?? "backgrounds";

    if (relativePath.endsWith(".json")) return peaksDataUri(ref);
    if (relativePath.endsWith(".png")) return posterDataUri(ref, category);
    // No stand-in video: cards keep showing their poster, which is exactly
    // what they do when a preview fails to decode in CEP.
    return "";
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
    this.record("publishComp", "preflight → collect → stage → finalize");
    return { ok: true };
  }
}
