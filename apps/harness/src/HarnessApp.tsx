import { useMemo, useState } from "react";
import { sampleLibrary } from "@gml/core";
import { MockLibraryProvider } from "@gml/storage";
import { PanelRoot } from "@gml/ui";
import { BrowserHostBridge, type HarnessLogEntry, type HostChoice } from "./browserHost.js";

/**
 * Frames the panel in a resizable column so the real ResizeObserver drives the
 * mode, exactly as it will when a designer drags the panel edge inside Adobe.
 */

const PRESETS: { label: string; width: number; note: string }[] = [
  { label: "Compact", width: 240, note: "< 280px" },
  { label: "Standard", width: 420, note: "280–650px" },
  { label: "Explorer", width: 900, note: "> 650px" },
];

export function HarnessApp() {
  const [host, setHost] = useState<HostChoice>("ae");
  const [width, setWidth] = useState(900);
  const [log, setLog] = useState<HarnessLogEntry[]>([]);

  const assets = useMemo(() => sampleLibrary(), []);
  const provider = useMemo(() => new MockLibraryProvider({ seed: assets }), [assets]);
  const bridge = useMemo(
    () => new BrowserHostBridge(host, assets, (entry) => setLog((l) => [entry, ...l].slice(0, 40))),
    [host, assets],
  );

  return (
    <div className="harness">
      <aside className="harness__controls">
        <h1 className="harness__title">GML Panel Harness</h1>
        <p className="harness__blurb">
          The panel below runs against a mock library and a fake host bridge — no
          Adobe application involved.
        </p>

        <label className="harness__label">Host</label>
        <div className="harness__row">
          {(["ae", "ai"] as HostChoice[]).map((choice) => (
            <button
              key={choice}
              type="button"
              className="harness__btn"
              data-active={host === choice || undefined}
              onClick={() => setHost(choice)}
            >
              {choice === "ae" ? "After Effects" : "Illustrator"}
            </button>
          ))}
        </div>

        <label className="harness__label" htmlFor="width">
          Panel width — {width}px
        </label>
        <input
          id="width"
          className="harness__range"
          type="range"
          min={180}
          max={1100}
          value={width}
          onChange={(e) => setWidth(Number(e.target.value))}
        />
        <div className="harness__row">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="harness__btn"
              title={preset.note}
              onClick={() => setWidth(preset.width)}
            >
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
          {/* Remounted per host so capabilities and hidden categories reset. */}
          <PanelRoot key={host} bridge={bridge} provider={provider} initialWidth={width} />
        </div>
      </div>
    </div>
  );
}
