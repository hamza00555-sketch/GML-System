import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const entry = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));
const srcDir = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src`, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests run against sources so a stale dist can never mask a change.
    // Patterns are anchored: a bare prefix would rewrite subpath imports such
    // as "@gml/ui/tokens.css" into "index.ts/tokens.css".
    alias: [
      { find: /^@gml\/core$/, replacement: entry("core") },
      { find: /^@gml\/storage$/, replacement: entry("storage") },
      { find: /^@gml\/preflight$/, replacement: entry("preflight") },
      { find: /^@gml\/ui$/, replacement: entry("ui") },
      { find: /^@gml\/core\/(.*)$/, replacement: `${srcDir("core")}/$1` },
      { find: /^@gml\/storage\/(.*)$/, replacement: `${srcDir("storage")}/$1` },
      { find: /^@gml\/preflight\/(.*)$/, replacement: `${srcDir("preflight")}/$1` },
      { find: /^@gml\/ui\/(.*)$/, replacement: `${srcDir("ui")}/$1` },
    ],
  },
  test: {
    include: ["packages/**/src/**/*.test.{ts,tsx}"],
    // UI tests opt into jsdom per-file via `// @vitest-environment jsdom`
    environment: "node",
    globals: false,
    restoreMocks: true,
  },
});
