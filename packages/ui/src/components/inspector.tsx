import { CATEGORY_LABELS, isAudioAsset, type AudioAsset, type MotionAsset } from "@gml/core";
import { useI18n } from "../i18n.js";
import { useHost } from "../host.js";
import { useLibrary } from "../library.js";
import { useSelection } from "../selection.js";
import { usePlayback } from "../media.js";
import { usePeaks } from "../peaks.js";
import { FavoriteToggle, StatusBadge, Waveform } from "./primitives.js";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="gml-field">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ApplyButton({ asset }: { asset: MotionAsset | AudioAsset }) {
  const { t } = useI18n();
  const host = useHost();
  const { markUsed } = useLibrary();
  const { applyNow, applying } = useSelection();

  // Audio is inserted as a layer rather than applied to a selection, so it
  // gets its own verb.
  const label = isAudioAsset(asset)
    ? t("add")
    : host.capabilities.primaryAction === "place"
      ? t("place")
      : t("apply");

  return (
    <button
      type="button"
      className="gml-primary"
      disabled={applying}
      data-testid="inspector-apply"
      onClick={() => {
        void applyNow(asset).then((r) => {
          if (r.ok) markUsed(asset.id);
        });
      }}
    >
      {label}
    </button>
  );
}

function MotionInspector({ asset }: { asset: MotionAsset }) {
  const { t, locale, nameOf, duration } = useI18n();
  const host = useHost();
  const { favorites, toggleFavorite, readinessOf } = useLibrary();

  return (
    <div className="gml-inspector__body" data-testid="motion-inspector">
      <div className="gml-inspector__preview">
        <video
          className="gml-inspector__video"
          src={host.resolveUrl(asset, asset.preview)}
          poster={host.resolveUrl(asset, asset.poster)}
          muted
          loop
          playsInline
          preload="none"
          autoPlay
          data-testid="inspector-video"
        />
      </div>

      <h2 className="gml-inspector__name">{nameOf(asset)}</h2>
      {asset.description && <p className="gml-inspector__desc">{asset.description}</p>}

      <dl className="gml-inspector__fields">
        <Field label={t("library")} value={CATEGORY_LABELS[asset.category][locale]} />
        {asset.tags.length > 0 && <Field label="Tags" value={asset.tags.join(" · ")} />}
        <Field label={t("duration")} value={duration(asset.duration)} />
        <Field label={t("resolution")} value={`${asset.width}×${asset.height} · ${asset.fps} fps`} />
        <Field label={t("version")} value={asset.version} />
        <Field label={t("lastUpdate")} value={asset.updatedAt.slice(0, 10)} />
      </dl>

      <StatusBadge readiness={readinessOf(asset)} />

      <div className="gml-inspector__actions">
        <ApplyButton asset={asset} />
        <FavoriteToggle
          active={favorites.has(asset.id)}
          onToggle={() => toggleFavorite(asset.id)}
          label={nameOf(asset)}
        />
      </div>
    </div>
  );
}

function AudioInspector({ asset }: { asset: AudioAsset }) {
  const { t, locale, nameOf, duration } = useI18n();
  const host = useHost();
  const playback = usePlayback();
  const { favorites, toggleFavorite } = useLibrary();
  const peaks = usePeaks(asset, (path) => host.resolveUrl(asset, path));

  const mediaId = `${asset.id}@${asset.version}`;
  const isPlaying = playback.isActive(mediaId);
  const progress =
    isPlaying && playback.audioDuration > 0 ? playback.audioProgress / playback.audioDuration : 0;

  return (
    <div className="gml-inspector__body" data-testid="audio-inspector">
      <div className="gml-inspector__audiorow">
        <button
          type="button"
          className="gml-play gml-play--lg"
          aria-label={isPlaying ? "Pause" : "Play"}
          data-testid="inspector-play"
          onClick={() =>
            isPlaying
              ? playback.stop(mediaId)
              : playback.play(mediaId, "audio", "inspector", host.resolveUrl(asset, asset.previewFile))
          }
        >
          {isPlaying ? "❚❚" : "▶"}
        </button>
        <Waveform peaks={peaks} progress={progress} height={32} />
      </div>

      <h2 className="gml-inspector__name">{nameOf(asset)}</h2>
      {asset.description && <p className="gml-inspector__desc">{asset.description}</p>}

      <dl className="gml-inspector__fields">
        <Field
          label={t("library")}
          value={[CATEGORY_LABELS.audio[locale], asset.kind, ...asset.tags].filter(Boolean).join(" · ")}
        />
        <Field label={t("duration")} value={duration(asset.duration)} />
        <Field
          label={t("resolution")}
          value={`${(asset.sampleRate / 1000).toFixed(1)}kHz · ${asset.channels === 2 ? "Stereo" : "Mono"}`}
        />
        <Field label={t("version")} value={asset.version} />
        <Field label={t("lastUpdate")} value={asset.updatedAt.slice(0, 10)} />
      </dl>

      <div className="gml-inspector__actions">
        <ApplyButton asset={asset} />
        <FavoriteToggle
          active={favorites.has(asset.id)}
          onToggle={() => toggleFavorite(asset.id)}
          label={nameOf(asset)}
        />
      </div>
    </div>
  );
}

/** Branches on assetType so an audio asset never renders motion metadata. */
export function Inspector() {
  const { selected } = useSelection();
  if (!selected) {
    return <aside className="gml-inspector gml-inspector--empty" data-testid="inspector" />;
  }
  return (
    <aside className="gml-inspector" data-testid="inspector">
      {isAudioAsset(selected) ? (
        <AudioInspector asset={selected} />
      ) : (
        <MotionInspector asset={selected} />
      )}
    </aside>
  );
}
