import { normalizeDigits, type Direction, type Orientation } from "@gml/core";

/**
 * The naming convention already in use in the library. Parsed, never
 * invented — tags come from here so nobody has to type them.
 *
 *   01_BG_DARK BLUE_H_ALPHA.mov       index _ type _ name _ orientation _ alpha
 *   01_TRA_Arrows_D_H_ALPHA.mov       index _ type _ name _ direction _ orientation _ alpha
 *   1-3D-Rotating Coin-Alpha-H.mov    dash-delimited variant of the same idea
 *   Angeled Arrow_Down.mov            name _ direction word
 */

export const TYPE_CODES: Record<string, string> = {
  BG: "background",
  TR: "transition",
  TRA: "transition",
  "3D": "3d",
  TXT: "text",
  CNT: "counter",
  ILL: "illustration",
};

const DIRECTION_WORDS: Record<string, Direction> = {
  d: "D",
  down: "D",
  u: "U",
  up: "U",
  l: "L",
  left: "L",
  r: "R",
  right: "R",
};

const ORIENTATION_WORDS: Record<string, Orientation> = {
  h: "H",
  horizontal: "H",
  landscape: "H",
  v: "V",
  vertical: "V",
  portrait: "V",
};

export interface ParsedName {
  /** Leading numeric index, when present. */
  index?: number;
  /** Type code as written (BG, TRA, 3D…), when recognised. */
  type?: string;
  /** Human name with codes and flags stripped. */
  name: string;
  direction?: Direction;
  orientation?: Orientation;
  alpha: boolean;
  /** Lowercased tokens for search, in original order, codes included. */
  tags: string[];
}

function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? fileName : fileName.slice(0, dot);
}

/** Splits on the convention's delimiters. Spaces inside a name are kept. */
function tokenize(stem: string): string[] {
  const useUnderscore = stem.includes("_");
  const parts = useUnderscore ? stem.split("_") : stem.split("-");
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function parseDeliverableName(fileName: string): ParsedName {
  const stem = normalizeDigits(stripExtension(fileName));
  const tokens = tokenize(stem);

  let index: number | undefined;
  let type: string | undefined;
  let direction: Direction | undefined;
  let orientation: Orientation | undefined;
  let alpha = false;
  const nameParts: string[] = [];
  const tags: string[] = [];

  tokens.forEach((token, i) => {
    const lower = token.toLowerCase();
    const upper = token.toUpperCase();

    if (i === 0 && /^\d+$/.test(token)) {
      index = Number(token);
      return;
    }
    if (type === undefined && nameParts.length === 0 && upper in TYPE_CODES) {
      type = upper;
      tags.push(upper);
      return;
    }
    if (lower === "alpha") {
      alpha = true;
      tags.push("alpha");
      return;
    }
    // Direction and orientation are single-token flags; a name token is never
    // a bare "H", so this cannot eat a real word.
    if (i > 0 && lower in DIRECTION_WORDS && direction === undefined) {
      direction = DIRECTION_WORDS[lower];
      tags.push(direction!);
      return;
    }
    if (i > 0 && lower in ORIENTATION_WORDS && orientation === undefined) {
      orientation = ORIENTATION_WORDS[lower];
      tags.push(orientation!);
      return;
    }
    nameParts.push(token);
  });

  const name = nameParts.join(" ").replace(/\s+/g, " ").trim() || stem;
  // The name's own words are tags too, so "arrows" finds "01_TRA_Arrows_D_H".
  for (const word of name.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word && !tags.includes(word)) tags.push(word);
  }

  return { index, type, name, direction, orientation, alpha, tags };
}

/**
 * Variants of one asset share everything but direction/orientation. This is
 * the key files are grouped by in shape A (flat category) folders.
 */
export function variantGroupKey(parsed: ParsedName): string {
  return `${parsed.index ?? ""}|${parsed.type ?? ""}|${parsed.name.toLowerCase()}`;
}

/** Title Case for display when the file name was shouting. */
export function displayName(raw: string): string {
  const cleaned = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned === cleaned.toUpperCase() && /[A-Z]/.test(cleaned)) {
    return cleaned
      .toLowerCase()
      .split(" ")
      .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
      .join(" ");
  }
  return cleaned;
}

/** Lowercase ASCII slug; Arabic is transliterated by code point so ids stay stable and unique. */
export function slug(input: string): string {
  const ascii = normalizeDigits(input)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  let out = "";
  for (const ch of ascii) {
    if (/[a-z0-9]/.test(ch)) out += ch;
    else if (/[\p{L}\p{N}]/u.test(ch)) out += `x${ch.codePointAt(0)!.toString(16)}`;
    else out += "-";
  }
  return out.replace(/-+/g, "-").replace(/^-+|-+$/g, "") || "item";
}
