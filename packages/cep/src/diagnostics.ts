import { cepAvailable, cepNodeRequire, extensionId, hostEnvironment, systemPath } from "./csinterface.js";
import { callHost } from "./csinterface.js";

/**
 * Everything the M0.5 verification checklist needs to answer, collected in one
 * place so the result can be copied out of the panel and read back.
 */

export type Verdict = "pass" | "fail" | "warn" | "unknown";

export interface Check {
  id: string;
  label: string;
  verdict: Verdict;
  detail: string;
}

/**
 * canPlayType settles Spike E on its own: it reports whether this CEF build was
 * compiled with the proprietary codecs at all, with no media file involved.
 * A real clip only confirms what this already says.
 */
const CODECS: { id: string; label: string; kind: "video" | "audio"; type: string; required: boolean }[] = [
  { id: "h264-aac", label: "MP4 · H.264 + AAC", kind: "video", type: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"', required: true },
  { id: "h264", label: "MP4 · H.264 video only", kind: "video", type: 'video/mp4; codecs="avc1.42E01E"', required: true },
  { id: "vp8", label: "WebM · VP8", kind: "video", type: 'video/webm; codecs="vp8"', required: false },
  { id: "vp9", label: "WebM · VP9", kind: "video", type: 'video/webm; codecs="vp9"', required: false },
  { id: "mp3", label: "MP3", kind: "audio", type: "audio/mpeg", required: true },
  { id: "aac", label: "AAC in MP4", kind: "audio", type: 'audio/mp4; codecs="mp4a.40.2"', required: false },
  { id: "wav", label: "WAV", kind: "audio", type: "audio/wav", required: false },
];

export interface CodecResult {
  id: string;
  label: string;
  kind: "video" | "audio";
  type: string;
  required: boolean;
  /** "probably" | "maybe" | "" — an empty string means the codec is absent. */
  support: string;
}

export function probeCodecs(): CodecResult[] {
  if (typeof document === "undefined") return [];
  const video = document.createElement("video");
  const audio = document.createElement("audio");

  return CODECS.map((codec) => ({
    ...codec,
    support: (codec.kind === "video" ? video : audio).canPlayType(codec.type),
  }));
}

export interface DiagnosticsReport {
  generatedAt: string;
  checks: Check[];
  codecs: CodecResult[];
  raw: Record<string, unknown>;
}

function verdictOf(condition: boolean, whenFalse: Verdict = "fail"): Verdict {
  return condition ? "pass" : whenFalse;
}

export async function collectDiagnostics(options: {
  mode: string;
  width: number;
  locale: string;
  dir: string;
}): Promise<DiagnosticsReport> {
  const checks: Check[] = [];
  const raw: Record<string, unknown> = {};

  // --- host ---
  const inCep = cepAvailable();
  const env = hostEnvironment();
  raw.hostEnvironment = env;
  raw.extensionId = extensionId();
  raw.extensionPath = systemPath("extension");

  checks.push({
    id: "cep",
    label: "Running inside a CEP host",
    verdict: verdictOf(inCep),
    detail: inCep ? `${env?.appName ?? "?"} ${env?.appVersion ?? ""} · locale ${env?.appLocale ?? "?"}` : "window.__adobe_cep__ is absent",
  });

  // --- Node (Spike C prerequisite) ---
  const nodeRequire = cepNodeRequire();
  let nodeDetail = "cep_node is not exposed — check --enable-nodejs in manifest.xml";
  let nodeOk = false;
  if (nodeRequire) {
    try {
      const os = nodeRequire("os") as { platform(): string; release(): string };
      nodeDetail = `require() works · ${os.platform()} ${os.release()}`;
      nodeOk = true;
    } catch (error) {
      nodeDetail = `require() present but failed: ${String(error)}`;
    }
  }
  checks.push({ id: "node", label: "Node.js available in the panel", verdict: verdictOf(nodeOk), detail: nodeDetail });
  raw.node = { available: nodeOk, detail: nodeDetail };

  // --- ExtendScript round trip ---
  let hostInfo: unknown = null;
  let scriptVerdict: Verdict = "fail";
  let scriptDetail = "not attempted";
  if (inCep) {
    try {
      hostInfo = await callHost("gmlHostInfo");
      scriptVerdict = "pass";
      scriptDetail = JSON.stringify(hostInfo);
    } catch (error) {
      scriptDetail = error instanceof Error ? error.message : String(error);
    }
  } else {
    scriptDetail = "skipped — not in a CEP host";
    scriptVerdict = "unknown";
  }
  checks.push({ id: "extendscript", label: "ExtendScript round trip", verdict: scriptVerdict, detail: scriptDetail });
  raw.hostInfo = hostInfo;

  // --- layout engine ---
  const hasRO = typeof ResizeObserver !== "undefined";
  checks.push({
    id: "resizeobserver",
    label: "ResizeObserver drives the layout",
    verdict: verdictOf(hasRO),
    detail: hasRO ? `mode "${options.mode}" at ${Math.round(options.width)}px` : "ResizeObserver is missing",
  });

  // Container queries need Chromium 105; CEP tops out at 99. Confirming their
  // absence is what justifies the ResizeObserver design.
  const hasContainerQueries =
    typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("container-type: inline-size");
  checks.push({
    id: "container-queries",
    label: "CSS container queries",
    verdict: hasContainerQueries ? "warn" : "pass",
    detail: hasContainerQueries
      ? "Supported — newer than expected. ResizeObserver still governs; no change needed."
      : "Absent, as expected for Chromium 88–99. ResizeObserver is the right mechanism.",
  });

  const hasLogicalProps =
    typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("margin-inline-start: 0px");
  checks.push({
    id: "logical-properties",
    label: "CSS logical properties (RTL mirroring)",
    verdict: verdictOf(hasLogicalProps),
    detail: hasLogicalProps
      ? `Supported · locale ${options.locale}, dir ${options.dir}`
      : "Absent — the Arabic layout will not mirror",
  });

  // --- storage ---
  let storageOk = false;
  try {
    globalThis.localStorage?.setItem("gml.probe", "1");
    globalThis.localStorage?.removeItem("gml.probe");
    storageOk = true;
  } catch {
    storageOk = false;
  }
  checks.push({
    id: "localstorage",
    label: "localStorage (language and favourites persist)",
    verdict: verdictOf(storageOk, "warn"),
    detail: storageOk ? "readable and writable" : "blocked — preferences will not survive a restart",
  });

  // --- codecs ---
  const codecs = probeCodecs();
  raw.codecs = codecs;
  const requiredCodecs = codecs.filter((c) => c.required);
  const missing = requiredCodecs.filter((c) => c.support === "");
  checks.push({
    id: "codecs",
    label: "Media codecs for previews",
    verdict: missing.length === 0 ? "pass" : "fail",
    detail:
      missing.length === 0
        ? `All required codecs present (${requiredCodecs.map((c) => `${c.id}:${c.support}`).join(", ")})`
        : `Missing: ${missing.map((c) => c.label).join(", ")} — previews must switch to WebM/VP9`,
  });

  raw.userAgent = typeof navigator !== "undefined" ? navigator.userAgent : null;
  raw.layout = { mode: options.mode, width: options.width, locale: options.locale, dir: options.dir };

  return { generatedAt: new Date().toISOString(), checks, codecs, raw };
}

const SYMBOL: Record<Verdict, string> = { pass: "PASS", fail: "FAIL", warn: "WARN", unknown: "----" };

/** Plain text so it can be pasted straight back into a message. */
export function formatReport(report: DiagnosticsReport): string {
  const lines: string[] = [
    "GML — M0.5 panel diagnostics",
    `generated ${report.generatedAt}`,
    "",
  ];

  for (const check of report.checks) {
    lines.push(`[${SYMBOL[check.verdict]}] ${check.label}`);
    lines.push(`        ${check.detail}`);
  }

  lines.push("", "Codec support (canPlayType):");
  for (const codec of report.codecs) {
    const support = codec.support === "" ? "NO" : codec.support;
    lines.push(`  ${codec.required ? "*" : " "} ${codec.label.padEnd(26)} ${support}`);
  }

  lines.push("", "Raw:", JSON.stringify(report.raw, null, 2));
  return lines.join("\n");
}
