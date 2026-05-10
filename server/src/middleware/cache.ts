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
 * Edge-cache headers:
 *   We emit two cache directives so any CDN sitting in front of the
 *   service honours them:
 *
 *     Cache-Control: public, max-age=0, s-maxage=N, stale-while-revalidate=M
 *     CDN-Cache-Control: public, s-maxage=N, stale-while-revalidate=M
 *
 *   - `max-age=0` keeps browsers from holding stale data — the React
 *     app does its own polling cadence and we don't want a phone
 *     showing yesterday's bracket because of a long-lived cache.
 *   - `s-maxage=N` is honoured by shared/proxy caches: Railway's
 *     bundled Fastly edge AND Vercel's edge cache. So a stadium full
 *     of visitors hitting either torny.app or the Railway
 *     URL directly get the same edge-cached response.
 *   - `stale-while-revalidate` lets the edge serve a slightly stale
 *     response while it refreshes asynchronously — no client ever
 *     waits for the origin during a soft expiry.
 *   - `CDN-Cache-Control` is the Vercel-specific override (takes
 *     precedence on Vercel only) so we can tune their edge separately
 *     in the future if needed without touching browser behaviour.
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
  // Browsers must NOT cache (max-age=0) so polling clients always pull
  // fresh; shared caches (Fastly/Vercel) cache for s-maxage seconds.
  const cacheControl = `public, max-age=0, s-maxage=${ttlSeconds}, stale-while-revalidate=${swr}`;
  const cdnHeader = `public, s-maxage=${ttlSeconds}, stale-while-revalidate=${swr}`;
  // `Surrogate-Control` is the Fastly-native cache directive — it
  // bypasses the `Vary: Origin` quirk that prevents Fastly from
  // caching responses with a CORS-aware Vary header. Railway ships a
  // Fastly edge in front of every service for free; without this
  // header the edge serves every request as MISS even though our
  // origin emits a clean Cache-Control.
  const surrogateControl = `max-age=${ttlSeconds}`;

  function applyEdgeHeaders(res: Response): void {
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('CDN-Cache-Control', cdnHeader);
    res.setHeader('Surrogate-Control', surrogateControl);
    // Vary on Origin so a request from one domain doesn't poison the
    // CORS response for another. Authorization is here too so Fastly
    // (Railway's edge) creates a separate cache entry for every bearer
    // token — which means admins NEVER receive the public-scoped
    // response from a previous anonymous request, even though the URL
    // is identical. Without this, an admin's `GET /tournaments` could
    // be served Fastly's cached public response (showing every tenant's
    // tournaments) for up to s-maxage seconds, completely defeating
    // owner_id scoping.
    res.setHeader('Vary', 'Origin, Accept-Encoding, Authorization');
  }

  return function cacheMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (req.method !== 'GET') return next();
    // Authed requests bypass the cache — they may carry tenant-scoped
    // payloads. We also explicitly mark the response `private, no-store`
    // so Fastly never caches it and never serves a previously-cached
    // public response in its place (the Vary: Authorization on the
    // public branch above creates the partition; this one belt-and-
    // braces it for every authed response we ever emit).
    if (req.headers.authorization) {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Origin, Accept-Encoding, Authorization');
      return next();
    }

    const key = `${req.method}:${req.originalUrl}`;
    const now = Date.now();
    const cached = store.get(key);

    if (cached && cached.expiresAt > now) {
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('X-Cache', 'HIT');
      applyEdgeHeaders(res);
      res.status(cached.status).send(cached.body);
      return;
    }

    // Wrap res.json so we can capture the response body before it goes
    // out to the client. We don't wrap res.send because all our route
    // handlers use res.json — keeping this narrow avoids surprising
    // interactions with file/stream responses elsewhere.
    const originalJson = res.json.bind(res);
    res.json = function cachedJson(body: unknown): Response {
      const isSuccess = res.statusCode >= 200 && res.statusCode < 300;

      if (isSuccess) {
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
        res.setHeader('X-Cache', 'MISS');
        applyEdgeHeaders(res);
      } else {
        // Errors (4xx/5xx) MUST NOT carry the cache headers — otherwise
        // Fastly/Vercel would happily cache a transient 500 for the
        // next minute, locking the public view into an error state.
        // We learned this the hard way when a typo in TEAM_LIST_COLUMNS
        // produced a 500 that Fastly cached and served to every
        // spectator until the cache expired.
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Cache', 'BYPASS');
      }

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
