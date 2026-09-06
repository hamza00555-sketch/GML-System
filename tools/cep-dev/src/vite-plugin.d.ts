import type { BuildOptions, Plugin } from "vite";

export interface CepBundleOptions {
  /** The panel app's root — the folder holding CSXS/manifest.xml and index.html. */
  root: string;
  /** ExtendScript sources, concatenated in order into dist/host/index.jsx. */
  hostScripts?: string[];
  /** Folders copied verbatim into dist (self-test media, icons). */
  extraDirs?: string[];
  /** Files copied verbatim into dist, relative to root (index.html). */
  staticFiles?: string[];
}

export function cepBundle(options: CepBundleOptions): Plugin;

export function cepBuildConfig(options: { entry: string }): {
  base: string;
  build: BuildOptions;
};
