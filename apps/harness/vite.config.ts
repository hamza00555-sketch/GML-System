import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const entry = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));
const srcDir = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Anchored patterns: a bare prefix alias would rewrite "@gml/ui/tokens.css"
    // into "index.ts/tokens.css". Subpath imports get their own rule.
    alias: [
      { find: /^@gml\/core$/, replacement: entry("core") },
      { find: /^@gml\/storage$/, replacement: entry("storage") },
      { find: /^@gml\/ui$/, replacement: entry("ui") },
      { find: /^@gml\/core\/(.*)$/, replacement: `${srcDir("core")}/$1` },
      { find: /^@gml\/storage\/(.*)$/, replacement: `${srcDir("storage")}/$1` },
      { find: /^@gml\/ui\/(.*)$/, replacement: `${srcDir("ui")}/$1` },
    ],
  },
  server: { port: 5173, host: true },
});
