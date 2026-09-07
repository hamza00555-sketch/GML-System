/**
 * Minimal HTTP surface, injected: Node https inside CEP, a scripted fake in
 * tests. Streaming responses go to onChunk so a 3 GB body never sits in
 * memory.
 */
export interface HttpRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: Uint8Array | string;
  onChunk?: (chunk: Uint8Array) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  /** Empty when the body was streamed to onChunk. */
  body: Uint8Array;
}

export interface HttpClient {
  request(req: HttpRequest): Promise<HttpResponse>;
}

export function bodyText(res: HttpResponse): string {
  return new TextDecoder().decode(res.body);
}

export function bodyJson<T>(res: HttpResponse): T {
  return JSON.parse(bodyText(res) || "null") as T;
}

export function formEncode(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}
