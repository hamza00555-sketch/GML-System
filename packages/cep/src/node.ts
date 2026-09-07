import {
  hashesFrom,
  nodeFolderFs,
  type CryptoLike,
  type FolderFs,
  type Hashes,
  type NodeFsLike,
  type NodePathLike,
} from "@gml/storage";
import { cepNodeRequire } from "./csinterface.js";

/**
 * The Node surface the panel uses, obtained through CEP's `require` rather
 * than bundled imports: Vite cannot bundle node:fs for a browser target, and
 * inside CEP the modules exist only via cep_node.
 */
export interface PanelNode {
  fs: FolderFs;
  hashes: Hashes;
  path: NodePathLike;
  homedir: string;
  platform: string;
  readFile(absolutePath: string): Uint8Array;
  writeFile(absolutePath: string, data: string | Uint8Array): void;
  exists(absolutePath: string): boolean;
  mkdir(absolutePath: string): void;
}

interface OsLike {
  homedir(): string;
  platform(): string;
}

let cached: PanelNode | null | undefined;

export function panelNode(): PanelNode | null {
  if (cached !== undefined) return cached;
  const req = cepNodeRequire();
  if (!req) return (cached = null);
  try {
    const fs = req("fs") as NodeFsLike;
    const path = req("path") as NodePathLike;
    const os = req("os") as OsLike;
    const crypto = req("crypto") as CryptoLike;
    const folderFs = nodeFolderFs(fs, path);
    cached = {
      fs: folderFs,
      hashes: hashesFrom(crypto),
      path,
      homedir: os.homedir(),
      platform: os.platform(),
      readFile: (p) => fs.readFileSync(p),
      writeFile: (p, d) => fs.writeFileSync(p, d),
      exists: (p) => fs.existsSync(p),
      mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
    };
  } catch {
    cached = null;
  }
  return cached;
}
