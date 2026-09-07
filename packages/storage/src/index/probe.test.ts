import { describe, expect, it } from "vitest";
import { MemoryFs } from "../fs.js";
import { PROBE_TAIL_BYTES, probeContainer } from "./probe.js";

/** Builds a minimal QuickTime file: ftyp, mdat (padding), moov with one video track. */
function atom(type: string, ...payload: Uint8Array[]): Uint8Array {
  const size = 8 + payload.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, size);
  out.set(new TextEncoder().encode(type), 4);
  let o = 8;
  for (const p of payload) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}
function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
}
function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n);
  return b;
}
function zeros(n: number): Uint8Array {
  return new Uint8Array(n);
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

function movFile(opts: { fourcc: string; width: number; height: number; timescale: number; delta: number; depth: number; moovAtEnd: boolean; mdatBytes: number }): Uint8Array {
  const sampleEntry = concat(
    u32(0),
    new TextEncoder().encode(opts.fourcc), // size placeholder + fourcc → fixed below
  );
  // Video sample description: 8 (size+type) + 6 reserved + 2 dref + 16 (version..temporal) + 2 w + 2 h + ... depth at +82
  const entry = new Uint8Array(86);
  new DataView(entry.buffer).setUint32(0, 86);
  entry.set(new TextEncoder().encode(opts.fourcc), 4);
  entry.set(u16(opts.width), 32);
  entry.set(u16(opts.height), 34);
  entry.set(u16(opts.depth), 82);
  void sampleEntry;

  const stsd = atom("stsd", u32(0), u32(1), entry);
  const stts = atom("stts", u32(0), u32(1), u32(10), u32(opts.delta));
  const stbl = atom("stbl", stsd, stts);
  const minf = atom("minf", stbl);
  const hdlr = atom("hdlr", u32(0), u32(0), new TextEncoder().encode("vide"), zeros(12));
  const mdhd = atom("mdhd", u32(0), u32(0), u32(0), u32(opts.timescale), u32(1000), u16(0), u16(0));
  const mdia = atom("mdia", mdhd, hdlr, minf);
  const trak = atom("trak", mdia);
  const moov = atom("moov", trak);
  const ftyp = atom("ftyp", new TextEncoder().encode("qt  "), u32(0));
  const mdat = atom("mdat", zeros(opts.mdatBytes));
  return opts.moovAtEnd ? concat(ftyp, mdat, moov) : concat(ftyp, moov, mdat);
}

describe("container probe", () => {
  it("reads ProRes 4444 XQ, dimensions and fps from a moov at the front", () => {
    const fs = new MemoryFs();
    const file = movFile({ fourcc: "ap4x", width: 1920, height: 1080, timescale: 2400, delta: 100, depth: 32, moovAtEnd: false, mdatBytes: 5000 });
    fs.writeFile("/x.mov", file);
    const info = probeContainer(fs, "/x.mov", file.byteLength);
    expect(info).toMatchObject({ codec: "prores_4444_xq", fourcc: "ap4x", width: 1920, height: 1080, fps: 24 });
  });

  it("finds a moov written at the end of a large file by reading only the tail", () => {
    const fs = new MemoryFs();
    const file = movFile({ fourcc: "ap4h", width: 3840, height: 2160, timescale: 3000, delta: 100, depth: 32, moovAtEnd: true, mdatBytes: PROBE_TAIL_BYTES + 2_000_000 });
    fs.writeFile("/big.mov", file);
    const reads: number[] = [];
    const spy = { ...fs, readRange: (p: string, o: number, l: number) => (reads.push(l), fs.readRange(p, o, l)) };
    const info = probeContainer(spy as MemoryFs, "/big.mov", file.byteLength);
    expect(info).toMatchObject({ codec: "prores_4444", width: 3840, height: 2160, fps: 30 });
    // Head plus tail, never the whole file.
    expect(reads.reduce((a, b) => a + b, 0)).toBeLessThan(file.byteLength);
  });

  it("returns null for something that is not a container", () => {
    const fs = new MemoryFs();
    fs.writeFile("/nope.mov", new TextEncoder().encode("not a movie at all"));
    expect(probeContainer(fs, "/nope.mov", 18)).toBeNull();
  });
});
