import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { MockLibraryProvider, type FolderLibraryProvider } from "@gml/storage";
import { AI_CAPABILITIES, PanelRoot } from "@gml/ui";
import {
  CepHostBridge,
  DiagnosticsView,
  LibrarySetupView,
  openLibrary,
  panelNode,
  readConfig,
  writeConfig,
  type GmlConfig,
} from "@gml/cep";
import "@gml/ui/tokens.css";
import "@gml/ui/panel.css";

/**
 * Illustrator panel. Same library folder as After Effects (the config is
 * shared per machine); placing artwork waits on Spike B, so the primary
 * action reports rather than places.
 */
const node = panelNode();

const bridge = new CepHostBridge({
  capabilities: AI_CAPABILITIES,
  onError: (context, error) => {
    console.error(`[gml] ${context}: ${error instanceof Error ? error.message : String(error)}`);
  },
});

type View = "library" | "setup" | "diagnostics";

function Panel() {
  const [config, setConfig] = useState<GmlConfig>(() => readConfig(node));
  const [view, setView] = useState<View>(() => (config.libraryRoot && node ? "library" : "setup"));

  const library = useMemo<FolderLibraryProvider | null>(() => {
    if (!node || !config.libraryRoot) return null;
    try {
      return openLibrary(node, config.libraryRoot);
    } catch (error) {
      console.error("[gml] could not open library", error);
      return null;
    }
  }, [config.libraryRoot]);

  const provider = useMemo(() => library ?? new MockLibraryProvider(), [library]);

  useEffect(() => {
    bridge.attachLibrary(library);
  }, [library]);

  const chooseLibrary = (root: string) => {
    const next = { ...config, libraryRoot: root };
    writeConfig(node, next);
    setConfig(next);
    setView("library");
  };

  return (
    <div className="gml-panelhost">
      <PanelRoot bridge={bridge} provider={provider} />

      {view === "setup" && (
        <LibrarySetupView
          node={node}
          current={config.libraryRoot}
          onChoose={chooseLibrary}
          onClose={library ? () => setView("library") : undefined}
        />
      )}
      {view === "diagnostics" && <DiagnosticsView onClose={() => setView("library")} />}

      {view === "library" && (
        <div className="gml-corner">
          <button type="button" className="gml-diagbtn" onClick={() => setView("setup")} title="Library folder">
            ⚙ Library
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
