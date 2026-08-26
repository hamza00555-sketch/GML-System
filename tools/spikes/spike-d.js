#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";

/**
 * Spike D — can we render previews without blocking the designer?
 *
 * Publishing needs two binaries: aerender to produce frames headlessly, and
 * ffmpeg to turn them into preview.mp4, preview.gif and poster.png. Neither
 * ships with the panel, so their presence and paths have to be established
 * before M3 assumes them.
 */

const pass = (m) => console.log(`  \x1b[32m[PASS]\x1b[0m ${m}`);
const fail = (m) => console.log(`  \x1b[31m[FAIL]\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m[WARN]\x1b[0m ${m}`);
const info = (m) => console.log(`         ${m}`);

const results = [];
function record(id, ok, detail) {
  results.push({ id, ok });
  (ok ? pass : fail)(id);
  info(detail);
}

/** aerender sits inside the application bundle, one folder per AE version. */
function findAerender() {
  const candidates = [];

  if (process.platform === "darwin") {
    const apps = "/Applications";
    if (fs.existsSync(apps)) {
      for (const entry of fs.readdirSync(apps)) {
        if (/^Adobe After Effects/i.test(entry)) {
          candidates.push(path.join(apps, entry, "aerender"));
        }
      }
    }
  } else if (process.platform === "win32") {
    for (const base of ["C:\\Program Files\\Adobe", "C:\\Program Files (x86)\\Adobe"]) {
      if (!fs.existsSync(base)) continue;
      for (const entry of fs.readdirSync(base)) {
        if (/^Adobe After Effects/i.test(entry)) {
          candidates.push(path.join(base, entry, "Support Files", "aerender.exe"));
        }
      }
    }
  }

  return candidates.filter((c) => fs.existsSync(c));
}

function findOnPath(binary) {
  const probe = process.platform === "win32" ? "where" : "which";
  const found = spawnSync(probe, [binary], { encoding: "utf8" });
  if (found.status !== 0) return null;
  return found.stdout.split(/\r?\n/).filter(Boolean)[0] ?? null;
}

console.log("\nGML Spike D — aerender and ffmpeg\n" + "=".repeat(38));
console.log(`\nPlatform: ${process.platform} · Node ${process.version}\n`);

// ---- aerender ----
const aerenders = findAerender();
if (aerenders.length > 0) {
  record("D.1 aerender found", true, aerenders.join("\n         "));
  try {
    // aerender prints its banner and exits non-zero without a project; the
    // banner alone proves it is runnable.
    const out = spawnSync(aerenders[0], ["-help"], { encoding: "utf8", timeout: 30000 });
    const banner = `${out.stdout ?? ""}${out.stderr ?? ""}`.split(/\r?\n/).find((l) => l.trim());
    record("D.2 aerender is executable", Boolean(banner), banner ?? "no output");
  } catch (error) {
    record("D.2 aerender is executable", false, String(error));
  }
} else {
  record(
    "D.1 aerender found",
    false,
    "Not found. Headless preview rendering is unavailable; previews would have to " +
      "be rendered in the designer's own AE session, which blocks them while it runs.",
  );
}

// ---- ffmpeg ----
const ffmpeg = findOnPath("ffmpeg");
if (ffmpeg) {
  const version = execFileSync(ffmpeg, ["-version"], { encoding: "utf8" }).split(/\r?\n/)[0];
  record("D.3 ffmpeg found", true, `${ffmpeg}\n         ${version}`);

  const encoders = execFileSync(ffmpeg, ["-encoders"], { encoding: "utf8" });
  const hasH264 = /\blibx264\b/.test(encoders);
  const hasGif = /\bgif\b/.test(encoders);
  const hasVp9 = /\blibvpx-vp9\b/.test(encoders);

  record(
    "D.4 ffmpeg can encode H.264",
    hasH264,
    hasH264 ? "libx264 present — preview.mp4 is producible" : "libx264 missing; only WebM would be possible",
  );
  record("D.5 ffmpeg can encode GIF", hasGif, hasGif ? "gif encoder present" : "gif encoder missing");
  if (!hasVp9) warn("libvpx-vp9 absent — no fallback if H.264 turns out unusable in CEP");

  // A real end-to-end encode, so this is not just a capability listing.
  const tmp = path.join(os.tmpdir(), `gml-spike-d-${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  try {
    const mp4 = path.join(tmp, "probe.mp4");
    execFileSync(
      ffmpeg,
      ["-f", "lavfi", "-i", "testsrc=size=160x90:rate=25:duration=1", "-c:v", "libx264",
       "-pix_fmt", "yuv420p", "-y", mp4],
      { stdio: "ignore", timeout: 60000 },
    );
    const size = fs.statSync(mp4).size;
    record("D.6 produced a real H.264 MP4", size > 0, `${size} bytes at ${mp4}`);
    console.log(`\n  Copy that file into the panel to confirm playback:\n    ${mp4}\n`);
  } catch (error) {
    record("D.6 produced a real H.264 MP4", false, String(error));
  }
} else {
  record(
    "D.3 ffmpeg found",
    false,
    "Not on PATH. Install it, or plan to bundle a build with the extension " +
      "(note the LGPL obligations that come with redistributing it).",
  );
}

const failed = results.filter((r) => !r.ok).length;
console.log("\n" + "=".repeat(38));
console.log(failed === 0 ? "VERDICT: PASS" : `VERDICT: FAIL (${failed} check(s))`);
if (failed > 0) {
  console.log(
    "\nM3's automatic preview generation depends on both binaries.\n" +
      "Without them, publishing would need previews supplied by hand.\n",
  );
}
process.exit(failed === 0 ? 0 : 1);
