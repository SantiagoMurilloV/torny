import { Request, Response, NextFunction } from 'express';

/**
 * Tiny in-memory rate limiter for auth-critical endpoints.
 *
 * Scope: single Express instance. Torny runs as one Railway container
 * today; if we ever scale horizontally we'd need to swap this for a
 * Redis-backed limiter (e.g. `rate-limiter-flexible` with Upstash).
 *
 * Algorithm: sliding window. A key (`ip:username`) accumulates timestamps
 * of failed attempts; on each new attempt we drop anything older than
 * `windowMs` and count the remainder. If that count exceeds `max` we
 * answer 429 with a Retry-After header. Successful attempts should call
 * `clear(key)` so a user who finally logs in isn't locked out.
 */

interface LimiterOptions {
  windowMs: number;
  max: number;
  /**
   * Builds the bucket key from the request. Default is IP only; login
   * uses `ip|username` so a single IP can't burn out every account,
   * and a single account can't be locked from behind a shared proxy.
   */
  keyFn?: (req: Request) => string;
  /** Custom response message. */
  message?: string;
}

class SlidingWindow {
  private buckets = new Map<string, number[]>();

  constructor(private windowMs: number, private max: number) {}

  attempt(key: string): { allowed: boolean; retryAfterSec?: number } {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const recent = (this.buckets.get(key) ?? []).filter((t) => t > cutoff);

    if (recent.length >= this.max) {
      const oldest = recent[0];
      const retryAfterSec = Math.ceil((oldest + this.windowMs - now) / 1000);
      this.buckets.set(key, recent);
      return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) };
    }

    recent.push(now);
    this.buckets.set(key, recent);
    return { allowed: true };
  }

  clear(key: string) {
    this.buckets.delete(key);
  }

  /** House-keeping — trim stale keys once every few minutes to keep memory bounded. */
  prune() {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, times] of this.buckets) {
      const recent = times.filter((t) => t > cutoff);
      if (recent.length === 0) this.buckets.delete(key);
      else this.buckets.set(key, recent);
    }
  }
}

export function createRateLimiter(opts: LimiterOptions) {
  const window = new SlidingWindow(opts.windowMs, opts.max);
  // Prune every 5 min so abandoned keys don't pile up forever.
  const prune = setInterval(() => window.prune(), 5 * 60 * 1000);
  // Don't hold the Node event loop open just for the janitor.
  if (typeof prune.unref === 'function') prune.unref();

  const defaultKey = (req: Request) =>
    req.ip ?? req.socket.remoteAddress ?? 'unknown';

  const middleware = (req: Request, res: Response, next: NextFunction): void => {
    const key = (opts.keyFn ?? defaultKey)(req);
    const result = window.attempt(key);
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSec ?? 60));
      res.status(429).json({
        message:
          opts.message ??
          `Demasiados intentos. Intentá de nuevo en ${result.retryAfterSec ?? 60}s.`,
      });
      return;
    }
    next();
  };

  // Expose `.clear` so successful login can reset its own bucket.
  (middleware as typeof middleware & { clear: (req: Request) => void }).clear = (
    req: Request,
  ) => window.clear((opts.keyFn ?? defaultKey)(req));

  return middleware as typeof middleware & { clear: (req: Request) => void };
}

/**
 * Login-specific limiter: 5 attempts per sliding 10-minute window,
 * keyed by `ip|username` so a single account is protected from
 * brute-force AND a single IP can't burn through many accounts.
 */
export const loginRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 5,
  keyFn: (req) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const username = String((req.body as { username?: unknown })?.username ?? '')
      .trim()
      .toLowerCase();
    return `${ip}|${username}`;
  },
  message:
    'Demasiados intentos fallidos. Esperá unos minutos antes de volver a intentar.',
});
