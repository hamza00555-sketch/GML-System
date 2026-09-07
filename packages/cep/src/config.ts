import type { PanelNode } from "./node.js";

/**
 * Per-machine settings shared by both panels: ~/.gml/config.json. Nothing
 * secret lives here except the OAuth client "secret", which for an installed
 * app is public by design — and it is still never inside the extension.
 */
export interface DriveConfig {
  clientId?: string;
  clientSecret?: string;
  /** Shared Drive name and folder path; derived from the mount path when absent. */
  rootPath?: string;
}

export interface GmlConfig {
  libraryRoot?: string;
  cacheRoot?: string;
  cacheCapGB?: number;
  transport?: "mount" | "drive";
  drive?: DriveConfig;
}

export const DEFAULT_CACHE_CAP_GB = 50;

const LOCAL_KEY = "gml.config";

function configPath(node: PanelNode): string {
  return node.path.join(node.homedir, ".gml", "config.json");
}

export function readConfig(node: PanelNode | null): GmlConfig {
  if (node) {
    try {
      const p = configPath(node);
      if (node.exists(p)) {
        const parsed = JSON.parse(new TextDecoder().decode(node.readFile(p))) as unknown;
        if (parsed && typeof parsed === "object") return parsed as GmlConfig;
      }
    } catch {
      // Fall through to the browser copy.
    }
  }
  try {
    const raw = globalThis.localStorage?.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as GmlConfig) : {};
  } catch {
    return {};
  }
}

export function writeConfig(node: PanelNode | null, config: GmlConfig): void {
  const text = JSON.stringify(config, null, 2);
  if (node) {
    try {
      node.mkdir(node.path.join(node.homedir, ".gml"));
      node.writeFile(configPath(node), text);
    } catch {
      // The browser copy below still keeps this panel working.
    }
  }
  try {
    globalThis.localStorage?.setItem(LOCAL_KEY, text);
  } catch {
    // Nothing more to do.
  }
}

/**
 * "G:\Shared drives\Motion\Hamza\2026\Motion Library" →
 * "Motion/Hamza/2026/Motion Library": the Shared Drive name, then the path.
 */
export function driveRootPathFromMount(libraryRoot: string): string | null {
  const normalised = libraryRoot.replace(/\\/g, "/");
  const m = /\/Shared drives\/(.+)$/i.exec(normalised);
  return m ? m[1]!.replace(/\/+$/, "") : null;
}
