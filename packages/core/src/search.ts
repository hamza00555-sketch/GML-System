import type { LibraryAsset } from "./library.js";
import type { Category } from "./categories.js";

/**
 * Search runs client-side over the cached index — Drive offers no server-side
 * query. Normalisation matters more than ranking sophistication here: a
 * designer typing "انيميشن" must match "أنيميشن", and "62" must match "٦٢".
 */

// Written as escapes on purpose: raw characters here once produced a range
// that swallowed the whole Arabic letter block, and every Arabic query
// silently matched everything.
const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;

/** Arabic-Indic (٠-٩) and Eastern Arabic-Indic (۰-۹) digits to ASCII. */
export function normalizeDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    return String((code >= 0x06f0 ? code - 0x06f0 : code - 0x0660) % 10);
  });
}

export function normalize(input: string): string {
  return normalizeDigits(input)
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, "")
    .replace(TATWEEL, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export interface SearchFilters {
  category?: Category | "all";
  favorites?: ReadonlySet<string>;
  onlyFavorites?: boolean;
  hiddenCategories?: readonly Category[];
}

export interface SearchOptions extends SearchFilters {
  query?: string;
}

interface Scored {
  asset: LibraryAsset;
  score: number;
}

function scoreAsset(asset: LibraryAsset, terms: string[]): number {
  if (terms.length === 0) return 1;

  const name = normalize(`${asset.name} ${asset.nameAr ?? ""}`);
  const tags = normalize(asset.tags.join(" "));
  const rest = normalize(`${asset.categoryFolder} ${asset.category} ${asset.kind} ${asset.id}`);

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

export function searchAssets(assets: readonly LibraryAsset[], options: SearchOptions = {}): LibraryAsset[] {
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
      normalize(a.asset.name).localeCompare(normalize(b.asset.name), ["ar", "en"], { numeric: true, sensitivity: "base" }),
  );
  return scored.map((s) => s.asset);
}
