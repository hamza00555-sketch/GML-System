import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  DEFAULT_LOCALE,
  assetName,
  directionFor,
  formatDuration,
  t,
  type GmlAsset,
  type Locale,
  type StringKey,
} from "@gml/core";

/**
 * Tool chrome is English by default, with Arabic available from Settings.
 * Switching also flips the document direction; layout uses logical properties
 * so nothing needs a mirrored stylesheet.
 */

const STORAGE_KEY = "gml.locale";

export interface I18nValue {
  locale: Locale;
  dir: "ltr" | "rtl";
  setLocale: (locale: Locale) => void;
  t: (key: StringKey) => string;
  nameOf: (asset: GmlAsset) => string;
  duration: (seconds: number) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function readStoredLocale(): Locale {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    return stored === "ar" || stored === "en" ? stored : DEFAULT_LOCALE;
  } catch {
    // Private windows and locked-down hosts throw on access; the default is fine.
    return DEFAULT_LOCALE;
  }
}

export interface I18nProviderProps {
  children: ReactNode;
  /** Overrides the stored preference; used by tests and by host defaults. */
  locale?: Locale;
}

export function I18nProvider({ children, locale: forced }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() => forced ?? readStoredLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, next);
    } catch {
      // Preference simply will not survive a restart; not worth failing over.
    }
  }, []);

  const value = useMemo<I18nValue>(() => {
    const active = forced ?? locale;
    return {
      locale: active,
      dir: directionFor(active),
      setLocale,
      t: (key) => t(key, active),
      nameOf: (asset) => assetName(asset, active),
      duration: (seconds) => formatDuration(seconds, active),
    };
  }, [forced, locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside <I18nProvider>");
  return value;
}
