import { useMemo, useState } from "react";
import { largeIndex } from "@gml/core";
import { FakeFetchService, PanelRoot, fakeSource, type PanelTheme } from "@gml/ui";
import { BrowserHostBridge, type HarnessLogEntry, type HostChoice } from "./browserHost.js";

/**
 * Frames the panel in a resizable column so the real ResizeObserver drives the
 * mode, exactly as it will when a designer drags the panel edge inside Adobe.
 * Fetches are simulated with a timer so the ☁ → ⬇ → ✓ sequence is visible.
 */

const PRESETS: { label: string; width: number; note: string }[] = [
  { label: "Compact", width: 240, note: "< 280px" },
  { label: "Standard", width: 420, note: "280–650px" },
  { label: "Explorer", width: 900, note: "> 650px" },
];

/** Drives the manual fake with a timer so progress is visible while designing. */
class TimedFetchService extends FakeFetchService {
  constructor() {
    super("manual");
  }
  override fetch(asset: Parameters<FakeFetchService["fetch"]>[0], deliverable: Parameters<FakeFetchService["fetch"]>[1]) {
    const key = this.key(asset, deliverable);
    const promise = super.fetch(asset, deliverable);
    if (this.state(asset, deliverable).status === "fetching") {
      let done = 0;
      const step = Math.max(1, deliverable.bytes / 20);
      const timer = setInterval(() => {
        done += step;
        if (done >= deliverable.bytes) {
          clearInterval(timer);
          this.complete(key);
        } else {
          this.advance(key, done);
        }
      }, 120);
    }
    return promise;
  }
}

export function HarnessApp() {
  const [host, setHost] = useState<HostChoice>("ae");
  const [theme, setTheme] = useState<PanelTheme>("dark");
  const [width, setWidth] = useState(900);
  const [log, setLog] = useState<HarnessLogEntry[]>([]);

  const source = useMemo(() => fakeSource(largeIndex(48)), []);
  const fetch = useMemo(() => new TimedFetchService(), []);
  const bridge = useMemo(() => new BrowserHostBridge(host, (entry) => setLog((l) => [entry, ...l].slice(0, 40))), [host]);

  return (
    <div className="harness" data-theme={theme}>
      <aside className="harness__controls">
        <h1 className="harness__title">GML Panel Harness</h1>
        <p className="harness__blurb">The panel below runs against a fixture index and a fake host bridge — no Adobe application involved.</p>

        <label className="harness__label">Host</label>
        <div className="harness__row">
          {(["ae", "ai"] as HostChoice[]).map((choice) => (
            <button key={choice} type="button" className="harness__btn" data-active={host === choice || undefined} onClick={() => setHost(choice)}>
              {choice === "ae" ? "After Effects" : "Illustrator"}
            </button>
          ))}
        </div>

        <label className="harness__label">Host theme</label>
        <div className="harness__row">
          {(["dark", "light"] as PanelTheme[]).map((choice) => (
            <button key={choice} type="button" className="harness__btn" data-active={theme === choice || undefined} onClick={() => setTheme(choice)}>
              {choice}
            </button>
          ))}
        </div>

        <label className="harness__label" htmlFor="width">
          Panel width — {width}px
        </label>
        <input id="width" className="harness__range" type="range" min={180} max={1100} value={width} onChange={(e) => setWidth(Number(e.target.value))} />
        <div className="harness__row">
          {PRESETS.map((preset) => (
            <button key={preset.label} type="button" className="harness__btn" title={preset.note} onClick={() => setWidth(preset.width)}>
              {preset.label}
            </button>
          ))}
        </div>

        <label className="harness__label">Host calls</label>
        <ol className="harness__log">
          {log.length === 0 && <li className="harness__logempty">Nothing yet.</li>}
          {log.map((entry, i) => (
            <li key={i}>
              <code>{entry.call}</code>
              {entry.detail && <span> {entry.detail}</span>}
              <em>{entry.at}</em>
            </li>
          ))}
        </ol>
      </aside>

      <div className="harness__stage">
        <div className="harness__panel" style={{ width }}>
          {/* Remounted per host so capabilities reset. */}
          <PanelRoot key={host} bridge={bridge} source={source} fetch={fetch} theme={theme} initialWidth={width} />
        </div>
      </div>
    </div>
  );
}
