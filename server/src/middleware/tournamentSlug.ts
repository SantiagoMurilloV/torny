/**
 * Resolve a tournament URL parameter that may be either a UUID or a slug
 * down to the canonical UUID before the request reaches the controller.
 *
 * Public-facing URLs use the tournament's slug (e.g.
 * /tournament/copa-nacional-2026-a29966) so visitors see a human-readable
 * path instead of an opaque UUID. Internally every query in the
 * `tournaments` ecosystem (matches, standings, bracket, enrolled teams,
 * sponsors, fixtures, etc.) joins by `tournament_id = $1` and therefore
 * needs the UUID. Rather than touch every controller / service, this
 * middleware sits at the route level and rewrites `req.params.id` (or
 * `req.params.tournamentId`) to the resolved UUID so the rest of the
 * stack is oblivious to which form arrived.
 *
 * Behaviour:
 *   · UUID parameter → pass-through (no DB hit).
 *   · slug parameter → SELECT id FROM tournaments WHERE slug = $1.
 *     · Hit  → rewrite param, next().
 *     · Miss → next(): downstream handler emits 404 with the standard
 *       "Torneo no encontrado" copy — keeps the response shape uniform
 *       so the frontend doesn't need a special branch.
 *
 * Caching: slug → id mapping is stable for the life of the tournament
 * (slugs are NOT NULL UNIQUE since mig 029 and never edited via UI),
 * so a small in-memory Map collapses repeated lookups within a process.
 * Bounded to 1024 entries with a naive FIFO eviction — slugs are short
 * strings so memory footprint is trivial even at the cap. The cache is
 * also process-local (no cross-instance invalidation), which is fine:
 * a new tournament becomes resolvable on every replica as soon as the
 * first request for that slug arrives.
 */

import { NextFunction, Request, Response } from 'express';
import { getPool } from '../config/database';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const MAX_CACHE = 1024;
const slugCache = new Map<string, string>();

function rememberSlug(slug: string, id: string): void {
  if (slugCache.size >= MAX_CACHE) {
    const oldest = slugCache.keys().next().value;
    if (oldest !== undefined) slugCache.delete(oldest);
  }
  slugCache.set(slug, id);
}

export async function resolveTournamentSlug(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const raw =
    (req.params.id as string | undefined) ??
    (req.params.tournamentId as string | undefined);

  // No id in the route → nothing to resolve; let the next middleware
  // decide what to do (most will 400 / 404).
  if (!raw) {
    return next();
  }

  // Already a UUID → fast path, no DB hit.
  if (UUID_RE.test(raw)) {
    return next();
  }

  // Reject pathological strings up front so we don't pay a DB round-trip
  // for things that can't possibly be a valid slug (e.g. SQL injection
  // probes, malformed UUIDs with stray chars). Pass through so the
  // downstream `validateUUID` raises the standard 400 — clients sending
  // garbage deserve a clear "bad request" rather than a misleading 404.
  if (raw.length > 160 || !SLUG_RE.test(raw)) {
    return next();
  }

  const cached = slugCache.get(raw);
  if (cached) {
    if (req.params.id !== undefined) req.params.id = cached;
    if (req.params.tournamentId !== undefined) req.params.tournamentId = cached;
    return next();
  }

  try {
    const pool = getPool();
    const result = await pool.query<{ id: string }>(
      'SELECT id FROM tournaments WHERE slug = $1',
      [raw],
    );
    if (result.rows.length === 0) {
      // Looks like a slug, but no tournament owns it. Respond 404 with
      // the standard copy so the public form / share-link landing page
      // shows "Torneo no encontrado" instead of the (technically
      // accurate but unhelpful) 400 "ID de torneo no es un UUID válido"
      // that the controller's validateUUID would otherwise emit. No
      // cache poisoning: misses are never stored.
      res.status(404).json({ error: 'Torneo no encontrado' });
      return;
    }
    const id = result.rows[0].id;
    rememberSlug(raw, id);
    if (req.params.id !== undefined) req.params.id = id;
    if (req.params.tournamentId !== undefined) req.params.tournamentId = id;
    return next();
  } catch (err) {
    return next(err);
  }
}
