import {
  hashesFrom,
  nodeFolderFs,
  type CryptoLike,
  type FolderFs,
  type Hashes,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
  type NodeFsLike,
  type NodePathLike,
} from "@gml/storage";
import { cepNodeRequire } from "./csinterface.js";

/**
 * The Node surface the panel uses, obtained through CEP's `require` rather
 * than bundled imports: Vite cannot bundle node:fs for a browser target, and
 * inside CEP the modules exist only via cep_node. Everything is structural so
 * the browser harness never sees a Node type.
 */
export interface LoopbackServer {
  port: number;
  close(): void;
}

export interface PanelNode {
  fs: FolderFs;
  hashes: Hashes;
  path: NodePathLike;
  homedir: string;
  platform: string;
  env: Record<string, string | undefined>;
  pid: number;
  http: HttpClient;
  randomBytes(n: number): Uint8Array;
  sha256Hex(data: Uint8Array): string;
  /** Opens the system browser — Google refuses OAuth in an embedded webview. */
  openExternal(url: string): void;
  /** Ephemeral 127.0.0.1 listener; the handler returns the HTML to show. */
  listenLoopback(handler: (url: string) => string): Promise<LoopbackServer>;
  isProcessAlive(pid: number): boolean;
  /** Owner-only file for the refresh token. */
  writeSecret(path: string, text: string): void;
  readFile(absolutePath: string): Uint8Array;
  writeFile(absolutePath: string, data: string | Uint8Array): void;
  exists(absolutePath: string): boolean;
  mkdir(absolutePath: string): void;
  /** Native save dialog when the host offers one. */
  showSaveDialog(defaultName: string): string | null;
}

interface OsLike {
  homedir(): string;
  platform(): string;
}

interface IncomingLike {
  statusCode?: number;
  headers: Record<string, string | string[] | undefined>;
  on(event: "data", cb: (chunk: Uint8Array) => void): void;
  on(event: "end", cb: () => void): void;
  on(event: "error", cb: (e: unknown) => void): void;
  resume(): void;
}

interface ClientRequestLike {
  on(event: "error", cb: (e: unknown) => void): void;
  on(event: "timeout", cb: () => void): void;
  setTimeout(ms: number): void;
  write(chunk: Uint8Array | string): void;
  end(): void;
  destroy(error?: Error): void;
}

interface HttpsLike {
  request(url: string, options: { method: string; headers: Record<string, string> }, cb: (res: IncomingLike) => void): ClientRequestLike;
}

interface HttpModuleLike {
  createServer(handler: (req: { url?: string }, res: { writeHead(status: number, headers: Record<string, string>): void; end(body: string): void }) => void): {
    listen(port: number, host: string, cb: () => void): void;
    address(): { port: number } | string | null;
    close(): void;
    on(event: "error", cb: (e: unknown) => void): void;
  };
}

interface ChildProcessLike {
  spawn(command: string, args: string[], options: { detached: boolean; stdio: "ignore" }): { unref(): void };
}

interface ProcessLike {
  pid: number;
  env: Record<string, string | undefined>;
  kill(pid: number, signal: number): boolean;
}

interface CryptoModuleLike extends CryptoLike {
  randomBytes(n: number): Uint8Array;
}

interface CepFsLike {
  showSaveDialogEx(title: string, initialPath?: string, fileTypes?: string[], defaultName?: string): { data?: string; err?: number };
}

function nodeHttpClient(https: HttpsLike, http: HttpsLike): HttpClient {
  return {
    request(req: HttpRequest): Promise<HttpResponse> {
      return new Promise((resolve, reject) => {
        const lib = req.url.startsWith("http:") ? http : https;
        const r = lib.request(req.url, { method: req.method, headers: req.headers ?? {} }, (res) => {
          const chunks: Uint8Array[] = [];
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : (v ?? "");
          const status = res.statusCode ?? 0;
          const streaming = Boolean(req.onChunk) && (status === 200 || status === 206);
          res.on("data", (chunk) => {
            if (streaming) {
              try {
                req.onChunk!(new Uint8Array(chunk));
              } catch (error) {
                r.destroy(error instanceof Error ? error : new Error(String(error)));
              }
            } else chunks.push(new Uint8Array(chunk));
          });
          res.on("end", () => {
            const total = chunks.reduce((n, c) => n + c.byteLength, 0);
            const body = new Uint8Array(total);
            let o = 0;
            for (const c of chunks) {
              body.set(c, o);
              o += c.byteLength;
            }
            resolve({ status, headers, body });
          });
          res.on("error", reject);
        });
        r.on("error", reject);
        r.setTimeout(req.timeoutMs ?? 120_000);
        r.on("timeout", () => r.destroy(new Error("request timed out")));
        req.signal?.addEventListener("abort", () => r.destroy(new Error("aborted")));
        if (req.body !== undefined) r.write(req.body);
        r.end();
      });
    },
  };
}

let cached: PanelNode | null | undefined;

export function panelNode(): PanelNode | null {
  if (cached !== undefined) return cached;
  const req = cepNodeRequire();
  if (!req) return (cached = null);
  try {
    const fs = req("fs") as NodeFsLike & { writeFileSync(p: string, d: string, o: { mode: number }): void };
    const path = req("path") as NodePathLike;
    const os = req("os") as OsLike;
    const crypto = req("crypto") as CryptoModuleLike;
    const https = req("https") as HttpsLike;
    const http = req("http") as HttpsLike & HttpModuleLike;
    const childProcess = req("child_process") as ChildProcessLike;
    const proc = (globalThis as { process?: ProcessLike }).process ?? (req("process") as ProcessLike);
    const platform = os.platform();
    const folderFs = nodeFolderFs(fs, path);
    const cepFs = (globalThis as { cep?: { fs?: CepFsLike; util?: { openURLInDefaultBrowser(url: string): void } } }).cep;

    cached = {
      fs: folderFs,
      hashes: hashesFrom(crypto),
      path,
      homedir: os.homedir(),
      platform,
      env: proc?.env ?? {},
      pid: proc?.pid ?? 0,
      http: nodeHttpClient(https, http),
      randomBytes: (n) => new Uint8Array(crypto.randomBytes(n)),
      sha256Hex: (data) => {
        const h = crypto.createHash("sha256");
        h.update(data);
        return h.digest("hex");
      },
      openExternal: (url) => {
        if (cepFs?.util?.openURLInDefaultBrowser) {
          cepFs.util.openURLInDefaultBrowser(url);
          return;
        }
        const [cmd, args] =
          platform === "win32" ? ["cmd", ["/c", "start", "", url]] : platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
        childProcess.spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
      },
      listenLoopback: (handler) =>
        new Promise((resolve, reject) => {
          const server = http.createServer((request, response) => {
            const html = handler(request.url ?? "/");
            response.writeHead(200, { "content-type": "text/html; charset=utf-8", connection: "close" });
            response.end(html);
          });
          server.on("error", reject);
          server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            const port = typeof address === "object" && address ? address.port : 0;
            resolve({ port, close: () => server.close() });
          });
        }),
      isProcessAlive: (pid) => {
        try {
          return proc.kill(pid, 0);
        } catch (error) {
          // EPERM means it exists but is not ours; ESRCH means gone.
          return (error as { code?: string }).code === "EPERM";
        }
      },
      writeSecret: (p, text) => fs.writeFileSync(p, text, { mode: 0o600 }),
      readFile: (p) => fs.readFileSync(p),
      writeFile: (p, d) => fs.writeFileSync(p, d),
      exists: (p) => fs.existsSync(p),
      mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
      showSaveDialog: (defaultName) => {
        try {
          const result = cepFs?.fs?.showSaveDialogEx("Save a copy", undefined, undefined, defaultName);
          return result?.data || null;
        } catch {
          return null;
        }
      },
    };
  } catch {
    cached = null;
  }
  return cached;
}
