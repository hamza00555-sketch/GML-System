import { bodyJson, bodyText, formEncode, type HttpClient } from "./http.js";

/**
 * Google OAuth for an installed app, done properly:
 *
 *  - PKCE is mandatory — a desktop client's "secret" is public by design.
 *  - Google refuses OAuth inside embedded webviews (a CEP panel is one), so
 *    the flow opens the system browser and lands on a loopback listener.
 *  - Scopes stay at drive.readonly + drive.file; access is governed by Shared
 *    Drive membership, not by the panel.
 *
 * This file is the pure part: URLs, PKCE, token exchange and refresh over an
 * injected HttpClient. The loopback server and browser launch live in the
 * CEP package where Node is available.
 */

export const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
] as const;

export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

export interface OAuthClient {
  clientId: string;
  /** Not confidential for an installed app; kept in user config, never in the extension. */
  clientSecret?: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  scope: string;
  /** Google account e-mail when the userinfo scope granted it; informational. */
  account?: string;
}

export interface TokenStore {
  read(): TokenSet | null;
  write(tokens: TokenSet): void;
  clear(): void;
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 = typeof btoa === "function" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** RFC 7636, S256. `sha256Hex` is the injected hash so this stays free of Node imports. */
export function pkcePair(randomBytes: (n: number) => Uint8Array, sha256Hex: (data: Uint8Array) => string): PkcePair {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(hexToBytes(sha256Hex(new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

export function authorizationUrl(args: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
  scopes?: readonly string[];
  loginHint?: string;
}): string {
  const params: Record<string, string> = {
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    scope: (args.scopes ?? DRIVE_SCOPES).join(" "),
    code_challenge: args.challenge,
    code_challenge_method: "S256",
    state: args.state,
    access_type: "offline",
    prompt: "consent",
  };
  if (args.loginHint) params.login_hint = args.loginHint;
  return `${GOOGLE_AUTH_ENDPOINT}?${formEncode(params)}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(http: HttpClient, fields: Record<string, string>, now: number): Promise<TokenResponse> {
  const res = await http.request({
    method: "POST",
    url: GOOGLE_TOKEN_ENDPOINT,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: formEncode(fields),
  });
  let parsed: TokenResponse;
  try {
    parsed = bodyJson<TokenResponse>(res);
  } catch {
    throw new Error(`token endpoint returned ${res.status}: ${bodyText(res).slice(0, 200)}`);
  }
  if (res.status >= 400 || parsed.error) {
    throw new Error(`${parsed.error ?? res.status}: ${parsed.error_description ?? "token request failed"}`);
  }
  void now;
  return parsed;
}

export async function exchangeCode(
  http: HttpClient,
  args: { client: OAuthClient; code: string; verifier: string; redirectUri: string; now?: () => number },
): Promise<TokenSet> {
  const now = args.now ?? (() => Date.now());
  const fields: Record<string, string> = {
    client_id: args.client.clientId,
    code: args.code,
    code_verifier: args.verifier,
    grant_type: "authorization_code",
    redirect_uri: args.redirectUri,
  };
  if (args.client.clientSecret) fields.client_secret = args.client.clientSecret;
  const res = await tokenRequest(http, fields, now());
  if (!res.refresh_token) throw new Error("Google did not return a refresh token — revoke the app's access and sign in again.");
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token,
    expiresAt: now() + res.expires_in * 1000,
    scope: res.scope ?? "",
  };
}

export async function refreshAccessToken(
  http: HttpClient,
  args: { client: OAuthClient; tokens: TokenSet; now?: () => number },
): Promise<TokenSet> {
  const now = args.now ?? (() => Date.now());
  const fields: Record<string, string> = {
    client_id: args.client.clientId,
    refresh_token: args.tokens.refreshToken,
    grant_type: "refresh_token",
  };
  if (args.client.clientSecret) fields.client_secret = args.client.clientSecret;
  const res = await tokenRequest(http, fields, now());
  return {
    ...args.tokens,
    accessToken: res.access_token,
    expiresAt: now() + res.expires_in * 1000,
    scope: res.scope ?? args.tokens.scope,
  };
}

/** Hands out a valid access token, refreshing a minute early. */
export class TokenManager {
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly http: HttpClient,
    private readonly client: OAuthClient,
    private readonly store: TokenStore,
    private readonly now: () => number = () => Date.now(),
  ) {}

  signedIn(): boolean {
    return this.store.read() !== null;
  }

  account(): string | undefined {
    return this.store.read()?.account;
  }

  async accessToken(): Promise<string> {
    const tokens = this.store.read();
    if (!tokens) throw new Error("Not signed in to Google Drive.");
    if (tokens.expiresAt - this.now() > 60_000) return tokens.accessToken;
    if (!this.inflight) {
      this.inflight = refreshAccessToken(this.http, { client: this.client, tokens, now: this.now })
        .then((next) => {
          this.store.write(next);
          return next.accessToken;
        })
        .finally(() => {
          this.inflight = null;
        });
    }
    return this.inflight;
  }

  async signOut(): Promise<void> {
    const tokens = this.store.read();
    this.store.clear();
    if (!tokens) return;
    try {
      await this.http.request({
        method: "POST",
        url: `${GOOGLE_REVOKE_ENDPOINT}?token=${encodeURIComponent(tokens.refreshToken)}`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
    } catch {
      // Local sign-out succeeded either way.
    }
  }
}

/** Parses the loopback redirect: `?code=…&state=…` or `?error=…`. */
export function parseRedirect(url: string): { code?: string; state?: string; error?: string } {
  const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  const out: Record<string, string> = {};
  for (const pair of q.split("&")) {
    if (!pair) continue;
    const [k, v = ""] = pair.split("=");
    out[decodeURIComponent(k!)] = decodeURIComponent(v.replace(/\+/g, " "));
  }
  return out;
}
