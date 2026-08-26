import { useEffect, useState } from "react";
import type { AudioAsset } from "@gml/core";

/**
 * Waveform bars come from peaks.json, computed once at publish time. The panel
 * never decodes audio to draw them — that is the whole point of shipping the
 * file. An asset without peaks simply renders a plain progress bar.
 */

const cache = new Map<string, number[]>();
const inFlight = new Map<string, Promise<number[]>>();

function normalisePeaks(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const values = raw.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (values.length === 0) return [];
  const max = Math.max(...values.map(Math.abs));
  return max > 0 ? values.map((v) => Math.abs(v) / max) : values.map(() => 0);
}

export async function loadPeaks(url: string): Promise<number[]> {
  const cached = cache.get(url);
  if (cached) return cached;

  const pending = inFlight.get(url);
  if (pending) return pending;

  const request = fetch(url)
    .then((res) => (res.ok ? res.json() : []))
    .then((json: unknown) => {
      // Accept either a bare array or { peaks: [...] }.
      const raw = Array.isArray(json) ? json : (json as { peaks?: unknown })?.peaks;
      const peaks = normalisePeaks(raw);
      cache.set(url, peaks);
      return peaks;
    })
    .catch(() => {
      cache.set(url, []);
      return [];
    })
    .finally(() => inFlight.delete(url));

  inFlight.set(url, request);
  return request;
}

export function usePeaks(asset: AudioAsset, resolve: (path: string) => string): number[] | undefined {
  const [peaks, setPeaks] = useState<number[] | undefined>(undefined);
  const path = asset.peaks;

  useEffect(() => {
    if (!path) {
      setPeaks(undefined);
      return;
    }
    let cancelled = false;
    void loadPeaks(resolve(path)).then((result) => {
      if (!cancelled) setPeaks(result.length > 0 ? result : undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [path, resolve]);

  return peaks;
}
