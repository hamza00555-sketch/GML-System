import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { MockLibraryProvider, listInbox, type FolderLibraryProvider } from "@gml/storage";
import { AE_CAPABILITIES, PanelRoot } from "@gml/ui";
import {
  AddAssetView,
  CepHostBridge,
  DiagnosticsView,
  InboxView,
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

type View = "library" | "setup" | "add" | "inbox" | "diagnostics";

function Panel() {
  const [config, setConfig] = useState<GmlConfig>(() => readConfig(node));
  const [view, setView] = useState<View>(() => (config.libraryRoot && node ? "library" : "setup"));
  const [reloadToken, setReloadToken] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [inboxCount, setInboxCount] = useState(0);

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

  // The inbox is filled from Drive on any machine, so it is re-counted while
  // the library view is up rather than only at launch.
  useEffect(() => {
    if (!node || !library || view !== "library") return;
    const count = () => {
      try {
        setInboxCount(listInbox(node.fs, library.root).length);
      } catch {
        setInboxCount(0);
      }
    };
    count();
    const timer = setInterval(count, 5000);
    return () => clearInterval(timer);
  }, [library, view, reloadToken]);

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
      {view === "inbox" && library && node && (
        <InboxView
          node={node}
          provider={library}
          author={config.author ?? "gml"}
          onClose={() => setView("library")}
          onImported={(count) => {
            setReloadToken((n) => n + 1);
            setNotice(`Imported ${count} asset(s) from _inbox`);
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
          {library && (
            <button type="button" className="gml-diagbtn" onClick={() => setView("inbox")} title="Import ready-made assets dropped into _inbox">
              ⤵ Inbox{inboxCount > 0 ? ` (${inboxCount})` : ""}
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
