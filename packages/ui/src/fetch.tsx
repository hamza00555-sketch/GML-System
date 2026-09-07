import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Deliverable, LibraryAsset } from "@gml/core";

/**
 * fetchAsset(assetId, version, onProgress) → local path, as the panel sees
 * it. The three visible states:
 *
 *   ☁  cloud     deliverable not on this machine
 *   ⬇  fetching  real progress, real percentage
 *   ✓  ready     local, instant
 */
export type FetchStatus = "cloud" | "fetching" | "ready" | "failed";

export interface FetchState {
  status: FetchStatus;
  done: number;
  total: number;
  error?: string;
}

export interface FetchService {
  state(asset: LibraryAsset, deliverable: Deliverable): FetchState;
  /** Fires on any state change; the UI re-reads what it shows. */
  subscribe(listener: () => void): () => void;
  /** Resolves with the local path once the file is fully materialised. */
  fetch(asset: LibraryAsset, deliverable: Deliverable): Promise<string>;
  /** Starts a fetch nobody is waiting on — the detail view opening, say. */
  prefetch(asset: LibraryAsset, deliverable: Deliverable): void;
}

const FetchContext = createContext<FetchService | null>(null);

export function FetchProvider({ service, children }: { service: FetchService; children: ReactNode }) {
  return <FetchContext.Provider value={service}>{children}</FetchContext.Provider>;
}

export function useFetch(): FetchService {
  const service = useContext(FetchContext);
  if (!service) throw new Error("useFetch must be used inside <FetchProvider>");
  return service;
}

/** Re-renders the caller whenever any fetch state changes. */
export function useFetchTick(): number {
  const service = useFetch();
  const [tick, setTick] = useState(0);
  useEffect(() => service.subscribe(() => setTick((n) => n + 1)), [service]);
  return tick;
}

export function useFetchState(asset: LibraryAsset, deliverable: Deliverable): FetchState {
  const service = useFetch();
  useFetchTick();
  return service.state(asset, deliverable);
}

export function percent(state: FetchState): number {
  return state.total > 0 ? Math.min(100, Math.floor((state.done / state.total) * 100)) : 0;
}
