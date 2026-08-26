import type { AssetFile, AssetManifest, AudioAsset, GmlAsset, MotionAsset } from "./schema.js";
import { SCHEMA_VERSION } from "./schema.js";

/** Deterministic placeholder digests so fixtures satisfy the hash format. */
function digests(seed: string): AssetFile {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hex = (len: number) =>
    Array.from({ length: len }, (_, i) =>
      (((h >>> (i % 24)) + i * 7) % 16).toString(16),
    ).join("");
  return { bytes: 1024 + (h % 90000), sha256: hex(64), md5: hex(32) };
}

export function manifestFor(files: readonly string[]): AssetManifest {
  return Object.fromEntries(files.map((f) => [f, digests(f)]));
}

const NOW = "2026-08-01T09:00:00.000Z";

export function motionFixture(over: Partial<MotionAsset> = {}): MotionAsset {
  const base: MotionAsset = {
    schemaVersion: SCHEMA_VERSION,
    assetType: "motion",
    id: "gml_fade-up",
    version: "1.0.0",
    nameEn: "Fade Up Title",
    nameAr: "عنوان يظهر للأعلى",
    description: "Clean entrance for a single line of type.",
    category: "animated-texts",
    tags: ["intro", "clean"],
    duration: 2.5,
    status: "approved",
    author: "gml",
    createdAt: NOW,
    updatedAt: NOW,
    compName: "GML_fade-up",
    fps: 25,
    width: 1920,
    height: 1080,
    source: "source.aep",
    preview: "preview.mp4",
    previewGif: "preview.gif",
    poster: "poster.png",
    dependencies: { footage: "bundled", fonts: [], plugins: [] },
    controls: [],
    assets: manifestFor(["source.aep", "preview.mp4", "preview.gif", "poster.png"]),
    ...over,
  };
  return base;
}

export function audioFixture(over: Partial<AudioAsset> = {}): AudioAsset {
  const base: AudioAsset = {
    schemaVersion: SCHEMA_VERSION,
    assetType: "audio",
    id: "gml_ui-transition-01",
    version: "1.0.0",
    nameEn: "UI Transition 01",
    nameAr: "انتقال واجهة ٠١",
    description: "Short interface transition sweep.",
    category: "audio",
    tags: ["sfx", "ui"],
    duration: 2,
    status: "approved",
    author: "gml",
    createdAt: NOW,
    updatedAt: NOW,
    master: "audio.wav",
    previewFile: "preview.mp3",
    sampleRate: 48000,
    channels: 2,
    peaks: "peaks.json",
    kind: "ui",
    assets: manifestFor(["audio.wav", "preview.mp3", "peaks.json"]),
    ...over,
  };
  return base;
}

/** A small spread across the eight categories, for the harness and tests. */
export function sampleLibrary(): GmlAsset[] {
  return [
    motionFixture(),
    motionFixture({
      id: "gml_counter-up",
      nameEn: "Counter Up",
      nameAr: "عداد تصاعدي",
      category: "counters",
      compName: "GML_counter-up",
      duration: 1.8,
      tags: ["numbers", "stat"],
    }),
    motionFixture({
      id: "gml_grid-bg",
      nameEn: "Grid Background",
      nameAr: "خلفية شبكية",
      category: "backgrounds",
      compName: "GML_grid-bg",
      duration: 6,
      tags: ["loop", "subtle"],
    }),
    motionFixture({
      id: "gml_wipe-diagonal",
      nameEn: "Diagonal Wipe",
      nameAr: "انتقال قطري",
      category: "transitions",
      compName: "GML_wipe-diagonal",
      duration: 0.8,
    }),
    motionFixture({
      id: "gml_isometric-card",
      nameEn: "Isometric Card",
      nameAr: "بطاقة ثلاثية",
      category: "3d",
      compName: "GML_isometric-card",
      duration: 3.2,
      dependencies: {
        footage: "bundled",
        fonts: [],
        plugins: [{ name: "Deep Glow", matchName: "Plugin Deep Glow" }],
      },
    }),
    motionFixture({
      id: "gml_hand-wave",
      nameEn: "Waving Hand",
      nameAr: "يد تلوّح",
      category: "illustrations",
      compName: "GML_hand-wave",
      duration: 2.1,
    }),
    motionFixture({
      id: "gml_brand-lockup",
      nameEn: "Brand Lockup",
      nameAr: "شعار الهوية",
      category: "guideline",
      compName: "GML_brand-lockup",
      duration: 2.4,
      dependencies: {
        footage: "bundled",
        fonts: ["DINNextLTArabic-Regular"],
        plugins: [],
      },
    }),
    audioFixture(),
    audioFixture({
      id: "gml_whoosh-soft",
      nameEn: "Soft Whoosh",
      nameAr: "هبّة ناعمة",
      duration: 1.2,
      kind: "sfx",
      tags: ["sfx", "transition"],
      peaks: undefined,
      assets: manifestFor(["audio.wav", "preview.mp3"]),
    }),
  ];
}
