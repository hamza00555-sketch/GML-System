import type { Category } from "@gml/core";

/**
 * Stand-in poster and waveform data for M0.5, before the real library exists.
 *
 * Both the browser harness and the CEP panels use these so the grid reads like
 * the finished thing while layout and playback are being verified. They are
 * data URIs, which means no network, no file paths, and no codec involved —
 * exactly what is wanted when the point of the test is something else.
 */

const PALETTE: Record<Category, [string, string]> = {
  "3d": ["#2b3a55", "#41d37e"],
  "animated-texts": ["#2f2a3d", "#41d37e"],
  backgrounds: ["#1f3330", "#41d37e"],
  counters: ["#3a3126", "#41d37e"],
  guideline: ["#26333a", "#41d37e"],
  illustrations: ["#3a2630", "#41d37e"],
  transitions: ["#242c3a", "#41d37e"],
  audio: ["#2a2a2a", "#41d37e"],
};

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

export function placeholderPoster(id: string, category: Category): string {
  const [bg, fg] = PALETTE[category] ?? ["#2e2e2e", "#41d37e"];
  const seed = hash(id);
  const bars = Array.from({ length: 7 }, (_, i) => {
    const h = 12 + ((seed >> (i * 3)) % 46);
    return `<rect x="${18 + i * 22}" y="${100 - h}" width="12" height="${h}" rx="2" fill="${fg}" opacity="${0.35 + (i % 3) * 0.2}"/>`;
  }).join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 180 101"><rect width="180" height="101" fill="${bg}"/>${bars}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function placeholderPeaks(id: string, count = 48): string {
  const seed = hash(id);
  const peaks = Array.from({ length: count }, (_, i) => {
    const n = Math.sin((seed % 97) + i * 0.7) * Math.cos(i * 0.21);
    return Math.abs(n) * 0.8 + 0.15;
  });
  return `data:application/json;utf8,${encodeURIComponent(JSON.stringify(peaks))}`;
}
