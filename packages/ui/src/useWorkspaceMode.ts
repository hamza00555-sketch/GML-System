import { useEffect, useRef, useState } from "react";

/**
 * Three genuinely different layouts, chosen by the width of the CEP panel.
 *
 * Container queries would be the natural tool but they need Chromium 105 and
 * CEP tops out at 99, so a ResizeObserver drives the choice and writes it to a
 * `data-mode` attribute that CSS selects on.
 */
export type WorkspaceMode = "compact" | "standard" | "explorer";

export const MODE_ORDER: readonly WorkspaceMode[] = ["compact", "standard", "explorer"];

/** Upper bound of each mode; tune against the real panel, not a browser window. */
export const BREAKPOINTS = { compact: 280, standard: 650 } as const;

/**
 * Dead band around each breakpoint. Without it, dragging the panel edge to rest
 * exactly on a boundary makes the layout flicker between two modes.
 */
export const HYSTERESIS = 16;

function rawMode(width: number): WorkspaceMode {
  if (width < BREAKPOINTS.compact) return "compact";
  if (width < BREAKPOINTS.standard) return "standard";
  return "explorer";
}

function upperBoundOf(mode: WorkspaceMode): number {
  return mode === "compact"
    ? BREAKPOINTS.compact
    : mode === "standard"
      ? BREAKPOINTS.standard
      : Number.POSITIVE_INFINITY;
}

function lowerBoundOf(mode: WorkspaceMode): number {
  return mode === "explorer"
    ? BREAKPOINTS.standard
    : mode === "standard"
      ? BREAKPOINTS.compact
      : Number.NEGATIVE_INFINITY;
}

/**
 * Resolves the mode for a width, holding the current one until the width has
 * cleared the boundary by more than the dead band. Applied repeatedly so a
 * large jump lands on the right mode instead of stepping one at a time.
 */
export function resolveMode(width: number, current: WorkspaceMode | null): WorkspaceMode {
  if (current === null) return rawMode(width);

  let mode = current;
  for (let guard = 0; guard < MODE_ORDER.length; guard++) {
    const index = MODE_ORDER.indexOf(mode);
    if (width >= upperBoundOf(mode) + HYSTERESIS && index < MODE_ORDER.length - 1) {
      mode = MODE_ORDER[index + 1]!;
      continue;
    }
    if (width < lowerBoundOf(mode) - HYSTERESIS && index > 0) {
      mode = MODE_ORDER[index - 1]!;
      continue;
    }
    break;
  }
  return mode;
}

export interface WorkspaceModeResult {
  mode: WorkspaceMode;
  width: number;
  ref: React.RefObject<HTMLDivElement>;
}

export function useWorkspaceMode(initialWidth: number = BREAKPOINTS.standard): WorkspaceModeResult {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initialWidth);
  const [mode, setMode] = useState<WorkspaceMode>(() => resolveMode(initialWidth, null));

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const next = entry.contentRect.width;
      setWidth(next);
      setMode((current) => resolveMode(next, current));
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { mode, width, ref };
}
