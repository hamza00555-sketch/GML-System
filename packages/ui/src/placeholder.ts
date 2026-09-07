import type { Category } from "@gml/core";

/**
 * A stand-in poster until the real one has been generated from the preview.
 * A data URI: no network, no file path, no codec.
 */
const PALETTE: Record<Category, string> = {
  "3d": "#2b3a55",
  "animated-texts": "#2f2a3d",
  backgrounds: "#1f3330",
  counters: "#3a3126",
  guideline: "#26333a",
  illustrations: "#3a2630",
  transitions: "#242c3a",
};

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

export function placeholderPoster(id: string, category: Category): string {
  const bg = PALETTE[category] ?? "#2e2e2e";
  const seed = hash(id);
  const bars = Array.from({ length: 7 }, (_, i) => {
    const h = 12 + ((seed >> (i * 3)) % 46);
    return `<rect x="${18 + i * 22}" y="${100 - h}" width="12" height="${h}" rx="2" fill="#41d37e" opacity="${0.25 + (i % 3) * 0.15}"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 180 101"><rect width="180" height="101" fill="${bg}"/>${bars}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
