import { useEffect, useRef, useState } from "react";
import { CATEGORY_LABELS, assetKey, deliverableLabel, fileNameOf, formatBytes, type LibraryAsset } from "@gml/core";
import { useFetch, useFetchState } from "../fetch.js";
import { useI18n } from "../i18n.js";
import { useHost } from "../host.js";
import { useLibrary } from "../library.js";
import { usePlayback } from "../media.js";
import { placeholderPoster } from "../placeholder.js";
import { useSelection } from "../selection.js";
import { FavoriteToggle, FetchBadge, StatusBadge, Tag } from "./primitives.js";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="gml-field">
      <dt>{label}</dt>
      <dd dir="auto">{value}</dd>
    </div>
  );
}

/** The one button. Ready → import now; cloud → fetch with progress → import. */
function ApplyButton({ asset }: { asset: LibraryAsset }) {
  const { t } = useI18n();
  const host = useHost();
  const { markUsed } = useLibrary();
  const { applyNow, applying, variantFor } = useSelection();
  const state = useFetchState(asset, variantFor(asset));
  const label = host.capabilities.primaryAction === "place" ? t("place") : t("apply");
  const busy = applying;

  return (
    <button
      type="button"
      className="gml-primary gml-primary--wide"
      disabled={busy}
      data-state={state.status}
      data-testid="inspector-apply"
      onClick={() => {
        void applyNow(asset).then((r) => {
          if (r.ok) markUsed(asset.id);
        });
      }}
    >
      {busy && state.status === "fetching" ? `${t("stateFetching")}…` : label}
    </button>
  );
}

function MoreMenu({ asset }: { asset: LibraryAsset }) {
  const { t } = useI18n();
  const host = useHost();
  const fetch = useFetch();
  const { variantFor } = useSelection();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const deliverable = variantFor(asset);

  if (!host.saveCopy && !host.revealSource) return null;
  return (
    <div className="gml-more">
      <button type="button" className="gml-iconbtn" aria-label={t("more")} aria-expanded={open} data-testid="more-menu" onClick={() => setOpen((o) => !o)}>
        ⋯
      </button>
      {open && (
        <ul className="gml-more__list" role="menu">
          {host.saveCopy && (
            <li>
              <button
                type="button"
                role="menuitem"
                data-testid="save-copy"
                onClick={async () => {
                  setOpen(false);
                  const localPath = await fetch.fetch(asset, deliverable);
                  const r = await host.saveCopy!({ asset, deliverable, localPath });
                  setNote(r.message ?? null);
                }}
              >
                {t("saveCopy")}
              </button>
            </li>
          )}
          {host.revealSource && asset.source && (
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  setOpen(false);
                  const r = await host.revealSource!(asset);
                  setNote(r.message ?? null);
                }}
              >
                {t("source")}: {fileNameOf(asset.source.relPath)}
              </button>
            </li>
          )}
        </ul>
      )}
      {note && <p className="gml-inspector__note">{note}</p>}
    </div>
  );
}

export function Inspector() {
  const { t } = useI18n();
  const { selected } = useSelection();
  if (!selected) {
    return (
      <aside className="gml-inspector gml-inspector--empty" data-testid="inspector">
        <p className="gml-inspector__hint">{t("selectAnAsset")}</p>
      </aside>
    );
  }
  return (
    <aside className="gml-inspector" data-testid="inspector">
      <InspectorBody key={assetKey(selected.id, selected.version)} asset={selected} />
    </aside>
  );
}

/** Rendered only with an asset, so every hook below runs unconditionally. */
function InspectorBody({ asset }: { asset: LibraryAsset }) {
  const { t, locale, nameOf, duration } = useI18n();
  const host = useHost();
  const playback = usePlayback();
  const { favorites, toggleFavorite, readinessOf, updateAvailable, projectVersions } = useLibrary();
  const { variantFor, chooseVariant } = useSelection();
  const mediaRef = useRef<HTMLDivElement | null>(null);
  const previewUrl = host.previewUrl(asset);
  const deliverable = variantFor(asset);
  const fetchState = useFetchState(asset, deliverable);
  const readiness = readinessOf(asset);
  const inProject = projectVersions.get(asset.id);
  const mediaId = assetKey(asset.id, asset.version);

  // The inspector takes the shared video while it is open; hovering a card
  // steals it briefly and it returns on leave.
  useEffect(() => {
    if (!previewUrl || !mediaRef.current) return;
    playback.play(mediaId, previewUrl, mediaRef.current, "inspector");
    return () => playback.stop(mediaId, "inspector");
  }, [mediaId, previewUrl]);

  useEffect(() => {
    if (!previewUrl || !mediaRef.current || playback.activeId !== null) return;
    playback.play(mediaId, previewUrl, mediaRef.current, "inspector");
  }, [playback.activeId]);

  return (
    <div className="gml-inspector__body" data-testid="asset-inspector">

        <div className="gml-inspector__preview" ref={mediaRef}>
          <img className="gml-inspector__poster" src={host.posterUrl(asset) ?? placeholderPoster(asset.id, asset.category)} alt="" draggable={false} />
        </div>

        <div className="gml-inspector__title">
          <h2 className="gml-inspector__name" dir="auto">{nameOf(asset)}</h2>
          <FavoriteToggle active={favorites.has(asset.id)} onToggle={() => toggleFavorite(asset.id)} label={nameOf(asset)} />
        </div>
        <p className="gml-inspector__kind">
          {CATEGORY_LABELS[asset.category][locale]} · {asset.kind === "comp" ? t("kindComp") : asset.kind === "still" ? t("kindStill") : t("kindVideoAlpha")}
          {asset.status === "draft" && <Tag tone="warn">{t("draft")}</Tag>}
          {updateAvailable(asset) && <Tag tone="accent" testId="update-tag">{t("updateAvailable")}</Tag>}
        </p>

        {asset.deliverables.length > 1 && (
          <label className="gml-inspector__variant">
            <span>{t("variant")}</span>
            <select value={deliverable.relPath} onChange={(e) => chooseVariant(asset, e.target.value)} data-testid="variant-select">
              {asset.deliverables.map((d) => (
                <option key={d.relPath} value={d.relPath}>
                  {deliverableLabel(d)} · {formatBytes(d.bytes)}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="gml-inspector__state">
          <FetchBadge state={fetchState} />
        </div>

        <dl className="gml-inspector__fields">
          <Field label={t("size")} value={formatBytes(deliverable.bytes)} />
          {deliverable.codec && (
            <Field
              label={t("codec")}
              value={`${deliverable.codec}${deliverable.width ? ` · ${deliverable.width}×${deliverable.height}` : ""}${deliverable.fps ? ` · ${deliverable.fps} fps` : ""}`}
            />
          )}
          {asset.comp && (
            <>
              <Field label={t("resolution")} value={`${asset.comp.width}×${asset.comp.height} · ${asset.comp.fps} fps`} />
              <Field label={t("duration")} value={duration(asset.comp.duration)} />
            </>
          )}
          <Field label={t("version")} value={`v${asset.version}${inProject ? ` · in project: v${[...new Set(inProject)].join(", v")}` : ""}`} />
          {asset.requires.fonts.length > 0 && <Field label="Fonts" value={asset.requires.fonts.join(", ")} />}
          {asset.source && <Field label={t("source")} value={fileNameOf(asset.source.relPath)} />}
          <Field label={t("lastUpdate")} value={asset.updatedAt.slice(0, 10)} />
        </dl>

        {deliverable.warnings.length > 0 && (
          <p className="gml-inspector__warn" data-testid="render-warnings">
            {deliverable.warnings.includes("oversized") && `${t("needsRerender")} — ${formatBytes(deliverable.bytes)} · `}
            {deliverable.warnings.includes("prores-xq") && "ProRes 4444 XQ · "}
            {deliverable.warnings.includes("4k") && "4K"}
          </p>
        )}

        {asset.kind === "comp" && <StatusBadge readiness={readiness} />}

        <div className="gml-inspector__actions">
          <ApplyButton asset={asset} />
          <MoreMenu asset={asset} />
        </div>
    </div>
  );
}
