import fs from "node:fs";
import path from "node:path";

/**
 * Assembles a CEP extension bundle around Vite's output.
 *
 * Two things CEP needs that Vite will not do on its own:
 *  - CSXS/manifest.xml and the ExtendScript host must sit inside the extension
 *    root next to index.html;
 *  - the host script has to be a single file, because ExtendScript's #include
 *    resolution is fragile once the bundle is copied elsewhere. The shared
 *    helpers and the host-specific script are concatenated instead.
 */
export function cepBundle({ root, hostScripts = [], extraDirs = [], staticFiles = [] }) {
  return {
    name: "gml-cep-bundle",
    apply: "build",
    closeBundle() {
      const outDir = path.join(root, "dist");

      // 1. manifest
      const manifestSrc = path.join(root, "CSXS", "manifest.xml");
      const manifestDest = path.join(outDir, "CSXS", "manifest.xml");
      fs.mkdirSync(path.dirname(manifestDest), { recursive: true });
      fs.copyFileSync(manifestSrc, manifestDest);

      // 2. one concatenated ExtendScript file
      if (hostScripts.length > 0) {
        const banner =
          "// GENERATED — do not edit. Built from jsx/ sources by cepBundle.\n" +
          "// ExtendScript is ES3: no let/const, no arrow functions, no native JSON.\n\n";
        const body = hostScripts
          .map((file) => {
            const source = fs.readFileSync(file, "utf8");
            return `// ---- ${path.basename(file)} ----\n${source}\n`;
          })
          .join("\n");
        const hostDest = path.join(outDir, "host", "index.jsx");
        fs.mkdirSync(path.dirname(hostDest), { recursive: true });
        fs.writeFileSync(hostDest, banner + body, "utf8");
      }

      // 3. index.html is copied verbatim rather than processed: Vite only
      //    bundles type="module" scripts, and CEP needs a classic script tag.
      for (const file of staticFiles) {
        const src = path.join(root, file);
        if (!fs.existsSync(src)) continue;
        const dest = path.join(outDir, file);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
      }

      // 4. anything else the panel ships (self-test media, icons)
      for (const dir of extraDirs) {
        const src = path.join(root, dir);
        if (!fs.existsSync(src)) continue;
        fs.cpSync(src, path.join(outDir, path.basename(dir)), { recursive: true });
      }
    },
  };
}

/**
 * Shared Vite build settings for a CEP panel.
 *
 * The output must be a classic IIFE loaded with a plain <script src>: CEP
 * serves the panel from the filesystem, and Chromium refuses ES modules over
 * file:// on CORS grounds.
 */
export function cepBuildConfig({ entry }) {
  return {
    base: "./",
    build: {
      // The entry is the script, not index.html: Vite refuses to bundle a
      // classic <script src>, which is the only kind CEP can load from file://.
      target: "chrome88", // CEP 11.1 is Chromium 88; CEP 12 is 99.
      modulePreload: false,
      cssCodeSplit: false,
      rollupOptions: {
        input: entry,
        output: {
          format: "iife",
          entryFileNames: "assets/panel.js",
          chunkFileNames: "assets/panel.js",
          assetFileNames: "assets/panel[extname]",
          inlineDynamicImports: true,
        },
      },
    },
  };
}
