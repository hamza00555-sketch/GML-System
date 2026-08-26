import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  CSXS_VERSIONS,
  PLATFORM,
  debugModeInstructions,
  isSupportedPlatform,
  userExtensionsDir,
} from "./paths.js";

const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => console.log(`  ✕ ${m}`);
const info = (m) => console.log(`    ${m}`);

function readDebugMode(version) {
  try {
    if (PLATFORM === "darwin") {
      const out = execFileSync("defaults", ["read", `com.adobe.CSXS.${version}`, "PlayerDebugMode"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return out.trim() === "1";
    }
    if (PLATFORM === "win32") {
      const out = execFileSync(
        "reg",
        ["query", `HKCU\\Software\\Adobe\\CSXS.${version}`, "/v", "PlayerDebugMode"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      return /PlayerDebugMode\s+REG_SZ\s+1/i.test(out);
    }
  } catch {
    return false;
  }
  return false;
}

/** Reports what is actually on disk, so a missing panel can be explained. */
export function doctor({ repoRoot }) {
  console.log("\nGML — CEP diagnostics\n" + "=".repeat(38));
  console.log(`\nPlatform: ${PLATFORM}  Node: ${process.version}`);

  if (!isSupportedPlatform()) {
    bad("No Adobe host applications on this platform.");
    return 1;
  }

  console.log("\nDebug mode");
  const enabled = CSXS_VERSIONS.filter(readDebugMode);
  if (enabled.length > 0) ok(`PlayerDebugMode enabled for CSXS ${enabled.join(", ")}`);
  else {
    bad("PlayerDebugMode is not set for any CSXS version.");
    info("An unsigned extension will be filtered out and never appear. Run:");
    console.log(`\n${debugModeInstructions()}\n`);
  }

  console.log("\nBuilt output");
  for (const dir of ["ae-panel", "ai-panel"]) {
    const dist = path.join(repoRoot, "apps", dir, "dist");
    const hasIndex = fs.existsSync(path.join(dist, "index.html"));
    const hasManifest = fs.existsSync(path.join(dist, "CSXS", "manifest.xml"));
    const hasHost = fs.existsSync(path.join(dist, "host", "index.jsx"));
    if (hasIndex && hasManifest && hasHost) ok(`${dir}/dist complete`);
    else {
      bad(`${dir}/dist incomplete — run "pnpm build"`);
      info(`index.html:${hasIndex} manifest:${hasManifest} host:${hasHost}`);
    }
  }

  console.log("\nInstalled extensions");
  const extensionsDir = userExtensionsDir();
  if (!fs.existsSync(extensionsDir)) {
    bad(`${extensionsDir} does not exist — run "pnpm cep:install"`);
  } else {
    const entries = fs.readdirSync(extensionsDir);
    const ours = entries.filter((e) => e.startsWith("com.gosi.gml"));
    if (ours.length === 0) bad(`No GML extension in ${extensionsDir} — run "pnpm cep:install"`);
    for (const entry of ours) {
      const target = path.join(extensionsDir, entry);
      const stat = fs.lstatSync(target);
      const kind = stat.isSymbolicLink() ? "symlink" : "copy";
      const resolved = stat.isSymbolicLink() ? fs.realpathSync(target) : target;
      const valid = fs.existsSync(path.join(resolved, "CSXS", "manifest.xml"));
      const debugFile = fs.existsSync(path.join(target, ".debug"));
      if (valid) ok(`${entry} (${kind}, .debug:${debugFile ? "yes" : "NO"})`);
      else bad(`${entry} (${kind}) — manifest missing at ${resolved}`);
    }
    if (entries.length > ours.length) {
      info(`Other extensions present: ${entries.length - ours.length}`);
    }
  }

  console.log(
    "\nIf the panel still does not appear:\n" +
      "  · Quit the Adobe app completely — extensions are read at launch.\n" +
      "  · Confirm the app version is covered by the manifest HostList.\n" +
      "  · macOS: log out and back in if killall cfprefsd did not take effect.\n" +
      "  · Windows: Developer Mode allows symlinks; otherwise the install falls back to copying.\n",
  );
  return 0;
}

export function uninstall() {
  const extensionsDir = userExtensionsDir();
  if (!extensionsDir || !fs.existsSync(extensionsDir)) {
    console.log("Nothing to remove.");
    return 0;
  }
  for (const entry of fs.readdirSync(extensionsDir)) {
    if (!entry.startsWith("com.gosi.gml")) continue;
    fs.rmSync(path.join(extensionsDir, entry), { recursive: true, force: true });
    console.log(`Removed ${entry}`);
  }
  console.log("PlayerDebugMode was left enabled — it is a global developer setting.");
  return 0;
}
