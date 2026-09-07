import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  CATEGORIES,
  assetReadiness,
  searchAssets,
  type Category,
  type InstalledEnvironment,
  type LibraryAsset,
  type LibraryIndex,
  type ReadinessResult,
  type Stamp,
} from "@gml/core";
import { useHost } from "./host.js";

/**
 * Library state for the panel: the index, what is filtered in, and the small
 * per-user lists (favourites, recents). Search runs locally over the index.
 */

export interface LibrarySource {
  load(): Promise<LibraryIndex>;
  /** Fires after a rescan or when a colleague's publish synced. */
  subscribe?(listener: () => void): () => void;
}

export type CategoryFilter = Category | "all" | "favorites" | "recent";

export interface LibraryValue {
  loading: boolean;
  error: string | null;
  index: LibraryIndex | null;
  all: LibraryAsset[];
  visible: LibraryAsset[];
  /** Categories that actually have assets, in canonical order. */
  categories: Category[];
  query: string;
  setQuery(q: string): void;
  filter: CategoryFilter;
  setFilter(f: CategoryFilter): void;
  favorites: ReadonlySet<string>;
  toggleFavorite(id: string): void;
  recent: readonly string[];
  markUsed(id: string): void;
  environment: InstalledEnvironment;
  readinessOf(asset: LibraryAsset): ReadinessResult;
  /** Versions the open project uses, by id. */
  projectVersions: ReadonlyMap<string, number[]>;
  /** The project holds an older version of this asset than the library. */
  updateAvailable(asset: LibraryAsset): boolean;
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

export function LibraryStateProvider({
  source,
  reloadToken = 0,
  children,
}: {
  source: LibrarySource;
  /** Bump to re-read the library, e.g. after the panel itself published. */
  reloadToken?: number;
  children: ReactNode;
}) {
  const host = useHost();
  const [index, setIndex] = useState<LibraryIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(() => new Set(readList(FAVORITES_KEY)));
  const [recent, setRecent] = useState<readonly string[]>(() => readList(RECENT_KEY));
  const [environment, setEnvironment] = useState<InstalledEnvironment>({});
  const [stamps, setStamps] = useState<Stamp[]>([]);
  const [internalReload, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    source
      .load()
      .then((next) => {
        if (!cancelled) setIndex(next);
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
  }, [source, internalReload, reloadToken]);

  useEffect(() => source.subscribe?.(() => setReloadToken((n) => n + 1)), [source]);

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
    host
      .getProjectStamps?.()
      .then((found) => {
        if (!cancelled) setStamps(found);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [host, internalReload, reloadToken]);

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

  const all = useMemo(() => index?.assets ?? [], [index]);

  const categories = useMemo(() => {
    const present = new Set(all.map((a) => a.category));
    return CATEGORIES.filter((c) => present.has(c));
  }, [all]);

  const visible = useMemo(() => {
    if (filter === "recent") {
      const byId = new Map(all.map((a) => [a.id, a]));
      const ordered = recent.map((id) => byId.get(id)).filter((a): a is LibraryAsset => Boolean(a));
      // Recents keep their own order, so only the text query narrows them.
      return query ? searchAssets(ordered, { query }) : ordered;
    }
    return searchAssets(all, {
      query,
      category: filter === "favorites" ? "all" : filter,
      favorites,
      onlyFavorites: filter === "favorites",
    });
  }, [all, query, filter, favorites, recent]);

  const readinessOf = useCallback((asset: LibraryAsset) => assetReadiness(asset, environment), [environment]);

  const projectVersions = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const s of stamps) map.set(s.id, [...(map.get(s.id) ?? []), s.version]);
    return map;
  }, [stamps]);

  const updateAvailable = useCallback(
    (asset: LibraryAsset) => {
      const inProject = projectVersions.get(asset.id);
      return Boolean(inProject && inProject.some((v) => v < asset.version));
    },
    [projectVersions],
  );

  const value = useMemo<LibraryValue>(
    () => ({
      loading,
      error,
      index,
      all,
      visible,
      categories,
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
      projectVersions,
      updateAvailable,
      reload: () => setReloadToken((n) => n + 1),
    }),
    [loading, error, index, all, visible, categories, query, filter, favorites, toggleFavorite, recent, markUsed, environment, readinessOf, projectVersions, updateAvailable],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryValue {
  const value = useContext(LibraryContext);
  if (!value) throw new Error("useLibrary must be used inside <LibraryStateProvider>");
  return value;
}
