import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * One piece of media plays at a time, across video *and* audio together.
 *
 * Two rules keep CEP's Chromium usable with a full grid:
 *  - exactly one card in the grid renders a <video> (the active one), plus at
 *    most one more in the inspector, so element count never tracks card count;
 *  - a single shared <audio> element lives here and cards only send it commands,
 *    which is also what stops two sounds overlapping.
 */

export type MediaKind = "video" | "audio";

/** Delay before hover starts playback, so sweeping across the grid plays nothing. */
export const HOVER_INTENT_MS = 150;

/** One video for the grid, one for the inspector. */
export const MAX_CONCURRENT_VIDEOS = 2;

export type MediaSurface = "grid" | "inspector";

export interface PlaybackValue {
  activeId: string | null;
  activeKind: MediaKind | null;
  activeSurface: MediaSurface | null;
  play(id: string, kind: MediaKind, surface?: MediaSurface, src?: string): void;
  stop(id?: string): void;
  isActive(id: string, surface?: MediaSurface): boolean;
  audioProgress: number;
  audioDuration: number;
  seekAudio(seconds: number): void;
}

const PlaybackContext = createContext<PlaybackValue | null>(null);

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeKind, setActiveKind] = useState<MediaKind | null>(null);
  const [activeSurface, setActiveSurface] = useState<MediaSurface | null>(null);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);

  const stopAudio = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setAudioProgress(0);
  }, []);

  const play = useCallback(
    (id: string, kind: MediaKind, surface: MediaSurface = "grid", src?: string) => {
      // Starting anything stops whatever was playing — including the other kind.
      if (kind === "video") stopAudio();

      setActiveId(id);
      setActiveKind(kind);
      setActiveSurface(surface);

      if (kind === "audio") {
        const el = audioRef.current;
        if (el && src) {
          if (el.src !== src) el.src = src;
          el.currentTime = 0;
          void el.play?.().catch(() => {
            // Autoplay policy or a codec the host cannot decode; the UI still
            // reflects intent and the user can retry.
          });
        }
      }
    },
    [stopAudio],
  );

  const stop = useCallback(
    (id?: string) => {
      setActiveId((current) => {
        if (id && current !== id) return current;
        stopAudio();
        setActiveKind(null);
        setActiveSurface(null);
        return null;
      });
    },
    [stopAudio],
  );

  const seekAudio = useCallback((seconds: number) => {
    const el = audioRef.current;
    if (el) el.currentTime = seconds;
  }, []);

  const isActive = useCallback(
    (id: string, surface?: MediaSurface) =>
      activeId === id && (surface === undefined || activeSurface === surface),
    [activeId, activeSurface],
  );

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onTime = () => setAudioProgress(el.currentTime);
    const onMeta = () => setAudioDuration(Number.isFinite(el.duration) ? el.duration : 0);
    const onEnded = () => {
      setAudioProgress(0);
      setActiveId(null);
      setActiveKind(null);
      setActiveSurface(null);
    };

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("ended", onEnded);
    };
  }, []);

  const value = useMemo<PlaybackValue>(
    () => ({
      activeId,
      activeKind,
      activeSurface,
      play,
      stop,
      isActive,
      audioProgress,
      audioDuration,
      seekAudio,
    }),
    [activeId, activeKind, activeSurface, play, stop, isActive, audioProgress, audioDuration, seekAudio],
  );

  return (
    <PlaybackContext.Provider value={value}>
      {children}
      {/* The one and only audio element in the panel. */}
      <audio ref={audioRef} preload="none" data-testid="gml-audio" />
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
