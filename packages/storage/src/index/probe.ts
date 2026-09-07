import type { AlphaMode } from "@gml/core";
import type { FolderFs } from "../fs.js";

/**
 * Reads codec, dimensions and frame rate out of a QuickTime / MP4 container
 * without decoding anything — and without reading the whole file. On a Drive
 * for Desktop mount every byte read is a byte downloaded, so the probe reads
 * the head, and the tail only if the `moov` atom is not at the front.
 */

export interface MediaInfo {
  codec: string;
  width?: number;
  height?: number;
  fps?: number;
  alpha: AlphaMode;
  /** Codec fourcc as found, for diagnostics. */
  fourcc: string;
}

const CODEC_NAMES: Record<string, string> = {
  ap4x: "prores_4444_xq",
  ap4h: "prores_4444",
  apch: "prores_422_hq",
  apcn: "prores_422",
  apcs: "prores_422_lt",
  apco: "prores_422_proxy",
  avc1: "h264",
  hvc1: "hevc",
  hev1: "hevc",
  mp4v: "mpeg4",
  png: "png",
  rle: "animation",
  cvid: "cinepak",
  jpeg: "mjpeg",
  vp09: "vp9",
  av01: "av1",
};

/** Codecs that can carry an alpha channel; everything else is opaque. */
const ALPHA_CAPABLE = new Set(["ap4x", "ap4h", "png", "rle", "vp09"]);

export const PROBE_HEAD_BYTES = 1024 * 1024;
export const PROBE_TAIL_BYTES = 8 * 1024 * 1024;

function u32(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) >>> 0) + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!;
}
function u16(b: Uint8Array, o: number): number {
  return (b[o]! << 8) + b[o + 1]!;
}
function fourcc(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
}

interface Atom {
  type: string;
  start: number;
  size: number;
  /** Offset of the payload within the buffer. */
  body: number;
}

/** Iterates atoms in [from, to) of a buffer. Handles 64-bit sizes and size-0 (to end). */
function* atoms(b: Uint8Array, from: number, to: number): Generator<Atom> {
  let o = from;
  while (o + 8 <= to) {
    let size = u32(b, o);
    const type = fourcc(b, o + 4);
    let body = o + 8;
    if (size === 1) {
      if (o + 16 > to) return;
      // 64-bit size: high 32 bits are zero for anything we can hold in memory.
      size = u32(b, o + 12) + u32(b, o + 8) * 2 ** 32;
      body = o + 16;
    } else if (size === 0) {
      size = to - o;
    }
    if (size < 8) return;
    yield { type, start: o, size, body };
    o += size;
  }
}

function findChild(b: Uint8Array, parent: Atom, type: string): Atom | null {
  const end = Math.min(parent.start + parent.size, b.byteLength);
  for (const a of atoms(b, parent.body, end)) if (a.type === type) return a;
  return null;
}

/** Parses a complete `moov` atom held in memory. */
export function parseMoov(b: Uint8Array, moov: Atom): MediaInfo | null {
  const end = Math.min(moov.start + moov.size, b.byteLength);
  for (const trak of atoms(b, moov.body, end)) {
    if (trak.type !== "trak") continue;
    const mdia = findChild(b, trak, "mdia");
    if (!mdia) continue;
    const hdlr = findChild(b, mdia, "hdlr");
    if (!hdlr || fourcc(b, hdlr.body + 8) !== "vide") continue;

    const mdhd = findChild(b, mdia, "mdhd");
    let fps: number | undefined;
    const minf = findChild(b, mdia, "minf");
    const stbl = minf ? findChild(b, minf, "stbl") : null;
    if (mdhd && stbl) {
      const version = b[mdhd.body]!;
      const timescale = version === 1 ? u32(b, mdhd.body + 20) : u32(b, mdhd.body + 12);
      const stts = findChild(b, stbl, "stts");
      if (stts && timescale > 0) {
        const entries = u32(b, stts.body + 4);
        if (entries >= 1) {
          const delta = u32(b, stts.body + 12);
          if (delta > 0) fps = Math.round((timescale / delta) * 1000) / 1000;
        }
      }
    }

    const stsd = stbl ? findChild(b, stbl, "stsd") : null;
    if (!stsd) continue;
    // stsd: version/flags (4) + entry count (4) + first sample description.
    const entry = stsd.body + 8;
    if (entry + 34 > b.byteLength) continue;
    const code = fourcc(b, entry + 4);
    const width = u16(b, entry + 32);
    const height = u16(b, entry + 34);
    const depth = entry + 82 < b.byteLength ? u16(b, entry + 82) : 0;

    // QuickTime writes depth 32 for RGBA. ProRes 4444 reports 32 only when
    // rendered with alpha, so this is the best signal available without
    // decoding. Straight vs premultiplied is not recorded in the container.
    const alpha: AlphaMode = ALPHA_CAPABLE.has(code) && depth === 32 ? "unknown" : "unknown";

    return {
      codec: CODEC_NAMES[code] ?? code,
      fourcc: code,
      width: width || undefined,
      height: height || undefined,
      fps,
      alpha,
    };
  }
  return null;
}

/** Finds a top-level `moov` in a buffer that starts at a file offset. */
function findMoov(b: Uint8Array): Atom | null {
  for (const a of atoms(b, 0, b.byteLength)) {
    if (a.type === "moov") return a;
    if (a.type === "mdat" || a.type === "free" || a.type === "wide" || a.type === "ftyp" || a.type === "skip") continue;
  }
  return null;
}

/**
 * Probes a .mov/.mp4 with bounded reads. Returns null when the container
 * cannot be read within the byte budget — callers then infer from the name.
 */
export function probeContainer(fs: FolderFs, absPath: string, size: number): MediaInfo | null {
  try {
    const head = fs.readRange(absPath, 0, Math.min(PROBE_HEAD_BYTES, size));
    const moov = findMoov(head);
    if (moov && moov.start + moov.size <= head.byteLength) return parseMoov(head, moov);
    if (moov && moov.size <= PROBE_TAIL_BYTES) {
      // moov at the front but longer than the head read: re-read just it.
      const full = fs.readRange(absPath, moov.start, moov.size);
      const again = findMoov(full);
      return again ? parseMoov(full, again) : null;
    }

    // After Effects writes mdat first and moov at the very end.
    if (size > head.byteLength) {
      const tailStart = Math.max(0, size - PROBE_TAIL_BYTES);
      const tail = fs.readRange(absPath, tailStart, size - tailStart);
      // moov is not necessarily aligned to the buffer start: scan for the tag.
      for (let i = 0; i + 8 <= tail.byteLength; i++) {
        if (tail[i + 4] === 0x6d && tail[i + 5] === 0x6f && tail[i + 6] === 0x6f && tail[i + 7] === 0x76) {
          const candidate = { type: "moov", start: i, size: u32(tail, i), body: i + 8 };
          if (candidate.size >= 8 && candidate.start + candidate.size <= tail.byteLength) {
            const info = parseMoov(tail, candidate);
            if (info) return info;
          }
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** When probing is impossible, the convention still says a lot. */
export function inferFromName(fileName: string): Partial<MediaInfo> {
  const lower = fileName.toLowerCase();
  const alphaNamed = lower.includes("alpha");
  return {
    codec: lower.endsWith(".mov") ? "prores_4444" : lower.endsWith(".mp4") ? "h264" : undefined,
    alpha: alphaNamed ? "unknown" : "unknown",
  };
}
