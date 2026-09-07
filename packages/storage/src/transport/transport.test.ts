import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryFs } from "../fs.js";
import { publishAsset } from "../publish.js";
import { backoffDelay, withBackoff } from "./backoff.js";
import { DriveApiTransport, escapeQuery, isRetryableStatus } from "./drive-api.js";
import type { HttpClient, HttpRequest, HttpResponse } from "./http.js";
import { MountTransport } from "./mount.js";
import { TokenManager, authorizationUrl, exchangeCode, parseRedirect, pkcePair, type TokenSet, type TokenStore } from "./oauth.js";

const enc = (s: string) => new TextEncoder().encode(s);

class MemoryTokens implements TokenStore {
  tokens: TokenSet | null = null;
  read() {
    return this.tokens;
  }
  write(t: TokenSet) {
    this.tokens = t;
  }
  clear() {
    this.tokens = null;
  }
}

/** Scripted HTTP: each handler inspects the request and answers. */
class FakeHttp implements HttpClient {
  requests: HttpRequest[] = [];
  constructor(private readonly handler: (req: HttpRequest, n: number) => HttpResponse | Promise<HttpResponse>) {}
  async request(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    return this.handler(req, this.requests.length);
  }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): HttpResponse => ({
  status,
  headers,
  body: enc(JSON.stringify(body)),
});

describe("backoff", () => {
  it("is truncated exponential with jitter, capped at 64s", () => {
    expect(backoffDelay(0, 1000, 64_000, 0)).toBe(1000);
    expect(backoffDelay(3, 1000, 64_000, 0.5)).toBe(8500);
    expect(backoffDelay(10, 1000, 64_000, 0.9)).toBe(64_000);
  });

  it("retries retryable failures and gives up on others", async () => {
    let n = 0;
    const delays: number[] = [];
    const result = await withBackoff(
      async () => {
        n += 1;
        if (n < 3) throw new Error("rate");
        return "ok";
      },
      { sleep: async (ms) => void delays.push(ms), jitter: () => 0, isRetryable: (e) => (e as Error).message === "rate" },
    );
    expect(result).toBe("ok");
    expect(delays).toEqual([1000, 2000]);
    await expect(withBackoff(async () => { throw new Error("fatal"); }, { sleep: async () => {}, isRetryable: () => false })).rejects.toThrow("fatal");
  });
});

describe("oauth pkce", () => {
  const sha256Hex = (d: Uint8Array) => createHash("sha256").update(d).digest("hex");

  it("derives the S256 challenge from the verifier", () => {
    const pair = pkcePair(() => new Uint8Array(32), sha256Hex);
    // 32 zero bytes → 43-char base64url verifier; challenge is its sha256, base64url.
    expect(pair.verifier).toBe("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    const expected = createHash("sha256").update(pair.verifier).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(pair.challenge).toBe(expected);
    expect(pkcePair((n) => new Uint8Array(randomBytes(n)), sha256Hex).verifier).not.toBe(pair.verifier);
  });

  it("builds the authorization URL with PKCE, offline access and the two Drive scopes only", () => {
    const url = authorizationUrl({ clientId: "abc.apps.googleusercontent.com", redirectUri: "http://127.0.0.1:53211/", challenge: "CH", state: "S" });
    expect(url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?")).toBe(true);
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("code_challenge=CH");
    expect(url).toContain("access_type=offline");
    expect(decodeURIComponent(url)).toContain("drive.readonly https://www.googleapis.com/auth/drive.file");
    expect(url).not.toMatch(/auth%2Fdrive(&|$)/);
  });

  it("exchanges the code with the verifier and stores expiry; refreshes a minute early", async () => {
    const http = new FakeHttp((req, n) => {
      const body = String(req.body);
      if (n === 1) {
        expect(body).toContain("grant_type=authorization_code");
        expect(body).toContain("code_verifier=VER");
        expect(body).toContain("client_secret=notsecret");
        return json(200, { access_token: "A1", refresh_token: "R1", expires_in: 3600, scope: "s" });
      }
      expect(body).toContain("grant_type=refresh_token");
      expect(body).toContain("refresh_token=R1");
      return json(200, { access_token: "A2", expires_in: 3600 });
    });
    let now = 0;
    const tokens = await exchangeCode(http, { client: { clientId: "id", clientSecret: "notsecret" }, code: "C", verifier: "VER", redirectUri: "http://127.0.0.1:1/", now: () => now });
    expect(tokens).toMatchObject({ accessToken: "A1", refreshToken: "R1", expiresAt: 3_600_000 });

    const store = new MemoryTokens();
    store.write(tokens);
    const manager = new TokenManager(http, { clientId: "id", clientSecret: "notsecret" }, store, () => now);
    expect(await manager.accessToken()).toBe("A1");
    now = 3_600_000 - 30_000;
    expect(await manager.accessToken()).toBe("A2");
    expect(store.tokens?.refreshToken).toBe("R1");
  });

  it("parses the loopback redirect", () => {
    expect(parseRedirect("/?code=4%2Fabc&state=xyz")).toEqual({ code: "4/abc", state: "xyz" });
    expect(parseRedirect("/?error=access_denied")).toEqual({ error: "access_denied" });
  });
});

describe("mount transport", () => {
  it("streams ranges from the offset and writes uploads atomically", async () => {
    const fs = new MemoryFs();
    const data = new Uint8Array(10_000).map((_, i) => i & 0xff);
    fs.writeFile("/lib/A/b.mov", data);
    const t = new MountTransport(fs, "/lib", 4096);
    const chunks: Uint8Array[] = [];
    const result = await t.fetchRange("A/b.mov", { offset: 5000, onChunk: (c) => chunks.push(c) });
    expect(result.bytes).toBe(10_000);
    expect(chunks.reduce((n, c) => n + c.byteLength, 0)).toBe(5000);
    expect(chunks[0]![0]).toBe(5000 & 0xff);

    fs.writeFile("/local/new.mov", data);
    await t.putFile("Transitions/New/new.mov", { size: data.byteLength, read: (o, l) => fs.readRange("/local/new.mov", o, l) });
    expect(Buffer.from(fs.readFile("/lib/Transitions/New/new.mov")).equals(Buffer.from(data))).toBe(true);
    expect(fs.exists("/lib/Transitions/New/new.mov.part")).toBe(false);
  });
});

function driveSetup(handler: (req: HttpRequest, n: number) => HttpResponse | Promise<HttpResponse>) {
  const http = new FakeHttp(handler);
  const store = new MemoryTokens();
  store.write({ accessToken: "TOK", refreshToken: "R", expiresAt: Number.MAX_SAFE_INTEGER, scope: "" });
  const tokens = new TokenManager(http, { clientId: "id" }, store);
  const transport = new DriveApiTransport({ http, tokens, rootPath: "Motion/Hamza/2026/Motion Library", backoff: { sleep: async () => {}, jitter: () => 0 } });
  return { http, transport };
}

const file = (id: string, name: string, extra: Partial<{ size: string; md5Checksum: string; mimeType: string }> = {}) => ({
  id,
  name,
  mimeType: extra.mimeType ?? "video/quicktime",
  ...extra,
});
const folder = (id: string, name: string) => file(id, name, { mimeType: "application/vnd.google-apps.folder" });

describe("drive api transport", () => {
  it("escapes names in queries", () => {
    expect(escapeQuery("All & Preview's")).toBe("All & Preview\\'s");
  });

  it("classifies retryable statuses", () => {
    expect(isRetryableStatus(403, '{"error":{"errors":[{"reason":"userRateLimitExceeded"}]}}')).toBe(true);
    expect(isRetryableStatus(403, '{"error":{"errors":[{"reason":"insufficientPermissions"}]}}')).toBe(false);
    expect(isRetryableStatus(429, "")).toBe(true);
    expect(isRetryableStatus(503, "")).toBe(true);
    expect(isRetryableStatus(404, "")).toBe(false);
  });

  it("resolves a library-relative path folder by folder inside the Shared Drive, caching ids", async () => {
    const { http, transport } = driveSetup((req) => {
      const url = decodeURIComponent(req.url);
      if (url.includes("/drives?")) return json(200, { drives: [{ id: "D1", name: "Motion" }] });
      if (url.includes("name = 'Hamza'")) return json(200, { files: [folder("F1", "Hamza")] });
      if (url.includes("name = '2026'")) return json(200, { files: [folder("F2", "2026")] });
      if (url.includes("name = 'Motion Library'")) return json(200, { files: [folder("F3", "Motion Library")] });
      if (url.includes("name = 'Transitions'")) return json(200, { files: [folder("F4", "Transitions")] });
      if (url.includes("name = 'Arrows'")) return json(200, { files: [folder("F5", "Arrows")] });
      if (url.includes("name = '01_TRA_Arrows_D_H_ALPHA.mov'")) return json(200, { files: [file("X1", "01_TRA_Arrows_D_H_ALPHA.mov", { size: "20983732", md5Checksum: "abc" })] });
      return json(404, {});
    });
    const { id } = await transport.resolve("Transitions/Arrows/01_TRA_Arrows_D_H_ALPHA.mov");
    expect(id).toBe("X1");
    const listCalls = http.requests.filter((r) => r.url.includes("/files?")).length;
    expect(http.requests.every((r) => r.url.includes("supportsAllDrives=true") || r.url.includes("/drives?"))).toBe(true);
    expect(http.requests.some((r) => r.url.includes("corpora=drive&driveId=D1"))).toBe(true);

    await transport.resolve("Transitions/Arrows/01_TRA_Arrows_D_H_ALPHA.mov");
    // Second resolution only re-checks the leaf.
    expect(http.requests.filter((r) => r.url.includes("/files?")).length).toBe(listCalls + 1);
  });

  it("downloads with a Range header, resumes after a 503 from the bytes already received, and reports md5", async () => {
    const content = new Uint8Array(1000).map((_, i) => i & 0xff);
    let mediaCalls = 0;
    const { http, transport } = driveSetup((req) => {
      const url = decodeURIComponent(req.url);
      if (url.includes("/drives?")) return json(200, { drives: [{ id: "D1", name: "Motion" }] });
      if (url.includes("/files?")) {
        const name = /name = '([^']+)'/.exec(url)![1]!;
        return name.endsWith(".mov")
          ? json(200, { files: [file("X1", name, { size: "1000", md5Checksum: "m5" })] })
          : json(200, { files: [folder(`F-${name}`, name)] });
      }
      if (url.includes("/files/X1?fields=")) return json(200, { size: "1000", md5Checksum: "m5" });
      if (url.includes("alt=media")) {
        mediaCalls += 1;
        const range = /bytes=(\d+)-/.exec(req.headers!.range!)![1];
        const from = Number(range);
        if (mediaCalls === 1) {
          req.onChunk!(content.subarray(from, 400));
          return { status: 503, headers: {}, body: enc("backend error") };
        }
        req.onChunk!(content.subarray(from));
        return { status: 206, headers: {}, body: new Uint8Array(0) };
      }
      return json(404, {});
    });

    const received: Uint8Array[] = [];
    const result = await transport.fetchRange("Transitions/Arrows/a.mov", { offset: 100, onChunk: (c) => received.push(c) });
    const ranges = http.requests.filter((r) => r.url.includes("alt=media")).map((r) => r.headers!.range);
    expect(ranges).toEqual(["bytes=100-", "bytes=400-"]);
    expect(received.reduce((n, c) => n + c.byteLength, 0)).toBe(900);
    expect(result).toEqual({ bytes: 1000, md5: "m5" });
  });

  it("backs off on 403 rateLimitExceeded", async () => {
    let calls = 0;
    const { transport } = driveSetup((req) => {
      calls += 1;
      if (calls < 3) return json(403, { error: { errors: [{ reason: "userRateLimitExceeded" }] } });
      if (req.url.includes("/drives?")) return json(200, { drives: [{ id: "D1", name: "Motion" }] });
      const name = /name = '([^']+)'/.exec(decodeURIComponent(req.url))![1]!;
      return json(200, { files: [folder(`F-${name}`, name)] });
    });
    await expect(transport.resolve("")).resolves.toMatchObject({ id: "F-Motion Library" });
    expect(calls).toBe(6);
  });

  it("publishes through a resumable upload session, creating the asset folder and honouring 308 offsets", async () => {
    const data = new Uint8Array(20_000).map((_, i) => (i * 7) & 0xff);
    const puts: string[] = [];
    const { http, transport } = driveSetup((req) => {
      const url = decodeURIComponent(req.url);
      if (url.includes("/drives?")) return json(200, { drives: [{ id: "D1", name: "Motion" }] });
      if (req.method === "POST" && url.includes("/drive/v3/files?supportsAllDrives")) {
        const body = JSON.parse(String(req.body)) as { name: string };
        return json(200, folder(`NEW-${body.name}`, body.name));
      }
      if (url.includes("uploadType=resumable")) return { status: 200, headers: { location: "https://upload/session/1" }, body: new Uint8Array(0) };
      if (url.includes("/files?")) {
        const name = /name = '([^']+)'/.exec(url)![1]!;
        if (name === "New Asset" || name.endsWith(".mov") || name === "Preview.mp4") return json(200, { files: [] });
        return json(200, { files: [folder(`F-${name}`, name)] });
      }
      if (url.startsWith("https://upload/session/1")) {
        const range = req.headers!["content-range"]!;
        puts.push(range);
        const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(range)!;
        const end = Number(m[2]);
        const total = Number(m[3]);
        if (end + 1 >= total) return json(200, { id: "UP" });
        // Pretend the server only kept part of the first chunk.
        if (puts.length === 1) return { status: 308, headers: { range: `bytes=0-${end - 1000}` }, body: new Uint8Array(0) };
        return { status: 308, headers: { range: `bytes=0-${end}` }, body: new Uint8Array(0) };
      }
      return json(404, {});
    });
    const t = new DriveApiTransport({ http, tokens: (transport as unknown as { tokens: TokenManager }).tokens, rootPath: "Motion/Hamza/2026/Motion Library", uploadChunkBytes: 8192, backoff: { sleep: async () => {} } });

    const fs = new MemoryFs();
    fs.writeFile("/out/new.mov", data);
    fs.writeFile("/out/preview.mp4", data.subarray(0, 100));
    const result = await publishAsset(fs, t, { categoryFolder: "Transitions", name: "New Asset", deliverables: [{ localPath: "/out/new.mov" }], previewLocalPath: "/out/preview.mp4" });
    expect(result.relDir).toBe("Transitions/New Asset");
    expect(result.files).toEqual(["Transitions/New Asset/new.mov", "Transitions/New Asset/Preview.mp4"]);
    // The folder was created once, under Transitions.
    const creates = http.requests.filter((r) => r.method === "POST" && r.url.includes("/drive/v3/files?supportsAllDrives"));
    expect(creates.map((r) => (JSON.parse(String(r.body)) as { name: string; parents: string[] }))).toEqual([{ name: "New Asset", mimeType: "application/vnd.google-apps.folder", parents: ["F-Transitions"] }]);
    // The second chunk restarted from the server's acknowledged offset.
    expect(puts[0]).toBe("bytes 0-8191/20000");
    expect(puts[1]).toBe("bytes 7192-15383/20000");
  });
});
