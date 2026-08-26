/**
 * Minimal typed access to the CEP host.
 *
 * Adobe ships CSInterface.js, but every call it makes goes through the injected
 * `window.__adobe_cep__` object. Talking to that directly keeps the surface
 * small, typed, and free of a vendored blob, and lets us degrade cleanly when
 * the panel is opened outside a host (the harness).
 */

interface AdobeCep {
  evalScript(script: string, callback: (result: string) => void): void;
  getHostEnvironment(): string;
  getSystemPath(type: string): string;
  getExtensionId(): string;
  addEventListener(type: string, listener: (event: unknown) => void, obj?: unknown): void;
}

declare global {
  interface Window {
    __adobe_cep__?: AdobeCep;
    cep_node?: { require: NodeRequire; process: NodeJS.Process; global: unknown };
  }
}

export interface HostEnvironment {
  appName: string;
  appVersion: string;
  appLocale: string;
  appId?: string;
  isAppOnline?: boolean;
}

export function cepAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.__adobe_cep__ !== "undefined";
}

/**
 * Node inside CEP lives on `cep_node` when --mixed-context is off, and also on
 * the global when it is on. Checking both is what makes Spike C meaningful.
 */
export function cepNodeRequire(): NodeRequire | null {
  if (typeof window === "undefined") return null;
  if (window.cep_node?.require) return window.cep_node.require;
  const globalRequire = (globalThis as { require?: NodeRequire }).require;
  return typeof globalRequire === "function" ? globalRequire : null;
}

export function hostEnvironment(): HostEnvironment | null {
  if (!cepAvailable()) return null;
  try {
    return JSON.parse(window.__adobe_cep__!.getHostEnvironment()) as HostEnvironment;
  } catch {
    return null;
  }
}

export function systemPath(type: "extension" | "userData" | "commonFiles" | "hostApplication"): string | null {
  if (!cepAvailable()) return null;
  try {
    return window.__adobe_cep__!.getSystemPath(type);
  } catch {
    return null;
  }
}

export function extensionId(): string | null {
  if (!cepAvailable()) return null;
  try {
    return window.__adobe_cep__!.getExtensionId();
  } catch {
    return null;
  }
}

export class EvalScriptError extends Error {
  constructor(
    message: string,
    readonly script: string,
    readonly raw?: string,
  ) {
    super(message);
    this.name = "EvalScriptError";
  }
}

/** ExtendScript's own failure marker, returned as an ordinary string. */
const EVAL_ERROR = "EvalScript error.";

export function evalScriptRaw(script: string, timeoutMs = 15000): Promise<string> {
  if (!cepAvailable()) {
    return Promise.reject(new EvalScriptError("Not running inside a CEP host", script));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // A host busy in a modal dialog never calls back; failing loudly beats hanging.
      reject(new EvalScriptError(`ExtendScript timed out after ${timeoutMs}ms`, script));
    }, timeoutMs);

    window.__adobe_cep__!.evalScript(script, (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (result === EVAL_ERROR) {
        reject(new EvalScriptError("ExtendScript reported an error", script, result));
      } else {
        resolve(result);
      }
    });
  });
}

/** The envelope every gml* host function returns. */
export type HostEnvelope<T> = { ok: true; data: T } | { ok: false; error: string; detail?: string };

/**
 * Calls a host function and unwraps its envelope. Arguments are injected as
 * JSON text, which is already valid ExtendScript object-literal syntax — so the
 * ES3 side never needs a JSON parser.
 */
export async function callHost<T>(fn: string, arg?: unknown, timeoutMs?: number): Promise<T> {
  const literal = arg === undefined ? "" : JSON.stringify(arg);
  const script = `${fn}(${literal})`;
  const raw = await evalScriptRaw(script, timeoutMs);

  let parsed: HostEnvelope<T>;
  try {
    parsed = JSON.parse(raw) as HostEnvelope<T>;
  } catch {
    throw new EvalScriptError(`Host returned non-JSON from ${fn}`, script, raw);
  }

  if (!parsed.ok) {
    throw new EvalScriptError(parsed.error + (parsed.detail ? ` — ${parsed.detail}` : ""), script, raw);
  }
  return parsed.data;
}
