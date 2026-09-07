import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { Deliverable, InstalledEnvironment, LibraryAsset, Stamp } from "@gml/core";

/**
 * The seam between the shared panel UI and whichever Adobe host it runs in.
 * Everything that would reach for `CSInterface.evalScript` goes through here,
 * which is what lets the whole UI be developed and tested in the harness with
 * no Adobe application open.
 */

export type HostKind = "ae" | "ai" | "harness";

export type TargetKind = "comp" | "layer" | "artboard" | "frame" | "none";

export interface HostTarget {
  kind: TargetKind;
  name: string;
}

export interface HostResult {
  ok: boolean;
  message?: string;
}

/** One thing to import: always a fully materialised local file. */
export interface ApplyItem {
  asset: LibraryAsset;
  deliverable: Deliverable;
  localPath: string;
}

export interface HostCapabilities {
  hostKind: HostKind;
  /** Drives the primary button: Apply in AE, Place in Illustrator. */
  primaryAction: "apply" | "place";
  /** Illustrator only — the storyboard tag tools. */
  hasTagTools: boolean;
  /** After Effects only — publishing back into the library. */
  canPublish: boolean;
}

export interface HostBridge {
  capabilities: HostCapabilities;
  /** The active comp/layer or artboard/frame the drop zone reports. */
  getTarget(): Promise<HostTarget>;
  /** What is installed here, so readiness can be judged before applying. */
  getEnvironment(): Promise<InstalledEnvironment>;
  /**
   * Apply (AE) or place (Illustrator), in queue order. Every item's localPath
   * is complete on disk before this is called — never a file mid-download.
   */
  applyAssets(items: readonly ApplyItem[]): Promise<HostResult>;
  /** Stamps in the open project: pins their cached versions and flags updates. */
  getProjectStamps?(): Promise<Stamp[]>;
  /** Cached poster, or null before the poster exists. */
  posterUrl(asset: LibraryAsset): string | null;
  /** Cached preview for the shared video element, or null before it is fetched. */
  previewUrl(asset: LibraryAsset): string | null;

  setTagsVisible?(visible: boolean): Promise<HostResult>;
  resyncTags?(): Promise<HostResult>;
  exportStoryboard?(): Promise<HostResult>;
  publishComp?(): Promise<HostResult>;
  /** Copies a fetched deliverable somewhere the user chooses. */
  saveCopy?(item: ApplyItem): Promise<HostResult>;
  /** Shows the linked source project in Finder/Explorer. */
  revealSource?(asset: LibraryAsset): Promise<HostResult>;
}

export const AE_CAPABILITIES: HostCapabilities = {
  hostKind: "ae",
  primaryAction: "apply",
  hasTagTools: false,
  canPublish: true,
};

export const AI_CAPABILITIES: HostCapabilities = {
  hostKind: "ai",
  primaryAction: "place",
  hasTagTools: true,
  canPublish: false,
};

const HostContext = createContext<HostBridge | null>(null);

export function HostBridgeProvider({ bridge, children }: { bridge: HostBridge; children: ReactNode }) {
  return <HostContext.Provider value={bridge}>{children}</HostContext.Provider>;
}

export function useHost(): HostBridge {
  const bridge = useContext(HostContext);
  if (!bridge) throw new Error("useHost must be used inside <HostBridgeProvider>");
  return bridge;
}
