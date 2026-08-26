import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { Category, InstalledEnvironment } from "@gml/core";

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

export interface AssetRef {
  id: string;
  version: string;
}

export interface HostResult {
  ok: boolean;
  message?: string;
}

export interface HostCapabilities {
  hostKind: HostKind;
  /** Illustrator hides audio: placing a sound clip on an artboard is meaningless. */
  hiddenCategories: readonly Category[];
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
  /** Apply (AE) or place (Illustrator), in queue order. */
  applyAssets(refs: readonly AssetRef[]): Promise<HostResult>;
  /**
   * Turns a package-relative path into something the panel can load. Only the
   * host knows whether that is a file:// path in the local cache or an http
   * URL served by the harness.
   */
  resolveUrl(asset: { id: string; version: string }, relativePath: string): string;

  setTagsVisible?(visible: boolean): Promise<HostResult>;
  resyncTags?(): Promise<HostResult>;
  exportStoryboard?(): Promise<HostResult>;
  publishComp?(): Promise<HostResult>;
}

export const AE_CAPABILITIES: HostCapabilities = {
  hostKind: "ae",
  hiddenCategories: [],
  primaryAction: "apply",
  hasTagTools: false,
  canPublish: true,
};

export const AI_CAPABILITIES: HostCapabilities = {
  hostKind: "ai",
  hiddenCategories: ["audio"],
  primaryAction: "place",
  hasTagTools: true,
  canPublish: false,
};

const HostContext = createContext<HostBridge | null>(null);

export function HostBridgeProvider({
  bridge,
  children,
}: {
  bridge: HostBridge;
  children: ReactNode;
}) {
  return <HostContext.Provider value={bridge}>{children}</HostContext.Provider>;
}

export function useHost(): HostBridge {
  const bridge = useContext(HostContext);
  if (!bridge) throw new Error("useHost must be used inside <HostBridgeProvider>");
  return bridge;
}
