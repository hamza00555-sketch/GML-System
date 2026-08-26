import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { sampleLibrary } from "@gml/core";
import { MockLibraryProvider } from "@gml/storage";
import { AE_CAPABILITIES, PanelRoot } from "@gml/ui";
import { CepHostBridge, DiagnosticsView } from "@gml/cep";
import "@gml/ui/tokens.css";
import "@gml/ui/panel.css";

/**
 * M0.5 panel shell.
 *
 * The library is still the mock seed — the Drive provider arrives in M1. What
 * is real here is the host bridge: target, environment and the tag tools all
 * go through ExtendScript, which is what the verification pass needs to prove.
 */
const assets = sampleLibrary();
const provider = new MockLibraryProvider({ seed: assets });

const errors: string[] = [];
const bridge = new CepHostBridge({
  capabilities: AE_CAPABILITIES,
  assets,
  onError: (context, error) => {
    const message = `[gml] ${context}: ${error instanceof Error ? error.message : String(error)}`;
    errors.push(message);
    console.error(message);
  },
});

function Panel() {
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  return (
    <div className="gml-panelhost">
      <PanelRoot bridge={bridge} provider={provider} />
      {showDiagnostics ? (
        <DiagnosticsView onClose={() => setShowDiagnostics(false)} />
      ) : (
        <button type="button" className="gml-diagbtn" onClick={() => setShowDiagnostics(true)}>
          Diagnostics
        </button>
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
