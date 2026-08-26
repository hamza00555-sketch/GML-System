#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { install } from "./install.js";
import { doctor, uninstall } from "./doctor.js";

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const command = process.argv[2] ?? "install";

const commands = { install, doctor, uninstall };
const run = commands[command];

if (!run) {
  console.error(`Unknown command "${command}". Expected: ${Object.keys(commands).join(", ")}`);
  process.exit(2);
}

process.exit(run({ repoRoot }) ?? 0);
