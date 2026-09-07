import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { primaryDeliverable, type Deliverable, type LibraryAsset } from "@gml/core";
import { useFetch } from "./fetch.js";
import { useHost, type ApplyItem, type HostResult } from "./host.js";

/**
 * Selection drives the inspector; the queue drives the drop zone.
 *
 * Apply is the only primary action: ready → import immediately; cloud →
 * fetch with progress, then import. The fetch is started the moment an asset
 * is selected, so by the time someone decides, it is usually done.
 */

export interface QueueItem {
  asset: LibraryAsset;
  /** Stable across reorders so React keys stay honest. */
  key: string;
}

export interface ApplyProgress {
  asset: LibraryAsset;
  index: number;
  count: number;
}

export interface SelectionValue {
  selected: LibraryAsset | null;
  select(asset: LibraryAsset | null): void;
  /** The chosen variant for an asset; the primary one until changed. */
  variantFor(asset: LibraryAsset): Deliverable;
  chooseVariant(asset: LibraryAsset, relPath: string): void;
  queue: readonly QueueItem[];
  enqueue(asset: LibraryAsset): void;
  dequeue(key: string): void;
  moveInQueue(key: string, toIndex: number): void;
  clearQueue(): void;
  applying: boolean;
  applyProgress: ApplyProgress | null;
  lastResult: HostResult | null;
  /** Applies the queue, or a single asset for the click path. */
  applyNow(single?: LibraryAsset): Promise<HostResult>;
}

const SelectionContext = createContext<SelectionValue | null>(null);

export function SelectionProvider({ children, onApplied }: { children: ReactNode; onApplied?: (assets: readonly LibraryAsset[]) => void }) {
  const host = useHost();
  const fetch = useFetch();
  const [selected, setSelected] = useState<LibraryAsset | null>(null);
  const [variants, setVariants] = useState<ReadonlyMap<string, string>>(new Map());
  const [queue, setQueue] = useState<readonly QueueItem[]>([]);
  const [applying, setApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState<ApplyProgress | null>(null);
  const [lastResult, setLastResult] = useState<HostResult | null>(null);
  const counter = useRef(0);

  const variantFor = useCallback(
    (asset: LibraryAsset): Deliverable => {
      const chosen = variants.get(asset.id);
      return asset.deliverables.find((d) => d.relPath === chosen) ?? primaryDeliverable(asset);
    },
    [variants],
  );

  const chooseVariant = useCallback((asset: LibraryAsset, relPath: string) => {
    setVariants((current) => new Map(current).set(asset.id, relPath));
  }, []);

  // Prefetch on selection, not on Apply — the detail view opening is the signal.
  useEffect(() => {
    if (selected) fetch.prefetch(selected, variantFor(selected));
  }, [selected, variantFor, fetch]);

  const enqueue = useCallback((asset: LibraryAsset) => {
    counter.current += 1;
    const key = `${asset.id}@v${asset.version}#${counter.current}`;
    setQueue((current) => [...current, { asset, key }]);
  }, []);

  const dequeue = useCallback((key: string) => {
    setQueue((current) => current.filter((item) => item.key !== key));
  }, []);

  const moveInQueue = useCallback((key: string, toIndex: number) => {
    setQueue((current) => {
      const from = current.findIndex((item) => item.key === key);
      if (from === -1) return current;
      const next = [...current];
      const [item] = next.splice(from, 1);
      if (!item) return current;
      next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, item);
      return next;
    });
  }, []);

  const clearQueue = useCallback(() => setQueue([]), []);

  const applyNow = useCallback(
    async (single?: LibraryAsset): Promise<HostResult> => {
      const assets = single ? [single] : queue.map((item) => item.asset);
      if (assets.length === 0) {
        const empty: HostResult = { ok: false, message: "Nothing to apply" };
        setLastResult(empty);
        return empty;
      }

      setApplying(true);
      try {
        // Fetch first, always. Nothing reaches the host until it is local and complete.
        const items: ApplyItem[] = [];
        for (let i = 0; i < assets.length; i++) {
          const asset = assets[i]!;
          const deliverable = variantFor(asset);
          setApplyProgress({ asset, index: i, count: assets.length });
          const localPath = await fetch.fetch(asset, deliverable);
          items.push({ asset, deliverable, localPath });
        }
        const result = await host.applyAssets(items);
        setLastResult(result);
        if (result.ok) {
          onApplied?.(assets);
          if (!single) setQueue([]);
        }
        return result;
      } catch (err: unknown) {
        const failed: HostResult = { ok: false, message: err instanceof Error ? err.message : String(err) };
        setLastResult(failed);
        return failed;
      } finally {
        setApplying(false);
        setApplyProgress(null);
      }
    },
    [host, fetch, queue, variantFor, onApplied],
  );

  const value = useMemo<SelectionValue>(
    () => ({
      selected,
      select: setSelected,
      variantFor,
      chooseVariant,
      queue,
      enqueue,
      dequeue,
      moveInQueue,
      clearQueue,
      applying,
      applyProgress,
      lastResult,
      applyNow,
    }),
    [selected, variantFor, chooseVariant, queue, enqueue, dequeue, moveInQueue, clearQueue, applying, applyProgress, lastResult, applyNow],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): SelectionValue {
  const value = useContext(SelectionContext);
  if (!value) throw new Error("useSelection must be used inside <SelectionProvider>");
  return value;
}
