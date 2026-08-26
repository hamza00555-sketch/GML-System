import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  CSXS_VERSIONS,
  DEBUG_PORTS,
  PLATFORM,
  debugModeInstructions,
  isSupportedPlatform,
  userExtensionsDir,
} from "./paths.js";

const PANELS = [
  { id: "com.gosi.gml.ae", dir: "ae-panel", folder: "com.gosi.gml.ae", host: "AEFT", app: "After Effects" },
  { id: "com.gosi.gml.ai", dir: "ai-panel", folder: "com.gosi.gml.ai", host: "ILST", app: "Illustrator" },
];

const ok = (m) => console.log(`  ✓ ${m}`);
const warn = (m) => console.log(`  ⚠ ${m}`);
const fail = (m) => console.log(`  ✕ ${m}`);
const step = (m) => console.log(`\n${m}`);

/** Writes the remote-debugging descriptor CEP reads from the extension root. */
function writeDebugFile(target, extensionId, host) {
  const port = DEBUG_PORTS[host];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ExtensionList>
    <Extension Id="${extensionId}">
        <HostList>
            <Host Name="${host}" Port="${port}"/>
        </HostList>
    </Extension>
</ExtensionList>
`;
  fs.writeFileSync(path.join(target, ".debug"), xml, "utf8");
  return port;
}

/**
 * PlayerDebugMode lets an unsigned extension load. Without it the panel is
 * silently filtered out and never appears in the Extensions menu.
 */
function enableDebugMode() {
  const applied = [];
  const failed = [];

  for (const version of CSXS_VERSIONS) {
    try {
      if (PLATFORM === "darwin") {
        execFileSync("defaults", ["write", `com.adobe.CSXS.${version}`, "PlayerDebugMode", "1"], {
          stdio: "ignore",
        });
      } else if (PLATFORM === "win32") {
        execFileSync(
          "reg",
          ["add", `HKCU\\Software\\Adobe\\CSXS.${version}`, "/v", "PlayerDebugMode", "/t", "REG_SZ", "/d", "1", "/f"],
          { stdio: "ignore" },
        );
      } else {
        failed.push(version);
        continue;
      }
      applied.push(version);
    } catch {
      failed.push(version);
    }
  }

  if (PLATFORM === "darwin" && applied.length > 0) {
    try {
      // macOS caches plists; without this the change may not be seen for minutes.
      execFileSync("killall", ["cfprefsd"], { stdio: "ignore" });
    } catch {
      warn("Could not restart cfprefsd — if the panel does not appear, log out and back in.");
    }
  }

  return { applied, failed };
}

/**
 * A symlink keeps a rebuild live without reinstalling. Windows needs either
 * Developer Mode or an elevated shell to create one, so a copy is the fallback.
 */
function linkExtension(source, target) {
  fs.rmSync(target, { recursive: true, force: true });
  try {
    fs.symlinkSync(source, target, "junction");
    return "symlink";
  } catch {
    fs.cpSync(source, target, { recursive: true });
    return "copy";
  }
}

export function install({ repoRoot }) {
  console.log("\nGML — CEP development install\n" + "=".repeat(38));

  if (!isSupportedPlatform()) {
    step("Platform");
    fail(`${PLATFORM} has no Adobe host applications.`);
    console.log(
      "\n  Run this on the machine where After Effects and Illustrator are installed.\n" +
        "  Everything else (pnpm test, pnpm harness) works here.\n",
    );
    return 1;
  }

  const extensionsDir = userExtensionsDir();
  step("Extensions folder");
  fs.mkdirSync(extensionsDir, { recursive: true });
  ok(extensionsDir);

  step("Debug mode (required for unsigned extensions)");
  const { applied, failed } = enableDebugMode();
  if (applied.length > 0) ok(`PlayerDebugMode set for CSXS ${applied.join(", ")}`);
  if (failed.length > 0) {
    warn(`Could not set CSXS ${failed.join(", ")}. Run manually:\n\n${debugModeInstructions()}\n`);
  }

  step("Panels");
  const installed = [];
  for (const panel of PANELS) {
    const source = path.join(repoRoot, "apps", panel.dir, "dist");
    if (!fs.existsSync(path.join(source, "index.html"))) {
      fail(`${panel.app}: ${panel.dir}/dist is missing — run "pnpm build" first.`);
      continue;
    }

    const target = path.join(extensionsDir, panel.folder);
    const mode = linkExtension(source, target);
    const port = writeDebugFile(target, panel.id, panel.host);
    ok(`${panel.app} → ${panel.folder} (${mode}, debug port ${port})`);
    installed.push({ ...panel, target, port, mode });
  }

  if (installed.length === 0) {
    console.log("\nNothing was installed.\n");
    return 1;
  }

  step("Next steps");
  console.log(
    [
      "  1. Fully quit After Effects and Illustrator (they read extensions at launch).",
      "  2. Reopen them.",
      "  3. After Effects  → Window → Extensions → GML",
      "     Illustrator     → Window → Extensions → GML",
      "  4. In the panel, open the Diagnostics tab and press “Copy report”.",
      "",
      "  Remote DevTools while a panel is open:",
      ...installed.map((p) => `    ${p.app}: http://localhost:${p.port}`),
      "",
      installed.some((p) => p.mode === "copy")
        ? "  Note: installed by copy, not symlink. Re-run pnpm cep:install after each build.\n"
        : "  Installed as symlinks: rebuild with pnpm build, then just reopen the panel.\n",
      "  If GML does not appear, run: pnpm cep:doctor",
    ].join("\n"),
  );
  return 0;
}
