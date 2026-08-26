import { cepNodeRequire } from "./csinterface.js";
import type { Check, Verdict } from "./diagnostics.js";

/**
 * Deeper probes, run on request rather than at panel load: they open sockets
 * and touch the filesystem, which is not something a diagnostics screen should
 * do just by being visible.
 */

function result(id: string, label: string, verdict: Verdict, detail: string): Check {
  return { id, label, verdict, detail };
}

/**
 * Structural types for the handful of Node APIs used below. Importing the real
 * @types/node declarations would pull a server-side global environment into a
 * package that also builds for the browser.
 */
interface NodeHttp {
  createServer(handler: (req: unknown, res: { end(body: string): void }) => void): {
    on(event: "error", cb: (err: unknown) => void): void;
    listen(port: number, host: string, cb: () => void): void;
    address(): { port: number } | string | null;
    close(cb: () => void): void;
  };
}
interface NodeFs {
  mkdirSync(path: string, options: { recursive: boolean }): void;
  writeFileSync(path: string, data: string, encoding: string): void;
  unlinkSync(path: string): void;
}
interface NodeOs {
  homedir(): string;
  platform(): string;
  release(): string;
}
interface NodePath {
  join(...parts: string[]): string;
}
interface NodeHttps {
  get(
    options: { host: string; path: string; timeout: number },
    cb: (res: { statusCode?: number; resume(): void }) => void,
  ): { on(event: "timeout" | "error", cb: (err?: unknown) => void): void; destroy(err?: Error): void };
}

/**
 * Everything the Drive provider will need from Node inside CEP: a loopback
 * server for the OAuth redirect, outbound HTTPS, and a writable user data
 * directory for the refresh token.
 */
export async function probeNode(): Promise<Check[]> {
  const checks: Check[] = [];
  const req = cepNodeRequire();

  if (!req) {
    return [
      result(
        "node-require",
        "Node require()",
        "fail",
        "Not available. Without it there is no Drive client, no aerender and no ffmpeg.",
      ),
    ];
  }
  checks.push(result("node-require", "Node require()", "pass", "available"));

  // Loopback server on a random free port — the OAuth redirect target.
  try {
    const http = req("http") as NodeHttp;
    const port = await new Promise<number>((resolve, reject) => {
      const server = http.createServer((_req, res) => res.end("ok"));
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const chosen = typeof address === "object" && address ? address.port : 0;
        server.close(() => resolve(chosen));
      });
    });
    checks.push(
      result("node-loopback", "Loopback HTTP server (OAuth redirect)", "pass", `bound 127.0.0.1:${port}`),
    );
  } catch (error) {
    checks.push(
      result("node-loopback", "Loopback HTTP server (OAuth redirect)", "fail", String(error)),
    );
  }

  // Writable user data directory — where the refresh token will live.
  try {
    const fs = req("fs") as NodeFs;
    const os = req("os") as NodeOs;
    const path = req("path") as NodePath;
    const dir = path.join(os.homedir(), ".gml");
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, "probe.tmp");
    fs.writeFileSync(probe, "gml", "utf8");
    fs.unlinkSync(probe);
    checks.push(result("node-fs", "Writable user data directory", "pass", dir));
  } catch (error) {
    checks.push(result("node-fs", "Writable user data directory", "fail", String(error)));
  }

  // Outbound HTTPS — a corporate proxy or filter would surface here.
  try {
    const https = req("https") as NodeHttps;
    const status = await new Promise<number>((resolve, reject) => {
      const request = https.get(
        { host: "oauth2.googleapis.com", path: "/", timeout: 8000 },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      request.on("timeout", () => request.destroy(new Error("timed out")));
      request.on("error", reject);
    });
    checks.push(
      result("node-https", "Outbound HTTPS to Google", "pass", `reachable (HTTP ${status})`),
    );
  } catch (error) {
    checks.push(
      result(
        "node-https",
        "Outbound HTTPS to Google",
        "fail",
        `${String(error)} — a proxy or firewall will block Drive`,
      ),
    );
  }

  return checks;
}

export interface MediaProbe {
  label: string;
  src: string;
  verdict: Verdict;
  detail: string;
}

/** Confirms actual decoding, where canPlayType only reports intent. */
export function probePlayback(src: string, label: string, timeoutMs = 6000): Promise<MediaProbe> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    const finish = (verdict: Verdict, detail: string) => {
      video.removeAttribute("src");
      video.load();
      resolve({ label, src, verdict, detail });
    };

    const timer = setTimeout(() => finish("fail", `no data within ${timeoutMs}ms`), timeoutMs);

    video.addEventListener("loadeddata", () => {
      clearTimeout(timer);
      void video
        .play()
        .then(() => finish("pass", `decoded ${video.videoWidth}×${video.videoHeight}, playing`))
        .catch((error: unknown) => finish("warn", `decoded but play() refused: ${String(error)}`));
    });

    video.addEventListener("error", () => {
      clearTimeout(timer);
      const code = video.error?.code;
      finish("fail", `media error ${code ?? "?"} — ${video.error?.message ?? "no detail"}`);
    });

    video.src = src;
  });
}
