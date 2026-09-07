import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AI_CAPABILITIES, FakeFetchService, PanelRoot, fakeSource, type PanelTheme } from "@gml/ui";
import { emptyIndex } from "@gml/core";
import {
  CepHostBridge,
  DiagnosticsView,
  LibraryRuntime,
  SettingsView,
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
 * Illustrator panel. Same library, same cache, same config as After Effects.
 * It cannot read comps out of project files, so a rescan here keeps the
 * expansions After Effects produced. Place stays a message-only stub.
 */
const node = panelNode();

function buildRuntime(config: GmlConfig): LibraryRuntime | null {
  if (!node) return null;
  try {
    return new LibraryRuntime({ node, config, makePoster: (url) => extractPosterFromVideo(url), onLog: (m) => console.warn(`[gml] ${m}`) });
  } catch (error) {
    console.error("[gml] runtime failed", error);
    return null;
  }
}

type View = "library" | "settings" | "diagnostics";

function Panel() {
  const [config, setConfig] = useState<GmlConfig>(() => readConfig(node));
  const runtime = useMemo(() => buildRuntime(config), []);
  const [view, setView] = useState<View>(() => (config.libraryRoot && runtime ? "library" : "settings"));
  const [theme, setTheme] = useState<PanelTheme>(() => hostTheme());
  const [reloadToken, setReloadToken] = useState(0);

  const bridge = useMemo(
    () =>
      new CepHostBridge({
        capabilities: AI_CAPABILITIES,
        runtime,
        onError: (context, error) => console.error(`[gml] ${context}: ${error instanceof Error ? error.message : String(error)}`),
      }),
    [runtime],
  );

  useEffect(() => onThemeChange(setTheme), []);

  useEffect(() => {
    if (!runtime || !config.libraryRoot) return;
    if (runtime.status().assets === 0) runtime.scan().then(() => setReloadToken((n) => n + 1)).catch(() => {});
    else void runtime.ensurePosters();
  }, [runtime]);

  const source = useMemo(() => runtime?.source ?? fakeSource(emptyIndex("")), [runtime]);
  const fetch = useMemo(() => runtime?.fetchService ?? new FakeFetchService("instant"), [runtime]);

  return (
    <div className="gml-panelhost">
      <PanelRoot bridge={bridge} source={source} fetch={fetch} theme={theme} reloadToken={reloadToken} />

      {view === "settings" && (
        <SettingsView
          node={node}
          runtime={runtime}
          config={config}
          canScan={false}
          onSave={(next) => {
            writeConfig(node, next);
            setConfig(next);
            runtime?.applyConfig(next);
            setReloadToken((n) => n + 1);
            if (next.libraryRoot) setView("library");
          }}
          onClose={config.libraryRoot ? () => setView("library") : undefined}
        />
      )}
      {view === "diagnostics" && <DiagnosticsView onClose={() => setView("library")} />}

      {view === "library" && (
        <div className="gml-corner">
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
