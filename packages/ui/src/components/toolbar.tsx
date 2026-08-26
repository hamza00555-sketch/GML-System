import { useState } from "react";
import { useI18n } from "../i18n.js";
import { useHost } from "../host.js";

/**
 * Host-specific tools. After Effects publishes back into the library;
 * Illustrator carries the storyboard tag tools. Everything else is shared.
 */
export function HostToolbar({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const host = useHost();
  const [tagsVisible, setTagsVisible] = useState(true);
  const [busy, setBusy] = useState(false);

  const run = async (fn?: () => Promise<unknown>) => {
    if (!fn) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  if (host.capabilities.hasTagTools) {
    return (
      <div className="gml-toolbar" data-compact={compact || undefined} data-testid="ai-toolbar">
        <button
          type="button"
          className="gml-toolbar__btn"
          disabled={busy}
          data-testid="toggle-tags"
          onClick={() =>
            void run(async () => {
              const next = !tagsVisible;
              // One layer toggle, so approval prints stay clean in a single step.
              const result = await host.setTagsVisible?.(next);
              if (result?.ok !== false) setTagsVisible(next);
            })
          }
        >
          👁 {tagsVisible ? t("hideTags") : t("showTags")}
        </button>
        <button
          type="button"
          className="gml-toolbar__btn"
          disabled={busy}
          data-testid="resync-tags"
          onClick={() => void run(() => host.resyncTags?.() ?? Promise.resolve())}
        >
          ⟳ {t("resyncTags")}
        </button>
        <button
          type="button"
          className="gml-toolbar__btn"
          disabled={busy}
          data-testid="export-storyboard"
          onClick={() => void run(() => host.exportStoryboard?.() ?? Promise.resolve())}
        >
          ⤴ {t("exportStoryboard")}
        </button>
      </div>
    );
  }

  if (host.capabilities.canPublish) {
    return (
      <div className="gml-toolbar" data-compact={compact || undefined} data-testid="ae-toolbar">
        <button
          type="button"
          className="gml-toolbar__btn"
          disabled={busy}
          data-testid="publish-comp"
          onClick={() => void run(() => host.publishComp?.() ?? Promise.resolve())}
        >
          ⬆ {t("publishToLibrary")}
        </button>
      </div>
    );
  }

  return null;
}
