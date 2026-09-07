/**
 * The filesystem seam.
 *
 * Inside a CEP panel this is Node's `fs` obtained through `cep_node.require`;
 * in tests it is an in-memory tree. Keeping it structural means nothing here
 * imports a Node built-in, so the same code bundles for the browser harness
 * without polyfills.
 *
 * Reads are ranged on purpose: the library is a Google Drive for Desktop
 * mount, where reading a byte range of a 3 GB file downloads only those
 * chunks, but reading the whole file downloads all of it.
 */

export interface FsStat {
  isDirectory: boolean;
  size: number;
  /** Milliseconds since the epoch. */
  mtimeMs: number;
}

export interface FolderFs {
  exists(path: string): boolean;
  stat(path: string): FsStat;
  readdir(path: string): string[];
  readFile(path: string): Uint8Array;
  /** Bytes [offset, offset+length) — short at end of file. */
  readRange(path: string, offset: number, length: number): Uint8Array;
  writeFile(path: string, data: Uint8Array | string): void;
  /** Appends; creates the file when missing. */
  appendFile(path: string, data: Uint8Array): void;
  mkdir(path: string): void;
  copyFile(from: string, to: string): void;
  rename(from: string, to: string): void;
  rm(path: string): void;
  join(...parts: string[]): string;
  dirname(path: string): string;
  basename(path: string): string;
}

/** Hashes over an injected implementation — Node crypto in CEP, anything in tests. */
export interface Hashes {
  sha256(data: Uint8Array): string;
  md5(data: Uint8Array): string;
  /** Incremental md5 for streamed downloads. */
  md5Stream(): { update(chunk: Uint8Array): void; digest(): string };
}

/** Structural view of the parts of node:crypto the library uses. */
export interface CryptoLike {
  createHash(algorithm: string): {
    update(data: Uint8Array): unknown;
    digest(encoding: "hex"): string;
  };
}

export function hashesFrom(crypto: CryptoLike): Hashes {
  return {
    sha256: (data) => {
      const h = crypto.createHash("sha256");
      h.update(data);
      return h.digest("hex");
    },
    md5: (data) => {
      const h = crypto.createHash("md5");
      h.update(data);
      return h.digest("hex");
    },
    md5Stream: () => {
      const h = crypto.createHash("md5");
      return { update: (chunk) => void h.update(chunk), digest: () => h.digest("hex") };
    },
  };
}

/** Structural view of the parts of node:fs and node:path the adapter uses. */
export interface NodeFsLike {
  existsSync(path: string): boolean;
  statSync(path: string): { isDirectory(): boolean; size: number; mtimeMs: number };
  readdirSync(path: string): string[];
  readFileSync(path: string): Uint8Array;
  writeFileSync(path: string, data: Uint8Array | string): void;
  appendFileSync(path: string, data: Uint8Array): void;
  mkdirSync(path: string, options: { recursive: boolean }): void;
  copyFileSync(from: string, to: string): void;
  renameSync(from: string, to: string): void;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
  openSync(path: string, flags: string): number;
  readSync(fd: number, buffer: Uint8Array, offset: number, length: number, position: number): number;
  closeSync(fd: number): void;
}

export interface NodePathLike {
  join(...parts: string[]): string;
  dirname(path: string): string;
  basename(path: string): string;
}

export function nodeFolderFs(fs: NodeFsLike, path: NodePathLike): FolderFs {
  return {
    exists: (p) => fs.existsSync(p),
    stat: (p) => {
      const s = fs.statSync(p);
      return { isDirectory: s.isDirectory(), size: s.size, mtimeMs: s.mtimeMs };
    },
    readdir: (p) => fs.readdirSync(p),
    readFile: (p) => fs.readFileSync(p),
    readRange: (p, offset, length) => {
      const fd = fs.openSync(p, "r");
      try {
        const buffer = new Uint8Array(length);
        const read = fs.readSync(fd, buffer, 0, length, offset);
        return buffer.subarray(0, read);
      } finally {
        fs.closeSync(fd);
      }
    },
    writeFile: (p, data) => fs.writeFileSync(p, data),
    appendFile: (p, data) => fs.appendFileSync(p, data),
    mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
    copyFile: (from, to) => fs.copyFileSync(from, to),
    rename: (from, to) => fs.renameSync(from, to),
    rm: (p) => fs.rmSync(p, { recursive: true, force: true }),
    join: (...parts) => path.join(...parts),
    dirname: (p) => path.dirname(p),
    basename: (p) => path.basename(p),
  };
}

/**
 * In-memory filesystem for tests. Paths are POSIX-style; directories exist
 * implicitly once something is written beneath them, plus explicitly via mkdir
 * so an empty folder can be represented. Backslashes are accepted and
 * normalised, so Windows-shaped roots work in tests too.
 */
export class MemoryFs implements FolderFs {
  private readonly files = new Map<string, { data: Uint8Array; mtimeMs: number; size: number }>();
  private readonly dirs = new Set<string>(["/"]);
  clock = 1_700_000_000_000;

  private norm(p: string): string {
    const joined = p.replace(/\\/g, "/").replace(/\/+/g, "/");
    return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
  }

  join(...parts: string[]): string {
    return this.norm(parts.filter((x) => x.length > 0).join("/"));
  }

  dirname(p: string): string {
    const n = this.norm(p);
    const i = n.lastIndexOf("/");
    if (i <= 0) return i === 0 ? "/" : ".";
    return n.slice(0, i);
  }

  basename(p: string): string {
    const n = this.norm(p);
    return n.slice(n.lastIndexOf("/") + 1);
  }

  exists(p: string): boolean {
    const n = this.norm(p);
    return this.files.has(n) || this.dirs.has(n);
  }

  stat(p: string): FsStat {
    const n = this.norm(p);
    const file = this.files.get(n);
    if (file) return { isDirectory: false, size: file.size, mtimeMs: file.mtimeMs };
    if (this.dirs.has(n)) return { isDirectory: true, size: 0, mtimeMs: this.clock };
    throw new Error(`ENOENT: ${p}`);
  }

  readdir(p: string): string[] {
    const n = this.norm(p);
    if (!this.dirs.has(n)) throw new Error(`ENOENT: ${p}`);
    const prefix = n === "/" ? "/" : `${n}/`;
    const names = new Set<string>();
    for (const key of [...this.files.keys(), ...this.dirs]) {
      if (key !== n && key.startsWith(prefix)) {
        const first = key.slice(prefix.length).split("/")[0];
        if (first) names.add(first);
      }
    }
    return [...names].sort();
  }

  readFile(p: string): Uint8Array {
    const file = this.files.get(this.norm(p));
    if (!file) throw new Error(`ENOENT: ${p}`);
    return file.data;
  }

  readRange(p: string, offset: number, length: number): Uint8Array {
    return this.readFile(p).subarray(offset, offset + length);
  }

  writeFile(p: string, data: Uint8Array | string, mtimeMs?: number): void {
    const n = this.norm(p);
    this.ensureParents(n);
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
    this.clock += 1;
    this.files.set(n, { data: bytes, mtimeMs: mtimeMs ?? this.clock, size: bytes.byteLength });
  }

  /**
   * Test helper: a file that reports `size` bytes without allocating them —
   * the library holds 3 GB deliverables and tests must not.
   */
  writeSparse(p: string, size: number, mtimeMs?: number): void {
    const n = this.norm(p);
    this.ensureParents(n);
    this.clock += 1;
    this.files.set(n, { data: new Uint8Array(0), mtimeMs: mtimeMs ?? this.clock, size });
  }

  appendFile(p: string, data: Uint8Array): void {
    const n = this.norm(p);
    const existing = this.files.get(n)?.data ?? new Uint8Array(0);
    const merged = new Uint8Array(existing.byteLength + data.byteLength);
    merged.set(existing, 0);
    merged.set(data, existing.byteLength);
    this.writeFile(n, merged);
  }

  /** Test helper: set a file's mtime to simulate an edit on another machine. */
  touch(p: string, mtimeMs: number): void {
    const n = this.norm(p);
    const file = this.files.get(n);
    if (!file) throw new Error(`ENOENT: ${p}`);
    file.mtimeMs = mtimeMs;
  }

  mkdir(p: string): void {
    const n = this.norm(p);
    this.ensureParents(n);
    this.dirs.add(n);
  }

  copyFile(from: string, to: string): void {
    this.writeFile(to, this.readFile(from));
  }

  rename(from: string, to: string): void {
    const f = this.norm(from);
    const t = this.norm(to);
    if (this.exists(t)) throw new Error(`EEXIST: ${to}`);
    this.ensureParents(t);
    const move = (key: string) => (key === f ? t : `${t}${key.slice(f.length)}`);
    for (const [key, file] of [...this.files]) {
      if (key === f || key.startsWith(`${f}/`)) {
        this.files.delete(key);
        this.files.set(move(key), file);
      }
    }
    for (const key of [...this.dirs]) {
      if (key === f || key.startsWith(`${f}/`)) {
        this.dirs.delete(key);
        this.dirs.add(move(key));
      }
    }
  }

  rm(p: string): void {
    const n = this.norm(p);
    for (const key of [...this.files.keys()]) {
      if (key === n || key.startsWith(`${n}/`)) this.files.delete(key);
    }
    for (const key of [...this.dirs]) {
      if (key === n || key.startsWith(`${n}/`)) this.dirs.delete(key);
    }
  }

  /** Every file path, for assertions. */
  list(): string[] {
    return [...this.files.keys()].sort();
  }

  private ensureParents(n: string): void {
    // "/a/b/c" → "/", "/a", "/a/b"; "G:/x/y" → "G:", "G:/x". Drive-letter
    // roots have no leading slash, and must not be given one.
    const parts = n.split("/");
    for (let i = 1; i < parts.length; i++) {
      this.dirs.add(parts.slice(0, i).join("/") || "/");
    }
  }
}
