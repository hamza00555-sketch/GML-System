import { useEffect, useRef, useState } from "react";
import type { ReadinessResult } from "@gml/core";
import { percent, type FetchState } from "../fetch.js";
import { useI18n } from "../i18n.js";

export const DRAG_MIME = "application/x-gml-asset";

export function SearchField({ value, onChange, compact = false }: { value: string; onChange: (next: string) => void; compact?: boolean }) {
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
        dir="auto"
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
    readiness.status === "safe" ? t("gmlSafe") : readiness.status === "requires-plugin" ? t("requiresPlugin") : t("requiresFont");
  const detail =
    readiness.status === "requires-plugin"
      ? readiness.missingPlugins.join(", ")
      : readiness.status === "requires-font"
        ? readiness.missingFonts.join(", ")
        : "";

  return (
    <span className="gml-status" data-status={readiness.status} title={detail || label} data-testid={`status-${readiness.status}`}>
      <span className="gml-status__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/** ☁ cloud · ⬇ fetching with a percentage · ✓ ready. */
export function FetchBadge({ state, compact = false }: { state: FetchState; compact?: boolean }) {
  const { t } = useI18n();
  const label =
    state.status === "ready"
      ? t("stateReady")
      : state.status === "fetching"
        ? `${t("stateFetching")} ${percent(state)}%`
        : state.status === "failed"
          ? t("stateFailed")
          : t("stateCloud");
  const icon = state.status === "ready" ? "✓" : state.status === "fetching" ? "⬇" : state.status === "failed" ? "!" : "☁";
  return (
    <span className="gml-fetch" data-status={state.status} title={state.error ?? label} data-testid={`fetch-${state.status}`}>
      <span className="gml-fetch__icon" aria-hidden="true">{icon}</span>
      {!compact && <span className="gml-fetch__label">{state.status === "fetching" ? `${percent(state)}%` : label}</span>}
      {state.status === "fetching" && (
        <span className="gml-fetch__bar" aria-hidden="true">
          <span className="gml-fetch__fill" style={{ inlineSize: `${percent(state)}%` }} />
        </span>
      )}
    </span>
  );
}

export function Tag({ tone = "neutral", children, testId }: { tone?: "neutral" | "warn" | "accent"; children: React.ReactNode; testId?: string }) {
  return (
    <span className="gml-tag" data-tone={tone} data-testid={testId}>
      {children}
    </span>
  );
}

export function FavoriteToggle({ active, onToggle, label }: { active: boolean; onToggle: () => void; label: string }) {
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

export function IconButton({ label, icon, onClick, active }: { label: string; icon: string; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" className="gml-iconbtn" title={label} aria-label={label} data-active={active || undefined} onClick={onClick}>
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}
