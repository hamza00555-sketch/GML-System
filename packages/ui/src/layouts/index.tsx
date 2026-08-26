import { useI18n } from "../i18n.js";
import { useLibrary } from "../library.js";
import { CategoryNav } from "../components/nav.js";
import { AssetGrid, AssetList } from "../components/cards.js";
import { Inspector } from "../components/inspector.js";
import { DropZone } from "../components/dropzone.js";
import { HostToolbar } from "../components/toolbar.js";
import { SearchField } from "../components/primitives.js";
import type { WorkspaceMode } from "../useWorkspaceMode.js";

/**
 * Three layouts written separately, not one design squeezed down. Information
 * is added as room appears rather than the same elements being scaled:
 *
 *   compact   name + thumbnail + duration
 *   standard  preview + name + status
 *   explorer  full preview + metadata + dependencies + actions
 */

function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();
  return (
    <button
      type="button"
      className="gml-iconbtn"
      title={t("language")}
      aria-label={t("language")}
      data-testid="language-toggle"
      onClick={() => setLocale(locale === "en" ? "ar" : "en")}
    >
      {locale === "en" ? "ع" : "EN"}
    </button>
  );
}

export function CompactLayout() {
  const { visible, query, setQuery } = useLibrary();
  return (
    <div className="gml-layout gml-layout--compact" data-testid="layout-compact">
      <header className="gml-header gml-header--compact">
        <span className="gml-wordmark">GML</span>
        <SearchField value={query} onChange={setQuery} compact />
        <LanguageToggle />
      </header>
      <div className="gml-subbar">
        <CategoryNav variant="sheet" />
      </div>
      <main className="gml-body">
        <AssetList assets={visible} />
      </main>
      <DropZone compact />
    </div>
  );
}

export function StandardLayout() {
  const { visible, query, setQuery } = useLibrary();
  return (
    <div className="gml-layout gml-layout--standard" data-testid="layout-standard">
      <header className="gml-header">
        <span className="gml-wordmark">GML</span>
        <SearchField value={query} onChange={setQuery} />
        <LanguageToggle />
      </header>
      <div className="gml-subbar">
        <CategoryNav variant="chips" />
      </div>
      <HostToolbar compact />
      <main className="gml-body">
        <AssetGrid assets={visible} />
      </main>
      <DropZone />
    </div>
  );
}

export function ExplorerLayout() {
  const { visible, query, setQuery } = useLibrary();
  return (
    <div className="gml-layout gml-layout--explorer" data-testid="layout-explorer">
      <header className="gml-header">
        <span className="gml-wordmark">GML</span>
        <SearchField value={query} onChange={setQuery} />
        <LanguageToggle />
      </header>
      <div className="gml-explorer">
        <CategoryNav variant="sidebar" />
        <main className="gml-body gml-body--explorer">
          <HostToolbar />
          <AssetGrid assets={visible} />
        </main>
        <Inspector />
      </div>
      <DropZone />
    </div>
  );
}

/** Mounts a different component per mode — never one layout with squeezed CSS. */
export function WorkspaceSwitch({ mode }: { mode: WorkspaceMode }) {
  if (mode === "compact") return <CompactLayout />;
  if (mode === "standard") return <StandardLayout />;
  return <ExplorerLayout />;
}
