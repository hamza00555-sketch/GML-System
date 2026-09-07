import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Exactly one <video> element exists in the whole panel. It is created once
 * here and portalled into whichever card is hovered or into the inspector;
 * every other card is a poster image. A grid of forty video elements would
 * choke CEF — this design makes that impossible rather than merely unlikely.
 */

/** Delay before hover starts playback, so sweeping across the grid plays nothing. */
export const HOVER_INTENT_MS = 150;

export type MediaSurface = "grid" | "inspector";

export interface PlaybackValue {
  activeId: string | null;
  activeSurface: MediaSurface | null;
  /** Plays `src` inside `target`; whatever was playing stops. */
  play(id: string, src: string, target: HTMLElement, surface?: MediaSurface): void;
  stop(id?: string, surface?: MediaSurface): void;
  isActive(id: string, surface?: MediaSurface): boolean;
}

const PlaybackContext = createContext<PlaybackValue | null>(null);

interface Mount {
  id: string;
  src: string;
  target: HTMLElement;
  surface: MediaSurface;
}

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [mount, setMount] = useState<Mount | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const play = useCallback((id: string, src: string, target: HTMLElement, surface: MediaSurface = "grid") => {
    setMount({ id, src, target, surface });
  }, []);

  const stop = useCallback((id?: string, surface?: MediaSurface) => {
    setMount((current) => {
      if (!current) return null;
      if (id && current.id !== id) return current;
      if (surface && current.surface !== surface) return current;
      return null;
    });
  }, []);

  const isActive = useCallback(
    (id: string, surface?: MediaSurface) => mount?.id === id && (surface === undefined || mount.surface === surface),
    [mount],
  );

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !mount) return;
    el.currentTime = 0;
    void el.play?.().catch(() => {
      // Autoplay policy or a codec the host cannot decode; the poster stays.
    });
  }, [mount]);

  const value = useMemo<PlaybackValue>(
    () => ({ activeId: mount?.id ?? null, activeSurface: mount?.surface ?? null, play, stop, isActive }),
    [mount, play, stop, isActive],
  );

  return (
    <PlaybackContext.Provider value={value}>
      {children}
      {mount &&
        createPortal(
          <video
            ref={videoRef}
            key="gml-shared-video"
            className="gml-video"
            src={mount.src}
            muted
            loop
            playsInline
            autoPlay
            preload="auto"
            data-testid="shared-video"
            data-surface={mount.surface}
          />,
          mount.target,
        )}
    </PlaybackContext.Provider>
  );
}

export function usePlayback(): PlaybackValue {
  const value = useContext(PlaybackContext);
  if (!value) throw new Error("usePlayback must be used inside <PlaybackProvider>");
  return value;
}

/** Hover intent timer shared by the cards. */
export function useHoverIntent(onIntent: () => void, onLeave: () => void, delay = HOVER_INTENT_MS) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  return {
    onMouseEnter: () => {
      clear();
      timer.current = setTimeout(onIntent, delay);
    },
    onMouseLeave: () => {
      clear();
      onLeave();
    },
  };
}
