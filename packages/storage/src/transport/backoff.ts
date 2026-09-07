/**
 * Truncated exponential backoff: min(2^n + jitter, 64 s). Used for Drive's
 * 403 rateLimitExceeded / userRateLimitExceeded, 429, and 5xx.
 */
export interface BackoffOptions {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  jitter?: () => number;
  sleep?: (ms: number) => Promise<void>;
  isRetryable?: (error: unknown) => boolean;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

export function backoffDelay(attempt: number, baseMs = 1000, maxMs = 64_000, jitter = Math.random()): number {
  return Math.min(baseMs * 2 ** attempt + Math.floor(jitter * 1000), maxMs);
}

export async function withBackoff<T>(run: () => Promise<T>, options: BackoffOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 7;
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const retryable = options.isRetryable ?? (() => true);
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await run();
    } catch (error) {
      last = error;
      if (attempt === attempts - 1 || !retryable(error)) throw error;
      const delay = backoffDelay(attempt, options.baseMs, options.maxMs, options.jitter?.() ?? Math.random());
      options.onRetry?.(attempt + 1, delay, error);
      await sleep(delay);
    }
  }
  throw last;
}
