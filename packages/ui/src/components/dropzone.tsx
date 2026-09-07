import { useEffect, useState } from "react";
import { assetKey, type LibraryAsset, type StringKey } from "@gml/core";
import { useI18n } from "../i18n.js";
import { useHost, type HostTarget } from "../host.js";
import { useLibrary } from "../library.js";
import { useSelection } from "../selection.js";
import { DRAG_MIME } from "./primitives.js";

/**
 * Dragging from a CEP panel onto an Adobe canvas or timeline is not supported —
 * `com.adobe.cep.dnd.file` works in Premiere only. So the drag ends here, on a
 * zone inside the panel, and the queue it builds is applied by script.
 */

function useTarget(): HostTarget {
  const host = useHost();
  const [target, setTarget] = useState<HostTarget>({ kind: "none", name: "" });

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      host
        .getTarget()
        .then((next) => {
          if (!cancelled) setTarget(next);
        })
        .catch(() => {
          // A host that cannot answer just leaves the last known target shown.
        });
    };
    poll();
    // The host gives us no selection-changed event, so a light poll keeps the
    // label honest while the panel is open.
    const timer = setInterval(poll, 1200);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [host]);

  return target;
}

function targetLabel(target: HostTarget, t: (key: StringKey) => string): string {
  switch (target.kind) {
    case "comp":
      return `${t("activeComp")}: ${target.name}`;
    case "layer":
      return `${t("selectedLayer")}: ${target.name}`;
    case "artboard":
      return `${t("activeArtboard")}: ${target.name}`;
    case "frame":
      return `${t("selectedFrame")}: ${target.name}`;
    default:
      return t("noTarget");
  }
}

export function DropZone({ compact = false }: { compact?: boolean }) {
  const { t, nameOf } = useI18n();
  const host = useHost();
  const { all, markUsed } = useLibrary();
  const { queue, enqueue, dequeue, clearQueue, applyNow, applying, applyProgress, lastResult } = useSelection();
  const target = useTarget();
  const [over, setOver] = useState(false);

  const primaryLabel = host.capabilities.primaryAction === "place" ? t("place") : t("apply");

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const payload = e.dataTransfer.getData(DRAG_MIME);
    if (!payload) return;
    const asset: LibraryAsset | undefined = all.find((a) => assetKey(a.id, a.version) === payload);
    if (asset) enqueue(asset);
  };

  return (
    <footer className="gml-dock" data-compact={compact || undefined} data-testid="dropzone">
      <p className="gml-dock__target" data-testid="dock-target" dir="auto">
        {targetLabel(target, t)}
      </p>

      {!compact && (
        <div
          className="gml-dock__zone"
          data-over={over || undefined}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <span className="gml-dock__hint">
            ⤓ {t("dropAssetsHere")}
            {queue.length > 0 && <strong className="gml-dock__count"> ({queue.length})</strong>}
          </span>
        </div>
      )}

      {queue.length > 0 && (
        <ol className="gml-queue" data-testid="queue">
          {queue.map((item) => (
            <li key={item.key} className="gml-queue__item">
              <span dir="auto">{nameOf(item.asset)}</span>
              <button type="button" aria-label={`Remove ${nameOf(item.asset)}`} onClick={() => dequeue(item.key)}>
                ×
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="gml-queue__clear" onClick={clearQueue}>
              {t("clearQueue")}
            </button>
          </li>
        </ol>
      )}

      {applyProgress && (
        <p className="gml-dock__progress" data-testid="apply-progress" dir="auto">
          {t("stateFetching")} {applyProgress.index + 1}/{applyProgress.count} · {nameOf(applyProgress.asset)}
        </p>
      )}
      {!applying && lastResult && !lastResult.ok && lastResult.message && (
        <p className="gml-dock__error" role="alert" data-testid="apply-error">
          {lastResult.message}
        </p>
      )}

      <button
        type="button"
        className="gml-primary gml-primary--wide"
        disabled={applying || queue.length === 0}
        data-testid="dock-apply"
        onClick={() => {
          const assets = queue.map((q) => q.asset);
          void applyNow().then((r) => {
            if (r.ok) assets.forEach((a) => markUsed(a.id));
          });
        }}
      >
        {primaryLabel}
        {queue.length > 0 ? ` (${queue.length})` : ""}
      </button>
    </footer>
  );
}
