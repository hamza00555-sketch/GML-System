import { useState } from "react";
import { isAudioAsset, type AudioAsset, type GmlAsset, type MotionAsset } from "@gml/core";
import { useI18n } from "../i18n.js";
import { useHost } from "../host.js";
import { useLibrary } from "../library.js";
import { useSelection } from "../selection.js";
import { usePlayback, useHoverIntent } from "../media.js";
import { usePeaks } from "../peaks.js";
import { DRAG_MIME, FavoriteToggle, StatusBadge, Waveform } from "./primitives.js";

export type CardDensity = "list" | "grid";

function useCardBehaviour(asset: GmlAsset) {
  const { favorites, toggleFavorite, markUsed, readinessOf } = useLibrary();
  const { selected, select, applyNow } = useSelection();

  return {
    isFavorite: favorites.has(asset.id),
    toggleFavorite: () => toggleFavorite(asset.id),
    readiness: readinessOf(asset),
    isSelected: selected?.id === asset.id,
    select: () => select(asset),
    /** Single click is the fast path: apply straight away, no queue. */
    quickApply: async () => {
      select(asset);
      const result = await applyNow(asset);
      if (result.ok) markUsed(asset.id);
    },
    dragProps: {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.setData(DRAG_MIME, `${asset.id}@${asset.version}`);
        e.dataTransfer.effectAllowed = "copy";
      },
    },
  };
}

export function MotionCard({ asset, density = "grid" }: { asset: MotionAsset; density?: CardDensity }) {
  const { nameOf, duration } = useI18n();
  const host = useHost();
  const playback = usePlayback();
  const behaviour = useCardBehaviour(asset);
  const [failed, setFailed] = useState(false);

  const mediaId = `${asset.id}@${asset.version}`;
  // Only the active card mounts a <video>; every other card shows its poster.
  // That is what keeps element count independent of how many cards are on screen.
  const isPlaying = playback.isActive(mediaId, "grid");

  const hover = useHoverIntent(
    () => playback.play(mediaId, "video", "grid"),
    () => playback.stop(mediaId),
  );

  const posterUrl = host.resolveUrl(asset, asset.poster);
  // preview.gif is the guaranteed fallback: it needs no codec at all.
  const videoUrl = host.resolveUrl(asset, failed ? asset.previewGif : asset.preview);

  return (
    <article
      className="gml-card gml-card--motion"
      data-density={density}
      data-selected={behaviour.isSelected || undefined}
      data-testid={`card-${asset.id}`}
      data-asset-type="motion"
      onClick={behaviour.select}
      onDoubleClick={() => void behaviour.quickApply()}
      {...behaviour.dragProps}
      {...hover}
    >
      <div className="gml-card__media">
        {isPlaying && !failed ? (
          <video
            className="gml-card__video"
            src={videoUrl}
            poster={posterUrl}
            muted
            loop
            playsInline
            preload="none"
            autoPlay
            data-testid="grid-video"
            onError={() => setFailed(true)}
          />
        ) : (
          <img className="gml-card__poster" src={posterUrl} alt="" loading="lazy" />
        )}
        <FavoriteToggle
          active={behaviour.isFavorite}
          onToggle={behaviour.toggleFavorite}
          label={nameOf(asset)}
        />
      </div>
      <div className="gml-card__meta">
        <span className="gml-card__name" title={nameOf(asset)}>
          {nameOf(asset)}
        </span>
        <span className="gml-card__row">
          <span className="gml-card__duration">{duration(asset.duration)}</span>
          <StatusBadge readiness={behaviour.readiness} />
        </span>
      </div>
    </article>
  );
}

export function AudioCard({ asset, density = "grid" }: { asset: AudioAsset; density?: CardDensity }) {
  const { nameOf, duration } = useI18n();
  const host = useHost();
  const playback = usePlayback();
  const behaviour = useCardBehaviour(asset);

  const mediaId = `${asset.id}@${asset.version}`;
  const peaks = usePeaks(asset, (path) => host.resolveUrl(asset, path));

  const isPlaying = playback.isActive(mediaId);
  const progress =
    isPlaying && playback.audioDuration > 0 ? playback.audioProgress / playback.audioDuration : 0;

  return (
    <article
      className="gml-card gml-card--audio"
      data-density={density}
      data-selected={behaviour.isSelected || undefined}
      data-testid={`card-${asset.id}`}
      data-asset-type="audio"
      onClick={behaviour.select}
      onDoubleClick={() => void behaviour.quickApply()}
      {...behaviour.dragProps}
    >
      <div className="gml-card__audiorow">
        <button
          type="button"
          className="gml-play"
          aria-label={isPlaying ? "Pause" : "Play"}
          data-testid={`play-${asset.id}`}
          onClick={(e) => {
            e.stopPropagation();
            // Starting this stops whatever was playing, video included.
            if (isPlaying) playback.stop(mediaId);
            else playback.play(mediaId, "audio", "grid", host.resolveUrl(asset, asset.previewFile));
          }}
        >
          {isPlaying ? "❚❚" : "▶"}
        </button>
        <span className="gml-card__name" title={nameOf(asset)}>
          {nameOf(asset)}
        </span>
        <FavoriteToggle
          active={behaviour.isFavorite}
          onToggle={behaviour.toggleFavorite}
          label={nameOf(asset)}
        />
      </div>
      <Waveform peaks={peaks} progress={progress} />
      <div className="gml-card__row">
        <span className="gml-card__duration">{duration(asset.duration)}</span>
        <span className="gml-card__tags">
          {[asset.kind, ...asset.tags].filter(Boolean).slice(0, 2).join(" · ")}
        </span>
      </div>
    </article>
  );
}

/** Branches on assetType — audio is never rendered as a motion card. */
export function AssetCard({ asset, density }: { asset: GmlAsset; density?: CardDensity }) {
  return isAudioAsset(asset) ? (
    <AudioCard asset={asset} density={density} />
  ) : (
    <MotionCard asset={asset} density={density} />
  );
}

export function AssetGrid({ assets }: { assets: readonly GmlAsset[] }) {
  const { t } = useI18n();
  if (assets.length === 0) return <p className="gml-empty">{t("emptyLibrary")}</p>;
  return (
    <div className="gml-grid" data-testid="asset-grid">
      {assets.map((asset) => (
        <AssetCard key={`${asset.id}@${asset.version}`} asset={asset} density="grid" />
      ))}
    </div>
  );
}

export function AssetList({ assets }: { assets: readonly GmlAsset[] }) {
  const { t } = useI18n();
  if (assets.length === 0) return <p className="gml-empty">{t("emptyLibrary")}</p>;
  return (
    <div className="gml-list" data-testid="asset-list">
      {assets.map((asset) => (
        <AssetCard key={`${asset.id}@${asset.version}`} asset={asset} density="list" />
      ))}
    </div>
  );
}
