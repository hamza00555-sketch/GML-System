/**
 * The filesystem seam for the folder-backed library.
 *
 * Inside a CEP panel this is Node's `fs` obtained through `cep_node.require`;
 * in tests it is an in-memory tree. Keeping it structural means the provider
 * never imports a Node built-in, so the same code bundles for the browser
 * harness without polyfills.
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
  writeFile(path: string, data: Uint8Array | string): void;
  mkdir(path: string): void;
  copyFile(from: string, to: string): void;
  rename(from: string, to: string): void;
  rm(path: string): void;
  join(...parts: string[]): string;
}

/** Hashes over an injected implementation — Node crypto in CEP, anything in tests. */
export interface Hashes {
  sha256(data: Uint8Array): string;
  md5(data: Uint8Array): string;
}

/** Structural view of the parts of node:crypto the library uses. */
export interface CryptoLike {
  createHash(algorithm: string): { update(data: Uint8Array): { digest(encoding: "hex"): string } };
}

export function hashesFrom(crypto: CryptoLike): Hashes {
  return {
    sha256: (data) => crypto.createHash("sha256").update(data).digest("hex"),
    md5: (data) => crypto.createHash("md5").update(data).digest("hex"),
  };
}

/** Structural view of the parts of node:fs and node:path the adapter uses. */
export interface NodeFsLike {
  existsSync(path: string): boolean;
  statSync(path: string): { isDirectory(): boolean; size: number; mtimeMs: number };
  readdirSync(path: string): string[];
  readFileSync(path: string): Uint8Array;
  writeFileSync(path: string, data: Uint8Array | string): void;
  mkdirSync(path: string, options: { recursive: boolean }): void;
  copyFileSync(from: string, to: string): void;
  renameSync(from: string, to: string): void;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
}

export interface NodePathLike {
  join(...parts: string[]): string;
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
    writeFile: (p, data) => fs.writeFileSync(p, data),
    mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
    copyFile: (from, to) => fs.copyFileSync(from, to),
    rename: (from, to) => fs.renameSync(from, to),
    rm: (p) => fs.rmSync(p, { recursive: true, force: true }),
    join: (...parts) => path.join(...parts),
  };
}

/**
 * In-memory filesystem for tests. Paths are POSIX-style; directories exist
 * implicitly once something is written beneath them, plus explicitly via mkdir
 * so an empty package folder can be represented.
 */
export class MemoryFs implements FolderFs {
  private readonly files = new Map<string, Uint8Array>();
  private readonly dirs = new Set<string>(["/"]);
  private clock = 1;

  private norm(p: string): string {
    const joined = p.replace(/\\/g, "/").replace(/\/+/g, "/");
    return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
  }

  join(...parts: string[]): string {
    return this.norm(parts.filter((x) => x.length > 0).join("/"));
  }

  exists(p: string): boolean {
    const n = this.norm(p);
    return this.files.has(n) || this.dirs.has(n);
  }

  stat(p: string): FsStat {
    const n = this.norm(p);
    const data = this.files.get(n);
    if (data) return { isDirectory: false, size: data.byteLength, mtimeMs: this.clock };
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
        const rest = key.slice(prefix.length);
        const first = rest.split("/")[0];
        if (first) names.add(first);
      }
    }
    return [...names].sort();
  }

  readFile(p: string): Uint8Array {
    const data = this.files.get(this.norm(p));
    if (!data) throw new Error(`ENOENT: ${p}`);
    return data;
  }

  writeFile(p: string, data: Uint8Array | string): void {
    const n = this.norm(p);
    this.ensureParents(n);
    this.files.set(n, typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data));
    this.clock += 1;
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
    for (const [key, data] of [...this.files]) {
      if (key === f || key.startsWith(`${f}/`)) {
        this.files.delete(key);
        this.files.set(move(key), data);
      }
    }
    for (const key of [...this.dirs]) {
      if (key === f || key.startsWith(`${f}/`)) {
        this.dirs.delete(key);
        this.dirs.add(move(key));
      }
    }
    this.clock += 1;
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

  private ensureParents(n: string): void {
    // "/a/b/c" → "/", "/a", "/a/b"; "H:/x/y" → "H:", "H:/x". Drive-letter
    // roots have no leading slash, and must not be given one.
    const parts = n.split("/");
    for (let i = 1; i < parts.length; i++) {
      this.dirs.add(parts.slice(0, i).join("/") || "/");
    }
  }
}
