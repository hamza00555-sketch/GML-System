import type { PanelNode } from "./node.js";

/**
 * Per-machine settings shared by both panels: ~/.gml/config.json. Kept out of
 * localStorage as the primary store because each CEP extension has its own
 * origin, and the library folder must be the same for AE and Illustrator.
 */
export interface GmlConfig {
  libraryRoot?: string;
  author?: string;
}

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
