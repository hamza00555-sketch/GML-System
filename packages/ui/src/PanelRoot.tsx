import type { Locale } from "@gml/core";
import { FetchProvider, type FetchService } from "./fetch.js";
import { I18nProvider, useI18n } from "./i18n.js";
import { HostBridgeProvider, type HostBridge } from "./host.js";
import { LibraryStateProvider, useLibrary, type LibrarySource } from "./library.js";
import { PlaybackProvider } from "./media.js";
import { SelectionProvider } from "./selection.js";
import { WorkspaceSwitch } from "./layouts/index.js";
import { useWorkspaceMode } from "./useWorkspaceMode.js";

export type PanelTheme = "dark" | "light";

export interface PanelRootProps {
  bridge: HostBridge;
  source: LibrarySource;
  fetch: FetchService;
  /** Forces a locale; otherwise the stored preference is used, defaulting to English. */
  locale?: Locale;
  /** Follows the host's skin; dark when unknown. */
  theme?: PanelTheme;
  /** Test seam so a layout can be rendered without a ResizeObserver. */
  initialWidth?: number;
  /** Bump to re-read the library — the host app does this after publishing or rescanning. */
  reloadToken?: number;
}

function PanelShell({ initialWidth, theme }: { initialWidth?: number; theme: PanelTheme }) {
  const { mode, width, ref } = useWorkspaceMode(initialWidth);
  const { dir, locale } = useI18n();
  const { loading, error, index } = useLibrary();

  return (
    <div
      ref={ref}
      className="gml-panel"
      // CSS selects on these rather than container queries, which need
      // Chromium 105 while CEP tops out at 99.
      data-mode={mode}
      data-theme={theme}
      data-host-width={Math.round(width)}
      dir={dir}
      lang={locale}
      data-testid="panel-root"
    >
      {error ? (
        <p className="gml-error" role="alert">
          {error}
        </p>
      ) : loading && !index ? (
        <p className="gml-loading">…</p>
      ) : (
        <WorkspaceSwitch mode={mode} />
      )}
    </div>
  );
}

export function PanelRoot({ bridge, source, fetch, locale, theme = "dark", initialWidth, reloadToken }: PanelRootProps) {
  return (
    <I18nProvider locale={locale}>
      <HostBridgeProvider bridge={bridge}>
        <FetchProvider service={fetch}>
          <LibraryStateProvider source={source} reloadToken={reloadToken}>
            <PlaybackProvider>
              <SelectionProvider>
                <PanelShell initialWidth={initialWidth} theme={theme} />
              </SelectionProvider>
            </PlaybackProvider>
          </LibraryStateProvider>
        </FetchProvider>
      </HostBridgeProvider>
    </I18nProvider>
  );
}
