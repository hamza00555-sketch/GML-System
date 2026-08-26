import { useCallback, useEffect, useState } from "react";
import { collectDiagnostics, formatReport, type Check, type DiagnosticsReport, type Verdict } from "./diagnostics.js";
import { probeNode, probePlayback } from "./probes.js";

/**
 * The M0.5 verification surface.
 *
 * Layout state is read from the attributes PanelRoot already writes onto its
 * root element, so this observes the live panel rather than starting a second
 * ResizeObserver that could disagree with it.
 */
function readLayout() {
  const root = typeof document !== "undefined" ? document.querySelector<HTMLElement>(".gml-panel") : null;
  return {
    mode: root?.dataset.mode ?? "unknown",
    width: Number(root?.dataset.hostWidth ?? 0),
    locale: root?.getAttribute("lang") ?? "unknown",
    dir: root?.getAttribute("dir") ?? "unknown",
  };
}

const COLOR: Record<Verdict, string> = {
  pass: "var(--accent)",
  fail: "var(--danger)",
  warn: "var(--warn)",
  unknown: "var(--text-3)",
};

export function DiagnosticsView({ onClose }: { onClose: () => void }) {
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [deep, setDeep] = useState<Check[]>([]);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setCopied(false);
    try {
      setReport(await collectDiagnostics(readLayout()));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  /**
   * Spikes C and E, on demand: these open a socket, touch disk and decode
   * media, so they do not run merely because the screen is visible.
   */
  const runDeep = useCallback(async () => {
    setBusy(true);
    setCopied(false);
    try {
      const node = await probeNode();
      // The VP8 control clip needs no proprietary codec. If it plays and MP4
      // does not, the problem is the codec, not <video> inside CEP.
      const control = await probePlayback("./selftest/control-vp8.webm", "WebM VP8 control clip");
      setDeep([
        ...node,
        {
          id: "playback-vp8",
          label: control.label,
          verdict: control.verdict,
          detail: control.detail,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }, []);

  const copy = async () => {
    if (!report) return;
    const extra =
      deep.length > 0
        ? "\n\nDeep probes (Node, playback):\n" +
          deep.map((c) => `[${c.verdict.toUpperCase()}] ${c.label}\n        ${c.detail}`).join("\n")
        : "";
    const text = formatReport(report) + extra;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard access can be denied inside CEP; the textarea below is the
      // fallback and is always selectable.
      setCopied(false);
    }
  };

  const failures = report?.checks.filter((c) => c.verdict === "fail").length ?? 0;

  return (
    <div className="gml-diag" data-testid="diagnostics">
      <header className="gml-diag__head">
        <strong>Diagnostics</strong>
        <span className="gml-diag__summary">
          {report ? (failures === 0 ? "All required checks pass" : `${failures} failing`) : "…"}
        </span>
        <button type="button" className="gml-toolbar__btn" onClick={() => void run()} disabled={busy}>
          Re-run
        </button>
        <button type="button" className="gml-toolbar__btn" onClick={() => void runDeep()} disabled={busy}>
          Node + playback
        </button>
        <button type="button" className="gml-toolbar__btn" onClick={() => void copy()} disabled={!report}>
          {copied ? "Copied" : "Copy report"}
        </button>
        <button type="button" className="gml-toolbar__btn" onClick={onClose}>
          Close
        </button>
      </header>

      <div className="gml-diag__body">
        {report?.checks.map((check) => (
          <div key={check.id} className="gml-diag__row">
            <span className="gml-diag__verdict" style={{ color: COLOR[check.verdict] }}>
              {check.verdict.toUpperCase()}
            </span>
            <div>
              <div className="gml-diag__label">{check.label}</div>
              <div className="gml-diag__detail">{check.detail}</div>
            </div>
          </div>
        ))}

        {deep.length > 0 && (
          <>
            <h3 className="gml-diag__h3">Node and playback</h3>
            {deep.map((check) => (
              <div key={check.id} className="gml-diag__row">
                <span className="gml-diag__verdict" style={{ color: COLOR[check.verdict] }}>
                  {check.verdict.toUpperCase()}
                </span>
                <div>
                  <div className="gml-diag__label">{check.label}</div>
                  <div className="gml-diag__detail">{check.detail}</div>
                </div>
              </div>
            ))}
          </>
        )}

        {report && (
          <>
            <h3 className="gml-diag__h3">Codec support</h3>
            <table className="gml-diag__table">
              <tbody>
                {report.codecs.map((codec) => (
                  <tr key={codec.id}>
                    <td>{codec.required ? "★" : ""}</td>
                    <td>{codec.label}</td>
                    <td style={{ color: codec.support === "" ? "var(--danger)" : "var(--accent)" }}>
                      {codec.support === "" ? "no" : codec.support}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 className="gml-diag__h3">Report</h3>
            <textarea
              className="gml-diag__text"
              readOnly
              value={
                formatReport(report) +
                (deep.length > 0
                  ? "\n\nDeep probes (Node, playback):\n" +
                    deep
                      .map((c) => `[${c.verdict.toUpperCase()}] ${c.label}\n        ${c.detail}`)
                      .join("\n")
                  : "")
              }
              onFocus={(e) => e.currentTarget.select()}
            />
          </>
        )}
      </div>
    </div>
  );
}
