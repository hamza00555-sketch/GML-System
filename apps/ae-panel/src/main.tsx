import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { MockLibraryProvider, type FolderLibraryProvider } from "@gml/storage";
import { AE_CAPABILITIES, PanelRoot } from "@gml/ui";
import {
  AddAssetView,
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
 * After Effects panel.
 *
 * The library is a folder — the team's Shared Drive as mirrored by Google
 * Drive for Desktop. Until one is chosen the setup screen shows; after that the
 * panel browses it, applies from it, and publishes into it.
 */
const node = panelNode();

const bridge = new CepHostBridge({
  capabilities: AE_CAPABILITIES,
  onError: (context, error) => {
    console.error(`[gml] ${context}: ${error instanceof Error ? error.message : String(error)}`);
  },
});

type View = "library" | "setup" | "add" | "diagnostics";

function Panel() {
  const [config, setConfig] = useState<GmlConfig>(() => readConfig(node));
  const [view, setView] = useState<View>(() => (config.libraryRoot && node ? "library" : "setup"));
  const [reloadToken, setReloadToken] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const library = useMemo<FolderLibraryProvider | null>(() => {
    if (!node || !config.libraryRoot) return null;
    try {
      return openLibrary(node, config.libraryRoot);
    } catch (error) {
      console.error("[gml] could not open library", error);
      return null;
    }
  }, [config.libraryRoot]);

  // No library yet: an empty mock keeps the shell rendering behind the setup screen.
  const provider = useMemo(() => library ?? new MockLibraryProvider(), [library]);

  useEffect(() => {
    bridge.attachLibrary(library);
    bridge.onPublishRequest = () => setView(library ? "add" : "setup");
  }, [library]);

  const chooseLibrary = (root: string) => {
    const next = { ...config, libraryRoot: root };
    writeConfig(node, next);
    setConfig(next);
    setView("library");
  };

  return (
    <div className="gml-panelhost">
      <PanelRoot bridge={bridge} provider={provider} reloadToken={reloadToken} />

      {view === "setup" && (
        <LibrarySetupView
          node={node}
          current={config.libraryRoot}
          onChoose={chooseLibrary}
          onClose={library ? () => setView("library") : undefined}
        />
      )}
      {view === "add" && library && (
        <AddAssetView
          provider={library}
          author={config.author ?? "gml"}
          onClose={() => setView("library")}
          onDone={(asset) => {
            setReloadToken((n) => n + 1);
            setNotice(`Published ${asset.id}@${asset.version} (${asset.status})`);
            setView("library");
          }}
        />
      )}
      {view === "diagnostics" && <DiagnosticsView onClose={() => setView("library")} />}

      {view === "library" && (
        <div className="gml-corner">
          {notice && (
            <button type="button" className="gml-diagbtn" onClick={() => setNotice(null)} title="dismiss">
              ✓ {notice}
            </button>
          )}
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
