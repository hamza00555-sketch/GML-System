import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cepBuildConfig, cepBundle } from "@gml/cep-dev/vite-plugin";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = path.resolve(here, "../..");
const entry = (name: string) => path.join(repo, "packages", name, "src/index.ts");
const srcDir = (name: string) => path.join(repo, "packages", name, "src");

export default defineConfig({
  ...cepBuildConfig({ entry: path.join(here, "src/main.tsx") }),
  plugins: [
    react(),
    cepBundle({
      root: here,
      staticFiles: ["index.html"],
      // Concatenated in order: the ES3 helpers must be defined before the
      // host functions that use them.
      hostScripts: [
        path.join(repo, "jsx/shared/gml-json.jsx"),
        path.join(repo, "jsx/ae/host.jsx"),
      ],
    }),
  ],
  resolve: {
    // Anchored so subpath imports such as "@gml/ui/tokens.css" are not
    // rewritten into "index.ts/tokens.css".
    alias: [
      { find: /^@gml\/core$/, replacement: entry("core") },
      { find: /^@gml\/storage$/, replacement: entry("storage") },
      { find: /^@gml\/ui$/, replacement: entry("ui") },
      { find: /^@gml\/cep$/, replacement: entry("cep") },
      { find: /^@gml\/core\/(.*)$/, replacement: `${srcDir("core")}/$1` },
      { find: /^@gml\/storage\/(.*)$/, replacement: `${srcDir("storage")}/$1` },
      { find: /^@gml\/ui\/(.*)$/, replacement: `${srcDir("ui")}/$1` },
      { find: /^@gml\/cep\/(.*)$/, replacement: `${srcDir("cep")}/$1` },
    ],
  },
});
