import { useState } from "react";
import { CATEGORIES, CATEGORY_LABELS, type Category, type Locale, type StringKey } from "@gml/core";
import { useI18n } from "../i18n.js";
import { useHost } from "../host.js";
import { useLibrary, type CategoryFilter } from "../library.js";

/**
 * One component, three presentations. The eight categories are the same set in
 * every mode — only how much room they get changes.
 */
export type CategoryNavVariant = "sidebar" | "chips" | "sheet";

function useVisibleCategories(): Category[] {
  const host = useHost();
  const hidden = new Set(host.capabilities.hiddenCategories);
  return CATEGORIES.filter((c) => !hidden.has(c));
}

function labelFor(
  category: CategoryFilter,
  locale: Locale,
  t: (key: StringKey) => string,
): string {
  if (category === "all" || category === "favorites" || category === "recent") {
    return t(category);
  }
  return CATEGORY_LABELS[category][locale];
}

export function CategoryNav({ variant }: { variant: CategoryNavVariant }) {
  const { t, locale } = useI18n();
  const { filter, setFilter } = useLibrary();
  const categories = useVisibleCategories();
  const [sheetOpen, setSheetOpen] = useState(false);

  const label = (c: CategoryFilter) => labelFor(c, locale, t);

  if (variant === "sidebar") {
    return (
      <nav className="gml-sidebar" aria-label={t("library")} data-testid="category-sidebar">
        <p className="gml-sidebar__heading">{t("library")}</p>
        <ul className="gml-sidebar__list">
          {(["all", ...categories] as CategoryFilter[]).map((c) => (
            <li key={c}>
              <button
                type="button"
                className="gml-sidebar__item"
                data-active={filter === c || undefined}
                data-category={c}
                onClick={() => setFilter(c)}
              >
                {label(c)}
              </button>
            </li>
          ))}
        </ul>
        <hr className="gml-sidebar__rule" />
        <p className="gml-sidebar__heading">{t("collections")}</p>
        <ul className="gml-sidebar__list">
          {(["favorites", "recent"] as CategoryFilter[]).map((c) => (
            <li key={c}>
              <button
                type="button"
                className="gml-sidebar__item"
                data-active={filter === c || undefined}
                data-category={c}
                onClick={() => setFilter(c)}
              >
                {label(c)}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  if (variant === "chips") {
    // A horizontal scroller rather than a More button: eight items scroll
    // comfortably and stay directly reachable.
    return (
      <div className="gml-chips" role="tablist" aria-label={t("library")} data-testid="category-chips">
        {(["all", ...categories] as CategoryFilter[]).map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={filter === c}
            className="gml-chip"
            data-active={filter === c || undefined}
            data-category={c}
            onClick={() => setFilter(c)}
          >
            {label(c)}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="gml-sheet" data-testid="category-sheet">
      <button
        type="button"
        className="gml-sheet__trigger"
        aria-expanded={sheetOpen}
        onClick={() => setSheetOpen((open) => !open)}
      >
        {label(filter)} ▾
      </button>
      {sheetOpen && (
        <ul className="gml-sheet__list">
          {(["all", ...categories, "favorites", "recent"] as CategoryFilter[]).map((c) => (
            <li key={c}>
              <button
                type="button"
                className="gml-sheet__item"
                data-active={filter === c || undefined}
                data-category={c}
                onClick={() => {
                  setFilter(c);
                  setSheetOpen(false);
                }}
              >
                {label(c)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
