import type { LibraryAsset } from "./library.js";

/**
 * Tool chrome is English by default with Arabic available from Settings.
 * Asset names always come from the asset itself, never from this table.
 */
export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export function directionFor(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

export const STRINGS = {
  search: { en: "Search", ar: "بحث" },
  favorites: { en: "Favorites", ar: "المفضلة" },
  recent: { en: "Recent", ar: "الأخيرة" },
  updates: { en: "Updates", ar: "التحديثات" },
  library: { en: "Library", ar: "المكتبة" },
  collections: { en: "Collections", ar: "المجموعات" },
  all: { en: "All", ar: "الكل" },
  apply: { en: "Apply", ar: "تطبيق" },
  place: { en: "Place", ar: "إضافة" },
  settings: { en: "Settings", ar: "الإعدادات" },
  filter: { en: "Filter", ar: "تصفية" },
  dropHere: { en: "Drop here", ar: "أفلت هنا" },
  dropAssetsHere: { en: "Drop assets here", ar: "أفلت العناصر هنا" },
  activeComp: { en: "Active Comp", ar: "الكومب النشط" },
  selectedLayer: { en: "Selected Layer", ar: "الطبقة المختارة" },
  activeArtboard: { en: "Active Artboard", ar: "الآرت بورد النشط" },
  selectedFrame: { en: "Selected Frame", ar: "الإطار المختار" },
  noTarget: { en: "No target", ar: "لا يوجد هدف" },
  hideTags: { en: "Hide Tags", ar: "إخفاء التاقات" },
  showTags: { en: "Show Tags", ar: "إظهار التاقات" },
  resyncTags: { en: "Resync Tags", ar: "إعادة مزامنة" },
  exportStoryboard: { en: "Export Storyboard", ar: "تصدير لوحة العمل" },
  publishToLibrary: { en: "Publish to Library", ar: "نشر للمكتبة" },
  gmlSafe: { en: "GML Safe", ar: "آمن" },
  requiresFont: { en: "Requires Font", ar: "يحتاج خطاً" },
  requiresPlugin: { en: "Requires Plugin", ar: "يحتاج إضافة" },
  clearQueue: { en: "Clear", ar: "مسح" },
  language: { en: "Language", ar: "اللغة" },
  emptyLibrary: { en: "No assets found", ar: "لا توجد عناصر" },
  noLibraryYet: {
    en: "Nothing indexed yet. Open Settings and choose the library folder.",
    ar: "لم تُفهرس المكتبة بعد. افتح الإعدادات واختر مجلد المكتبة.",
  },
  selectAnAsset: { en: "Select an asset", ar: "اختر عنصراً" },
  duration: { en: "Duration", ar: "المدة" },
  resolution: { en: "Resolution", ar: "الأبعاد" },
  version: { en: "Version", ar: "النسخة" },
  lastUpdate: { en: "Last update", ar: "آخر تحديث" },
  draft: { en: "Draft", ar: "مسودة" },
  variant: { en: "Variant", ar: "النسخة" },
  size: { en: "Size", ar: "الحجم" },
  codec: { en: "Codec", ar: "الترميز" },
  source: { en: "Source", ar: "المصدر" },
  kindVideoAlpha: { en: "Alpha video", ar: "فيديو بألفا" },
  kindComp: { en: "Editable comp", ar: "كومب قابل للتعديل" },
  kindStill: { en: "Still", ar: "صورة" },
  stateCloud: { en: "Cloud", ar: "سحابي" },
  stateFetching: { en: "Fetching", ar: "جارٍ التنزيل" },
  stateReady: { en: "Ready", ar: "جاهز" },
  stateFailed: { en: "Failed", ar: "فشل" },
  needsRerender: { en: "Needs re-render", ar: "يحتاج إعادة رندر" },
  updateAvailable: { en: "Update available", ar: "تحديث متاح" },
  saveCopy: { en: "Save a copy…", ar: "حفظ نسخة…" },
  more: { en: "More", ar: "المزيد" },
  cancel: { en: "Cancel", ar: "إلغاء" },
} as const;

export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey, locale: Locale = DEFAULT_LOCALE): string {
  return STRINGS[key][locale];
}

/**
 * Falls back to the other name rather than rendering an empty label when only
 * one was available. Most library names are English with no Arabic twin.
 */
export function assetName(asset: Pick<LibraryAsset, "name" | "nameAr">, locale: Locale): string {
  const ar = (asset.nameAr ?? "").trim();
  const en = asset.name.trim();
  return locale === "ar" ? ar || en : en || ar;
}

export function formatDuration(seconds: number, locale: Locale = DEFAULT_LOCALE): string {
  if (seconds < 60) {
    const value = seconds.toFixed(1).replace(/\.0$/, "");
    return locale === "ar" ? `${value} ث` : `${value}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
