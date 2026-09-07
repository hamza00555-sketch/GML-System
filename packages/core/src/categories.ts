/**
 * The approved library categories — one per top-level folder in the library. This list is closed: new top-level
 * categories are not added here — narrower groupings (shapes, maps, charts,
 * lower thirds, ...) live as `tags` on assets inside these categories.
 */
export const CATEGORIES = [
  "3d",
  "animated-texts",
  "backgrounds",
  "counters",
  "guideline",
  "illustrations",
  "transitions",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Display labels per locale. Asset names come from the asset itself, not here. */
export const CATEGORY_LABELS: Record<Category, { en: string; ar: string }> = {
  "3d": { en: "3D", ar: "ثلاثي الأبعاد" },
  "animated-texts": { en: "Animated Texts", ar: "نصوص متحركة" },
  backgrounds: { en: "Backgrounds", ar: "خلفيات" },
  counters: { en: "Counters", ar: "عدادات" },
  guideline: { en: "Guideline", ar: "الدليل" },
  illustrations: { en: "Illustrations", ar: "رسومات" },
  transitions: { en: "Transitions", ar: "انتقالات" },
};

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}
