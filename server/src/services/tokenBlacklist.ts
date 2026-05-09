import crypto from 'crypto';

/**
 * In-memory JWT revocation list.
 *
 * Scope: single Express instance. Railway's single container is enough for
 * Torny today; if we scale horizontally we'd swap this for a Redis- or
 * DB-backed store.
 *
 * Gotcha: blacklist entries are lost on restart / redeploy. A token
 * revoked just before a redeploy becomes valid again until its original
 * `exp` rolls past. That's acceptable trade-off for free-tier hosting +
 * 24 h JWT lifetime — the alternative is a DB hit on every single API
 * request, which adds real latency.
 *
 * We key by SHA-256 of the token rather than the raw string so a memory
 * dump doesn't leak active-but-revoked JWTs.
 */

interface BlacklistEntry {
  /** When the underlying JWT expires (seconds since epoch, matches JWT `exp`). */
  exp: number;
}

const store = new Map<string, BlacklistEntry>();

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Add a token to the blacklist. `exp` is the JWT's `exp` claim (seconds). */
export function revokeToken(token: string, exp: number): void {
  store.set(hashToken(token), { exp });
}

/** Returns true if the token was previously revoked and is still within its original validity window. */
export function isRevoked(token: string): boolean {
  const entry = store.get(hashToken(token));
  if (!entry) return false;
  // Once the original token would've expired on its own, there's no need
  // to keep tracking it — drop on the fly.
  if (entry.exp * 1000 <= Date.now()) {
    store.delete(hashToken(token));
    return false;
  }
  return true;
}

/** Drop every entry whose underlying token has expired naturally. */
export function pruneBlacklist(): void {
  const nowSec = Math.floor(Date.now() / 1000);
  for (const [key, entry] of store) {
    if (entry.exp <= nowSec) store.delete(key);
  }
}

// Janitor: sweep once an hour so memory stays bounded. unref so the
// interval doesn't keep the Node event loop alive during shutdown.
const janitor = setInterval(pruneBlacklist, 60 * 60 * 1000);
if (typeof janitor.unref === 'function') janitor.unref();
