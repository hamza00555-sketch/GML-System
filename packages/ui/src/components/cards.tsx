import { useRef } from "react";
import { assetKey, type LibraryAsset } from "@gml/core";
import { useFetchState } from "../fetch.js";
import { useI18n } from "../i18n.js";
import { useHost } from "../host.js";
import { useLibrary } from "../library.js";
import { useHoverIntent, usePlayback } from "../media.js";
import { placeholderPoster } from "../placeholder.js";
import { useSelection } from "../selection.js";
import { DRAG_MIME, FavoriteToggle, FetchBadge, StatusBadge, Tag } from "./primitives.js";

export type CardDensity = "list" | "grid";

/**
 * A card is an image. The single shared <video> is portalled into the card's
 * media box only while it is hovered — every other card stays a poster.
 */
export function AssetCard({ asset, density = "grid" }: { asset: LibraryAsset; density?: CardDensity }) {
  const { t, nameOf } = useI18n();
  const host = useHost();
  const playback = usePlayback();
  const { favorites, toggleFavorite, markUsed, readinessOf, updateAvailable } = useLibrary();
  const { selected, select, applyNow, variantFor } = useSelection();
  const deliverable = variantFor(asset);
  const fetchState = useFetchState(asset, deliverable);
  const mediaRef = useRef<HTMLDivElement | null>(null);

  const mediaId = assetKey(asset.id, asset.version);
  const previewUrl = host.previewUrl(asset);
  const posterUrl = host.posterUrl(asset) ?? placeholderPoster(asset.id, asset.category);
  const isPlaying = playback.isActive(mediaId, "grid");
  const readiness = readinessOf(asset);
  const oversized = asset.deliverables.some((d) => d.warnings.includes("oversized"));

  const hover = useHoverIntent(
    () => {
      if (previewUrl && mediaRef.current) playback.play(mediaId, previewUrl, mediaRef.current, "grid");
    },
    () => playback.stop(mediaId, "grid"),
  );

  return (
    <article
      className="gml-card"
      data-density={density}
      data-kind={asset.kind}
      data-selected={selected?.id === asset.id || undefined}
      data-playing={isPlaying || undefined}
      data-testid={`card-${asset.id}`}
      onClick={() => select(asset)}
      onDoubleClick={() => {
        select(asset);
        void applyNow(asset).then((r) => {
          if (r.ok) markUsed(asset.id);
        });
      }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, mediaId);
        e.dataTransfer.effectAllowed = "copy";
      }}
      {...hover}
    >
      <div className="gml-card__media" ref={mediaRef}>
        <img className="gml-card__poster" src={posterUrl} alt="" loading="lazy" draggable={false} />
        {density === "grid" && (
          <span className="gml-card__state">
            <FetchBadge state={fetchState} compact />
          </span>
        )}
        <FavoriteToggle active={favorites.has(asset.id)} onToggle={() => toggleFavorite(asset.id)} label={nameOf(asset)} />
      </div>
      <div className="gml-card__meta">
        <span className="gml-card__name" title={nameOf(asset)} dir="auto">
          {nameOf(asset)}
        </span>
        {/* One wrapping row for everything secondary, so labels never collide. */}
        <span className="gml-card__tags">
          {density === "list" && <FetchBadge state={fetchState} compact />}
          {asset.kind === "comp" && <Tag>{t("kindComp")}</Tag>}
          {asset.status === "draft" && <Tag tone="warn" testId="draft-tag">{t("draft")}</Tag>}
          {oversized && <Tag tone="warn" testId="rerender-tag">{t("needsRerender")}</Tag>}
          {updateAvailable(asset) && <Tag tone="accent" testId="update-tag">{t("updateAvailable")}</Tag>}
          {asset.kind === "comp" && readiness.status !== "safe" && <StatusBadge readiness={readiness} />}
        </span>
      </div>
    </article>
  );
}

/** An empty library and an empty search look different: only one is fixable by typing less. */
function EmptyState() {
  const { t } = useI18n();
  const { all } = useLibrary();
  return (
    <p className="gml-empty" data-testid="empty-state">
      {all.length === 0 ? t("noLibraryYet") : t("emptyLibrary")}
    </p>
  );
}

export function AssetGrid({ assets }: { assets: readonly LibraryAsset[] }) {
  if (assets.length === 0) return <EmptyState />;
  return (
    <div className="gml-grid" data-testid="asset-grid">
      {assets.map((asset) => (
        <AssetCard key={assetKey(asset.id, asset.version)} asset={asset} density="grid" />
      ))}
    </div>
  );
}

export function AssetList({ assets }: { assets: readonly LibraryAsset[] }) {
  if (assets.length === 0) return <EmptyState />;
  return (
    <div className="gml-list" data-testid="asset-list">
      {assets.map((asset) => (
        <AssetCard key={assetKey(asset.id, asset.version)} asset={asset} density="list" />
      ))}
    </div>
  );
}
