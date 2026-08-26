import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  assetReadiness,
  searchAssets,
  type Category,
  type GmlAsset,
  type InstalledEnvironment,
  type ReadinessResult,
} from "@gml/core";
import type { LibraryProvider } from "@gml/storage";
import { useHost } from "./host.js";

/**
 * Library state for the panel: what exists, what is filtered in, and the small
 * per-user lists (favourites, recents). Search runs locally because Drive has
 * no server-side query — the provider hands us pages and we do the rest.
 */

export type CategoryFilter = Category | "all" | "favorites" | "recent";

export interface LibraryValue {
  loading: boolean;
  error: string | null;
  all: GmlAsset[];
  visible: GmlAsset[];
  query: string;
  setQuery(q: string): void;
  filter: CategoryFilter;
  setFilter(f: CategoryFilter): void;
  favorites: ReadonlySet<string>;
  toggleFavorite(id: string): void;
  recent: readonly string[];
  markUsed(id: string): void;
  environment: InstalledEnvironment;
  readinessOf(asset: GmlAsset): ReadinessResult;
  reload(): void;
}

const LibraryContext = createContext<LibraryValue | null>(null);

const FAVORITES_KEY = "gml.favorites";
const RECENT_KEY = "gml.recent";
const RECENT_LIMIT = 12;

function readList(key: string): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeList(key: string, value: readonly string[]): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Per-viewer convenience only; losing it is not worth surfacing.
  }
}

async function loadAll(provider: LibraryProvider): Promise<GmlAsset[]> {
  const assets: GmlAsset[] = [];
  let cursor: string | undefined;
  do {
    const page = await provider.list(cursor ? { cursor } : undefined);
    assets.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  return assets;
}

export function LibraryStateProvider({
  provider,
  children,
}: {
  provider: LibraryProvider;
  children: ReactNode;
}) {
  const host = useHost();
  const [all, setAll] = useState<GmlAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(() => new Set(readList(FAVORITES_KEY)));
  const [recent, setRecent] = useState<readonly string[]>(() => readList(RECENT_KEY));
  const [environment, setEnvironment] = useState<InstalledEnvironment>({});
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    loadAll(provider)
      .then((assets) => {
        if (!cancelled) setAll(assets);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [provider, reloadToken]);

  useEffect(() => {
    let cancelled = false;
    host
      .getEnvironment()
      .then((env) => {
        if (!cancelled) setEnvironment(env);
      })
      .catch(() => {
        // Without an inventory nothing is claimed missing — see assetReadiness.
      });
    return () => {
      cancelled = true;
    };
  }, [host]);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeList(FAVORITES_KEY, [...next]);
      return next;
    });
  }, []);

  const markUsed = useCallback((id: string) => {
    setRecent((current) => {
      const next = [id, ...current.filter((x) => x !== id)].slice(0, RECENT_LIMIT);
      writeList(RECENT_KEY, next);
      return next;
    });
  }, []);

  const hiddenCategories = host.capabilities.hiddenCategories;

  const visible = useMemo(() => {
    if (filter === "recent") {
      const byId = new Map(all.map((a) => [a.id, a]));
      const hidden = new Set(hiddenCategories);
      const ordered = recent
        .map((id) => byId.get(id))
        .filter((a): a is GmlAsset => Boolean(a) && !hidden.has(a!.category));
      // Recents keep their own order, so only the text query narrows them.
      return query ? searchAssets(ordered, { query, hiddenCategories }) : ordered;
    }

    return searchAssets(all, {
      query,
      category: filter === "favorites" ? "all" : filter,
      favorites,
      onlyFavorites: filter === "favorites",
      hiddenCategories,
    });
  }, [all, query, filter, favorites, recent, hiddenCategories]);

  const readinessOf = useCallback(
    (asset: GmlAsset) => assetReadiness(asset, environment),
    [environment],
  );

  const value = useMemo<LibraryValue>(
    () => ({
      loading,
      error,
      all,
      visible,
      query,
      setQuery,
      filter,
      setFilter,
      favorites,
      toggleFavorite,
      recent,
      markUsed,
      environment,
      readinessOf,
      reload: () => setReloadToken((n) => n + 1),
    }),
    [loading, error, all, visible, query, filter, favorites, toggleFavorite, recent, markUsed, environment, readinessOf],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryValue {
  const value = useContext(LibraryContext);
  if (!value) throw new Error("useLibrary must be used inside <LibraryStateProvider>");
  return value;
}
