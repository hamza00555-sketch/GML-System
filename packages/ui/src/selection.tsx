import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { GmlAsset } from "@gml/core";
import { useHost, type AssetRef, type HostResult } from "./host.js";

/**
 * Selection drives the inspector; the queue drives the drop zone.
 *
 * Dragging a card into the drop zone stages it; a single click applies straight
 * away without touching the queue, which is the fast path designers actually use.
 */

export interface QueueItem {
  asset: GmlAsset;
  /** Stable across reorders so React keys stay honest. */
  key: string;
}

export interface SelectionValue {
  selected: GmlAsset | null;
  select(asset: GmlAsset | null): void;
  queue: readonly QueueItem[];
  enqueue(asset: GmlAsset): void;
  dequeue(key: string): void;
  moveInQueue(key: string, toIndex: number): void;
  clearQueue(): void;
  applying: boolean;
  lastResult: HostResult | null;
  /** Applies the queue, or a single asset for the click path. */
  applyNow(single?: GmlAsset): Promise<HostResult>;
}

const SelectionContext = createContext<SelectionValue | null>(null);

export function SelectionProvider({
  children,
  onApplied,
}: {
  children: ReactNode;
  onApplied?: (assets: readonly GmlAsset[]) => void;
}) {
  const host = useHost();
  const [selected, setSelected] = useState<GmlAsset | null>(null);
  const [queue, setQueue] = useState<readonly QueueItem[]>([]);
  const [applying, setApplying] = useState(false);
  const [lastResult, setLastResult] = useState<HostResult | null>(null);
  const [counter, setCounter] = useState(0);

  const enqueue = useCallback(
    (asset: GmlAsset) => {
      const key = `${asset.id}@${asset.version}#${counter}`;
      setCounter((n) => n + 1);
      setQueue((current) => [...current, { asset, key }]);
    },
    [counter],
  );

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
    async (single?: GmlAsset): Promise<HostResult> => {
      const assets = single ? [single] : queue.map((item) => item.asset);
      if (assets.length === 0) {
        const empty: HostResult = { ok: false, message: "Nothing to apply" };
        setLastResult(empty);
        return empty;
      }

      const refs: AssetRef[] = assets.map((a) => ({ id: a.id, version: a.version }));
      setApplying(true);
      try {
        const result = await host.applyAssets(refs);
        setLastResult(result);
        if (result.ok) {
          onApplied?.(assets);
          if (!single) setQueue([]);
        }
        return result;
      } catch (err: unknown) {
        const failed: HostResult = {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        };
        setLastResult(failed);
        return failed;
      } finally {
        setApplying(false);
      }
    },
    [host, queue, onApplied],
  );

  const value = useMemo<SelectionValue>(
    () => ({
      selected,
      select: setSelected,
      queue,
      enqueue,
      dequeue,
      moveInQueue,
      clearQueue,
      applying,
      lastResult,
      applyNow,
    }),
    [selected, queue, enqueue, dequeue, moveInQueue, clearQueue, applying, lastResult, applyNow],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): SelectionValue {
  const value = useContext(SelectionContext);
  if (!value) throw new Error("useSelection must be used inside <SelectionProvider>");
  return value;
}
