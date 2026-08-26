import type { GmlAsset } from "./schema.js";
import type { Category } from "./categories.js";

/**
 * Search runs client-side over the cached index — Drive offers no server-side
 * query. Normalisation matters more than ranking sophistication here: a
 * designer typing "انيميشن" must match "أنيميشن".
 */

const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;

export function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, "")
    .replace(TATWEEL, "")
    .replace(/[آأإٱ]/g, "ا") // آ أ إ ٱ -> ا
    .replace(/ى/g, "ي") // ى -> ي
    .replace(/ة/g, "ه") // ة -> ه
    .replace(/ؤ/g, "و") // ؤ -> و
    .replace(/ئ/g, "ي") // ئ -> ي
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export interface SearchFilters {
  category?: Category | "all";
  favorites?: ReadonlySet<string>;
  onlyFavorites?: boolean;
  /** Hides the audio category wholesale — Illustrator uses this. */
  hiddenCategories?: readonly Category[];
}

export interface SearchOptions extends SearchFilters {
  query?: string;
}

interface Scored {
  asset: GmlAsset;
  score: number;
}

function scoreAsset(asset: GmlAsset, terms: string[]): number {
  if (terms.length === 0) return 1;

  const name = normalize(`${asset.nameEn} ${asset.nameAr}`);
  const tags = normalize(asset.tags.join(" "));
  const rest = normalize(`${asset.description} ${asset.category}`);

  let total = 0;
  for (const term of terms) {
    let best = 0;
    if (name.startsWith(term)) best = 10;
    else if (name.includes(term)) best = 6;
    if (best < 4 && tags.includes(term)) best = 4;
    if (best < 2 && rest.includes(term)) best = 2;
    // Every term must land somewhere, otherwise the asset is not a match.
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

export function searchAssets(
  assets: readonly GmlAsset[],
  options: SearchOptions = {},
): GmlAsset[] {
  const { query = "", category = "all", favorites, onlyFavorites, hiddenCategories } = options;
  const terms = normalize(query).split(" ").filter(Boolean);
  const hidden = new Set(hiddenCategories ?? []);

  const scored: Scored[] = [];
  for (const asset of assets) {
    if (hidden.has(asset.category)) continue;
    if (category !== "all" && asset.category !== category) continue;
    if (onlyFavorites && !favorites?.has(asset.id)) continue;

    const score = scoreAsset(asset, terms);
    if (score > 0) scored.push({ asset, score });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.asset.nameEn.localeCompare(b.asset.nameEn, "en", { sensitivity: "base" }),
  );
  return scored.map((s) => s.asset);
}
