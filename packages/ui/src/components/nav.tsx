import { useState } from "react";
import { CATEGORY_LABELS, type Locale, type StringKey } from "@gml/core";
import { useI18n } from "../i18n.js";
import { useLibrary, type CategoryFilter } from "../library.js";

/**
 * One component, three presentations. Only categories that hold assets are
 * listed — the library decides, not a fixed menu.
 */
export type CategoryNavVariant = "sidebar" | "chips" | "sheet";

function labelFor(category: CategoryFilter, locale: Locale, t: (key: StringKey) => string): string {
  if (category === "all" || category === "favorites" || category === "recent") return t(category);
  return CATEGORY_LABELS[category][locale];
}

export function CategoryNav({ variant }: { variant: CategoryNavVariant }) {
  const { t, locale } = useI18n();
  const { filter, setFilter, categories } = useLibrary();
  const [sheetOpen, setSheetOpen] = useState(false);

  const label = (c: CategoryFilter) => labelFor(c, locale, t);

  if (variant === "sidebar") {
    return (
      <nav className="gml-sidebar" aria-label={t("library")} data-testid="category-sidebar">
        <p className="gml-sidebar__heading">{t("library")}</p>
        <ul className="gml-sidebar__list">
          {(["all", ...categories] as CategoryFilter[]).map((c) => (
            <li key={c}>
              <button type="button" className="gml-sidebar__item" data-active={filter === c || undefined} data-category={c} onClick={() => setFilter(c)}>
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
              <button type="button" className="gml-sidebar__item" data-active={filter === c || undefined} data-category={c} onClick={() => setFilter(c)}>
                {label(c)}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  if (variant === "chips") {
    return (
      <div className="gml-chips" role="tablist" aria-label={t("library")} data-testid="category-chips">
        {(["all", ...categories] as CategoryFilter[]).map((c) => (
          <button key={c} type="button" role="tab" aria-selected={filter === c} className="gml-chip" data-active={filter === c || undefined} data-category={c} onClick={() => setFilter(c)}>
            {label(c)}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="gml-sheet" data-testid="category-sheet">
      <button type="button" className="gml-sheet__trigger" aria-expanded={sheetOpen} onClick={() => setSheetOpen((open) => !open)}>
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
