import {
  authorizationUrl,
  exchangeCode,
  parseRedirect,
  pkcePair,
  type OAuthClient,
  type TokenSet,
  type TokenStore,
} from "@gml/storage";
import type { PanelNode } from "./node.js";

/**
 * The interactive half of OAuth: PKCE pair, loopback listener on an ephemeral
 * port, system browser, exchange. Google blocks OAuth inside embedded
 * webviews, and the CEP panel is one — hence the browser.
 */
export const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

const DONE_HTML = `<!doctype html><meta charset="utf-8"><title>GML</title>
<body style="font-family:system-ui;background:#1e1e1e;color:#e2e2e2;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h1 style="color:#41d37e">GML is connected</h1><p>You can close this tab and return to After Effects.</p></div></body>`;

const FAILED_HTML = (reason: string) => `<!doctype html><meta charset="utf-8"><title>GML</title>
<body style="font-family:system-ui;background:#1e1e1e;color:#e2e2e2;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h1 style="color:#e06c5a">Sign-in did not complete</h1><p>${reason}</p></div></body>`;

export async function signInWithGoogle(node: PanelNode, client: OAuthClient, store: TokenStore, loginHint?: string): Promise<TokenSet> {
  const { verifier, challenge } = pkcePair(node.randomBytes, node.sha256Hex);
  const state = Array.from(node.randomBytes(16), (b) => b.toString(16).padStart(2, "0")).join("");

  let settle: ((result: { code?: string; error?: string }) => void) | null = null;
  const redirect = new Promise<{ code?: string; error?: string }>((resolve) => {
    settle = resolve;
  });

  const server = await node.listenLoopback((url) => {
    const params = parseRedirect(url);
    if (params.state !== state) return FAILED_HTML("State mismatch — try again from the panel.");
    settle?.({ code: params.code, error: params.error });
    return params.code ? DONE_HTML : FAILED_HTML(params.error ?? "no code returned");
  });

  const redirectUri = `http://127.0.0.1:${server.port}/`;
  node.openExternal(authorizationUrl({ clientId: client.clientId, redirectUri, challenge, state, loginHint }));

  const timeout = new Promise<{ code?: string; error?: string }>((resolve) =>
    setTimeout(() => resolve({ error: "timed out waiting for the browser" }), SIGN_IN_TIMEOUT_MS),
  );
  try {
    const result = await Promise.race([redirect, timeout]);
    if (!result.code) throw new Error(result.error ?? "sign-in cancelled");
    const tokens = await exchangeCode(node.http, { client, code: result.code, verifier, redirectUri });
    store.write(tokens);
    return tokens;
  } finally {
    server.close();
  }
}

/** Refresh token on disk, owner-only, outside the extension folder. */
export function fileTokenStore(node: PanelNode, path: string): TokenStore {
  return {
    read: () => {
      try {
        if (!node.exists(path)) return null;
        return JSON.parse(new TextDecoder().decode(node.readFile(path))) as TokenSet;
      } catch {
        return null;
      }
    },
    write: (tokens) => {
      node.mkdir(node.path.dirname(path));
      node.writeSecret(path, JSON.stringify(tokens));
    },
    clear: () => {
      if (node.exists(path)) node.fs.rm(path);
    },
  };
}
