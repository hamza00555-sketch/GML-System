import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests and the harness run against sources, so a stale dist can never
    // mask a change.
    alias: {
      "@gml/core": pkg("core"),
      "@gml/storage": pkg("storage"),
      "@gml/preflight": pkg("preflight"),
      "@gml/ui": pkg("ui"),
    },
  },
  test: {
    include: ["packages/**/src/**/*.test.{ts,tsx}"],
    // UI tests opt into jsdom per-file via `// @vitest-environment jsdom`
    environment: "node",
    globals: false,
    restoreMocks: true,
  },
});
