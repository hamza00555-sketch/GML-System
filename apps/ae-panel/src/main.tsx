import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AE_CAPABILITIES, FakeFetchService, PanelRoot, fakeSource, type PanelTheme } from "@gml/ui";
import { emptyIndex } from "@gml/core";
import {
  CepHostBridge,
  DiagnosticsView,
  LibraryRuntime,
  PublishView,
  SettingsView,
  aeInspectAep,
  extractPosterFromVideo,
  hostTheme,
  onThemeChange,
  panelNode,
  readConfig,
  writeConfig,
  type GmlConfig,
} from "@gml/cep";
import "@gml/ui/tokens.css";
import "@gml/ui/panel.css";

/**
 * After Effects panel. The library is the team's Shared Drive folder as
 * Google Drive for Desktop mirrors it; the panel indexes it, caches what it
 * uses locally, and imports only from the cache.
 */
const node = panelNode();

function buildRuntime(config: GmlConfig): LibraryRuntime | null {
  if (!node) return null;
  try {
    return new LibraryRuntime({
      node,
      config,
      makePoster: (url) => extractPosterFromVideo(url),
      inspectAep: aeInspectAep,
      onLog: (m) => console.warn(`[gml] ${m}`),
    });
  } catch (error) {
    console.error("[gml] runtime failed", error);
    return null;
  }
}

type View = "library" | "settings" | "publish" | "diagnostics";

function Panel() {
  const [config, setConfig] = useState<GmlConfig>(() => readConfig(node));
  const runtime = useMemo(() => buildRuntime(config), []);
  const [view, setView] = useState<View>(() => (config.libraryRoot && runtime ? "library" : "settings"));
  const [theme, setTheme] = useState<PanelTheme>(() => hostTheme());
  const [reloadToken, setReloadToken] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const bridge = useMemo(
    () =>
      new CepHostBridge({
        capabilities: AE_CAPABILITIES,
        runtime,
        onError: (context, error) => console.error(`[gml] ${context}: ${error instanceof Error ? error.message : String(error)}`),
      }),
    [runtime],
  );

  useEffect(() => {
    bridge.onPublishRequest = () => setView(runtime ? "publish" : "settings");
  }, [bridge, runtime]);

  useEffect(() => onThemeChange(setTheme), []);

  // First run: index the library once a folder is known, then keep posters coming.
  useEffect(() => {
    if (!runtime || !config.libraryRoot) return;
    if (runtime.status().assets === 0) {
      runtime.scan().then(() => setReloadToken((n) => n + 1)).catch((e) => setNotice(String(e instanceof Error ? e.message : e)));
    } else {
      void runtime.ensurePosters();
    }
  }, [runtime]);

  const source = useMemo(() => runtime?.source ?? fakeSource(emptyIndex("")), [runtime]);
  const fetch = useMemo(() => runtime?.fetchService ?? new FakeFetchService("instant"), [runtime]);

  const saveConfig = (next: GmlConfig) => {
    writeConfig(node, next);
    setConfig(next);
    runtime?.applyConfig(next);
    setReloadToken((n) => n + 1);
  };

  return (
    <div className="gml-panelhost">
      <PanelRoot bridge={bridge} source={source} fetch={fetch} theme={theme} reloadToken={reloadToken} />

      {view === "settings" && (
        <SettingsView
          node={node}
          runtime={runtime}
          config={config}
          canScan
          onSave={(next) => {
            saveConfig(next);
            if (next.libraryRoot) setView("library");
          }}
          onClose={config.libraryRoot ? () => setView("library") : undefined}
        />
      )}
      {view === "publish" && runtime && (
        <PublishView
          runtime={runtime}
          onClose={() => setView("library")}
          onDone={() => {
            setReloadToken((n) => n + 1);
            setNotice("Published — Drive is syncing it to the team");
            setView("library");
          }}
        />
      )}
      {view === "diagnostics" && <DiagnosticsView onClose={() => setView("library")} />}

      {view === "library" && (
        <div className="gml-corner">
          {notice && (
            <button type="button" className="gml-diagbtn" onClick={() => setNotice(null)} title="dismiss">
              {notice}
            </button>
          )}
          <button type="button" className="gml-diagbtn" onClick={() => setView("settings")} title="Library, cache and sign-in">
            ⚙ Settings
          </button>
          <button type="button" className="gml-diagbtn" onClick={() => setView("diagnostics")}>
            Diagnostics
          </button>
        </div>
      )}
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <Panel />
  </StrictMode>,
);
