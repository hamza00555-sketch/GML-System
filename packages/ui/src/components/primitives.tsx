import { useEffect, useRef, useState } from "react";
import type { ReadinessResult } from "@gml/core";
import { useI18n } from "../i18n.js";

export const DRAG_MIME = "application/x-gml-asset";

export function SearchField({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (next: string) => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setDraft(value), [value]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <div className="gml-search" data-compact={compact || undefined}>
      <span className="gml-search__icon" aria-hidden="true">⌕</span>
      <input
        type="search"
        className="gml-search__input"
        value={draft}
        placeholder={t("search")}
        aria-label={t("search")}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => onChange(next), 120);
        }}
      />
    </div>
  );
}

export function StatusBadge({ readiness }: { readiness: ReadinessResult }) {
  const { t } = useI18n();
  const label =
    readiness.status === "safe"
      ? t("gmlSafe")
      : readiness.status === "requires-plugin"
        ? t("requiresPlugin")
        : t("requiresFont");

  const detail =
    readiness.status === "requires-plugin"
      ? readiness.missingPlugins.join(", ")
      : readiness.status === "requires-font"
        ? readiness.missingFonts.join(", ")
        : "";

  return (
    <span
      className="gml-status"
      data-status={readiness.status}
      title={detail || label}
      data-testid={`status-${readiness.status}`}
    >
      <span className="gml-status__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function FavoriteToggle({
  active,
  onToggle,
  label,
}: {
  active: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className="gml-fav"
      data-active={active || undefined}
      aria-pressed={active}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {active ? "★" : "☆"}
    </button>
  );
}

/**
 * Peaks are computed at publish time and shipped as peaks.json — the panel
 * never decodes audio to draw this. Without peaks it degrades to a plain
 * progress bar rather than doing analysis work at runtime.
 */
export function Waveform({
  peaks,
  progress = 0,
  height = 20,
}: {
  peaks?: readonly number[];
  progress?: number;
  height?: number;
}) {
  if (!peaks || peaks.length === 0) {
    return (
      <div className="gml-wave gml-wave--plain" style={{ height }} data-testid="waveform-plain">
        <div className="gml-wave__fill" style={{ inlineSize: `${progress * 100}%` }} />
      </div>
    );
  }

  const played = Math.round(peaks.length * progress);
  return (
    <div className="gml-wave" style={{ height }} data-testid="waveform-peaks">
      {peaks.map((peak, i) => (
        <span
          key={i}
          className="gml-wave__bar"
          data-played={i < played || undefined}
          style={{ blockSize: `${Math.max(6, Math.min(100, peak * 100))}%` }}
        />
      ))}
    </div>
  );
}

export function IconButton({
  label,
  icon,
  onClick,
  active,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className="gml-iconbtn"
      title={label}
      aria-label={label}
      data-active={active || undefined}
      onClick={onClick}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}
