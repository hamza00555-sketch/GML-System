import type { LibraryAsset } from "./library.js";

/**
 * Whether an asset will actually work on this machine. Checked before applying,
 * and surfaced on cards so a designer sees the risk before committing to it.
 * Only comps carry requirements: rendered video needs nothing.
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

/** Effects shipped with After Effects use this matchName prefix. */
const NATIVE_EFFECT_PREFIX = "ADBE ";

export function assetReadiness(asset: LibraryAsset, env: InstalledEnvironment = {}): ReadinessResult {
  if (asset.kind !== "comp") return { status: "safe", missingFonts: [], missingPlugins: [] };

  // Without an inventory we cannot claim something is missing, so say nothing.
  const missingFonts = env.fonts ? asset.requires.fonts.filter((f) => !env.fonts!.includes(f)) : [];
  const thirdParty = asset.requires.effects.filter((m) => !m.startsWith(NATIVE_EFFECT_PREFIX));
  const missingPlugins = env.effectMatchNames
    ? thirdParty.filter((m) => !env.effectMatchNames!.includes(m))
    : [];

  // A missing plugin breaks the render outright; a missing font substitutes.
  const status: Readiness =
    missingPlugins.length > 0 ? "requires-plugin" : missingFonts.length > 0 ? "requires-font" : "safe";

  return { status, missingFonts, missingPlugins };
}
