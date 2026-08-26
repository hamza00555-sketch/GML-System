import os from "node:os";
import path from "node:path";

/**
 * Where CEP looks for extensions, and where the debug-mode switch lives.
 * Confirmed against the CEP 11.1 HTML Extension Cookbook.
 */

export const PLATFORM = process.platform; // "darwin" | "win32" | "linux"

export function isSupportedPlatform() {
  return PLATFORM === "darwin" || PLATFORM === "win32";
}

/**
 * Per-user extension folder — the only one a developer should write to.
 * CEP searches product, then system, then per-user.
 */
export function userExtensionsDir() {
  if (PLATFORM === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Adobe", "CEP", "extensions");
  }
  if (PLATFORM === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Adobe", "CEP", "extensions");
  }
  // Linux has no Adobe host; the installer reports this rather than guessing.
  return null;
}

/**
 * PlayerDebugMode must be set per CSXS major version, and we cannot know which
 * CEP version the installed host uses, so every plausible version is set.
 * CEP 9 covers CC 2019, CEP 12 is the current maximum.
 */
export const CSXS_VERSIONS = ["9", "10", "11", "12"];

export function debugModeInstructions() {
  if (PLATFORM === "darwin") {
    return CSXS_VERSIONS.map((v) => `defaults write com.adobe.CSXS.${v} PlayerDebugMode 1`)
      .concat(["killall cfprefsd"])
      .join("\n");
  }
  if (PLATFORM === "win32") {
    return CSXS_VERSIONS.map(
      (v) =>
        `reg add "HKCU\\Software\\Adobe\\CSXS.${v}" /v PlayerDebugMode /t REG_SZ /d 1 /f`,
    ).join("\n");
  }
  return "PlayerDebugMode can only be set on macOS or Windows.";
}

/** Remote-debug ports, one per host so both panels can be inspected at once. */
export const DEBUG_PORTS = { AEFT: 8088, ILST: 8089 };
