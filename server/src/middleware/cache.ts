import { Request, Response, NextFunction } from 'express';

/**
 * In-memory response cache for public GET endpoints.
 *
 * Why this exists:
 *   A 400-spectator burst on the public tournament view (each client
 *   firing 5 parallel fetches at t=0) generates ~2000 concurrent SELECTs
 *   against Postgres. Even with a generous pg pool, the duplicate work
 *   wastes CPU + connections and tail latency explodes (p95 > 30s).
 *
 *   Most public endpoints serve data that changes on a scale of seconds
 *   (live match scores) to minutes (team list, tournament metadata),
 *   so caching the response for 5–60 s collapses N duplicate requests
 *   into a single DB round-trip.
 *
 * What is NOT cached:
 *   - Anything with `Authorization: Bearer …` in the request — admin-
 *     scoped responses (e.g. `/tournaments` filtered by ownerId, judge
 *     match feed) MUST NOT be served from a public cache or you'd leak
 *     other tenants' data.
 *   - Any non-2xx response — we don't want to stick a 503 in the cache.
 *   - Non-GET requests.
 *
 * CDN-Cache-Control:
 *   We also emit `CDN-Cache-Control: public, s-maxage=N, stale-while-
 *   revalidate=M`. This is honoured by Vercel's edge layer when the
 *   request comes through `/api/*` rewrites — for visitors hitting the
 *   site via spike-cup.vercel.app, the response can be served straight
 *   from the edge without ever touching Railway. We deliberately don't
 *   set the legacy `Cache-Control` header because the React app does its
 *   own polling cadence and we don't want browser caches holding stale
 *   data forever; the SWR window gives Vercel a soft refresh signal.
 *
 * Memory bounds:
 *   Each entry stores the JSON body as a string. A periodic sweep every
 *   60 s evicts expired entries. The map is keyed by `METHOD:URL` so
 *   the working set is bounded by the number of distinct public URLs
 *   (tens, not thousands).
 */

interface CacheEntry {
  body: string;
  status: number;
  contentType: string;
  expiresAt: number;
}

const store = new Map<string, CacheEntry>();

// Periodic eviction so the map can't grow unbounded if URLs vary
// (e.g. a query string parameter we didn't anticipate). Unref so the
// timer doesn't keep the process alive on shutdown.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expiresAt < now) store.delete(k);
  }
}, 60_000);
sweep.unref();

export interface CacheOptions {
  /** Soft expiry — Vercel may serve stale up to this many extra seconds
   *  while it revalidates in the background. Default = ttlSeconds * 2. */
  swrSeconds?: number;
}

/**
 * Cache GET responses for `ttlSeconds`. Use as a route-level middleware
 * BEFORE the actual handler.
 */
export function cacheGet(ttlSeconds: number, options: CacheOptions = {}) {
  const swr = options.swrSeconds ?? ttlSeconds * 2;
  const cdnHeader = `public, s-maxage=${ttlSeconds}, stale-while-revalidate=${swr}`;

  return function cacheMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (req.method !== 'GET') return next();
    // Authed requests bypass the cache — they may carry tenant-scoped
    // payloads. The unauthed flow (visitors) is what we want to optimise.
    if (req.headers.authorization) return next();

    const key = `${req.method}:${req.originalUrl}`;
    const now = Date.now();
    const cached = store.get(key);

    if (cached && cached.expiresAt > now) {
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('CDN-Cache-Control', cdnHeader);
      res.status(cached.status).send(cached.body);
      return;
    }

    // Wrap res.json so we can capture the response body before it goes
    // out to the client. We don't wrap res.send because all our route
    // handlers use res.json — keeping this narrow avoids surprising
    // interactions with file/stream responses elsewhere.
    const originalJson = res.json.bind(res);
    res.json = function cachedJson(body: unknown): Response {
      // Only stash success responses in the cache — never lock in a 4xx
      // or 5xx for the next 30 s.
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          const serialised = JSON.stringify(body);
          store.set(key, {
            body: serialised,
            status: res.statusCode,
            contentType: 'application/json; charset=utf-8',
            expiresAt: now + ttlSeconds * 1000,
          });
        } catch {
          // If body isn't serialisable for some reason, just don't cache.
        }
      }
      res.setHeader('X-Cache', 'MISS');
      res.setHeader('CDN-Cache-Control', cdnHeader);
      return originalJson(body);
    };

    next();
  };
}

/**
 * Hard-clear the in-memory cache. Useful for tests; in production we
 * rely on the TTL to roll values forward, since admin writes only need
 * to propagate within seconds (single-digit TTLs on hot endpoints).
 */
export function clearCache(): void {
  store.clear();
}
