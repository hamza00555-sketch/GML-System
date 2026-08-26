import type { GmlAsset } from "./schema.js";

/**
 * Whether an asset will actually work on this machine. Checked before applying,
 * and surfaced on cards so a designer sees the risk before committing to it.
 */
export type Readiness = "safe" | "requires-font" | "requires-plugin";

export interface InstalledEnvironment {
  /** PostScript names from `app.fonts.allFonts`. Undefined means "unknown". */
  fonts?: readonly string[];
  /** matchNames from `app.effects`. Undefined means "unknown". */
  effectMatchNames?: readonly string[];
}

export interface ReadinessResult {
  status: Readiness;
  missingFonts: string[];
  missingPlugins: string[];
}

export function assetReadiness(
  asset: GmlAsset,
  env: InstalledEnvironment = {},
): ReadinessResult {
  // A sound file has no fonts or effects to satisfy.
  if (asset.assetType === "audio") {
    return { status: "safe", missingFonts: [], missingPlugins: [] };
  }

  // Without an inventory we cannot claim something is missing, so say nothing.
  const missingFonts = env.fonts
    ? asset.dependencies.fonts.filter((f) => !env.fonts!.includes(f))
    : [];
  const missingPlugins = env.effectMatchNames
    ? asset.dependencies.plugins
        .filter((p) => !env.effectMatchNames!.includes(p.matchName))
        .map((p) => p.name)
    : [];

  // A missing plugin breaks the render outright; a missing font substitutes.
  const status: Readiness =
    missingPlugins.length > 0
      ? "requires-plugin"
      : missingFonts.length > 0
        ? "requires-font"
        : "safe";

  return { status, missingFonts, missingPlugins };
}
