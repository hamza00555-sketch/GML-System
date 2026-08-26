import type { Locale } from "@gml/core";
import type { LibraryProvider } from "@gml/storage";
import { I18nProvider, useI18n } from "./i18n.js";
import { HostBridgeProvider, type HostBridge } from "./host.js";
import { LibraryStateProvider, useLibrary } from "./library.js";
import { PlaybackProvider } from "./media.js";
import { SelectionProvider } from "./selection.js";
import { WorkspaceSwitch } from "./layouts/index.js";
import { useWorkspaceMode } from "./useWorkspaceMode.js";

export interface PanelRootProps {
  bridge: HostBridge;
  provider: LibraryProvider;
  /** Forces a locale; otherwise the stored preference is used, defaulting to English. */
  locale?: Locale;
  /** Test seam so a layout can be rendered without a ResizeObserver. */
  initialWidth?: number;
}

function PanelShell({ initialWidth }: { initialWidth?: number }) {
  const { mode, width, ref } = useWorkspaceMode(initialWidth);
  const { dir, locale } = useI18n();
  const { loading, error } = useLibrary();

  return (
    <div
      ref={ref}
      className="gml-panel"
      // CSS selects on these rather than container queries, which need
      // Chromium 105 while CEP tops out at 99.
      data-mode={mode}
      data-host-width={Math.round(width)}
      dir={dir}
      lang={locale}
      data-testid="panel-root"
    >
      {error ? (
        <p className="gml-error" role="alert">
          {error}
        </p>
      ) : loading ? (
        <p className="gml-loading">…</p>
      ) : (
        <WorkspaceSwitch mode={mode} />
      )}
    </div>
  );
}

export function PanelRoot({ bridge, provider, locale, initialWidth }: PanelRootProps) {
  return (
    <I18nProvider locale={locale}>
      <HostBridgeProvider bridge={bridge}>
        <LibraryStateProvider provider={provider}>
          <PlaybackProvider>
            <SelectionProvider>
              <PanelShell initialWidth={initialWidth} />
            </SelectionProvider>
          </PlaybackProvider>
        </LibraryStateProvider>
      </HostBridgeProvider>
    </I18nProvider>
  );
}
