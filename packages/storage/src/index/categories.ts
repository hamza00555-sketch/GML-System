import type { AssetKind, Category } from "@gml/core";
import { EXCLUDED_CATEGORY_FOLDERS, SCAFFOLDING_DIRS } from "./noise.js";

/**
 * Top-level folders map onto the fixed category list by their English part;
 * "Backgrounds - خلفيات" is the backgrounds category. Folder names are what
 * the team typed, so matching is forgiving but the set of categories is not.
 */
const FOLDER_TO_CATEGORY: [RegExp, Category][] = [
  [/^3\s*d\b/, "3d"],
  [/^animated\s*text/, "animated-texts"],
  [/^text/, "animated-texts"],
  [/^background/, "backgrounds"],
  [/^counter/, "counters"],
  [/^illustration/, "illustrations"],
  [/^transition/, "transitions"],
  [/^guideline/, "guideline"],
];

export function categoryForFolder(folderName: string): Category | null {
  const english = folderName.split(/\s+[-–—]\s+/)[0]!.trim().toLowerCase();
  for (const [pattern, category] of FOLDER_TO_CATEGORY) {
    if (pattern.test(english)) return category;
  }
  return null;
}

/** True for a top-level folder the scanner should walk. */
export function isCategoryFolder(name: string): boolean {
  if (SCAFFOLDING_DIRS.has(name)) return false;
  const category = categoryForFolder(name);
  return category !== null && !EXCLUDED_CATEGORY_FOLDERS.has(category);
}

/**
 * Rendered alpha video is the deliverable, except where the content is
 * text-editable — there the comp is. This split matches the existing folders
 * exactly, so no migration is required.
 */
export function kindForCategory(category: Category): AssetKind {
  return category === "animated-texts" || category === "counters" ? "comp" : "video-alpha";
}
